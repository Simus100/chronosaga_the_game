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
 * The numeric payload of an effect. Required to *be* a finite number, not to
 * be convertible into one.
 *
 * The first version of this helper coerced with `Number()`, and that quietly
 * inverted the property the whole slice exists to establish. `Number("3")` is
 * `3`, `Number(true)` is `1`, `Number(null)` is `0` — all finite, all accepted
 * by the applicator, and all **rejected** by both validators, which require
 * `typeof value === "number"`. Validator stricter than applicator is the same
 * defect as applicator stricter than validator, seen from the other side: the
 * two authorities disagreed about what a valid effect is.
 *
 * Compile-time typing does not help here. This is a hostile runtime boundary:
 * the payload may have come from a save file or an authored catalogue, and
 * `EventEffect["value"]` is `number | string | boolean` by declaration.
 */
function numericValue(effect: EventEffect): number {
  const value = effect.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${effect.type} requires a finite numeric value`);
  }
  return value;
}

/**
 * The flag payload, refused if it is a number the save boundary would later
 * reject.
 *
 * A `NaN` flag compares false against everything including itself, so an event
 * gated on it simply stops appearing and nothing reports why — and the save
 * validator refuses it, which means the world could be played and then not
 * stored. The applicator must never knowingly place a value in `WorldState`
 * that the authoritative save validator will reject.
 */
function flagValue(effect: EventEffect): string | number | boolean {
  const value = effect.value;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`FLAG_SET requires a finite number, got ${String(value)}`);
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("FLAG_SET requires a string, number or boolean value");
  }
  return value;
}

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
    applyAuthoritativeResourceDelta(state, effect.key, numericValue(effect), changes);
    return;
  }

  if (effect.type === "FLAG_SET") {
    if (!effect.key) throw new Error("FLAG_SET requires key");
    const after = flagValue(effect);
    const before = state.flags[effect.key];
    state.flags[effect.key] = after;
    changes.push({ type: "flag", key: effect.key, before, after });
    return;
  }

  if (effect.type === "PRESSURE_DELTA") {
    const before = state.worldPressure;
    const after = Math.max(0, before + numericValue(effect));
    state.worldPressure = after;
    changes.push({ type: "worldPressure", key: "worldPressure", before, after });
    return;
  }

  if (effect.type === "CHARACTER_STRESS") {
    if (!effect.targetId) throw new Error("CHARACTER_STRESS requires targetId");
    const character = state.party.find(candidate => candidate.id === effect.targetId);
    if (!character) throw new Error(`Unknown character '${effect.targetId}'`);
    const before = character.stress;
    const after = Math.max(0, Math.min(100, before + numericValue(effect)));
    character.stress = after;
    changes.push({ type: "characterStress", key: character.id, before, after });
    return;
  }

  // Unreachable for the declared union, and reachable for a payload that
  // claimed a type nobody implements. Refusing beats applying nothing quietly.
  throw new Error(`Unsupported effect type '${(effect as EventEffect).type}'`);
}
