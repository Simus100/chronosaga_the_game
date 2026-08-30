import type { EventEffect, WorldState } from "@paa/game-types";
import { EVENT_EFFECT_TYPES } from "../events/event-effect.js";
import {
  PROOF_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isSupportedSchemaVersion
} from "../proof/schema-version.js";
import { refuseProofFieldsOnBaseline, validateProofState } from "../proof/validate-proof-state.js";

export interface SystemicValidationResult {
  ok: boolean;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string, and not the empty one when `nonEmpty`. */
function requireString(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[],
  nonEmpty = true
): void {
  const value = owner[key];
  if (typeof value !== "string") {
    errors.push(`${label} must be a string, got ${typeof value}`);
    return;
  }
  if (nonEmpty && value.trim() === "") errors.push(`${label} must not be empty`);
}

/** An optional string: absent is fine, present and wrong is not. */
function requireOptionalString(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[]
): void {
  if (owner[key] === undefined) return;
  requireString(owner, key, label, errors);
}

/** A finite number. Rules out NaN, both infinities, strings and null alike. */
function requireFiniteNumber(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[],
  min?: number
): void {
  const value = owner[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(
      `${label} must be a finite number, got ${
        typeof value === "number" ? String(value) : typeof value
      }`
    );
    return;
  }
  if (min !== undefined && value < min) errors.push(`${label} must be at least ${min}, got ${value}`);
}

/** A whole number, optionally with a floor. */
function requireInteger(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[],
  min?: number
): void {
  const value = owner[key];
  if (!Number.isInteger(value)) {
    errors.push(
      `${label} must be an integer, got ${
        typeof value === "number" ? String(value) : typeof value
      }`
    );
    return;
  }
  if (min !== undefined && (value as number) < min) {
    errors.push(`${label} must be at least ${min}, got ${String(value)}`);
  }
}

/** A real boolean, not "true" and not 1. */
function requireBoolean(owner: JsonRecord, key: string, label: string, errors: string[]): void {
  if (typeof owner[key] !== "boolean") {
    errors.push(`${label} must be a boolean, got ${typeof owner[key]}`);
  }
}

/** An array of strings, which several systemic fields are. */
function requireStringArray(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[]
): void {
  const value = owner[key];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") errors.push(`${label}[${index}] must be a string`);
  });
}

/** One of a closed set. Enums are contracts, and a save may claim anything. */
function requireEnum(
  owner: JsonRecord,
  key: string,
  label: string,
  allowed: readonly string[],
  errors: string[]
): void {
  const value = owner[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
}

const CAUSAL_KINDS = ["choice", "event", "world_tick", "tactical", "warfare", "system"] as const;

/**
 * A causal source, fully.
 *
 * This is how the game explains itself: why a memory exists, why a consequence
 * fired. A half-checked source produces evidence that looks authoritative and
 * cannot be traced, which is worse than no evidence at all.
 */
function requireCausalSource(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireEnum(value, "kind", `${label}.kind`, CAUSAL_KINDS, errors);
  requireString(value, "id", `${label}.id`, errors);
  requireOptionalString(value, "actorId", `${label}.actorId`, errors);
  requireOptionalString(value, "rule", `${label}.rule`, errors);
  if (value.tick !== undefined) requireInteger(value, "tick", `${label}.tick`, errors, 0);
}

/**
 * `WorldState.flags` carries strings, booleans and numbers, and nothing else.
 *
 * A flag reaches gameplay through event eligibility, so an object or an array
 * here becomes a truthy value that silently unlocks or blocks content.
 */
function requireFlags(owner: JsonRecord, label: string, errors: string[]): void {
  const value = owner.flags;
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const [flag, entry] of Object.entries(value)) {
    const kind = typeof entry;
    if (kind === "string" || kind === "boolean") continue;
    if (kind === "number" && Number.isFinite(entry)) continue;
    errors.push(
      `${label}.${flag} must be a string, boolean or finite number, got ${
        kind === "number" ? String(entry) : kind
      }`
    );
  }
}

/**
 * Every value in a numeric map must be a finite number.
 *
 * These maps arrive from SQLite as untrusted JSON, and every one of them is
 * arithmetic input: a stock is subtracted from, a need is divided by, a relation
 * is compared. A string where a number belongs turns `14 - 5` into `"145"`; a
 * `null` becomes `0` under coercion and looks like a legitimate empty stock;
 * `NaN` propagates through every later sum and never compares unequal to
 * itself, so a shortage check silently stops firing.
 *
 * `JSON.stringify` cannot emit `NaN` or `Infinity` — it writes `null` — but a
 * save does not have to come from `JSON.stringify`. A hand-edited file, a
 * different writer or a future transport can carry them, and a validator that
 * assumed otherwise would be trusting the shape of the attack it expects.
 */
