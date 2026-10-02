import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  PROOF_SCHEMA_VERSION,
  StaleFocus,
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  createSystemicScenario,
  serializeSystemicWorldState
} from "@paa/game-core";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import type { WorldState } from "@paa/game-types";
import { choiceAvailable, focusedEvent, loadGame, newSystemicGame, playChoice, playWorldTick, saveGame } from "../src/gameplay/controller";
import {
  ChoiceUnavailable,
  PROOF_CATALOGUE,
  advanceQuietBeat,
  describeOptions,
  loadProofGame,
  newProofGame,
  playProofChoice,
  proofCampaignId,
  saveProofGame,
  type ProofSession
} from "../src/gameplay/proof-controller";
import type { SystemicPersistence } from "../src/platform/persistence";

/**
 * GQP-D: the proof wired into the app, and M1 left exactly as it was.
 *
 * Every assertion runs the real Core. The only fake is the store.
 */

function store(initial: Record<string, string> = {}): SystemicPersistence & { rows: Record<string, string>; envelope: number; broken: boolean } {
  const rows = { ...initial };
  return {
    rows,
    envelope: 1,
    broken: false,
    async save(campaignId, payload) {
      if (this.broken) throw new Error("disk full");
      rows[campaignId] = payload;
      return { campaignId, envelopeVersion: 1, payloadBytes: payload.length };
    },
    async load(campaignId) {
      if (this.broken) throw new Error("database locked");
      if (this.envelope !== 1 && rows[campaignId]) return { status: "incompatibleEnvelope", storedVersion: this.envelope, supportedVersion: 1 };
      return rows[campaignId] === undefined
        ? { status: "notFound" }
        : { status: "found", save: { campaignId, envelopeVersion: 1, payload: rows[campaignId]! } };
    }
  };
}

/** One beat by a fixed, unscripted policy: the first open option, or let the quiet beat pass. */
function step(session: ProofSession): ProofSession {
  const focus = session.beat!.focus;
  if (focus.kind === "quiet") return advanceQuietBeat(session);
  const open = describeOptions(session).find(option => option.disclosure.available)!;
  return playProofChoice(session, open.choice.id);
}

function play(session: ProofSession, beats: number): ProofSession[] {
  const sessions = [session];
  for (let i = 0; i < beats; i += 1) sessions.push(step(sessions[sessions.length - 1]!));
  return sessions;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("M1 is preserved: the baseline is a separate, unchanged mode", () => {
  it("M1 startup is unchanged: createSystemicScenario, schema v1, its own slot", () => {
    const session = newSystemicGame();
    expect(session.state).toEqual(createSystemicScenario(7419));
    expect(session.state.simulation!.schemaVersion).toBe(1);
    expect(session.state.campaignId).toBe("cmp_7419");
    expect(session.focus.kind).toBe("event");
  });

  it("M1 event selection is unchanged: the same twelve turns, to the byte", () => {
    // Recorded from the M1 controller, which GQP-D does not modify.
    const golden = [
      "evt_reservoir_rationing:release_reserve",
      "evt_recycler_maintenance:service_now",
      "evt_bridge_memory:investigate",
      "evt_reservoir_rationing:hold_reserve",
      "evt_reservoir_rationing:hold_reserve",
      "evt_reservoir_rationing:hold_reserve",
      "evt_masked_levy:pay",
      "evt_masked_levy:pay",
      "evt_bridge_memory:investigate",
      "evt_reservoir_rationing:hold_reserve",
      "evt_bridge_memory:investigate",
      "evt_masked_levy:pay"
    ];
    let session = newSystemicGame();
    const sequence: string[] = [];
    for (let i = 0; i < golden.length; i += 1) {
      const event = focusedEvent(session)!;
      const choice = event.choices.find(item => choiceAvailable(session.state, event, item.id))!;
      sequence.push(`${event.id}:${choice.id}`);
      session = playWorldTick(playChoice(session, choice.id));
    }
    expect(sequence).toEqual(golden);
    const saved = serializeSystemicWorldState(session.state);
    if (!saved.ok) throw new Error(saved.errors.join("; "));
    expect(sha(saved.payload)).toBe("c463111b7f59ca3771973b7ab87cba2a80c406f9389306cfbb7428c4d0041055");
  });

  it("M1 save/load is unchanged, and the two modes never share a slot", async () => {
    const disk = store();
    const m1 = playWorldTick(playChoice(newSystemicGame(), "release_reserve"));
    const proof = play(newProofGame(), 3).at(-1)!;
    expect((await saveGame(m1.state, disk)).ok).toBe(true);
    expect((await saveProofGame(proof, disk)).ok).toBe(true);
    expect(Object.keys(disk.rows).sort()).toEqual(["cmp_7419", "gqp_7419"]);
    const loaded = await loadGame("cmp_7419", disk);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.session.state).toEqual(m1.state);
    expect(loaded.session.state.simulation!.schemaVersion).toBe(1);
  });

  it("an M1 world is never opened as the proof: refused by name, nothing started", async () => {
    // An M1 world filed under the proof's slot, as a hand-edited save would be.
    const m1World: WorldState = { ...createSystemicScenario(7419), campaignId: "gqp_7419" };
    const m1Payload = serializeSystemicWorldState(m1World);
    if (!m1Payload.ok) throw new Error(m1Payload.errors.join("; "));
    const disk = store({ gqp_7419: m1Payload.payload });
    const outcome = await loadProofGame(disk);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("wrong_mode");
      expect(outcome.message).toMatch(/schema v1/);
    }
  });
});

