import { describe, expect, it } from "vitest";
import type { EventChoice, WorldState } from "@paa/game-types";
import { createSystemicScenario } from "../src/state/create-systemic-scenario.js";
import { loadSystemicWorldState } from "../src/state/load-systemic-state.js";
import { runWorldTick } from "../src/state/run-world-tick.js";
import { resolveChoice } from "../src/events/resolve-choice.js";
import { scheduleDelayedConsequence } from "../src/state/delayed-consequences.js";
import { validateSystemicWorldState } from "../src/state/validate-systemic-state.js";

/**
 * M1-C/2: the world must survive being written to disk and read back by
 * something that does not trust it.
 *
 * A save is a file on someone's machine. Everything here treats it that way:
 * the only route from stored text to a usable `WorldState` is
 * `loadSystemicWorldState`, and every test that expects a rejection proves the
 * rejection is *specific* rather than a generic failure.
 */

/** A scenario with something in every structure worth losing. */
function populated(): WorldState {
  const base = createSystemicScenario(7419);
  const withMemory = resolveChoice(
    base,
    { id: "seed", label: "x", effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }] },
    "player_choice"
  ).state;

  return scheduleDelayedConsequence(withMemory, {
    id: "dc_persist",
    status: "pending",
    triggerTurn: withMemory.turn + 2,
    visibility: "hidden",
    scope: "settlement",
    reversible: false,
    effects: [{ type: "RESOURCE_DELTA", key: "water", value: -2 }],
    source: { kind: "event", id: "evt_persist", tick: withMemory.turn }
  }).state;
}

const store = (state: WorldState): string => JSON.stringify(state);

/** Load, or fail the test with the reason it refused. */
function loaded(raw: string): WorldState {
  const result = loadSystemicWorldState(raw);
  if (!result.ok) throw new Error(`refused as ${result.reason}: ${result.errors.join("; ")}`);
  return result.state;
}

/** The refusal, or fail the test because it was accepted. */
function refused(raw: string): { reason: string; errors: string[] } {
  const result = loadSystemicWorldState(raw);
  if (result.ok) throw new Error("expected a refusal, the save was accepted");
  return { reason: result.reason, errors: result.errors };
}

describe("1, 2: the save round-trips through the untrusted boundary", () => {
  it("deep round-trip preserves the whole world", () => {
    const original = populated();
    expect(loaded(store(original))).toEqual(original);
  });

  it("the annotation is earned, not assumed", () => {
    // `JSON.parse(raw) as WorldState` is exactly what this replaces: the value
    // is `unknown` until every check has passed.
    const result = loadSystemicWorldState(store(populated()));
    expect(result.ok).toBe(true);
    const empty = loadSystemicWorldState("{}");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("invalid_world_state");
  });
});

describe("3, 4, 5: unreadable or incomplete saves are refused by name", () => {
  it("malformed JSON is not an invalid world, it is not JSON", () => {
    for (const raw of ["", "{", "not json", "[1,2,3", '{"a":']) {
      const result = loadSystemicWorldState(raw);
      expect(result.ok, `accepted ${JSON.stringify(raw)}`).toBe(false);
      if (!result.ok && raw !== "[1,2,3") expect(result.reason).toBe("malformed_json");
    }
  });

  it("a missing or invalid simulation.tick is refused", () => {
    for (const bad of [undefined, null, "1", 1.5, -1]) {
      const broken = JSON.parse(store(populated())) as Record<string, unknown>;
      const simulation = broken.simulation as Record<string, unknown>;
      if (bad === undefined) delete simulation.tick;
      else simulation.tick = bad;

      const result = refused(JSON.stringify(broken));
      expect(result.reason).toBe("invalid_world_state");
      expect(result.errors.some(error => error.includes("simulation.tick"))).toBe(true);
    }
  });
});

