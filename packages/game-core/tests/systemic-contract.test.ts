import { describe, expect, it } from "vitest";
import type { WorldState } from "@paa/game-types";
import { createSystemicScenario } from "../src/state/create-systemic-scenario.js";
import {
  loadSystemicWorldState,
  serializeSystemicWorldState
} from "../src/state/load-systemic-state.js";
import { validateSystemicWorldState } from "../src/state/validate-systemic-state.js";

/**
 * The persistence trust boundary, field by field.
 *
 * `validateSystemicWorldState` is what earns `parsed as WorldState`, so every
 * field the contract declares has to be checked before that cast — a scalar
 * left unvalidated is a scalar an edited save can set to anything, and it will
 * reach arithmetic, an enum comparison or the screen without a word.
 */

const scenario = (): WorldState => createSystemicScenario(7419);

/** Break one thing in an otherwise valid world and report what was said. */
function broken(mutate: (world: Record<string, any>) => void): string[] {
  const world = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
  mutate(world);
  const result = validateSystemicWorldState(world);
  if (result.ok) throw new Error("the corrupted world was accepted");
  return result.errors;
}

/** Assert that breaking `path` is refused, and that the message names it. */
function refuses(label: string, mutate: (world: Record<string, any>) => void): void {
  const errors = broken(mutate);
  expect(errors.some(error => error.includes(label)), `${label}: ${errors.join(" | ")}`).toBe(true);
}

describe("the top level is fully checked", () => {
  it("a valid world still passes", () => {
    expect(validateSystemicWorldState(scenario())).toEqual({ ok: true, errors: [] });
  });

  it("campaignId, seed, turn, day and worldPressure", () => {
    refuses("campaignId", world => { world.campaignId = 42; });
    refuses("campaignId", world => { world.campaignId = "   "; });
    refuses("seed", world => { world.seed = "7419"; });
    refuses("seed", world => { world.seed = Number.NaN; });
    refuses("turn", world => { world.turn = 1.5; });
    refuses("turn", world => { world.turn = 0; });
    refuses("day", world => { world.day = "1"; });
    refuses("worldPressure", world => { world.worldPressure = -1; });
    refuses("worldPressure", world => { world.worldPressure = Number.POSITIVE_INFINITY; });
  });

  it("flags carry strings, booleans and finite numbers, and nothing else", () => {
    // A flag reaches event eligibility. An object here is truthy and silently
    // unlocks or blocks content.
    refuses("flags", world => { world.flags = null; });
    refuses("flags.bad", world => { world.flags.bad = {}; });
    refuses("flags.bad", world => { world.flags.bad = []; });
    refuses("flags.bad", world => { world.flags.bad = Number.NaN; });

    const fine = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
    fine.flags.a = "text";
    fine.flags.b = true;
    fine.flags.c = 3;
    expect(validateSystemicWorldState(fine).ok).toBe(true);
  });

  it("the campaign profile is five closed vocabularies", () => {
    refuses("profile", world => { world.profile = "standard"; });
    refuses("profile.difficulty", world => { world.profile.difficulty = "extreme"; });
    refuses("profile.mortality", world => { world.profile.mortality = "none"; });
    refuses("profile.campaignLength", world => { world.profile.campaignLength = "short"; });
    refuses("profile.aiMode", world => { world.profile.aiMode = "gpt"; });
    refuses("profile.simulationDepth", world => { world.profile.simulationDepth = "deepest"; });
  });
});

describe("characters, memories and causal sources", () => {
  it("scalar and array fields of a character", () => {
    refuses(".name", world => { world.party[0].name = 7; });
    refuses(".role", world => { world.party[0].role = null; });
    refuses(".health", world => { world.party[0].health = "80"; });
    refuses(".stress", world => { world.party[0].stress = Number.NaN; });
    refuses(".morale", world => { world.party[0].morale = {}; });
    refuses(".traits", world => { world.party[0].traits = "loyal"; });
    refuses(".traits[0]", world => { world.party[0].traits = [1]; });
    refuses(".memoryTags", world => { world.party[0].memoryTags = null; });
    refuses(".factionId", world => { world.party[0].factionId = 3; });
    refuses(".locationId", world => { world.party[0].locationId = false; });
  });

  it("a memory is a structure with a turn and a source", () => {
    const withMemory = (memory: unknown) => (world: Record<string, any>) => {
      world.party[0].memories = [memory];
    };
    refuses("memory[0].id", withMemory({ summary: "s", tags: [], turn: 1, source: { kind: "event", id: "e" } }));
    refuses("memory[0].tags", withMemory({ id: "m", summary: "s", tags: "x", turn: 1, source: { kind: "event", id: "e" } }));
    refuses("memory[0].turn", withMemory({ id: "m", summary: "s", tags: [], turn: "1", source: { kind: "event", id: "e" } }));
  });

  it("a causal source is checked in full, not just for an id", () => {
    // This is how the game explains itself. A half-checked source produces
    // evidence that looks authoritative and cannot be traced.
    const source = (value: unknown) => (world: Record<string, any>) => {
      world.party[0].memories = [{ id: "m", summary: "s", tags: [], turn: 1, source: value }];
    };
    refuses("source.kind", source({ kind: "vibes", id: "e" }));
    refuses("source.id", source({ kind: "event", id: "" }));
    refuses("source.tick", source({ kind: "event", id: "e", tick: 1.5 }));
    refuses("source.tick", source({ kind: "event", id: "e", tick: -1 }));
    refuses("source.actorId", source({ kind: "event", id: "e", actorId: 9 }));
    refuses("source.rule", source({ kind: "event", id: "e", rule: [] }));

    for (const kind of ["choice", "event", "world_tick", "tactical", "warfare", "system"]) {
      const world = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
      world.party[0].memories = [{ id: "m", summary: "s", tags: [], turn: 1, source: { kind, id: "e" } }];
      expect(validateSystemicWorldState(world).ok, `${kind} rejected`).toBe(true);
    }
  });
});

