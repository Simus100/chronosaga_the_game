import { describe, expect, it } from "vitest";
import type { SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  agendaConditionHolds,
  applyDueConsequences,
  createGqpScenario,
  findProofEvent,
  isFactPublic,
  isProofChoiceAvailable,
  isProofEventEligible,
  resolveProofChoice,
  runWorldTick
} from "../src";

/**
 * F4 PUBLIC ACCOUNTABILITY (spec 11): tell the truth about the costs, or keep
 * room to manoeuvre. Each variant is proven on the history that produces it,
 * against the same world without that history -- and each choice is shown to
 * move what F4 must touch: consent (approval, cohort and settlement
 * satisfaction), public memory, and faction agenda.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;
const eligible = (world: WorldState, id: string) => isProofEventEligible(findProofEvent(CATALOGUE, id), world);

function decide(state: WorldState, eventId: string, choiceId: string): WorldState {
  return applyDueConsequences(resolveProofChoice(state, CATALOGUE, eventId, choiceId).state).state;
}

function tick(state: WorldState, times = 1): WorldState {
  let world = state;
  for (let i = 0; i < times; i += 1) world = runWorldTick(world).state;
  return world;
}

const approval = (world: WorldState, groupId: string) => sim(world).politicalGroups.find(group => group.id === groupId)!.approval;
const agenda = (world: WorldState, id: string) => agendaConditionHolds(sim(world).factionAgenda.find(item => item.id === id)!.condition, world);

describe("accountability with credibility: a line of protection earns an honest accounting", () => {
  const supplied = () => decide(tick(start(), 2), "evt_f1_clinic_request", "treat_now");

  it("appears after two protective decisions, and not after one", () => {
    expect(eligible(supplied(), "evt_f4_open_the_books")).toBe(false);
    expect(eligible(decide(supplied(), "evt_f1_ira_prevention_drive", "back_the_drive"), "evt_f4_open_the_books")).toBe(true);
    expect(eligible(decide(supplied(), "evt_f1_ira_prevention_drive", "keep_ira_at_the_clinic"), "evt_f4_open_the_books")).toBe(false);
  });

  it("publishing the accounts buys the district's consent with the Security Council's, and becomes public knowledge", () => {
    const before = decide(supplied(), "evt_f1_ira_prevention_drive", "back_the_drive");
    const after = decide(before, "evt_f4_open_the_books", "publish_the_accounts");
    expect(approval(after, "group_labor")).toBeGreaterThan(approval(before, "group_labor"));
    expect(approval(after, "group_security")).toBeLessThan(approval(before, "group_security"));
    const industrial = (w: WorldState) => sim(w).populationCohorts.find(c => c.id === "cohort_industrial")!.satisfaction;
    expect(industrial(after)).toBeGreaterThan(industrial(before));
    expect(sim(after).settlements[0]!.satisfaction).toBeGreaterThan(sim(before).settlements[0]!.satisfaction);
    expect(isFactPublic(after, sim(after), "fact_f4_books_opened")).toBe(true);
  });

  it("keeping the margin costs later, not now: the district's doubt is scheduled behind Sela's memory", () => {
    const before = decide(supplied(), "evt_f1_ira_prevention_drive", "back_the_drive");
    const after = decide(before, "evt_f4_open_the_books", "keep_the_margin");
    expect(approval(after, "group_labor")).toBe(approval(before, "group_labor"));
    expect(sim(after).delayedConsequences.find(c => c.id === "con.evt_f4_open_the_books.keep_the_margin.doubt")?.status).toBe("pending");
    // And Sela will raise it.
    expect(eligible(after, "evt_f4_sela_takes_it_public")).toBe(true);
  });

  it("moves the League's lockout grievance through the Labour Assembly's approval -- agenda read, never authored", () => {
    const before = decide(supplied(), "evt_f1_ira_prevention_drive", "back_the_drive");
    const close = structuredClone(before);
    sim(close).politicalGroups.find(g => g.id === "group_labor")!.approval = 0.5;
    expect(agenda(close, "agenda_fcl_lockout")).toBe(false);
    expect(agenda(decide(close, "evt_f4_open_the_books", "publish_the_accounts"), "agenda_fcl_lockout")).toBe(true);
    expect(agenda(decide(close, "evt_f4_open_the_books", "keep_the_margin"), "agenda_fcl_lockout")).toBe(false);
  });
});

describe("accountability after concealment: a discovered secret, and what the steward does with it", () => {
  // The line is spliced quietly (turn 1); turn 2 puts Tarek on the recycler
  // (patch) or borrows the clinic's power instead; turn 3 lands the strain.
  const tapped = () => decide(start(), "evt_f3_conduit_offer", "tap_quietly");
  const land = (world: WorldState) => decide(tick(world, 2), "evt_f1_clinic_request", "treat_now");
  const discovered = () => land(decide(tapped(), "evt_f2_recycler_warning", "patch_and_defer"));
  const kept = () => land(decide(tapped(), "evt_f2_recycler_warning", "divert_clinic_power"));

  it("opens only where the secret was found", () => {
    expect(eligible(discovered(), "evt_f4_conduit_exposed")).toBe(true);
    expect(eligible(kept(), "evt_f4_conduit_exposed")).toBe(false);
  });

  it("owning it publishes the fact through the one publication channel, and repairs the Council's grievance", () => {
    const before = discovered();
    expect(isFactPublic(before, sim(before), "fact_f3_secret_tap")).toBe(false);
    const after = decide(before, "evt_f4_conduit_exposed", "own_it_publicly");
    expect(isFactPublic(after, sim(after), "fact_f3_secret_tap")).toBe(true);
    expect(sim(after).factions.find(f => f.id === "faction_compact")!.memoryTags).toContain("aware:fact_f3_secret_tap");
    expect(agenda(before, "agenda_co_unregistered_access")).toBe(false);
    expect(agenda(after, "agenda_co_unregistered_access")).toBe(true);
    expect(approval(after, "group_security")).toBeLessThan(approval(before, "group_security"));
  });

  it("public memory is load-bearing: once the fact is public, the late confession closes", () => {
    const owned = decide(discovered(), "evt_f4_conduit_exposed", "own_it_publicly");
    const confess = findProofEvent(CATALOGUE, "evt_f3_debt_called").choices.find(c => c.id === "disclose_and_register")!;
    expect(isProofChoiceAvailable(confess, discovered())).toBe(true);
    expect(isProofChoiceAvailable(confess, owned)).toBe(false);
  });

  it("burying it keeps the secret -- and Tarek remembers being told to", () => {
    const after = decide(discovered(), "evt_f4_conduit_exposed", "bury_it");
    expect(isFactPublic(after, sim(after), "fact_f3_secret_tap")).toBe(false);
    const tarek = after.party.find(c => c.id === "tarek_001")!;
    expect(tarek.memories!.find(m => m.id === "fact_f4_told_to_bury")?.behaviorHook).toBe("refuse_similar_request");
    expect(sim(after).delayedConsequences.find(c => c.id === "con.evt_f4_conduit_exposed.bury_it.leak")?.status).toBe("pending");
  });

  it("naming Mara costs the Labour Assembly she leads, and turns her against the next request", () => {
    const before = discovered();
    const after = decide(before, "evt_f4_conduit_exposed", "blame_the_quartermaster");
    expect(approval(after, "group_labor")).toBeLessThan(approval(before, "group_labor"));
    expect(after.party.find(c => c.id === "mara_001")!.memories!.some(m => m.behaviorHook === "refuse_similar_request")).toBe(true);
    expect(isFactPublic(after, sim(after), "fact_f3_secret_tap")).toBe(true);
  });
});

describe("accountability after neglect, after ignored warnings, after dependence", () => {
  it("the district demands answers after two decisions that left the cost on it", () => {
    const refused = decide(tick(start(), 5), "evt_f1_clinic_request", "protect_reserve");
    expect(eligible(refused, "evt_f4_district_demands_answers")).toBe(false);
    const endured = decide(refused, "evt_f1_outbreak", "ride_it_out");
    expect(eligible(endured, "evt_f4_district_demands_answers")).toBe(true);
    const restitution = decide(endured, "evt_f4_district_demands_answers", "make_restitution");
    const defended = decide(endured, "evt_f4_district_demands_answers", "defend_the_triage");
    expect(approval(restitution, "group_labor")).toBeGreaterThan(approval(defended, "group_labor"));
    expect(approval(defended, "group_security")).toBeGreaterThan(approval(restitution, "group_security"));
    expect(isFactPublic(defended, sim(defended), "fact_f4_triage_defended")).toBe(true);
  });

  it("Tarek goes public only after being overruled twice, and his friends remember how he was answered", () => {
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const heeded = decide(patched, "evt_f2_tarek_second_warning", "authorize_inspection");
    const dismissed = decide(patched, "evt_f2_tarek_second_warning", "let_it_ride");
    expect(eligible(heeded, "evt_f4_tarek_goes_public")).toBe(false);
    expect(eligible(dismissed, "evt_f4_tarek_goes_public")).toBe(true);
    const discredited = decide(dismissed, "evt_f4_tarek_goes_public", "discredit_tarek");
    // Mara, Tarek's close ally, now refuses the League's technicians.
    const front = findProofEvent(CATALOGUE, "evt_f2_recycler_breakdown").choices.find(c => c.id === "front_technicians")!;
    const broken = (w: WorldState) => {
      const copy = structuredClone(w);
      sim(copy).productionNodes[0]!.condition = 0.5;
      return copy;
    };
    expect(isProofChoiceAvailable(front, broken(dismissed))).toBe(true);
    expect(isProofChoiceAvailable(front, broken(discredited))).toBe(false);
  });

  it("the assembly asks whose settlement this is once Helios owes one faction twice", () => {
    let one = decide(start(), "evt_f3_conduit_offer", "tap_quietly");
    one = tick(one, 3);
    expect(eligible(one, "evt_f4_whose_settlement")).toBe(false);
    const two = decide(one, "evt_f5_water_convoy", "league_convoy");
    expect(eligible(two, "evt_f4_whose_settlement")).toBe(true);
  });
});
