import {
  EVENT_FAMILY_IDS,
  MEMORY_BEHAVIOR_HOOKS,
  PRESSURE_STAGES,
  PROOF_EVENT_TAXONOMY,
  PROOF_PREDICATES,
  PROOF_RISK_CATEGORIES,
  type ProofRiskCategory,
  type WorldState
} from "@paa/game-types";
import { validateLegacyEventEffect } from "../events/validate-event.js";
import {
  isProofEffectType,
  validateProofEffectReferences,
  validateProofEffectShape
} from "./proof-effect-contract.js";
import { proofConsequenceId } from "./proof-events.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * The content gate for a proof catalogue.
 *
 * Authored content is untrusted input as much as a save file is, and the proof
 * makes promises content can break silently: that a delayed harm was
 * foreshadowed (GQP-4), that a major choice says what is known, risked and
 * unknown (GQP-3), that eligibility reads something that can actually become
 * true. Each of those is checked here, against a reference world that supplies
 * the ids content may name.
 *
 * This validates; it never repairs, and it never decides what is fun.
 */

/** Taxonomies that present a major choice and owe the full disclosure. */
const MAJOR: ReadonlySet<string> = new Set(["DILEMMA", "COMPLICATION", "CRISIS_PAYOFF"]);

/** Taxonomies that are decisions at all, and so need a real alternative. */
const NEEDS_ALTERNATIVE: ReadonlySet<string> = new Set([
  "DILEMMA",
  "COMPLICATION",
  "CRISIS_PAYOFF",
  "OPPORTUNITY_REQUEST"
]);

