import { describe, expect, it, vi } from "vitest";
import type { ProofEvent, ProofPredicate, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  REPETITION_SPAN,
  applyDueConsequences,
  createGqpScenario,
  loadSystemicWorldState,
  repetitionOf,
  resolveProofChoice,
  runWorldTick,
  scoreProofCandidates,
  selectProofFocus,
  serializeSystemicWorldState,
  type CandidateScore
} from "../src";

/**
 * GQP-C selection (spec 14.3): priority = urgency + causal relevance -
 * repetition, and nothing else. Each term is proven by a counterfactual pair:
 * one world, one condition changed, and the right term -- only that term --
 * moving for the right reason.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

function decide(state: WorldState, eventId: string, choiceId: string, catalogue: readonly ProofEvent[] = CATALOGUE): WorldState {
  return applyDueConsequences(resolveProofChoice(state, catalogue, eventId, choiceId).state).state;
}

function tick(state: WorldState, times = 1): WorldState {
  let world = state;
  for (let i = 0; i < times; i += 1) world = runWorldTick(world).state;
  return world;
}

function scoreOf(state: WorldState, eventId: string, catalogue: readonly ProofEvent[] = CATALOGUE): CandidateScore {
  const found = scoreProofCandidates(state, catalogue).find(candidate => candidate.eventId === eventId);
  if (!found) throw new Error(`${eventId} is not eligible`);
  return found;
}

/** Set the epidemic to `value` through its crowding cause, keeping it save-valid. */
function withEpidemic(state: WorldState, value: number): WorldState {
  const world = structuredClone(state);
  const epidemic = sim(world).epidemic;
  const others = epidemic.contributors.filter(item => item.cause !== "crowding").reduce((sum, item) => sum + item.magnitude, 0);
  epidemic.contributors.find(item => item.cause === "crowding")!.magnitude = Math.round((value - others) * 10000) / 10000;
  epidemic.value = value;
  return world;
}

/** A minimal proof event: always eligible unless told otherwise, 0 on every term by default. */
function probe(id: string, familyId: ProofEvent["familyId"], extra: Partial<ProofEvent> = {}): ProofEvent {
  return {
    id,
    familyId,
    taxonomy: "DILEMMA",
    eligibility: [],
    presentation: { title: id, body: id },
    choices: [
      { id: "a", label: "A", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } },
      { id: "b", label: "B", effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
    ],
    ...extra
  };
}

describe("selection is pure and deterministic", () => {
  const worlds = () => [start(), tick(start(), 2), decide(tick(start(), 2), "evt_f1_clinic_request", "protect_reserve")];

  it("never mutates the world it reads -- including when it previews a World Tick", () => {
    for (const world of worlds()) {
      const before = structuredClone(world);
      selectProofFocus(world, CATALOGUE);
      expect(world).toEqual(before);
    }
  });

  it("returns the same focus for the same world, and for its saved-and-loaded copy", () => {
    for (const world of worlds()) {
      const saved = serializeSystemicWorldState(world);
      if (!saved.ok) throw new Error("save refused");
      const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
      if (!loaded.ok) throw new Error("load refused");
      expect(selectProofFocus(world, CATALOGUE)).toEqual(selectProofFocus(world, CATALOGUE));
      expect(selectProofFocus(loaded.state, CATALOGUE)).toEqual(selectProofFocus(world, CATALOGUE));
    }
  });

  it("does not depend on catalogue order: reversed and rotated catalogues select the same focus", () => {
    for (const world of worlds()) {
      const expected = selectProofFocus(world, CATALOGUE);
      const reversed = [...CATALOGUE].reverse();
      const rotated = [...CATALOGUE.slice(5), ...CATALOGUE.slice(0, 5)];
      expect(selectProofFocus(world, reversed)).toEqual(expected);
      expect(selectProofFocus(world, rotated)).toEqual(expected);
    }
  });

  it("keeps no memory of a previous call: A, then B, then A again gives A's first answer", () => {
    const [a, b] = [start(), tick(start(), 2)];
    const first = selectProofFocus(a!, CATALOGUE);
    selectProofFocus(b!, CATALOGUE);
    expect(selectProofFocus(a!, CATALOGUE)).toEqual(first);
  });

  it("gives the same answer from a freshly loaded module, as a new process would", async () => {
    const world = tick(start(), 2);
    const expected = selectProofFocus(world, CATALOGUE);
    vi.resetModules();
    const fresh = await import("../src/proof/select-proof-focus.js");
    expect(fresh.selectProofFocus(world, CATALOGUE)).toEqual(expected);
  });

  it("takes only a world and a catalogue: no beat index, clock or telemetry can reach it", () => {
    expect(selectProofFocus.length).toBe(2);
  });
});

