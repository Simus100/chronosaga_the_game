import type {
  CharacterMemory,
  PopulationCohortState,
  ResourceMap,
  StateChange,
  StateDelta,
  WorldState
} from "@paa/game-types";
import { projectResource, resolveSettlementTarget } from "./resource-authority.js";

const CONSUMPTION_PER_1000: Readonly<ResourceMap> = {
  water: 4,
  food: 3,
  energy: 2,
  medicine: 0.3
};

const RESERVE_TARGET_PER_1000: Readonly<ResourceMap> = {
  water: 10,
  food: 8,
  energy: 5,
  medicine: 2
};

const SHORTAGE_REACTION_THRESHOLD = 0.2;

export interface ProductionTrace {
  nodeId: string;
  operatingFactor: number;
  inputsConsumed: ResourceMap;
  outputsProduced: ResourceMap;
}

export interface CohortReactionTrace {
  cohortId: string;
  shortageExposure: number;
  satisfactionDelta: number;
  loyaltyDelta: number;
}

export interface PoliticalReactionTrace {
  groupId: string;
  approvalDelta: number;
}

export interface WorldTickTrace {
  /** The world simulation tick this trace describes. */
  tick: number;
  /** The Player Turn the tick happened during. It is not advanced by a tick. */
  playerTurn: number;
  production: ProductionTrace[];
  consumption: ResourceMap;
  shortageSeverity: ResourceMap;
  cohortReactions: CohortReactionTrace[];
  politicalReactions: PoliticalReactionTrace[];
  factionReaction: boolean;
}

