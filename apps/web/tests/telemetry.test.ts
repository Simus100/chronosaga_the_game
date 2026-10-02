import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  advanceQuietBeat,
  describeOptions,
  loadProofGame,
  newProofGame,
  playProofChoice,
  proofPayload,
  saveProofGame,
  type ProofSession
} from "../src/gameplay/proof-controller";
import type { SystemicPersistence } from "../src/platform/persistence";
import {
  FOUNDER_GATE_STATUS,
  SAMPLE_TARGET,
  beatRecord,
  createTelemetry,
  digest,
  memorySink,
  newSessionId,
  type BeatRecord,
  type Telemetry,
  type TelemetrySink
} from "../src/playtest/telemetry";

/**
 * Telemetry is an observer (GQP spec 22). These tests hold it to that: with it
 * on or off, whatever it measures and whatever it calls the beats, the world
 * and every selection are the same -- and it records what the spec asks for.
 */

const BUILD = { commit: "0123456789abcdef", branch: "test", builtAt: "2026-10-02T00:00:00.000Z" };

function store(): SystemicPersistence & { rows: Record<string, string> } {
  const rows: Record<string, string> = {};
  return {
    rows,
    async save(campaignId, payload) {
      rows[campaignId] = payload;
      return { campaignId, envelopeVersion: 1, payloadBytes: payload.length };
    },
    async load(campaignId) {
      return rows[campaignId] === undefined ? { status: "notFound" } : { status: "found", save: { campaignId, envelopeVersion: 1, payload: rows[campaignId]! } };
    }
  };
}

/** The unscripted policy of the controller tests: first open option, or let the quiet pass. */
function next(session: ProofSession, pick = 0): ProofSession {
  if (session.beat!.focus.kind === "quiet") return advanceQuietBeat(session);
  const open = describeOptions(session).filter(option => option.disclosure.available);
  return playProofChoice(session, open[pick % open.length]!.choice.id);
}

/** A run of `beats` Gameplay Beats, optionally observed by `telemetry` with the given decision times. */
async function run(beats: number, telemetry: Telemetry | null, timing: (beat: number) => number = () => 1500): Promise<ProofSession[]> {
  const sessions = [newProofGame()];
  if (telemetry) await telemetry.start(sessions[0]!, 7419);
  for (let beat = 1; beat <= beats; beat += 1) {
    const presented = sessions.at(-1)!;
    const frozen = JSON.stringify(presented.state);
    const after = next(presented);
    if (telemetry) {
      await telemetry.beat(presented, after, presented.beat!.focus.kind === "event" ? { decisionTimeMs: timing(beat), hiddenMs: 0 } : null, null);
      // The recorder read the sessions; it did not write into them.
      expect(JSON.stringify(presented.state)).toBe(frozen);
    }
    sessions.push(after);
  }
  return sessions;
}

const recordsOf = (sink: ReturnType<typeof memorySink>, sessionId: string) => (sink.lines[sessionId] ?? []).map(line => JSON.parse(line) as { type: string } & Record<string, unknown>);
const beatsOf = (sink: ReturnType<typeof memorySink>, sessionId: string) => recordsOf(sink, sessionId).filter(record => record.type === "beat") as unknown as BeatRecord[];

describe("telemetry is not authority", () => {
  it("ON and OFF: the same seed and choices give the same world and the same selections", async () => {
    const off = await run(14, null);
    const sink = memorySink();
    const on = await run(14, createTelemetry({ sink, build: BUILD }));
    expect(on.map(session => session.state)).toEqual(off.map(session => session.state));
    expect(on.map(session => session.beat?.focus ?? null)).toEqual(off.map(session => session.beat?.focus ?? null));
  });

  it("different decision times and different beat labels: the same world", async () => {
    const fast = await run(13, createTelemetry({ sink: memorySink(), build: BUILD, sessionId: "session_a" }), () => 120);
    const slow = await run(13, createTelemetry({ sink: memorySink(), build: BUILD, sessionId: "session_zz_other" }), beat => 90_000 + beat * 977);
    expect(slow.map(session => session.state)).toEqual(fast.map(session => session.state));
    expect(slow.map(session => session.beat?.focus ?? null)).toEqual(fast.map(session => session.beat?.focus ?? null));
  });

  it("never enters the world or the save: no beat index, session id or timing in the payload", async () => {
    const sink = memorySink();
    const sessions = await run(12, createTelemetry({ sink, build: BUILD, sessionId: "session_probe_123" }), () => 4321);
    const payload = proofPayload(sessions.at(-1)!.state)!;
    for (const leaked of ["session_probe_123", "beatIndex", "decisionTime", "4321", "telemetry", "sessionId"]) {
      expect(payload).not.toContain(leaked);
    }
  });

  it("the Core and the proof controller never import telemetry", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const controller = readFileSync(join(here, "../src/gameplay/proof-controller.ts"), "utf8");
    expect(controller).not.toMatch(/from "[^"]*(playtest|telemetry)/i);
    const coreDir = join(here, "../../../packages/game-core/src");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []));
    for (const file of walk(coreDir)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "[^"]*playtest|beatIndex|decisionTimeMs/);
    }
  });
});

