import type {
  EpidemicCause,
  EventFamilyId,
  GameplayFocus,
  PatternId,
  PressureStage,
  ProofEvent,
  ProofEventTaxonomy,
  ProofPredicate,
  ResolvedDecision,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { isClockValue } from "../state/clock.js";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { runWorldTick } from "../state/run-world-tick.js";
import { agendaConditionHolds } from "./agenda-condition.js";
import { inspectProofStep, readProofWorld } from "./inspect-proof-step.js";
import { decisionKey, detectPatterns, type PatternMatch } from "./pattern-detectors.js";
import { epidemicStage, pressureStage, settlementInfrastructurePressure } from "./pressure.js";
import { eligibleProofEvents } from "./proof-events.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * GQP-C selection: which eligible proof event receives the focus now, or
 * whether the game takes a quiet beat instead (spec 14).
 *
 * Not a Director. This evolves the proof path's existing selection boundary:
 * `eligibleProofEvents` still decides what *could* happen, and nothing here can
 * add to that set, change a resource, a pressure, a memory, a relationship or
 * an agenda item, or produce a StateDelta. It orders what eligibility already
 * allowed, with three terms and nothing else (14.3):
 *
 *     priority = urgency + causal_relevance - repetition
 *
 * Every input is persisted state or derived from it -- pressures, delayed
 * consequences, memories, agenda, pattern matches, the resolved history, the
 * Player Turn and the World Tick. No Gameplay Beat index, no UI state, no
 * telemetry, no clock of the machine, no randomness, no LLM, and no memory of
 * a previous call: the same world always selects the same focus.
 *
 * The numbers below are PROVISIONAL (14.3: playtest material). What is not
 * provisional is that there are three terms, that each is explained by typed
 * reasons, and that the quiet bound exists and is derived from persisted data.
 */

/** Consecutive World Ticks allowed between two decision opportunities (spec 14.6). */
export const QUIET_TICK_BOUND = 1;

/** Urgency at or above which an event must emerge now: no quiet beat may defer it. */
export const MANDATORY_URGENCY = 2;

/** Priority at or above which an event pre-empts a quiet beat the window would allow. */
export const QUIET_YIELD_PRIORITY = 3;


/**
 * How many Player Turns the repetition penalty lasts. A family resolved one
 * decision ago costs SPAN points, two decisions ago SPAN - 1, and so on to 0.
 */
export const REPETITION_SPAN = 3;

/** Urgency points per pressure stage. Below CRITICAL a pressure does not press. */
const STAGE_URGENCY: Readonly<Partial<Record<PressureStage, number>>> = { CRITICAL: 1, CRISIS: 2 };

export type SelectionPressure = "epidemic" | "infrastructure";

/** Why an event is urgent: a pressure past a threshold, or a consequence about to land. */
export type UrgencyReason =
  | { readonly kind: "pressure"; readonly pressure: SelectionPressure; readonly stage: PressureStage; readonly points: number }
  | { readonly kind: "supply_exhausted"; readonly key: string; readonly points: number }
  | { readonly kind: "consequence_due"; readonly consequenceId: string; readonly triggerTurn: number; readonly points: number };

/** Why an event is causally relevant now: something the world remembers points at it. */
export type RelevanceReason =
  | { readonly kind: "memory"; readonly characterId: string; readonly memoryId: string; readonly points: number }
  | { readonly kind: "agenda"; readonly agendaId: string; readonly factionId: string; readonly points: number }
  | { readonly kind: "pattern"; readonly pattern: PatternId; readonly subject: string; readonly points: number }
  | { readonly kind: "consequence"; readonly consequenceId: string; readonly status: "pending" | "applied"; readonly points: number };

export interface RepetitionReading {
  readonly familyId: EventFamilyId;
  /** The Player Turn the family was last resolved on, or null if never. */
  readonly lastPlayerTurn: number | null;
  /** `WorldState.turn - lastPlayerTurn`; 1 right after resolving; null if never. */
  readonly elapsed: number | null;
  readonly penalty: number;
}

export interface CandidateScore {
  readonly eventId: string;
  readonly familyId: EventFamilyId;
  readonly taxonomy: ProofEventTaxonomy;
  readonly urgency: { readonly total: number; readonly reasons: readonly UrgencyReason[] };
  readonly relevance: { readonly total: number; readonly reasons: readonly RelevanceReason[] };
  readonly repetition: RepetitionReading;
  readonly priority: number;
}

/** A resolved decision, as a callback or an explanation points at it. */
export interface DecisionRef {
  readonly familyId: EventFamilyId;
  readonly eventId: string;
  readonly choiceId: string;
  readonly playerTurn: number;
}

/**
 * The one causal callback a selected event surfaces: the answer to "why is
 * this emerging now", pointing at persisted state. Typed, derived, and chosen
 * by a fixed order -- never by a model, never by matching text.
 */
export type CausalCallback =
  | { readonly kind: "memory"; readonly characterId: string; readonly memoryId: string; readonly decision: DecisionRef | null }
  | { readonly kind: "pattern"; readonly pattern: PatternId; readonly subject: string; readonly decision: DecisionRef | null }
  | { readonly kind: "consequence"; readonly consequenceId: string; readonly decision: DecisionRef | null }
  | { readonly kind: "agenda"; readonly agendaId: string; readonly factionId: string }
  | { readonly kind: "pressure"; readonly pressure: "epidemic"; readonly cause: EpidemicCause; readonly decision: DecisionRef | null };

/** Why the selection produced an EVENT rather than a quiet beat. */
export type EventRule =
  /** The quiet bound was reached: a decision is due (14.6). */
  | "quiet_bound"
  /** An event is urgent enough that no quiet beat may defer it (14.4). */
  | "mandatory"
  /** A quiet beat here would show nothing: the tick produces no relevant progression (14.5). */
  | "empty_quiet"
  /** The best candidate presses harder than a quiet beat is worth. */
  | "priority";

export interface ProofEventSelection {
  readonly ticksSinceLastResolvedDecision: number;
  readonly quietBoundReached: boolean;
  readonly rule: EventRule;
  /**
   * Every eligible event, scored, best first. The chosen one is `candidates[0]`,
   * except under `mandatory`: there it is the best candidate that is itself
   * mandatory, which the ranking may place lower.
   */
  readonly candidates: readonly CandidateScore[];
  readonly chosen: CandidateScore;
  /** Whether the chosen event won only on the event-id tie-break. */
  readonly tieBreak: boolean;
  readonly patterns: readonly PatternMatch[];
  readonly callback: CausalCallback | null;
}

/**
 * What a quiet beat will show: the relevant progression the next World Tick
 * produces, previewed by running the real tick on a copy (14.5). A tick that
 * only moves `tick` and `day` produces none of these, and is not a quiet beat.
 */
export type QuietDevelopment =
  | { readonly kind: "pressure_stage"; readonly pressure: SelectionPressure; readonly from: PressureStage; readonly to: PressureStage }
  | { readonly kind: "pressure_shift"; readonly pressure: "epidemic"; readonly from: number; readonly to: number; readonly causes: readonly EpidemicCause[] }
  | { readonly kind: "signal"; readonly eventId: string }
  | { readonly kind: "option"; readonly option: string; readonly change: "opened" | "closed" }
  | { readonly kind: "agenda"; readonly agendaId: string; readonly satisfied: boolean }
  | { readonly kind: "character"; readonly characterId: string; readonly memoryId: string }
  | { readonly kind: "faction"; readonly factionId: string; readonly tag: string }
  | { readonly kind: "standing"; readonly groupId: string; readonly from: number; readonly to: number }
  | { readonly kind: "shortage"; readonly key: string; readonly active: boolean };

/**
 * Why a development is worth showing, as a closed set. `tick` and `day` alone
 * are never a development: a World Tick that moves only them is empty (14.5).
 *
 * There is no CONSEQUENCE_APPLIED: delayed consequences fall due on Player
 * Turns, and a quiet beat does not advance the Player Turn, so no consequence
 * can land inside one. Consequences surface on the EVENT beat that brings
 * them due.
 */
export type DevelopmentReason =
  | "PRESSURE_CHANGED"
  | "ANTICIPATION"
  | "RECOVERY_CHANGED"
  | "FACTION_REACTION"
  | "CHARACTER_REACTION"
  | "POLITICAL_SHIFT"
  | "RESOURCE_CRISIS_CHANGED";

export function developmentReason(development: QuietDevelopment): DevelopmentReason {
  switch (development.kind) {
    case "pressure_stage":
    case "pressure_shift":
      return "PRESSURE_CHANGED";
    case "signal":
      return "ANTICIPATION";
    case "option":
      return "RECOVERY_CHANGED";
    case "agenda":
    case "faction":
      return "FACTION_REACTION";
    case "character":
      return "CHARACTER_REACTION";
    case "standing":
      return "POLITICAL_SHIFT";
    case "shortage":
      return "RESOURCE_CRISIS_CHANGED";
  }
}

/** Why the selection produced a quiet beat. */
export type QuietRule =
  /** Nothing is eligible, and the window still allows the world to advance. */
  | "nothing_eligible"
  /** Something is eligible, nothing presses, and the world has something to show. */
  | "nothing_presses";

export interface ProofQuietSelection {
  readonly ticksSinceLastResolvedDecision: number;
  readonly rule: QuietRule;
  readonly candidates: readonly CandidateScore[];
  readonly patterns: readonly PatternMatch[];
  readonly developments: readonly QuietDevelopment[];
}

/** The proof's focus: the one `GameplayFocus`, over proof events. */
export type ProofFocus = GameplayFocus<
  ProofEvent,
  { readonly selection: ProofEventSelection },
  { readonly quiet: ProofQuietSelection }
>;

/** Why the pacing contract cannot be honoured: a content or eligibility defect, never a game state. */
export type PacingDefectReason =
  /** The quiet bound is reached and nothing is eligible (14.6, second branch). */
  | "QUIET_BOUND_REACHED_WITH_NO_ELIGIBLE_EVENT"
  /** Nothing is eligible and the next tick would show nothing: a quiet beat would be empty filler (14.5, 23). */
  | "EMPTY_QUIET_WITH_NO_ELIGIBLE_EVENT";

/**
 * Fail closed. Zero eligible events where a decision is due is not a state of
 * play: it is a defect in content, eligibility or scenario design, and the
 * proof makes it observable instead of hiding it behind another quiet beat, a
 * filler event, an automatic reset, a random event or an AI fallback.
 */
export class PacingDefect extends Error {
  constructor(
    readonly reason: PacingDefectReason,
    readonly worldTick: number,
    readonly playerTurn: number,
    readonly ticksSinceLastResolvedDecision: number
  ) {
    super(
      `${reason}: at World Tick ${worldTick}, Player Turn ${playerTurn}, ` +
        `${ticksSinceLastResolvedDecision} tick(s) since the last resolved decision, and no proof event is eligible`
    );
    this.name = "PacingDefect";
  }
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function proofWorld(state: WorldState): SystemicSimulationStateV2 {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    throw new Error("Proof focus is selected only on a schema-v2 proof world");
  }
  return simulation;
}

/** The most recent resolved decision, or null on a fresh run. */
function lastResolved(simulation: SystemicSimulationStateV2): ResolvedDecision | null {
  const history = simulation.resolvedHistory;
  return history.length > 0 ? history[history.length - 1]! : null;
}

/**
 * `simulation.tick - lastResolved.worldTick` (spec 14.6), any family.
 *
 * An empty history measures from the scenario's opening tick, which in the
 * proof scenario is 0: the absence of history is itself authoritative data,
 * so no field is added for it.
 *
 * Both clocks must be safe integers (issue #37). A world whose clock can stand
 * still is not one this distance can be measured on, and it is refused rather
 * than read.
 */
export function ticksSinceLastResolvedDecision(state: WorldState): number {
  const simulation = proofWorld(state);
  const reference = lastResolved(simulation)?.worldTick ?? 0;
  if (!isClockValue(simulation.tick, 0) || !isClockValue(reference, 0)) {
    throw new Error(`The quiet bound cannot be measured on an unsafe clock (tick ${String(simulation.tick)}, reference ${String(reference)})`);
  }
  return simulation.tick - reference;
}

/**
 * Repetition by family, in Player Turns (spec 14.3):
 *
 *     elapsed(family) = WorldState.turn - lastResolved(family).playerTurn
 *
 * Read from `familyId` in the history, never from the event catalogue and
 * never in beats or ticks. Right after resolving a family, `elapsed = 1`: the
 * maximum penalty. A family never resolved has no entry and no penalty.
 */
export function repetitionOf(state: WorldState, familyId: EventFamilyId): RepetitionReading {
  const simulation = proofWorld(state);
  let last: ResolvedDecision | null = null;
  for (const entry of simulation.resolvedHistory) if (entry.familyId === familyId) last = entry;
  if (last === null) return { familyId, lastPlayerTurn: null, elapsed: null, penalty: 0 };
  if (!isClockValue(state.turn, 1)) {
    throw new Error(`Repetition cannot be measured on an unsafe Player Turn (${String(state.turn)})`);
  }
  const elapsed = state.turn - last.playerTurn;
  return { familyId, lastPlayerTurn: last.playerTurn, elapsed, penalty: Math.max(0, REPETITION_SPAN + 1 - elapsed) };
}

function decisionRef(entry: ResolvedDecision): DecisionRef {
  return { familyId: entry.familyId, eventId: entry.eventId, choiceId: entry.choiceId, playerTurn: entry.playerTurn };
}

/** The resolved decision a causal source id names, if it is one. */
function decisionFor(simulation: SystemicSimulationStateV2, sourceKind: string, sourceId: string): DecisionRef | null {
  if (sourceKind !== "choice") return null;
  const entry = simulation.resolvedHistory.find(item => decisionKey(item) === sourceId);
  return entry ? decisionRef(entry) : null;
}

/** Which pressure an eligibility predicate binds the event to, and its stage now. */
function boundPressure(state: WorldState, simulation: SystemicSimulationStateV2, predicate: ProofPredicate): { pressure: SelectionPressure; stage: PressureStage } | null {
  switch (predicate.predicate) {
    case "epidemic_stage_in":
      return { pressure: "epidemic", stage: epidemicStage(simulation.epidemic) };
    case "infrastructure_stage_in":
      return { pressure: "infrastructure", stage: pressureStage(settlementInfrastructurePressure(state, predicate.settlementId)) };
    case "node_condition_below": {
      const node = simulation.productionNodes.find(item => item.id === predicate.nodeId);
      if (!node) return null;
      return { pressure: "infrastructure", stage: pressureStage(settlementInfrastructurePressure(state, node.settlementId)) };
    }
    default:
      return null;
  }
}

function urgencyOf(state: WorldState, simulation: SystemicSimulationStateV2, event: ProofEvent): UrgencyReason[] {
  const reasons: UrgencyReason[] = [];
  const pressures = new Map<SelectionPressure, PressureStage>();
  for (const predicate of event.eligibility) {
    const bound = boundPressure(state, simulation, predicate);
    if (bound) pressures.set(bound.pressure, bound.stage);
  }
  for (const pressure of ["epidemic", "infrastructure"] as const) {
    const stage = pressures.get(pressure);
    const points = stage === undefined ? 0 : STAGE_URGENCY[stage] ?? 0;
    if (points > 0) reasons.push({ kind: "pressure", pressure, stage: stage!, points });
  }
  // A resource the event is about has run out: a threshold crossed, not a
  // stage of a pressure, and read from the same authority the event reads.
  for (const predicate of event.eligibility) {
    if (predicate.predicate !== "resource_below") continue;
    if (readAuthoritativeResource(state, predicate.key) <= 0) {
      reasons.push({ kind: "supply_exhausted", key: predicate.key, points: 1 });
    }
  }
  // A consequence the event reads, falling due after the next decision: the
  // last moment this question can still be asked before the answer arrives.
  for (const predicate of event.eligibility) {
    if (predicate.predicate !== "consequence_status" || predicate.status !== "pending") continue;
    const consequence = simulation.delayedConsequences.find(item => item.id === predicate.consequenceId);
    if (consequence && consequence.status === "pending" && consequence.triggerTurn <= state.turn + 1) {
      reasons.push({ kind: "consequence_due", consequenceId: consequence.id, triggerTurn: consequence.triggerTurn, points: 1 });
    }
  }
  return reasons;
}

/**
 * Causal relevance: each typed reference in the event's eligibility, or in its
 * `relevance` list, that points at something the world holds -- a memory
 * present, an agenda item still open, a pattern matched, a consequence in
 * play. +1 each, counted once per thing referenced.
 *
 * A `relevance` reference that does not hold simply adds nothing: it never
 * gates the event, which is what distinguishes it from eligibility.
 *
 * Only references that hold *positively*. "Tarek has not refused" is a
 * condition, not a cause; an absent memory calls nothing back.
 */
function relevanceOf(state: WorldState, simulation: SystemicSimulationStateV2, event: ProofEvent, patterns: readonly PatternMatch[]): RelevanceReason[] {
  const reasons: RelevanceReason[] = [];
  const seen = new Set<string>();
  const add = (key: string, reason: RelevanceReason) => {
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push(reason);
  };
  for (const predicate of [...event.eligibility, ...(event.relevance ?? [])]) {
    switch (predicate.predicate) {
      case "memory_hook_present": {
        if (!predicate.value) break;
        const memory = calledBackMemory(state, predicate.characterId, item =>
          item.origin === "direct" &&
          item.behaviorHook === predicate.hook &&
          (predicate.subjectId === undefined || item.subjectId === predicate.subjectId)
        );
        if (memory) add(`memory:${predicate.characterId}:${memory.id}`, { kind: "memory", characterId: predicate.characterId, memoryId: memory.id, points: 1 });
        break;
      }
      case "memory_known": {
        if (!predicate.value) break;
        const memory = calledBackMemory(state, predicate.characterId, item => item.id === predicate.memoryId);
        if (memory) add(`memory:${predicate.characterId}:${memory.id}`, { kind: "memory", characterId: predicate.characterId, memoryId: memory.id, points: 1 });
        break;
      }
      case "agenda_satisfied": {
        // An open desire or an unrepaired grievance is what drives a faction.
        if (predicate.value) break;
        const item = simulation.factionAgenda.find(entry => entry.id === predicate.agendaId);
        if (item && !agendaConditionHolds(item.condition, state)) {
          add(`agenda:${item.id}`, { kind: "agenda", agendaId: item.id, factionId: item.factionId, points: 1 });
        }
        break;
      }
      case "pattern_detected": {
        if (!predicate.value) break;
        const match = patterns.find(item => item.pattern === predicate.pattern && (predicate.subject === undefined || item.subject === predicate.subject));
        if (match) add(`pattern:${match.pattern}:${match.subject}`, { kind: "pattern", pattern: match.pattern, subject: match.subject, points: 1 });
        break;
      }
      case "consequence_status": {
        if (predicate.status === "absent") break;
        const consequence = simulation.delayedConsequences.find(item => item.id === predicate.consequenceId);
        if (consequence && consequence.status === predicate.status) {
          add(`consequence:${consequence.id}`, { kind: "consequence", consequenceId: consequence.id, status: consequence.status, points: 1 });
        }
        break;
      }
      default:
        break;
    }
  }
  return reasons;
}

/**
 * The memory a reference calls back: callback-eligible, most salient first,
 * then most recent, then by id. Fixed order, so the same world always calls
 * back the same memory.
 */
function calledBackMemory(
  state: WorldState,
  characterId: string,
  test: (memory: NonNullable<WorldState["party"][number]["memories"]>[number]) => boolean
) {
  const character = state.party.find(item => item.id === characterId);
  return (character?.memories ?? [])
    .filter(memory => memory.callbackEligible === true && test(memory))
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0) || b.turn - a.turn || byCodeUnit(a.id, b.id))[0];
}

