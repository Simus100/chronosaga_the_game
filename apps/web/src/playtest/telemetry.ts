import { inspectProofStep, readPressures, type CausalCallback, type PressureReading } from "@paa/game-core";
import type { StateDelta, WorldState } from "@paa/game-types";
import { PROOF_CATALOGUE, type ProofSession } from "../gameplay/proof-controller";
import type { BuildInfo } from "./build-info";

/**
 * Founder-playtest telemetry (GQP spec 22), local and append-only.
 *
 * Telemetry is an observer. It reads the sessions the proof controller already
 * produced -- after the Core produced them -- and writes lines to a local
 * file. Nothing flows back: the controller never receives a recorder, the
 * Core never sees one, and no value written here is an input to selection, to
 * a detector, to the save or to either clock. The Gameplay Beat index lives
 * here and only here (spec 4.3).
 *
 * Local-first by construction: the only sink is a file in the app's own data
 * directory (or memory, in tests). No network, no upload, no account.
 *
 * Decision time is UI telemetry: from the moment an event's options are on
 * screen (after any prediction prompt) to the click, on the monotonic clock.
 * Time the window spent hidden or minimised inside that interval is recorded
 * separately as `hiddenMs` and is NOT subtracted: the raw figure and the hidden
 * share are both kept, and the reader decides.
 */

export const TELEMETRY_SCHEMA = "chronosaga.playtest.telemetry/1";

/** The founder-sample window of spec 20: 12–15 Gameplay Beats. Telemetry only. */
export const SAMPLE_TARGET = { min: 12, max: 15 } as const;

/** The founder gate can only be decided by the founder. The software never says otherwise. */
export const FOUNDER_GATE_STATUS = "PENDING HUMAN PLAYTEST";

export type PlaytestFile =
  | "telemetry.jsonl"
  | "summary.json"
  | "final_save.json"
  | "founder_answers.json"
  | "founder_answers.md"
  | "build.json";

/** Where telemetry lines and bundle files go. */
export interface TelemetrySink {
  /** Human-readable location of the session directory, once known. */
  location(sessionId: string): Promise<string | null>;
  append(sessionId: string, line: string): Promise<void>;
  write(sessionId: string, file: PlaytestFile, content: string): Promise<string | null>;
}

/** An in-memory sink: tests, and the browser build where no file system exists. */
export function memorySink(): TelemetrySink & { lines: Record<string, string[]>; files: Record<string, string> } {
  const lines: Record<string, string[]> = {};
  const files: Record<string, string> = {};
  return {
    lines,
    files,
    async location() {
      return null;
    },
    async append(sessionId, line) {
      (lines[sessionId] ??= []).push(line);
    },
    async write(sessionId, file, content) {
      files[`${sessionId}/${file}`] = content;
      return null;
    }
  };
}

/** A telemetry identity: readable in a folder listing, never part of a replay. */
export function newSessionId(now: Date = new Date(), random: () => string = randomSuffix): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `session_${stamp}_${random()}`;
}

