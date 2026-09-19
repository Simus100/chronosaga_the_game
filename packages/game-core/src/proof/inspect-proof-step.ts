import type {
  MemoryBehaviorHook,
  MemoryExposure,
  MemoryOrigin,
  PressureStage,
  ProofEvent,
  ResolvedDecision,
  WorldState
} from "@paa/game-types";
import { agendaConditionHolds } from "./agenda-condition.js";
import { epidemicStage, pressureStage, settlementInfrastructurePressure } from "./pressure.js";
import { eligibleProofEvents, isProofChoiceAvailable } from "./proof-events.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * Read-only inspection of the proof state: what a decision, a delayed
 * consequence or a World Tick changed, in the terms the proof is judged by.
 *
 * Debug and evidence tooling, not authority. It computes nothing the Core does
 * not already own -- stages come from the same derivations, options from the
 * same eligibility -- and it writes nothing. Two inspections of the same pair
 * of worlds are equal, and inspecting a world never changes what it will do.
 *
 * It exists so that a trajectory can be read step by step (GQP-4: "why did
 * this happen") and compared (GQP-B exit 9: "materially different") without
 * each test re-deriving the same readings by hand.
 */

export interface ProofPressureReading {
  readonly value: number;
  readonly stage: PressureStage;
}

export interface ProofMemoryReading {
  readonly characterId: string;
  readonly memoryId: string;
  readonly origin: MemoryOrigin | null;
  readonly exposure: MemoryExposure | null;
  readonly behaviorHook: MemoryBehaviorHook | null;
}

/** The authoritative proof state, as the proof's criteria read it. */
export interface ProofWorldReading {
  readonly playerTurn: number;
  readonly worldTick: number;
  readonly epidemic: ProofPressureReading;
  /** Per settlement, in settlement id order. Derived, never stored. */
  readonly infrastructure: Readonly<Record<string, ProofPressureReading>>;
  readonly nodeCondition: Readonly<Record<string, number>>;
  readonly worldPressure: number;
  /** Per agenda item: whether its typed condition currently holds. */
  readonly agenda: Readonly<Record<string, boolean>>;
  readonly memories: readonly ProofMemoryReading[];
  /** `factionId:tag` for every faction awareness tag. */
  readonly factionAwareness: readonly string[];
  readonly consequences: readonly { readonly id: string; readonly status: string }[];
  readonly history: readonly ResolvedDecision[];
  /** Eligible events now, in the stable eligibility order. */
  readonly eligibleEvents: readonly string[];
  /** `eventId:choiceId` for every option that could be taken now. */
  readonly availableOptions: readonly string[];
}

export interface ProofStepInspection {
  readonly from: { readonly playerTurn: number; readonly worldTick: number };
  readonly to: { readonly playerTurn: number; readonly worldTick: number };
  readonly decisions: readonly ResolvedDecision[];
  readonly epidemic: { readonly before: ProofPressureReading; readonly after: ProofPressureReading };
  readonly infrastructure: Readonly<
    Record<string, { readonly before: ProofPressureReading; readonly after: ProofPressureReading }>
  >;
  readonly newMemories: readonly ProofMemoryReading[];
  readonly newAwareness: readonly string[];
  readonly agendaChanged: readonly { readonly agendaId: string; readonly before: boolean; readonly after: boolean }[];
  readonly consequencesScheduled: readonly string[];
  readonly consequencesApplied: readonly string[];
  /** Options that became available, and that stopped being available for a reason other than being taken. */
  readonly optionsOpened: readonly string[];
  readonly optionsClosed: readonly string[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function reading(value: number): ProofPressureReading {
  return { value, stage: pressureStage(value) };
}

export function readProofWorld(state: WorldState, catalogue: readonly ProofEvent[]): ProofWorldReading {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    throw new Error("Proof state is read only from a schema-v2 proof world");
  }

  const infrastructure: Record<string, ProofPressureReading> = {};
  for (const id of simulation.settlements.map(item => item.id).sort(byCodeUnit)) {
    infrastructure[id] = reading(settlementInfrastructurePressure(state, id));
  }
  const nodeCondition: Record<string, number> = {};
  for (const node of [...simulation.productionNodes].sort((a, b) => byCodeUnit(a.id, b.id))) {
    nodeCondition[node.id] = node.condition;
  }
  const agenda: Record<string, boolean> = {};
  for (const item of [...simulation.factionAgenda].sort((a, b) => byCodeUnit(a.id, b.id))) {
    agenda[item.id] = agendaConditionHolds(item.condition, state);
  }

  const memories: ProofMemoryReading[] = [];
  for (const character of [...state.party].sort((a, b) => byCodeUnit(a.id, b.id))) {
    for (const memory of character.memories ?? []) {
      memories.push({
        characterId: character.id,
        memoryId: memory.id,
        origin: memory.origin ?? null,
        exposure: memory.exposure ?? null,
        behaviorHook: memory.behaviorHook ?? null
      });
    }
  }

  const factionAwareness = simulation.factions
    .flatMap(faction => faction.memoryTags.filter(tag => tag.startsWith("aware:")).map(tag => `${faction.id}:${tag}`))
    .sort(byCodeUnit);

  const eligible = eligibleProofEvents(state, catalogue);
  const availableOptions = eligible.flatMap(event =>
    event.choices.filter(choice => isProofChoiceAvailable(choice, state)).map(choice => `${event.id}:${choice.id}`)
  );

  return {
    playerTurn: state.turn,
    worldTick: simulation.tick,
    epidemic: { value: simulation.epidemic.value, stage: epidemicStage(simulation.epidemic) },
    infrastructure,
    nodeCondition,
    worldPressure: state.worldPressure,
    agenda,
    memories,
    factionAwareness,
    consequences: simulation.delayedConsequences
      .map(item => ({ id: item.id, status: item.status }))
      .sort((a, b) => byCodeUnit(a.id, b.id)),
    history: simulation.resolvedHistory.map(entry => ({ ...entry })),
    eligibleEvents: eligible.map(event => event.id),
    availableOptions
  };
}

const memoryKey = (memory: ProofMemoryReading) => `${memory.characterId}:${memory.memoryId}`;

/** What changed between two proof worlds, in the proof's own terms. */
export function inspectProofStep(
  before: WorldState,
  after: WorldState,
  catalogue: readonly ProofEvent[]
): ProofStepInspection {
  const a = readProofWorld(before, catalogue);
  const b = readProofWorld(after, catalogue);

  const decisions = b.history.slice(a.history.length);
  const resolvedNow = new Set(decisions.map(entry => entry.eventId));

  const known = new Set(a.memories.map(memoryKey));
  const aware = new Set(a.factionAwareness);
  const statusBefore = new Map(a.consequences.map(item => [item.id, item.status]));
  const optionsBefore = new Set(a.availableOptions);
  const optionsAfter = new Set(b.availableOptions);

  const infrastructure: Record<string, { before: ProofPressureReading; after: ProofPressureReading }> = {};
  for (const id of Object.keys(b.infrastructure)) {
    infrastructure[id] = { before: a.infrastructure[id] ?? b.infrastructure[id]!, after: b.infrastructure[id]! };
  }

  return {
    from: { playerTurn: a.playerTurn, worldTick: a.worldTick },
    to: { playerTurn: b.playerTurn, worldTick: b.worldTick },
    decisions,
    epidemic: { before: a.epidemic, after: b.epidemic },
    infrastructure,
    newMemories: b.memories.filter(memory => !known.has(memoryKey(memory))),
    newAwareness: b.factionAwareness.filter(tag => !aware.has(tag)),
    agendaChanged: Object.keys(b.agenda)
      .filter(id => a.agenda[id] !== b.agenda[id])
      .map(id => ({ agendaId: id, before: a.agenda[id] === true, after: b.agenda[id] === true })),
    consequencesScheduled: b.consequences.filter(item => !statusBefore.has(item.id)).map(item => item.id),
    consequencesApplied: b.consequences
      .filter(item => item.status === "applied" && statusBefore.get(item.id) !== "applied")
      .map(item => item.id),
    optionsOpened: b.availableOptions.filter(option => !optionsBefore.has(option)),
    optionsClosed: a.availableOptions.filter(
      option => !optionsAfter.has(option) && !resolvedNow.has(option.slice(0, option.indexOf(":")))
    )
  };
}
