import type { EventEffect, WorldState } from "@paa/game-types";

export interface SystemicValidationResult {
  ok: boolean;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEntityArray(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[]
): JsonRecord[] | null {
  const value = owner[key];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return null;
  }
  const records: JsonRecord[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) errors.push(`${label}[${index}] must be an object`);
    else if (typeof item.id !== "string") errors.push(`${label}[${index}].id must be a string`);
    else records.push(item);
  });
  return records;
}

/**
 * Guard the structural parts that the invariant pass iterates or dereferences.
 * This keeps malformed JSON from turning validation itself into an exception.
 */
function validateShape(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["WorldState must be an object"];

  const party = requireEntityArray(input, "party", "party", errors);
  const simulationValue = input.simulation;
  if (!isRecord(simulationValue)) {
    errors.push("WorldState.simulation is required and must be an object");
    return errors;
  }

  // Untrusted input: a save may arrive without it, or with a string.
  if (!Number.isInteger(simulationValue.tick) || (simulationValue.tick as number) < 0) {
    errors.push("WorldState.simulation.tick must be a non-negative integer");
  }

  const settlements = requireEntityArray(simulationValue, "settlements", "settlements", errors);
  const factions = requireEntityArray(simulationValue, "factions", "factions", errors);
  requireEntityArray(simulationValue, "productionNodes", "productionNodes", errors);
  requireEntityArray(simulationValue, "populationCohorts", "populationCohorts", errors);
  const groups = requireEntityArray(simulationValue, "politicalGroups", "politicalGroups", errors);
  requireEntityArray(simulationValue, "warfareSquads", "warfareSquads", errors);
  const consequences = requireEntityArray(
    simulationValue,
    "delayedConsequences",
    "delayedConsequences",
    errors
  );

  for (const character of party ?? []) {
    if (character.memories !== undefined) {
      if (!Array.isArray(character.memories)) {
        errors.push(`character ${String(character.id)}.memories must be an array`);
      } else {
        character.memories.forEach((memory, index) => {
          if (!isRecord(memory)) {
            errors.push(`character ${String(character.id)} memory[${index}] must be an object`);
            return;
          }
          if (typeof memory.id !== "string") errors.push(`character ${String(character.id)} memory[${index}].id must be a string`);
          if (typeof memory.summary !== "string") errors.push(`character ${String(character.id)} memory[${index}].summary must be a string`);
          if (!isRecord(memory.source) || typeof memory.source.id !== "string") {
            errors.push(`character ${String(character.id)} memory[${index}] requires a causal source id`);
          }
        });
      }
    }
  }

  for (const settlement of settlements ?? []) {
    for (const key of ["productionNodeIds", "cohortIds", "politicalGroupIds"] as const) {
      if (!Array.isArray(settlement[key]) || settlement[key].some(value => typeof value !== "string")) {
        errors.push(`settlement ${String(settlement.id)}.${key} must be a string array`);
      }
    }
  }

  for (const faction of factions ?? []) {
    if (!isRecord(faction.relations)) {
      errors.push(`faction ${String(faction.id)}.relations must be an object`);
    }
  }
  for (const group of groups ?? []) {
    if (!isRecord(group.relationships)) {
      errors.push(`political group ${String(group.id)}.relationships must be an object`);
    }
  }
  for (const consequence of consequences ?? []) {
    if (!isRecord(consequence.source) || typeof consequence.source.id !== "string") {
      errors.push(`consequence ${String(consequence.id)} requires a causal source id`);
    }
    if (!Array.isArray(consequence.effects)) {
      errors.push(`consequence ${String(consequence.id)}.effects must be an array`);
    }
  }

  return errors;
}

function duplicateIds(items: Array<{ id: string }>, label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) {
      errors.push(`${label} contains an empty id`);
      continue;
    }
    if (seen.has(item.id)) errors.push(`${label} contains duplicate id '${item.id}'`);
    seen.add(item.id);
  }
}

function finite(value: number, label: string, errors: string[]): void {
  if (!Number.isFinite(value)) errors.push(`${label} must be finite`);
}

function range(value: number, min: number, max: number, label: string, errors: string[]): void {
  finite(value, label, errors);
  if (Number.isFinite(value) && (value < min || value > max)) {
    errors.push(`${label} must be between ${min} and ${max}`);
  }
}

