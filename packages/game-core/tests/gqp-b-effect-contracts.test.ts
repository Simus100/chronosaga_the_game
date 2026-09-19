import { describe, expect, it } from "vitest";
import type {
  CausalSource,
  CharacterMemory,
  EventEffect,
  GameEvent,
  StateChange,
  WorldState
} from "@paa/game-types";
import {
  EVENT_EFFECT_TYPES,
  PROOF_EVENT_EFFECT_TYPES,
  applyDueConsequences,
  applyEventEffect,
  createGqpScenario,
  createSystemicScenario,
  runWorldTick,
  scheduleDelayedConsequence,
  settlementInfrastructurePressure,
  validateGameEvent,
  validateSystemicWorldState
} from "../src";

/**
 * GQP-B effect contracts.
 *
 * Four proof-only effects, each tested as a contract rather than as an
 * implementation: what a well-formed payload does to the world, what a hostile
 * one does to it (nothing), and whether the same effect means the same thing
 * whether it arrives now or three decisions from now.
 *
 * Every refusal is tested on a world passed *directly* to the applicator, with
 * no clone in between. The resolvers clone, but the applicator is exported, and
 * the P2-2 finding on GQP-0 was precisely an exported function that relied on
 * its callers cloning.
 */

const SOURCE: CausalSource = { kind: "choice", id: "evt_probe:probe" };
const CONTEXT = { source: SOURCE, turn: 1 };

function proof(): WorldState {
  return createGqpScenario(7419);
}

function epidemicOf(state: WorldState) {
  const simulation = state.simulation as unknown as {
    epidemic: { value: number; contributors: { cause: string; magnitude: number; source: CausalSource }[] };
  };
  return simulation.epidemic;
}

function memoriesOf(state: WorldState, characterId: string): CharacterMemory[] {
  return state.party.find(character => character.id === characterId)?.memories ?? [];
}

function holderOf(state: WorldState, memoryId: string): string[] {
  return state.party
    .filter(character => (character.memories ?? []).some(memory => memory.id === memoryId))
    .map(character => character.id);
}

/** The effect applied directly; the world must be untouched if it throws. */
function refusedWithoutMutation(state: WorldState, effect: unknown, pattern: RegExp): void {
  const snapshot = structuredClone(state);
  const changes: StateChange[] = [];
  expect(() => applyEventEffect(state, effect as EventEffect, changes, CONTEXT)).toThrow(pattern);
  expect(state).toEqual(snapshot);
  expect(changes).toEqual([]);
}

/** A delayed consequence carrying `effects`, scheduled on `state`. */
function scheduled(state: WorldState, effects: unknown[], id = "con_probe"): WorldState {
  return scheduleDelayedConsequence(state, {
    id,
    triggerTurn: 1,
    visibility: "visible",
    scope: "settlement",
    effects: effects as EventEffect[],
    reversible: false,
    status: "pending",
    source: SOURCE
  }).state;
}

/**
 * A MEMORY_RECORD payload. Typed as an effect because most uses are valid;
 * the hostile cases pass overrides that break it on purpose, and the cast is
 * how a payload of unknown provenance is represented honestly.
 */
const memoryRecord = (overrides: Record<string, unknown> = {}): EventEffect =>
  ({
  type: "MEMORY_RECORD",
  characterId: "tarek_001",
  memoryId: "fact_probe",
  valence: "negative",
  salience: 0.8,
  exposure: "private",
  behaviorHook: "offer_unprompted_warning",
  callbackEligible: true,
  summary: "The recycler warning went unheeded.",
  tags: ["recycler"],
  ...overrides
  }) as unknown as EventEffect;

