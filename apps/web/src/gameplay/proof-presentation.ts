import {
  inspectProofStep,
  type CausalCallback,
  type CausalChain,
  type DecisionRef,
  type KnownItem,
  type QuietDevelopment
} from "@paa/game-core";
import type {
  CharacterCoreValue,
  EpidemicCause,
  EventFamilyId,
  FactionAgendaItem,
  PatternId,
  PressureStage,
  ProofChoice,
  ProofEvent,
  ProofRiskCategory,
  WorldState
} from "@paa/game-types";

/**
 * Words for the proof's typed data (GQP-D, Normal mode).
 *
 * Every function here turns something the Core already decided -- a typed
 * callback, a development, a KNOWN item, an id -- into a sentence a player can
 * read. None of them decides anything: no rule, no score, no eligibility, no
 * arithmetic on the world. The cause always comes from the Core; only the
 * phrasing comes from here (spec 16).
 *
 * Authored content (titles, bodies, labels, memory summaries) is shown as it
 * is written in `@paa/game-data`. It is PROVISIONAL presentation text and,
 * for now, English; the interface around it is Italian.
 */

const byId = <T extends { id: string }>(items: readonly T[] | undefined, id: string): T | undefined =>
  items?.find(item => item.id === id);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function characterName(state: WorldState, characterId: string): string {
  return byId(state.party, characterId)?.name ?? characterId;
}

export function firstName(state: WorldState, characterId: string): string {
  return characterName(state, characterId).split(" ")[0]!;
}

/**
 * The proof's text calls the two factions "the Council" and "the League"
 * (spec 8: CO and FCL). The world names them by their M1 names. The alias is
 * presentation, keyed by id, so the screen and the event text agree.
 */
const FACTION_ALIAS: Readonly<Record<string, string>> = {
  faction_compact: "il Consiglio",
  faction_front: "la Lega"
};

export function factionShort(factionId: string): string {
  return FACTION_ALIAS[factionId] ?? factionId;
}

/** "dal Consiglio" / "dalla Lega": the alias with its article, after "da". */
const FACTION_FROM: Readonly<Record<string, string>> = {
  faction_compact: "dal Consiglio",
  faction_front: "dalla Lega"
};

export function factionLabel(state: WorldState, factionId: string): string {
  const name = byId(state.simulation?.factions, factionId)?.name;
  const alias = FACTION_ALIAS[factionId];
  if (alias && name) return `${capitalize(alias)} (${name})`;
  return name ?? factionId;
}

/**
 * Political groups, with the article a sentence needs. "Security Council" is
 * not the Council faction; the alias keeps the two apart on screen.
 */
const GROUP_OF: Readonly<Record<string, string>> = {
  group_labor: "dell'assemblea dei lavoratori",
  group_security: "del comitato di sicurezza"
};

/** "dell'assemblea dei lavoratori (Labor Assembly)" -- for "il consenso ...". */
export function groupLabel(state: WorldState, groupId: string): string {
  const name = byId(state.simulation?.politicalGroups, groupId)?.name;
  const alias = GROUP_OF[groupId];
  if (alias) return name ? `${alias} (${name})` : alias;
  return `di ${name ?? groupId}`;
}

/** "del riciclatore" -- for "condizione ...". */
export function nodeLabel(state: WorldState, nodeId: string): string {
  if (nodeId === "prod_recycler_01") return "del riciclatore";
  return `di ${byId(state.simulation?.productionNodes, nodeId)?.id ?? nodeId}`;
}

const RESOURCE_LABEL: Readonly<Record<string, string>> = {
  water: "Acqua",
  energy: "Energia",
  food: "Cibo",
  medicine: "Medicinali",
  credits: "Crediti",
  alloys: "Leghe",
  provisions: "Provviste",
  influence: "Influenza",
  supply: "Rifornimenti"
};

export function resourceLabel(key: string): string {
  return RESOURCE_LABEL[key] ?? key;
}

export const FAMILY_LABEL: Readonly<Record<EventFamilyId, string>> = {
  scarcity_triage: "Scarsità e triage",
  maintenance: "Manutenzione",
  unregistered_conduit: "Il condotto non registrato",
  public_accountability: "Responsabilità pubblica",
  external_rescue: "Aiuto esterno"
};

