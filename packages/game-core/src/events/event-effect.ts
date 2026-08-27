import type { EventEffect, StateChange, WorldState } from "@paa/game-types";
import { applyAuthoritativeResourceDelta } from "../state/resource-authority.js";

/**
 * The effect types this build can apply, declared once.
 *
 * Both validators used to carry their own copy of this list. Three lists that
 * must agree are three chances for a payload to be accepted by one authority
 * and rejected — or worse, silently ignored — by another. The list lives next
 * to `applyEventEffect` on purpose: what a validator promises is precisely
 * that the applicator below can handle the value.
 */
export const EVENT_EFFECT_TYPES = [
  "RESOURCE_DELTA",
  "FLAG_SET",
  "PRESSURE_DELTA",
  "CHARACTER_STRESS"
] as const satisfies readonly EventEffect["type"][];

/**
 * The one place an `EventEffect` becomes a change to the world.
 *
 * Before this module the same effect had two implementations: one inside
 * `resolveChoice` for immediate application, one inside `applyDueConsequences`
 * for delayed application. They were written to agree and did not: a
 * `RESOURCE_DELTA` with no key was silently ignored on the immediate path and
 * threw on the delayed one, and a `CHARACTER_STRESS` naming an absent
 * character did the same.
 *
 * That divergence is worse than untidy. A player choice and the delayed
 * consequence of that choice would produce different worlds from the same
 * effect, and the difference would depend on *when* the effect arrived — which
 * is exactly the property a systemic game must not have. It is also the seam
 * along which any new effect type would have split, since adding one meant
 * editing two applicators and hoping they stayed level.
 *
 * The shared applicator resolves the disagreement in the fail-closed
 * direction: a malformed effect throws rather than disappearing. Nothing in
 * the catalogue reaches it malformed — `validateGameEvent` and
 * `validateSystemicWorldState` both reject the missing-key and missing-target
 * shapes before they can be stored or played — so this tightening applies to
 * inputs that were already invalid, and it makes them say so.
 *
 * What this function deliberately does NOT do is advance the Player Turn.
 * A turn is the mark of a significant decision, not of an effect being
 * applied; `resolveChoice` owns that increment, and a delayed consequence must
 * never acquire it by sharing code with a choice.
 */
export function applyEventEffect(
  state: WorldState,
  effect: EventEffect,
  changes: StateChange[]
): void {
  if (effect.type === "RESOURCE_DELTA") {
    if (!effect.key) throw new Error("RESOURCE_DELTA requires key");
    // The authoritative path, not the flat projection: a change written to the
    // projection is erased by the next tick that recomputes it.
    applyAuthoritativeResourceDelta(state, effect.key, Number(effect.value), changes);
    return;
  }

  if (effect.type === "FLAG_SET") {
    if (!effect.key) throw new Error("FLAG_SET requires key");
    const before = state.flags[effect.key];
    const after = effect.value;
    state.flags[effect.key] = after;
    changes.push({ type: "flag", key: effect.key, before, after });
    return;
  }

  if (effect.type === "PRESSURE_DELTA") {
    const before = state.worldPressure;
    const after = Math.max(0, before + Number(effect.value));
    state.worldPressure = after;
    changes.push({ type: "worldPressure", key: "worldPressure", before, after });
    return;
  }

  if (effect.type === "CHARACTER_STRESS") {
    if (!effect.targetId) throw new Error("CHARACTER_STRESS requires targetId");
    const character = state.party.find(candidate => candidate.id === effect.targetId);
    if (!character) throw new Error(`Unknown character '${effect.targetId}'`);
    const before = character.stress;
    const after = Math.max(0, Math.min(100, before + Number(effect.value)));
    character.stress = after;
    changes.push({ type: "characterStress", key: character.id, before, after });
    return;
  }

  // Unreachable for the declared union, and reachable for a payload that
  // claimed a type nobody implements. Refusing beats applying nothing quietly.
  throw new Error(`Unsupported effect type '${(effect as EventEffect).type}'`);
}