describe("GQP-B effects: vocabulary and version boundaries", () => {
  it("adds exactly four proof-only types and leaves the M1 vocabulary alone", () => {
    expect([...PROOF_EVENT_EFFECT_TYPES].sort()).toEqual([
      "EPIDEMIC_SHIFT",
      "MEMORY_PUBLISH",
      "MEMORY_RECORD",
      "NODE_CONDITION_SHIFT"
    ]);
    // The GQP-0 list is untouched: it is what M1 content and v1 saves may hold.
    expect([...EVENT_EFFECT_TYPES].sort()).toEqual([
      "CHARACTER_STRESS",
      "FLAG_SET",
      "PRESSURE_DELTA",
      "RESOURCE_DELTA"
    ]);
  });

  it("refuses a proof effect inside an M1 event", () => {
    const event: GameEvent = {
      id: "evt_m1",
      version: 1,
      title: "M1",
      body: "m1",
      category: "test",
      tags: [],
      weight: 1,
      choices: [
        {
          id: "only",
          label: "ONLY",
          effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.1 }]
        }
      ]
    };
    expect(validateGameEvent(event).ok).toBe(false);
  });

  it.each(PROOF_EVENT_EFFECT_TYPES)("refuses %s on a baseline v1 world, touching nothing", type => {
    const effects: Record<string, unknown> = {
      EPIDEMIC_SHIFT: { type, cause: "crowding", delta: 0.1 },
      NODE_CONDITION_SHIFT: { type, nodeId: "prod_recycler_01", delta: 0.1 },
      MEMORY_RECORD: memoryRecord(),
      MEMORY_PUBLISH: { type, memoryId: "fact_probe" }
    };
    refusedWithoutMutation(createSystemicScenario(7419), effects[type], /cannot apply to a baseline world/);
  });

  it("refuses a v1 save whose delayed consequence carries a proof effect, by name", () => {
    const world = createSystemicScenario(7419) as any;
    world.simulation.delayedConsequences.push({
      id: "con_smuggled",
      triggerTurn: 3,
      visibility: "hidden",
      scope: "settlement",
      effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.2 }],
      reversible: false,
      status: "pending",
      source: SOURCE
    });
    const errors = validateSystemicWorldState(world).errors;
    expect(errors.some(e => /proof effect NODE_CONDITION_SHIFT and cannot appear at schema v1/.test(e))).toBe(true);
  });

  it("accepts a well-formed proof consequence at v2", () => {
    const world = scheduled(proof(), [
      { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.2 },
      { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.08 },
      memoryRecord()
    ]);
    expect(validateSystemicWorldState(world).errors).toEqual([]);
  });

  it("refuses a v2 consequence whose proof effect names something absent", () => {
    const world = scheduled(proof(), [
      { type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: -0.2 },
      memoryRecord({ characterId: "ghost_999" }),
      memoryRecord({ memoryId: "fact_two", subjectId: "faction_ghost" })
    ]);
    const errors = validateSystemicWorldState(world).errors;
    expect(errors.some(e => /nodeId 'prod_ghost' matches no production node/.test(e))).toBe(true);
    expect(errors.some(e => /characterId 'ghost_999' matches no party character/.test(e))).toBe(true);
    expect(errors.some(e => /subjectId 'faction_ghost' matches no character or faction/.test(e))).toBe(true);
  });
});

