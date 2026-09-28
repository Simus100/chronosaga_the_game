import { describe, expect, it } from "vitest";
import type { EventEffect, ProofChoice, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  agendaConditionHolds,
  applyDueConsequences,
  createGqpScenario,
  describeProofChoice,
  factionDebtCount,
  findProofEvent,
  isProofChoiceAvailable,
  readAuthoritativeResource,
  readProofWorld,
  resolveProofChoice,
  runWorldTick
} from "../src";
import { walkLifecycle, type DecisionContext } from "./support/lifecycle-walk";

/**
 * The full F1-F5 network (GQP-C), measured wherever play can go.
 *
 * The GQP-B suites keep proving their claims on the eight events GQP-B was
 * accepted on. This suite takes the same quality gates to the whole catalogue,
 * and measures them at every decision point the real lifecycle can present in
 * a session -- the selector choosing every event, every option the player
 * could take explored -- rather than on hand-picked scripts.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const MAJOR = new Set(["DILEMMA", "COMPLICATION", "CRISIS_PAYOFF"]);
const SESSION = 15;
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

const walk = walkLifecycle({ beats: SESSION });
const majors = () => walk.decisions.filter(context => MAJOR.has(context.event.taxonomy));

function agendaOf(world: WorldState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of sim(world).factionAgenda) out[item.id] = agendaConditionHolds(item.condition, world);
  return out;
}

describe("liveness across every session the lifecycle can play", () => {
  it(`never fails closed within ${SESSION} beats, on any path`, () => {
    expect(walk.defects.map(d => `${d.defect.reason}@${d.beat}: ${d.path.join(" > ")}`)).toEqual([]);
    expect(walk.states).toBeGreaterThan(1000);
  });

  it("makes 6 or 7 decisions in the first 12 beats on every path: the one-tick bound, not a script", () => {
    expect(Object.keys(walk.decisionsByPath).map(Number).sort()).toEqual([6, 7]);
  });
});

describe("reachability: every option of F1-F5 is open somewhere a session reaches", () => {
  it("offers every option at least once", () => {
    const open = new Set(walk.decisions.flatMap(context => context.open.map(id => `${context.event.id}:${id}`)));
    const every = CATALOGUE.flatMap(event => event.choices.map(choice => `${event.id}:${choice.id}`));
    expect(every.filter(option => !open.has(option))).toEqual([]);
  });
});

/** The consequence layers of spec GQP-2 a resolution touches, measured on state. */
function layersOf(context: DecisionContext, choiceId: string): string[] {
  const { state, event } = context;
  const after = resolveProofChoice(state, CATALOGUE, event.id, choiceId).state;
  const a = readProofWorld(state, CATALOGUE);
  const b = readProofWorld(after, CATALOGUE);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const scheduled = sim(after).delayedConsequences.filter(item => !sim(state).delayedConsequences.some(c => c.id === item.id));
  const layers: string[] = [];
  const stocks = (w: WorldState) => [sim(w).settlements.map(s => s.resourceStock), w.resources];
  if (!same(stocks(state), stocks(after))) layers.push("resource");
  if (a.epidemic.value !== b.epidemic.value || state.worldPressure !== after.worldPressure) layers.push("pressure");
  if (!same(a.nodeCondition, b.nodeCondition)) layers.push("infrastructure");
  const people = (w: WorldState) => w.party.map(c => [c.id, c.stress, c.morale, c.health]);
  if (!same(people(state), people(after))) layers.push("character");
  if (!same(a.memories, b.memories) || !same(a.factionAwareness, b.factionAwareness)) layers.push("memory");
  const politics = (w: WorldState) => [sim(w).politicalGroups.map(g => g.approval), sim(w).settlements.map(s => [s.satisfaction, s.stability])];
  if (!same(politics(state), politics(after))) layers.push("political");
  if (!same(a.agenda, b.agenda)) layers.push("faction");
  if (scheduled.length > 0) layers.push("delayed");
  const others = (r: typeof a) => r.eligibleEvents.filter(id => id !== event.id);
  const openElsewhere = (w: WorldState) =>
    CATALOGUE.filter(item => item.id !== event.id).flatMap(item => item.choices.filter(c => isProofChoiceAvailable(c, w)).map(c => `${item.id}:${c.id}`));
  if (!same(others(a), others(b)) || !same(openElsewhere(state), openElsewhere(after))) layers.push("eligibility");
  return layers;
}

