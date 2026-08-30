import { describe, expect, it } from "vitest";
import type { GameEvent, WorldState } from "@paa/game-types";
import type { WorldTickResult } from "../src/state/run-world-tick.js";
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
   * This case used to be refused, and the refusal was wrong.
   *
   * `1e305` is a perfectly representable double, and the stock plus that output
   * is too. The tick threw only because `rounded` scaled by `10 ** 4` before
   * dividing and overflowed on a value it was supposed to leave alone. Rounding
   * a number of that magnitude to four decimals is the identity — adjacent
   * doubles up there are about `2.2e289` apart — so the correct behaviour is to
   * compute the result, not to reject the world.
   *
   * Kept as a regression in the direction it now runs: a guard that fires on an
   * artifact of its own helper is a false refusal, and false refusals are how a
   * fail-closed rule loses the room's trust.
   */
  it("computes a large representable production output instead of refusing it", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = {};
    node.outputs = { water: 1e305 };
    node.capacity = 1e308;
    node.efficiency = 1;
    node.condition = 1;

    expect(validateSystemicWorldState(state).ok).toBe(true);

    const result = runWorldTick(state);
    const stock = result.state.simulation!.settlements[0]!.resourceStock.water;

    expect(Number.isFinite(stock)).toBe(true);
    expect(stock).toBeGreaterThan(1e304);
    expect(result.trace.production[0]!.outputsProduced.water).toBe(1e305);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
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

/**
 * Every number a caller can reach in a `WorldTickResult`, with its path.
 *
 * `WorldTickTrace` and `StateDelta` are part of the public result exactly as
 * `WorldState` is, and an earlier version of this suite only ever inspected the
 * authoritative state. That is how a trace carrying `Infinity` passed a full
 * green run: nothing was looking at it.
 */
function everyNumber(value: unknown, path = ""): [string, number][] {
  if (typeof value === "number") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => everyNumber(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      everyNumber(item, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

function nonFiniteIn(result: WorldTickResult): string[] {
  return [
    ...everyNumber(result.state, "state"),
    ...everyNumber(result.delta, "delta"),
    ...everyNumber(result.trace, "trace")
  ]
    .filter(([, value]) => !Number.isFinite(value))
    .map(([path, value]) => `${path}=${String(value)}`);
}

/**
 * A successful tick returns no non-finite number anywhere — state, delta or
 * trace.
 *
 * This block exists because the narrower claim was false. The PR that added the
 * authoritative write guards asserted that a non-finite trace value could not
 * escape, on the reasoning that the matching authoritative write would fail
 * first. External review disproved it: `setNumber` finishes with
 * `Math.max(0, value)`, so `before - Infinity` becomes a legal `0`, the write
 * succeeds, and the trace keeps the infinity. The tick completed, the state
 * validated, and `trace.consumption` held `Infinity`.
 *
 * The root cause was not the guards but `rounded`, which overflowed while
 * scaling a value that was itself representable.
 */
describe("#34 a successful World Tick returns no non-finite number at all", () => {
  /**
   * The reproduction from the external review, kept in its original shape.
   *
   * The production node is disabled so nothing but population consumption can
   * touch the stock. `demand` overflowed while being rounded; `consumed` was
   * `rounded(Math.min(1e305, Infinity))`, and `Math.min` had already brought it
   * back to a finite `1e305` before `rounded` destroyed it again. The
   * authoritative write then saw `1e305 - Infinity`, clamped it to `0`, and
   * passed.
   */
  it("keeps the consumption trace finite when demand exceeds the rounding range", () => {
    const state = createSystemicScenario(4201);
    for (const node of state.simulation!.productionNodes) node.enabled = false;
    state.simulation!.settlements[0]!.population = 1e308;
    state.simulation!.settlements[0]!.resourceStock.water = 1e305;
    state.resources.water = 1e305;

    expect(validateSystemicWorldState(state).ok).toBe(true);
    const untouched = structuredClone(state);

    const result = runWorldTick(state);

    expect(nonFiniteIn(result)).toEqual([]);
    // The settlement really did drink its whole reserve, and the trace says so
    // with the true number rather than an infinity.
    expect(result.trace.consumption["settlement_helios:water"]).toBe(1e305);
    expect(result.state.simulation!.settlements[0]!.resourceStock.water).toBe(0);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
    expect(state).toEqual(untouched);
  });

  /**
   * The same shape on the production side: `inputsConsumed` recorded the
   * overflowed `amount` while `setNumber` clamped `before - amount` to zero.
   */
  it("keeps the production input trace finite when the requirement exceeds the rounding range", () => {
    const state = createSystemicScenario(4201);
    for (const node of state.simulation!.productionNodes) node.enabled = false;
    const node = state.simulation!.productionNodes[0]!;
    node.enabled = true;
    node.inputs = { food: 1e305 };
    node.outputs = { water: 1e-6 };
    node.capacity = 1e308;
    node.efficiency = 1;
    node.condition = 1;
    state.simulation!.settlements[0]!.resourceStock.food = 1e308;

    expect(validateSystemicWorldState(state).ok).toBe(true);

    const result = runWorldTick(state);

    expect(nonFiniteIn(result)).toEqual([]);
    expect(result.trace.production[0]!.inputsConsumed.food).toBe(1e305);
    expect(validateSystemicWorldState(result.state).ok).toBe(true);
  });

  /**
   * `rounded` must correct the arithmetic without changing what it does to
   * anything an ordinary world contains — including the fraction cases the
   * `Number.EPSILON` term exists for.
   */
  it("rounds ordinary values exactly as before and leaves huge ones alone", () => {
    const state = createSystemicScenario(4201);
    const result = runWorldTick(state);

    // Four-decimal rounding, still doing its job.
    expect(result.state.simulation!.settlements[0]!.resourceStock.water).toBe(10.6112);
    expect(result.state.simulation!.populationCohorts[0]!.satisfaction).toBe(0.4717);
    expect(result.state.simulation!.politicalGroups[0]!.approval).toBe(0.4654);
  });

  /** Named fields, checked one by one, so a future struct change cannot quietly skip one. */
  it("returns finite numbers in every documented part of the trace", () => {
    const result = runWorldTick(createSystemicScenario(4201));
    const trace = result.trace;

    expect(Number.isFinite(trace.tick)).toBe(true);
    expect(Number.isFinite(trace.playerTurn)).toBe(true);
    expect(Number.isFinite(result.delta.turn)).toBe(true);

    expect(trace.production.length).toBeGreaterThan(0);
    for (const production of trace.production) {
      expect(Number.isFinite(production.operatingFactor)).toBe(true);
      for (const value of Object.values(production.inputsConsumed)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const value of Object.values(production.outputsProduced)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }

    expect(Object.keys(trace.consumption).length).toBeGreaterThan(0);
    for (const value of Object.values(trace.consumption)) {
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(Object.keys(trace.shortageSeverity).length).toBeGreaterThan(0);
    for (const value of Object.values(trace.shortageSeverity)) {
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(trace.cohortReactions.length).toBeGreaterThan(0);
    for (const reaction of trace.cohortReactions) {
      expect(Number.isFinite(reaction.shortageExposure)).toBe(true);
      expect(Number.isFinite(reaction.satisfactionDelta)).toBe(true);
      expect(Number.isFinite(reaction.loyaltyDelta)).toBe(true);
    }

    expect(trace.politicalReactions.length).toBeGreaterThan(0);
    for (const reaction of trace.politicalReactions) {
      expect(Number.isFinite(reaction.approvalDelta)).toBe(true);
    }

    // And the same statement made over the whole object, so a field added later
    // is covered whether or not anyone remembers to list it above.
    expect(nonFiniteIn(result)).toEqual([]);
  });

  /**
   * The property held across every world this suite can reach, ordinary and
   * extreme, over consecutive ticks rather than one.
   */
  it("holds over repeated ticks of several seeds and of stressed worlds", () => {
    const worlds: WorldState[] = [
      createSystemicScenario(4201),
      createSystemicScenario(7419),
      createSystemicScenario(1234)
    ];

    const drained = createSystemicScenario(4201);
    for (const resource of ["water", "food", "energy", "medicine"]) {
      drained.simulation!.settlements[0]!.resourceStock[resource] = 0;
    }
    worlds.push(drained);

    const huge = createSystemicScenario(4201);
    huge.simulation!.settlements[0]!.population = 1e308;
    huge.simulation!.settlements[0]!.resourceStock.water = 1e305;
    huge.resources.water = 1e305;
    for (const node of huge.simulation!.productionNodes) node.enabled = false;
    worlds.push(huge);

    for (const world of worlds) {
      let state = world;
      for (let tick = 0; tick < 4; tick += 1) {
        const result = runWorldTick(state);
        expect(nonFiniteIn(result)).toEqual([]);
        state = result.state;
      }
    }
  });

  /**
   * The net itself, exercised on a genuinely unrepresentable world so it is
   * clear it refuses rather than repairs. `Number.MAX_VALUE` plus `1e304` has
   * no double to land on, and no rounding correction can invent one.
   */
  it("still fails closed when the arithmetic is genuinely unrepresentable", () => {
    const state = createSystemicScenario(4201);
    const node = state.simulation!.productionNodes[0]!;
    node.inputs = {};
    node.outputs = { water: 1e304 };
    node.capacity = 1e308;
    node.efficiency = 1;
    node.condition = 1;
    state.simulation!.settlements[0]!.resourceStock.water = Number.MAX_VALUE;

    expect(validateSystemicWorldState(state).ok).toBe(true);
    expect(Number.MAX_VALUE + 1e304).toBe(Infinity);

    const untouched = structuredClone(state);
    expect(() => runWorldTick(state)).toThrow(/non-finite/);
    expect(state).toEqual(untouched);
  });
});
