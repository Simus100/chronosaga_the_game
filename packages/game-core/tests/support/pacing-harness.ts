import type { EventEffect, ProofChoice, ProofEvent, ResolvedDecision, StateDelta, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  detectPatterns,
  isProofChoiceAvailable,
  loadSystemicWorldState,
  PacingDefect,
  readProofWorld,
  serializeSystemicWorldState,
  type CausalCallback,
  type CandidateScore,
  type EventRule,
  type PatternMatch,
  type ProofFocus,
  type QuietDevelopment,
  type QuietRule
} from "../../src";

/**
 * The GQP-C reference pacing harness.
 *
 * It plays Gameplay Beats through the Core's own lifecycle -- `beginProofBeat`
 * then `completeProofBeat` -- and records what happened. It decides nothing
 * the Core decides: which event receives the focus, whether a beat is quiet,
 * when a decision is due, all come from the selector. The harness only answers
 * the question an EVENT asks, through a *policy* that reads the typed effects of
 * the options the selector actually presented and picks one semantically.
 *
 * A policy never names an event or an option id, and never looks at the beat
 * number: it cannot script "event X at beat Y". Two policies from one seed
 * diverge because the world diverges.
 *
 * `beat` is the harness's own counter -- telemetry, local to this file, never
 * passed to the Core (spec 22). A test proves the selector cannot see it.
 */

export const PACING_SEED = 7419;

/** A way of answering events: a score per option, from the option's typed content. */
export interface PacingPolicy {
  readonly name: string;
  readonly score: (choice: ProofChoice, state: WorldState) => number;
}

function effectsOf(choice: ProofChoice): EventEffect[] {
  return [...choice.effects, ...(choice.schedules ?? []).flatMap(schedule => schedule.effects)];
}

const count = (choice: ProofChoice, test: (effect: EventEffect) => boolean) => effectsOf(choice).filter(test).length;
const sum = (choice: ProofChoice, test: (effect: EventEffect) => number) => choice.effects.reduce((total, effect) => total + test(effect), 0);

/** Secrets recorded: an action taken without telling anyone. */
const secrets = (c: ProofChoice) => count(c, e => e.type === "MEMORY_RECORD" && e.exposure === "secret");
/** Publications and public records: telling the settlement. */
const disclosures = (c: ProofChoice) =>
  count(c, e => e.type === "MEMORY_PUBLISH") + count(c, e => e.type === "MEMORY_RECORD" && e.exposure === "public" && e.valence !== "negative");
/** Debts taken: help accepted from a faction. */
const debts = (c: ProofChoice) => count(c, e => e.type === "MEMORY_RECORD" && e.behaviorHook === "call_in_debt");
/** Repair and treatment: spending now to fix the thing. */
const repairs = (c: ProofChoice) =>
  sum(c, e => (e.type === "NODE_CONDITION_SHIFT" && e.delta > 0 ? 1 : 0) + (e.type === "EPIDEMIC_SHIFT" && e.delta < 0 ? 1 : 0));
/** Stock spent now, as a positive number. */
const spent = (c: ProofChoice) => sum(c, e => (e.type === "RESOURCE_DELTA" && e.value < 0 ? -e.value : 0));
/** Stock gained now. */
const gained = (c: ProofChoice) => sum(c, e => (e.type === "RESOURCE_DELTA" && e.value > 0 ? e.value : 0));
/** Harm deferred to later: consequences scheduled. */
const deferred = (c: ProofChoice) => (c.schedules ?? []).length;
/** Standing earned with the Labour Assembly (the district's political voice). */
const districtStanding = (c: ProofChoice) =>
  sum(c, e => (e.type === "POLITICAL_STANDING_SHIFT" && e.groupId === "group_labor" ? e.delta : 0));

/**
 * Conservative, transparent, self-reliant: repair and treat properly, tell the
 * settlement, take no debts and keep no secrets, and pay for it in stock.
 */
export const POLICY_A: PacingPolicy = {
  name: "A conservative / transparent / self-reliant",
  score: c => 3 * disclosures(c) - 4 * secrets(c) - 4 * debts(c) + 2 * repairs(c) - 2 * deferred(c) + 10 * districtStanding(c)
};

/**
 * Expedient, secretive, external-help prone: keep costs down today, push them
 * into later, keep things quiet, and take the help on offer.
 */
export const POLICY_B: PacingPolicy = {
  name: "B expedient / secretive / external-help prone",
  score: c => 3 * secrets(c) + 3 * debts(c) - disclosures(c) - 0.4 * spent(c) + 0.3 * gained(c) + 1.5 * deferred(c)
};

