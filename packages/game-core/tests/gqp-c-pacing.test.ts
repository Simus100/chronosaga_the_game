import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  agendaConditionHolds,
  createGqpScenario,
  detectPatterns,
  developmentReason,
  factionDebtCount,
  findProofEvent,
  isFactPublic,
  readProofWorld
} from "../src";
import {
  POLICY_A,
  POLICY_B,
  REFERENCE_SESSION_BEATS,
  runPacing,
  type BeatRecord,
  type PacingRun
} from "./support/pacing-harness";

/**
 * The GQP-C exit (spec 25): reference runs of 12-15 Gameplay Beats, with no
 * hardcoded sequence, and materially different stories under different
 * choices from the same seed.
 *
 * The harness receives only the focus the selector returns. Policy A and
 * policy B choose an option by what its typed effects do; neither can choose
 * an event, and neither can see a beat number.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

const runs = new Map<string, PacingRun>();
function reference(name: "A" | "B"): PacingRun {
  let run = runs.get(name);
  if (!run) {
    run = runPacing(name === "A" ? POLICY_A : POLICY_B);
    runs.set(name, run);
  }
  return run;
}

const events = (run: PacingRun) => run.beats.filter((beat): beat is BeatRecord & { event: NonNullable<BeatRecord["event"]> } => beat.focus === "EVENT");
const quiets = (run: PacingRun) => run.beats.filter(beat => beat.focus === "QUIET");

describe("the reference runs are sessions, not scripts", () => {
  it.each(["A", "B"] as const)("%s: 12 beats; the quiet contract holds at every beat", name => {
    const run = reference(name);
    expect(REFERENCE_SESSION_BEATS).toBe(12);
    expect(run.beats).toHaveLength(12);
    expect(run.defect).toBeNull();
    for (const beat of quiets(run)) {
      // A quiet beat decides nothing, advances exactly one tick, and shows something.
      expect(beat.playerTurn.to).toBe(beat.playerTurn.from);
      expect(beat.worldTick.to).toBe(beat.worldTick.from + 1);
      expect(beat.developments.length).toBeGreaterThan(0);
      for (const development of beat.developments) expect(developmentReason(development)).toMatch(/^[A-Z_]+$/);
    }
    for (const beat of events(run)) {
      expect(beat.playerTurn.to).toBe(beat.playerTurn.from + 1);
      expect(beat.worldTick.to).toBe(beat.worldTick.from);
    }
    // Never two quiet beats in a row: the bound is one World Tick.
    run.beats.forEach((beat, index) => {
      if (index > 0 && beat.focus === "QUIET") expect(run.beats[index - 1]!.focus).toBe("EVENT");
    });
  });

  it("makes 6-7 decisions in 12 beats -- what the one-tick bound and the network produce, not a target forced", () => {
    // Recorded, not tuned: A decides six times and B seven; B's extra decision
    // is a CRISIS the selector may not defer and a debt call with four causal
    // references, both pre-empting a quiet beat. The 4-6 target of spec 15 is
    // approximate and is validated with players in GQP-D.
    expect(events(reference("A"))).toHaveLength(6);
    expect(events(reference("B"))).toHaveLength(7);
    expect(quiets(reference("A"))).toHaveLength(6);
    expect(quiets(reference("B"))).toHaveLength(5);
  });

  it("answers only the event the selector presented, with an option that was open", () => {
    for (const run of [reference("A"), reference("B")]) {
      for (const beat of events(run)) {
        expect(beat.event.id).toBe(beat.chosen!.eventId);
        // In these runs every presented event is also the top of the ranking.
        expect(beat.chosen).toBe(beat.candidates[0]);
        const before = run.beats[beat.beat - 2]?.after ?? run.start;
        const choice = findProofEvent(CATALOGUE, beat.event.id).choices.find(c => c.id === beat.choice)!;
        expect(choice, `${beat.event.id}:${beat.choice}`).toBeDefined();
        expect(beat.decision!.eventId).toBe(beat.event.id);
        expect(before.turn).toBe(beat.playerTurn.from);
      }
    }
  });

  it("keeps event and option ids out of the policies: they score typed effects", () => {
    const source = readFileSync(fileURLToPath(new URL("./support/pacing-harness.ts", import.meta.url)), "utf8");
    const policies = source.slice(source.indexOf("function effectsOf"), source.indexOf("export interface BeatRecord"));
    expect(policies).not.toMatch(/evt_/);
    expect(policies).not.toMatch(/"(patch_and_defer|tap_quietly|full_maintenance|league_convoy|treat_now|protect_reserve)"/);
    expect(policies).not.toMatch(/beat/);
  });

  it("cannot see the beat index: renumbering the telemetry changes nothing the Core decides", () => {
    const relabelled = runPacing(POLICY_B, { firstBeatLabel: 101 });
    const strip = (run: PacingRun) => run.beats.map(({ beat: _beat, ...rest }) => rest);
    expect(strip(relabelled)).toEqual(strip(reference("B")));
    expect(relabelled.final).toEqual(reference("B").final);
  });
});

describe("run A: conservative, transparent, self-reliant", () => {
  it("never keeps a secret, never takes a debt, declares its line, and meets all five families", () => {
    const run = reference("A");
    const reading = readProofWorld(run.final, CATALOGUE);
    // No line of play forms a pattern in twelve beats: no ignored warning, no
    // dependency, no secret, and one protection against one rationing.
    expect(detectPatterns(run.final)).toEqual([]);
    for (const faction of ["faction_front", "faction_compact"]) expect(factionDebtCount(run.final, faction)).toBe(0);
    expect(reading.publicFacts).toContain("fact_f3_line_registered");
    expect(events(run).map(beat => beat.event.familyId)).toEqual(
      expect.arrayContaining(["unregistered_conduit", "maintenance", "scarcity_triage", "external_rescue", "public_accountability"])
    );
  });
});

describe("run B: expedient, secretive, help-prone", () => {
  const run = () => reference("B");
  const seen = () => new Set(run().beats.flatMap(beat => beat.patterns.map(match => `${match.pattern}(${match.subject})`)));

  it("keeps a secret line", () => {
    expect(events(run()).some(beat => beat.choice === "tap_quietly")).toBe(true);
  });

  it("grows a dependency on the League: the plain offer closes, the terms open, and the League presents its ledger", () => {
    expect(seen()).toContain("FACTION_DEPENDENCY_GROWING(faction_front)");
    const shown = quiets(run()).flatMap(beat => beat.developments);
    expect(shown).toContainEqual({ kind: "option", option: "evt_f5_medical_relief:league_medics_on_terms", change: "opened" });
    expect(events(run()).map(beat => beat.event.id)).toContain("evt_f5_league_calls_in");
  });

  it("has its secret discovered -- and answers for it", () => {
    expect(seen()).toContain("SECRET_ACTION_DISCOVERED(fact_f3_secret_tap)");
    expect(events(run()).map(beat => beat.event.id)).toContain("evt_f4_conduit_exposed");
  });

  it("meets a crisis the selector would not defer", () => {
    const crisis = events(run()).filter(beat => beat.event.taxonomy === "CRISIS_PAYOFF");
    expect(crisis.length).toBeGreaterThan(0);
    expect(crisis.some(beat => beat.rule === "mandatory")).toBe(true);
  });
});

describe("A and B diverge materially, measured category by category", () => {
  const a = () => reference("A");
  const b = () => reference("B");
  const stocks = (w: WorldState) => sim(w).settlements[0]!.resourceStock;
  const approvals = (w: WorldState) => sim(w).politicalGroups.map(group => group.approval);
  const agenda = (w: WorldState) => sim(w).factionAgenda.map(item => agendaConditionHolds(item.condition, w));
  const publicFacts = (w: WorldState) => readProofWorld(w, CATALOGUE).publicFacts;
  const patternsSeen = (run: PacingRun) => [...new Set(run.beats.flatMap(beat => beat.patterns.map(m => `${m.pattern}(${m.subject})`)))].sort();
  const debts = (w: WorldState) => ["faction_compact", "faction_front"].map(faction => factionDebtCount(w, faction));
  const callbacks = (run: PacingRun) => events(run).map(beat => (beat.callback ? `${beat.callback.kind}` : "none"));

  it.each([
    ["resources", (r: PacingRun) => stocks(r.final)],
    ["pressures", (r: PacingRun) => [sim(r.final).epidemic.value, readProofWorld(r.final, CATALOGUE).infrastructure]],
    ["political approval and stability", (r: PacingRun) => [approvals(r.final), sim(r.final).settlements[0]!.stability]],
    ["faction agenda", (r: PacingRun) => agenda(r.final)],
    ["public knowledge", (r: PacingRun) => publicFacts(r.final)],
    ["detector activations", (r: PacingRun) => patternsSeen(r)],
    ["event sequence", (r: PacingRun) => events(r).map(beat => beat.event.id)],
    ["family sequence", (r: PacingRun) => events(r).map(beat => beat.event.familyId)],
    ["dependency", (r: PacingRun) => debts(r.final)],
    ["causal callbacks", (r: PacingRun) => callbacks(r)]
  ])("differ in %s", (_category, measure) => {
    expect(measure(a())).not.toEqual(measure(b()));
  });

  it("start from the same world: the divergence is the decisions", () => {
    expect(a().start).toEqual(b().start);
    expect(a().start).toEqual(createGqpScenario(7419));
  });

  it("skip different families, and neither follows a fixed F1 -> F5 order", () => {
    const order = (run: PacingRun) => [...new Set(events(run).map(beat => beat.event.familyId))];
    expect(order(a())).not.toEqual(order(b()));
    const fixed = ["scarcity_triage", "maintenance", "unregistered_conduit", "public_accountability", "external_rescue"];
    expect(order(a())).not.toEqual(fixed);
    expect(order(b())).not.toEqual(fixed);
  });

  it("keep B's secret local until a decision publishes it -- never a hive mind", () => {
    for (const beat of b().beats) {
      const state = beat.after;
      const holders = state.party.filter(c => (c.memories ?? []).some(m => m.id === "fact_f3_secret_tap")).length;
      if (holders > 0 && !isFactPublic(state, sim(state), "fact_f3_secret_tap")) expect(holders).toBe(1);
    }
  });
});

describe("save and load anywhere in a session resumes the same session", () => {
  /** The beat indices (1-based) the matrix saves after, for each run. */
  function savePoints(run: PacingRun): Record<string, number> {
    const firstEvent = run.beats.find(beat => beat.focus === "EVENT")!.beat;
    const firstQuietAfterEvent = run.beats.find(beat => beat.focus === "QUIET" && beat.beat > firstEvent)!.beat;
    const beforeBound = run.beats.find(beat => beat.focus === "EVENT" && run.beats[beat.beat]?.focus === "QUIET")!.beat;
    const patternOn = run.beats.find(beat => detectPatterns(beat.after).length > 0)?.beat;
    const beforeF5 = run.beats.find(beat => beat.event?.familyId === "external_rescue")!.beat - 1;
    const afterRescue = run.beats.find(beat => beat.event?.familyId === "external_rescue")!.beat;
    const points: Record<string, number> = {
      "after a decision": firstEvent,
      "after a quiet tick": firstQuietAfterEvent,
      "inside the quiet window, before the bound": beforeBound,
      "before F5": beforeF5,
      "after a rescue": afterRescue
    };
    if (patternOn !== undefined) points["after a detector turns on"] = patternOn;
    const discovery = run.beats.find(beat => detectPatterns(beat.after).some(m => m.pattern === "SECRET_ACTION_DISCOVERED"))?.beat;
    if (discovery !== undefined) points["after a discovery"] = discovery;
    return points;
  }

  it.each(["A", "B"] as const)("%s: every save point resumes to the same beats and the same world", name => {
    const policy = name === "A" ? POLICY_A : POLICY_B;
    const uninterrupted = reference(name);
    const points = savePoints(uninterrupted);
    if (name === "B") {
      expect(Object.keys(points)).toContain("after a discovery");
      expect(Object.keys(points)).toContain("after a detector turns on");
    }
    for (const [label, beat] of Object.entries(points)) {
      const resumed = runPacing(policy, { saveAfter: [beat] });
      const selection = (run: PacingRun) => run.beats.map(b => [b.focus, b.event?.id ?? null, b.choice, b.rule, b.candidates.map(c => c.priority)]);
      expect(selection(resumed), label).toEqual(selection(uninterrupted));
      expect(JSON.stringify(resumed.final), label).toBe(JSON.stringify(uninterrupted.final));
    }
  });

  it("saving after every single beat changes nothing", () => {
    const every = Array.from({ length: REFERENCE_SESSION_BEATS }, (_, index) => index + 1);
    for (const [policy, name] of [[POLICY_A, "A"], [POLICY_B, "B"]] as const) {
      const resumed = runPacing(policy, { saveAfter: every });
      expect(JSON.stringify(resumed.final)).toBe(JSON.stringify(reference(name).final));
    }
  });
});
