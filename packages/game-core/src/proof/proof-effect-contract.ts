import {
  AUTHORABLE_EPIDEMIC_CAUSES,
  MEMORY_BEHAVIOR_HOOKS,
  MEMORY_EXPOSURES,
  MEMORY_VALENCES,
  type ProofEventEffect
} from "@paa/game-types";

/**
 * The GQP-B effect vocabulary, and the one validation of it.
 *
 * GQP-0 found the legacy effect rules duplicated across the event validator and
 * the save validator, and only managed to share the *list* of types between
 * them; the per-type rules are still two copies today. The new effects do not
 * repeat that. Their shape is checked here and nowhere else: the event
 * catalogue validator, the save validator and the proof resolver all call this
 * module, so a proof payload has exactly one definition of "well formed".
 *
 * The legacy duplication is left alone on purpose. Collapsing it would change
 * error wording the M1 suites assert on, for no behaviour gained in this slice;
 * it is recorded as follow-up debt rather than folded into GQP-B.
 */
export const PROOF_EVENT_EFFECT_TYPES = [
  "EPIDEMIC_SHIFT",
  "NODE_CONDITION_SHIFT",
  "MEMORY_RECORD",
  "MEMORY_PUBLISH"
] as const satisfies readonly ProofEventEffect["type"][];

export function isProofEffectType(type: unknown): type is ProofEventEffect["type"] {
  return typeof type === "string" && (PROOF_EVENT_EFFECT_TYPES as readonly string[]).includes(type);
}

/**
 * The fields each proof effect may carry, and no others.
 *
 * Closed, as the typed predicate arguments were after the A07 finding. The rest
 * of the M1 boundary tolerates unknown keys — spec 24.1 names that as the reason
 * the proof needed a version bump — but these are typed contracts, and an extra
 * field here is not harmless. A `MEMORY_RECORD` arriving with an `origin` would
 * be a payload claiming second-hand knowledge the propagation rules never
 * granted; refusing it is the point.
 */
const ALLOWED_FIELDS: Readonly<Record<ProofEventEffect["type"], readonly string[]>> = {
  EPIDEMIC_SHIFT: ["type", "cause", "delta"],
  NODE_CONDITION_SHIFT: ["type", "nodeId", "delta"],
  MEMORY_RECORD: [
    "type",
    "characterId",
    "memoryId",
    "subjectId",
    "valence",
    "salience",
    "exposure",
    "behaviorHook",
    "callbackEligible",
    "summary",
    "tags"
  ],
  MEMORY_PUBLISH: ["type", "memoryId"]
};