describe("urgency: a pressure past a threshold, a supply exhausted, a consequence about to land", () => {
  it("moves with the epidemic stage and only urgency moves: STRAINED 0, CRITICAL 1, CRISIS 2", () => {
    const base = tick(start(), 2);
    const clinic = (value: number) => scoreOf(withEpidemic(base, value), "evt_f1_clinic_request");
    const [strained, critical, crisis] = [clinic(0.4), clinic(0.6), clinic(0.8)];
    expect([strained.urgency.total, critical.urgency.total, crisis.urgency.total]).toEqual([0, 1, 2]);
    expect(critical.urgency.reasons).toEqual([{ kind: "pressure", pressure: "epidemic", stage: "CRITICAL", points: 1 }]);
    for (const score of [strained, critical, crisis]) {
      expect(score.relevance).toEqual(strained.relevance);
      expect(score.repetition).toEqual(strained.repetition);
    }
  });

  it("counts a focal supply at zero as a crossed threshold, and a supply merely low as none", () => {
    const low = structuredClone(tick(start(), 3));
    sim(low).settlements[0]!.resourceStock.water = 2;
    low.resources.water = 2;
    const dry = structuredClone(low);
    sim(dry).settlements[0]!.resourceStock.water = 0;
    dry.resources.water = 0;
    expect(scoreOf(low, "evt_f5_water_convoy").urgency.reasons).toEqual([]);
    expect(scoreOf(dry, "evt_f5_water_convoy").urgency.reasons).toEqual([{ kind: "supply_exhausted", key: "water", points: 1 }]);
  });

  it("marks the warning whose consequence lands after the next decision as due", () => {
    // Patched at turn 1: the wear falls due at turn 4. At turn 2 it is not due
    // yet; at turn 3 the next decision is the last one before it lands.
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const due = (world: WorldState) => scoreOf(world, "evt_f2_tarek_second_warning").urgency.reasons.filter(r => r.kind === "consequence_due");
    expect(due(patched)).toEqual([]);
    const later = decide(tick(patched, 2), "evt_f1_clinic_request", "treat_now");
    expect(due(later)).toEqual([{ kind: "consequence_due", consequenceId: "con.evt_f2_recycler_warning.patch_and_defer.wear", triggerTurn: 4, points: 1 }]);
  });
});

