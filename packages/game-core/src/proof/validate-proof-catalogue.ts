import {
  EVENT_FAMILY_IDS,
  MEMORY_BEHAVIOR_HOOKS,
  PATTERN_IDS,
  PROTECTION_DIRECTIONS,
  PRESSURE_STAGES,
  PROOF_EVENT_TAXONOMY,
  PROOF_PREDICATES,
  PROOF_RISK_CATEGORIES,
  type EventEffect,
  type ProofRiskCategory,
  type WorldState
} from "@paa/game-types";
import { validateLegacyEventEffect } from "../events/validate-event.js";
import {
  isProofEffectType,
  validateProofEffectReferences,
  validateProofEffectShape
} from "./proof-effect-contract.js";
import { guardianOf } from "./pattern-detectors.js";
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
    case "POLITICAL_STANDING_SHIFT":
      return typeof effect.delta === "number" && effect.delta < 0 ? "political" : null;
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

/**
 * The object elements of a list, with every departure from "an array of
 * objects" reported rather than smoothed over.
 *
 * GQP-B P2-3: the gate used to `filter(isRecord)` and treat a non-array as
 * empty, so `[choice, null]` was validated as `[choice]` and `schedules:
 * "invalid"` as no schedules at all. The gate takes `unknown` because content
 * is untrusted; it must refuse a malformed catalogue, not validate a
 * different, well-formed one in its place.
 */
function recordsOf(value: unknown, label: string, errors: string[], optional: boolean): JsonRecord[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const records: JsonRecord[] = [];
  value.forEach((item, index) => {
    if (isRecord(item)) records.push(item);
    else errors.push(`${label}[${index}] must be an object, got ${item === null ? "null" : Array.isArray(item) ? "array" : typeof item}`);
  });
  return records;
}

/** A list of non-empty strings, refused whole if it is anything else. */
function requireTextList(value: unknown, label: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return [];
  }
  value.forEach((item, index) => {
    if (!nonEmpty(item)) errors.push(`${label}[${index}] must be a non-empty string`);
  });
  return value.filter(nonEmpty);
}