function scoreOf(state: WorldState, simulation: SystemicSimulationStateV2, event: ProofEvent, patterns: readonly PatternMatch[]): CandidateScore {
  const urgency = urgencyOf(state, simulation, event);
  const relevance = relevanceOf(state, simulation, event, patterns);
  const repetition = repetitionOf(state, event.familyId);
  const u = urgency.reduce((sum, reason) => sum + reason.points, 0);
  const r = relevance.reduce((sum, reason) => sum + reason.points, 0);
  return {
    eventId: event.id,
    familyId: event.familyId,
    taxonomy: event.taxonomy,
    urgency: { total: u, reasons: urgency },
    relevance: { total: r, reasons: relevance },
    repetition,
    priority: u + r - repetition.penalty
  };
}

/** Highest priority first; equal priority by event id in code units (14.2). */
function byRank(a: CandidateScore, b: CandidateScore): number {
  return b.priority - a.priority || byCodeUnit(a.eventId, b.eventId);
}

/** Score every eligible event, best first. Pure; the world is only read. */
export function scoreProofCandidates(state: WorldState, catalogue: readonly ProofEvent[]): CandidateScore[] {
  const simulation = proofWorld(state);
  const patterns = detectPatterns(state);
  return eligibleProofEvents(state, catalogue)
    .map(event => scoreOf(state, simulation, event, patterns))
    .sort(byRank);
}

