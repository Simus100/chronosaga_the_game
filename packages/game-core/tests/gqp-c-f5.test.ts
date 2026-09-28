import { describe, expect, it } from "vitest";
import type { ProofChoice, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  agendaConditionHolds,
  applyDueConsequences,
  createGqpScenario,
  factionDebtCount,
  findProofEvent,
  isPatternDetected,
  isProofChoiceAvailable,
  isProofEventEligible,
  readAuthoritativeResource,
  resolveProofChoice,
  runWorldTick
} from "../src";
import { walkLifecycle } from "./support/lifecycle-walk";

/**
 * F5 EXTERNAL RESCUE (spec 11): solve a crisis now, or take on political debt.
 *
 * The family has a requirement no other has: help must never be the obvious
 * answer. It costs an immediate, visible agenda item with the other faction,
 * and repeating it gets dearer through FACTION_DEPENDENCY_GROWING. Both halves
 * are proven here -- on real worlds, and at every F5 decision point the
 * lifecycle can reach.
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

function agendaOf(world: WorldState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of sim(world).factionAgenda) out[item.id] = agendaConditionHolds(item.condition, world);
  return out;
}

const available = (world: WorldState, eventId: string) =>
  findProofEvent(CATALOGUE, eventId).choices.filter(choice => isProofChoiceAvailable(choice, world)).map(choice => choice.id);

// A settlement with a spliced League line (one League debt), three ticks on:
// the cisterns are nearly dry and the League's offer is on the table.
const dryWithOneDebt = () => tick(decide(start(), "evt_f3_conduit_offer", "tap_quietly"), 3);

describe("a resource crisis is the prerequisite", () => {
  it("offers water only once the cisterns are nearly dry", () => {
    const convoy = findProofEvent(CATALOGUE, "evt_f5_water_convoy");
    expect(isProofEventEligible(convoy, start())).toBe(false);
    expect(readAuthoritativeResource(start(), "water")).toBeGreaterThanOrEqual(5);
    const dry = tick(start(), 3);
    expect(readAuthoritativeResource(dry, "water")).toBeLessThan(5);
    expect(isProofEventEligible(convoy, dry)).toBe(true);
  });

  it("offers medicine only while the fever spreads and the shelves are low", () => {
    const relief = findProofEvent(CATALOGUE, "evt_f5_medical_relief");
    const spreading = tick(start(), 2);
    expect(isProofEventEligible(relief, spreading)).toBe(false); // medicine still >= 6
    const treated = decide(spreading, "evt_f1_clinic_request", "treat_now");
    expect(isProofEventEligible(relief, treated)).toBe(true);
  });
});

describe("help costs something with the other side, immediately and visibly", () => {
  it("first rescue: the League's water arrives, the Council's grievance opens, a debt is recorded, a tithe is scheduled", () => {
    const before = dryWithOneDebt();
    const after = decide(before, "evt_f5_water_convoy", "league_convoy");
    expect(readAuthoritativeResource(after, "water") - readAuthoritativeResource(before, "water")).toBe(10);
    expect(agendaOf(before).agenda_co_no_league_client).toBe(true);
    expect(agendaOf(after).agenda_co_no_league_client).toBe(false);
    expect(factionDebtCount(after, "faction_front")).toBe(factionDebtCount(before, "faction_front") + 1);
    const tithe = sim(after).delayedConsequences.find(item => item.id === "con.evt_f5_water_convoy.league_convoy.tithe");
    expect(tithe?.status).toBe("pending");
    // The League takes its share of power later: a cost, not a gift.
    expect(tithe!.effects).toEqual([{ type: "RESOURCE_DELTA", key: "energy", value: -4 }]);
  });

  it("the Council's help opens the League's grievance instead", () => {
    // A maintained recycler earns the Council's trust.
    const trusted = tick(decide(start(), "evt_f2_recycler_warning", "full_maintenance"), 5);
    expect(available(trusted, "evt_f5_water_convoy")).toContain("council_allocation");
    const after = decide(trusted, "evt_f5_water_convoy", "council_allocation");
    expect(agendaOf(after).agenda_fcl_no_council_client).toBe(false);
    expect(agendaOf(after).agenda_co_no_league_client).toBe(true);
    expect(factionDebtCount(after, "faction_compact")).toBe(1);
  });

  it("the Council does not help a settlement that has let its plant run down", () => {
    expect(available(dryWithOneDebt(), "evt_f5_water_convoy")).not.toContain("council_allocation");
  });
});

/** The same world, with the fever spreading and the clinic's shelves low: medical relief is due. */
function withMedicalCrisis(state: WorldState): WorldState {
  const world = structuredClone(state);
  const epidemic = sim(world).epidemic;
  const others = epidemic.contributors.filter(item => item.cause !== "crowding").reduce((sum, item) => sum + item.magnitude, 0);
  const crowding = Math.max(0, Math.round((0.4 - others) * 10000) / 10000);
  epidemic.contributors.find(item => item.cause === "crowding")!.magnitude = crowding;
  epidemic.value = Math.round((others + crowding) * 10000) / 10000;
  sim(world).settlements[0]!.resourceStock.medicine = 3;
  world.resources.medicine = 3;
  return world;
}

