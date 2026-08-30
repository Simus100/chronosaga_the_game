import type { EventChoice, StateDelta, WorldState } from "@paa/game-types";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { applyEventEffect } from "./event-effect.js";

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

  // The same applicator a delayed consequence uses. An effect must not mean
  // one thing now and another thing three turns from now.
  for (const effect of choice.effects) applyEventEffect(next, effect, changes);

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