describe("the proof launches through the Core, as schema v2", () => {
  it("is createGqpScenario(7419), and its first beat is the Core's own selection", () => {
    const session = newProofGame();
    expect(session.state).toEqual(createGqpScenario(7419));
    expect(session.state.simulation!.schemaVersion).toBe(PROOF_SCHEMA_VERSION);
    expect(session.state.campaignId).toBe(proofCampaignId());
    expect(session.beat!.focus).toEqual(beginProofBeat(createGqpScenario(7419), GQP_PROOF_EVENTS).focus);
    expect(session.explanation).not.toBeNull();
    expect(PROOF_CATALOGUE).toBe(GQP_PROOF_EVENTS);
  });

  it("plays exactly what the Core's lifecycle plays: the controller adds no rule", () => {
    const sessions = play(newProofGame(), 14);
    let world = createGqpScenario(7419);
    for (const session of sessions.slice(1)) {
      const beat = beginProofBeat(world, GQP_PROOF_EVENTS);
      const last = session.last!;
      world = (last.kind === "event" ? completeProofBeat(beat, GQP_PROOF_EVENTS, last.choiceId) : completeProofBeat(beat, GQP_PROOF_EVENTS)).state;
      expect(session.state).toEqual(world);
    }
    // And the run presents every family it reaches, by state, not by script.
    const families = new Set(sessions.flatMap(session => (session.beat?.focus.kind === "event" ? [session.beat.focus.event.familyId] : [])));
    expect(families.size).toBeGreaterThanOrEqual(4);
  });
});