function validateEffect(effect: EventEffect, characterIds: Set<string>, label: string, errors: string[]): void {
  const allowed = new Set(["RESOURCE_DELTA", "FLAG_SET", "PRESSURE_DELTA", "CHARACTER_STRESS"]);
  if (!allowed.has(effect.type)) {
    errors.push(`${label} has unsupported effect type '${String(effect.type)}'`);
    return;
  }
  if ((effect.type === "RESOURCE_DELTA" || effect.type === "FLAG_SET") && !effect.key?.trim()) {
    errors.push(`${label} ${effect.type} requires key`);
  }
  if (effect.type === "CHARACTER_STRESS") {
    if (!effect.targetId?.trim()) {
      errors.push(`${label} CHARACTER_STRESS requires targetId`);
    } else if (!characterIds.has(effect.targetId)) {
      errors.push(`${label} references unknown character '${effect.targetId}'`);
    }
  }
  if (
    (effect.type === "RESOURCE_DELTA" || effect.type === "PRESSURE_DELTA" || effect.type === "CHARACTER_STRESS") &&
    (typeof effect.value !== "number" || !Number.isFinite(effect.value))
  ) {
    errors.push(`${label} ${effect.type} requires finite numeric value`);
  }
  if (effect.type === "FLAG_SET" && !["string", "number", "boolean"].includes(typeof effect.value)) {
    errors.push(`${label} FLAG_SET requires string, number or boolean value`);
  }
}

/**
 * Runtime validation for the M1 shared-state JSON boundary. `unknown` is
 * intentional: saves and persistence adapters must be validated before they are
 * trusted as a WorldState.
 */
