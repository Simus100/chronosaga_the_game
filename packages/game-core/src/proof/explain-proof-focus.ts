import type {
  AgendaCondition,
  EpidemicCause,
  FactionAgendaKind,
  FactionAgendaSubject,
  MemoryOrigin,
  PatternId,
  PressureStage,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { agendaConditionHolds } from "./agenda-condition.js";
import { decisionKey, type PatternMatch } from "./pattern-detectors.js";
import { epidemicStage, pressureStage, settlementInfrastructurePressure } from "./pressure.js";
import { isProofSimulation } from "./schema-version.js";
import {
  QUIET_TICK_BOUND,
  developmentReason,
  type CausalCallback,
  type DecisionRef,
  type DevelopmentReason,
  type EventRule,
  type ProofFocus,
  type QuietDevelopment,
  type QuietRule,
  type RelevanceReason,
  type RepetitionReading,
  type UrgencyReason
} from "./select-proof-focus.js";

/**
 * The Normal-mode explanation of a focus (spec 16), as data.
 *
 * Presentation, not authority. Everything here is read from the selection the
 * Core already made and from the world it was made on: no new rule, no score,
 * no text a rule reads. It exists so that the interface built later (GQP-D)
 * can answer "why now, because of what, who remembers, what is at stake"
 * without inventing a cause in React -- the Core states the causes, typed and
 * with their source ids.
 *
 * For an EVENT:
 *   whyNow        the three terms and the rule that made it an event now
 *   causedBy      the decision behind it -- the "Consequence of ..." subtitle
 *   whoRemembers  the characters whose memories point at it
 *   pressures     the pressures in play, with their top causal contributors
 *   agenda        the faction agenda items it answers to
 *   patterns      the detected patterns it answers to, with their decisions
 *   recap         one or two causal chains, decision -> link -> this event
 *
 * For a QUIET beat:
 *   whatChanged   each development the World Tick will show, and why it is
 *                 worth showing
 *   boundAfter    whether the next selection must be an event
 */

export interface MemoryMention {
  readonly characterId: string;
  readonly memoryId: string;
  readonly origin: MemoryOrigin | null;
  readonly salience: number | null;
  /** The decision that recorded it, when it came from one. */
  readonly decision: DecisionRef | null;
}

export interface PressureContributor {
  readonly cause: EpidemicCause;
  readonly magnitude: number;
  /** The decision that last moved this cause, when a decision did. */
  readonly decision: DecisionRef | null;
  /** The rule that last moved it, when a rule did (world tick, scenario). */
  readonly rule: string | null;
}

export interface PressureReading {
  readonly epidemic: { readonly value: number; readonly stage: PressureStage; readonly contributors: readonly PressureContributor[] };
  readonly infrastructure: readonly { readonly settlementId: string; readonly value: number; readonly stage: PressureStage }[];
}

export interface AgendaMention {
  readonly agendaId: string;
  readonly factionId: string;
  readonly kind: FactionAgendaKind;
  readonly subject: FactionAgendaSubject;
  /** Whether its satisfy/resolve condition holds now. */
  readonly holds: boolean;
  readonly condition: AgendaCondition;
}

export interface PatternMention {
  readonly pattern: PatternId;
  readonly subject: string;
  readonly decisions: readonly DecisionRef[];
}

/** One causal chain: a past decision, what it left behind, and this event. */
export interface CausalChain {
  readonly decision: DecisionRef;
  readonly via:
    | { readonly kind: "memory"; readonly characterId: string; readonly memoryId: string }
    | { readonly kind: "pattern"; readonly pattern: PatternId; readonly subject: string }
    | { readonly kind: "consequence"; readonly consequenceId: string }
    | { readonly kind: "pressure"; readonly cause: EpidemicCause };
  readonly eventId: string;
}

export interface EventExplanation {
  readonly kind: "event";
  readonly eventId: string;
  readonly whyNow: {
    readonly rule: EventRule;
    readonly ticksSinceLastResolvedDecision: number;
    readonly priority: number;
    readonly urgency: readonly UrgencyReason[];
    readonly relevance: readonly RelevanceReason[];
    readonly repetition: RepetitionReading;
    readonly tieBreak: boolean;
  };
  readonly causedBy: DecisionRef | null;
  readonly callback: CausalCallback | null;
  readonly whoRemembers: readonly MemoryMention[];
  readonly pressures: PressureReading;
  readonly agenda: readonly AgendaMention[];
  readonly patterns: readonly PatternMention[];
  readonly recap: readonly CausalChain[];
}

export interface QuietExplanation {
  readonly kind: "quiet";
  readonly rule: QuietRule;
  readonly ticksSinceLastResolvedDecision: number;
  readonly whatChanged: readonly { readonly development: QuietDevelopment; readonly reason: DevelopmentReason }[];
  /** After this tick the quiet window is spent: the next focus must be an event. */
  readonly boundAfter: boolean;
  readonly pressures: PressureReading;
}

export type FocusExplanation = EventExplanation | QuietExplanation;

/** At most this many causal chains in a recap (spec 16: "1-2 causal chains"). */
export const RECAP_CHAINS = 2;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function proofWorld(state: WorldState): SystemicSimulationStateV2 {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) throw new Error("A focus is explained only on a schema-v2 proof world");
  return simulation;
}