function randomSuffix(): string {
  const bytes = new Uint8Array(3);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface Clocks {
  readonly playerTurn: number;
  readonly worldTick: number;
}

const clocks = (state: WorldState): Clocks => ({ playerTurn: state.turn, worldTick: state.simulation?.tick ?? 0 });

export interface DecisionTiming {
  /** Options on screen → click, monotonic clock. */
  readonly decisionTimeMs: number;
  /** Of which the window was hidden. Not subtracted. */
  readonly hiddenMs: number;
}

export interface BeatRecord {
  readonly type: "beat";
  readonly schema: typeof TELEMETRY_SCHEMA;
  readonly sessionId: string;
  readonly beatIndex: number;
  readonly at: string;
  readonly focus: "EVENT" | "QUIET";
  /** At selection time (when the beat was offered) and after it completed. */
  readonly clock: { readonly before: Clocks; readonly after: Clocks };
  readonly presentedEventId: string | null;
  readonly familyId: string | null;
  readonly taxonomy: string | null;
  /** Every eligible event the selector scored, in its ranking order. */
  readonly eligibleEventIds: readonly string[];
  readonly selection: {
    readonly reason: string;
    readonly quietBoundReached: boolean | null;
    readonly ticksSinceLastResolvedDecision: number;
    readonly urgency: number | null;
    readonly relevance: number | null;
    readonly repetition: number | null;
    readonly priority: number | null;
    readonly tieBreak: boolean | null;
    readonly candidates: readonly {
      readonly eventId: string;
      readonly familyId: string;
      readonly urgency: number;
      readonly relevance: number;
      readonly repetition: number;
      readonly priority: number;
    }[];
  };
  readonly choiceId: string | null;
  readonly choiceDecisionTimeMs: number | null;
  readonly hiddenMs: number | null;
  readonly stateDelta: StateDelta;
  /** Consequences that fell due on this beat, with the decision that scheduled them. */
  readonly delayedConsequences: {
    readonly applied: readonly { readonly id: string; readonly source: string; readonly triggerTurn: number }[];
    readonly scheduled: readonly string[];
    readonly appliedDelta: StateDelta | null;
  };
  readonly pressure: { readonly before: PressureSummary; readonly after: PressureSummary };
  readonly memoriesCreated: readonly { readonly characterId: string; readonly memoryId: string; readonly origin: string | null; readonly behaviorHook: string | null }[];
  readonly agendaChanges: readonly { readonly agendaId: string; readonly before: boolean; readonly after: boolean }[];
  readonly optionsOpened: readonly string[];
  readonly optionsClosed: readonly string[];
  /** QUIET only: what the World Tick showed. */
  readonly developments: readonly unknown[];
  /** The Core's callback shown with the event, and the sentence the screen drew from it. */
  readonly callbackShown: { readonly callback: CausalCallback; readonly text: string | null } | null;
  readonly sampleTargetReached: boolean;
}

export interface PressureSummary {
  readonly epidemic: { readonly value: number; readonly stage: string; readonly topCauses: readonly string[] };
  readonly infrastructure: readonly { readonly settlementId: string; readonly value: number; readonly stage: string }[];
}

function summarizePressure(reading: PressureReading): PressureSummary {
  return {
    epidemic: { value: reading.epidemic.value, stage: reading.epidemic.stage, topCauses: reading.epidemic.contributors.slice(0, 3).map(item => item.cause) },
    infrastructure: reading.infrastructure.map(item => ({ settlementId: item.settlementId, value: item.value, stage: item.stage }))
  };
}

/**
 * One Gameplay Beat, as a record. Pure: reads two sessions the controller
 * produced and returns data. `presented` is the session that offered the beat;
 * `after` is the one its completion produced (its `last` is that completion).
 */
export function beatRecord(
  identity: { readonly sessionId: string; readonly beatIndex: number; readonly at: string },
  presented: ProofSession,
  after: ProofSession,
  timing: DecisionTiming | null,
  callbackText: string | null
): BeatRecord {
  const beat = presented.beat;
  const step = after.last;
  if (!beat || !step) throw new Error("A beat record needs a completed beat");
  const before = step.before;
  const inspection = inspectProofStep(before, after.state, PROOF_CATALOGUE);
  const focus = beat.focus;
  const candidates = (focus.kind === "event" ? focus.selection.candidates : focus.quiet.candidates).map(candidate => ({
    eventId: candidate.eventId,
    familyId: candidate.familyId,
    urgency: candidate.urgency.total,
    relevance: candidate.relevance.total,
    repetition: candidate.repetition.penalty,
    priority: candidate.priority
  }));

  const consequenceSource = (id: string) => after.state.simulation?.delayedConsequences.find(item => item.id === id);
  const applied =
    step.kind === "event"
      ? step.outcome.consequences.appliedIds.map(id => {
          const consequence = consequenceSource(id);
          return { id, source: consequence?.source.id ?? "unknown", triggerTurn: consequence?.triggerTurn ?? 0 };
        })
      : [];

  const chosen = focus.kind === "event" ? focus.selection.chosen : null;
  return {
    type: "beat",
    schema: TELEMETRY_SCHEMA,
    sessionId: identity.sessionId,
    beatIndex: identity.beatIndex,
    at: identity.at,
    focus: focus.kind === "event" ? "EVENT" : "QUIET",
    clock: { before: clocks(before), after: clocks(after.state) },
    presentedEventId: focus.kind === "event" ? focus.event.id : null,
    familyId: focus.kind === "event" ? focus.event.familyId : null,
    taxonomy: focus.kind === "event" ? focus.event.taxonomy : null,
    eligibleEventIds: candidates.map(candidate => candidate.eventId),
    selection: {
      reason: focus.kind === "event" ? focus.selection.rule : focus.quiet.rule,
      quietBoundReached: focus.kind === "event" ? focus.selection.quietBoundReached : null,
      ticksSinceLastResolvedDecision: focus.kind === "event" ? focus.selection.ticksSinceLastResolvedDecision : focus.quiet.ticksSinceLastResolvedDecision,
      urgency: chosen?.urgency.total ?? null,
      relevance: chosen?.relevance.total ?? null,
      repetition: chosen?.repetition.penalty ?? null,
      priority: chosen?.priority ?? null,
      tieBreak: focus.kind === "event" ? focus.selection.tieBreak : null,
      candidates
    },
    choiceId: step.kind === "event" ? step.choiceId : null,
    choiceDecisionTimeMs: step.kind === "event" && timing ? Math.round(timing.decisionTimeMs) : null,
    hiddenMs: step.kind === "event" && timing ? Math.round(timing.hiddenMs) : null,
    stateDelta: step.kind === "event" ? step.outcome.delta : step.outcome.tick.delta,
    delayedConsequences: {
      applied,
      scheduled: [...inspection.consequencesScheduled],
      appliedDelta: step.kind === "event" && applied.length > 0 ? step.outcome.consequences.delta : null
    },
    pressure: { before: summarizePressure(readPressures(before)), after: summarizePressure(readPressures(after.state)) },
    memoriesCreated: inspection.newMemories.map(memory => ({ ...memory })),
    agendaChanges: inspection.agendaChanged.map(change => ({ ...change })),
    optionsOpened: [...inspection.optionsOpened],
    optionsClosed: [...inspection.optionsClosed],
    developments: step.kind === "quiet" ? step.outcome.developments.map(item => ({ ...item })) : [],
    callbackShown: focus.kind === "event" && focus.selection.callback ? { callback: focus.selection.callback, text: callbackText } : null,
    sampleTargetReached: identity.beatIndex >= SAMPLE_TARGET.min
  };
}

/** SHA-256 of a save payload, so a save in one session can be matched to a load in the next. */
export async function digest(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export interface NpcPrediction {
  readonly characterId: string;
  readonly prediction: string;
  readonly reason: string;
  /** Where the prediction was asked: before a revealed event, or freely from the overlay. */
  readonly trigger: "before_reaction" | "manual";
  /** For `before_reaction`: the event the founder then saw, and the Core callback that names the character. */
  readonly actual: { readonly eventId: string; readonly title: string; readonly callback: CausalCallback | null } | null;
}

export interface TelemetrySummary {
  readonly schema: typeof TELEMETRY_SCHEMA;
  readonly sessionId: string;
  readonly build: BuildInfo;
  readonly mode: "gameplay_quality_proof";
  readonly seed: number;
  readonly campaignId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly beats: number;
  readonly events: number;
  readonly quiets: number;
  readonly saves: number;
  readonly loads: number;
  readonly predictions: number;
  readonly sampleTarget: { readonly min: number; readonly max: number; readonly reached: boolean };
  readonly questionnaireCompleted: boolean;
  readonly founderGate: typeof FOUNDER_GATE_STATUS;
  readonly telemetryErrors: readonly string[];
}

export interface Telemetry {
  readonly sessionId: string;
  readonly beatIndex: number;
  readonly errors: readonly string[];
  location(): Promise<string | null>;
  start(session: ProofSession, seed: number): Promise<void>;
  beat(presented: ProofSession, after: ProofSession, timing: DecisionTiming | null, callbackText: string | null): Promise<BeatRecord>;
  save(state: WorldState, outcome: { ok: boolean; message?: string; bytes?: number }, payload: string | null): Promise<void>;
  load(outcome: { ok: boolean; reason?: string; message?: string }, state: WorldState | null, payload: string | null): Promise<void>;
  defect(state: WorldState, reason: string, message: string): Promise<void>;
  prediction(prediction: NpcPrediction, state: WorldState): Promise<void>;
  questionnaire(completed: boolean): Promise<void>;
  summary(): TelemetrySummary;
  writeFile(file: PlaytestFile, content: string): Promise<string | null>;
  /** Resolves once every write issued so far has finished (or failed). */
  flush(): Promise<void>;
}

/**
 * The recorder for one playtest session. Writes are chained so lines keep
 * their order; a failed write is kept in `errors` (and shown by the screen),
 * never thrown into play.
 */
export function createTelemetry(options: {
  readonly sink: TelemetrySink;
  readonly build: BuildInfo;
  readonly sessionId?: string;
  readonly now?: () => Date;
  readonly onError?: (message: string) => void;
}): Telemetry {
  const now = options.now ?? (() => new Date());
  const sessionId = options.sessionId ?? newSessionId(now());
  const errors: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let beatIndex = 0;
  let counts = { events: 0, quiets: 0, saves: 0, loads: 0, predictions: 0 };
  let seed = 0;
  let campaignId = "";
  const startedAt = now().toISOString();
  let questionnaireCompleted = false;

  const fail = (what: string, error: unknown) => {
    const message = `${what}: ${(error as Error)?.message ?? String(error)}`;
    errors.push(message);
    options.onError?.(message);
  };

  const enqueue = (work: () => Promise<unknown>, what: string) => {
    chain = chain.then(() => work().then(() => undefined)).catch(error => fail(what, error));
    return chain;
  };

  const line = (record: object) => enqueue(() => options.sink.append(sessionId, JSON.stringify(record)), "telemetria");
  const base = (type: string, state: WorldState | null) => ({
    type,
    schema: TELEMETRY_SCHEMA,
    sessionId,
    beatIndex,
    at: now().toISOString(),
    clock: state ? clocks(state) : null
  });

  const summary = (): TelemetrySummary => ({
    schema: TELEMETRY_SCHEMA,
    sessionId,
    build: options.build,
    mode: "gameplay_quality_proof",
    seed,
    campaignId,
    startedAt,
    updatedAt: now().toISOString(),
    beats: beatIndex,
    events: counts.events,
    quiets: counts.quiets,
    saves: counts.saves,
    loads: counts.loads,
    predictions: counts.predictions,
    sampleTarget: { ...SAMPLE_TARGET, reached: beatIndex >= SAMPLE_TARGET.min },
    questionnaireCompleted,
    founderGate: FOUNDER_GATE_STATUS,
    telemetryErrors: [...errors]
  });

  const writeSummary = () => enqueue(() => options.sink.write(sessionId, "summary.json", JSON.stringify(summary(), null, 2)), "riepilogo");

  return {
    sessionId,
    get beatIndex() {
      return beatIndex;
    },
    get errors() {
      return [...errors];
    },
    location: () => options.sink.location(sessionId),
    async start(session, startSeed) {
      seed = startSeed;
      campaignId = session.state.campaignId;
      enqueue(() => options.sink.write(sessionId, "build.json", JSON.stringify(options.build, null, 2)), "build");
      await line({ ...base("session_start", session.state), build: options.build, mode: "gameplay_quality_proof", seed, campaignId, founderGate: FOUNDER_GATE_STATUS });
      await writeSummary();
    },
    async beat(presented, after, timing, callbackText) {
      beatIndex += 1;
      const record = beatRecord({ sessionId, beatIndex, at: now().toISOString() }, presented, after, timing, callbackText);
      if (record.focus === "EVENT") counts = { ...counts, events: counts.events + 1 };
      else counts = { ...counts, quiets: counts.quiets + 1 };
      await line(record);
      if (beatIndex === SAMPLE_TARGET.min) await line({ ...base("sample_target_reached", after.state), message: "Founder sample target reached" });
      await writeSummary();
      return record;
    },
    async save(state, outcome, payload) {
      counts = { ...counts, saves: counts.saves + 1 };
      await line({ ...base("save", state), campaignId: state.campaignId, ok: outcome.ok, message: outcome.message ?? null, bytes: outcome.bytes ?? null, worldDigest: payload ? await digest(payload) : null, history: state.simulation && "resolvedHistory" in state.simulation ? state.simulation.resolvedHistory.length : null });
      await writeSummary();
    },
    async load(outcome, state, payload) {
      counts = { ...counts, loads: counts.loads + 1 };
      if (state) campaignId = state.campaignId;
      await line({ ...base("load", state), ok: outcome.ok, reason: outcome.reason ?? null, message: outcome.message ?? null, worldDigest: payload ? await digest(payload) : null, history: state?.simulation && "resolvedHistory" in state.simulation ? state.simulation.resolvedHistory.length : null });
      await writeSummary();
    },
    async defect(state, reason, message) {
      await line({ ...base("pacing_defect", state), reason, message });
    },
    async prediction(prediction, state) {
      counts = { ...counts, predictions: counts.predictions + 1 };
      await line({ ...base("npc_prediction", state), ...prediction });
      await writeSummary();
    },
    async questionnaire(completed) {
      questionnaireCompleted = completed;
      await line({ ...base("questionnaire", null), completed });
      await writeSummary();
    },
    summary,
    writeFile(file, content) {
      let path: string | null = null;
      return enqueue(async () => {
        path = await options.sink.write(sessionId, file, content);
      }, file).then(() => path);
    },
    flush: () => chain
  };
}
