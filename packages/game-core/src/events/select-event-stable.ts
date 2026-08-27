import type { GameEvent, WorldState } from "@paa/game-types";
import { seededUnit } from "../rng/seeded-rng.js";
import { isEventEligible } from "./eligibility.js";

/**
 * Weighted deterministic selection that does not depend on catalogue order.
 *
 * `selectEvent` walks the eligible array in whatever order the caller assembled
 * it and subtracts weights until the cursor is spent. That is deterministic for
 * a fixed array and *not* deterministic across a reordering: moving an event in
 * the catalogue, or changing the order two content modules are spread into one
 * list, changes which event a given seed and turn produce. With four events
 * that is invisible. With a growing catalogue and variants it becomes a replay
 * failure nobody would trace back to an import statement.
 *
 * This path sorts the eligible set by `id` before the same weighted walk, so
 * event identity — not array position — decides the outcome. Everything else is
 * unchanged, including the cursor derivation, so the two paths agree whenever
 * the catalogue happens to be sorted already.
 *
 * `selectEvent` is deliberately left alone: M1's selection sequence is accepted
 * and its regressions expect exactly the sequence it produces today. Sorting
 * its input to fix a hazard the GQP path needs would silently rewrite a
 * validated baseline, which is the more expensive kind of correctness.
 */
export function selectEventStable(events: GameEvent[], state: WorldState): GameEvent {
  const eligible = events
    .filter(event => isEventEligible(event, state))
    // Stable by construction: ids are unique, so the comparison never ties and
    // never depends on the sort implementation's stability guarantees.
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!eligible.length) throw new Error("No eligible events");

  const total = eligible.reduce((sum, event) => sum + Math.max(0.001, event.weight), 0);
  let cursor = seededUnit(state.seed + state.turn * 7919) * total;

  for (const event of eligible) {
    cursor -= Math.max(0.001, event.weight);
    if (cursor <= 0) return event;
  }
  return eligible[eligible.length - 1]!;
}