describe("every systemic entity is checked, not only its id", () => {
  it("settlement scalars", () => {
    refuses(".name", world => { world.simulation.settlements[0].name = 1; });
    refuses(".controllingFactionId", world => { world.simulation.settlements[0].controllingFactionId = null; });
    refuses(".population", world => { world.simulation.settlements[0].population = "1840"; });
    refuses(".stability", world => { world.simulation.settlements[0].stability = Number.NaN; });
    refuses(".satisfaction", world => { world.simulation.settlements[0].satisfaction = []; });
  });

  it("faction scalars", () => {
    refuses(".name", world => { world.simulation.factions[0].name = 5; });
    refuses(".influence", world => { world.simulation.factions[0].influence = "high"; });
    refuses(".reputation", world => { world.simulation.factions[0].reputation = Number.NEGATIVE_INFINITY; });
    refuses(".memoryTags", world => { world.simulation.factions[0].memoryTags = {}; });
  });

  it("production node scalars, including the boolean", () => {
    refuses(".settlementId", world => { world.simulation.productionNodes[0].settlementId = 1; });
    refuses(".recipe", world => { world.simulation.productionNodes[0].recipe = null; });
    refuses(".capacity", world => { world.simulation.productionNodes[0].capacity = "5"; });
    refuses(".efficiency", world => { world.simulation.productionNodes[0].efficiency = Number.NaN; });
    refuses(".labor", world => { world.simulation.productionNodes[0].labor = -1; });
    refuses(".condition", world => { world.simulation.productionNodes[0].condition = {}; });
    // `enabled: "false"` is truthy. A string here silently switches a node on.
    refuses(".enabled", world => { world.simulation.productionNodes[0].enabled = "false"; });
    refuses(".enabled", world => { world.simulation.productionNodes[0].enabled = 1; });
  });

  it("cohort scalars", () => {
    refuses(".settlementId", world => { world.simulation.populationCohorts[0].settlementId = 2; });
    refuses(".population", world => { world.simulation.populationCohorts[0].population = "900"; });
    refuses(".occupation", world => { world.simulation.populationCohorts[0].occupation = null; });
    refuses(".wealth", world => { world.simulation.populationCohorts[0].wealth = 1; });
    refuses(".culture", world => { world.simulation.populationCohorts[0].culture = []; });
    refuses(".satisfaction", world => { world.simulation.populationCohorts[0].satisfaction = "0.5"; });
    refuses(".loyalty", world => { world.simulation.populationCohorts[0].loyalty = Number.NaN; });
    refuses(".politicalAffinity", world => { world.simulation.populationCohorts[0].politicalAffinity = 3; });
  });

  it("political group scalars, and its resources which are a NUMBER", () => {
    refuses(".settlementId", world => { world.simulation.politicalGroups[0].settlementId = 4; });
    refuses(".name", world => { world.simulation.politicalGroups[0].name = null; });
    refuses(".influence", world => { world.simulation.politicalGroups[0].influence = "a lot"; });
    refuses(".approval", world => { world.simulation.politicalGroups[0].approval = Number.NaN; });
    refuses(".goals", world => { world.simulation.politicalGroups[0].goals = "peace"; });
    refuses(".redLines", world => { world.simulation.politicalGroups[0].redLines = null; });
    refuses(".leaderId", world => { world.simulation.politicalGroups[0].leaderId = 7; });

    // The field that was slipping through: a scalar guarded by nothing, while
    // every neighbouring map had a check.
    refuses(".resources", world => { world.simulation.politicalGroups[0].resources = { credits: 5 }; });
    refuses(".resources", world => { world.simulation.politicalGroups[0].resources = "12"; });
    refuses(".resources", world => { world.simulation.politicalGroups[0].resources = Number.NaN; });
  });

  it("warfare squad scalars", () => {
    refuses(".factionId", world => { world.simulation.warfareSquads[0].factionId = 1; });
    refuses(".name", world => { world.simulation.warfareSquads[0].name = null; });
    refuses(".personnel", world => { world.simulation.warfareSquads[0].personnel = "40"; });
    refuses(".morale", world => { world.simulation.warfareSquads[0].morale = Number.NaN; });
    refuses(".readiness", world => { world.simulation.warfareSquads[0].readiness = []; });
    refuses(".supply", world => { world.simulation.warfareSquads[0].supply = {}; });
    refuses(".intelligence", world => { world.simulation.warfareSquads[0].intelligence = "high"; });
    refuses(".commanderId", world => { world.simulation.warfareSquads[0].commanderId = 2; });
  });

  it("delayed consequences: enums, booleans and a full causal source", () => {
    const first = (mutate: (entry: Record<string, any>) => void) => (world: Record<string, any>) => {
      mutate(world.simulation.delayedConsequences[0]);
    };
    refuses(".triggerTurn", first(entry => { entry.triggerTurn = "4"; }));
    refuses(".visibility", first(entry => { entry.visibility = "secret"; }));
    refuses(".scope", first(entry => { entry.scope = "galactic"; }));
    refuses(".status", first(entry => { entry.status = "done"; }));
    refuses(".reversible", first(entry => { entry.reversible = "no"; }));
    refuses(".source.kind", first(entry => { entry.source = { kind: "rumour", id: "x" }; }));
  });

  it("FLAG_SET cannot smuggle a non-finite number", () => {
    // Every other effect type already had its value checked; FLAG_SET accepts
    // numbers too, and a NaN flag compares false against everything including
    // itself, so an event gated on it just stops appearing.
    refuses("FLAG_SET", world => {
      world.simulation.delayedConsequences[0].effects = [
        { type: "FLAG_SET", key: "debt", value: Number.NaN }
      ];
    });
    refuses("FLAG_SET", world => {
      world.simulation.delayedConsequences[0].effects = [
        { type: "FLAG_SET", key: "debt", value: Number.POSITIVE_INFINITY }
      ];
    });

    // Legitimate flag values still pass.
    for (const value of [true, "called", 3]) {
      const world = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
      world.simulation.delayedConsequences[0].effects = [{ type: "FLAG_SET", key: "debt", value }];
      expect(validateSystemicWorldState(world).ok, `${String(value)} rejected`).toBe(true);
    }
  });
});

