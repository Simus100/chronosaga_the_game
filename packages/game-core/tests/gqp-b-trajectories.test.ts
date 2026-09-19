import { describe, expect, it } from "vitest";
import type { ProofEvent, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS, demoEvents, systemicEvents } from "@paa/game-data";
import {
  createGqpScenario,
  isProofEffectType,
  readAuthoritativeResource,
  readProofWorld,
  type ProofWorldReading
} from "../src";
import {
  COVERAGE_PATHS,
  PROOF_SEED,
  TRAJECTORY_A,
  TRAJECTORY_B,
  TRAJECTORY_C,
  runTrajectory,
  type Decision,
  type Trajectory
} from "./support/proof-trajectory";

/**
 * GQP-B exit evidence: named trajectories from one seed.
 *
 * A (conservative / transparent) and B (expedient / risk-taking) start from
 * the same proof world and differ only in the decisions they name. C is the
 * setback-and-recovery path. The suite records each step in the terms issue
 * #42 asks for, then asserts -- by machine, not by reading -- that the runs
 * end in materially different worlds, and that the difference survives a save
 * in the middle, a reordered catalogue and a rewrite of every display string.
 */

const CATALOGUE = GQP_PROOF_EVENTS;

function decisions(trajectory: Trajectory) {
  return trajectory.steps.filter(step => step.kind === "decision");
}

describe("GQP-B trajectories A and B: same start, different decisions", () => {
  const a = runTrajectory("A", TRAJECTORY_A);
  const b = runTrajectory("B", TRAJECTORY_B);

  it("begin from the exact same proof world", () => {
    expect(JSON.stringify(a.start)).toBe(JSON.stringify(b.start));
    expect(JSON.stringify(a.start)).toBe(JSON.stringify(createGqpScenario(PROOF_SEED)));
  });

  it("record every step with its decision, clocks, pressure, memory, agenda and consequences", () => {
    for (const trajectory of [a, b]) {
      decisions(trajectory).forEach((step, index) => {
        const i = step.inspection;
        const [eventId, choiceId] = (trajectory === a ? TRAJECTORY_A : TRAJECTORY_B)[index]!;
        expect(i.decisions).toEqual([step.decision]);
        expect(step.decision).toMatchObject({ eventId, choiceId, playerTurn: i.from.playerTurn, worldTick: i.from.worldTick });
        expect(i.to.playerTurn).toBe(i.from.playerTurn + 1);
        expect(i.to.worldTick).toBe(i.from.worldTick + 1);
        expect(Object.keys(step.changeTypes)).toContain("resolvedDecision");
      });
    }
  });

  it("A keeps both pressures out of crisis, declares everything, and meets both factions' desires", () => {
    const stages = a.steps.map(step => step.inspection.epidemic.after.stage);
    expect(stages).not.toContain("CRITICAL");
    expect(stages).not.toContain("CRISIS");
    const infra = a.steps.map(step => step.inspection.infrastructure.settlement_helios!.after.stage);
    expect(infra.slice(1).every(stage => stage === "STRAINED")).toBe(true);
    const reading = readProofWorld(a.final, CATALOGUE);
    expect(reading.memories.some(m => m.exposure === "secret")).toBe(false);
    expect(reading.agenda).toMatchObject({
      agenda_co_reliability: true,
      agenda_co_unregistered_access: true,
      agenda_fcl_access: true
    });
    for (const step of a.steps) {
      expect(step.inspection.consequencesScheduled).toEqual([]);
    }
  });

  it("B runs both pressures into crisis on delayed consequences it was warned about", () => {
    const reading = readProofWorld(b.final, CATALOGUE);
    expect(reading.epidemic.stage).toBe("CRITICAL");
    expect(reading.infrastructure.settlement_helios!.stage).toBe("CRISIS");
    const applied = b.steps.flatMap(step => step.inspection.consequencesApplied);
    expect(applied).toEqual(
      expect.arrayContaining([
        "con.evt_f3_conduit_offer.tap_quietly.strain",
        "con.evt_f2_recycler_warning.patch_and_defer.wear",
        "con.evt_f1_clinic_request.protect_reserve.spread"
      ])
    );
    expect(reading.memories.filter(m => m.exposure === "secret").map(m => `${m.characterId}:${m.memoryId}`)).toEqual([
      "brann_001:fact_f3_quiet_deal",
      "mara_001:fact_f3_secret_tap"
    ]);
    // Granting the League's access closed the League repair route at the breakdown.
    expect(b.steps.flatMap(step => step.inspection.optionsClosed)).toContain("evt_f2_recycler_breakdown:front_technicians");
  });
});