export const STAGE_LABEL: Readonly<Record<PressureStage, string>> = {
  STABLE: "stabile",
  STRAINED: "sotto sforzo",
  CRITICAL: "critica",
  CRISIS: "in crisi"
};

export const CAUSE_LABEL: Readonly<Record<EpidemicCause, string>> = {
  water_shortage: "la carenza d'acqua",
  cohort_dissatisfaction: "il malcontento dei residenti",
  deferred_triage: "le cure rimandate",
  crowding: "il sovraffollamento"
};

export const RISK_LABEL: Readonly<Record<ProofRiskCategory, string>> = {
  epidemic: "epidemia",
  infrastructure: "infrastruttura",
  supply: "approvvigionamento",
  political: "politico",
  social: "sociale"
};

export const VALUE_LABEL: Readonly<Record<CharacterCoreValue, string>> = {
  institutional_order: "tiene all'ordine delle istituzioni",
  technical_integrity: "tiene all'integrità tecnica",
  duty_of_care: "sente il dovere di curare",
  practical_autonomy: "difende l'autonomia pratica",
  community_voice: "dà voce al distretto"
};

/** Agenda items by id where the id has a precise meaning; by subject otherwise. */
const AGENDA_LABEL: Readonly<Record<string, string>> = {
  agenda_co_reliability: "vuole una rete affidabile: il riciclatore sopra la soglia di lavoro",
  agenda_co_unregistered_access: "contesta l'accesso non registrato alla rete",
  agenda_fcl_access: "vuole un accesso stabile alla rete di Helios",
  agenda_co_no_league_client: "non vuole che Helios diventi cliente della Lega",
  agenda_fcl_no_council_client: "non vuole che Helios diventi cliente del Consiglio",
  agenda_fcl_lockout: "vuole che l'assemblea dei lavoratori conti davvero"
};

const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  network_reliability: "l'affidabilità della rete",
  informal_access: "l'accesso informale",
  public_transparency: "la trasparenza pubblica",
  medical_supply: "le forniture mediche",
  settlement_autonomy: "l'autonomia dell'insediamento"
};

export function agendaLabel(item: Pick<FactionAgendaItem, "id" | "kind" | "subject">): string {
  return AGENDA_LABEL[item.id] ?? `${item.kind === "desire" ? "vuole" : "contesta"} ${SUBJECT_LABEL[item.subject] ?? item.subject}`;
}

export function agendaById(state: WorldState, agendaId: string): FactionAgendaItem | undefined {
  const simulation = state.simulation as { factionAgenda?: FactionAgendaItem[] } | undefined;
  return simulation?.factionAgenda?.find(item => item.id === agendaId);
}

/**
 * An agenda item as a status line. `holds` is the Core's reading of its typed
 * condition (`readProofWorld().agenda`, `explainProofFocus().agenda`); it is
 * passed in, never evaluated here.
 */
export function agendaStatus(item: Pick<FactionAgendaItem, "kind">, holds: boolean): string {
  if (item.kind === "desire") return holds ? "concesso" : "in attesa";
  return holds ? "risolto" : "aperto";
}

// ---------------------------------------------------------------------------
// Content lookups
// ---------------------------------------------------------------------------

export function eventTitle(catalogue: readonly ProofEvent[], eventId: string): string {
  return byId(catalogue, eventId)?.presentation.title ?? eventId;
}

export function choiceLabel(catalogue: readonly ProofEvent[], eventId: string, choiceId: string): string {
  return byId(byId(catalogue, eventId)?.choices, choiceId)?.label ?? choiceId;
}

/** "«Patch the seals…» (turno 2)" -- a past decision the player can recognise. */
export function decisionLabel(catalogue: readonly ProofEvent[], decision: DecisionRef): string {
  return `«${choiceLabel(catalogue, decision.eventId, decision.choiceId)}» (turno ${decision.playerTurn})`;
}

