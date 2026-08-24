import type { EventChoice, StateDelta, WorldState } from "@paa/game-types";
import {
  applyAuthoritativeResourceDelta,
  readAuthoritativeResource
} from "../state/resource-authority.js";

/**
 * Whether the player may take this choice.
 *
 * Requirements read the same authoritative source the effects write. Checking
 * the flat projection while writing the systemic stock would let a choice be
 * permitted by one number and applied to another.
 */
export function canChoose(choice: EventChoice, state: WorldState): boolean {
  const req = choice.requirements;
  if (!req) return true;
  if (req.resources) {
    for (const [key, amount] of Object.entries(req.resources)) {
      if (readAuthoritativeResource(state, key) < amount) return false;
    }
  }
  if (req.flagsAll?.some(flag => !state.flags[flag])) return false;
  if (req.flagsNone?.some(flag => Boolean(state.flags[flag]))) return false;
  return true;
}

export function resolveChoice(
  state: WorldState,
  choice: EventChoice,
  source: string
): { state: WorldState; delta: StateDelta } {
  if (!canChoose(choice, state)) throw new Error("Choice requirements not met");

  const next: WorldState = structuredClone(state);
  const changes: StateDelta["changes"] = [];

  for (const effect of choice.effects) {
    if (effect.type === "RESOURCE_DELTA" && effect.key) {
      applyAuthoritativeResourceDelta(next, effect.key, Number(effect.value), changes);
    }
    if (effect.type === "FLAG_SET" && effect.key) {
      const before = next.flags[effect.key];
      const after = effect.value;
      next.flags[effect.key] = after;
      changes.push({ type: "flag", key: effect.key, before, after });
    }
    if (effect.type === "PRESSURE_DELTA") {
      const before = next.worldPressure;
      const after = Math.max(0, before + Number(effect.value));
      next.worldPressure = after;
      changes.push({ type: "worldPressure", key: "worldPressure", before, after });
    }
    if (effect.type === "CHARACTER_STRESS" && effect.targetId) {
      const character = next.party.find(c => c.id === effect.targetId);
      if (character) {
        const before = character.stress;
        const after = Math.max(0, Math.min(100, before + Number(effect.value)));
        character.stress = after;
        changes.push({ type: "characterStress", key: character.id, before, after });
      }
    }
  }

  // One significant decision is one Player Turn. The day belongs to the world
  // and advances with the World Tick, so that a decision and the simulation
  // step that follows it cannot both claim to have moved the calendar.
  next.turn += 1;

  return {
    state: next,
    delta: {
      turn: state.turn,
      source,
      changes
    }
  };
}
