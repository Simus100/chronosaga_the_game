import { describe, expect, it } from "vitest";
import type { ProofEvent, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  MANDATORY_URGENCY,
  PacingDefect,
  QUIET_TICK_BOUND,
  QUIET_YIELD_PRIORITY,
  StaleFocus,
  applyDueConsequences,
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  developmentReason,
  loadSystemicWorldState,
  relevantDevelopments,
  resolveProofChoice,
  runWorldTick,
  selectProofFocus,
  serializeSystemicWorldState,
  ticksSinceLastResolvedDecision
} from "../src";

/**
 * GQP-C quiet beats (spec 14.4-14.6), normative before they are rhythm:
 *
 *   - a quiet beat decides nothing: no Player Turn, no history;
 *   - it is followed by exactly one authoritative World Tick, and the
 *     lifecycle offers no way past it without that tick;
 *   - it must show something: a tick that moves only `tick` and `day` is not
 *     a quiet beat;
 *   - it is bounded: at QUIET_TICK_BOUND a decision is due -- an EVENT if
 *     anything is eligible, a typed PacingDefect if nothing is;
 *   - the bound is read from persisted clocks, so save/load cannot reset it.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

function decide(state: WorldState, eventId: string, choiceId: string, catalogue: readonly ProofEvent[] = CATALOGUE): WorldState {
  return applyDueConsequences(resolveProofChoice(state, catalogue, eventId, choiceId).state).state;
}

function saveAndLoad(world: WorldState): WorldState {
  const saved = serializeSystemicWorldState(world);
  if (!saved.ok) throw new Error(saved.errors.join("; "));
  const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  return loaded.state;
}

function probe(id: string, extra: Partial<ProofEvent> = {}): ProofEvent {
  return {
    id,
    familyId: "maintenance",
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

/**
 * A world whose next World Tick shows nothing: starved for thirty ticks,
 * every stock empty, every pressure saturated, every approval at the floor.
 * Reached by the real tick, not assembled.
 */
function stillWorld(): WorldState {
  let world = start();
  for (let i = 0; i < 30; i += 1) world = runWorldTick(world).state;
  // A decision at this tick makes it a fresh decision point (0 ticks since),
  // so what follows is judged on the tick alone, not on the bound.
  const note: ProofEvent = {
    ...probe("evt_x_note"),
    choices: [
      { id: "a", label: "A", effects: [{ type: "FLAG_SET", key: "noted", value: true }], disclosure: { risks: [], unknowns: ["x"] } },
      { id: "b", label: "B", effects: [{ type: "FLAG_SET", key: "noted", value: false }], disclosure: { risks: [], unknowns: ["x"] } }
    ]
  };
  return decide(world, "evt_x_note", "a", [note]);
}

describe("a quiet beat decides nothing and advances the world by exactly one tick", () => {
  it("leaves the Player Turn and the resolved history untouched", () => {
    const beat = beginProofBeat(start(), CATALOGUE);
    expect(beat.focus.kind).toBe("quiet");
    const outcome = completeProofBeat(beat, CATALOGUE);
    expect(outcome.state.turn).toBe(beat.state.turn);
    expect(sim(outcome.state).resolvedHistory).toEqual(sim(beat.state).resolvedHistory);
  });

  it("runs exactly one World Tick: tick and day move by one, and nothing falls due", () => {
    const beat = beginProofBeat(start(), CATALOGUE);
    const outcome = completeProofBeat(beat, CATALOGUE);
    expect(sim(outcome.state).tick).toBe(sim(beat.state).tick + 1);
    expect(outcome.state.day).toBe(beat.state.day + 1);
    expect(outcome).toMatchObject({ kind: "quiet" });
    expect(outcome.state).toEqual(runWorldTick(beat.state).state);
  });

  it("carries no decision: a choice on a quiet beat is refused", () => {
    const beat = beginProofBeat(start(), CATALOGUE);
    expect(() => completeProofBeat(beat, CATALOGUE, "full_maintenance")).toThrow(/carries no decision/);
  });

  it("offers no way to a new selection without the tick: selecting again is the same quiet beat", () => {
    const world = start();
    const first = beginProofBeat(world, CATALOGUE);
    const again = beginProofBeat(world, CATALOGUE);
    expect(again).toEqual(first);
    // And a stale quiet beat cannot be completed against a world that moved.
    const moved = completeProofBeat(first, CATALOGUE).state;
    expect(() => completeProofBeat({ state: moved, focus: first.focus }, CATALOGUE)).toThrow(StaleFocus);
  });

  it("is presentable: every development it shows has a typed reason, and tick/day alone are none", () => {
    const beat = beginProofBeat(start(), CATALOGUE);
    if (beat.focus.kind !== "quiet") throw new Error("expected quiet");
    expect(beat.focus.quiet.developments.length).toBeGreaterThan(0);
    for (const development of beat.focus.quiet.developments) expect(developmentReason(development)).toMatch(/^[A-Z_]+$/);
    const still = stillWorld();
    expect(relevantDevelopments(still, runWorldTick(still).state, CATALOGUE)).toEqual([]);
  });
});