/**
 * The callback the chosen event surfaces, by a fixed preference: a memory a
 * character holds (the most readable "because"), then a detected pattern, a
 * consequence in play, an open agenda item, and finally the epidemic's
 * largest contributor when the event is bound to it.
 */
function callbackFor(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  event: ProofEvent,
  score: CandidateScore,
  patterns: readonly PatternMatch[]
): CausalCallback | null {
  const reasons = score.relevance.reasons;
  const memory = reasons.find(reason => reason.kind === "memory");
  if (memory && memory.kind === "memory") {
    const held = state.party.find(item => item.id === memory.characterId)?.memories?.find(item => item.id === memory.memoryId);
    return {
      kind: "memory",
      characterId: memory.characterId,
      memoryId: memory.memoryId,
      decision: held ? decisionFor(simulation, held.source.kind, held.source.id) : null
    };
  }
  const pattern = reasons.find(reason => reason.kind === "pattern");
  if (pattern && pattern.kind === "pattern") {
    const match = patterns.find(item => item.pattern === pattern.pattern && item.subject === pattern.subject);
    const decisions = (match?.evidence ?? []).filter(item => item.kind === "decision");
    const latest = decisions.length > 0 ? decisions[decisions.length - 1]! : null;
    return {
      kind: "pattern",
      pattern: pattern.pattern,
      subject: pattern.subject,
      decision: latest && latest.kind === "decision" ? decisionRef({ ...latest }) : null
    };
  }
  const consequence = reasons.find(reason => reason.kind === "consequence");
  if (consequence && consequence.kind === "consequence") {
    const stored = simulation.delayedConsequences.find(item => item.id === consequence.consequenceId);
    return {
      kind: "consequence",
      consequenceId: consequence.consequenceId,
      decision: stored ? decisionFor(simulation, stored.source.kind, stored.source.id) : null
    };
  }
  const agenda = reasons.find(reason => reason.kind === "agenda");
  if (agenda && agenda.kind === "agenda") return { kind: "agenda", agendaId: agenda.agendaId, factionId: agenda.factionId };

  if (event.eligibility.some(predicate => predicate.predicate === "epidemic_stage_in")) {
    const top = [...simulation.epidemic.contributors]
      .filter(item => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude || byCodeUnit(a.cause, b.cause))[0];
    if (top) {
      return { kind: "pressure", pressure: "epidemic", cause: top.cause, decision: decisionFor(simulation, top.source.kind, top.source.id) };
    }
  }
  return null;
}