describe("GQP-2 on F1-F5: every major option touches at least three layers, wherever it is taken", () => {
  it("holds at every reachable decision point, for every open major option", () => {
    const thin: string[] = [];
    const seen = new Set<string>();
    for (const context of majors()) {
      for (const choiceId of context.open) {
        seen.add(`${context.event.id}:${choiceId}`);
        const layers = layersOf(context, choiceId);
        if (layers.length < 3) thin.push(`${context.event.id}:${choiceId} [${layers.join(",")}] at beat ${context.beat}`);
      }
    }
    expect([...new Set(thin)].slice(0, 10)).toEqual([]);
    const everyMajor = CATALOGUE.filter(event => MAJOR.has(event.taxonomy)).flatMap(event => event.choices.map(c => `${event.id}:${c.id}`));
    expect(everyMajor.filter(option => !seen.has(option))).toEqual([]);
  });
});

/**
 * An option's outcome as a vector where higher is better on every axis:
 * certain immediate effects and authored delayed effects both count; every
 * agenda item, political group and faction debt is its own axis, because
 * conceding to one side is not better or worse than conceding to the other.
 */
function outcome(state: WorldState, eventId: string, choice: ProofChoice): number[] {
  const after = resolveProofChoice(state, CATALOGUE, eventId, choice.id).state;
  const a = readProofWorld(state, CATALOGUE);
  const b = readProofWorld(after, CATALOGUE);
  const delayed = (choice.schedules ?? []).flatMap(schedule => schedule.effects);
  const sum = (effects: EventEffect[], test: (effect: EventEffect) => number) => effects.reduce((total, effect) => total + test(effect), 0);
  const node = (r: typeof a) => Object.values(r.nodeCondition).reduce((x, y) => x + y, 0);
  const stress = (w: WorldState) => w.party.reduce((total, c) => total + c.stress, 0);
  const recorded = choice.effects.filter((effect): effect is Extract<EventEffect, { type: "MEMORY_RECORD" }> => effect.type === "MEMORY_RECORD");
  const secrets = recorded.filter(effect => effect.exposure === "secret").length - choice.effects.filter(effect => effect.type === "MEMORY_PUBLISH").length;
  const [agendaA, agendaB] = [agendaOf(state), agendaOf(after)];
  return [
    ...["energy", "water", "medicine", "food", "alloys", "credits"].map(key => readAuthoritativeResource(after, key) - readAuthoritativeResource(state, key)),
    -(b.epidemic.value - a.epidemic.value) - sum(delayed, e => (e.type === "EPIDEMIC_SHIFT" ? e.delta : 0)),
    node(b) - node(a) + sum(delayed, e => (e.type === "NODE_CONDITION_SHIFT" ? e.delta : 0)),
    -(after.worldPressure - state.worldPressure) - sum(delayed, e => (e.type === "PRESSURE_DELTA" ? e.value : 0)),
    ...sim(after).politicalGroups.map(group => {
      const before = sim(state).politicalGroups.find(g => g.id === group.id)!.approval;
      return group.approval - before + sum(delayed, e => (e.type === "POLITICAL_STANDING_SHIFT" && e.groupId === group.id ? e.delta : 0));
    }),
    sum(delayed, e => (e.type === "RESOURCE_DELTA" ? e.value : 0)),
    -(stress(after) - stress(state)),
    -recorded.filter(effect => effect.valence === "negative").length,
    recorded.filter(effect => effect.valence === "positive").length,
    -secrets,
    -choice.disclosure.risks.length,
    ...Object.keys(agendaB).sort().map(id => Number(agendaB[id]) - Number(agendaA[id])),
    ...sim(state).factions.map(faction => -(factionDebtCount(after, faction.id) - factionDebtCount(state, faction.id)))
  ];
}

function dominates(x: number[], y: number[]): boolean {
  const eps = 1e-9;
  return x.every((v, i) => v >= y[i]! - eps) && x.some((v, i) => v > y[i]! + eps);
}