/** The dimensions "materially different" is judged on (issue #42). */
function divergence(x: ProofWorldReading, y: ProofWorldReading, xs: WorldState, ys: WorldState): string[] {
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const stocks = (w: WorldState) => ["energy", "water", "medicine", "food", "alloys", "credits"].map(key => readAuthoritativeResource(w, key));
  const dims: [string, unknown, unknown][] = [
    ["resources", stocks(xs), stocks(ys)],
    ["epidemic", x.epidemic, y.epidemic],
    ["infrastructure", [x.infrastructure, x.nodeCondition], [y.infrastructure, y.nodeCondition]],
    ["memories", x.memories, y.memories],
    ["factionAwareness", x.factionAwareness, y.factionAwareness],
    ["agenda", x.agenda, y.agenda],
    ["consequences", x.consequences, y.consequences],
    ["options", [x.eligibleEvents, x.availableOptions], [y.eligibleEvents, y.availableOptions]],
    ["flags", xs.flags, ys.flags],
    ["character", xs.party.map(c => c.stress), ys.party.map(c => c.stress)]
  ];
  return dims.filter(([, p, q]) => differs(p, q)).map(([name]) => name);
}

describe("Step inspection reports what happened, once, in the right direction", () => {
  const a = runTrajectory("A", TRAJECTORY_A);
  const b = runTrajectory("B", TRAJECTORY_B);
  const c = runTrajectory("C", TRAJECTORY_C);

  it("reports each consequence once, and never counts the option just taken as closed", () => {
    for (const t of [a, b, c]) {
      const applied = t.steps.flatMap(step => step.inspection.consequencesApplied);
      expect(new Set(applied).size).toBe(applied.length);
      for (const step of decisions(t)) {
        const taken = `${step.decision!.eventId}:`;
        expect(step.inspection.optionsClosed.filter(option => option.startsWith(taken))).toEqual([]);
      }
    }
  });

  it("reports agenda changes in the direction they happened", () => {
    expect(a.steps[0]!.inspection.agendaChanged).toEqual([
      { agendaId: "agenda_co_unregistered_access", before: false, after: true },
      { agendaId: "agenda_fcl_access", before: false, after: true }
    ]);
  });

  it("reports the copies a publication spreads, though the fact itself was already known", () => {
    const g = runTrajectory("G", COVERAGE_PATHS["G-disclose"]!);
    const disclosure = decisions(g)[1]!;
    expect(disclosure.decision!.choiceId).toBe("disclose_and_register");
    expect(
      disclosure.inspection.newMemories.filter(m => m.memoryId === "fact_f3_secret_tap").map(m => `${m.characterId}:${m.origin}`)
    ).toEqual(["brann_001:public", "ira_001:public", "sela_001:public", "tarek_001:public"]);
    expect(disclosure.inspection.newAwareness).toContain("faction_compact:aware:fact_f3_secret_tap");
  });

  it("reports a reflected copy beside the direct memory it came from", () => {
    expect(c.steps[0]!.inspection.newMemories.filter(m => m.memoryId === "fact_f2_warning_ignored")).toEqual([
      { characterId: "mara_001", memoryId: "fact_f2_warning_ignored", origin: "reflected", exposure: "private", behaviorHook: null },
      {
        characterId: "tarek_001",
        memoryId: "fact_f2_warning_ignored",
        origin: "direct",
        exposure: "private",
        behaviorHook: "offer_unprompted_warning"
      }
    ]);
  });
});

describe("GQP-B exit 9: the trajectories are materially different", () => {
  const a = runTrajectory("A", TRAJECTORY_A);
  const b = runTrajectory("B", TRAJECTORY_B);
  const c = runTrajectory("C", TRAJECTORY_C);
  const read = (t: Trajectory) => readProofWorld(t.final, CATALOGUE);

  it("A and B differ on authoritative state far beyond their history", () => {
    const dims = divergence(read(a), read(b), a.final, b.final);
    expect(dims).toEqual(
      expect.arrayContaining(["resources", "epidemic", "infrastructure", "memories", "agenda", "consequences", "factionAwareness", "flags"])
    );
    expect(dims.length).toBeGreaterThanOrEqual(8);
    // And in the pressure stages the player sees, not only in the numbers.
    expect(read(a).epidemic.stage).not.toBe(read(b).epidemic.stage);
    expect(read(a).infrastructure.settlement_helios!.stage).not.toBe(read(b).infrastructure.settlement_helios!.stage);
  });

  it("C differs materially from both", () => {
    expect(divergence(read(a), read(c), a.final, c.final).length).toBeGreaterThanOrEqual(6);
    expect(divergence(read(b), read(c), b.final, c.final).length).toBeGreaterThanOrEqual(6);
  });

  it("is not explained by history alone: identical decisions give identical worlds", () => {
    const again = runTrajectory("A again", TRAJECTORY_A);
    expect(divergence(read(a), read(again), a.final, again.final)).toEqual([]);
    expect(JSON.stringify(again.final)).toBe(JSON.stringify(a.final));
  });
});