describe("GQP-B effects: EPIDEMIC_SHIFT moves a named cause, and the value with it", () => {
  it("creates the contributor, keeps value equal to the sum, and records why", () => {
    const state = proof();
    const changes: StateChange[] = [];
    applyEventEffect(state, { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.1 }, changes, CONTEXT);

    const epidemic = epidemicOf(state);
    expect(epidemic.value).toBe(0.28);
    expect(epidemic.contributors.map(c => `${c.cause}:${c.magnitude}`)).toEqual([
      "crowding:0.06",
      "deferred_triage:0.1",
      "water_shortage:0.12"
    ]);
    // Why: the contributor carries the decision that moved it.
    expect(epidemic.contributors.find(c => c.cause === "deferred_triage")!.source).toEqual(SOURCE);
    expect(changes.map(c => `${c.type}:${c.key}:${String(c.before)}->${String(c.after)}`)).toEqual([
      "epidemicContributor:epidemic.contributors.deferred_triage:0->0.1",
      "epidemic:epidemic.value:0.18->0.28"
    ]);
    expect(validateSystemicWorldState(state).ok).toBe(true);
  });

  it("does not take a cause below nothing, and says so in the delta", () => {
    const state = proof();
    const changes: StateChange[] = [];
    applyEventEffect(state, { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: -0.5 }, changes, CONTEXT);
    expect(epidemicOf(state).contributors.find(c => c.cause === "crowding")!.magnitude).toBe(0);
    expect(epidemicOf(state).value).toBe(0.12);
    // The recorded change is what happened, not what was asked for.
    expect(changes[0]).toMatchObject({ before: 0.06, after: 0 });
  });

  it("does not let one cause push the epidemic past its 0..1 range", () => {
    const state = proof();
    applyEventEffect(state, { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 1 }, [], CONTEXT);
    const epidemic = epidemicOf(state);
    expect(epidemic.value).toBe(1);
    expect(epidemic.contributors.find(c => c.cause === "deferred_triage")!.magnitude).toBe(0.82);
    expect(validateSystemicWorldState(state).ok).toBe(true);
  });

  it("refuses to author the cause the World Tick derives", () => {
    refusedWithoutMutation(
      proof(),
      { type: "EPIDEMIC_SHIFT", cause: "water_shortage", delta: 0.1 },
      /derived by the World Tick and cannot be authored/
    );
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a string", "0.1"],
    ["zero", 0],
    ["more than a whole range", 1.5]
  ])("refuses a delta of %s, touching nothing", (_label, delta) => {
    refusedWithoutMutation(proof(), { type: "EPIDEMIC_SHIFT", cause: "crowding", delta }, /delta/);
  });

  it("refuses an unknown cause, an extra field, and a missing context", () => {
    refusedWithoutMutation(proof(), { type: "EPIDEMIC_SHIFT", cause: "bad_luck", delta: 0.1 }, /cause must be one of/);
    refusedWithoutMutation(
      proof(),
      { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1, key: "smuggled" },
      /key is not a field of EPIDEMIC_SHIFT/
    );
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() =>
      applyEventEffect(state, { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1 }, [])
    ).toThrow(/needs an effect context/);
    expect(state).toEqual(snapshot);
  });

  it("refuses a save whose epidemic value disagrees with its causes, or repeats one", () => {
    const drifted = proof() as any;
    drifted.simulation.epidemic.value = 0.4;
    expect(
      validateSystemicWorldState(drifted).errors.some(e => /value is 0.4 but its contributors add up to 0.18/.test(e))
    ).toBe(true);

    const doubled = proof() as any;
    doubled.simulation.epidemic.contributors.push({ ...doubled.simulation.epidemic.contributors[1] });
    doubled.simulation.epidemic.value = 0.24;
    expect(
      validateSystemicWorldState(doubled).errors.some(e => /lists cause 'crowding' more than once/.test(e))
    ).toBe(true);
  });
});