/** Which risk category a delayed effect belongs to, if it is a harm. */
function harmCategory(effect: Record<string, unknown>): ProofRiskCategory | null {
  switch (effect.type) {
    case "EPIDEMIC_SHIFT":
      return typeof effect.delta === "number" && effect.delta > 0 ? "epidemic" : null;
    case "NODE_CONDITION_SHIFT":
      return typeof effect.delta === "number" && effect.delta < 0 ? "infrastructure" : null;
    case "RESOURCE_DELTA":
      return typeof effect.value === "number" && effect.value < 0 ? "supply" : null;
    case "MEMORY_RECORD":
      return effect.valence === "negative" ? "social" : null;
    case "MEMORY_PUBLISH":
      return "political";
    case "PRESSURE_DELTA":
      return typeof effect.value === "number" && effect.value > 0 ? "political" : null;
    default:
      return null;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const PREDICATE_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  epidemic_stage_in: ["predicate", "stages"],
  infrastructure_stage_in: ["predicate", "settlementId", "stages"],
  node_condition_below: ["predicate", "nodeId", "value"],
  flag_equals: ["predicate", "key", "value"],
  memory_hook_present: ["predicate", "characterId", "hook", "subjectId", "value"],
  memory_known: ["predicate", "characterId", "memoryId", "value"],
  agenda_satisfied: ["predicate", "agendaId", "value"],
  consequence_status: ["predicate", "consequenceId", "status"]
};

export function validateProofCatalogue(
  catalogue: unknown,
  world: WorldState
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const simulation = world.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    return { ok: false, errors: ["a proof catalogue is validated against a schema-v2 proof world"] };
  }
  if (!Array.isArray(catalogue)) return { ok: false, errors: ["catalogue must be an array"] };

  const references = {
    characterIds: new Set(world.party.map(character => character.id)),
    factionIds: new Set(simulation.factions.map(faction => faction.id)),
    nodeIds: new Set(simulation.productionNodes.map(node => node.id))
  };
  const settlementIds = new Set(simulation.settlements.map(item => item.id));
  const agendaIds = new Set(simulation.factionAgenda.map(item => item.id));

  // Facts the catalogue can make true. A predicate reading a fact nothing can
  // produce is dead content: an event that can never appear, or an option that
  // can never close, both of which look like design and are neither.
  const recordedMemories = new Map<string, string>(); // memory id -> event
  const recordedFacts = new Set<string>(); // memory ids anywhere
  const hooksByCharacter = new Set<string>(); // `${character}:${hook}`
  const settableFlags = new Set<string>(Object.keys(world.flags));
  const scheduledIds = new Set<string>();
  const eventIds = new Set<string>();

  const events = catalogue.filter(isRecord);
  if (events.length !== catalogue.length) errors.push("every catalogue entry must be an object");

  // First pass: identities, and every fact the catalogue can produce.
  for (const event of events) {
    const id = nonEmpty(event.id) ? event.id : "<no id>";
    if (!nonEmpty(event.id)) errors.push("an event has no id");
    else if (eventIds.has(event.id)) errors.push(`event id '${event.id}' is duplicated`);
    else eventIds.add(event.id);

    for (const choice of Array.isArray(event.choices) ? event.choices.filter(isRecord) : []) {
      const effects = Array.isArray(choice.effects) ? choice.effects.filter(isRecord) : [];
      const scheduledEffects = (Array.isArray(choice.schedules) ? choice.schedules.filter(isRecord) : [])
        .flatMap(schedule => (Array.isArray(schedule.effects) ? schedule.effects.filter(isRecord) : []));

      // A memory id names one fact, not one character's copy of it: the
      // channels copy it under the same id, and publication and `memory_known`
      // find it by id alone. So an id may repeat across alternative choices of
      // one event -- only one of them resolves -- but never across events, and
      // never twice in one choice, whoever it is recorded on. Otherwise the
      // second record meets a copy of the first and is refused at runtime: a
      // dead option the gate should have caught.
      const withinChoice = new Set<string>();
      for (const effect of [...effects, ...scheduledEffects]) {
        if (effect.type === "FLAG_SET" && nonEmpty(effect.key)) settableFlags.add(effect.key);
        if (effect.type === "MEMORY_RECORD" && nonEmpty(effect.characterId) && nonEmpty(effect.memoryId)) {
          const key = effect.memoryId;
          if (withinChoice.has(key)) {
            errors.push(`event ${id} choice ${String(choice.id)} records '${key}' twice`);
          }
          withinChoice.add(key);
          const owner = recordedMemories.get(key);
          if (owner !== undefined && owner !== id) {
            errors.push(`memory '${key}' is recorded by both '${owner}' and '${id}'`);
          }
          recordedMemories.set(key, id);
          recordedFacts.add(effect.memoryId);
          if (nonEmpty(effect.behaviorHook)) hooksByCharacter.add(`${effect.characterId}:${effect.behaviorHook}`);
        }
      }
      for (const schedule of Array.isArray(choice.schedules) ? choice.schedules.filter(isRecord) : []) {
        if (nonEmpty(event.id) && nonEmpty(choice.id) && nonEmpty(schedule.key)) {
          scheduledIds.add(proofConsequenceId(event.id, choice.id, schedule.key));
        }
      }
    }
  }

  const predicates = (list: unknown, label: string): void => {
    if (!Array.isArray(list)) {
      errors.push(`${label} must be an array`);
      return;
    }
    list.forEach((raw, index) => {
      const at = `${label}[${index}]`;
      if (!isRecord(raw)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const name = raw.predicate;
      if (typeof name !== "string" || !(PROOF_PREDICATES as readonly string[]).includes(name)) {
        errors.push(`${at}.predicate is not a proof predicate: ${JSON.stringify(name)}`);
        return;
      }
      for (const key of Object.keys(raw)) {
        if (!PREDICATE_ARGUMENTS[name]!.includes(key)) errors.push(`${at}.${key} is not an argument of ${name}`);
      }
      const stages = (value: unknown) => {
        if (!Array.isArray(value) || value.length === 0 || value.some(s => !(PRESSURE_STAGES as readonly string[]).includes(s as string))) {
          errors.push(`${at}.stages must be a non-empty list of pressure stages`);
        }
      };
      const bool = (value: unknown) => {
        if (typeof value !== "boolean") errors.push(`${at}.value must be a boolean`);
      };
      switch (name) {
        case "epidemic_stage_in":
          stages(raw.stages);
          return;
        case "infrastructure_stage_in":
          if (!nonEmpty(raw.settlementId) || !settlementIds.has(raw.settlementId)) {
            errors.push(`${at}.settlementId matches no settlement`);
          }
          stages(raw.stages);
          return;
        case "node_condition_below":
          if (!nonEmpty(raw.nodeId) || !references.nodeIds.has(raw.nodeId)) errors.push(`${at}.nodeId matches no production node`);
          if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value <= 0 || raw.value > 1) {
            errors.push(`${at}.value must be within (0, 1]`);
          }
          return;
        case "flag_equals":
          if (!nonEmpty(raw.key)) errors.push(`${at}.key must be a non-empty string`);
          else if (!settableFlags.has(raw.key)) {
            errors.push(`${at}.key '${raw.key}' is neither in the world nor set by any choice`);
          }
          bool(raw.value);
          return;
        case "memory_hook_present":
          if (!nonEmpty(raw.characterId) || !references.characterIds.has(raw.characterId)) {
            errors.push(`${at}.characterId matches no party character`);
          }
          if (typeof raw.hook !== "string" || !(MEMORY_BEHAVIOR_HOOKS as readonly string[]).includes(raw.hook)) {
            errors.push(`${at}.hook must be a memory behaviour hook`);
          } else if (nonEmpty(raw.characterId) && !hooksByCharacter.has(`${raw.characterId}:${raw.hook}`)) {
            errors.push(`${at} reads hook '${raw.hook}' on '${raw.characterId}', which no choice records`);
          }
          if (raw.subjectId !== undefined && (!nonEmpty(raw.subjectId) ||
              (!references.characterIds.has(raw.subjectId) && !references.factionIds.has(raw.subjectId)))) {
            errors.push(`${at}.subjectId matches no character or faction`);
          }
          bool(raw.value);
          return;
        case "memory_known":
          if (!nonEmpty(raw.characterId) || !references.characterIds.has(raw.characterId)) {
            errors.push(`${at}.characterId matches no party character`);
          }
          if (!nonEmpty(raw.memoryId) || !recordedFacts.has(raw.memoryId)) {
            errors.push(`${at}.memoryId '${String(raw.memoryId)}' is recorded by no choice`);
          }
          bool(raw.value);
          return;
        case "agenda_satisfied":
          if (!nonEmpty(raw.agendaId) || !agendaIds.has(raw.agendaId)) errors.push(`${at}.agendaId matches no agenda item`);
          bool(raw.value);
          return;
        case "consequence_status":
          if (!nonEmpty(raw.consequenceId) || !scheduledIds.has(raw.consequenceId)) {
            errors.push(`${at}.consequenceId '${String(raw.consequenceId)}' is scheduled by no choice`);
          }
          if (!["pending", "applied", "absent"].includes(raw.status as string)) {
            errors.push(`${at}.status must be pending, applied or absent`);
          }
          return;
      }
    });
  };

  const effectList = (list: unknown, label: string): void => {
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${label} must be a non-empty array`);
      return;
    }
    list.forEach((effect, index) => {
      const at = `${label}[${index}]`;
      if (isRecord(effect) && isProofEffectType(effect.type)) {
        validateProofEffectShape(effect, at, errors);
        validateProofEffectReferences(effect, at, errors, references);
      } else {
        validateLegacyEventEffect(effect, at, errors);
      }
    });
  };

  // Second pass: every event and choice against the full picture.
  for (const event of events) {
    const id = nonEmpty(event.id) ? event.id : "<no id>";
    if (typeof event.familyId !== "string" || !(EVENT_FAMILY_IDS as readonly string[]).includes(event.familyId)) {
      errors.push(`event ${id}.familyId must be a proof family`);
    }
    if (typeof event.taxonomy !== "string" || !(PROOF_EVENT_TAXONOMY as readonly string[]).includes(event.taxonomy)) {
      errors.push(`event ${id}.taxonomy must be one of ${PROOF_EVENT_TAXONOMY.join(", ")}`);
    }
    if (!isRecord(event.presentation) || !nonEmpty(event.presentation.title) || !nonEmpty(event.presentation.body)) {
      errors.push(`event ${id} needs a presentation title and body`);
    }
    predicates(event.eligibility, `event ${id}.eligibility`);

    const choices = Array.isArray(event.choices) ? event.choices.filter(isRecord) : [];
    if (choices.length === 0) {
      errors.push(`event ${id} has no choices`);
      continue;
    }
    // A decision with one option is not a decision.
    if (NEEDS_ALTERNATIVE.has(String(event.taxonomy)) && choices.length < 2) {
      errors.push(`event ${id} is a ${String(event.taxonomy)} with fewer than two options`);
    }

    const choiceIds = new Set<string>();
    for (const choice of choices) {
      const at = `event ${id} choice ${String(choice.id)}`;
      if (!nonEmpty(choice.id)) errors.push(`event ${id} has a choice with no id`);
      else if (choiceIds.has(choice.id)) errors.push(`event ${id} repeats choice id '${choice.id}'`);
      else choiceIds.add(choice.id);
      if (!nonEmpty(choice.label)) errors.push(`${at} needs a label`);
      if (choice.availability !== undefined) predicates(choice.availability, `${at}.availability`);
      effectList(choice.effects, `${at}.effects`);

      // GQP-3: the disclosure contract.
      const disclosure = isRecord(choice.disclosure) ? choice.disclosure : null;
      if (!disclosure) {
        errors.push(`${at} has no disclosure`);
        continue;
      }
      const risks = Array.isArray(disclosure.risks) ? disclosure.risks : [];
      const unknowns = Array.isArray(disclosure.unknowns) ? disclosure.unknowns : [];
      if (risks.some(r => !(PROOF_RISK_CATEGORIES as readonly string[]).includes(r as string))) {
        errors.push(`${at}.disclosure.risks holds an unknown category`);
      }
      if (new Set(risks).size !== risks.length) errors.push(`${at}.disclosure.risks repeats a category`);
      if (unknowns.some(u => !nonEmpty(u))) errors.push(`${at}.disclosure.unknowns holds an empty entry`);
      if (MAJOR.has(String(event.taxonomy))) {
        if (risks.length === 0) errors.push(`${at} is a major choice with no RISK`);
        if (unknowns.length === 0) errors.push(`${at} is a major choice with no UNKNOWN`);
      }

      // GQP-4 and GQP-3 for everything that arrives later.
      const recordedHere = new Map<string, JsonRecord>();
      for (const effect of Array.isArray(choice.effects) ? choice.effects.filter(isRecord) : []) {
        if (effect.type === "MEMORY_RECORD" && nonEmpty(effect.memoryId)) recordedHere.set(effect.memoryId, effect);
      }
      const scheduleKeys = new Set<string>();
      for (const schedule of Array.isArray(choice.schedules) ? choice.schedules.filter(isRecord) : []) {
        const sat = `${at} schedule ${String(schedule.key)}`;
        if (!nonEmpty(schedule.key)) errors.push(`${at} has a schedule with no key`);
        else if (scheduleKeys.has(schedule.key)) errors.push(`${at} repeats schedule key '${schedule.key}'`);
        else scheduleKeys.add(schedule.key);
        if (typeof schedule.delay !== "number" || !Number.isSafeInteger(schedule.delay) || schedule.delay < 1) {
          errors.push(`${sat}.delay must be a positive whole number of decisions`);
        }
        if (!["visible", "hidden"].includes(schedule.visibility as string)) errors.push(`${sat}.visibility is invalid`);
        if (!["personal", "local", "settlement", "faction", "regional"].includes(schedule.scope as string)) {
          errors.push(`${sat}.scope is invalid`);
        }
        effectList(schedule.effects, `${sat}.effects`);

        // A delayed outcome needs a breadcrumb the player could have seen: a
        // memory this same choice records, and that may be called back.
        const crumb = isRecord(schedule.breadcrumb) ? schedule.breadcrumb.memoryId : undefined;
        const crumbMemory = nonEmpty(crumb) ? recordedHere.get(crumb) : undefined;
        if (!crumbMemory) {
          errors.push(`${sat} has no breadcrumb recorded by the same choice`);
        } else if (crumbMemory.callbackEligible !== true) {
          errors.push(`${sat} breadcrumb '${crumb}' cannot be called back`);
        }

        // No harm may arrive in a category the choice never named.
        for (const effect of Array.isArray(schedule.effects) ? schedule.effects.filter(isRecord) : []) {
          const category = harmCategory(effect);
          if (category && !risks.includes(category)) {
            errors.push(`${sat} delivers ${category} harm the choice does not disclose as a RISK`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
