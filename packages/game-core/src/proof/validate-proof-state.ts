import {
  AGENDA_PREDICATES,
  CHARACTER_CORE_VALUES,
  CHARACTER_GOALS,
  CHARACTER_RELATIONSHIP_TYPES,
  EPIDEMIC_CAUSES,
  EVENT_FAMILY_IDS,
  FACTION_AGENDA_KINDS,
  FACTION_AGENDA_SUBJECTS,
  MEMORY_BEHAVIOR_HOOKS,
  MEMORY_ORIGINS,
  MEMORY_VALENCES,
  RELATIONSHIP_STRENGTHS
} from "@paa/game-types";

/**
 * Validation for the schema v2 contracts, on hostile input.
 *
 * GQP spec 24.1 rule 7 admits no exceptions and no "we will validate it
 * later": every v2 field gets shape **and** invariant validation in the slice
 * that introduces it. The reason the proof needed a version bump at all is
 * this one — optional fields on v1 would survive a round trip outside the
 * hostile-input guarantee, because the v1 validator does not reject what it
 * does not recognise. A tampered save could inject a non-finite pressure or a
 * relationship pointing at a character who does not exist, and the boundary
 * would wave it through.
 *
 * Two rules are substantive rather than formal, and are called out where they
 * are enforced: the history clocks may not exceed the world's own counters,
 * and every id must resolve. A forged future `worldTick` would make the quiet
 * bound of spec 14.6 permanently satisfied, which is to say it would switch
 * off the liveness contract from inside a save file.
 *
 * Everything here reads `unknown`. The `WorldState` type proves nothing about
 * bytes that came off someone's disk.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The v2-only fields, named once so the two version rules cannot drift. */
export const PROOF_SIMULATION_FIELDS = [
  "characterRelationships",
  "factionAgenda",
  "epidemic",
  "resolvedHistory"
] as const;

export const PROOF_CHARACTER_FIELDS = ["coreValue", "currentGoal"] as const;

export const PROOF_MEMORY_FIELDS = [
  "valence",
  "salience",
  "subjectId",
  "origin",
  "behaviorHook",
  "callbackEligible"
] as const;

