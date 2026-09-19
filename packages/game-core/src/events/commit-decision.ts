import type { EventEffect, StateChange, WorldState } from "@paa/game-types";
import { applyEventEffect, type EffectContext } from "./event-effect.js";

/**
 * The one place a decision advances the Player Turn.
 *
 * GQP-B adds a second resolver, `resolveProofChoice`, beside the M1
 * `resolveChoice`. Two resolvers each incrementing `turn` would be two
 * authorities over the same counter, and the GQP-0 lesson is that two copies
 * of a rule eventually disagree. So both call this: it clones, applies every
 * effect through the shared applicator, and increments the turn exactly once.
 *
 * **Internal on purpose.** It is not exported from the package index. It
 * performs no eligibility, availability or history check, so exposing it would
 * give callers a way to advance a Player Turn without a decision being
 * validated -- the same raw-entry-point problem GQP-0 closed in the gameplay
 * controller.
 *
 * The input world is never touched. Everything happens on the clone, and a
 * throw part-way through leaves the caller holding exactly what it passed in.
 */
export function commitDecision(
  state: WorldState,
  effects: readonly EventEffect[],
  context?: EffectContext
): { state: WorldState; changes: StateChange[] } {
  const next: WorldState = structuredClone(state);
  const changes: StateChange[] = [];

  for (const effect of effects) applyEventEffect(next, effect, changes, context);

  // One significant decision is one Player Turn. The day belongs to the world
  // and advances with the World Tick, so that a decision and the simulation
  // step that follows it cannot both claim to have moved the calendar.
  next.turn += 1;

  return { state: next, changes };
}
