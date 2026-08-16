import type { GameEvent, WorldState } from "@paa/game-types";
import { seededUnit } from "../rng/seeded-rng";
import { isEventEligible } from "./eligibility";

export function selectEvent(events: GameEvent[], state: WorldState): GameEvent {
  const eligible = events.filter(e => isEventEligible(e, state));
  if (!eligible.length) throw new Error("No eligible events");

  const total = eligible.reduce((sum, event) => sum + Math.max(0.001, event.weight), 0);
  let cursor = seededUnit(state.seed + state.turn * 7919) * total;

  for (const event of eligible) {
    cursor -= Math.max(0.001, event.weight);
    if (cursor <= 0) return event;
  }
  return eligible[eligible.length - 1];
}