/** The ids a proof effect may name, taken from the world it will act on. */
export interface ProofEffectReferences {
  readonly characterIds: ReadonlySet<string>;
  readonly factionIds: ReadonlySet<string>;
  readonly nodeIds: ReadonlySet<string>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(owner: JsonRecord, key: string, label: string, errors: string[]): string | null {
  const value = owner[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label}.${key} must be a non-empty string, got ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

function oneOf(
  owner: JsonRecord,
  key: string,
  label: string,
  allowed: readonly string[],
  errors: string[]
): void {
  const value = owner[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${label}.${key} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
}

/** A finite, non-zero shift no larger than the unit range it moves within. */
function shift(owner: JsonRecord, label: string, errors: string[]): void {
  const value = owner.delta;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label}.delta must be a finite number, got ${JSON.stringify(value)}`);
    return;
  }
  // Zero promises a change that will not happen. Beyond ±1 the shift cannot
  // mean anything in a 0..1 domain and only saturates.
  if (value === 0) errors.push(`${label}.delta must not be zero`);
  if (Math.abs(value) > 1) errors.push(`${label}.delta must be within -1..1, got ${value}`);
}

/**
 * Shape only: everything that can be checked without a world.
 *
 * Used by the proof catalogue validator, where no world exists yet, and as the
 * first half of the save-boundary check.
 */
export function validateProofEffectShape(effect: unknown, label: string, errors: string[]): void {
  if (!isRecord(effect)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const type = effect.type;
  if (!isProofEffectType(type)) {
    errors.push(`${label}.type is not a proof effect: ${JSON.stringify(type)}`);
    return;
  }

  // `Object.keys` sees own properties only, so a `__proto__` key that arrived
  // through `JSON.parse` — where it *is* an own property — is caught here too.
  for (const key of Object.keys(effect)) {
    if (!ALLOWED_FIELDS[type].includes(key)) {
      errors.push(`${label}.${key} is not a field of ${type}`);
    }
  }

  switch (type) {
    case "EPIDEMIC_SHIFT": {
      if (effect.cause === "water_shortage") {
        // Stated separately because it is the one legal-looking value that is
        // still wrong: the World Tick derives this contributor, so an authored
        // shift on it would be overwritten one tick later.
        errors.push(
          `${label}.cause 'water_shortage' is derived by the World Tick and cannot be authored`
        );
      } else {
        oneOf(effect, "cause", label, AUTHORABLE_EPIDEMIC_CAUSES, errors);
      }
      shift(effect, label, errors);
      return;
    }
    case "NODE_CONDITION_SHIFT": {
      identifier(effect, "nodeId", label, errors);
      shift(effect, label, errors);
      return;
    }
    case "MEMORY_RECORD": {
      const characterId = identifier(effect, "characterId", label, errors);
      identifier(effect, "memoryId", label, errors);
      if (effect.subjectId !== undefined) {
        const subject = identifier(effect, "subjectId", label, errors);
        // A memory whose subject is its own holder carries nothing a subject is
        // for: it routes no callback and no reflection anywhere else.
        if (subject !== null && subject === characterId) {
          errors.push(`${label}.subjectId must not be the holder '${subject}'`);
        }
      }
      oneOf(effect, "valence", label, MEMORY_VALENCES, errors);
      oneOf(effect, "exposure", label, MEMORY_EXPOSURES, errors);
      if (effect.behaviorHook !== undefined) {
        oneOf(effect, "behaviorHook", label, MEMORY_BEHAVIOR_HOOKS, errors);
      }
      const salience = effect.salience;
      if (typeof salience !== "number" || !Number.isFinite(salience)) {
        errors.push(`${label}.salience must be a finite number, got ${JSON.stringify(salience)}`);
      } else if (salience <= 0 || salience > 1) {
        // Zero salience is a memory nothing will ever consult.
        errors.push(`${label}.salience must be within (0, 1], got ${salience}`);
      }
      if (typeof effect.callbackEligible !== "boolean") {
        errors.push(`${label}.callbackEligible must be a boolean`);
      }
      if (typeof effect.summary !== "string" || effect.summary.trim() === "") {
        errors.push(`${label}.summary must be a non-empty string`);
      }
      if (!Array.isArray(effect.tags) || effect.tags.some(tag => typeof tag !== "string")) {
        errors.push(`${label}.tags must be an array of strings`);
      }
      return;
    }
    case "MEMORY_PUBLISH": {
      identifier(effect, "memoryId", label, errors);
      return;
    }
  }
}

/**
 * With a world: every id the effect names must exist in it.
 *
 * `MEMORY_PUBLISH` is deliberately not checked here. A pending consequence may
 * publish a fact that another consequence records first, so its target can
 * legitimately be absent at save time; the applicator refuses it if it is still
 * absent when it runs.
 */
export function validateProofEffectReferences(
  effect: unknown,
  label: string,
  errors: string[],
  references: ProofEffectReferences
): void {
  if (!isRecord(effect)) return;
  if (effect.type === "NODE_CONDITION_SHIFT" && typeof effect.nodeId === "string") {
    if (!references.nodeIds.has(effect.nodeId)) {
      errors.push(`${label}.nodeId '${effect.nodeId}' matches no production node`);
    }
  }
  if (effect.type === "MEMORY_RECORD") {
    if (typeof effect.characterId === "string" && !references.characterIds.has(effect.characterId)) {
      errors.push(`${label}.characterId '${effect.characterId}' matches no party character`);
    }
    if (
      typeof effect.subjectId === "string" &&
      !references.characterIds.has(effect.subjectId) &&
      !references.factionIds.has(effect.subjectId)
    ) {
      errors.push(`${label}.subjectId '${effect.subjectId}' matches no character or faction`);
    }
  }
}
