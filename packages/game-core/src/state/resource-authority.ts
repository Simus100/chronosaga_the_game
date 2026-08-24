import type { ResourceMap, SettlementState, StateChange, WorldState } from "@paa/game-types";

/**
 * One authoritative source for settlement resources.
 *
 * The systemic campaign keeps resources in `simulation.settlements[].resourceStock`.
 * `WorldState.resources` is a flat compatibility projection of that stock, kept
 * only until the old P0 surface is fully migrated.
 *
 * Before this module the two drifted apart: a player choice wrote the flat map
 * and never touched the stock, and the next world tick mirrored the stock back
 * over the flat map — silently erasing the choice. The state was not corrupt in
 * any way a schema could catch, and no test failed. It simply lost decisions.
 *
 * So every read and every write of a settlement resource goes through here, and
 * the projection is updated as a consequence of the authoritative write rather
 * than as a second independent truth.
 */

/** Which settlement a resource effect applies to, or why that cannot be decided. */
export type SettlementTarget =
  | { readonly kind: "legacy" }
  | { readonly kind: "settlement"; readonly settlement: SettlementState }
  | { readonly kind: "ambiguous"; readonly reason: string };

/**
 * The settlement a resource effect belongs to.
 *
 * Fail-closed on purpose. M1-C has exactly one settlement, and the temptation is
 * to write `settlements[0]` and move on — but that turns a temporary fact about
 * the current scenario into a permanent implicit rule, and the day a second
 * settlement appears every untargeted effect would silently land on whichever
 * happened to be first. An effect that cannot say where it applies is a contract
 * gap, and the run should stop rather than guess.
 *
 * A campaign with no `simulation` is the legacy P0 shape: it has no settlements
 * at all, and its flat resource map is its own authority. That path is unchanged.
 *
 * `key` scopes the question to one resource. Omit it to ask only about shape.
 */
export function resolveSettlementTarget(state: WorldState, key?: string): SettlementTarget {
  const simulation = state.simulation;
  if (!simulation) return { kind: "legacy" };

  const settlements = simulation.settlements;
  if (settlements.length === 1) {
    const settlement = settlements[0]!;
    // A settlement is authoritative for the resources it actually stocks. The
    // campaign also carries resources no settlement holds — credits, influence,
    // alloys — and those belong to the flat map, which is their own authority
    // rather than a projection of anything.
    //
    // Without this the scenario's own `con_relay_debt_01` consequence, which
    // spends 3 credits, wrote `resourceStock.credits = -3` into a settlement
    // that has no credits and then mirrored that over a balance of 27.
    if (key !== undefined && !(key in settlement.resourceStock)) return { kind: "legacy" };
    return { kind: "settlement", settlement };
  }

  if (settlements.length === 0) {
    return {
      kind: "ambiguous",
      reason:
        "the systemic simulation has no settlement, so there is nowhere authoritative " +
        "to apply a resource effect"
    };
  }

  return {
    kind: "ambiguous",
    reason:
      `the systemic simulation has ${settlements.length} settlements and the effect names ` +
      "none of them; multi-settlement targeting is not part of this contract yet"
  };
}

/** The error a caller raises when an effect cannot be placed. */
function ambiguous(reason: string, key: string): Error {
  return new Error(`Cannot resolve an authoritative settlement for resource '${key}': ${reason}`);
}

/**
 * The current authoritative value of one resource.
 *
 * Requirements are checked against the same source the effects will write, so a
 * choice can never be permitted by one number and applied to another.
 */
export function readAuthoritativeResource(state: WorldState, key: string): number {
  const target = resolveSettlementTarget(state, key);
  switch (target.kind) {
    case "legacy":
      return state.resources[key] ?? 0;
    case "settlement":
      return target.settlement.resourceStock[key] ?? 0;
    case "ambiguous":
      throw ambiguous(target.reason, key);
  }
}

/**
 * Apply a resource change to the authoritative stock, and update the projection.
 *
 * `changes` receives the authoritative mutation first: the primary StateDelta
 * entry describes the systemic stock, because that is what actually changed.
 * The projection follows as a derived entry, so a reader can tell which was the
 * decision and which was the mirror.
 *
 * `next` is mutated in place; callers already work on their own clone.
 */
export function applyAuthoritativeResourceDelta(
  next: WorldState,
  key: string,
  value: number,
  changes: StateChange[]
): void {
  const target = resolveSettlementTarget(next, key);
  if (target.kind === "ambiguous") throw ambiguous(target.reason, key);

  if (target.kind === "legacy") {
    const before = next.resources[key] ?? 0;
    const after = before + value;
    next.resources[key] = after;
    changes.push({ type: "resource", key, before, after });
    return;
  }

  const settlement = target.settlement;
  const before = settlement.resourceStock[key] ?? 0;
  const after = before + value;
  settlement.resourceStock[key] = after;
  changes.push({
    type: "resource",
    key: `${settlement.id}.resourceStock.${key}`,
    before,
    after
  });

  projectResource(next.resources, key, after, changes);
}

/**
 * Keep the flat map equal to the authoritative value.
 *
 * Shared with the world tick's mirror so there is one definition of what the
 * projection means. Silent when nothing moved: a mirror entry for an unchanged
 * number is noise in the delta.
 */
export function projectResource(
  projection: ResourceMap,
  key: string,
  authoritative: number,
  changes: StateChange[]
): void {
  const before = projection[key];
  if (before === authoritative) return;
  projection[key] = authoritative;
  changes.push({
    type: "resourceMirror",
    key: `resources.${key}`,
    before,
    after: authoritative
  });
}