describe("GQP-B effects: NODE_CONDITION_SHIFT is agency over the node itself", () => {
  it("moves the authoritative condition and the derived infrastructure pressure with it", () => {
    const state = proof();
    const before = settlementInfrastructurePressure(state, "settlement_helios");
    const changes: StateChange[] = [];
    applyEventEffect(state, { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.2 }, changes, CONTEXT);

    expect(state.simulation!.productionNodes[0]!.condition).toBe(0.93);
    expect(changes).toEqual([
      { type: "nodeCondition", key: "prod_recycler_01.condition", before: 0.73, after: 0.93 }
    ]);
    // Spec 9.2: no counter was written; the pressure moved because the node did.
    expect(settlementInfrastructurePressure(state, "settlement_helios")).toBeLessThan(before);
    expect(Object.keys(state.simulation!)).not.toContain("infrastructure");
  });

  it("changes what the recycler produces on the next World Tick", () => {
    const repaired = proof();
    applyEventEffect(repaired, { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.2 }, [], CONTEXT);
    const damaged = proof();
    applyEventEffect(damaged, { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.2 }, [], CONTEXT);

    const producedBy = (state: WorldState) =>
      runWorldTick(state).trace.production[0]!.outputsProduced.water!;
    expect(producedBy(repaired)).toBeGreaterThan(producedBy(proof()));
    expect(producedBy(damaged)).toBeLessThan(producedBy(proof()));
  });

  it("stays inside the 0..1 range the persistence boundary already enforces", () => {
    const up = proof();
    applyEventEffect(up, { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.9 }, [], CONTEXT);
    expect(up.simulation!.productionNodes[0]!.condition).toBe(1);
    const down = proof();
    applyEventEffect(down, { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.9 }, [], CONTEXT);
    expect(down.simulation!.productionNodes[0]!.condition).toBe(0);
  });

  it.each([
    ["an unknown node", { nodeId: "prod_ghost", delta: 0.1 }, /matches no production node/],
    ["an empty node id", { nodeId: "", delta: 0.1 }, /nodeId must be a non-empty string/],
    ["a whitespace node id", { nodeId: "   ", delta: 0.1 }, /nodeId must be a non-empty string/],
    ["an inherited property name", { nodeId: "toString", delta: 0.1 }, /matches no production node/],
    ["NaN", { nodeId: "prod_recycler_01", delta: Number.NaN }, /delta/],
    ["Infinity", { nodeId: "prod_recycler_01", delta: Number.POSITIVE_INFINITY }, /delta/]
  ])("refuses %s, touching nothing", (_label, payload, pattern) => {
    refusedWithoutMutation(proof(), { type: "NODE_CONDITION_SHIFT", ...payload }, pattern);
  });
});

describe("GQP-B effects: MEMORY_RECORD writes a salient memory, typed", () => {
  it("records the fact on the character with every GQP-A field, and origin direct", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ exposure: "secret" }), [], { source: SOURCE, turn: 3 });
    const memory = memoriesOf(state, "tarek_001").find(m => m.id === "fact_probe")!;
    expect(memory).toEqual({
      id: "fact_probe",
      summary: "The recycler warning went unheeded.",
      tags: ["recycler"],
      turn: 3,
      source: SOURCE,
      valence: "negative",
      salience: 0.8,
      origin: "direct",
      exposure: "secret",
      behaviorHook: "offer_unprompted_warning",
      callbackEligible: true
    });
    expect(validateSystemicWorldState(state).ok).toBe(true);
  });

  it("refuses to record the same fact twice on one character", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ exposure: "secret" }), [], CONTEXT);
    refusedWithoutMutation(state, memoryRecord({ exposure: "secret" }), /already holds memory 'fact_probe'/);
  });

  it.each([
    ["an unknown character", { characterId: "ghost_999" }, /matches no party character/],
    ["an unknown subject", { subjectId: "ghost_999" }, /matches no character or faction/],
    ["the holder as its own subject", { subjectId: "tarek_001" }, /must not be the holder/],
    ["zero salience", { salience: 0 }, /salience must be within/],
    ["salience above one", { salience: 1.5 }, /salience must be within/],
    ["NaN salience", { salience: Number.NaN }, /salience must be a finite number/],
    ["string salience", { salience: "0.5" }, /salience must be a finite number/],
    ["an unknown valence", { valence: "furious" }, /valence must be one of/],
    ["an unknown exposure", { exposure: "rumoured" }, /exposure must be one of/],
    ["an unknown hook", { behaviorHook: "do_anything" }, /behaviorHook must be one of/],
    ["a non-boolean callback flag", { callbackEligible: "yes" }, /callbackEligible must be a boolean/],
    ["an empty summary", { summary: "  " }, /summary must be a non-empty string/],
    ["an authored origin", { origin: "reflected" }, /origin is not a field of MEMORY_RECORD/],
    ["an empty memory id", { memoryId: "" }, /memoryId must be a non-empty string/]
  ])("refuses %s, touching nothing", (_label, overrides, pattern) => {
    refusedWithoutMutation(proof(), memoryRecord(overrides), pattern);
  });
});