describe("GQP-10: replay, order independence and persistence", () => {
  const named: [string, readonly Decision[]][] = [
    ["A", TRAJECTORY_A],
    ["B", TRAJECTORY_B],
    ["C", TRAJECTORY_C]
  ];

  it.each(named)("replays %s byte-identically", (name, path) => {
    expect(JSON.stringify(runTrajectory(name, path).final)).toBe(JSON.stringify(runTrajectory(name, path).final));
  });

  it.each(named)("replays %s identically from any ordering of the catalogue", (name, path) => {
    const reference = runTrajectory(name, path);
    const reversed = runTrajectory(name, path, { catalogue: [...CATALOGUE].reverse() });
    const rotated = runTrajectory(name, path, { catalogue: [...CATALOGUE.slice(3), ...CATALOGUE.slice(0, 3)] });
    expect(JSON.stringify(reversed.final)).toBe(JSON.stringify(reference.final));
    expect(JSON.stringify(rotated.final)).toBe(JSON.stringify(reference.final));
    expect(reversed.steps.map(s => s.inspection.optionsOpened)).toEqual(reference.steps.map(s => s.inspection.optionsOpened));
  });

  it.each(named)("continues %s after a save and load at every decision, identically", (name, path) => {
    const uninterrupted = JSON.stringify(runTrajectory(name, path).final);
    for (let k = 0; k < path.length; k += 1) {
      expect(JSON.stringify(runTrajectory(name, path, { saveAfter: [k] }).final)).toBe(uninterrupted);
    }
    expect(JSON.stringify(runTrajectory(name, path, { saveAfter: path.map((_, k) => k) }).final)).toBe(uninterrupted);
  });

  it("carries pending consequences, memories and history across a mid-network save", () => {
    // After B's third decision three delayed consequences are in flight or landed,
    // a secret is held and the history has three entries.
    const mid = runTrajectory("B-mid", TRAJECTORY_B.slice(0, 3), { saveAfter: [2] }).final;
    const reading = readProofWorld(mid, CATALOGUE);
    expect(reading.history.map(entry => entry.eventId)).toEqual(TRAJECTORY_B.slice(0, 3).map(([eventId]) => eventId));
    expect(reading.consequences.filter(item => item.id.startsWith("con.evt_")).map(item => item.status)).toContain("pending");
    expect(reading.memories.some(m => m.exposure === "secret")).toBe(true);
    const continued = runTrajectory("B-rest", TRAJECTORY_B.slice(3), { start: mid });
    expect(JSON.stringify(continued.final)).toBe(JSON.stringify(runTrajectory("B", TRAJECTORY_B).final));
  });
});

/** The catalogue with every display string replaced. Ids and wiring untouched. */
function relabelled(catalogue: readonly ProofEvent[]): ProofEvent[] {
  return catalogue.map((event, e) => ({
    ...event,
    presentation: { title: `T${e}`, body: `B${e}` },
    choices: event.choices.map((choice, c) => ({
      ...choice,
      label: `L${e}.${c}`,
      disclosure: {
        ...(choice.disclosure.knownNotes ? { knownNotes: choice.disclosure.knownNotes.map((_, n) => `K${n}`) } : {}),
        risks: [...choice.disclosure.risks],
        unknowns: choice.disclosure.unknowns.map((_, n) => `U${n}`)
      },
      effects: choice.effects.map(effect =>
        effect.type === "MEMORY_RECORD" ? { ...effect, summary: "x", tags: ["relabelled"] } : effect
      ),
      schedules: choice.schedules?.map(schedule => ({
        ...schedule,
        effects: schedule.effects.map(effect =>
          effect.type === "MEMORY_RECORD" ? { ...effect, summary: "x", tags: ["relabelled"] } : effect
        )
      }))
    }))
  })) as ProofEvent[];
}

/** Authoritative state minus the descriptive text memories carry. */
function withoutProse(state: WorldState): unknown {
  const copy = structuredClone(state);
  for (const character of copy.party) {
    for (const memory of character.memories ?? []) {
      (memory as { summary?: string }).summary = "";
      (memory as { tags?: string[] }).tags = [];
    }
  }
  return copy;
}

describe("No rule branches on display text (GQP spec 13.1)", () => {
  it.each([
    ["A", TRAJECTORY_A],
    ["B", TRAJECTORY_B],
    ["C", TRAJECTORY_C]
  ] as const)("plays %s identically with every title, label, summary and tag rewritten", (name, path) => {
    const reference = runTrajectory(name, path);
    const rewritten = runTrajectory(name, path, { catalogue: relabelled(CATALOGUE) });
    expect(withoutProse(rewritten.final)).toEqual(withoutProse(reference.final));
    expect(rewritten.steps.map(s => [s.inspection.optionsOpened, s.inspection.optionsClosed])).toEqual(
      reference.steps.map(s => [s.inspection.optionsOpened, s.inspection.optionsClosed])
    );
  });
});

describe("M1 content is untouched by the proof", () => {
  it("keeps proof effects out of every M1 event", () => {
    for (const event of [...demoEvents, ...systemicEvents]) {
      for (const choice of event.choices) {
        for (const effect of choice.effects) expect(isProofEffectType(effect.type)).toBe(false);
      }
    }
  });

  it("shares no event id between the M1 catalogues and the proof catalogue", () => {
    const m1 = new Set([...demoEvents, ...systemicEvents].map(event => event.id));
    expect(CATALOGUE.filter(event => m1.has(event.id))).toEqual([]);
  });
});
