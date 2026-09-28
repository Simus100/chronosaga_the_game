import { describe, expect, it } from "vitest";
import type { ProofEvent, ProofPredicate, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  PATTERN_FAMILIES,
  agendaConditionHolds,
  createGqpScenario,
  findProofEvent,
  isProofEventEligible,
  resolveProofChoice,
  validateProofCatalogue
} from "../src";

/**
 * The F4 and F5 content of GQP-C, as data: what it may read and what it must
 * cost. The behaviour of the full F1-F5 network under the selector is proven
 * in the pacing suites; this suite pins the content contracts.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);

function predicatesOf(event: ProofEvent): ProofPredicate[] {
  return [...event.eligibility, ...(event.relevance ?? []), ...event.choices.flatMap(choice => choice.availability ?? [])];
}

describe("the F1-F5 proof catalogue", () => {
  it.each([1, 7419, 20260919])("passes the catalogue gate against the proof world (seed %i)", seed => {
    expect(validateProofCatalogue(CATALOGUE, createGqpScenario(seed))).toEqual({ ok: true, errors: [] });
  });

  it("has all five families, each with more than one event", () => {
    const families = new Map<string, number>();
    for (const event of CATALOGUE) families.set(event.familyId, (families.get(event.familyId) ?? 0) + 1);
    expect([...families.keys()].sort()).toEqual(["external_rescue", "maintenance", "public_accountability", "scarcity_triage", "unregistered_conduit"]);
    for (const count of families.values()) expect(count).toBeGreaterThanOrEqual(2);
  });

  it("is pure data", () => {
    expect(JSON.parse(JSON.stringify(CATALOGUE))).toEqual(CATALOGUE);
  });
});

describe("every detector reaches content in at least two families (spec 12.1, 12.2)", () => {
  it.each(Object.entries(PATTERN_FAMILIES))("%s is read in each family it claims", (pattern, families) => {
    expect(families.length).toBeGreaterThanOrEqual(2);
    for (const family of families) {
      const readers = CATALOGUE.filter(event => event.familyId === family).filter(event =>
        predicatesOf(event).some(predicate => predicate.predicate === "pattern_detected" && predicate.pattern === pattern)
      );
      expect(readers.map(event => event.id), `${pattern} in ${family}`).not.toEqual([]);
    }
  });
});

describe("F4 public accountability is about what actually happened", () => {
  const f4 = CATALOGUE.filter(event => event.familyId === "public_accountability");

  it("never appears in a world where nothing has happened yet", () => {
    for (const event of f4) expect(isProofEventEligible(event, start())).toBe(false);
  });

  it("gates every variant on the history: a detected pattern or a memory a character carries", () => {
    for (const event of f4) {
      const causal = event.eligibility.filter(p => p.predicate === "pattern_detected" || p.predicate === "memory_hook_present");
      expect(causal.length, event.id).toBeGreaterThan(0);
    }
  });

  it("covers credibility, neglect, concealment, ignored warnings and dependence", () => {
    const gates = f4.flatMap(event => event.eligibility).filter(p => p.predicate === "pattern_detected").map(p => `${p.pattern}:${p.subject ?? ""}`);
    expect(gates.sort()).toEqual([
      "FACTION_DEPENDENCY_GROWING:",
      "IGNORED_TECHNICAL_WARNINGS:tarek_001",
      "REPEATED_PROTECTION_OR_NEGLECT:neglect",
      "REPEATED_PROTECTION_OR_NEGLECT:protection",
      "SECRET_ACTION_DISCOVERED:fact_f3_secret_tap"
    ]);
  });

  it("touches consent, public memory and faction agenda (spec 11, F4 must-touch)", () => {
    const effects = f4.flatMap(event => event.choices.flatMap(choice => [...choice.effects, ...(choice.schedules ?? []).flatMap(s => s.effects)]));
    expect(effects.some(e => e.type === "POLITICAL_STANDING_SHIFT")).toBe(true);
    expect(effects.some(e => e.type === "MEMORY_PUBLISH" || (e.type === "MEMORY_RECORD" && e.exposure === "public"))).toBe(true);
    // Agenda: registering the line resolves the Council's grievance.
    expect(effects.some(e => e.type === "FLAG_SET" && e.key === "conduit_registered")).toBe(true);
  });
});

describe("F5 external rescue always costs something with the other side", () => {
  const f5 = () => CATALOGUE.filter(event => event.familyId === "external_rescue");
  const helpOptions = () =>
    f5().flatMap(event =>
      event.choices
        .filter(choice => choice.effects.some(effect => effect.type === "MEMORY_RECORD" && effect.behaviorHook === "call_in_debt"))
        .map(choice => ({ event, choice }))
    );

  it("records a debt to the faction that helped, on every option that takes help", () => {
    const helpers = helpOptions().map(({ event, choice }) => `${event.id}:${choice.id}`);
    expect(helpers.sort()).toEqual([
      "evt_f5_medical_relief:council_field_team",
      "evt_f5_medical_relief:league_medics",
      "evt_f5_medical_relief:league_medics_on_terms",
      "evt_f5_water_convoy:council_allocation",
      "evt_f5_water_convoy:league_convoy"
    ]);
  });

  it("flips an agenda item of the adverse faction the moment help is taken", () => {
    // A world where every help option is open: the Council trusts Helios, no
    // dependency has grown, water and medicine are short, the fever spreads.
    for (const { event, choice } of helpOptions()) {
      const world = crisisWorld();
      if (choice.id.endsWith("_on_terms")) continue; // needs a grown dependency; proven in the dependency audit
      const helper = choice.effects.find(e => e.type === "MEMORY_RECORD" && e.behaviorHook === "call_in_debt")!;
      const helperFaction = (helper as { subjectId: string }).subjectId;
      const before = agendaOf(world);
      const after = agendaOf(resolveProofChoice(world, CATALOGUE, event.id, choice.id).state);
      const flipped = Object.keys(after).filter(id => before[id] !== after[id]);
      const adverse = (world.simulation as SystemicSimulationStateV2).factionAgenda.filter(item => flipped.includes(item.id) && item.factionId !== helperFaction);
      expect(adverse.map(item => item.id), `${event.id}:${choice.id}`).not.toEqual([]);
      for (const item of adverse) expect(after[item.id]).toBe(false);
    }
  });

  it("switches the League's plain help off, and its terms on, by the dependency detector", () => {
    // Every plain League offer closes once the dependency grows...
    for (const event of f5().filter(item => !item.id.endsWith("_calls_in"))) {
      const plain = event.choices.find(choice => choice.id.startsWith("league_") && !choice.id.endsWith("_on_terms"))!;
      expect(plain.availability).toContainEqual({ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: false });
    }
    // ...and where a session can still reach the offer after that, it returns on terms.
    const terms = findProofEvent(CATALOGUE, "evt_f5_medical_relief").choices.find(choice => choice.id.endsWith("_on_terms"))!;
    expect(terms.availability).toContainEqual({ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: true });
  });

  it("has the League collect once Helios owes it twice: its ledger is gated on the dependency detector", () => {
    const ledger = findProofEvent(CATALOGUE, "evt_f5_league_calls_in");
    expect(ledger.eligibility).toEqual([{ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: true }]);
  });

  it("collects the Council's price later: its envoy answers to the debt Brann holds", () => {
    const envoy = findProofEvent(CATALOGUE, "evt_f5_council_calls_in");
    expect(envoy.eligibility).toEqual([
      { predicate: "memory_hook_present", characterId: "brann_001", hook: "call_in_debt", subjectId: "faction_compact", value: true }
    ]);
  });
});

function agendaOf(world: WorldState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of (world.simulation as SystemicSimulationStateV2).factionAgenda) out[item.id] = agendaConditionHolds(item.condition, world);
  return out;
}

function crisisWorld(): WorldState {
  const world = start();
  const simulation = world.simulation as unknown as { productionNodes: { condition: number }[]; settlements: { resourceStock: Record<string, number> }[]; epidemic: { value: number; contributors: { cause: string; magnitude: number }[] } };
  simulation.productionNodes[0]!.condition = 0.9;
  simulation.settlements[0]!.resourceStock.water = 2;
  simulation.settlements[0]!.resourceStock.medicine = 3;
  simulation.epidemic.contributors.find(c => c.cause === "crowding")!.magnitude = 0.2;
  simulation.epidemic.value = 0.32;
  world.resources.water = 2;
  world.resources.medicine = 3;
  return world;
}