describe("GQP-B propagation: exactly three channels, bounded, with no secret hive mind", () => {
  it("channel 1 only, for a secret — the strong Mara/Tarek bond does not carry it", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ exposure: "secret" }), [], CONTEXT);
    expect(holderOf(state, "fact_probe")).toEqual(["tarek_001"]);
    expect(state.simulation!.factions.every(f => !f.memoryTags.includes("aware:fact_probe"))).toBe(true);
  });

  it("channel 2 for a private fact: the high bond reflects it, once, without the hook", () => {
    const state = proof();
    const changes: StateChange[] = [];
    applyEventEffect(state, memoryRecord({ exposure: "private" }), changes, CONTEXT);

    expect(holderOf(state, "fact_probe")).toEqual(["mara_001", "tarek_001"]);
    const reflected = memoriesOf(state, "mara_001").find(m => m.id === "fact_probe")!;
    expect(reflected.origin).toBe("reflected");
    expect(reflected.salience).toBe(0.4);
    // Knowledge travels; Tarek's disposition does not.
    expect(reflected.behaviorHook).toBeUndefined();
    // No public channel for a private fact.
    expect(state.simulation!.factions.every(f => !f.memoryTags.includes("aware:fact_probe"))).toBe(true);
    expect(changes.map(c => c.type)).toEqual(["memoryRecorded", "memoryReflected"]);
  });

  it("does not reflect along a bond weaker than high", () => {
    // Tarek's bond toward Brann is medium, and nobody holds a high bond toward Brann.
    const state = proof();
    applyEventEffect(state, memoryRecord({ characterId: "brann_001", behaviorHook: undefined }), [], CONTEXT);
    expect(holderOf(state, "fact_probe")).toEqual(["brann_001"]);
  });

  it("does not reflect a fact that is not salient enough to pass on", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ salience: 0.3 }), [], CONTEXT);
    expect(holderOf(state, "fact_probe")).toEqual(["tarek_001"]);
  });

  it("stops at one hop: a reflected copy never reflects again", () => {
    const state = proof();
    // A second high bond, toward Mara, would carry the fact a second hop if
    // reflection were recursive.
    state.simulation!.schemaVersion === 2 &&
      (state.simulation as any).characterRelationships.push({
        sourceCharacterId: "sela_001",
        targetCharacterId: "mara_001",
        type: "ally_friend",
        strength: "high"
      });
    applyEventEffect(state, memoryRecord({ exposure: "private" }), [], CONTEXT);
    expect(holderOf(state, "fact_probe")).toEqual(["mara_001", "tarek_001"]);
  });

  it("channel 3 for a public fact: the settlement's community and its controlling faction", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ characterId: "ira_001", exposure: "public" }), [], CONTEXT);

    expect(holderOf(state, "fact_probe").sort()).toEqual(
      ["brann_001", "ira_001", "mara_001", "sela_001", "tarek_001"]
    );
    for (const id of ["brann_001", "mara_001", "sela_001", "tarek_001"]) {
      const copy = memoriesOf(state, id).find(m => m.id === "fact_probe")!;
      expect(copy.origin).toBe("public");
      expect(copy.behaviorHook).toBeUndefined();
    }
    const council = state.simulation!.factions.find(f => f.id === "faction_compact")!;
    const front = state.simulation!.factions.find(f => f.id === "faction_front")!;
    // The faction that controls the settlement learns; the other one does not.
    expect(council.memoryTags).toContain("aware:fact_probe");
    expect(front.memoryTags).not.toContain("aware:fact_probe");
  });

  it("visits recipients in a stable order whatever order the party is stored in", () => {
    const forward = proof();
    const reversed = proof();
    reversed.party.reverse();
    applyEventEffect(forward, memoryRecord({ characterId: "ira_001", exposure: "public" }), [], CONTEXT);
    applyEventEffect(reversed, memoryRecord({ characterId: "ira_001", exposure: "public" }), [], CONTEXT);

    const holders = (state: WorldState) =>
      state.party
        .map(c => [c.id, (c.memories ?? []).find(m => m.id === "fact_probe")] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1));
    expect(holders(reversed)).toEqual(holders(forward));
  });

  it("writes nothing at all if any part of the propagation is impossible", () => {
    const state = proof();
    // A bond toward Tarek from someone who is not in the party: the plan must
    // fail before the direct memory is written, not after.
    (state.simulation as any).characterRelationships.push({
      sourceCharacterId: "ghost_999",
      targetCharacterId: "tarek_001",
      type: "ally_friend",
      strength: "high"
    });
    refusedWithoutMutation(state, memoryRecord({ exposure: "private" }), /ghost_999/);
  });
});