describe("the selector previews the World Tick; it never runs it", () => {
  it("returns a quiet focus without changing the world, and the lifecycle's tick is the tick it previewed", () => {
    const world = start();
    const before = structuredClone(world);
    const focus = selectProofFocus(world, CATALOGUE);
    expect(world).toEqual(before);
    if (focus.kind !== "quiet") throw new Error("expected quiet");
    const outcome = completeProofBeat({ state: world, focus }, CATALOGUE);
    if (outcome.kind !== "quiet") throw new Error("expected quiet");
    expect(outcome.developments).toEqual(focus.quiet.developments);
  });
});

describe("the quiet bound (spec 14.6)", () => {
  it("measures ticks since the last resolved decision, from 0 on a fresh run", () => {
    expect(QUIET_TICK_BOUND).toBe(1);
    const fresh = start();
    expect(ticksSinceLastResolvedDecision(fresh)).toBe(0);
    const decided = decide(runWorldTick(runWorldTick(fresh).state).state, "evt_f2_recycler_warning", "full_maintenance");
    expect(ticksSinceLastResolvedDecision(decided)).toBe(0);
    expect(ticksSinceLastResolvedDecision(runWorldTick(decided).state)).toBe(1);
  });

  it("allows one quiet interval, then requires an EVENT while something is eligible", () => {
    const quiet = beginProofBeat(start(), CATALOGUE);
    expect(quiet.focus.kind).toBe("quiet");
    const after = completeProofBeat(quiet, CATALOGUE).state;
    const next = selectProofFocus(after, CATALOGUE);
    expect(next.kind).toBe("event");
    if (next.kind === "event") {
      expect(next.selection.rule).toBe("quiet_bound");
      expect(next.selection.quietBoundReached).toBe(true);
    }
  });

  it("chooses the EVENT at the bound by the normal three terms", () => {
    const after = completeProofBeat(beginProofBeat(start(), CATALOGUE), CATALOGUE).state;
    const next = selectProofFocus(after, CATALOGUE);
    if (next.kind !== "event") throw new Error("expected an event");
    expect(next.event.id).toBe(next.selection.candidates[0]!.eventId);
    const [best, second] = next.selection.candidates;
    expect(best!.priority).toBeGreaterThanOrEqual(second?.priority ?? -Infinity);
  });

  it("fails closed, typed, when the bound is reached and nothing is eligible -- never another QUIET", () => {
    const world = structuredClone(start());
    world.simulation!.tick = 1;
    const gated = probe("evt_x_gated", { eligibility: [{ predicate: "flag_equals", key: "never_set", value: true }] });
    let caught: unknown;
    try {
      selectProofFocus(world, [gated]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PacingDefect);
    expect((caught as PacingDefect).reason).toBe("QUIET_BOUND_REACHED_WITH_NO_ELIGIBLE_EVENT");
    expect((caught as PacingDefect).ticksSinceLastResolvedDecision).toBe(1);
    // The lifecycle does not swallow it either.
    expect(() => beginProofBeat(world, [gated])).toThrow(PacingDefect);
  });

  it("refuses an empty quiet beat: nothing eligible and a tick that shows nothing is a typed defect", () => {
    const still = stillWorld();
    expect(ticksSinceLastResolvedDecision(still)).toBe(0);
    expect(() => selectProofFocus(still, [])).toThrow(/EMPTY_QUIET_WITH_NO_ELIGIBLE_EVENT/);
  });

  it("turns an empty quiet beat into the eligible EVENT instead of filler", () => {
    const focus = selectProofFocus(stillWorld(), [probe("evt_x_available")]);
    expect(focus.kind).toBe("event");
    if (focus.kind === "event") expect(focus.selection.rule).toBe("empty_quiet");
  });

  it("cannot be switched off by a save: history cannot lead the world's clock", () => {
    const after = completeProofBeat(beginProofBeat(start(), CATALOGUE), CATALOGUE).state;
    const tampered = structuredClone(after);
    sim(tampered).resolvedHistory.push({ familyId: "maintenance", eventId: "evt_x", choiceId: "a", playerTurn: 0, worldTick: 5 });
    const saved = JSON.stringify(tampered);
    expect(loadSystemicWorldState(saved, tampered.campaignId).ok).toBe(false);
  });

  it("refuses to measure the bound on a clock that cannot advance exactly (#37)", () => {
    const world = structuredClone(start());
    world.simulation!.tick = 2 ** 53;
    expect(() => ticksSinceLastResolvedDecision(world)).toThrow(/unsafe clock/);
  });
});

describe("the quiet window survives save and load exactly", () => {
  it("decision -> QUIET -> save/load -> same QUIET; its tick -> save/load -> the bound still holds", () => {
    // Through the lifecycle: the opening quiet beat, then the first decision.
    const opened = completeProofBeat(beginProofBeat(start(), CATALOGUE), CATALOGUE).state;
    const first = beginProofBeat(opened, CATALOGUE);
    if (first.focus.kind !== "event") throw new Error("expected the first decision");
    const decided = completeProofBeat(first, CATALOGUE, first.focus.event.choices[0]!.id).state;
    const uninterrupted = selectProofFocus(decided, CATALOGUE);
    expect(uninterrupted.kind).toBe("quiet");
    const reloaded = saveAndLoad(decided);
    expect(selectProofFocus(reloaded, CATALOGUE)).toEqual(uninterrupted);

    // The quiet tick runs; the next selection is due an EVENT, loaded or not.
    const ticked = completeProofBeat({ state: reloaded, focus: selectProofFocus(reloaded, CATALOGUE) }, CATALOGUE).state;
    const afterLoad = selectProofFocus(saveAndLoad(ticked), CATALOGUE);
    expect(afterLoad).toEqual(selectProofFocus(ticked, CATALOGUE));
    expect(afterLoad.kind).toBe("event");
  });
});

describe("inside the window: which is worth more, a quiet beat or an event", () => {
  it("never defers an event urgent enough to be mandatory", () => {
    expect(MANDATORY_URGENCY).toBe(2);
    // Same world, same eligible outbreak: CRITICAL (urgency 1) may wait a
    // quiet beat; CRISIS (urgency 2) may not.
    const refused = decide(runWorldTick(runWorldTick(start()).state).state, "evt_f1_clinic_request", "protect_reserve");
    const at = (value: number) => {
      const world = structuredClone(refused);
      const epidemic = sim(world).epidemic;
      const others = epidemic.contributors.filter(item => item.cause !== "crowding").reduce((sum, item) => sum + item.magnitude, 0);
      epidemic.contributors.find(item => item.cause === "crowding")!.magnitude = Math.round((value - others) * 10000) / 10000;
      epidemic.value = value;
      return selectProofFocus(world, CATALOGUE.filter(event => event.id === "evt_f1_outbreak"));
    };
    expect(at(0.6).kind).toBe("quiet");
    const crisis = at(0.8);
    expect(crisis.kind).toBe("event");
    if (crisis.kind === "event") expect(crisis.selection.rule).toBe("mandatory");
  });

  it("lets a quiet beat wait only for an event that presses at QUIET_YIELD_PRIORITY or more", () => {
    expect(QUIET_YIELD_PRIORITY).toBe(3);
    // Same world, one event, one more causal reference: 2 waits, 3 goes first.
    const agenda = { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false } as const;
    const lockout = { predicate: "agenda_satisfied", agendaId: "agenda_fcl_lockout", value: false } as const;
    const unregistered = { predicate: "agenda_satisfied", agendaId: "agenda_co_unregistered_access", value: false } as const;
    const two = selectProofFocus(start(), [probe("evt_x_press", { relevance: [agenda, lockout] })]);
    const three = selectProofFocus(start(), [probe("evt_x_press", { relevance: [agenda, lockout, unregistered] })]);
    expect(two.kind).toBe("quiet");
    expect(three.kind).toBe("event");
    if (three.kind === "event") expect(three.selection.rule).toBe("priority");
  });

  it("takes the quiet beat when nothing is eligible but the world has something to show", () => {
    const focus = selectProofFocus(start(), []);
    expect(focus.kind).toBe("quiet");
    if (focus.kind === "quiet") expect(focus.quiet.rule).toBe("nothing_eligible");
  });
});