/** Focal resources of the proof (spec 4.1). */
const FOCAL_RESOURCES = ["water", "energy", "food", "medicine"] as const;

/**
 * The relevant progression one World Tick makes, compared on the Core's own
 * readings of the world before and after. Pure: it reads two worlds.
 */
export function relevantDevelopments(before: WorldState, after: WorldState, catalogue: readonly ProofEvent[]): QuietDevelopment[] {
  const a = readProofWorld(before, catalogue);
  const b = readProofWorld(after, catalogue);
  const step = inspectProofStep(before, after, catalogue);
  const developments: QuietDevelopment[] = [];

  if (a.epidemic.stage !== b.epidemic.stage) {
    developments.push({ kind: "pressure_stage", pressure: "epidemic", from: a.epidemic.stage, to: b.epidemic.stage });
  }
  for (const id of Object.keys(b.infrastructure)) {
    const from = a.infrastructure[id]?.stage;
    const to = b.infrastructure[id]!.stage;
    if (from !== undefined && from !== to) developments.push({ kind: "pressure_stage", pressure: "infrastructure", from, to });
  }
  if (a.epidemic.value !== b.epidemic.value) {
    const simA = proofWorld(before);
    const simB = proofWorld(after);
    const causes = simB.epidemic.contributors
      .filter(item => (simA.epidemic.contributors.find(old => old.cause === item.cause)?.magnitude ?? 0) !== item.magnitude)
      .map(item => item.cause)
      .sort(byCodeUnit);
    developments.push({ kind: "pressure_shift", pressure: "epidemic", from: a.epidemic.value, to: b.epidemic.value, causes });
  }
  for (const eventId of b.eligibleEvents.filter(id => !a.eligibleEvents.includes(id))) developments.push({ kind: "signal", eventId });
  for (const option of step.optionsOpened) developments.push({ kind: "option", option, change: "opened" });
  for (const option of step.optionsClosed) developments.push({ kind: "option", option, change: "closed" });
  for (const change of step.agendaChanged) developments.push({ kind: "agenda", agendaId: change.agendaId, satisfied: change.after });
  for (const memory of step.newMemories) developments.push({ kind: "character", characterId: memory.characterId, memoryId: memory.memoryId });

  const simA = proofWorld(before);
  const simB = proofWorld(after);
  for (const faction of simB.factions) {
    const old = new Set(simA.factions.find(item => item.id === faction.id)?.memoryTags ?? []);
    for (const tag of faction.memoryTags.filter(item => !old.has(item))) developments.push({ kind: "faction", factionId: faction.id, tag });
  }
  // A political group's approval moving is the settlement reacting (spec 9.3:
  // legitimacy lives in approval, satisfaction and stability).
  for (const group of simB.politicalGroups) {
    const was = simA.politicalGroups.find(item => item.id === group.id)?.approval;
    if (was !== undefined && was !== group.approval) developments.push({ kind: "standing", groupId: group.id, from: was, to: group.approval });
  }
  for (const settlement of simB.settlements) {
    const flag = `${settlement.id}_water_shortage_active`;
    if (Object.hasOwn(after.flags, flag) && before.flags[flag] !== after.flags[flag]) {
      developments.push({ kind: "shortage", key: flag, active: after.flags[flag] === true });
    }
    const previous = simA.settlements.find(item => item.id === settlement.id);
    for (const resource of FOCAL_RESOURCES) {
      const was = previous?.resourceStock[resource] ?? 0;
      const now = settlement.resourceStock[resource] ?? 0;
      if (was > 0 && now <= 0) developments.push({ kind: "shortage", key: `${settlement.id}.${resource}`, active: true });
    }
  }
  return developments;
}