describe("GQP-B effects: MEMORY_PUBLISH makes a kept fact public, by decision", () => {
  function withSecret(): WorldState {
    const state = proof();
    applyEventEffect(
      state,
      memoryRecord({ characterId: "mara_001", memoryId: "fact_secret", exposure: "secret", behaviorHook: "call_in_debt", subjectId: "faction_front" }),
      [],
      CONTEXT
    );
    return state;
  }

  it("turns the holder's copy public and runs the public channel from her settlement", () => {
    const state = withSecret();
    const publish = { source: { kind: "choice" as const, id: "evt_publish:disclose" }, turn: 4 };
    const changes: StateChange[] = [];
    applyEventEffect(state, { type: "MEMORY_PUBLISH", memoryId: "fact_secret" }, changes, publish);

    expect(memoriesOf(state, "mara_001").find(m => m.id === "fact_secret")!.exposure).toBe("public");
    expect(holderOf(state, "fact_secret").sort()).toEqual(
      ["brann_001", "ira_001", "mara_001", "sela_001", "tarek_001"]
    );
    // The others learned it from the publication, not from the old secret.
    const brann = memoriesOf(state, "brann_001").find(m => m.id === "fact_secret")!;
    expect(brann.origin).toBe("public");
    expect(brann.source).toEqual(publish.source);
    expect(brann.turn).toBe(4);
    // Mara keeps her hook; nobody else acquires it.
    expect(memoriesOf(state, "mara_001").find(m => m.id === "fact_secret")!.behaviorHook).toBe("call_in_debt");
    expect(brann.behaviorHook).toBeUndefined();
    expect(state.simulation!.factions.find(f => f.id === "faction_compact")!.memoryTags).toContain("aware:fact_secret");
    expect(validateSystemicWorldState(state).ok).toBe(true);
  });

  it("refuses to publish a fact nobody holds, or one already public", () => {
    refusedWithoutMutation(proof(), { type: "MEMORY_PUBLISH", memoryId: "fact_nobody" }, /no character holds that fact/);
    const state = withSecret();
    applyEventEffect(state, { type: "MEMORY_PUBLISH", memoryId: "fact_secret" }, [], CONTEXT);
    refusedWithoutMutation(state, { type: "MEMORY_PUBLISH", memoryId: "fact_secret" }, /already public/);
  });
});

describe("GQP-B effects: the same effect means the same thing now and later", () => {
  const cases: [string, unknown, (state: WorldState) => unknown][] = [
    [
      "EPIDEMIC_SHIFT",
      { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.12 },
      state => ({
        value: epidemicOf(state).value,
        magnitudes: epidemicOf(state).contributors.map(c => [c.cause, c.magnitude])
      })
    ],
    [
      "NODE_CONDITION_SHIFT",
      { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.2 },
      state => state.simulation!.productionNodes.map(node => node.condition)
    ],
    [
      "MEMORY_RECORD",
      memoryRecord({ characterId: "ira_001", exposure: "public" }),
      // The authoritative content of every copy, without the two fields that
      // are the context: when and because of what.
      state =>
        state.party.map(c =>
          (c.memories ?? [])
            .filter(m => m.id === "fact_probe")
            .map(({ turn, source, ...rest }) => { void turn; void source; return rest; })
        )
    ]
  ];

  it.each(cases)("%s lands the same transition immediately and as a delayed consequence", (_type, effect, read) => {
    const immediate = proof();
    applyEventEffect(immediate, effect as EventEffect, [], CONTEXT);

    const later = applyDueConsequences(scheduled(proof(), [effect]), 1).state;

    expect(read(later)).toEqual(read(immediate));
  });

  it("carries the consequence's own cause into what it records", () => {
    const later = applyDueConsequences(scheduled(proof(), [memoryRecord({ exposure: "secret" })]), 1).state;
    expect(memoriesOf(later, "tarek_001").find(m => m.id === "fact_probe")!.source).toEqual(SOURCE);
  });
});