describe("repeated rescue: the third call for help is a political position", () => {
  it("one debt: plain help; two debts: the plain offers close and the terms open", () => {
    const one = dryWithOneDebt();
    expect(factionDebtCount(one, "faction_front")).toBe(1);
    expect(available(withMedicalCrisis(one), "evt_f5_medical_relief")).toContain("league_medics");
    expect(available(withMedicalCrisis(one), "evt_f5_medical_relief")).not.toContain("league_medics_on_terms");

    const two = decide(one, "evt_f5_water_convoy", "league_convoy");
    expect(isPatternDetected(two, "FACTION_DEPENDENCY_GROWING", "faction_front")).toBe(true);
    expect(available(two, "evt_f5_water_convoy")).not.toContain("league_convoy");
    const needy = withMedicalCrisis(two);
    expect(isProofEventEligible(findProofEvent(CATALOGUE, "evt_f5_medical_relief"), needy)).toBe(true);
    expect(available(needy, "evt_f5_medical_relief")).toContain("league_medics_on_terms");
    expect(available(needy, "evt_f5_medical_relief")).not.toContain("league_medics");
  });

  it("the terms cost what plain help does not: standing access, the Security Council's approval, public pressure", () => {
    const one = dryWithOneDebt();
    const needy = withMedicalCrisis(decide(one, "evt_f5_water_convoy", "league_convoy"));
    const onTerms = decide(needy, "evt_f5_medical_relief", "league_medics_on_terms");
    expect(agendaOf(onTerms).agenda_fcl_access).toBe(true); // a concession, not a favour
    const security = (w: WorldState) => sim(w).politicalGroups.find(g => g.id === "group_security")!.approval;
    expect(security(onTerms)).toBeLessThan(security(needy));
    expect(onTerms.worldPressure).toBeGreaterThan(needy.worldPressure);
  });

  it("the League collects once it holds two debts, and not before", () => {
    const ledger = findProofEvent(CATALOGUE, "evt_f5_league_calls_in");
    const one = dryWithOneDebt();
    expect(isProofEventEligible(ledger, one)).toBe(false);
    expect(isProofEventEligible(ledger, decide(one, "evt_f5_water_convoy", "league_convoy"))).toBe(true);
  });
});

describe("self-reliance is a real path, with its own price", () => {
  it("rationing takes no help: no debt, no agenda item opened -- paid in consent, disease and the district's patience", () => {
    const before = dryWithOneDebt();
    const after = decide(before, "evt_f5_water_convoy", "ration_the_cisterns");
    expect(factionDebtCount(after, "faction_front")).toBe(factionDebtCount(before, "faction_front"));
    expect(agendaOf(after)).toEqual(agendaOf(before));
    const labor = (w: WorldState) => sim(w).politicalGroups.find(g => g.id === "group_labor")!.approval;
    expect(labor(after)).toBeLessThan(labor(before));
    expect(sim(after).epidemic.value).toBeGreaterThan(sim(before).epidemic.value);
    // And Sela will raise it.
    expect(isProofEventEligible(findProofEvent(CATALOGUE, "evt_f4_sela_takes_it_public"), after)).toBe(true);
  });
});

/**
 * The F5 dominance audit (spec 11, F5). At every F5 decision point the
 * lifecycle can reach in a session, each open option is measured as:
 *
 *   immediate resource benefit / cost   stock actually gained or spent
 *   political cost                      approval lost per group, pressure added
 *   agenda consequence                  each agenda item, holding or not
 *   dependency consequence              debts recorded per faction
 *   future cost                         delayed harm scheduled
 *   future availability                 options opened or closed elsewhere
 *
 * and no option may be at least as good as another on every axis and better
 * on one. Agenda items and factions are separate axes: conceding to the
 * Council is not better or worse than conceding to the League.
 */
const RESOURCES = ["water", "energy", "food", "medicine", "alloys", "credits"] as const;

interface AuditRow {
  readonly choice: string;
  readonly benefit: Record<string, number>;
  readonly cost: Record<string, number>;
  readonly political: Record<string, number>;
  readonly agenda: Record<string, number>;
  readonly dependency: Record<string, number>;
  readonly future: { readonly delayedHarm: number; readonly opened: number; readonly closed: number };
  readonly vector: number[];
}

function openOptionsElsewhere(world: WorldState, eventId: string): Set<string> {
  return new Set(
    CATALOGUE.filter(event => event.id !== eventId).flatMap(event =>
      event.choices.filter(choice => isProofChoiceAvailable(choice, world)).map(choice => `${event.id}:${choice.id}`)
    )
  );
}