describe("6, 7, 8: numeric maps are arithmetic input, and are checked as such", () => {
  /** Break one nested value and see whether the boundary notices. */
  const corrupt = (mutate: (world: Record<string, any>) => void): { reason: string; errors: string[] } => {
    const broken = JSON.parse(store(populated())) as Record<string, any>;
    mutate(broken);
    return refused(JSON.stringify(broken));
  };

  it("WorldState.resources must hold finite numbers", () => {
    for (const bad of ["14", null, [], {}, true]) {
      const result = corrupt(world => { world.resources.water = bad; });
      expect(result.errors.some(error => error.includes("WorldState.resources.water"))).toBe(true);
    }
    expect(corrupt(world => { world.resources = null; }).reason).toBe("invalid_world_state");
    expect(corrupt(world => { world.resources = []; }).reason).toBe("invalid_world_state");
  });

  it("settlement.resourceStock must hold finite numbers", () => {
    const result = corrupt(world => { world.simulation.settlements[0].resourceStock.water = "10"; });
    expect(result.errors.some(error => error.includes("resourceStock.water"))).toBe(true);
    expect(corrupt(world => { world.simulation.settlements[0].resourceStock = null; }).reason).toBe(
      "invalid_world_state"
    );
  });

  it("every other systemic numeric map is checked too", () => {
    const cases: Array<[string, (world: Record<string, any>) => void]> = [
      ["faction", world => { world.simulation.factions[0].resources = { credits: "5" }; }],
      ["relations", world => { world.simulation.factions[0].relations = { x: null }; }],
      ["inputs", world => { world.simulation.productionNodes[0].inputs = { water: "3" }; }],
      ["outputs", world => { world.simulation.productionNodes[0].outputs = { water: [] }; }],
      ["needs", world => { world.simulation.populationCohorts[0].needs = { food: "2" }; }],
      ["relationships", world => { world.simulation.politicalGroups[0].relationships = { y: {} }; }]
    ];
    for (const [label, mutate] of cases) {
      const result = corrupt(mutate);
      expect(result.reason, `${label} was accepted`).toBe("invalid_world_state");
    }
  });

  it("NaN and Infinity are refused, even though JSON.stringify cannot write them", () => {
    // A save does not have to come from `JSON.stringify`. Assuming it does is
    // trusting the shape of the attack you expect.
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const world = JSON.parse(store(populated())) as Record<string, any>;
      world.simulation.settlements[0].resourceStock.water = poison;
      const result = loadSystemicWorldState(JSON.stringify(world));
      // stringify turns these into null; either way the boundary must refuse.
      expect(result.ok).toBe(false);

      // And directly, without the serializer softening it first:
      const direct = validateSystemicWorldState(world);
      expect(direct.ok, `${String(poison)} accepted`).toBe(false);
      expect(direct.errors.some((error: string) => error.includes("finite"))).toBe(true);
    }
  });
});

describe("9, 10: the projection may not disagree with its authority", () => {
  it("a divergent settlement resource is rejected, not repaired", () => {
    const world = JSON.parse(store(populated())) as Record<string, any>;
    world.resources.water = 999;

    const result = refused(JSON.stringify(world));
    expect(result.reason).toBe("inconsistent_projection");
    expect(result.errors[0]).toContain("999");
    expect(result.errors[0]).toContain("resourceStock.water");
  });

  it("a missing projected value is refused as well", () => {
    const world = JSON.parse(store(populated())) as Record<string, any>;
    delete world.resources.water;
    expect(refused(JSON.stringify(world)).reason).toBe("inconsistent_projection");
  });

  it("campaign resources are not compared against a stock they never had", () => {
    // Credits live only in the flat map. Comparing them to a settlement that
    // does not stock them would reject every valid save.
    const original = populated();
    expect("credits" in original.simulation!.settlements[0]!.resourceStock).toBe(false);
    expect(original.resources.credits).toBeGreaterThan(0);

    const restored = loaded(store(original));
    expect(restored.resources.credits).toBe(original.resources.credits);
  });
});

