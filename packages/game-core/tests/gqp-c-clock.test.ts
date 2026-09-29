import { describe, expect, it } from "vitest";
import type { WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  advanceClock,
  applyDueConsequences,
  createGqpScenario,
  createSystemicScenario,
  isPatternDetected,
  loadSystemicWorldState,
  resolveChoice,
  resolveProofChoice,
  runWorldTick,
  scheduleDelayedConsequence,
  serializeSystemicWorldState,
  validateSystemicWorldState
} from "../src";
import { POLICY_B, runPacing } from "./support/pacing-harness";

/**
 * Issue #37, made load-bearing by GQP-C.
 *
 * The quiet bound of spec 14.6 is `simulation.tick - lastResolved.worldTick`,
 * and repetition is `WorldState.turn - lastResolved.playerTurn`. Both are
 * distances on a clock, and a distance is only meaningful if the clock moves by
 * exactly one when it advances.
 *
 * Reproduced on the schema-v2 boundary before this fix (develop@13229ca):
 * a proof world at `tick = 2 ** 53` passed `validateSystemicWorldState`, and
 * `runWorldTick` returned it with the tick unchanged and a StateChange whose
 * `before` equalled its `after`; at `2 ** 53 + 2` the tick moved by two. The
 * same held for `turn` and `day`.
 */

const MAX = Number.MAX_SAFE_INTEGER;

function proofWorldAt(clock: { tick?: number; turn?: number; day?: number }): WorldState {
  const world = createGqpScenario(7419);
  if (clock.tick !== undefined) world.simulation!.tick = clock.tick;
  if (clock.turn !== undefined) world.turn = clock.turn;
  if (clock.day !== undefined) world.day = clock.day;
  return world;
}

describe("the clock contract at the save boundary", () => {
  it.each([
    ["tick", { tick: 2 ** 53 }, /simulation\.tick must be a safe integer/],
    ["tick", { tick: 2 ** 53 + 2 }, /simulation\.tick must be a safe integer/],
    ["turn", { turn: 2 ** 53 }, /WorldState\.turn must be a safe integer/],
    ["day", { day: 2 ** 53 }, /WorldState\.day must be a safe integer/]
  ])("refuses a proof world whose %s cannot advance exactly (%o)", (_name, clock, pattern) => {
    const verdict = validateSystemicWorldState(proofWorldAt(clock));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(pattern);
  });

  it("refuses the same clock through the real load path, fail-closed", () => {
    const raw = JSON.stringify(proofWorldAt({ tick: 2 ** 53 }));
    const loaded = loadSystemicWorldState(raw, "gqp_7419");
    expect(loaded.ok).toBe(false);
  });

  it("accepts the largest clock that is still exact, on every counter", () => {
    expect(validateSystemicWorldState(proofWorldAt({ tick: MAX, turn: MAX, day: MAX })).ok).toBe(true);
  });

  it("applies to the M1 baseline too: the defect is in the shared World Tick, not in the proof", () => {
    const world = createSystemicScenario(7419);
    world.simulation!.tick = 2 ** 53;
    expect(validateSystemicWorldState(world).ok).toBe(false);
    // And every clock a real M1 run reaches is untouched by the contract.
    expect(validateSystemicWorldState(createSystemicScenario(7419)).ok).toBe(true);
  });

  it("keeps the existing refusals for clocks that are not integers at all", () => {
    const world = proofWorldAt({});
    (world as unknown as { turn: unknown }).turn = 1.5;
    expect(validateSystemicWorldState(world).errors).toContain("WorldState.turn must be an integer, got 1.5");
  });
});