describe("causal relevance: something the world holds points at the event", () => {
  it("counts an open agenda item, and stops when the desire is met", () => {
    // The League offers its line because it wants access.
    const open = start();
    const met = structuredClone(start());
    met.flags.front_access_granted = true;
    expect(scoreOf(open, "evt_f3_conduit_offer").relevance.reasons).toEqual([
      { kind: "agenda", agendaId: "agenda_fcl_access", factionId: "faction_front", points: 1 }
    ]);
    expect(scoreOf(met, "evt_f3_conduit_offer").relevance.reasons).toEqual([]);
    expect(scoreOf(met, "evt_f3_conduit_offer").urgency).toEqual(scoreOf(open, "evt_f3_conduit_offer").urgency);
  });

  it("counts a detected pattern: the same breakdown answers to warnings overruled twice, not once", () => {
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const broken = (world: WorldState) => {
      const copy = structuredClone(world);
      sim(copy).productionNodes[0]!.condition = 0.5;
      return copy;
    };
    const dismissed = broken(decide(patched, "evt_f2_tarek_second_warning", "let_it_ride"));
    const heeded = broken(decide(patched, "evt_f2_tarek_second_warning", "authorize_inspection"));
    expect(scoreOf(dismissed, "evt_f2_recycler_breakdown").relevance.reasons).toEqual([
      { kind: "pattern", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "tarek_001", points: 1 }
    ]);
    expect(scoreOf(heeded, "evt_f2_recycler_breakdown").relevance.reasons).toEqual([]);
  });

  it("counts a memory present, callback-eligible, and never an absent one", () => {
    const knows: ProofPredicate = { predicate: "memory_known", characterId: "mara_001", memoryId: "fact_f3_secret_tap", value: true };
    const content = [...CATALOGUE, probe("evt_x_reads", "public_accountability", { relevance: [knows] })];
    const without = start();
    const withMemory = decide(start(), "evt_f3_conduit_offer", "tap_quietly", content);
    expect(scoreOf(without, "evt_x_reads", content).relevance.total).toBe(0);
    expect(scoreOf(withMemory, "evt_x_reads", content).relevance.reasons).toEqual([
      { kind: "memory", characterId: "mara_001", memoryId: "fact_f3_secret_tap", points: 1 }
    ]);
  });

  it("counts each thing referenced once, however many times it is referenced", () => {
    const knows: ProofPredicate = { predicate: "memory_known", characterId: "mara_001", memoryId: "fact_f3_secret_tap", value: true };
    const content = [...CATALOGUE, probe("evt_x_twice", "public_accountability", { eligibility: [knows], relevance: [knows] })];
    const world = decide(start(), "evt_f3_conduit_offer", "tap_quietly", content);
    expect(scoreOf(world, "evt_x_twice", content).relevance.total).toBe(1);
  });
});

describe("repetition: by family, in Player Turns, from the resolved history (spec 14.3)", () => {
  // Two maintenance events and one unrelated family, all always eligible.
  const content = [probe("evt_x_maint_a", "maintenance"), probe("evt_x_maint_b", "maintenance"), probe("evt_x_triage", "scarcity_triage")];

  it("is exactly 1 elapsed right after the family is resolved -- the maximum penalty -- and counts decisions after that", () => {
    const resolvedAt = start().turn; // T
    let world = decide(start(), "evt_x_maint_a", "a", content);
    expect(world.turn).toBe(resolvedAt + 1);
    const readings: [number | null, number][] = [];
    readings.push([repetitionOf(world, "maintenance").elapsed, repetitionOf(world, "maintenance").penalty]);
    // Unrelated decisions each move the family one Player Turn further away.
    for (const eventId of ["evt_x_triage"]) {
      world = decide(world, eventId, "a", content);
      readings.push([repetitionOf(world, "maintenance").elapsed, repetitionOf(world, "maintenance").penalty]);
    }
    expect(readings).toEqual([
      [1, REPETITION_SPAN],
      [2, REPETITION_SPAN - 1]
    ]);
  });

  it("decays to zero after REPETITION_SPAN decisions, and never goes negative", () => {
    const events = [probe("evt_x_maint", "maintenance"), ...["t1", "t2", "t3", "t4"].map(id => probe(`evt_x_${id}`, "scarcity_triage"))];
    let world = decide(start(), "evt_x_maint", "a", events);
    const penalties = [repetitionOf(world, "maintenance").penalty];
    for (const id of ["t1", "t2", "t3", "t4"]) {
      world = decide(world, `evt_x_${id}`, "a", events);
      penalties.push(repetitionOf(world, "maintenance").penalty);
    }
    expect(penalties).toEqual([3, 2, 1, 0, 0]);
  });

  it("is per family, not per event: a different event of the same family takes the same penalty", () => {
    const world = decide(start(), "evt_x_maint_a", "a", content);
    expect(scoreOf(world, "evt_x_maint_b", content).repetition).toEqual({ familyId: "maintenance", lastPlayerTurn: 1, elapsed: 1, penalty: REPETITION_SPAN });
    expect(scoreOf(world, "evt_x_triage", content).repetition.penalty).toBe(0);
  });

  it("is measured in Player Turns: World Ticks in between change nothing", () => {
    const world = decide(start(), "evt_x_maint_a", "a", content);
    expect(repetitionOf(tick(world, 3), "maintenance")).toEqual(repetitionOf(world, "maintenance"));
  });

  it("gives a family never resolved no entry and no penalty", () => {
    expect(repetitionOf(start(), "external_rescue")).toEqual({ familyId: "external_rescue", lastPlayerTurn: null, elapsed: null, penalty: 0 });
  });

  it("reads the family from the history, not from the current catalogue", () => {
    // The event that was resolved has since left the catalogue entirely.
    const world = decide(start(), "evt_x_maint_a", "a", content);
    const withoutIt = content.filter(event => event.id !== "evt_x_maint_a");
    expect(scoreOf(world, "evt_x_maint_b", withoutIt).repetition.penalty).toBe(REPETITION_SPAN);
  });

  it("lowers the priority by exactly the penalty", () => {
    const world = decide(start(), "evt_x_maint_a", "a", content);
    const score = scoreOf(world, "evt_x_maint_b", content);
    expect(score.priority).toBe(score.urgency.total + score.relevance.total - score.repetition.penalty);
  });
});