const PREDICATE_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  epidemic_stage_in: ["predicate", "stages"],
  infrastructure_stage_in: ["predicate", "settlementId", "stages"],
  node_condition_below: ["predicate", "nodeId", "value"],
  flag_equals: ["predicate", "key", "value"],
  memory_hook_present: ["predicate", "characterId", "hook", "subjectId", "value"],
  memory_known: ["predicate", "characterId", "memoryId", "value"],
  agenda_satisfied: ["predicate", "agendaId", "value"],
  consequence_status: ["predicate", "consequenceId", "status"],
  resource_below: ["predicate", "key", "value"],
  pattern_detected: ["predicate", "pattern", "subject", "value"]
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
    nodeIds: new Set(simulation.productionNodes.map(node => node.id)),
    groupIds: new Set(simulation.politicalGroups.map(group => group.id))
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
  // Who records which fact, and how widely: what a publication must be able
  // to rely on (P2-4).
  const producers: { memoryId: string; characterId: string; exposure: unknown }[] = [];
  const publishedBy = new Map<string, { event: string; delayed: boolean }[]>(); // fact -> publishers
  // What the pattern detectors can ever match on (GQP-C): factions some choice
  // records a debt to, and facts whose own choice leaves a scheduled trace.
  const debtSubjects = new Set<string>();
  const tracedFacts = new Set<string>();
  // Resource keys a `resource_below` may read: stocked by the settlement or
  // held by the campaign today, or written by some choice. Anything else reads
  // as zero, which would be a fabricated shortage rather than an error.
  const resourceKeys = new Set<string>([
    ...Object.keys(world.resources),
    ...simulation.settlements.flatMap(item => Object.keys(item.resourceStock))
  ]);

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
        if (effect.type === "RESOURCE_DELTA" && nonEmpty(effect.key)) resourceKeys.add(effect.key);
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
          producers.push({ memoryId: effect.memoryId, characterId: effect.characterId, exposure: effect.exposure });
          if (nonEmpty(effect.behaviorHook)) hooksByCharacter.add(`${effect.characterId}:${effect.behaviorHook}`);
          if (effect.behaviorHook === "call_in_debt" && nonEmpty(effect.subjectId)) debtSubjects.add(effect.subjectId);
          // A trace is discoverable only if one of the choice's scheduled
          // effects has a guardian, and someone other than the holder carries
          // that core value. A schedule of flags, stress or memories leaves
          // nothing SECRET_ACTION_DISCOVERED can ever read: their guardian is
          // null, and no core value is.
          const holder = effect.characterId;
          const readable = scheduledEffects.some(scheduled => {
            const guardian = typeof scheduled.type === "string" ? guardianOf(scheduled as Pick<EventEffect, "type">) : null;
            return world.party.some(character => character.id !== holder && character.coreValue === guardian);
          });
          if (readable) tracedFacts.add(effect.memoryId);
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
        case "resource_below":
          if (!nonEmpty(raw.key)) errors.push(`${at}.key must be a non-empty string`);
          else if (!resourceKeys.has(raw.key)) errors.push(`${at}.key '${raw.key}' is stocked by nothing and written by no choice`);
          if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value <= 0) {
            errors.push(`${at}.value must be a positive finite number`);
          }
          return;
        case "pattern_detected": {
          if (typeof raw.pattern !== "string" || !(PATTERN_IDS as readonly string[]).includes(raw.pattern)) {
            errors.push(`${at}.pattern must be one of ${PATTERN_IDS.join(", ")}`);
            bool(raw.value);
            return;
          }
          bool(raw.value);
          if (raw.subject === undefined) return;
          // What `subject` names depends on the pattern, and each is checked
          // against something the catalogue can actually make true: a subject
          // no detector can ever match is an event that silently never appears.
          const subject = raw.subject;
          switch (raw.pattern) {
            case "IGNORED_TECHNICAL_WARNINGS":
              if (!nonEmpty(subject) || !references.characterIds.has(subject)) {
                errors.push(`${at}.subject must be a party character`);
              } else if (world.party.find(character => character.id === subject)?.coreValue !== "technical_integrity") {
                errors.push(`${at}.subject '${subject}' is not a technician (core value technical_integrity)`);
              }
              return;
            case "REPEATED_PROTECTION_OR_NEGLECT":
              if (typeof subject !== "string" || !(PROTECTION_DIRECTIONS as readonly string[]).includes(subject)) {
                errors.push(`${at}.subject must be one of ${PROTECTION_DIRECTIONS.join(", ")}`);
              }
              return;
            case "FACTION_DEPENDENCY_GROWING":
              if (!nonEmpty(subject) || !references.factionIds.has(subject)) {
                errors.push(`${at}.subject must be a faction`);
              } else if (!debtSubjects.has(subject)) {
                errors.push(`${at}.subject '${subject}' is a faction no choice records a debt to`);
              }
              return;
            case "SECRET_ACTION_DISCOVERED":
              if (!nonEmpty(subject) || !recordedFacts.has(subject)) {
                errors.push(`${at}.subject '${String(subject)}' is a fact no choice records`);
              } else if (!tracedFacts.has(subject)) {
                errors.push(`${at}.subject '${subject}' is recorded by no choice that leaves a trace to discover`);
              }
              return;
          }
          return;
        }
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
    if (event.relevance !== undefined) {
      predicates(event.relevance, `event ${id}.relevance`);
      // A relevance reference counts only when it points at something the
      // world holds. One that can never count is dead content: a reason to
      // emerge that no state can ever supply.
      (Array.isArray(event.relevance) ? event.relevance : []).forEach((raw, index) => {
        if (!isRecord(raw)) return;
        const causal =
          ((raw.predicate === "memory_hook_present" || raw.predicate === "memory_known" || raw.predicate === "pattern_detected") && raw.value === true) ||
          (raw.predicate === "agenda_satisfied" && raw.value === false) ||
          (raw.predicate === "consequence_status" && (raw.status === "pending" || raw.status === "applied"));
        if (!causal) {
          errors.push(
            `event ${id}.relevance[${index}] must point at something the world holds: a memory or pattern present, ` +
              "an agenda item still open, or a consequence pending or applied"
          );
        }
      });
    }

    const choices = recordsOf(event.choices, `event ${id}.choices`, errors, false);
    if (choices.length === 0) {
      errors.push(`event ${id} has no choices`);
      continue;
    }
    // A decision with one option is not a decision.
    if (NEEDS_ALTERNATIVE.has(String(event.taxonomy)) && choices.length < 2) {
      errors.push(`event ${id} is a ${String(event.taxonomy)} with fewer than two options`);
    }
    // And a signal with two options is a decision in disguise. Spec 10: a
    // SIGNAL warns or foreshadows and normally carries no major choice. The
    // quality gates for decisions (GQP-1, GQP-2, and the full disclosure above)
    // key on taxonomy, so an event that asks the player to choose must be
    // classified as one -- otherwise relabelling it SIGNAL would quietly take
    // it out of every audit.
    if (event.taxonomy === "SIGNAL" && choices.length > 1) {
      errors.push(`event ${id} is a SIGNAL with ${choices.length} options; an event that asks for a decision must be classified as one`);
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

      // GQP-3: the disclosure contract. Every list is a list, or it is refused:
      // a `risks: "supply"` read as no risks would pass a major choice that
      // discloses nothing.
      const disclosure = isRecord(choice.disclosure) ? choice.disclosure : null;
      if (!disclosure) {
        errors.push(`${at} has no disclosure`);
        continue;
      }
      if (!Array.isArray(disclosure.risks)) errors.push(`${at}.disclosure.risks must be an array`);
      if (!Array.isArray(disclosure.unknowns)) errors.push(`${at}.disclosure.unknowns must be an array`);
      const risks: unknown[] = Array.isArray(disclosure.risks) ? disclosure.risks : [];
      const unknowns: unknown[] = Array.isArray(disclosure.unknowns) ? disclosure.unknowns : [];
      if (disclosure.knownNotes !== undefined) {
        requireTextList(disclosure.knownNotes, `${at}.disclosure.knownNotes`, errors);
      }
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
      // A publication must be one the content can make (P2-4): the named
      // holder records the fact somewhere, and not already public. An
      // immediate publication may not publish what its own choice records --
      // availability reads the world before the choice, and that fact is not
      // in it yet; record it public instead.
      //
      // Several events may publish one fact immediately (GQP-C): a secret can
      // be confessed where it was made, or exposed where it was discovered.
      // Whichever comes first makes the fact public, and the precondition
      // every publication shares then closes the others by availability. A
      // *delayed* publication cannot share a fact: it would sit pending while
      // another event published it, and the boundary refuses a pending
      // publication its holder can no longer make.
      const publications = (at2: string, effect: JsonRecord, delayed: boolean) => {
        if (!nonEmpty(effect.memoryId) || !nonEmpty(effect.characterId)) return;
        const fact = effect.memoryId;
        const recorders = producers.filter(item => item.memoryId === fact && item.characterId === effect.characterId);
        if (recorders.length === 0) {
          errors.push(`${at2} publishes '${fact}' from '${effect.characterId}', but no choice records it on '${effect.characterId}'`);
        } else if (recorders.some(item => item.exposure === "public")) {
          errors.push(`${at2} publishes '${fact}', which is recorded public already`);
        }
        const publishers = publishedBy.get(fact) ?? [];
        const other = publishers.find(item => item.event !== id && (item.delayed || delayed));
        if (other) {
          errors.push(`fact '${fact}' is published by both '${other.event}' and '${id}', and a delayed publication cannot share its fact`);
        }
        publishers.push({ event: id, delayed });
        publishedBy.set(fact, publishers);
        const recordedByThisChoice = recordedHere.get(fact)?.characterId === effect.characterId;
        if (!delayed && recordedHere.has(fact)) {
          errors.push(`${at2} records and publishes '${fact}' in one choice; record it public instead`);
        }
        if (delayed && !recordedByThisChoice) {
          errors.push(`${at2} is a delayed publication of '${fact}', which the same choice does not record on '${effect.characterId}'`);
        }
      };
      (Array.isArray(choice.effects) ? choice.effects : []).forEach((effect, index) => {
        if (isRecord(effect) && effect.type === "MEMORY_PUBLISH") publications(`${at}.effects[${index}]`, effect, false);
      });

      const scheduleKeys = new Set<string>();
      for (const schedule of recordsOf(choice.schedules, `${at}.schedules`, errors, true)) {
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
        (Array.isArray(schedule.effects) ? schedule.effects : []).forEach((effect, index) => {
          if (isRecord(effect) && effect.type === "MEMORY_PUBLISH") publications(`${sat}.effects[${index}]`, effect, true);
        });

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