describe("the lifecycle: EVENT and QUIET, and no way around it", () => {
  it("EVENT -> choice -> next: one Player Turn, no World Tick, one resolved decision", () => {
    const sessions = play(newProofGame(), 6);
    const [before, after] = sessions.flatMap((session, index) => (sessions[index + 1]?.last?.kind === "event" ? [session, sessions[index + 1]!] : [])).slice(0, 2) as [ProofSession, ProofSession];
    expect(after.state.turn).toBe(before.state.turn + 1);
    expect(after.state.simulation!.tick).toBe(before.state.simulation!.tick);
  });

  it("QUIET -> World Tick -> next: the Player Turn does not move, the World Tick does", () => {
    const start = newProofGame();
    expect(start.beat!.focus.kind).toBe("quiet");
    const next = advanceQuietBeat(start);
    expect(next.state.turn).toBe(start.state.turn);
    expect(next.state.simulation!.tick).toBe(start.state.simulation!.tick + 1);
    expect(next.last!.kind).toBe("quiet");
  });

  it("a quiet beat cannot be answered, and an event cannot be skipped", () => {
    const quiet = newProofGame();
    expect(() => playProofChoice(quiet, "tap_quietly")).toThrow(/Nessuna decisione/);
    const event = advanceQuietBeat(quiet);
    expect(event.beat!.focus.kind).toBe("event");
    expect(() => advanceQuietBeat(event)).toThrow(/quiete/);
  });

  it("exports no way to select again on the same world", async () => {
    const api = await import("../src/gameplay/proof-controller");
    expect(Object.keys(api).sort()).toEqual([
      "ChoiceUnavailable",
      "PROOF_CATALOGUE",
      "PROOF_SEED",
      "advanceQuietBeat",
      "describeOptions",
      "loadProofGame",
      "newProofGame",
      "playProofChoice",
      "proofCampaignId",
      "proofPayload",
      "saveProofGame"
    ]);
  });

  it("refuses an unavailable choice before touching anything", () => {
    // The first reachable event with an option the Core does not offer now.
    const session = play(newProofGame(), 14).find(item => describeOptions(item).some(option => !option.disclosure.available));
    if (!session) throw new Error("no reachable event with an unavailable option");
    const blocked = describeOptions(session).find(option => !option.disclosure.available)!;
    const snapshot = structuredClone(session.state);
    expect(() => playProofChoice(session, blocked.choice.id)).toThrow(ChoiceUnavailable);
    expect(() => playProofChoice(session, "no_such_choice")).toThrow(ChoiceUnavailable);
    expect(session.state).toEqual(snapshot);
  });

  it("rejects a stale focus: a beat that is not what the world selects", () => {
    const quiet = newProofGame();
    const event = advanceQuietBeat(quiet);
    // A beat claiming the event on the world that still selects QUIET.
    const stale: ProofSession = { ...quiet, beat: { state: quiet.state, focus: event.beat!.focus } };
    const snapshot = structuredClone(quiet.state);
    const choice = describeOptions(stale).find(option => option.disclosure.available);
    expect(() => playProofChoice(stale, choice?.choice.id ?? "tap_quietly")).toThrow(StaleFocus);
    expect(quiet.state).toEqual(snapshot);
  });

  it("fails closed, visibly, when the Core has nothing left: a defect, never a filler", () => {
    // The first content exhaustion the exhaustive GQP-C walk finds, at beat 16.
    const path = [
      "evt_f3_conduit_offer:register_the_line",
      "evt_f2_recycler_warning:divert_clinic_power",
      "evt_f1_clinic_request:treat_now",
      "evt_f5_water_convoy:league_convoy",
      "evt_f1_ira_prevention_drive:keep_ira_at_the_clinic",
      "evt_f5_medical_relief:council_field_team",
      "evt_f5_council_calls_in:repay_in_credits"
    ];
    let session = newProofGame();
    for (const decision of path) {
      session = advanceQuietBeat(session);
      const [eventId, choiceId] = decision.split(":") as [string, string];
      expect(session.beat!.focus.kind === "event" && session.beat!.focus.event.id).toBe(eventId);
      session = playProofChoice(session, choiceId);
    }
    session = advanceQuietBeat(session);
    expect(session.beat).toBeNull();
    expect(session.defect?.reason).toBe("QUIET_BOUND_REACHED_WITH_NO_ELIGIBLE_EVENT");
    expect(() => advanceQuietBeat(session)).toThrow();
    expect(() => playProofChoice(session, "anything")).toThrow();
  });
});

describe("save, close, load, continue: the world and the quiet bound survive", () => {
  it("continues identically to a run that was never saved, including inside a quiet window", async () => {
    const straight = play(newProofGame(), 12);
    for (const at of [4, 5, 9]) {
      const disk = store();
      const saved = await saveProofGame(straight[at]!, disk);
      expect(saved.ok).toBe(true);
      const loaded = await loadProofGame(disk);
      if (!loaded.ok) throw new Error(loaded.message);
      expect(loaded.session.state).toEqual(straight[at]!.state);
      expect(loaded.session.beat!.focus).toEqual(straight[at]!.beat!.focus);
      const continued = play(loaded.session, 12 - at);
      expect(continued.at(-1)!.state).toEqual(straight.at(-1)!.state);
    }
  });

  it("never turns a failed load into a new game", async () => {
    const disk = store({ gqp_7419: "{ not json" });
    const corrupted = await loadProofGame(disk);
    expect(corrupted).toMatchObject({ ok: false, reason: "corrupted" });
    expect(disk.rows.gqp_7419).toBe("{ not json");

    expect(await loadProofGame(store())).toMatchObject({ ok: false, reason: "not_found" });

    const old = store({ gqp_7419: "{}" });
    old.envelope = 2;
    expect(await loadProofGame(old)).toMatchObject({ ok: false, reason: "incompatible_envelope" });

    const locked = store();
    locked.broken = true;
    expect(await loadProofGame(locked)).toMatchObject({ ok: false, reason: "transport_error" });
  });
});