describe("the tie-break: event id in code units", () => {
  it("decides only between equal priorities, and says so", () => {
    const world = structuredClone(start());
    world.simulation!.tick = 1; // one tick past the (empty) history: a decision is due
    const content = [probe("evt_x_b", "maintenance"), probe("evt_x_a", "scarcity_triage")];
    const focus = selectProofFocus(world, content);
    if (focus.kind !== "event") throw new Error("expected an event");
    expect(focus.event.id).toBe("evt_x_a");
    expect(focus.selection.tieBreak).toBe(true);

    const pressing = [probe("evt_x_b", "maintenance", { relevance: [{ predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false }] }), probe("evt_x_a", "scarcity_triage")];
    const decided = selectProofFocus(world, pressing);
    if (decided.kind !== "event") throw new Error("expected an event");
    expect(decided.event.id).toBe("evt_x_b");
    expect(decided.selection.tieBreak).toBe(false);
  });
});

describe("the causal callback: why this event, now", () => {
  it("points at the memory and the decision that recorded it", () => {
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const world = decide(tick(patched, 2), "evt_f1_clinic_request", "treat_now");
    world.simulation!.tick += 1; // at the bound: the selector must name an event
    const focus = selectProofFocus(world, CATALOGUE.filter(event => event.id === "evt_f2_tarek_second_warning"));
    if (focus.kind !== "event") throw new Error("expected an event");
    expect(focus.event.id).toBe("evt_f2_tarek_second_warning");
    expect(focus.selection.callback).toEqual({
      kind: "memory",
      characterId: "tarek_001",
      memoryId: "fact_f2_warning_ignored",
      decision: { familyId: "maintenance", eventId: "evt_f2_recycler_warning", choiceId: "patch_and_defer", playerTurn: 1 }
    });
  });

  it("prefers a memory to an agenda item, and an agenda item to a bare pressure", () => {
    const memory: ProofPredicate = { predicate: "memory_known", characterId: "mara_001", memoryId: "fact_f3_secret_tap", value: true };
    const agenda: ProofPredicate = { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false };
    const content = [...CATALOGUE, probe("evt_x_both", "public_accountability", { relevance: [agenda, memory] })];
    const world = decide(start(), "evt_f3_conduit_offer", "tap_quietly", content);
    world.simulation!.tick = 1;
    const scores = scoreProofCandidates(world, content);
    expect(scores.find(s => s.eventId === "evt_x_both")!.relevance.total).toBe(2);
    const onlyMine = content.filter(event => event.id === "evt_x_both");
    const focus = selectProofFocus(world, onlyMine);
    if (focus.kind !== "event") throw new Error("expected an event");
    expect(focus.selection.callback).toMatchObject({ kind: "memory", memoryId: "fact_f3_secret_tap" });
  });

  it("falls back to the epidemic's largest cause, with the decision behind it when there is one", () => {
    const refused = decide(tick(start(), 2), "evt_f1_clinic_request", "protect_reserve");
    const world = withEpidemic(refused, 0.6);
    world.simulation!.tick += 1;
    const outbreakOnly = CATALOGUE.filter(event => event.id === "evt_f1_outbreak");
    const focus = selectProofFocus(world, outbreakOnly);
    if (focus.kind !== "event") throw new Error("expected an event");
    expect(focus.selection.callback?.kind).toBe("pressure");
  });
});