/**
 * Select the focus for this world. Pure and deterministic: it reads the world,
 * previews the real World Tick on a copy when a quiet beat is possible, and
 * returns. It never writes, never remembers, and never advances anything.
 *
 *   1. The quiet bound: once `ticksSinceLastResolvedDecision` reaches
 *      QUIET_TICK_BOUND, a decision is due. Something eligible -> EVENT, by
 *      the normal three terms. Nothing eligible -> PacingDefect (fail closed).
 *   2. Inside the window, an event urgent enough to be mandatory -> EVENT,
 *      and that event: the best-ranked of the mandatory ones.
 *   3. Otherwise preview the next World Tick. If it would show nothing, a
 *      quiet beat would be empty filler: EVENT if anything is eligible, else
 *      PacingDefect.
 *   4. Otherwise QUIET, unless the best candidate presses at or above
 *      QUIET_YIELD_PRIORITY.
 *
 * One sentence per outcome, and each is in the returned reasons.
 */
export function selectProofFocus(state: WorldState, catalogue: readonly ProofEvent[]): ProofFocus {
  const simulation = proofWorld(state);
  const ticksSince = ticksSinceLastResolvedDecision(state);
  const patterns = detectPatterns(state);
  const eligible = eligibleProofEvents(state, catalogue);
  const candidates = eligible.map(event => scoreOf(state, simulation, event, patterns)).sort(byRank);
  const boundReached = ticksSince >= QUIET_TICK_BOUND;

  // `pool` is what the rule may choose from, in rank order. Every rule takes
  // the whole ranking except `mandatory`, which is about particular events:
  // the crisis that cannot wait is the one presented, even when repetition
  // ranks something unrelated above it.
  const event = (rule: EventRule, pool: readonly CandidateScore[] = candidates): ProofFocus => {
    const chosen = pool[0]!;
    const chosenEvent = eligible.find(item => item.id === chosen.eventId)!;
    return {
      kind: "event",
      event: chosenEvent,
      selection: {
        ticksSinceLastResolvedDecision: ticksSince,
        quietBoundReached: boundReached,
        rule,
        candidates,
        chosen,
        tieBreak: pool.length > 1 && pool[1]!.priority === chosen.priority,
        patterns,
        callback: callbackFor(state, simulation, chosenEvent, chosen, patterns)
      }
    };
  };
  const defect = (reason: PacingDefectReason) => new PacingDefect(reason, simulation.tick, state.turn, ticksSince);

  if (boundReached) {
    if (candidates.length === 0) throw defect("QUIET_BOUND_REACHED_WITH_NO_ELIGIBLE_EVENT");
    return event("quiet_bound");
  }
  const mandatory = candidates.filter(candidate => candidate.urgency.total >= MANDATORY_URGENCY);
  if (mandatory.length > 0) return event("mandatory", mandatory);

  const developments = relevantDevelopments(state, runWorldTick(state).state, catalogue);
  if (developments.length === 0) {
    if (candidates.length === 0) throw defect("EMPTY_QUIET_WITH_NO_ELIGIBLE_EVENT");
    return event("empty_quiet");
  }
  if (candidates.length > 0 && candidates[0]!.priority >= QUIET_YIELD_PRIORITY) return event("priority");

  return {
    kind: "quiet",
    quiet: {
      ticksSinceLastResolvedDecision: ticksSince,
      rule: candidates.length === 0 ? "nothing_eligible" : "nothing_presses",
      candidates,
      patterns,
      developments
    }
  };
}
