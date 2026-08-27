import type {
  DelayedConsequenceState,
  StateChange,
  StateDelta,
  WorldState
} from "@paa/game-types";
import { applyEventEffect } from "../events/event-effect.js";

function requireSimulation(state: WorldState) {
  if (!state.simulation) throw new Error("Systemic simulation state is required");
  return state.simulation;
}

/**
 * Add a future authoritative consequence without applying it early.
 * The consequence carries its own causal source so later Analysis/debug output
 * can reconstruct why it exists even if it was hidden from the player.
 */
export function scheduleDelayedConsequence(
  state: WorldState,
  consequence: DelayedConsequenceState,
  source = "consequence-engine:schedule"
): { state: WorldState; delta: StateDelta } {
  const simulation = requireSimulation(state);
  if (simulation.delayedConsequences.some(existing => existing.id === consequence.id)) {
    throw new Error(`Delayed consequence '${consequence.id}' already exists`);
  }
  if (consequence.status !== "pending") {
    throw new Error("A newly scheduled delayed consequence must be pending");
  }

  const next = structuredClone(state);
  requireSimulation(next).delayedConsequences.push(structuredClone(consequence));

  return {
    state: next,
    delta: {
      turn: state.turn,
      source,
      changes: [
        {
          type: "delayedConsequenceScheduled",
          key: consequence.id,
          before: undefined,
          after: {
            triggerTurn: consequence.triggerTurn,
            visibility: consequence.visibility,
            causalSource: consequence.source
          }
        }
      ]
    }
  };
}

/**
 * Apply every pending consequence due by `throughTurn`, in stable deterministic
 * order. AI is not consulted and no turn is advanced by this operation.
 */
export function applyDueConsequences(
  state: WorldState,
  throughTurn = state.turn
): { state: WorldState; delta: StateDelta; appliedIds: string[] } {
  if (!Number.isInteger(throughTurn) || throughTurn < 1) {
    throw new Error("throughTurn must be a positive integer");
  }
  requireSimulation(state);

  const next = structuredClone(state);
  const simulation = requireSimulation(next);
  const changes: StateChange[] = [];
  const appliedIds: string[] = [];

  const due = simulation.delayedConsequences
    .filter(consequence => consequence.status === "pending" && consequence.triggerTurn <= throughTurn)
    .sort((a, b) => a.triggerTurn - b.triggerTurn || a.id.localeCompare(b.id));

  for (const consequence of due) {
    for (const effect of consequence.effects) applyEventEffect(next, effect, changes);
    const before = consequence.status;
    consequence.status = "applied";
    appliedIds.push(consequence.id);
    changes.push({
      type: "delayedConsequenceApplied",
      key: consequence.id,
      before,
      after: {
        status: consequence.status,
        triggerTurn: consequence.triggerTurn,
        causalSource: consequence.source
      }
    });
  }

  return {
    state: next,
    delta: {
      turn: state.turn,
      source: "consequence-engine:apply-due",
      changes
    },
    appliedIds
  };
}