describe("11 to 20: nothing is quietly dropped", () => {
  const original = populated();
  const restored = loaded(store(original));

  it("11, 12, 13: characters, structured memories and causal sources", () => {
    expect(restored.party).toHaveLength(original.party.length);
    expect(restored.party.length).toBeGreaterThanOrEqual(5);

    for (const [index, character] of original.party.entries()) {
      const copy = restored.party[index]!;
      expect(copy.id).toBe(character.id);
      expect(copy.health).toBe(character.health);
      expect(copy.stress).toBe(character.stress);
      expect(copy.morale).toBe(character.morale);
      expect(copy.traits).toEqual(character.traits);
      expect(copy.memoryTags).toEqual(character.memoryTags);
      expect(copy.factionId).toBe(character.factionId);
      expect(copy.locationId).toBe(character.locationId);
      // Memories are structures, not tags: a save that kept only `memoryTags`
      // would still look plausible and would have lost every causal source.
      expect(copy.memories).toEqual(character.memories);
    }

    const withMemory = restored.party.filter(character => (character.memories?.length ?? 0) > 0);
    for (const character of withMemory) {
      for (const memory of character.memories!) {
        expect(typeof memory.source.id).toBe("string");
        expect(memory.source.kind).toBeTruthy();
      }
    }
  });

  it("14 to 18: factions, nodes, cohorts, groups, squads", () => {
    const before = original.simulation!;
    const after = restored.simulation!;
    expect(after.factions).toEqual(before.factions);
    expect(after.productionNodes).toEqual(before.productionNodes);
    expect(after.populationCohorts).toEqual(before.populationCohorts);
    expect(after.politicalGroups).toEqual(before.politicalGroups);
    expect(after.warfareSquads).toEqual(before.warfareSquads);
    expect(after.settlements).toEqual(before.settlements);
    expect(after.schemaVersion).toBe(before.schemaVersion);
    expect(after.tick).toBe(before.tick);
  });

  it("19: delayed consequences survive field for field", () => {
    const before = original.simulation!.delayedConsequences;
    const after = restored.simulation!.delayedConsequences;
    expect(after).toEqual(before);

    const persisted = after.find(entry => entry.id === "dc_persist")!;
    expect(persisted.status).toBe("pending");
    expect(persisted.triggerTurn).toBe(before.find(e => e.id === "dc_persist")!.triggerTurn);
    expect(persisted.scope).toBe("settlement");
    expect(persisted.visibility).toBe("hidden");
    expect(persisted.reversible).toBe(false);
    expect(persisted.effects).toEqual([{ type: "RESOURCE_DELTA", key: "water", value: -2 }]);
    expect(persisted.source.id).toBe("evt_persist");
  });

  it("20: flags, profile and campaign identity", () => {
    expect(restored.flags).toEqual(original.flags);
    expect(restored.profile).toEqual(original.profile);
    expect(restored.campaignId).toBe(original.campaignId);
    expect(restored.seed).toBe(original.seed);
    expect(restored.turn).toBe(original.turn);
    expect(restored.day).toBe(original.day);
    expect(restored.worldPressure).toBe(original.worldPressure);
  });

  it("no AI profile preference leaked into authoritative state", () => {
    const keys = Object.keys(restored);
    expect(keys.some(key => /aiProfile|preferredProfile|localAi/i.test(key))).toBe(false);
  });
});

describe("21, 22, 23: a loaded world is immediately usable and deterministic", () => {
  const spend: EventChoice = {
    id: "after_load",
    label: "x",
    effects: [{ type: "RESOURCE_DELTA", key: "water", value: -2 }]
  };

  it("21: it can tick straight away", () => {
    const restored = loaded(store(populated()));
    const ticked = runWorldTick(restored);
    expect(ticked.state.simulation!.tick).toBe(restored.simulation!.tick + 1);
  });

  it("22: it can resolve a choice straight away", () => {
    const restored = loaded(store(populated()));
    const chosen = resolveChoice(restored, spend, "player_choice");
    expect(chosen.state.turn).toBe(restored.turn + 1);
    expect(chosen.state.simulation!.settlements[0]!.resourceStock.water).toBe(
      restored.simulation!.settlements[0]!.resourceStock.water - 2
    );
  });

  it("23: the original and the reloaded world continue identically", () => {
    // The point of the whole exercise: saving and loading must be invisible to
    // the simulation.
    const original = populated();
    const restored = loaded(store(original));

    const advance = (from: WorldState): WorldState => {
      let state = resolveChoice(from, spend, "player_choice").state;
      state = runWorldTick(state).state;
      state = runWorldTick(state).state;
      return state;
    };

    expect(advance(restored)).toEqual(advance(original));
  });
});

describe("25: a corrupted save never becomes a fresh world", () => {
  it("every refusal is a refusal, never a silent default", () => {
    const fresh = createSystemicScenario(7419);
    for (const raw of [
      "{",
      "{}",
      '{"campaignId":"x"}',
      JSON.stringify({ ...fresh, simulation: null }),
      JSON.stringify({ ...fresh, resources: { water: "14" } })
    ]) {
      const result = loadSystemicWorldState(raw);
      expect(result.ok, `accepted ${raw.slice(0, 30)}`).toBe(false);
      // No branch of the failure carries a state at all: there is nothing a
      // caller could mistake for a playable world. The union enforces it — the
      // narrowing below is what makes `errors` reachable in the first place.
      expect(result).not.toHaveProperty("state");
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