/** The authored summary of a fact, from whoever holds a copy of it. */
export function memorySummary(state: WorldState, memoryId: string): string | null {
  for (const character of state.party) {
    const memory = character.memories?.find(item => item.id === memoryId);
    if (memory) return memory.summary;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

export function patternSentence(state: WorldState, pattern: PatternId, subject: string): string {
  switch (pattern) {
    case "IGNORED_TECHNICAL_WARNINGS":
      return `${firstName(state, subject)} ha visto ignorare i suoi avvertimenti più di una volta.`;
    case "REPEATED_PROTECTION_OR_NEGLECT":
      return subject === "protection"
        ? "Le tue decisioni hanno protetto il distretto più volte di fila."
        : "Le tue decisioni hanno lasciato indietro il distretto più volte di fila.";
    case "FACTION_DEPENDENCY_GROWING":
      return `Helios dipende sempre di più ${FACTION_FROM[subject] ?? `da ${subject}`}.`;
    case "SECRET_ACTION_DISCOVERED":
      return "Qualcuno ha trovato la traccia di qualcosa che avevi tenuto nascosto.";
  }
}

/**
 * The one causal callback the Core chose for this event (spec 16): who or what
 * brought it back, and which decision of the player's lies behind it.
 */
export function callbackSentence(state: WorldState, catalogue: readonly ProofEvent[], callback: CausalCallback): string {
  const because = (decision: DecisionRef | null) => (decision ? ` Viene dalla tua decisione ${decisionLabel(catalogue, decision)}.` : "");
  switch (callback.kind) {
    case "memory": {
      const summary = memorySummary(state, callback.memoryId);
      return `${firstName(state, callback.characterId)} se lo ricorda${summary ? `: «${summary}»` : "."}${because(callback.decision)}`;
    }
    case "pattern":
      return `${patternSentence(state, callback.pattern, callback.subject)}${because(callback.decision)}`;
    case "consequence":
      return `Conseguenza di una decisione precedente.${because(callback.decision)}`;
    case "agenda": {
      const item = agendaById(state, callback.agendaId);
      return `${capitalize(factionShort(callback.factionId))} ${item ? agendaLabel(item) : "insiste"}.`;
    }
    case "pressure":
      return `L'epidemia cresce per ${CAUSE_LABEL[callback.cause]}.${because(callback.decision)}`;
  }
}

/** One step of a recap chain: what the decision left behind. */
export function chainVia(state: WorldState, chain: CausalChain): string {
  switch (chain.via.kind) {
    case "memory":
      return `${firstName(state, chain.via.characterId)} se lo ricorda`;
    case "pattern":
      return patternSentence(state, chain.via.pattern, chain.via.subject).replace(/\.$/, "");
    case "consequence":
      return "è arrivata una conseguenza";
    case "pressure":
      return `ha pesato su ${CAUSE_LABEL[chain.via.cause]}`;
  }
}

/** A quiet beat's development as one line of "Il mondo si muove". */
export function developmentSentence(state: WorldState, catalogue: readonly ProofEvent[], development: QuietDevelopment): string {
  switch (development.kind) {
    case "pressure_stage":
      return `${development.pressure === "epidemic" ? "L'epidemia" : "L'infrastruttura"} passa da ${STAGE_LABEL[development.from]} a ${STAGE_LABEL[development.to]}.`;
    case "pressure_shift": {
      const rising = development.to > development.from;
      const causes = development.causes.map(cause => CAUSE_LABEL[cause]).join(", ");
      return `L'epidemia ${rising ? "si aggrava" : "rallenta"}${causes ? `: ${development.causes.length > 1 ? "pesano" : "pesa"} ${causes}` : ""}.`;
    }
    case "signal":
      return `Si profila una nuova questione: «${eventTitle(catalogue, development.eventId)}».`;
    case "option": {
      const [eventId = "", choiceId = ""] = development.option.split(":");
      const label = choiceLabel(catalogue, eventId, choiceId);
      return development.change === "opened" ? `Diventa possibile: «${label}».` : `Non è più possibile: «${label}».`;
    }
    case "agenda": {
      const item = agendaById(state, development.agendaId);
      const who = item ? capitalize(factionShort(item.factionId)) : "Una fazione";
      return `${who} ${item ? agendaLabel(item) : development.agendaId} — ora ${item ? agendaStatus(item, development.satisfied) : development.satisfied ? "soddisfatto" : "aperto"}.`;
    }
    case "character": {
      const name = firstName(state, development.characterId);
      // A quiet beat is shown before its tick runs, so a memory the tick is
      // about to write has no summary yet. The World Tick's own memories have
      // a stable id per rule (`mem_world_tick_<n>_water_shortage`).
      if (development.memoryId.endsWith("_water_shortage")) return `${name} annota la carenza d'acqua: se ne ricorderà.`;
      const summary = memorySummary(state, development.memoryId);
      return summary ? `${name} ci ripensa: «${summary}»` : `${name} se ne ricorderà.`;
    }
    case "faction": {
      const who = capitalize(factionShort(development.factionId));
      if (development.tag.startsWith("aware:")) {
        const summary = memorySummary(state, development.tag.slice("aware:".length));
        return `${who} viene a sapere${summary ? `: «${summary}»` : " qualcosa che era rimasto tra voi."}`;
      }
      if (development.tag.startsWith("resource_pressure:")) return `${who} prende nota della pressione sulle risorse di Helios.`;
      return `${who} prende nota di quello che succede a Helios.`;
    }
    case "standing":
      return `Il consenso ${groupLabel(state, development.groupId)} passa dal ${percent(development.from)} al ${percent(development.to)}.`;
    case "shortage":
      return development.active ? "L'acqua scende sotto la riserva: la carenza è in atto." : "La riserva d'acqua torna sopra la soglia.";
  }
}

/** One certain, immediate effect of an option (KNOWN), as the Core computed it. */
export function knownSentence(state: WorldState, item: KnownItem): string {
  switch (item.kind) {
    case "resource":
      return `${resourceLabel(item.key)}: ${number(item.before)} → ${number(item.after)} (${signed(item.delta)})`;
    case "flag":
      return flagSentence(item.key, item.after);
    case "pressure":
      return `Tensione nel mondo: ${number(item.before)} → ${number(item.after)}`;
    case "stress":
      return `Stress di ${firstName(state, item.characterId)}: ${signed(item.delta)}`;
    case "epidemic":
      return `Epidemia, per ${CAUSE_LABEL[item.cause as EpidemicCause] ?? item.cause}: ${signed(item.delta)}`;
    case "node_condition":
      return `Condizione ${nodeLabel(state, item.nodeId)}: ${percent(item.before)} → ${percent(item.after)}`;
    case "standing":
      return `Consenso ${groupLabel(state, item.groupId)}: ${percent(item.before)} → ${percent(item.after)}`;
    case "memory": {
      const others = item.reach.filter(id => id !== item.characterId).map(id => firstName(state, id));
      const kept =
        item.exposure === "secret" ? "resterà un segreto" : item.exposure === "public" ? "lo saprà tutto il distretto" : others.length ? `lo sapranno anche ${others.join(", ")}` : "resterà tra voi";
      return `${firstName(state, item.characterId)} se lo ricorderà (${kept})`;
    }
    case "publish":
      return `Diventa pubblico${item.reach.length ? `: lo sapranno ${item.reach.map(id => firstName(state, id)).join(", ")}` : ""}`;
  }
}

/** Typed flags the proof's options set, in words. Unknown keys are shown as they are. */
const FLAG_SENTENCE: Readonly<Record<string, string>> = {
  league_aid_accepted: "Helios accetta l'aiuto della Lega",
  council_aid_accepted: "Helios accetta l'aiuto del Consiglio",
  front_access_granted: "La Lega ottiene accesso alla rete",
  conduit_registered: "Il condotto viene registrato",
  unregistered_conduit_active: "Il condotto non registrato è in funzione",
  recycler_running_degraded: "Il riciclatore lavora in condizioni degradate",
  council_inspectors_resident: "Gli ispettori del Consiglio restano a Helios",
  council_stores_drawn: "Helios attinge alle scorte del Consiglio"
};

function flagSentence(key: string, after: string | number | boolean): string {
  const sentence = FLAG_SENTENCE[key];
  if (sentence && after === true) return sentence;
  if (sentence && after === false) return `Non più: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  return `${key}: ${String(after)}`;
}

/**
 * What an option declares about who it puts Helios in debt to, and what it
 * announces for later -- read from the option's typed content (a
 * `call_in_debt` memory with its faction subject; a `visible` schedule), never
 * from its prose. Hidden schedules stay hidden: they are UNKNOWN on purpose.
 */
export function obligations(state: WorldState, choice: ProofChoice): string[] {
  const lines: string[] = [];
  for (const effect of choice.effects) {
    if (effect.type === "MEMORY_RECORD" && effect.behaviorHook === "call_in_debt" && effect.subjectId?.startsWith("faction_")) {
      lines.push(`Debito con ${factionShort(effect.subjectId)}: ${firstName(state, effect.characterId)} lo terrà a mente, e verrà riscosso.`);
    }
  }
  for (const schedule of choice.schedules ?? []) {
    if (schedule.visibility !== "visible") continue;
    const parts = schedule.effects.map(effect =>
      effect.type === "RESOURCE_DELTA" ? `${resourceLabel(effect.key)} ${signed(effect.value)}` : "un effetto"
    );
    const when = schedule.delay === 1 ? "dopo la prossima decisione" : `tra ${schedule.delay} decisioni`;
    lines.push(`Annunciato per dopo (${when}): ${parts.join(", ")}.`);
  }
  return lines;
}

/** Developments in the order a player most needs them; at most `limit` shown. */
const DEVELOPMENT_ORDER: readonly QuietDevelopment["kind"][] = [
  "pressure_stage",
  "signal",
  "agenda",
  "shortage",
  "character",
  "faction",
  "standing",
  "pressure_shift",
  "option"
];

export function rankDevelopments(developments: readonly QuietDevelopment[]): QuietDevelopment[] {
  return [...developments].sort((a, b) => DEVELOPMENT_ORDER.indexOf(a.kind) - DEVELOPMENT_ORDER.indexOf(b.kind));
}

/**
 * What the beat just completed changed, in a few lines: read by the Core's own
 * step inspection (`inspectProofStep`) between the world the beat was offered
 * on and the world it produced. Nothing is diffed or computed here.
 */
export function stepLines(
  before: WorldState,
  after: WorldState,
  catalogue: readonly ProofEvent[],
  appliedConsequences: readonly string[]
): string[] {
  const step = inspectProofStep(before, after, catalogue);
  const lines: string[] = [];
  for (const id of appliedConsequences) {
    const consequence = after.simulation?.delayedConsequences.find(item => item.id === id);
    const [eventId = "", choiceId = ""] = (consequence?.source.id ?? "").split(":");
    lines.push(
      consequence?.source.kind === "choice"
        ? `È arrivata una conseguenza della tua decisione «${choiceLabel(catalogue, eventId, choiceId)}».`
        : "È arrivata una conseguenza annunciata."
    );
  }
  const seen = new Set<string>();
  for (const memory of step.newMemories) {
    if (memory.origin === "direct" || memory.origin === null) {
      if (seen.has(memory.characterId)) continue;
      seen.add(memory.characterId);
      lines.push(`${firstName(after, memory.characterId)} se lo ricorderà.`);
    }
  }
  for (const change of step.agendaChanged) {
    const item = agendaById(after, change.agendaId);
    if (!item) continue;
    lines.push(`${capitalize(factionShort(item.factionId))} ${agendaLabel(item)} — ora ${agendaStatus(item, change.after)}.`);
  }
  if (step.epidemic.before.stage !== step.epidemic.after.stage) {
    lines.push(`L'epidemia passa da ${STAGE_LABEL[step.epidemic.before.stage]} a ${STAGE_LABEL[step.epidemic.after.stage]}.`);
  }
  for (const reading of Object.values(step.infrastructure)) {
    if (reading.before.stage !== reading.after.stage) {
      lines.push(`L'infrastruttura passa da ${STAGE_LABEL[reading.before.stage]} a ${STAGE_LABEL[reading.after.stage]}.`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function signed(value: number): string {
  const shown = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(2);
  return `${value >= 0 ? "+" : "−"}${shown}`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