export function validateSystemicWorldState(input: unknown): SystemicValidationResult {
  const shapeErrors = validateShape(input);
  if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };

  const state = input as WorldState;
  const simulation = state.simulation!;
  const errors: string[] = [];

  if (simulation.schemaVersion !== 1) errors.push(`Unsupported simulation schema ${simulation.schemaVersion}`);

  duplicateIds(state.party, "party", errors);
  duplicateIds(simulation.settlements, "settlements", errors);
  duplicateIds(simulation.factions, "factions", errors);
  duplicateIds(simulation.productionNodes, "productionNodes", errors);
  duplicateIds(simulation.populationCohorts, "populationCohorts", errors);
  duplicateIds(simulation.politicalGroups, "politicalGroups", errors);
  duplicateIds(simulation.warfareSquads, "warfareSquads", errors);
  duplicateIds(simulation.delayedConsequences, "delayedConsequences", errors);

  const characterIds = new Set(state.party.map(character => character.id));
  const settlementIds = new Set(simulation.settlements.map(settlement => settlement.id));
  const factionIds = new Set(simulation.factions.map(faction => faction.id));
  const productionIds = new Set(simulation.productionNodes.map(node => node.id));
  const cohortIds = new Set(simulation.populationCohorts.map(cohort => cohort.id));
  const groupIds = new Set(simulation.politicalGroups.map(group => group.id));

  for (const character of state.party) {
    range(character.health, 0, 100, `character ${character.id}.health`, errors);
    range(character.stress, 0, 100, `character ${character.id}.stress`, errors);
    range(character.morale, 0, 100, `character ${character.id}.morale`, errors);
    if (character.factionId && !factionIds.has(character.factionId)) {
      errors.push(`character ${character.id} references unknown faction '${character.factionId}'`);
    }
    if (character.locationId && !settlementIds.has(character.locationId)) {
      errors.push(`character ${character.id} references unknown location '${character.locationId}'`);
    }
    for (const memory of character.memories ?? []) {
      if (!memory.id.trim()) errors.push(`character ${character.id} contains memory with empty id`);
      if (!memory.summary.trim()) errors.push(`memory ${memory.id || "<empty>"} has empty summary`);
      if (!memory.source.id.trim()) errors.push(`memory ${memory.id || "<empty>"} has empty causal source`);
    }
  }

  for (const settlement of simulation.settlements) {
    if (!factionIds.has(settlement.controllingFactionId)) {
      errors.push(`settlement ${settlement.id} references unknown controlling faction '${settlement.controllingFactionId}'`);
    }
    if (!Number.isInteger(settlement.population) || settlement.population < 0) {
      errors.push(`settlement ${settlement.id}.population must be a non-negative integer`);
    }
    range(settlement.stability, 0, 1, `settlement ${settlement.id}.stability`, errors);
    range(settlement.satisfaction, 0, 1, `settlement ${settlement.id}.satisfaction`, errors);
    for (const id of settlement.productionNodeIds) {
      if (!productionIds.has(id)) errors.push(`settlement ${settlement.id} references unknown production node '${id}'`);
    }
    for (const id of settlement.cohortIds) {
      if (!cohortIds.has(id)) errors.push(`settlement ${settlement.id} references unknown cohort '${id}'`);
    }
    for (const id of settlement.politicalGroupIds) {
      if (!groupIds.has(id)) errors.push(`settlement ${settlement.id} references unknown political group '${id}'`);
    }
  }

  for (const faction of simulation.factions) {
    finite(faction.influence, `faction ${faction.id}.influence`, errors);
    finite(faction.reputation, `faction ${faction.id}.reputation`, errors);
    for (const targetId of Object.keys(faction.relations)) {
      if (!factionIds.has(targetId)) errors.push(`faction ${faction.id} relation references unknown faction '${targetId}'`);
    }
  }

  for (const node of simulation.productionNodes) {
    if (!settlementIds.has(node.settlementId)) {
      errors.push(`production node ${node.id} references unknown settlement '${node.settlementId}'`);
    }
    if (node.capacity < 0 || !Number.isFinite(node.capacity)) errors.push(`production node ${node.id}.capacity must be non-negative`);
    if (node.labor < 0 || !Number.isFinite(node.labor)) errors.push(`production node ${node.id}.labor must be non-negative`);
    range(node.efficiency, 0, 1, `production node ${node.id}.efficiency`, errors);
    range(node.condition, 0, 1, `production node ${node.id}.condition`, errors);
  }

  for (const cohort of simulation.populationCohorts) {
    if (!settlementIds.has(cohort.settlementId)) {
      errors.push(`cohort ${cohort.id} references unknown settlement '${cohort.settlementId}'`);
    }
    if (!Number.isInteger(cohort.population) || cohort.population < 0) {
      errors.push(`cohort ${cohort.id}.population must be a non-negative integer`);
    }
    range(cohort.satisfaction, 0, 1, `cohort ${cohort.id}.satisfaction`, errors);
    range(cohort.loyalty, 0, 1, `cohort ${cohort.id}.loyalty`, errors);
    if (!groupIds.has(cohort.politicalAffinity)) {
      errors.push(`cohort ${cohort.id} references unknown political affinity '${cohort.politicalAffinity}'`);
    }
  }

  for (const group of simulation.politicalGroups) {
    if (!settlementIds.has(group.settlementId)) {
      errors.push(`political group ${group.id} references unknown settlement '${group.settlementId}'`);
    }
    range(group.influence, 0, 1, `political group ${group.id}.influence`, errors);
    range(group.approval, 0, 1, `political group ${group.id}.approval`, errors);
    if (group.leaderId && !characterIds.has(group.leaderId)) {
      errors.push(`political group ${group.id} references unknown leader '${group.leaderId}'`);
    }
    for (const targetId of Object.keys(group.relationships)) {
      if (!groupIds.has(targetId)) errors.push(`political group ${group.id} relationship references unknown group '${targetId}'`);
    }
  }

  for (const squad of simulation.warfareSquads) {
    if (!factionIds.has(squad.factionId)) errors.push(`squad ${squad.id} references unknown faction '${squad.factionId}'`);
    if (squad.commanderId && !characterIds.has(squad.commanderId)) {
      errors.push(`squad ${squad.id} references unknown commander '${squad.commanderId}'`);
    }
    if (!Number.isInteger(squad.personnel) || squad.personnel < 0) errors.push(`squad ${squad.id}.personnel must be a non-negative integer`);
    range(squad.morale, 0, 100, `squad ${squad.id}.morale`, errors);
    range(squad.readiness, 0, 100, `squad ${squad.id}.readiness`, errors);
    range(squad.supply, 0, 100, `squad ${squad.id}.supply`, errors);
    range(squad.intelligence, 0, 100, `squad ${squad.id}.intelligence`, errors);
  }

  for (const consequence of simulation.delayedConsequences) {
    if (!Number.isInteger(consequence.triggerTurn) || consequence.triggerTurn < 1) {
      errors.push(`consequence ${consequence.id}.triggerTurn must be a positive integer`);
    }
    if (!consequence.source.id.trim()) errors.push(`consequence ${consequence.id} has empty causal source`);
    if (consequence.effects.length === 0) errors.push(`consequence ${consequence.id} must contain at least one effect`);
    consequence.effects.forEach((effect, index) =>
      validateEffect(effect, characterIds, `consequence ${consequence.id} effect[${index}]`, errors)
    );
  }

  return { ok: errors.length === 0, errors };
}

export function assertSystemicWorldState(input: unknown): asserts input is WorldState {
  const result = validateSystemicWorldState(input);
  if (!result.ok) throw new Error(`Invalid systemic WorldState:\n${result.errors.join("\n")}`);
}