describe("GQP-1 on F1-F5: no option dominates another where the network presents them", () => {
  it("finds no dominated major option at any reachable decision point -- F4 and F5 included", () => {
    const dominated: string[] = [];
    let compared = 0;
    const families = new Set<string>();
    for (const context of majors()) {
      const vectors = context.open.map(id => ({ id, v: outcome(context.state, context.event.id, context.event.choices.find(c => c.id === id)!) }));
      for (const x of vectors) {
        for (const y of vectors) {
          if (x === y) continue;
          compared += 1;
          families.add(context.event.familyId);
          if (dominates(x.v, y.v)) dominated.push(`${context.event.id}: ${x.id} dominates ${y.id} (beat ${context.beat})`);
        }
      }
    }
    expect([...new Set(dominated)]).toEqual([]);
    expect(compared).toBeGreaterThan(1000);
    expect([...families].sort()).toEqual(["external_rescue", "maintenance", "public_accountability", "scarcity_triage", "unregistered_conduit"]);
  });

  it("gives every major option a benefit over each alternative, a real cost, and a future", () => {
    const missing = new Set<string>();
    for (const context of majors()) {
      const vectors = new Map(context.open.map(id => [id, outcome(context.state, context.event.id, context.event.choices.find(c => c.id === id)!)]));
      for (const [id, v] of vectors) {
        for (const [other, w] of vectors) {
          if (other !== id && !v.some((value, index) => value > w[index]! + 1e-9)) missing.add(`${context.event.id}:${id} is nowhere better than ${other}`);
        }
        if (!v.some(value => value < -1e-9)) missing.add(`${context.event.id}:${id} costs nothing`);
        const future = layersOf(context, id).filter(layer => ["memory", "faction", "delayed", "eligibility"].includes(layer));
        if (future.length === 0) missing.add(`${context.event.id}:${id} has no future consequence`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("spec 11.3 on F1-F5, asserted by machine", () => {
  it("lets at least two families be skipped entirely by a whole session", () => {
    const all = ["external_rescue", "maintenance", "public_accountability", "scarcity_triage", "unregistered_conduit"];
    const skippable = all.filter(family => walk.sessions.some(order => !order.includes(family as never)));
    expect(skippable.length).toBeGreaterThanOrEqual(2);
  });

  it("changes the options of at least three families from memory and agenda", () => {
    // Two reachable moments of the same event, with different open options: the
    // world's memory and agenda closed or opened a door.
    const varied = new Set<string>();
    const byEvent = new Map<string, Set<string>>();
    for (const context of walk.decisions) {
      const key = context.open.join(",");
      const seen = byEvent.get(context.event.id) ?? new Set<string>();
      seen.add(key);
      byEvent.set(context.event.id, seen);
      if (seen.size > 1) varied.add(context.event.familyId);
    }
    expect(varied.size).toBeGreaterThanOrEqual(3);
    // And the doors are memory/agenda doors, not only affordability.
    const gated = CATALOGUE.filter(event => varied.has(event.familyId)).flatMap(event => event.choices.flatMap(c => c.availability ?? []));
    const causal = new Set(gated.filter(p => ["memory_hook_present", "memory_known", "agenda_satisfied", "pattern_detected"].includes(p.predicate)).map(p => p.predicate));
    expect(causal.size).toBeGreaterThanOrEqual(3);
  });

  it("pays back at least two costly early decisions later", () => {
    const start = createGqpScenario(7419);
    const decide = (w: WorldState, e: string, c: string) => applyDueConsequences(resolveProofChoice(w, CATALOGUE, e, c).state).state;
    const tick = (w: WorldState, n: number) => { let x = w; for (let i = 0; i < n; i += 1) x = runWorldTick(x).state; return x; };
    // 1. A full overhaul costs ten energy -- and earns the Council's trust: its
    //    allocation is open when the cisterns run dry, where a patch's is not.
    const maintained = tick(decide(start, "evt_f2_recycler_warning", "full_maintenance"), 5);
    const patched = tick(decide(start, "evt_f2_recycler_warning", "patch_and_defer"), 5);
    const allocation = findProofEvent(CATALOGUE, "evt_f5_water_convoy").choices.find(c => c.id === "council_allocation")!;
    expect(isProofChoiceAvailable(allocation, maintained)).toBe(true);
    expect(isProofChoiceAvailable(allocation, patched)).toBe(false);
    // 2. Opening the reserve costs water and medicine -- and Ira comes back with
    //    a plan that repairs the district's cisterns.
    const treated = decide(tick(start, 2), "evt_f1_clinic_request", "treat_now");
    const refused = decide(tick(start, 2), "evt_f1_clinic_request", "protect_reserve");
    expect(readProofWorld(treated, CATALOGUE).eligibleEvents).toContain("evt_f1_ira_prevention_drive");
    expect(readProofWorld(refused, CATALOGUE).eligibleEvents).not.toContain("evt_f1_ira_prevention_drive");
  });

  it("lets at least two apparently helpful decisions complicate things later", () => {
    const start = createGqpScenario(7419);
    const decide = (w: WorldState, e: string, c: string) => applyDueConsequences(resolveProofChoice(w, CATALOGUE, e, c).state).state;
    const tick = (w: WorldState, n: number) => { let x = w; for (let i = 0; i < n; i += 1) x = runWorldTick(x).state; return x; };
    // 1. The quiet line gives ten energy now -- and a strain, a debt the League
    //    calls in, and a secret that can be found.
    const tapped = decide(start, "evt_f3_conduit_offer", "tap_quietly");
    expect(readProofWorld(tapped, CATALOGUE).eligibleEvents).toContain("evt_f3_debt_called");
    expect(sim(tapped).delayedConsequences.find(c => c.id === "con.evt_f3_conduit_offer.tap_quietly.strain")?.status).toBe("pending");
    // 2. The League's water fills the cisterns now -- and takes power later, and
    //    with a second debt the League presents its ledger.
    const watered = decide(tick(tapped, 3), "evt_f5_water_convoy", "league_convoy");
    expect(sim(watered).delayedConsequences.find(c => c.id === "con.evt_f5_water_convoy.league_convoy.tithe")?.status).toBe("pending");
    expect(readProofWorld(watered, CATALOGUE).eligibleEvents).toContain("evt_f5_league_calls_in");
  });

  it("imposes no fixed family sequence: sessions order the families many ways", () => {
    // Every session from the proof seed opens the same way -- the conduit offer,
    // then the recycler warning -- because they start from the same world, whose
    // infrastructure is CRITICAL: one world, one selection. From the sixth beat
    // the world the player made decides, and the orders fan out.
    const orders = new Set(walk.sessions.map(order => order.join(">")));
    expect(orders.size).toBeGreaterThanOrEqual(5);
    const sixth = new Set(walk.decisions.filter(context => context.beat === 6).map(context => context.event.id));
    expect(sixth.size).toBeGreaterThanOrEqual(2);
    const fixed = ["scarcity_triage", "maintenance", "unregistered_conduit", "public_accountability", "external_rescue"].join(">");
    expect([...orders].every(order => order !== fixed)).toBe(true);
  });
});

describe("GQP-4 and GQP-3 on F1-F5", () => {
  it("finds every delayed consequence's breadcrumb in the world before it lands", () => {
    let checked = 0;
    for (const context of walk.decisions) {
      for (const consequence of sim(context.state).delayedConsequences) {
        if (consequence.status !== "applied" || !consequence.id.startsWith("con.evt_")) continue;
        const [, eventId, choiceId, key] = consequence.id.split(".");
        const crumb = findProofEvent(CATALOGUE, eventId!).choices.find(c => c.id === choiceId)!.schedules!.find(s => s.key === key)!.breadcrumb.memoryId;
        expect(context.state.party.some(c => (c.memories ?? []).some(m => m.id === crumb && m.callbackEligible === true)), consequence.id).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("previews in KNOWN exactly what resolving each open option does, at every reachable decision point", () => {
    let compared = 0;
    for (const context of walk.decisions) {
      for (const id of context.open) {
        const choice = context.event.choices.find(c => c.id === id)!;
        const known = describeProofChoice(choice, context.state).known!;
        const after = resolveProofChoice(context.state, CATALOGUE, context.event.id, id).state;
        const last = new Map<string, number | string | boolean>();
        for (const item of known) {
          if (item.kind === "resource") last.set(`resource:${item.key}`, item.after);
          if (item.kind === "node_condition") last.set(`node:${item.nodeId}`, item.after);
          if (item.kind === "stress") last.set(`stress:${item.characterId}`, item.after);
          if (item.kind === "pressure") last.set("pressure", item.after);
          if (item.kind === "epidemic") last.set(`epidemic:${item.cause}`, item.after);
          if (item.kind === "standing") last.set(`standing:${item.groupId}`, item.after);
        }
        for (const [key, value] of last) {
          const [kind, target] = key.split(":");
          const actual =
            kind === "resource" ? readAuthoritativeResource(after, target!)
            : kind === "node" ? sim(after).productionNodes.find(n => n.id === target)!.condition
            : kind === "stress" ? after.party.find(c => c.id === target)!.stress
            : kind === "pressure" ? after.worldPressure
            : kind === "standing" ? sim(after).politicalGroups.find(g => g.id === target)!.approval
            : sim(after).epidemic.contributors.find(c => c.cause === target)?.magnitude ?? 0;
          expect([context.event.id, id, key, value]).toEqual([context.event.id, id, key, actual]);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});
