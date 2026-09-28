import { describe, expect, it } from "vitest";
import type { SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  applyDueConsequences,
  createGqpScenario,
  eligibleProofEvents,
  findProofEvent,
  isFactPublic,
  isPatternDetected,
  isProofChoiceAvailable,
  resolveProofChoice,
  runWorldTick,
  scoreProofCandidates
} from "../src";
import { walkLifecycle } from "./support/lifecycle-walk";

/**
 * Every detector changes play, not just a boolean.
 *
 * For each one: the same world, with the pattern off and on, and a difference
 * the player would meet -- an event eligible or not, an option open or closed,
 * a candidate scored higher. A detector that could be switched off without any
 * of these moving would be decoration.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

function decide(state: WorldState, eventId: string, choiceId: string): WorldState {
  return applyDueConsequences(resolveProofChoice(state, CATALOGUE, eventId, choiceId).state).state;
}

function tick(state: WorldState, times = 1): WorldState {
  let world = state;
  for (let i = 0; i < times; i += 1) world = runWorldTick(world).state;
  return world;
}

const eligibleIds = (world: WorldState) => eligibleProofEvents(world, CATALOGUE).map(event => event.id);
const open = (world: WorldState, eventId: string) =>
  findProofEvent(CATALOGUE, eventId).choices.filter(choice => isProofChoiceAvailable(choice, world)).map(choice => choice.id);
const relevance = (world: WorldState, eventId: string) =>
  scoreProofCandidates(world, CATALOGUE).find(candidate => candidate.eventId === eventId)?.relevance.total;

describe("IGNORED_TECHNICAL_WARNINGS changes F2 and F4", () => {
  const patched = () => decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
  const off = () => decide(patched(), "evt_f2_tarek_second_warning", "authorize_inspection");
  const on = () => decide(patched(), "evt_f2_tarek_second_warning", "let_it_ride");
  const broken = (world: WorldState) => {
    const copy = structuredClone(world);
    sim(copy).productionNodes[0]!.condition = 0.5;
    return copy;
  };

  it("pattern off -> no testimony; on -> Tarek goes public (F4 eligibility)", () => {
    expect(isPatternDetected(off(), "IGNORED_TECHNICAL_WARNINGS")).toBe(false);
    expect(isPatternDetected(on(), "IGNORED_TECHNICAL_WARNINGS")).toBe(true);
    expect(eligibleIds(off())).not.toContain("evt_f4_tarek_goes_public");
    expect(eligibleIds(on())).toContain("evt_f4_tarek_goes_public");
  });

  it("pattern off -> the breakdown is a breakdown; on -> it answers to the ignored warnings (F2 selection)", () => {
    expect(relevance(broken(on()), "evt_f2_recycler_breakdown")).toBe(relevance(broken(off()), "evt_f2_recycler_breakdown")! + 1);
  });
});

describe("REPEATED_PROTECTION_OR_NEGLECT changes F1 and F4", () => {
  const supplied = () => decide(tick(start(), 2), "evt_f1_clinic_request", "treat_now");

  it("protection: off -> no accounting; on -> Sela asks for the real accounts (F4 eligibility)", () => {
    const off = decide(supplied(), "evt_f1_ira_prevention_drive", "keep_ira_at_the_clinic");
    const on = decide(supplied(), "evt_f1_ira_prevention_drive", "back_the_drive");
    expect(eligibleIds(off)).not.toContain("evt_f4_open_the_books");
    expect(eligibleIds(on)).toContain("evt_f4_open_the_books");
  });

  it("neglect: off -> no demand; on -> the district demands answers (F4) and the outbreak answers to it (F1 selection)", () => {
    const refused = decide(tick(start(), 5), "evt_f1_clinic_request", "protect_reserve");
    const off = decide(refused, "evt_f1_outbreak", "full_treatment_campaign");
    const on = decide(refused, "evt_f1_outbreak", "ride_it_out");
    expect(eligibleIds(off)).not.toContain("evt_f4_district_demands_answers");
    expect(eligibleIds(on)).toContain("evt_f4_district_demands_answers");
    // The outbreak is resolved in both, so its relevance is read before it: a
    // second neglect before an outbreak makes the outbreak answer to it.
    const neglectedTwice = decide(tick(start(), 3), "evt_f1_clinic_request", "ration_district");
    const rationed = decide(tick(neglectedTwice, 2), "evt_f5_water_convoy", "ration_the_cisterns");
    const critical = structuredClone(rationed);
    const epidemic = sim(critical).epidemic;
    const others = epidemic.contributors.filter(c => c.cause !== "crowding").reduce((s, c) => s + c.magnitude, 0);
    epidemic.contributors.find(c => c.cause === "crowding")!.magnitude = Math.max(0, Math.round((0.6 - others) * 10000) / 10000);
    epidemic.value = Math.round((others + epidemic.contributors.find(c => c.cause === "crowding")!.magnitude) * 10000) / 10000;
    expect(isPatternDetected(critical, "REPEATED_PROTECTION_OR_NEGLECT", "neglect")).toBe(true);
    const reasons = scoreProofCandidates(critical, CATALOGUE).find(c => c.eventId === "evt_f1_outbreak")!.relevance.reasons;
    expect(reasons).toContainEqual({ kind: "pattern", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", points: 1 });
  });
});

describe("FACTION_DEPENDENCY_GROWING is what makes F5 dearer the third time", () => {
  const one = () => tick(decide(start(), "evt_f3_conduit_offer", "tap_quietly"), 3);
  const two = () => decide(one(), "evt_f5_water_convoy", "league_convoy");

  it("off -> the League sends water as a favour; on -> that option is gone and its ledger arrives", () => {
    expect(isPatternDetected(one(), "FACTION_DEPENDENCY_GROWING", "faction_front")).toBe(false);
    expect(isPatternDetected(two(), "FACTION_DEPENDENCY_GROWING", "faction_front")).toBe(true);
    expect(open(one(), "evt_f5_water_convoy")).toContain("league_convoy");
    expect(open(two(), "evt_f5_water_convoy")).not.toContain("league_convoy");
    expect(eligibleIds(one())).not.toContain("evt_f5_league_calls_in");
    expect(eligibleIds(two())).toContain("evt_f5_league_calls_in");
    expect(eligibleIds(two())).toContain("evt_f4_whose_settlement");
  });

  it("on -> the League's line is called in with more weight (F3 selection)", () => {
    // Debt called is eligible in both worlds; only the dependency differs.
    expect(eligibleIds(one())).toContain("evt_f3_debt_called");
    expect(relevance(two(), "evt_f3_debt_called")).toBe(relevance(one(), "evt_f3_debt_called")! + 1);
  });
});

describe("SECRET_ACTION_DISCOVERED connects F3 to a public consequence", () => {
  // The line is spliced at turn 1; turn 2 puts Tarek on the recycler (patch) or
  // not (the clinic's power is borrowed instead); turn 3 lands the strain.
  const tapped = () => decide(start(), "evt_f3_conduit_offer", "tap_quietly");
  const land = (world: WorldState) => decide(tick(world, 2), "evt_f1_clinic_request", "treat_now");
  const kept = () => land(decide(tapped(), "evt_f2_recycler_warning", "divert_clinic_power"));
  const found = () => land(decide(tapped(), "evt_f2_recycler_warning", "patch_and_defer"));

  it("off -> the line stays a secret nobody can be asked about; on -> the steward must answer for it (F4)", () => {
    expect(eligibleIds(kept())).not.toContain("evt_f4_conduit_exposed");
    expect(eligibleIds(found())).toContain("evt_f4_conduit_exposed");
  });

  it("on -> the League calls its line in with more weight (F3 selection)", () => {
    expect(relevance(found(), "evt_f3_debt_called")).toBe(relevance(kept(), "evt_f3_debt_called")! + 1);
  });

  it("discovery itself publishes nothing: the fact is public only after a decision publishes it", () => {
    const world = found();
    expect(isFactPublic(world, sim(world), "fact_f3_secret_tap")).toBe(false);
    expect(world.party.filter(c => (c.memories ?? []).some(m => m.id === "fact_f3_secret_tap")).map(c => c.id)).toEqual(["mara_001"]);
  });
});

describe("the same secret, survived and discovered, across every lifecycle path a session can take", () => {
  // Every reachable decision point after the line was spliced quietly and its
  // strain has landed: either Tarek was put to work on the recycler after the
  // splice (and not already turned away), or nobody who could read it was.
  const walk = walkLifecycle({ beats: 15 });
  const strain = "con.evt_f3_conduit_offer.tap_quietly.strain";
  const landed = walk.decisions
    .map(context => context.state)
    .filter(state => state.party.find(c => c.id === "mara_001")!.memories?.some(m => m.id === "fact_f3_secret_tap" && m.origin === "direct"))
    .filter(state => sim(state).delayedConsequences.find(c => c.id === strain)?.status === "applied")
    .filter(state => !isFactPublic(state, sim(state), "fact_f3_secret_tap"));
  /** Tarek was involved in a decision after the splice, and had not refused anything before it. */
  const tarekReadTheBus = (state: WorldState) => {
    const spliceTurn = state.party.find(c => c.id === "mara_001")!.memories!.find(m => m.id === "fact_f3_secret_tap")!.turn;
    const tarek = state.party.find(c => c.id === "tarek_001")!.memories ?? [];
    const first = tarek.filter(m => m.origin === "direct" && m.source.kind === "choice" && m.turn > spliceTurn).sort((a, b) => a.turn - b.turn)[0];
    return first !== undefined && !tarek.some(m => m.origin === "direct" && m.behaviorHook === "refuse_similar_request" && m.turn < first.turn);
  };

  it("reaches both outcomes", () => {
    const discovered = landed.filter(state => isPatternDetected(state, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap"));
    const survived = landed.filter(state => !isPatternDetected(state, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap"));
    expect(discovered.length).toBeGreaterThan(0);
    expect(survived.length).toBeGreaterThan(0);
  });

  it("explains every difference by one authoritative condition: whether Tarek worked the bus after the splice", () => {
    for (const state of landed) {
      expect(isPatternDetected(state, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap")).toBe(tarekReadTheBus(state));
    }
  });

  it("keeps a surviving secret local: one holder, no community copy, no faction awareness, no accountability event", () => {
    for (const state of landed.filter(s => !isPatternDetected(s, "SECRET_ACTION_DISCOVERED"))) {
      const holders = state.party.filter(c => (c.memories ?? []).some(m => m.id === "fact_f3_secret_tap")).map(c => c.id);
      expect(holders).toEqual(["mara_001"]);
      expect(sim(state).factions.some(f => f.memoryTags.includes("aware:fact_f3_secret_tap"))).toBe(false);
      expect(eligibleIds(state)).not.toContain("evt_f4_conduit_exposed");
    }
  });
});