export interface WorldTickResult {
  state: WorldState;
  delta: StateDelta;
  trace: WorldTickTrace;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function setNumber(
  target: Record<string, number>,
  key: string,
  value: number,
  changes: StateChange[],
  changeType: string,
  changeKey: string
): void {
  const before = target[key] ?? 0;
  const after = rounded(Math.max(0, value));
  if (before === after) return;
  target[key] = after;
  changes.push({ type: changeType, key: changeKey, before, after });
}

function weightedSettlementSatisfaction(cohorts: PopulationCohortState[]): number {
  const population = cohorts.reduce((sum, cohort) => sum + cohort.population, 0);
  if (population <= 0) return 0.5;
  return rounded(
    cohorts.reduce((sum, cohort) => sum + cohort.satisfaction * cohort.population, 0) /
      population
  );
}

function runProduction(
  state: WorldState,
  changes: StateChange[]
): ProductionTrace[] {
  const simulation = state.simulation!;
  const traces: ProductionTrace[] = [];

  for (const node of simulation.productionNodes) {
    if (!node.enabled) continue;
    const settlement = simulation.settlements.find(item => item.id === node.settlementId);
    if (!settlement) continue;

    const totalNominalOutput = Object.values(node.outputs).reduce((sum, value) => sum + value, 0);
    const capacityFactor =
      totalNominalOutput > 0 ? Math.min(1, node.capacity / totalNominalOutput) : 1;
    const technicalFactor = clamp(node.efficiency * node.condition * capacityFactor);

    let inputLimit = 1;
    for (const [resource, nominalAmount] of Object.entries(node.inputs)) {
      if (nominalAmount <= 0 || technicalFactor <= 0) continue;
      const requiredAtTechnicalRate = nominalAmount * technicalFactor;
      const available = Math.max(0, settlement.resourceStock[resource] ?? 0);
      inputLimit = Math.min(inputLimit, available / requiredAtTechnicalRate);
    }

    const operatingFactor = rounded(clamp(technicalFactor * clamp(inputLimit)));
    const inputsConsumed: ResourceMap = {};
    const outputsProduced: ResourceMap = {};

    for (const [resource, nominalAmount] of Object.entries(node.inputs)) {
      const amount = rounded(nominalAmount * operatingFactor);
      if (amount <= 0) continue;
      const before = settlement.resourceStock[resource] ?? 0;
      setNumber(
        settlement.resourceStock,
        resource,
        before - amount,
        changes,
        "productionInput",
        `${settlement.id}.resourceStock.${resource}`
      );
      inputsConsumed[resource] = amount;
    }

    for (const [resource, nominalAmount] of Object.entries(node.outputs)) {
      const amount = rounded(nominalAmount * operatingFactor);
      if (amount <= 0) continue;
      const before = settlement.resourceStock[resource] ?? 0;
      setNumber(
        settlement.resourceStock,
        resource,
        before + amount,
        changes,
        "productionOutput",
        `${settlement.id}.resourceStock.${resource}`
      );
      outputsProduced[resource] = amount;
    }

    traces.push({
      nodeId: node.id,
      operatingFactor,
      inputsConsumed,
      outputsProduced
    });
  }

  return traces;
}

function consumePopulationResources(
  state: WorldState,
  changes: StateChange[]
): ResourceMap {
  const consumption: ResourceMap = {};
  const simulation = state.simulation!;

  for (const settlement of simulation.settlements) {
    const populationScale = settlement.population / 1000;
    for (const [resource, per1000] of Object.entries(CONSUMPTION_PER_1000)) {
      const demand = rounded(per1000 * populationScale);
      const before = Math.max(0, settlement.resourceStock[resource] ?? 0);
      const consumed = rounded(Math.min(before, demand));
      if (consumed <= 0) continue;

      setNumber(
        settlement.resourceStock,
        resource,
        before - consumed,
        changes,
        "populationConsumption",
        `${settlement.id}.resourceStock.${resource}`
      );
      consumption[`${settlement.id}:${resource}`] = consumed;
    }
  }

  return consumption;
}

function calculateShortageSeverity(state: WorldState): ResourceMap {
  const simulation = state.simulation!;
  const severity: ResourceMap = {};

  for (const settlement of simulation.settlements) {
    const populationScale = settlement.population / 1000;
    for (const [resource, reservePer1000] of Object.entries(RESERVE_TARGET_PER_1000)) {
      const target = reservePer1000 * populationScale;
      const stock = Math.max(0, settlement.resourceStock[resource] ?? 0);
      const shortfall = target <= 0 ? 0 : clamp((target - stock) / target);
      severity[`${settlement.id}:${resource}`] = rounded(shortfall);
    }
  }

  return severity;
}

function cohortExposure(
  cohort: PopulationCohortState,
  shortageSeverity: ResourceMap
): number {
  let weightedShortage = 0;
  let relevantNeed = 0;

  for (const [resource, needWeight] of Object.entries(cohort.needs)) {
    const shortage = shortageSeverity[`${cohort.settlementId}:${resource}`];
    if (shortage === undefined) continue;
    relevantNeed += Math.max(0, needWeight);
    weightedShortage += Math.max(0, needWeight) * shortage;
  }

  return relevantNeed > 0 ? rounded(clamp(weightedShortage / relevantNeed)) : 0;
}

function reactCohorts(
  state: WorldState,
  shortageSeverity: ResourceMap,
  changes: StateChange[]
): CohortReactionTrace[] {
  const simulation = state.simulation!;
  const reactions: CohortReactionTrace[] = [];

  for (const cohort of simulation.populationCohorts) {
    const exposure = cohortExposure(cohort, shortageSeverity);
    const satisfactionDelta = rounded(-0.08 * exposure);
    const loyaltyDelta = rounded(satisfactionDelta * 0.35);

    const satisfactionBefore = cohort.satisfaction;
    cohort.satisfaction = rounded(clamp(cohort.satisfaction + satisfactionDelta));
    if (cohort.satisfaction !== satisfactionBefore) {
      changes.push({
        type: "cohortSatisfaction",
        key: `${cohort.id}.satisfaction`,
        before: satisfactionBefore,
        after: cohort.satisfaction
      });
    }

    const loyaltyBefore = cohort.loyalty;
    cohort.loyalty = rounded(clamp(cohort.loyalty + loyaltyDelta));
    if (cohort.loyalty !== loyaltyBefore) {
      changes.push({
        type: "cohortLoyalty",
        key: `${cohort.id}.loyalty`,
        before: loyaltyBefore,
        after: cohort.loyalty
      });
    }

    reactions.push({
      cohortId: cohort.id,
      shortageExposure: exposure,
      satisfactionDelta: rounded(cohort.satisfaction - satisfactionBefore),
      loyaltyDelta: rounded(cohort.loyalty - loyaltyBefore)
    });
  }

  for (const settlement of simulation.settlements) {
    const cohorts = simulation.populationCohorts.filter(
      cohort => cohort.settlementId === settlement.id
    );
    const beforeSatisfaction = settlement.satisfaction;
    const afterSatisfaction = weightedSettlementSatisfaction(cohorts);
    settlement.satisfaction = afterSatisfaction;
    if (beforeSatisfaction !== afterSatisfaction) {
      changes.push({
        type: "settlementSatisfaction",
        key: `${settlement.id}.satisfaction`,
        before: beforeSatisfaction,
        after: afterSatisfaction
      });
    }

    const maxShortage = Math.max(
      0,
      ...Object.entries(shortageSeverity)
        .filter(([key]) => key.startsWith(`${settlement.id}:`))
        .map(([, value]) => value)
    );
    const beforeStability = settlement.stability;
    settlement.stability = rounded(clamp(settlement.stability - maxShortage * 0.03));
    if (beforeStability !== settlement.stability) {
      changes.push({
        type: "settlementStability",
        key: `${settlement.id}.stability`,
        before: beforeStability,
        after: settlement.stability
      });
    }
  }

  return reactions;
}

function reactPoliticalGroups(
  state: WorldState,
  cohortReactions: CohortReactionTrace[],
  changes: StateChange[]
): PoliticalReactionTrace[] {
  const simulation = state.simulation!;
  const result: PoliticalReactionTrace[] = [];

  for (const group of simulation.politicalGroups) {
    const affiliated = simulation.populationCohorts.filter(
      cohort => cohort.politicalAffinity === group.id
    );
    const totalPopulation = affiliated.reduce((sum, cohort) => sum + cohort.population, 0);
    const weightedDelta =
      totalPopulation > 0
        ? affiliated.reduce((sum, cohort) => {
            const reaction = cohortReactions.find(item => item.cohortId === cohort.id);
            return sum + (reaction?.satisfactionDelta ?? 0) * cohort.population;
          }, 0) / totalPopulation
        : 0;
    const approvalDelta = rounded(weightedDelta * 0.8);
    const before = group.approval;
    group.approval = rounded(clamp(group.approval + approvalDelta));

    if (before !== group.approval) {
      changes.push({
        type: "politicalApproval",
        key: `${group.id}.approval`,
        before,
        after: group.approval
      });
    }
    result.push({ groupId: group.id, approvalDelta: rounded(group.approval - before) });
  }

  return result;
}

/**
 * Record that the quartermaster lived through a water shortage.
 *
 * Two different clocks meet here, and calling either of them `turn` is how they
 * got confused. A memory happened during a Player Turn — that is when the
 * character experienced it — but it was *caused* by a specific World Tick, and
 * several ticks may run inside one Player Turn. So the memory carries the Player
 * Turn, its causal source carries the tick, and the id is keyed by the tick
 * because that is what makes it unique.
 */
function addShortageMemory(
  state: WorldState,
  settlementId: string,
  tick: number,
  playerTurn: number,
  changes: StateChange[]
): void {
  const settlement = state.simulation?.settlements.find(item => item.id === settlementId);
  const character = state.party.find(
    item => item.locationId === settlementId && item.role === "Quartermaster"
  );
  if (!character) return;

  // Keyed by tick, not by Player Turn: three ticks in one turn are three
  // distinct experiences and must not collide into one memory.
  const memoryId = `mem_world_tick_${tick}_water_shortage`;
  if (character.memories?.some(memory => memory.id === memoryId)) return;

  const memory: CharacterMemory = {
    id: memoryId,
    summary: `${settlement?.name ?? settlementId} ended the world tick below its target water reserve.`,
    tags: ["water", "shortage", "world_tick"],
    turn: playerTurn,
    source: {
      kind: "world_tick",
      id: `world_tick_${tick}`,
      tick,
      rule: "resource_shortage"
    }
  };
  const before = character.memories?.length ?? 0;
  character.memories = [...(character.memories ?? []), memory];
  if (!character.memoryTags.includes("water_shortage_experienced")) {
    character.memoryTags = [...character.memoryTags, "water_shortage_experienced"];
  }
  changes.push({
    type: "characterMemory",
    key: `${character.id}.memories`,
    before,
    after: character.memories.length
  });
}

function reactFactionAndFlags(
  state: WorldState,
  shortageSeverity: ResourceMap,
  tick: number,
  playerTurn: number,
  changes: StateChange[]
): boolean {
  const simulation = state.simulation!;
  let reacted = false;

  for (const settlement of simulation.settlements) {
    const entries = Object.entries(shortageSeverity).filter(([key]) =>
      key.startsWith(`${settlement.id}:`)
    );
    const maxShortage = Math.max(0, ...entries.map(([, value]) => value));
    const waterShortage = shortageSeverity[`${settlement.id}:water`] ?? 0;
    const pressureActive = maxShortage >= SHORTAGE_REACTION_THRESHOLD;

    const waterFlag = `${settlement.id}_water_shortage_active`;
    const previousWaterFlag = state.flags[waterFlag];
    const waterActive = waterShortage >= SHORTAGE_REACTION_THRESHOLD;
    state.flags[waterFlag] = waterActive;
    if (previousWaterFlag !== waterActive) {
      changes.push({
        type: "flag",
        key: waterFlag,
        before: previousWaterFlag,
        after: waterActive
      });
    }

    const faction = simulation.factions.find(item => item.id === settlement.controllingFactionId);
    if (faction) {
      const reactionFlag = `${faction.id}_resource_pressure`;
      const previousReactionFlag = state.flags[reactionFlag];
      state.flags[reactionFlag] = pressureActive;
      if (previousReactionFlag !== pressureActive) {
        changes.push({
          type: "factionReactionFlag",
          key: reactionFlag,
          before: previousReactionFlag,
          after: pressureActive
        });
      }
    }

    if (!pressureActive) continue;
    reacted = true;
    if (!faction) continue;

    const tag = `resource_pressure:${settlement.id}`;
    if (!faction.memoryTags.includes(tag)) {
      const before = [...faction.memoryTags];
      faction.memoryTags = [...faction.memoryTags, tag];
      changes.push({
        type: "factionMemory",
        key: `${faction.id}.memoryTags`,
        before,
        after: [...faction.memoryTags]
      });
    }

    if (waterActive && previousWaterFlag !== true) {
      addShortageMemory(state, settlement.id, tick, playerTurn, changes);
    }
  }

  return reacted;
}

function mirrorPrimarySettlementResources(state: WorldState, changes: StateChange[]): void {
  const target = resolveSettlementTarget(state);
  if (target.kind !== "settlement") return;
  const settlement = target.settlement;

  // Transitional compatibility for the existing P0 event/resource surface:
  // the first systemic settlement is the local campaign settlement, so its
  // resource stock is mirrored into WorldState.resources until the old flat
  // resource map is fully migrated. The simulation stock is authoritative for
  // this tick; the mirror prevents two visible truths from drifting apart.
  for (const [resource, value] of Object.entries(settlement.resourceStock)) {
    projectResource(state.resources, resource, value, changes);
  }
}

/**
 * Execute one useful deterministic M1-B world tick.
 *
 * Order is intentionally fixed and authoritative:
 * production -> population consumption -> shortage -> cohorts -> politics ->
 * faction/memory reaction -> compatibility mirror -> tick/day advance.
 *
 * `WorldState.turn` is never advanced here: it is the Player Turn.
 *
 * No AI participates and the input object is never mutated.
 */
export function runWorldTick(input: WorldState): WorldTickResult {
  if (!input.simulation) {
    throw new Error("runWorldTick requires WorldState.simulation");
  }

  const state = structuredClone(input);
  // Proven present by the guard above; named once so the tick bookkeeping below
  // does not have to re-assert it at every use.
  const simulation = state.simulation!;
  const changes: StateChange[] = [];
  // The tick this run produces. Separate from `state.turn`, which is the Player
  // Turn and belongs to the player's decision, not to the simulation.
  const nextTick = simulation.tick + 1;

  const production = runProduction(state, changes);
  const consumption = consumePopulationResources(state, changes);
  const shortageSeverity = calculateShortageSeverity(state);
  const cohortReactions = reactCohorts(state, shortageSeverity, changes);
  const politicalReactions = reactPoliticalGroups(state, cohortReactions, changes);
  const factionReaction = reactFactionAndFlags(
    state,
    shortageSeverity,
    nextTick,
    state.turn,
    changes
  );
  mirrorPrimarySettlementResources(state, changes);

  // The Player Turn is deliberately untouched. A tick advances the world; only
  // a decision advances the player.
  const tickBefore = simulation.tick;
  simulation.tick = nextTick;
  changes.push({ type: "tick", key: "simulation.tick", before: tickBefore, after: nextTick });

  const dayBefore = state.day;
  state.day += 1;
  changes.push({ type: "day", key: "day", before: dayBefore, after: state.day });

  return {
    state,
    delta: {
      turn: state.turn,
      source: `world_tick:${nextTick}`,
      changes
    },
    trace: {
      tick: nextTick,
      playerTurn: state.turn,
      production,
      consumption,
      shortageSeverity,
      cohortReactions,
      politicalReactions,
      factionReaction
    }
  };
}
