import type {
  CausalSource,
  DelayedConsequenceState,
  ProofEvent,
  ResolvedDecision,
  StateChange,
  StateDelta,
  WorldState
} from "@paa/game-types";
import { commitDecision } from "../events/commit-decision.js";
import { scheduleDelayedConsequence } from "../state/delayed-consequences.js";
import { validateSystemicWorldState } from "../state/validate-systemic-state.js";
import {
  findProofEvent,
  isProofChoiceAvailable,
  isProofEventEligible,
  proofConsequenceId
} from "./proof-events.js";
import { isProofEffectType, validateProofEffectShape } from "./proof-effect-contract.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * Resolve one proof choice: the only writer of resolved-decision history.
 *
 * Why a proof-specific resolver instead of extending `resolveChoice`: the M1
 * resolver has no notion of an event's family, of eligibility over memory and
 * agenda, or of scheduled consequences, and teaching it all three would give
 * every M1 decision a set of responsibilities it can never use. What the two
 * must *not* do is diverge on the parts they share, so they share them:
 *
 *   - effects go through the one applicator, via `commitDecision`;
 *   - the Player Turn is incremented in exactly one place, `commitDecision`;
 *   - consequences are scheduled by the real `scheduleDelayedConsequence`,
 *     not a second scheduler.
 *
 * The resolution is atomic. Every step runs on a clone, and the finished world
 * is validated against the persistence boundary before it is returned. A world
 * that could not be saved is never handed back, and a failure at any step --
 * the last one included -- leaves the caller holding exactly the world it
 * passed in.
 *
 * Due consequences are not applied here. That is the caller's next step, as it
 * is for the M1 controller: one function, one responsibility.
 */
export function resolveProofChoice(
  state: WorldState,
  catalogue: readonly ProofEvent[],
  eventId: string,
  choiceId: string
): { state: WorldState; delta: StateDelta; entry: ResolvedDecision } {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    throw new Error("Proof choices resolve only on a schema-v2 proof world");
  }

  const event = findProofEvent(catalogue, eventId);
  if (!isProofEventEligible(event, state)) {
    throw new Error(`Proof event '${eventId}' is not eligible now`);
  }
  const choice = event.choices.find(item => item.id === choiceId);
  if (!choice) throw new Error(`Proof event '${eventId}' has no choice '${choiceId}'`);
  if (!isProofChoiceAvailable(choice, state)) {
    throw new Error(`Choice '${choiceId}' of '${eventId}' is not available now`);
  }

  // The cause every effect of this decision records, and the key back into
  // the catalogue and the history: `eventId:choiceId`.
  const source: CausalSource = { kind: "choice", id: `${eventId}:${choiceId}`, rule: event.familyId };

  const decided = commitDecision(state, choice.effects, { source, turn: state.turn });
  let next = decided.state;
  const changes: StateChange[] = [...decided.changes];

  for (const planned of choice.schedules ?? []) {
    if (!Number.isInteger(planned.delay) || planned.delay < 1) {
      throw new Error(`Scheduled consequence '${planned.key}' needs a positive whole delay`);
    }
    // Validated before it is stored, not when it fires. A consequence that
    // would be refused three decisions from now is a broken decision now.
    const errors: string[] = [];
    planned.effects.forEach((effect, index) => {
      if (isProofEffectType((effect as { type: unknown }).type)) {
        validateProofEffectShape(effect, `${planned.key} effect[${index}]`, errors);
      }
    });
    if (errors.length > 0) throw new Error(`Refused schedule '${planned.key}': ${errors.join("; ")}`);

    const consequence: DelayedConsequenceState = {
      id: proofConsequenceId(eventId, choiceId, planned.key),
      // `delay` counts subsequent decisions. The decision being made is turn T;
      // the world is at T + 1 once it resolves, so a delay of 1 falls due after
      // the next decision, at T + 2.
      triggerTurn: state.turn + 1 + planned.delay,
      visibility: planned.visibility,
      scope: planned.scope,
      effects: structuredClone(planned.effects),
      reversible: false,
      status: "pending",
      source
    };
    const scheduled = scheduleDelayedConsequence(next, consequence, `proof:${source.id}`);
    next = scheduled.state;
    changes.push(...scheduled.delta.changes);
  }

  // Exactly one entry, for a decision that was actually resolved. Presenting
  // an event, asking whether it is eligible, a quiet beat and a refused choice
  // all write nothing, because none of them reach this line.
  const entry: ResolvedDecision = {
    familyId: event.familyId,
    eventId,
    choiceId,
    // Pre-increment, consistent with `StateDelta.turn` (spec 12.3 rule 3): the
    // turn the decision came from, not the one it produced.
    playerTurn: state.turn,
    // The tick during which the decision happened. A choice does not advance
    // the tick, so there is no before-or-after ambiguity here (rule 4).
    worldTick: simulation.tick
  };
  const history = (next.simulation as typeof simulation).resolvedHistory;
  history.push(entry);
  changes.push({ type: "resolvedDecision", key: `resolvedHistory[${history.length - 1}]`, before: undefined, after: entry });

  // The final gate. The resolved world must be one the persistence boundary
  // accepts, or it is not returned at all.
  const verdict = validateSystemicWorldState(next);
  if (!verdict.ok) {
    throw new Error(`Resolving '${eventId}:${choiceId}' would produce an invalid world: ${verdict.errors.join("; ")}`);
  }

  return { state: next, delta: { turn: state.turn, source: `proof:${source.id}`, changes }, entry };
}