function decisionFor(simulation: SystemicSimulationStateV2, kind: string, id: string): DecisionRef | null {
  if (kind !== "choice") return null;
  const entry = simulation.resolvedHistory.find(item => decisionKey(item) === id);
  return entry ? { familyId: entry.familyId, eventId: entry.eventId, choiceId: entry.choiceId, playerTurn: entry.playerTurn } : null;
}

function memoryMention(state: WorldState, simulation: SystemicSimulationStateV2, characterId: string, memoryId: string): MemoryMention | null {
  const memory = state.party.find(item => item.id === characterId)?.memories?.find(item => item.id === memoryId);
  if (!memory) return null;
  return {
    characterId,
    memoryId,
    origin: memory.origin ?? null,
    salience: memory.salience ?? null,
    decision: decisionFor(simulation, memory.source.kind, memory.source.id)
  };
}

/** The pressures as the Core holds them, with the epidemic's causes largest first. */
export function readPressures(state: WorldState): PressureReading {
  const simulation = proofWorld(state);
  const contributors = [...simulation.epidemic.contributors]
    .filter(item => item.magnitude > 0)
    .sort((a, b) => b.magnitude - a.magnitude || byCodeUnit(a.cause, b.cause))
    .map(item => ({
      cause: item.cause,
      magnitude: item.magnitude,
      decision: decisionFor(simulation, item.source.kind, item.source.id),
      rule: item.source.rule ?? null
    }));
  return {
    epidemic: { value: simulation.epidemic.value, stage: epidemicStage(simulation.epidemic), contributors },
    infrastructure: [...simulation.settlements]
      .sort((a, b) => byCodeUnit(a.id, b.id))
      .map(settlement => {
        const value = settlementInfrastructurePressure(state, settlement.id);
        return { settlementId: settlement.id, value, stage: pressureStage(value) };
      })
  };
}

function patternMention(match: PatternMatch): PatternMention {
  return {
    pattern: match.pattern,
    subject: match.subject,
    decisions: match.evidence.flatMap(item =>
      item.kind === "decision" ? [{ familyId: item.familyId, eventId: item.eventId, choiceId: item.choiceId, playerTurn: item.playerTurn }] : []
    )
  };
}

/**
 * Explain a focus the selector returned for `state`. Pure: it reads the focus
 * and the world, and returns data.
 */