export interface BeatRecord {
  /** Harness-local, 1-based. Telemetry only; the Core never sees it. */
  readonly beat: number;
  readonly focus: "EVENT" | "QUIET";
  readonly worldTick: { readonly from: number; readonly to: number };
  readonly playerTurn: { readonly from: number; readonly to: number };
  readonly eligible: readonly string[];
  readonly candidates: readonly CandidateScore[];
  readonly patterns: readonly PatternMatch[];
  readonly rule: EventRule | QuietRule;
  readonly ticksSinceLastResolvedDecision: number;
  /** EVENT only. */
  readonly event: { readonly id: string; readonly familyId: string; readonly taxonomy: string } | null;
  readonly callback: CausalCallback | null;
  readonly choice: string | null;
  readonly decision: ResolvedDecision | null;
  readonly consequencesApplied: readonly string[];
  /** QUIET only: what the World Tick showed. */
  readonly developments: readonly QuietDevelopment[];
  readonly delta: StateDelta;
  readonly after: WorldState;
}

export interface PacingRun {
  readonly policy: string;
  readonly start: WorldState;
  readonly beats: readonly BeatRecord[];
  readonly final: WorldState;
  /** A liveness defect the Core raised, recorded instead of thrown when `recordDefect` is set. */
  readonly defect: PacingDefect | null;
}

export interface PacingOptions {
  readonly catalogue?: readonly ProofEvent[];
  readonly start?: WorldState;
  /** Session length in Gameplay Beats. A property of the play session, never read by the Core. */
  readonly beats?: number;
  /** Round-trip through the real save boundary after these beats (1-based). */
  readonly saveAfter?: readonly number[];
  /** Record a PacingDefect on the run and stop, instead of throwing it. */
  readonly recordDefect?: boolean;
  /**
   * Where the harness starts numbering beats. Telemetry only: it changes the
   * labels in the record and nothing else, which a test uses to prove the Core
   * cannot see the beat index.
   */
  readonly firstBeatLabel?: number;
}

/**
 * The reference session length. With a quiet bound of one World Tick, 12
 * beats is where spec 15's targets meet: at most one quiet beat between two
 * decisions means at least 6 decisions in 12 beats, and every lifecycle path
 * from the proof seed makes 6 or 7 (proven by the network suite).
 */
export const REFERENCE_SESSION_BEATS = 12;

export function saveAndLoad(state: WorldState): WorldState {
  const saved = serializeSystemicWorldState(state);
  if (!saved.ok) throw new Error(`save refused: ${saved.errors.join("; ")}`);
  const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
  if (!loaded.ok) throw new Error(`load refused: ${loaded.errors.join("; ")}`);
  return loaded.state;
}

/** The option a policy takes among those the world allows now. Ties: the first presented. */
export function choose(policy: PacingPolicy, event: ProofEvent, state: WorldState): string {
  const open = event.choices.filter(choice => isProofChoiceAvailable(choice, state));
  if (open.length === 0) throw new Error(`event '${event.id}' has no available option`);
  let best = open[0]!;
  let bestScore = policy.score(best, state);
  for (const choice of open.slice(1)) {
    const score = policy.score(choice, state);
    if (score > bestScore) {
      best = choice;
      bestScore = score;
    }
  }
  return best.id;
}

function eventOf(focus: ProofFocus) {
  return focus.kind === "event" ? { id: focus.event.id, familyId: focus.event.familyId, taxonomy: focus.event.taxonomy } : null;
}

/** Play one session of Gameplay Beats. */
export function runPacing(policy: PacingPolicy, options: PacingOptions = {}): PacingRun {
  const catalogue = options.catalogue ?? GQP_PROOF_EVENTS;
  const start = options.start ?? createGqpScenario(PACING_SEED);
  const length = options.beats ?? REFERENCE_SESSION_BEATS;
  let state = start;
  const beats: BeatRecord[] = [];

  const label = options.firstBeatLabel ?? 1;
  for (let beat = label; beat < label + length; beat += 1) {
    let opened;
    try {
      opened = beginProofBeat(state, catalogue);
    } catch (error) {
      if (options.recordDefect && error instanceof PacingDefect) {
        return { policy: policy.name, start, beats, final: state, defect: error };
      }
      throw error;
    }
    const focus = opened.focus;
    const common = {
      beat,
      worldTickFrom: state.simulation!.tick,
      turnFrom: state.turn,
      eligible: (focus.kind === "event" ? focus.selection.candidates : focus.quiet.candidates).map(c => c.eventId).sort(),
      candidates: focus.kind === "event" ? focus.selection.candidates : focus.quiet.candidates,
      patterns: focus.kind === "event" ? focus.selection.patterns : focus.quiet.patterns,
      ticksSince: focus.kind === "event" ? focus.selection.ticksSinceLastResolvedDecision : focus.quiet.ticksSinceLastResolvedDecision
    };

    if (focus.kind === "quiet") {
      const outcome = completeProofBeat(opened, catalogue);
      if (outcome.kind !== "quiet") throw new Error("unreachable");
      beats.push({
        beat,
        focus: "QUIET",
        worldTick: { from: common.worldTickFrom, to: outcome.state.simulation!.tick },
        playerTurn: { from: common.turnFrom, to: outcome.state.turn },
        eligible: common.eligible,
        candidates: common.candidates,
        patterns: common.patterns,
        rule: focus.quiet.rule,
        ticksSinceLastResolvedDecision: common.ticksSince,
        event: null,
        callback: null,
        choice: null,
        decision: null,
        consequencesApplied: [],
        developments: outcome.developments,
        delta: outcome.tick.delta,
        after: outcome.state
      });
      state = outcome.state;
    } else {
      const choiceId = choose(policy, focus.event, state);
      const outcome = completeProofBeat(opened, catalogue, choiceId);
      if (outcome.kind !== "event") throw new Error("unreachable");
      beats.push({
        beat,
        focus: "EVENT",
        worldTick: { from: common.worldTickFrom, to: outcome.state.simulation!.tick },
        playerTurn: { from: common.turnFrom, to: outcome.state.turn },
        eligible: common.eligible,
        candidates: common.candidates,
        patterns: common.patterns,
        rule: focus.selection.rule,
        ticksSinceLastResolvedDecision: common.ticksSince,
        event: eventOf(focus),
        callback: focus.selection.callback,
        choice: choiceId,
        decision: outcome.decision,
        consequencesApplied: outcome.consequences.appliedIds,
        developments: [],
        delta: { ...outcome.delta, changes: [...outcome.delta.changes, ...outcome.consequences.delta.changes] },
        after: outcome.state
      });
      state = outcome.state;
    }
    if (options.saveAfter?.includes(beat)) state = saveAndLoad(state);
  }
  return { policy: policy.name, start, beats, final: state, defect: null };
}