describe("saving derives the key from the world, and loading checks it", () => {
  it("the campaign id comes from the validated state, not from the caller", () => {
    // The storage command takes an id and a payload independently; nothing
    // there stops campaign beta from being filed under key alpha, and SQL key
    // isolation cannot notice because both values are what it was told.
    const state = scenario();
    const saved = serializeSystemicWorldState(state);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.campaignId).toBe(state.campaignId);
    expect(JSON.parse(saved.payload)).toEqual(state);
  });

  it("an invalid world never reaches the disk", () => {
    // Failing at save time costs one refused click; failing at load time costs
    // the campaign.
    const world = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
    world.simulation.settlements[0].resourceStock.water = "10";
    const saved = serializeSystemicWorldState(world);
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.errors.some(error => error.includes("resourceStock.water"))).toBe(true);
  });

  it("a divergent projection is refused at save time too", () => {
    const world = JSON.parse(JSON.stringify(scenario())) as Record<string, any>;
    world.resources.water = 999;
    expect(serializeSystemicWorldState(world).ok).toBe(false);
  });

  it("a row filed under the wrong key is rejected as an identity mismatch", () => {
    const state = scenario();
    const saved = serializeSystemicWorldState(state);
    if (!saved.ok) throw new Error("save failed");

    const wrong = loadSystemicWorldState(saved.payload, "alpha");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.reason).toBe("campaign_identity_mismatch");
      expect(wrong.errors[0]).toContain("alpha");
      expect(wrong.errors[0]).toContain(state.campaignId);
    }
  });

  it("the matching key loads normally, and omitting it keeps the old behaviour", () => {
    const state = scenario();
    const saved = serializeSystemicWorldState(state);
    if (!saved.ok) throw new Error("save failed");

    const right = loadSystemicWorldState(saved.payload, saved.campaignId);
    expect(right.ok).toBe(true);
    if (right.ok) expect(right.state).toEqual(state);

    expect(loadSystemicWorldState(saved.payload).ok).toBe(true);
  });
});