describe("GQP-B tick rule: water shortage feeds the epidemic, derived rather than authored", () => {
  it("sets the water_shortage contributor from the tick's own shortfall", () => {
    const ticked = runWorldTick(proof());
    const shortfall = ticked.trace.shortageSeverity["settlement_helios:water"]!;
    const contributor = epidemicOf(ticked.state).contributors.find(c => c.cause === "water_shortage")!;

    expect(contributor.magnitude).toBeCloseTo(shortfall * 0.4, 4);
    expect(contributor.source).toMatchObject({ kind: "world_tick", rule: "epidemic_water_shortage", tick: 1 });
    expect(validateSystemicWorldState(ticked.state).ok).toBe(true);
  });

  it("is set, not accumulated: it falls when the water comes back", () => {
    let state = runWorldTick(runWorldTick(proof()).state).state;
    const dry = epidemicOf(state).contributors.find(c => c.cause === "water_shortage")!.magnitude;

    // Refill the cistern through the authority and its projection together.
    state.simulation!.settlements[0]!.resourceStock.water = 60;
    state.resources.water = 60;
    state = runWorldTick(state).state;
    const wet = epidemicOf(state).contributors.find(c => c.cause === "water_shortage")!.magnitude;

    expect(wet).toBeLessThan(dry);
  });

  it("alone keeps a dry settlement just under CRITICAL; crossing takes a second cause", () => {
    let state = proof();
    for (let tick = 0; tick < 8; tick += 1) state = runWorldTick(state).state;
    expect(state.simulation!.settlements[0]!.resourceStock.water).toBe(0);
    expect(epidemicOf(state).value).toBe(0.46);
  });

  it("never touches a baseline world, which has no epidemic to touch", () => {
    const ticked = runWorldTick(createSystemicScenario(7419));
    expect(ticked.delta.changes.some(c => c.type.startsWith("epidemic"))).toBe(false);
  });
});

describe("The save boundary for the memory fields GQP-B adds", () => {
  const directMemory = (patch: Record<string, unknown>): CharacterMemory =>
    ({
      id: "fact_saved",
      summary: "saved",
      tags: [],
      turn: 1,
      source: SOURCE,
      valence: "negative",
      salience: 0.6,
      origin: "direct",
      callbackEligible: true,
      ...patch
    }) as CharacterMemory;

  function withMemories(state: WorldState, memories: CharacterMemory[]): WorldState {
    const copy = structuredClone(state);
    copy.party.find(c => c.id === "tarek_001")!.memories = memories;
    return copy;
  }

  it("accepts a well-formed exposure at v2", () => {
    expect(validateSystemicWorldState(withMemories(proof(), [directMemory({ exposure: "secret" })])).ok).toBe(true);
  });

  it("refuses exposure on a baseline v1 save, as every proof memory field", () => {
    const baseline = createSystemicScenario(7419);
    const copy = structuredClone(baseline);
    copy.party[0]!.memories = [{ id: "m", summary: "s", tags: [], turn: 1, source: SOURCE, exposure: "private" } as CharacterMemory];
    const verdict = validateSystemicWorldState(copy);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(/exposure/);
  });

  it("refuses an exposure outside the vocabulary", () => {
    const verdict = validateSystemicWorldState(withMemories(proof(), [directMemory({ exposure: "rumoured" })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(/exposure/);
  });

  it("refuses one character holding the same fact twice", () => {
    const verdict = validateSystemicWorldState(withMemories(proof(), [directMemory({}), directMemory({ salience: 0.9 })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(/holds memory 'fact_saved' more than once/);
  });
});