describe("what a Gameplay Beat records (spec 22)", () => {
  it("an EVENT beat: the event, its selection, the choice, the decision time, the delta and its consequences", async () => {
    const sink = memorySink();
    const telemetry = createTelemetry({ sink, build: BUILD, sessionId: "session_event" });
    await run(6, telemetry, beat => beat * 1000);
    const event = beatsOf(sink, "session_event").find(record => record.focus === "EVENT")!;
    expect(event.presentedEventId).toMatch(/^evt_f/);
    expect(event.familyId).not.toBeNull();
    expect(event.eligibleEventIds).toContain(event.presentedEventId);
    expect(event.selection).toMatchObject({ reason: expect.any(String), quietBoundReached: expect.any(Boolean), ticksSinceLastResolvedDecision: expect.any(Number), urgency: expect.any(Number), relevance: expect.any(Number), repetition: expect.any(Number), priority: expect.any(Number) });
    expect(event.choiceId).not.toBeNull();
    expect(event.choiceDecisionTimeMs).toBe(event.beatIndex * 1000);
    expect(event.clock.after.playerTurn).toBe(event.clock.before.playerTurn + 1);
    expect(event.clock.after.worldTick).toBe(event.clock.before.worldTick);
    expect(event.stateDelta.changes.length).toBeGreaterThan(0);
    expect(event.pressure.before.epidemic.stage).toMatch(/STABLE|STRAINED|CRITICAL|CRISIS/);
    expect(event.memoriesCreated.length).toBeGreaterThan(0);
  });

  it("a QUIET beat: no choice, no decision time, the Player Turn unchanged, one World Tick, its developments", async () => {
    const sink = memorySink();
    await run(4, createTelemetry({ sink, build: BUILD, sessionId: "session_quiet" }));
    const quiet = beatsOf(sink, "session_quiet").find(record => record.focus === "QUIET")!;
    expect(quiet.presentedEventId).toBeNull();
    expect(quiet.choiceId).toBeNull();
    expect(quiet.choiceDecisionTimeMs).toBeNull();
    expect(quiet.clock.after.playerTurn).toBe(quiet.clock.before.playerTurn);
    expect(quiet.clock.after.worldTick).toBe(quiet.clock.before.worldTick + 1);
    expect(quiet.developments.length).toBeGreaterThan(0);
    expect(quiet.selection.reason).toMatch(/nothing_presses|nothing_eligible/);
  });

  it("records a delayed consequence with the decision that scheduled it, and the callback shown", async () => {
    const sink = memorySink();
    await run(15, createTelemetry({ sink, build: BUILD, sessionId: "session_chain" }));
    const records = beatsOf(sink, "session_chain");
    const landed = records.flatMap(record => record.delayedConsequences.applied);
    expect(landed.length).toBeGreaterThan(0);
    // Every landed consequence names its cause: a decision (`eventId:choiceId`)
    // or, for the scenario's own opening pressure, its bootstrap.
    for (const consequence of landed) expect(consequence.source).not.toBe("unknown");
    expect(landed.some(consequence => /^evt_f\d_[a-z_]+:[a-z_]+$/.test(consequence.source))).toBe(true);
    expect(records.some(record => record.callbackShown !== null)).toBe(true);
  });

  it("numbers the beats 1, 2, 3 ... and marks the founder sample target at 12, without stopping play", async () => {
    const sink = memorySink();
    await run(15, createTelemetry({ sink, build: BUILD, sessionId: "session_target" }));
    const records = recordsOf(sink, "session_target");
    expect(beatsOf(sink, "session_target").map(record => record.beatIndex)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const target = records.filter(record => record.type === "sample_target_reached");
    expect(target).toHaveLength(1);
    expect(target[0]!.beatIndex).toBe(SAMPLE_TARGET.min);
    const summary = JSON.parse(sink.files["session_target/summary.json"]!);
    expect(summary).toMatchObject({ beats: 15, sampleTarget: { reached: true }, founderGate: FOUNDER_GATE_STATUS });
  });
});

describe("save and load continuity is recorded, and gameplay continuity is exact", () => {
  it("the save digest of one session is the load digest of the next, and play continues identically", async () => {
    const straight = await run(12, null);
    const disk = store();

    const first = memorySink();
    const before = createTelemetry({ sink: first, build: BUILD, sessionId: "session_before" });
    const played = await run(7, before);
    const saved = await saveProofGame(played.at(-1)!, disk);
    expect(saved.ok).toBe(true);
    await before.save(played.at(-1)!.state, { ok: true, bytes: saved.ok ? saved.bytes : 0 }, proofPayload(played.at(-1)!.state));

    // The application closes; a new telemetry session starts on relaunch.
    const second = memorySink();
    const after = createTelemetry({ sink: second, build: BUILD, sessionId: "session_after" });
    const loaded = await loadProofGame(disk);
    if (!loaded.ok) throw new Error(loaded.message);
    await after.load({ ok: true }, loaded.session.state, proofPayload(loaded.session.state));

    const saveRecord = recordsOf(first, "session_before").find(record => record.type === "save")!;
    const loadRecord = recordsOf(second, "session_after").find(record => record.type === "load")!;
    expect(saveRecord.worldDigest).toBe(await digest(disk.rows.gqp_7419!));
    expect(loadRecord.worldDigest).toBe(saveRecord.worldDigest);
    expect(loadRecord.clock).toEqual(saveRecord.clock);

    let session = loaded.session;
    for (let beat = 8; beat <= 12; beat += 1) session = next(session);
    expect(session.state).toEqual(straight.at(-1)!.state);
  });

  it("a failed load is recorded as a failure, never as a world", async () => {
    const sink = memorySink();
    const telemetry = createTelemetry({ sink, build: BUILD, sessionId: "session_failed_load" });
    const outcome = await loadProofGame(store());
    if (outcome.ok) throw new Error("expected no save");
    await telemetry.load({ ok: false, reason: outcome.reason, message: outcome.message }, null, null);
    const record = recordsOf(sink, "session_failed_load").find(item => item.type === "load")!;
    expect(record).toMatchObject({ ok: false, reason: "not_found", worldDigest: null, clock: null });
  });
});

describe("the recorder keeps play going when the disk does not", () => {
  it("keeps write failures as visible errors, in order, without throwing into play", async () => {
    const errors: string[] = [];
    const failing: TelemetrySink = {
      location: async () => null,
      append: async () => {
        throw new Error("disk full");
      },
      write: async () => null
    };
    const telemetry = createTelemetry({ sink: failing, build: BUILD, onError: message => errors.push(message) });
    const sessions = await run(3, telemetry);
    await telemetry.flush();
    expect(sessions).toHaveLength(4);
    expect(errors.length).toBeGreaterThan(0);
    expect(telemetry.errors[0]).toMatch(/disk full/);
  });

  it("names a session for a folder listing, never for a replay", () => {
    const id = newSessionId(new Date(2026, 9, 2, 14, 5, 9), () => "a1b2c3");
    expect(id).toBe("session_20261002-140509_a1b2c3");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("a beat record is pure: the same sessions give the same record", () => {
    const presented = advanceQuietBeat(newProofGame());
    const after = next(presented);
    const identity = { sessionId: "s", beatIndex: 1, at: "t" };
    expect(beatRecord(identity, presented, after, { decisionTimeMs: 10, hiddenMs: 0 }, null)).toEqual(beatRecord(identity, presented, after, { decisionTimeMs: 10, hiddenMs: 0 }, null));
  });
});
