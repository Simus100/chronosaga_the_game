import { describe, expect, it } from "vitest";
import type { GameEvent, WorldState } from "@paa/game-types";
import {
  createSystemicScenario,
  isEventEligible,
  runWorldTick,
  validateSystemicWorldState
} from "../src";

function shortageEvent(): GameEvent {
  return {
    id: "evt_water_pressure_response",
    version: 1,
    title: "Water Pressure Response",
    body: "The settlement must respond to the active reserve shortage.",
    category: "settlement",
    tags: ["water", "politics"],
    weight: 1,
    requirements: {
      flagsAll: [
        "settlement_helios_water_shortage_active",
        "faction_compact_resource_pressure"
      ]
    },
    choices: [
      {
        id: "acknowledge",
        label: "Acknowledge the shortage",
        effects: [{ type: "FLAG_SET", key: "shortage_response_open", value: true }]
      }
    ]
  };
}

describe("M1-B deterministic world tick", () => {
  it("runs production -> consumption -> social/political reaction -> new event eligibility", () => {
    const initial = createSystemicScenario(4201);
    const untouched = structuredClone(initial);
    const event = shortageEvent();

    expect(isEventEligible(event, initial)).toBe(false);

    const result = runWorldTick(initial);
    const settlement = result.state.simulation!.settlements[0]!;
    const industrial = result.state.simulation!.populationCohorts.find(
      cohort => cohort.id === "cohort_industrial"
    )!;
    const labor = result.state.simulation!.politicalGroups.find(
      group => group.id === "group_labor"
    )!;
    const compact = result.state.simulation!.factions.find(
      faction => faction.id === "faction_compact"
    )!;
    const mara = result.state.party.find(character => character.id === "mara_001")!;

    // Pure reducer: callers can persist/commit the returned state and still have
    // the exact previous state for audit/replay.
    expect(initial).toEqual(untouched);

    // A World Tick advances the world, not the player. `turn` is the Player Turn
    // and only a decision moves it; the simulation counts its own ticks.
    expect(result.state.turn).toBe(1);
    expect(result.state.simulation!.tick).toBe(1);
    expect(result.state.day).toBe(2);
    expect(result.delta.turn).toBe(1);
    expect(result.delta.source).toBe("world_tick:1");

    expect(result.trace.production).toHaveLength(1);
    expect(result.trace.production[0]!.nodeId).toBe("prod_recycler_01");
    expect(result.trace.production[0]!.operatingFactor).toBeGreaterThan(0);
    expect(result.trace.production[0]!.outputsProduced.water).toBeGreaterThan(0);
    expect(result.trace.consumption["settlement_helios:water"]).toBeGreaterThan(0);

    // The recycler helps, but current demand still leaves Helios below the
    // explicit reserve target. The resource fact then propagates upward.
    expect(settlement.resourceStock.water).toBeLessThan(14);
    expect(settlement.resourceStock.energy).toBeLessThan(42);
    expect(result.trace.shortageSeverity["settlement_helios:water"]).toBeGreaterThan(0.2);
    expect(result.state.flags.settlement_helios_water_shortage_active).toBe(true);
    expect(result.state.flags.faction_compact_resource_pressure).toBe(true);

    expect(industrial.satisfaction).toBeLessThan(0.49);
    expect(industrial.loyalty).toBeLessThan(0.58);
    expect(labor.approval).toBeLessThan(0.48);
    expect(settlement.satisfaction).toBeLessThan(0.54);
    expect(settlement.stability).toBeLessThan(0.61);

    expect(compact.memoryTags).toContain("resource_pressure:settlement_helios");
    expect(mara.memoryTags).toContain("water_shortage_experienced");
    expect(mara.memories?.some(memory => memory.source.kind === "world_tick")).toBe(true);

    // Transitional top-level resource compatibility cannot drift from the local
    // authoritative stock during M1.
    expect(result.state.resources.water).toBe(settlement.resourceStock.water);
    expect(result.state.resources.energy).toBe(settlement.resourceStock.energy);

    expect(isEventEligible(event, result.state)).toBe(true);
    expect(result.delta.changes.some(change => change.type === "productionOutput")).toBe(true);
    expect(result.delta.changes.some(change => change.type === "populationConsumption")).toBe(true);
    expect(result.delta.changes.some(change => change.type === "cohortSatisfaction")).toBe(true);
    expect(result.delta.changes.some(change => change.type === "politicalApproval")).toBe(true);
    expect(result.delta.changes.some(change => change.type === "factionReactionFlag")).toBe(true);
    expect(result.delta.changes.some(change => change.type === "characterMemory")).toBe(true);
  });

  it("replays exactly from the same authoritative input", () => {
    const input = createSystemicScenario(7712);
    expect(runWorldTick(input)).toEqual(runWorldTick(input));
  });

  it("never spends unavailable production input or creates a negative stock", () => {
    const input = createSystemicScenario(333);
    const settlement = input.simulation!.settlements[0]!;
    settlement.resourceStock.energy = 0;
    input.resources.energy = 0;

    const result = runWorldTick(input);
    const nextSettlement = result.state.simulation!.settlements[0]!;
    const production = result.trace.production[0]!;

    expect(production.operatingFactor).toBe(0);
    expect(production.inputsConsumed).toEqual({});
    expect(production.outputsProduced).toEqual({});
    expect(nextSettlement.resourceStock.energy).toBe(0);
    expect(nextSettlement.resourceStock.water).toBeGreaterThanOrEqual(0);
    expect(Object.values(nextSettlement.resourceStock).every(value => value >= 0)).toBe(true);
  });

  it("does not manufacture a faction crisis when reserves are healthy", () => {
    const input = createSystemicScenario(555);
    const settlement = input.simulation!.settlements[0]!;
    for (const resource of ["water", "food", "energy", "medicine"]) {
      settlement.resourceStock[resource] = 100;
      input.resources[resource] = 100;
    }

    const result = runWorldTick(input);
    const compact = result.state.simulation!.factions.find(
      faction => faction.id === "faction_compact"
    )!;

    expect(result.trace.factionReaction).toBe(false);
    expect(result.state.flags.settlement_helios_water_shortage_active).toBe(false);
    expect(result.state.flags.faction_compact_resource_pressure).not.toBe(true);
    expect(compact.memoryTags).not.toContain("resource_pressure:settlement_helios");
  });

  it("clears active shortage/pressure flags after reserves recover but keeps historical memory", () => {
    const event = shortageEvent();
    const shortage = runWorldTick(createSystemicScenario(818));
    expect(isEventEligible(event, shortage.state)).toBe(true);

    const recoveredInput = structuredClone(shortage.state);
    const settlement = recoveredInput.simulation!.settlements[0]!;
    for (const resource of ["water", "food", "energy", "medicine"]) {
      settlement.resourceStock[resource] = 100;
      recoveredInput.resources[resource] = 100;
    }

    const recovered = runWorldTick(recoveredInput);
    const compact = recovered.state.simulation!.factions.find(
      faction => faction.id === "faction_compact"
    )!;
    const mara = recovered.state.party.find(character => character.id === "mara_001")!;

    expect(recovered.trace.factionReaction).toBe(false);
    expect(recovered.state.flags.settlement_helios_water_shortage_active).toBe(false);
    expect(recovered.state.flags.faction_compact_resource_pressure).toBe(false);
    expect(isEventEligible(event, recovered.state)).toBe(false);

    // Historical memory survives even though the live condition cleared.
    expect(compact.memoryTags).toContain("resource_pressure:settlement_helios");
    expect(mara.memoryTags).toContain("water_shortage_experienced");
    expect(mara.memories?.some(memory => memory.source.kind === "world_tick")).toBe(true);
  });

  it("derives shortage memory text from settlement state instead of the fixture name", () => {
    const input = createSystemicScenario(909);
    input.simulation!.settlements[0]!.name = "New Dawn";

    const result = runWorldTick(input);
    const mara = result.state.party.find(character => character.id === "mara_001")!;
    const tickMemory = mara.memories?.find(memory => memory.source.kind === "world_tick");

    expect(tickMemory?.summary).toContain("New Dawn");
    expect(tickMemory?.summary).not.toContain("Helios Reach");
  });

  it("requires systemic state rather than silently running a partial simulation", () => {
    const legacy = createSystemicScenario(2) as WorldState;
    delete legacy.simulation;
    expect(() => runWorldTick(legacy)).toThrow(/WorldState\.simulation/);
  });
});

