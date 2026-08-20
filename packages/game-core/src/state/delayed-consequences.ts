import type {
  DelayedConsequenceState,
  EventEffect,
  StateChange,
  StateDelta,
  WorldState
} from "@paa/game-types";

function requireSimulation(state: WorldState) {
  if (!state.simulation) throw new Error("Systemic simulation state is required");
  return state.simulation;
}

function applyEffect(next: WorldState, effect: EventEffect, changes: StateChange[]): void {
  if (effect.type === "RESOURCE_DELTA") {
    if (!effect.key) throw new Error("RESOURCE_DELTA requires key");
    const before = next.resources[effect.key] ?? 0;
    const after = before + Number(effect.value);
    next.resources[effect.key] = after;
    changes.push({ type: "resource", key: effect.key, before, after });
    return;
  }

  if (effect.type === "FLAG_SET") {
    if (!effect.key) throw new Error("FLAG_SET requires key");
    const before = next.flags[effect.key];
    const after = effect.value;
    next.flags[effect.key] = after;
    changes.push({ type: "flag", key: effect.key, before, after });
    return;
  }

  if (effect.type === "PRESSURE_DELTA") {
    const before = next.worldPressure;
    const after = Math.max(0, before + Number(effect.value));
    next.worldPressure = after;
    changes.push({ type: "worldPressure", key: "worldPressure", before, after });
    return;
  }

  if (effect.type === "CHARACTER_STRESS") {
    if (!effect.targetId) throw new Error("CHARACTER_STRESS requires targetId");
    const character = next.party.find(candidate => candidate.id === effect.targetId);
    if (!character) throw new Error(`Unknown character '${effect.targetId}'`);
    const before = character.stress;
    const after = Math.max(0, Math.min(100, before + Number(effect.value)));
    character.stress = after;
    changes.push({ type: "characterStress", key: character.id, before, after });
  }
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
    for (const effect of consequence.effects) applyEffect(next, effect, changes);
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