function requireFiniteNumberMap(
  owner: JsonRecord,
  key: string,
  label: string,
  errors: string[]
): void {
  const value = owner[key];
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const [entry, amount] of Object.entries(value)) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      errors.push(
        `${label}.${entry} must be a finite number, got ${
          typeof amount === "number" ? String(amount) : typeof amount
        }`
      );
    }
  }
}

/**
 * The campaign profile, five closed vocabularies.
 *
 * These select rules — mortality decides whether a character can die — so an
 * unknown value is not a cosmetic problem: it falls through every comparison
 * and lands on whatever the default branch happens to be.
 */
function requireCampaignProfile(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireEnum(value, "difficulty", `${label}.difficulty`, ["narrative", "standard", "hard", "simulation"], errors);
  requireEnum(value, "mortality", `${label}.mortality`, ["protected", "standard", "permadeath"], errors);
  requireEnum(value, "campaignLength", `${label}.campaignLength`, ["standard", "extended", "persistent"], errors);
  requireEnum(value, "aiMode", `${label}.aiMode`, ["local", "cloud", "auto", "procedural"], errors);
  requireEnum(value, "simulationDepth", `${label}.simulationDepth`, ["light", "standard", "deep"], errors);
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

  // Top level. Every one of these reaches gameplay: `turn` and `day` are shown
  // and compared, `seed` drives the deterministic RNG, `worldPressure` gates
  // event eligibility, and `campaignId` decides which save is whose.
  requireString(input, "campaignId", "WorldState.campaignId", errors);
  requireFiniteNumber(input, "seed", "WorldState.seed", errors);
  requireInteger(input, "turn", "WorldState.turn", errors, 1);
  requireInteger(input, "day", "WorldState.day", errors, 1);
  requireFiniteNumber(input, "worldPressure", "WorldState.worldPressure", errors, 0);
  requireFlags(input, "WorldState.flags", errors);
  requireFiniteNumberMap(input, "resources", "WorldState.resources", errors);
  requireCampaignProfile(input.profile, "WorldState.profile", errors);

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
  const nodes = requireEntityArray(simulationValue, "productionNodes", "productionNodes", errors);
  const cohorts = requireEntityArray(
    simulationValue,
    "populationCohorts",
    "populationCohorts",
    errors
  );
  const groups = requireEntityArray(simulationValue, "politicalGroups", "politicalGroups", errors);
  const squads = requireEntityArray(simulationValue, "warfareSquads", "warfareSquads", errors);
  const consequences = requireEntityArray(
    simulationValue,
    "delayedConsequences",
    "delayedConsequences",
    errors
  );

  for (const character of party ?? []) {
    const who = `character ${String(character.id)}`;
    requireString(character, "name", `${who}.name`, errors);
    requireString(character, "role", `${who}.role`, errors);
    requireFiniteNumber(character, "health", `${who}.health`, errors);
    requireFiniteNumber(character, "stress", `${who}.stress`, errors);
    requireFiniteNumber(character, "morale", `${who}.morale`, errors);
    requireStringArray(character, "traits", `${who}.traits`, errors);
    requireStringArray(character, "memoryTags", `${who}.memoryTags`, errors);
    requireOptionalString(character, "factionId", `${who}.factionId`, errors);
    requireOptionalString(character, "locationId", `${who}.locationId`, errors);

    if (character.memories !== undefined) {
      if (!Array.isArray(character.memories)) {
        errors.push(`${who}.memories must be an array`);
      } else {
        character.memories.forEach((memory, index) => {
          const at = `${who} memory[${index}]`;
          if (!isRecord(memory)) {
            errors.push(`${at} must be an object`);
            return;
          }
          requireString(memory, "id", `${at}.id`, errors);
          requireString(memory, "summary", `${at}.summary`, errors, false);
          requireStringArray(memory, "tags", `${at}.tags`, errors);
          requireInteger(memory, "turn", `${at}.turn`, errors, 1);
          requireCausalSource(memory.source, `${at}.source`, errors);
        });
      }
    }
  }

  for (const settlement of settlements ?? []) {
    const where = `settlement ${String(settlement.id)}`;
    requireString(settlement, "name", `${where}.name`, errors);
    requireString(settlement, "controllingFactionId", `${where}.controllingFactionId`, errors);
    requireFiniteNumber(settlement, "population", `${where}.population`, errors, 0);
    requireFiniteNumber(settlement, "stability", `${where}.stability`, errors);
    requireFiniteNumber(settlement, "satisfaction", `${where}.satisfaction`, errors);
    requireFiniteNumberMap(settlement, "resourceStock", `${where}.resourceStock`, errors);
    for (const key of ["productionNodeIds", "cohortIds", "politicalGroupIds"] as const) {
      requireStringArray(settlement, key, `${where}.${key}`, errors);
    }
  }

  for (const faction of factions ?? []) {
    const label = `faction ${String(faction.id)}`;
    requireString(faction, "name", `${label}.name`, errors);
    requireFiniteNumber(faction, "influence", `${label}.influence`, errors);
    requireFiniteNumber(faction, "reputation", `${label}.reputation`, errors);
    requireStringArray(faction, "memoryTags", `${label}.memoryTags`, errors);
    requireFiniteNumberMap(faction, "relations", `${label}.relations`, errors);
    requireFiniteNumberMap(faction, "resources", `${label}.resources`, errors);
  }

  for (const group of groups ?? []) {
    const label = `political group ${String(group.id)}`;
    requireString(group, "settlementId", `${label}.settlementId`, errors);
    requireString(group, "name", `${label}.name`, errors);
    requireFiniteNumber(group, "influence", `${label}.influence`, errors);
    requireFiniteNumber(group, "approval", `${label}.approval`, errors);
    // A scalar, not a map: `PoliticalGroupState.resources` is a single number
    // and was slipping through the map check that guards every other one.
    requireFiniteNumber(group, "resources", `${label}.resources`, errors);
    requireStringArray(group, "goals", `${label}.goals`, errors);
    requireStringArray(group, "redLines", `${label}.redLines`, errors);
    requireOptionalString(group, "leaderId", `${label}.leaderId`, errors);
    requireFiniteNumberMap(group, "relationships", `${label}.relationships`, errors);
  }

  for (const node of nodes ?? []) {
    const label = `production node ${String(node.id)}`;
    requireString(node, "settlementId", `${label}.settlementId`, errors);
    requireString(node, "recipe", `${label}.recipe`, errors);
    requireFiniteNumber(node, "capacity", `${label}.capacity`, errors, 0);
    requireFiniteNumber(node, "efficiency", `${label}.efficiency`, errors, 0);
    requireFiniteNumber(node, "labor", `${label}.labor`, errors, 0);
    requireFiniteNumber(node, "condition", `${label}.condition`, errors, 0);
    requireBoolean(node, "enabled", `${label}.enabled`, errors);
    requireFiniteNumberMap(node, "inputs", `${label}.inputs`, errors);
    requireFiniteNumberMap(node, "outputs", `${label}.outputs`, errors);
  }

  for (const cohort of cohorts ?? []) {
    const label = `cohort ${String(cohort.id)}`;
    requireString(cohort, "settlementId", `${label}.settlementId`, errors);
    requireFiniteNumber(cohort, "population", `${label}.population`, errors, 0);
    requireString(cohort, "occupation", `${label}.occupation`, errors);
    requireString(cohort, "wealth", `${label}.wealth`, errors);
    requireString(cohort, "culture", `${label}.culture`, errors);
    requireFiniteNumber(cohort, "satisfaction", `${label}.satisfaction`, errors);
    requireFiniteNumber(cohort, "loyalty", `${label}.loyalty`, errors);
    requireString(cohort, "politicalAffinity", `${label}.politicalAffinity`, errors);
    requireFiniteNumberMap(cohort, "needs", `${label}.needs`, errors);
  }

  for (const squad of squads ?? []) {
    const label = `warfare squad ${String(squad.id)}`;
    requireString(squad, "factionId", `${label}.factionId`, errors);
    requireString(squad, "name", `${label}.name`, errors);
    requireFiniteNumber(squad, "personnel", `${label}.personnel`, errors, 0);
    requireFiniteNumber(squad, "morale", `${label}.morale`, errors);
    requireFiniteNumber(squad, "readiness", `${label}.readiness`, errors);
    requireFiniteNumber(squad, "supply", `${label}.supply`, errors);
    requireFiniteNumber(squad, "intelligence", `${label}.intelligence`, errors);
    requireOptionalString(squad, "commanderId", `${label}.commanderId`, errors);
  }
  for (const consequence of consequences ?? []) {
    const label = `consequence ${String(consequence.id)}`;
    requireInteger(consequence, "triggerTurn", `${label}.triggerTurn`, errors, 1);
    requireEnum(consequence, "visibility", `${label}.visibility`, ["visible", "hidden"], errors);
    requireEnum(
      consequence,
      "scope",
      `${label}.scope`,
      ["personal", "local", "settlement", "faction", "regional"],
      errors
    );
    requireEnum(consequence, "status", `${label}.status`, ["pending", "applied"], errors);
    requireBoolean(consequence, "reversible", `${label}.reversible`, errors);
    requireCausalSource(consequence.source, `${label}.source`, errors);
    if (!Array.isArray(consequence.effects)) {
      errors.push(`${label}.effects must be an array`);
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

/**
 * Validate one effect that arrived from a save, without trusting its shape.
 *
 * The parameter is `unknown` on purpose. It used to be `EventEffect`, which is
 * a claim about a value read out of a file — and the claim was wrong often
 * enough to matter: `effects: [null]` threw on `effect.type`, and a numeric
 * `key` threw on `.trim()`. A validator that throws is worse than one that
 * misses something, because the caller was promised a list of problems and
 * gets an exception from three layers down instead.
 *
 * So every field is proven before it is read, in the order the union requires:
 * object, then discriminant, then the fields that discriminant selects.
 */
function validateEffect(
  effect: unknown,
  characterIds: Set<string>,
  label: string,
  errors: string[]
): void {
  if (!isRecord(effect)) {
    errors.push(`${label} must be an object, got ${effect === null ? "null" : typeof effect}`);
    return;
  }

  const allowed: readonly string[] = EVENT_EFFECT_TYPES;
  const type = effect.type;
  if (typeof type !== "string" || !allowed.includes(type)) {
    errors.push(`${label} has unsupported effect type '${String(type)}'`);
    return;
  }

  // `key` is required by two of the four, and must be a usable string before
  // anything asks whether it is blank.
  if (type === "RESOURCE_DELTA" || type === "FLAG_SET") {
    // Absent and wrongly-typed are different mistakes and read differently.
    // "requires key" is the long-standing message for a missing one; a key that
    // is present but is a number needs to say so, and must never reach `.trim`.
    if (effect.key === undefined || (typeof effect.key === "string" && effect.key.trim() === "")) {
      errors.push(`${label} ${type} requires key`);
    } else if (typeof effect.key !== "string") {
      errors.push(`${label} ${type} requires a string key, got ${typeof effect.key}`);
    }
  }

  if (type === "CHARACTER_STRESS") {
    if (
      effect.targetId === undefined ||
      (typeof effect.targetId === "string" && effect.targetId.trim() === "")
    ) {
      errors.push(`${label} CHARACTER_STRESS requires targetId`);
    } else if (typeof effect.targetId !== "string") {
      errors.push(`${label} CHARACTER_STRESS requires a string targetId, got ${typeof effect.targetId}`);
    } else if (!characterIds.has(effect.targetId)) {
      errors.push(`${label} references unknown character '${effect.targetId}'`);
    }
  }

  // The value, per the discriminant that selects it.
  if (type === "RESOURCE_DELTA" || type === "PRESSURE_DELTA" || type === "CHARACTER_STRESS") {
    if (typeof effect.value !== "number" || !Number.isFinite(effect.value)) {
      errors.push(`${label} ${type} requires finite numeric value`);
    }
    return;
  }

  // FLAG_SET carries a string, a boolean or a number — and if a number, one
  // that can be compared. A NaN flag is false against everything, itself
  // included, so an event gated on it simply stops appearing and nothing
  // reports why.
  const value = effect.value;
  const kind = typeof value;
  if (kind !== "string" && kind !== "number" && kind !== "boolean") {
    errors.push(`${label} FLAG_SET requires string, number or boolean value`);
    return;
  }
  if (kind === "number" && !Number.isFinite(value)) {
    errors.push(`${label} FLAG_SET value must be a finite number, got ${String(value)}`);
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

  // Version first, and fail closed on anything this build cannot interpret.
  //
  // Returning here rather than collecting more errors is the point. An
  // unsupported version means the fields below may not mean what this code
  // thinks they mean, so continuing would produce confident errors about a
  // contract we do not have — and, worse, would risk a caller reading past a
  // version check that only warned. GQP spec 24.1 rule 5: old code must refuse
  // a schema it cannot correctly understand, not open it and ignore the parts
  // it does not recognise.
  const declaredVersion: unknown = simulation.schemaVersion;
  if (!isSupportedSchemaVersion(declaredVersion)) {
    return {
      ok: false,
      errors: [
        `Unsupported simulation schema ${JSON.stringify(declaredVersion)}; ` +
          `this build supports ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`
      ]
    };
  }

  // The two versions are validated by different rules, and neither is the
  // other's superset with optional extras: v2 requires the proof contracts and
  // v1 refuses them. That symmetry is what makes "no silent reinterpretation"
  // an enforced property rather than a promise about the loader.
  if (declaredVersion === PROOF_SCHEMA_VERSION) validateProofState(state, errors);
  else refuseProofFieldsOnBaseline(state, errors);

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