describe("advancing a clock is exact or refused", () => {
  it("advances the World Tick to MAX_SAFE_INTEGER exactly, and the result is save-valid", () => {
    const ticked = runWorldTick(proofWorldAt({ tick: MAX - 1 }));
    expect(ticked.state.simulation!.tick).toBe(MAX);
    expect(ticked.delta.changes.find(change => change.type === "tick")).toEqual({
      type: "tick",
      key: "simulation.tick",
      before: MAX - 1,
      after: MAX
    });
    expect(validateSystemicWorldState(ticked.state).ok).toBe(true);
  });

  it("refuses a World Tick at MAX_SAFE_INTEGER instead of reporting a tick that did not move, and touches nothing", () => {
    const world = proofWorldAt({ tick: MAX });
    const before = structuredClone(world);
    expect(() => runWorldTick(world)).toThrow(/simulation\.tick cannot advance past/);
    expect(world).toEqual(before);
  });

  it("refuses a World Tick whose day cannot advance", () => {
    expect(() => runWorldTick(proofWorldAt({ day: MAX }))).toThrow(/day cannot advance past/);
  });

  it("refuses a proof decision whose Player Turn cannot advance, before any effect", () => {
    const world = proofWorldAt({ turn: MAX });
    const before = structuredClone(world);
    expect(() => resolveProofChoice(world, GQP_PROOF_EVENTS, "evt_f2_recycler_warning", "full_maintenance")).toThrow(
      /WorldState\.turn cannot advance past/
    );
    expect(world).toEqual(before);
  });

  it("refuses an M1 decision the same way: both resolvers share the one Player Turn increment", () => {
    const world = createSystemicScenario(7419);
    world.turn = MAX;
    expect(() => resolveChoice(world, { id: "c", label: "c", effects: [] }, "test")).toThrow(/cannot advance past/);
  });

  it("refuses to advance a clock that is already outside the safe range", () => {
    expect(() => advanceClock(2 ** 53, "simulation.tick")).toThrow(/not a safe integer/);
    expect(advanceClock(0, "simulation.tick")).toBe(1);
  });
});

describe("every clock the pacing arithmetic reads is safe, not only the counters that advance", () => {
  // `ticksSinceLastResolvedDecision = simulation.tick - lastResolved.worldTick`
  // and `elapsed = WorldState.turn - lastResolved.playerTurn` read history
  // clocks too. Those are bounded by the world's own clocks at the boundary,
  // so a safe world clock makes them safe -- proven here rather than argued.
  const withHistory = (entry: Record<string, unknown>, clock: { tick?: number; turn?: number } = {}) => {
    const world = proofWorldAt({ tick: clock.tick ?? 5, turn: clock.turn ?? 5 });
    (world.simulation as unknown as { resolvedHistory: unknown[] }).resolvedHistory.push({
      familyId: "maintenance", eventId: "evt_f2_recycler_warning", choiceId: "full_maintenance", playerTurn: 1, worldTick: 0, ...entry
    });
    return validateSystemicWorldState(world);
  };

  it("accepts history clocks inside the world's clocks", () => {
    expect(withHistory({ playerTurn: 4, worldTick: 5 }).ok).toBe(true);
  });

  it.each([
    ["a worldTick ahead of the world", { worldTick: 6 }, /worldTick is 6 but simulation\.tick is 5/],
    ["a worldTick beyond the safe range", { worldTick: 2 ** 53 }, /worldTick is 9007199254740992 but simulation\.tick is 5/],
    ["a negative worldTick", { worldTick: -1 }, /worldTick must be at least 0/],
    ["a fractional worldTick", { worldTick: 1.5 }, /worldTick must be an integer/],
    ["a playerTurn at or beyond the current turn", { playerTurn: 5 }, /playerTurn is 5 but the last resolved Player Turn/],
    ["a playerTurn beyond the safe range", { playerTurn: 2 ** 53 }, /playerTurn is 9007199254740992/]
  ])("refuses %s", (_label, entry, pattern) => {
    const verdict = withHistory(entry);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(pattern);
  });

  it("refuses unsafe history clocks even when the world's clock is unsafe too", () => {
    const verdict = withHistory({ worldTick: 2 ** 53 }, { tick: 2 ** 53 });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(/simulation\.tick must be a safe integer/);
  });

  it("refuses a delayed consequence whose trigger turn is beyond the safe range, at the boundary and at the scheduler", () => {
    const consequence = {
      id: "con_far",
      triggerTurn: 2 ** 53,
      visibility: "hidden" as const,
      scope: "settlement" as const,
      effects: [{ type: "RESOURCE_DELTA" as const, key: "water", value: -1 }],
      reversible: false,
      status: "pending" as const,
      source: { kind: "system" as const, id: "test" }
    };
    const world = proofWorldAt({});
    world.simulation!.delayedConsequences.push(consequence);
    expect(validateSystemicWorldState(world).errors.join("; ")).toMatch(/triggerTurn must be a safe integer/);
    expect(() => scheduleDelayedConsequence(proofWorldAt({}), consequence)).toThrow(/triggerTurn must be a (positive )?safe integer/);
  });
});

