import { describe, expect, it } from "vitest";
import type { GameEvent, WorldState } from "@paa/game-types";
import { createSystemicScenario, isEventEligible, runWorldTick } from "../src";

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

    expect(result.state.turn).toBe(2);
    expect(result.state.day).toBe(2);
    expect(result.delta.turn).toBe(2);
    expect(result.delta.source).toBe("world_tick:2");

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
    expect(mara.memoryTags).toContain("water_shortage_active");
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

  it("requires systemic state rather than silently running a partial simulation", () => {
    const legacy = createSystemicScenario(2) as WorldState;
    delete legacy.simulation;
    expect(() => runWorldTick(legacy)).toThrow(/WorldState\.simulation/);
  });
});
