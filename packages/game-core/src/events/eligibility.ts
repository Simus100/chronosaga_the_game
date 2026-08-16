import type { GameEvent, WorldState } from "@paa/game-types";

export function isEventEligible(event: GameEvent, state: WorldState): boolean {
  const req = event.requirements;
  if (!req) return true;
  if (req.minTurn !== undefined && state.turn < req.minTurn) return false;
  if (req.maxPressure !== undefined && state.worldPressure > req.maxPressure) return false;
  if (req.flagsAll?.some(flag => !state.flags[flag])) return false;
  if (req.flagsNone?.some(flag => Boolean(state.flags[flag]))) return false;
  return true;
}