/**
 * Every number the World Tick writes authoritatively must be finite.
 *
 * The inputs below are hostile but not malformed: each one is accepted by
 * `validateSystemicWorldState`, because the point is precisely that per-field
 * validation cannot see what an aggregation does. Each test therefore asserts
 * the input was valid before asserting the tick refuses it — a test built on an
 * already-invalid world would prove nothing about the Core.
 */
describe("#34 the World Tick refuses to write a non-finite authoritative number", () => {
  /** The tick must reject the world, and leave the caller's own object alone. */
  function failsClosed(state: WorldState, message: RegExp) {
    expect(validateSystemicWorldState(state).ok).toBe(true);
    const untouched = structuredClone(state);

    expect(() => runWorldTick(state)).toThrow(message);
    expect(state).toEqual(untouched);
  }

  /**
   * `rounded` scales by `10 ** 4` before dividing, so a finite value above
   * `Number.MAX_VALUE / 1e4` overflows inside the helper — no addition
   * required. The stock here is ordinary; the output alone is extreme.
   */
  it("refuses a production output that overflows while being rounded", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = {};
    node.outputs = { water: 1e305 };
    node.capacity = 1e308;
    node.efficiency = 1;
    node.condition = 1;

    failsClosed(state, /non-finite value for settlement_helios\.resourceStock\.water: Infinity/);
  });

  /**
   * The other half of the same class: both operands are comfortably
   * representable, and their sum is not.
   */
  it("refuses a production output whose sum with the existing stock overflows", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = {};
    node.outputs = { water: 1e304 };
    node.capacity = 1e308;
    node.efficiency = 1;
    node.condition = 1;
    state.simulation!.settlements[0]!.resourceStock.water = Number.MAX_VALUE;

    // Proof that the two operands really are finite on their own.
    expect(Number.isFinite(1e304)).toBe(true);
    expect(Number.isFinite(Number.MAX_VALUE)).toBe(true);

    failsClosed(state, /non-finite value for settlement_helios\.resourceStock\.water: Infinity/);
  });


  /**
   * Not every non-finite result is an overflow. A production input requirement
   * small enough that `nominalAmount * technicalFactor` underflows to zero, on a
   * stock that is also zero, makes `available / requiredAtTechnicalRate` the
   * indeterminate `0 / 0`. The resulting `NaN` survives `clamp`, survives
   * `rounded`, and survives `if (amount <= 0) continue` — because `NaN <= 0` is
   * false, so the guard clause that exists to skip empty work waves it through.
   *
   * This one reaches the production *input* write rather than the output write,
   * and it was found by auditing the file rather than by predicting it.
   */
  it("refuses a production input whose operating factor becomes NaN by underflow", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = { food: Number.MIN_VALUE };
    node.outputs = { water: 2 };
    node.efficiency = 0.5;
    node.condition = 0.5;
    node.capacity = 100;
    state.simulation!.settlements[0]!.resourceStock.food = 0;

    expect(Number.NaN <= 0).toBe(false);

    failsClosed(state, /non-finite value for settlement_helios\.resourceStock\.food: NaN/);
  });

  /** The same shape with stock available is ordinary work, and must still run. */
  it("still ticks the same production node when the stock is not empty", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = { food: Number.MIN_VALUE };
    node.outputs = { water: 2 };
    node.efficiency = 0.5;
    node.condition = 0.5;
    node.capacity = 100;
    state.simulation!.settlements[0]!.resourceStock.food = 3;

    expect(validateSystemicWorldState(runWorldTick(state).state).ok).toBe(true);
  });

  /**
   * Settlement satisfaction is a population-weighted mean, and the only
   * authoritative social field the tick writes without a clamp. Enough large
   * populations overflow numerator and denominator together, and
   * `Infinity / Infinity` is `NaN`.
   */
  it("refuses a settlement satisfaction whose weighted mean overflows to NaN", () => {
    const state = createSystemicScenario(4201);
    const simulation = state.simulation!;
    const proto = simulation.populationCohorts[0]!;
    const crowd = Array.from({ length: 400 }, (_unused, index) => ({
      ...structuredClone(proto),
      id: `cohort_crowd_${index}`
    }));
    simulation.populationCohorts = [...simulation.populationCohorts, ...crowd];
    for (const cohort of simulation.populationCohorts) cohort.population = 1e308;
    simulation.settlements[0]!.cohortIds = simulation.populationCohorts.map(cohort => cohort.id);

    // Each population is individually a finite non-negative integer.
    for (const cohort of simulation.populationCohorts) {
      expect(Number.isInteger(cohort.population)).toBe(true);
      expect(Number.isFinite(cohort.population)).toBe(true);
    }

    failsClosed(state, /non-finite value for settlement_helios\.satisfaction: NaN/);
  });

  /**
   * Political approval overflows on a different weighting — the cohorts
   * affiliated to one group — so it is reachable while the settlement mean it
   * sits next to stays finite. Starting every cohort at exactly the satisfaction
   * that one tick of full exposure removes drives the settlement numerator to
   * zero and leaves the approval numerator infinite.
   */
  it("refuses a political approval that overflows while settlement satisfaction stays finite", () => {
    const state = createSystemicScenario(4201);
    const simulation = state.simulation!;
    const proto = simulation.populationCohorts[0]!;
    const crowd = Array.from({ length: 400 }, (_unused, index) => ({
      ...structuredClone(proto),
      id: `cohort_crowd_${index}`
    }));
    simulation.populationCohorts = [...simulation.populationCohorts, ...crowd];
    for (const cohort of simulation.populationCohorts) {
      cohort.population = 1e308;
      cohort.satisfaction = 0.08;
      cohort.loyalty = 0.08;
    }
    simulation.settlements[0]!.cohortIds = simulation.populationCohorts.map(cohort => cohort.id);
    for (const resource of ["water", "food", "energy", "medicine"]) {
      simulation.settlements[0]!.resourceStock[resource] = 0;
    }

    failsClosed(state, /non-finite value for group_labor\.approval: NaN/);
  });

  /**
   * Cohort satisfaction overflows through its need weights rather than through
   * population: `needs` is validated finite per entry and has no upper bound, so
   * two large weights make `weightedShortage / relevantNeed` an
   * `Infinity / Infinity`. Worth stating plainly: `clamp` does not stop this.
   * `Math.min(1, Math.max(0, NaN))` is `NaN`, so being bounded to 0..1 is not
   * the same as being finite.
   */
  it("refuses a cohort satisfaction whose need-weighted exposure overflows to NaN", () => {
    const state = createSystemicScenario(4201);
    const simulation = state.simulation!;
    for (const cohort of simulation.populationCohorts) {
      cohort.needs = { water: 1e308, food: 1e308 };
    }
    simulation.settlements[0]!.resourceStock.water = 0;
    simulation.settlements[0]!.resourceStock.food = 0;

    expect(Math.min(1, Math.max(0, Number.NaN))).toBeNaN();

    failsClosed(state, /non-finite value for cohort_industrial\.satisfaction: NaN/);
  });

  /**
   * The guards must refuse overflow without refusing large-but-representable
   * worlds. A settlement whose cohorts alone overflow the population sum still
   * ticks, because its weighted numerator does not.
   */
  it("still ticks a world whose population sum overflows but whose mean does not", () => {
    const state = createSystemicScenario(4201);
    for (const cohort of state.simulation!.populationCohorts) cohort.population = 1e308;
    state.simulation!.settlements[0]!.population = 1e308;

    const result = runWorldTick(state);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
  });

  /**
   * `tick + 1` and `day + 1` cannot leave the finite range: adding one to a
   * finite double either advances it or, past the integer precision limit,
   * returns the same value. They are audited and deliberately unguarded — the
   * liveness question they do raise is not a finiteness defect and is recorded
   * as a follow-up rather than answered here.
   */
  it("advances tick and day without producing a non-finite clock", () => {
    const state = createSystemicScenario(4201);
    state.simulation!.tick = Number.MAX_VALUE;
    state.day = Number.MAX_VALUE;

    const result = runWorldTick(state);
    expect(Number.isFinite(result.state.simulation!.tick)).toBe(true);
    expect(Number.isFinite(result.state.day)).toBe(true);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
  });

  /** The property, asserted over the ordinary scenario rather than argued. */
  it("leaves every authoritative number of a normal tick finite", () => {
    const result = runWorldTick(createSystemicScenario(4201));
    const simulation = result.state.simulation!;

    const authoritative = [
      simulation.tick,
      result.state.day,
      ...Object.values(result.state.resources),
      ...simulation.settlements.flatMap(settlement => [
        settlement.population,
        settlement.stability,
        settlement.satisfaction,
        ...Object.values(settlement.resourceStock)
      ]),
      ...simulation.populationCohorts.flatMap(cohort => [
        cohort.population,
        cohort.satisfaction,
        cohort.loyalty
      ]),
      ...simulation.politicalGroups.map(group => group.approval)
    ];

    for (const value of authoritative) expect(Number.isFinite(value)).toBe(true);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
  });
});