function enumValue(
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

function unitInterval(owner: JsonRecord, key: string, label: string, errors: string[]): void {
  const value = owner[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number, got ${JSON.stringify(value)}`);
    return;
  }
  if (value < 0 || value > 1) errors.push(`${label} must be within 0..1, got ${value}`);
}

function identifier(owner: JsonRecord, key: string, label: string, errors: string[]): string | null {
  const value = owner[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string, got ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

function boundedInteger(
  owner: JsonRecord,
  key: string,
  label: string,
  min: number,
  max: number,
  maxLabel: string,
  errors: string[]
): number | null {
  const value = owner[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push(`${label} must be an integer, got ${JSON.stringify(value)}`);
    return null;
  }
  if (value < min) {
    errors.push(`${label} must be at least ${min}, got ${value}`);
    return null;
  }
  if (value > max) {
    // Substantive, not formal. See the module note: a history entry claiming a
    // clock the world has not reached is how a save file would switch off the
    // quiet bound.
    errors.push(`${label} is ${value} but ${maxLabel} is ${max}; history cannot lead the world`);
    return null;
  }
  return value;
}

function causalSource(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  enumValue(
    value,
    "kind",
    `${label}.kind`,
    ["choice", "event", "world_tick", "tactical", "warfare", "system"],
    errors
  );
  identifier(value, "id", `${label}.id`, errors);
}

/** A world at schema v2 carries every proof contract, and each one holds. */
export function validateProofState(state: unknown, errors: string[]): void {
  if (!isRecord(state)) return;
  const simulation = state.simulation;
  if (!isRecord(simulation)) return;

  const party = Array.isArray(state.party) ? state.party.filter(isRecord) : [];
  const characterIds = new Set(
    party.map(character => character.id).filter((id): id is string => typeof id === "string")
  );
  const factionIds = new Set(
    (Array.isArray(simulation.factions) ? simulation.factions.filter(isRecord) : [])
      .map(faction => faction.id)
      .filter((id): id is string => typeof id === "string")
  );

  proofCharacters(party, characterIds, factionIds, errors);
  relationships(simulation, characterIds, errors);
  agenda(simulation, factionIds, errors);
  epidemic(simulation, errors);
  history(state, simulation, errors);
}

/**
 * A baseline world may not carry proof state.
 *
 * This is the rule that stops a v1 save being read as a proof world by
 * accident or on purpose. Without it, "no automatic migration" would be a
 * statement about the loader while the fields rode along anyway, unvalidated,
 * exactly as spec 24.1 warns.
 */
export function refuseProofFieldsOnBaseline(state: unknown, errors: string[]): void {
  if (!isRecord(state)) return;
  const simulation = state.simulation;

  if (isRecord(simulation)) {
    for (const field of PROOF_SIMULATION_FIELDS) {
      if (simulation[field] !== undefined) {
        errors.push(
          `simulation.${field} is schema v2 state and must not appear at schema v1; ` +
            "a baseline world does not become a proof world by carrying proof fields"
        );
      }
    }
  }

  const party = Array.isArray(state.party) ? state.party.filter(isRecord) : [];
  for (const character of party) {
    const who = `character ${String(character.id)}`;
    for (const field of PROOF_CHARACTER_FIELDS) {
      if (character[field] !== undefined) {
        errors.push(`${who}.${field} is schema v2 state and must not appear at schema v1`);
      }
    }
    const memories = Array.isArray(character.memories) ? character.memories.filter(isRecord) : [];
    memories.forEach((memory, index) => {
      for (const field of PROOF_MEMORY_FIELDS) {
        if (memory[field] !== undefined) {
          errors.push(
            `${who} memory[${index}].${field} is schema v2 state and must not appear at schema v1`
          );
        }
      }
    });
  }
}

function proofCharacters(
  party: readonly JsonRecord[],
  characterIds: ReadonlySet<string>,
  factionIds: ReadonlySet<string>,
  errors: string[]
): void {
  for (const character of party) {
    const who = `character ${String(character.id)}`;
    // Required, not optional, at v2: a proof cast member with no value and no
    // goal produces no predictable refusal, and spec 6.2 requires every
    // character to hold a distinct position toward the focal resources.
    enumValue(character, "coreValue", `${who}.coreValue`, CHARACTER_CORE_VALUES, errors);
    enumValue(character, "currentGoal", `${who}.currentGoal`, CHARACTER_GOALS, errors);

    const memories = Array.isArray(character.memories) ? character.memories.filter(isRecord) : [];
    memories.forEach((memory, index) => {
      const at = `${who} memory[${index}]`;
      // Present-or-absent, validated when present. The M1 World Tick writes
      // memories without proof semantics and the accepted baseline is not
      // being rewritten to author them; what must never happen is a proof
      // field arriving unchecked.
      if (memory.valence !== undefined) {
        enumValue(memory, "valence", `${at}.valence`, MEMORY_VALENCES, errors);
      }
      if (memory.salience !== undefined) unitInterval(memory, "salience", `${at}.salience`, errors);
      if (memory.origin !== undefined) {
        enumValue(memory, "origin", `${at}.origin`, MEMORY_ORIGINS, errors);
      }
      if (memory.behaviorHook !== undefined) {
        enumValue(memory, "behaviorHook", `${at}.behaviorHook`, MEMORY_BEHAVIOR_HOOKS, errors);
      }
      if (memory.callbackEligible !== undefined && typeof memory.callbackEligible !== "boolean") {
        errors.push(`${at}.callbackEligible must be a boolean`);
      }
      if (memory.subjectId !== undefined) {
        const subject = identifier(memory, "subjectId", `${at}.subjectId`, errors);
        // A memory about nobody cannot route a callback or a reflection.
        if (subject !== null && !characterIds.has(subject) && !factionIds.has(subject)) {
          errors.push(`${at}.subjectId '${subject}' matches no character or faction`);
        }
      }
    });
  }
}

function relationships(
  simulation: JsonRecord,
  characterIds: ReadonlySet<string>,
  errors: string[]
): void {
  const value = simulation.characterRelationships;
  if (!Array.isArray(value)) {
    errors.push("simulation.characterRelationships must be an array at schema v2");
    return;
  }

  const seen = new Set<string>();
  value.forEach((item, index) => {
    const at = `characterRelationships[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const source = identifier(item, "sourceCharacterId", `${at}.sourceCharacterId`, errors);
    const target = identifier(item, "targetCharacterId", `${at}.targetCharacterId`, errors);
    enumValue(item, "type", `${at}.type`, CHARACTER_RELATIONSHIP_TYPES, errors);
    enumValue(item, "strength", `${at}.strength`, RELATIONSHIP_STRENGTHS, errors);

    // Referential integrity is the invariant the version bump exists to
    // protect: a relationship toward a character who does not exist is the
    // example spec 24.1 gives of what an unvalidated v1 field would let in.
    if (source !== null && !characterIds.has(source)) {
      errors.push(`${at}.sourceCharacterId '${source}' matches no party character`);
    }
    if (target !== null && !characterIds.has(target)) {
      errors.push(`${at}.targetCharacterId '${target}' matches no party character`);
    }
    if (source !== null && source === target) {
      errors.push(`${at} relates '${source}' to itself`);
    }
    if (source !== null && target !== null && typeof item.type === "string") {
      const key = `${source}->${target}:${item.type}`;
      if (seen.has(key)) errors.push(`${at} duplicates the relationship ${key}`);
      seen.add(key);
    }
  });
}

function agenda(simulation: JsonRecord, factionIds: ReadonlySet<string>, errors: string[]): void {
  const value = simulation.factionAgenda;
  if (!Array.isArray(value)) {
    errors.push("simulation.factionAgenda must be an array at schema v2");
    return;
  }

  const ids = new Set<string>();
  value.forEach((item, index) => {
    const at = `factionAgenda[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const id = identifier(item, "id", `${at}.id`, errors);
    if (id !== null) {
      if (ids.has(id)) errors.push(`${at}.id '${id}' is duplicated`);
      ids.add(id);
    }
    const factionId = identifier(item, "factionId", `${at}.factionId`, errors);
    if (factionId !== null && !factionIds.has(factionId)) {
      errors.push(`${at}.factionId '${factionId}' matches no faction`);
    }
    enumValue(item, "kind", `${at}.kind`, FACTION_AGENDA_KINDS, errors);
    enumValue(item, "subject", `${at}.subject`, FACTION_AGENDA_SUBJECTS, errors);
    unitInterval(item, "intensity", `${at}.intensity`, errors);
    causalSource(item.source, `${at}.source`, errors);
    agendaCondition(item.condition, `${at}.condition`, simulation, errors);
  });
}

/**
 * A typed predicate with validated arguments, and nothing more.
 *
 * Each branch checks exactly the arguments its predicate takes, so an item
 * cannot smuggle a `nodeId` into a flag comparison and have it ignored.
 * Deliberately not an expression language: spec 13.1 asks for the smallest
 * sufficient contract, and an interpreter would be a new evaluator to defend
 * against hostile input for no gameplay gained.
 */
function agendaCondition(
  value: unknown,
  label: string,
  simulation: JsonRecord,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  enumValue(value, "predicate", `${label}.predicate`, AGENDA_PREDICATES, errors);

  const idsOf = (key: string): Set<string> =>
    new Set(
      (Array.isArray(simulation[key]) ? (simulation[key] as unknown[]).filter(isRecord) : [])
        .map(entry => entry.id)
        .filter((id): id is string => typeof id === "string")
    );

  switch (value.predicate) {
    case "production_condition_at_least": {
      const nodeId = identifier(value, "nodeId", `${label}.nodeId`, errors);
      if (nodeId !== null && !idsOf("productionNodes").has(nodeId)) {
        errors.push(`${label}.nodeId '${nodeId}' matches no production node`);
      }
      unitInterval(value, "value", `${label}.value`, errors);
      return;
    }
    case "resource_stock_at_least": {
      const settlementId = identifier(value, "settlementId", `${label}.settlementId`, errors);
      if (settlementId !== null && !idsOf("settlements").has(settlementId)) {
        errors.push(`${label}.settlementId '${settlementId}' matches no settlement`);
      }
      identifier(value, "resourceKey", `${label}.resourceKey`, errors);
      const amount = value.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
        errors.push(`${label}.amount must be a finite non-negative number`);
      }
      return;
    }
    case "political_approval_at_least": {
      const groupId = identifier(value, "groupId", `${label}.groupId`, errors);
      if (groupId !== null && !idsOf("politicalGroups").has(groupId)) {
        errors.push(`${label}.groupId '${groupId}' matches no political group`);
      }
      unitInterval(value, "value", `${label}.value`, errors);
      return;
    }
    case "flag_equals": {
      identifier(value, "key", `${label}.key`, errors);
      if (typeof value.value !== "boolean") {
        errors.push(`${label}.value must be a boolean`);
      }
      return;
    }
    default:
      // The predicate enum check above already reported it. Nothing more can
      // be said about arguments belonging to a predicate nobody implements.
      return;
  }
}

function epidemic(simulation: JsonRecord, errors: string[]): void {
  const value = simulation.epidemic;
  if (!isRecord(value)) {
    errors.push("simulation.epidemic must be an object at schema v2");
    return;
  }
  unitInterval(value, "value", "simulation.epidemic.value", errors);

  // The qualitative stage is derived, never stored. A save carrying one would
  // be a second copy of a truth the Core computes, and the two would drift.
  if (value.stage !== undefined) {
    errors.push(
      "simulation.epidemic.stage must not be stored; the stage is derived from the value"
    );
  }

  const contributors = value.contributors;
  if (!Array.isArray(contributors)) {
    errors.push("simulation.epidemic.contributors must be an array");
    return;
  }
  contributors.forEach((item, index) => {
    const at = `simulation.epidemic.contributors[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    enumValue(item, "cause", `${at}.cause`, EPIDEMIC_CAUSES, errors);
    unitInterval(item, "magnitude", `${at}.magnitude`, errors);
    causalSource(item.source, `${at}.source`, errors);
  });
}

/**
 * The resolved-decision history, including the two clock rules of spec 24.1.
 *
 * Order is an invariant, not a convention. One decision is one Player Turn, so
 * consecutive entries have strictly increasing `playerTurn`; a choice does not
 * advance the tick, so `worldTick` is non-decreasing. A save that violates
 * either has been edited, and both the repetition penalty and the quiet bound
 * read this list in order.
 */
function history(state: JsonRecord, simulation: JsonRecord, errors: string[]): void {
  const value = simulation.resolvedHistory;
  if (!Array.isArray(value)) {
    errors.push("simulation.resolvedHistory must be an array at schema v2");
    return;
  }

  const currentTurn = typeof state.turn === "number" ? state.turn : 0;
  const currentTick = typeof simulation.tick === "number" ? simulation.tick : 0;

  let previousTurn = -Infinity;
  let previousTick = -Infinity;

  value.forEach((item, index) => {
    const at = `resolvedHistory[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    enumValue(item, "familyId", `${at}.familyId`, EVENT_FAMILY_IDS, errors);
    identifier(item, "eventId", `${at}.eventId`, errors);
    identifier(item, "choiceId", `${at}.choiceId`, errors);

    const playerTurn = boundedInteger(
      item,
      "playerTurn",
      `${at}.playerTurn`,
      1,
      currentTurn,
      "WorldState.turn",
      errors
    );
    const worldTick = boundedInteger(
      item,
      "worldTick",
      `${at}.worldTick`,
      0,
      currentTick,
      "simulation.tick",
      errors
    );

    if (playerTurn !== null) {
      if (playerTurn <= previousTurn) {
        errors.push(
          `${at}.playerTurn ${playerTurn} does not follow ${previousTurn}; ` +
            "one resolved decision is one Player Turn"
        );
      }
      previousTurn = playerTurn;
    }
    if (worldTick !== null) {
      if (worldTick < previousTick) {
        errors.push(`${at}.worldTick ${worldTick} goes back before ${previousTick}`);
      }
      previousTick = worldTick;
    }
  });
}