export function explainProofFocus(state: WorldState, focus: ProofFocus): FocusExplanation {
  const simulation = proofWorld(state);
  const pressures = readPressures(state);

  if (focus.kind === "quiet") {
    return {
      kind: "quiet",
      rule: focus.quiet.rule,
      ticksSinceLastResolvedDecision: focus.quiet.ticksSinceLastResolvedDecision,
      whatChanged: focus.quiet.developments.map(development => ({ development, reason: developmentReason(development) })),
      // The quiet tick itself spends the window when it is the last one allowed.
      boundAfter: focus.quiet.ticksSinceLastResolvedDecision + 1 >= QUIET_TICK_BOUND,
      pressures
    };
  }

  const selection = focus.selection;
  const chosen = selection.chosen;
  const eventId = focus.event.id;

  const whoRemembers: MemoryMention[] = [];
  const agenda: AgendaMention[] = [];
  const patterns: PatternMention[] = [];
  const chains: CausalChain[] = [];

  const addChain = (chain: CausalChain | null) => {
    if (!chain || chains.some(item => decisionKey(item.decision) === decisionKey(chain.decision))) return;
    chains.push(chain);
  };

  // The callback first: it is the selected answer to "why now", so its chain
  // leads the recap.
  const callback = selection.callback;
  if (callback && "decision" in callback && callback.decision) {
    const via: CausalChain["via"] =
      callback.kind === "memory"
        ? { kind: "memory", characterId: callback.characterId, memoryId: callback.memoryId }
        : callback.kind === "pattern"
          ? { kind: "pattern", pattern: callback.pattern, subject: callback.subject }
          : callback.kind === "consequence"
            ? { kind: "consequence", consequenceId: callback.consequenceId }
            : { kind: "pressure", cause: callback.cause };
    addChain({ decision: callback.decision, via, eventId });
  }

  for (const reason of chosen.relevance.reasons) {
    switch (reason.kind) {
      case "memory": {
        const mention = memoryMention(state, simulation, reason.characterId, reason.memoryId);
        if (mention) {
          whoRemembers.push(mention);
          if (mention.decision) addChain({ decision: mention.decision, via: { kind: "memory", characterId: mention.characterId, memoryId: mention.memoryId }, eventId });
        }
        break;
      }
      case "agenda": {
        const item = simulation.factionAgenda.find(entry => entry.id === reason.agendaId);
        if (item) {
          agenda.push({
            agendaId: item.id,
            factionId: item.factionId,
            kind: item.kind,
            subject: item.subject,
            holds: agendaConditionHolds(item.condition, state),
            condition: item.condition
          });
        }
        break;
      }
      case "pattern": {
        const match = selection.patterns.find(item => item.pattern === reason.pattern && item.subject === reason.subject);
        if (match) {
          const mention = patternMention(match);
          patterns.push(mention);
          const latest = mention.decisions[mention.decisions.length - 1];
          if (latest) addChain({ decision: latest, via: { kind: "pattern", pattern: match.pattern, subject: match.subject }, eventId });
        }
        break;
      }
      case "consequence": {
        const stored = simulation.delayedConsequences.find(item => item.id === reason.consequenceId);
        const decision = stored ? decisionFor(simulation, stored.source.kind, stored.source.id) : null;
        if (decision) addChain({ decision, via: { kind: "consequence", consequenceId: reason.consequenceId }, eventId });
        break;
      }
    }
  }

  return {
    kind: "event",
    eventId,
    whyNow: {
      rule: selection.rule,
      ticksSinceLastResolvedDecision: selection.ticksSinceLastResolvedDecision,
      priority: chosen.priority,
      urgency: chosen.urgency.reasons,
      relevance: chosen.relevance.reasons,
      repetition: chosen.repetition,
      tieBreak: selection.tieBreak
    },
    causedBy: chains[0]?.decision ?? null,
    callback,
    whoRemembers,
    pressures,
    agenda,
    patterns,
    recap: chains.slice(0, RECAP_CHAINS)
  };
}