function auditRow(state: WorldState, eventId: string, choice: ProofChoice): AuditRow {
  const after = resolveProofChoice(state, CATALOGUE, eventId, choice.id).state;
  const benefit: Record<string, number> = {};
  const cost: Record<string, number> = {};
  for (const key of RESOURCES) {
    const delta = readAuthoritativeResource(after, key) - readAuthoritativeResource(state, key);
    if (delta > 0) benefit[key] = delta;
    if (delta < 0) cost[key] = -delta;
  }
  const political: Record<string, number> = { pressure: after.worldPressure - state.worldPressure };
  for (const group of sim(after).politicalGroups) {
    political[group.id] = group.approval - sim(state).politicalGroups.find(g => g.id === group.id)!.approval;
  }
  political.epidemic = sim(after).epidemic.value - sim(state).epidemic.value;
  const [a, b] = [agendaOf(state), agendaOf(after)];
  const agenda: Record<string, number> = {};
  for (const id of Object.keys(b)) agenda[id] = Number(b[id]) - Number(a[id]);
  const dependency: Record<string, number> = {};
  for (const faction of sim(state).factions) dependency[faction.id] = factionDebtCount(after, faction.id) - factionDebtCount(state, faction.id);
  const delayedHarm = (choice.schedules ?? [])
    .flatMap(schedule => schedule.effects)
    .reduce((sum, effect) => sum + (effect.type === "RESOURCE_DELTA" && effect.value < 0 ? -effect.value : 0), 0);
  const [before, later] = [openOptionsElsewhere(state, eventId), openOptionsElsewhere(after, eventId)];
  const opened = [...later].filter(option => !before.has(option)).length;
  const closed = [...before].filter(option => !later.has(option)).length;
  const stress = (w: WorldState) => w.party.reduce((sum, c) => sum + c.stress, 0);

  const vector = [
    ...RESOURCES.map(key => (benefit[key] ?? 0) - (cost[key] ?? 0)),
    -political.pressure!,
    -political.epidemic!,
    ...sim(after).politicalGroups.map(group => political[group.id]!),
    ...Object.keys(agenda).sort().map(id => agenda[id]!),
    ...Object.keys(dependency).sort().map(id => -dependency[id]!),
    -delayedHarm,
    -(stress(after) - stress(state))
  ];
  return { choice: choice.id, benefit, cost, political, agenda, dependency, future: { delayedHarm, opened, closed }, vector };
}

function dominates(x: number[], y: number[]): boolean {
  const eps = 1e-9;
  return x.every((v, i) => v >= y[i]! - eps) && x.some((v, i) => v > y[i]! + eps);
}

describe("the F5 dominance audit, at every F5 decision point a session can reach", () => {
  const walk = walkLifecycle({ beats: 15 });
  const f5 = walk.decisions.filter(context => context.event.familyId === "external_rescue");

  it("reaches every F5 event and every F5 option", () => {
    const events = new Set(f5.map(context => context.event.id));
    expect([...events].sort()).toEqual(["evt_f5_council_calls_in", "evt_f5_league_calls_in", "evt_f5_medical_relief", "evt_f5_water_convoy"]);
    const options = new Set(f5.flatMap(context => context.open.map(id => `${context.event.id}:${id}`)));
    const all = CATALOGUE.filter(event => event.familyId === "external_rescue").flatMap(event => event.choices.map(c => `${event.id}:${c.id}`));
    expect(all.filter(option => !options.has(option))).toEqual([]);
  });

  it("finds no option that dominates another", () => {
    const dominated: string[] = [];
    let compared = 0;
    for (const context of f5) {
      const rows = context.open.map(id => auditRow(context.state, context.event.id, context.event.choices.find(c => c.id === id)!));
      for (const x of rows) {
        for (const y of rows) {
          if (x === y) continue;
          compared += 1;
          if (dominates(x.vector, y.vector)) dominated.push(`${context.event.id}: ${x.choice} dominates ${y.choice} (beat ${context.beat})`);
        }
      }
    }
    expect(dominated).toEqual([]);
    expect(compared).toBeGreaterThan(100);
  });

  it("never lets help be free: help always leaves the other side's grievance open and a debt recorded", () => {
    // The first help from a faction opens the adverse grievance; later help
    // finds it already open and keeps it so. Either way the grievance does
    // not hold afterwards, and the debt grows.
    const adverse: Record<string, string> = { faction_front: "agenda_co_no_league_client", faction_compact: "agenda_fcl_no_council_client" };
    let checked = 0;
    for (const context of f5) {
      for (const id of context.open) {
        const choice = context.event.choices.find(c => c.id === id)!;
        const debt = choice.effects.find(e => e.type === "MEMORY_RECORD" && e.behaviorHook === "call_in_debt");
        if (!debt || debt.type !== "MEMORY_RECORD") continue;
        const helper = debt.subjectId!;
        const after = resolveProofChoice(context.state, CATALOGUE, context.event.id, id).state;
        expect(agendaOf(after)[adverse[helper]!], `${context.event.id}:${id}`).toBe(false);
        expect(factionDebtCount(after, helper)).toBe(factionDebtCount(context.state, helper) + 1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