describe("persisted turn stamps never come from the future (GQP-C P2-1)", () => {
  // The GQP-C detectors order evidence by `CharacterMemory.turn`:
  // `firstInvolvementAfter` looks for an involvement after the secret, and
  // `engagedAt` for a refusal before it. So a memory's turn is a clock, and
  // bounded by the world's own Player Turn -- including equality, because the
  // World Tick writes on the turn the world is on.
  const decide = (world: WorldState, eventId: string, choiceId: string) =>
    applyDueConsequences(resolveProofChoice(world, GQP_PROOF_EVENTS, eventId, choiceId).state).state;
  const tick = (world: WorldState, times: number) => {
    let next = world;
    for (let i = 0; i < times; i += 1) next = runWorldTick(next).state;
    return next;
  };
  // The SECRET_ACTION_DISCOVERED pair of gqp-c-patterns: the splice, then
  // Tarek put to work on the bus (found) or kept away from it (kept).
  const tapped = () => decide(createGqpScenario(7419), "evt_f3_conduit_offer", "tap_quietly");
  const land = (world: WorldState) => decide(tick(world, 2), "evt_f1_clinic_request", "treat_now");
  const found = () => land(decide(tapped(), "evt_f2_recycler_warning", "patch_and_defer"));
  const kept = () => land(decide(tapped(), "evt_f2_recycler_warning", "divert_clinic_power"));
  const tarekOf = (world: WorldState) => world.party.find(character => character.id === "tarek_001")!;

  /** A hostile save: the real payload of `world`, edited as bytes, through the real load path. */
  function hostile(world: WorldState, edit: (json: WorldState) => void) {
    const saved = serializeSystemicWorldState(world);
    if (!saved.ok) throw new Error(saved.errors.join("; "));
    const json = JSON.parse(saved.payload) as WorldState;
    edit(json);
    return loadSystemicWorldState(JSON.stringify(json), saved.campaignId);
  }
  function roundTrips(world: WorldState): void {
    const saved = serializeSystemicWorldState(world);
    if (!saved.ok) throw new Error(saved.errors.join("; "));
    const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
    if (!loaded.ok) throw new Error(loaded.errors.join("; "));
    expect(loaded.state).toEqual(world);
  }
  const FUTURE = /memory\[\d+\]\.turn \d+ is after WorldState\.turn \d+; a memory cannot come from the future/;

  it("accepts real M1 memories, including the World Tick's, stamped on the current turn", () => {
    let world = createSystemicScenario(7419);
    const ticked = () => world.party.flatMap(character => character.memories ?? []).find(memory => memory.source.kind === "world_tick");
    for (let i = 0; i < 12 && !ticked(); i += 1) world = runWorldTick(world).state;
    expect(ticked()).toBeDefined();
    expect(ticked()!.turn).toBe(world.turn); // equality is legitimate
    expect(world.party.flatMap(character => character.memories ?? []).find(memory => memory.id === "mem_ira_001")!.turn).toBe(1);
    roundTrips(world);
  });

  it("accepts real v2 memories: decisions stamp the turn they came from, ticks the current one", () => {
    const world = runPacing(POLICY_B).final;
    const memories = world.party.flatMap(character => character.memories ?? []);
    expect(memories.some(memory => memory.source.kind === "choice" && memory.turn < world.turn)).toBe(true);
    expect(memories.every(memory => memory.turn >= 1 && memory.turn <= world.turn)).toBe(true);
    roundTrips(world);
    roundTrips(found());
  });

  it("refuses a memory turn outside the safe range, at v1 and v2", () => {
    for (const make of [() => createSystemicScenario(7419), () => createGqpScenario(7419)]) {
      for (const turn of [2 ** 53, 2 ** 53 + 2]) {
        const world = make();
        world.turn = MAX; // not what refuses it: the stamp is unsafe on its own
        world.party.find(character => character.id === "ira_001")!.memories![0]!.turn = turn;
        expect(validateSystemicWorldState(world).errors.join("; ")).toMatch(/memory\[0\]\.turn must be a safe integer/);
      }
    }
  });

  it("refuses a memory turn after WorldState.turn, and accepts one on it", () => {
    for (const make of [() => createSystemicScenario(7419), () => createGqpScenario(7419)]) {
      const world = make();
      expect(world.turn).toBe(1);
      const ira = () => world.party.find(character => character.id === "ira_001")!.memories![0]!;
      ira().turn = 2;
      expect(validateSystemicWorldState(world).errors.join("; ")).toMatch(FUTURE);
      ira().turn = 1;
      expect(validateSystemicWorldState(world)).toEqual({ ok: true, errors: [] });
    }
  });

  it("does not let a future Tarek involvement plant a SECRET_ACTION_DISCOVERED", () => {
    const world = kept();
    expect(isPatternDetected(world, "SECRET_ACTION_DISCOVERED")).toBe(false);
    // Tarek "worked" a real decision -- at a turn the world has not reached.
    const plant = (json: WorldState) => {
      tarekOf(json).memories = [
        ...(tarekOf(json).memories ?? []),
        {
          id: "fact_x_planted", summary: "Worked the bus.", tags: [], turn: json.turn + 1,
          source: { kind: "choice", id: "evt_f1_clinic_request:treat_now" },
          valence: "negative", salience: 0.5, origin: "direct", callbackEligible: false
        }
      ];
    };
    // The vector is real: in memory, that stamp alone makes the discovery.
    const forged = structuredClone(world);
    plant(forged);
    expect(isPatternDetected(forged, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap")).toBe(true);
    // The boundary refuses it, so no loaded world can carry it.
    const loaded = hostile(world, plant);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.errors.join("; ")).toMatch(FUTURE);
  });

  it("does not let a future refuse_similar_request turn the observer away retroactively", () => {
    const world = found();
    expect(isPatternDetected(world, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap")).toBe(true);
    const refusal = (turn: number) => ({
      ...tarekOf(world).memories!.find(memory => memory.id === "fact_f2_warning_ignored")!,
      id: "fact_x_turned_away", turn, behaviorHook: "refuse_similar_request" as const,
      // Not a decision of the history, so it is a refusal and not an involvement.
      source: { kind: "system" as const, id: "forged" }
    });
    // A refusal stamped after the world's turn: refused at the boundary.
    const later = hostile(world, json => {
      tarekOf(json).memories = [...tarekOf(json).memories!, refusal(json.turn + 1)];
    });
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.errors.join("; ")).toMatch(FUTURE);
    // With his involvements pushed into the future too, the refusal would come
    // "before" it and undo the discovery -- in memory. Neither stamp loads.
    const rewrite = (json: WorldState) => {
      const tarek = tarekOf(json);
      tarek.memories = [
        ...tarek.memories!.map(memory =>
          memory.origin === "direct" && memory.source.kind === "choice" ? { ...memory, turn: json.turn + 2 } : memory
        ),
        refusal(json.turn + 1)
      ];
    };
    const forged = structuredClone(world);
    rewrite(forged);
    expect(isPatternDetected(forged, "SECRET_ACTION_DISCOVERED")).toBe(false);
    const loaded = hostile(world, rewrite);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.errors.join("; ")).toMatch(FUTURE);
  });

  it("refuses an applied consequence whose trigger is after WorldState.turn: the detector's trace, planted", () => {
    const world = found();
    const strain = "con.evt_f3_conduit_offer.tap_quietly.strain";
    expect(world.simulation!.delayedConsequences.find(item => item.id === strain)!.status).toBe("applied");
    const loaded = hostile(world, json => {
      json.simulation!.delayedConsequences.find(item => item.id === strain)!.triggerTurn = json.turn + 1;
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.errors.join("; ")).toContain(`consequence ${strain} is applied at triggerTurn ${world.turn + 1}, after WorldState.turn ${world.turn}`);
    }
    // A pending consequence may lie ahead: that is what pending means.
    expect(world.simulation!.delayedConsequences.some(item => item.status === "pending" && item.triggerTurn > world.turn)).toBe(true);
    roundTrips(world);
  });
});