/** A readable one-line-per-beat rendering of a run. Presentation only. */
export function renderRun(run: PacingRun, catalogue: readonly ProofEvent[] = GQP_PROOF_EVENTS): string {
  const lines = [`=== ${run.policy}`];
  for (const beat of run.beats) {
    const head = `BEAT ${String(beat.beat).padStart(2, "0")} ${beat.focus.padEnd(5)} tick ${beat.worldTick.from}->${beat.worldTick.to} turn ${beat.playerTurn.from}->${beat.playerTurn.to} [${beat.rule}]`;
    if (beat.focus === "QUIET") {
      lines.push(`${head} shows: ${beat.developments.map(describeDevelopment).join("; ")}`);
      continue;
    }
    const chosen = beat.candidates[0]!;
    lines.push(
      `${head} ${beat.event!.id} (${beat.event!.familyId}, ${beat.event!.taxonomy}) -> ${beat.choice}` +
        ` | u${chosen.urgency.total} r${chosen.relevance.total} -rep${chosen.repetition.penalty} = ${chosen.priority}` +
        ` | callback ${beat.callback ? describeCallback(beat.callback) : "none"}` +
        (beat.consequencesApplied.length ? ` | landed ${beat.consequencesApplied.join(", ")}` : "")
    );
  }
  const reading = readProofWorld(run.final, catalogue);
  if (run.defect) lines.push(`DEFECT ${run.defect.message}`);
  lines.push(`final: tick ${reading.worldTick}, turn ${reading.playerTurn}, epidemic ${reading.epidemic.stage} ${reading.epidemic.value}, patterns ${detectPatterns(run.final).map(m => `${m.pattern}(${m.subject})`).join(", ") || "none"}`);
  return lines.join("\n");
}

export function describeDevelopment(d: QuietDevelopment): string {
  switch (d.kind) {
    case "pressure_stage":
      return `${d.pressure} ${d.from}->${d.to}`;
    case "pressure_shift":
      return `epidemic ${d.from}->${d.to} (${d.causes.join("+")})`;
    case "signal":
      return `signal ${d.eventId}`;
    case "option":
      return `option ${d.change} ${d.option}`;
    case "agenda":
      return `agenda ${d.agendaId} ${d.satisfied ? "met" : "open"}`;
    case "character":
      return `memory ${d.characterId}/${d.memoryId}`;
    case "faction":
      return `faction ${d.factionId} ${d.tag}`;
    case "standing":
      return `${d.groupId} approval ${d.from}->${d.to}`;
    case "shortage":
      return `shortage ${d.key} ${d.active ? "on" : "off"}`;
  }
}

/** `type source-id actor <- origin choice`, from the typed callback alone. */
export function describeCallback(c: CausalCallback): string {
  const from = (d: { eventId: string; choiceId: string } | null) => (d ? ` <- ${d.eventId}:${d.choiceId}` : "");
  switch (c.kind) {
    case "memory":
      return `memory ${c.memoryId} (${c.characterId})${from(c.decision)}`;
    case "pattern":
      return `pattern ${c.pattern} (${c.subject})${from(c.decision)}`;
    case "consequence":
      return `consequence ${c.consequenceId}${from(c.decision)}`;
    case "agenda":
      return `agenda ${c.agendaId} (${c.factionId})`;
    case "pressure":
      return `pressure epidemic/${c.cause}${from(c.decision)}`;
  }
}
