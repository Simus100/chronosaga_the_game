import { describe, expect, it } from "vitest";
import type {
  CausalSource,
  CharacterMemory,
  DelayedConsequenceState,
  EventEffect,
  GameEvent,
  ProofEvent,
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
  resolveProofChoice,
  scheduleDelayedConsequence,
  PROOF_MEMORY_FIELDS,
  isFactPublic,
  settlementInfrastructurePressure,
  validateDelayedConsequence,
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

/** A delayed consequence carrying `effects`, as the scheduler would store it. */
function consequenceOf(effects: unknown[], id = "con_probe"): DelayedConsequenceState {
  return {
    id,
    triggerTurn: 1,
    visibility: "visible",
    scope: "settlement",
    effects: effects as EventEffect[],
    reversible: false,
    status: "pending",
    source: SOURCE
  };
}

/** A world that holds `effects` as a pending consequence, bypassing the scheduler. */
function stored(state: WorldState, effects: unknown[]): WorldState {
  const copy = structuredClone(state);
  copy.simulation!.delayedConsequences.push(consequenceOf(effects));
  return copy;
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
    const world = stored(proof(), [
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
  it("records the fact on the character with exactly the GQP-A fields, and origin direct", () => {
    const state = proof();
    const changes: StateChange[] = [];
    applyEventEffect(state, memoryRecord({ exposure: "secret" }), changes, { source: SOURCE, turn: 3 });
    const memory = memoriesOf(state, "tarek_001").find(m => m.id === "fact_probe")!;
    // No `exposure` on the stored memory (P2-5): it chose the channels, and it
    // is reported in the delta, but schema v2's memory is GQP-A's.
    expect(memory).toEqual({
      id: "fact_probe",
      summary: "The recycler warning went unheeded.",
      tags: ["recycler"],
      turn: 3,
      source: SOURCE,
      valence: "negative",
      salience: 0.8,
      origin: "direct",
      behaviorHook: "offer_unprompted_warning",
      callbackEligible: true
    });
    expect(changes.find(c => c.type === "memoryRecorded")!.after).toMatchObject({ exposure: "secret" });
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
    expect(isFactPublic(state, state.simulation as never, "fact_secret")).toBe(false);
    const before = structuredClone(memoriesOf(state, "mara_001").find(m => m.id === "fact_secret")!);
    applyEventEffect(state, { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_secret" }, changes, publish);

    // Publication rewrites nothing: Mara's copy is untouched, and what makes
    // the fact public is what channel 3 writes -- derived, never stored.
    expect(memoriesOf(state, "mara_001").find(m => m.id === "fact_secret")).toEqual(before);
    expect(isFactPublic(state, state.simulation as never, "fact_secret")).toBe(true);
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
    refusedWithoutMutation(proof(), { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_nobody" }, /does not hold that fact/);
    const state = withSecret();
    applyEventEffect(state, { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_secret" }, [], CONTEXT);
    refusedWithoutMutation(state, { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_secret" }, /already public/);
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

describe("The save boundary for proof memories (P2-5: schema v2 stays GQP-A's contract)", () => {
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

  // The GQP-A (develop@567e94f) schema-v2 memory contract, verbatim.
  const GQP_A_MEMORY_FIELDS = [
    "id", "summary", "tags", "turn", "source",
    "valence", "salience", "subjectId", "origin", "behaviorHook", "callbackEligible"
  ];

  it("persists no memory field GQP-A does not know, on any path the proof takes", () => {
    // What an old schema-v2 reader could not interpret, it would accept and
    // ignore. So the proof must not write it. Every channel, the publication,
    // and a delayed record are exercised.
    const state = proof();
    applyEventEffect(state, memoryRecord({ characterId: "tarek_001", exposure: "private" }), [], CONTEXT);
    applyEventEffect(state, memoryRecord({ characterId: "ira_001", memoryId: "fact_public", exposure: "public" }), [], CONTEXT);
    applyEventEffect(state, memoryRecord({ characterId: "mara_001", memoryId: "fact_secret", exposure: "secret", behaviorHook: "call_in_debt", subjectId: "faction_front" }), [], CONTEXT);
    applyEventEffect(state, { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_secret" }, [], CONTEXT);
    const later = applyDueConsequences(scheduled(state, [memoryRecord({ characterId: "sela_001", memoryId: "fact_later", exposure: "public" })]), 1).state;
    const keys = new Set(later.party.flatMap(c => (c.memories ?? []).flatMap(m => Object.keys(m))));
    expect([...keys].filter(key => !GQP_A_MEMORY_FIELDS.includes(key))).toEqual([]);
    expect(later.party.flatMap(c => c.memories ?? []).length).toBeGreaterThan(10);
  });

  it.each([
    ["valence", "negative"],
    ["salience", 0.5],
    ["subjectId", "faction_front"],
    ["origin", "direct"],
    ["behaviorHook", "call_in_debt"],
    ["callbackEligible", true]
  ])("refuses the proof memory field %s on a baseline v1 save, by name", (field, value) => {
    const baseline = createSystemicScenario(7419);
    baseline.party[0]!.memories = [{ id: "m", summary: "s", tags: [], turn: 1, source: SOURCE, [field]: value } as CharacterMemory];
    const verdict = validateSystemicWorldState(baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(new RegExp(`${field} is schema v2 state and must not appear at schema v1`));
  });

  it("keeps the v2 memory field list GQP-A's", () => {
    expect([...PROOF_MEMORY_FIELDS].sort()).toEqual(
      ["valence", "salience", "subjectId", "origin", "behaviorHook", "callbackEligible"].sort()
    );
  });

  it("derives public from the faction's awareness alone, when nobody else was there to hear", () => {
    // Ira is alone in Helios: a public fact reaches no community, but the
    // controlling faction learns it -- and that alone makes it public.
    const state = proof();
    for (const character of state.party) if (character.id !== "ira_001") character.locationId = "elsewhere";
    applyEventEffect(state, memoryRecord({ characterId: "ira_001", memoryId: "fact_lonely", exposure: "public" }), [], CONTEXT);
    expect(holderOf(state, "fact_lonely")).toEqual(["ira_001"]);
    expect(isFactPublic(state, state.simulation as never, "fact_lonely")).toBe(true);
    refusedWithoutMutation(state, { type: "MEMORY_PUBLISH", characterId: "ira_001", memoryId: "fact_lonely" }, /already public/);
  });

  it("derives public from a public copy alone, whatever became of the faction's tags", () => {
    const state = withMemories(proof(), [directMemory({})]);
    state.party.find(c => c.id === "sela_001")!.memories = [directMemory({ origin: "public", salience: 0.3 })];
    expect(state.simulation!.factions.some(f => f.memoryTags.includes("aware:fact_saved"))).toBe(false);
    expect(isFactPublic(state, state.simulation as never, "fact_saved")).toBe(true);
    refusedWithoutMutation(state, { type: "MEMORY_PUBLISH", characterId: "tarek_001", memoryId: "fact_saved" }, /already public/);
  });

  it("treats a stray exposure key as inert, exactly as a GQP-A reader would", () => {
    // Neither build reads it, so neither can read it differently: the same
    // world with and without it publishes, and propagates, identically.
    const clean = withMemories(proof(), [directMemory({})]);
    const stray = withMemories(proof(), [directMemory({ exposure: "public" })]);
    expect(isFactPublic(stray, stray.simulation as never, "fact_saved")).toBe(false);
    const publish = { type: "MEMORY_PUBLISH", characterId: "tarek_001", memoryId: "fact_saved" } as EventEffect;
    applyEventEffect(clean, publish, [], CONTEXT);
    applyEventEffect(stray, publish, [], CONTEXT);
    const withoutKey = (w: WorldState) => JSON.parse(JSON.stringify(w).replace(',"exposure":"public"', ""));
    expect(withoutKey(stray)).toEqual(JSON.parse(JSON.stringify(clean)));
  });

  it("refuses one character holding the same fact twice", () => {
    const verdict = validateSystemicWorldState(withMemories(proof(), [directMemory({}), directMemory({ salience: 0.9 })]));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("; ")).toMatch(/holds memory 'fact_saved' more than once/);
  });
});

describe("The scheduler meets the save boundary before it stores anything (P2-2)", () => {
  const baseline = () => createSystemicScenario(7419);

  it.each([
    ["a proof effect in a baseline world", baseline, [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.1 }], /cannot appear at schema v1/],
    ["a malformed legacy effect", baseline, [{ type: "RESOURCE_DELTA", key: "water", value: Number.NaN }], /requires finite numeric value/],
    ["a legacy effect naming an absent character", baseline, [{ type: "CHARACTER_STRESS", targetId: "nobody_999", value: 3 }], /unknown character 'nobody_999'/],
    ["a malformed proof effect", proof, [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: Number.NaN }], /delta/],
    ["a proof effect naming an absent node", proof, [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: -0.1 }], /prod_ghost/],
    ["a memory for an absent character", proof, [memoryRecord({ characterId: "ghost_999" })], /ghost_999/],
    ["no effects at all", proof, [], /must contain at least one effect/]
  ] as const)("refuses %s, and leaves the input world untouched", (_label, world, effects, pattern) => {
    const state = world();
    const snapshot = structuredClone(state);
    expect(() => scheduleDelayedConsequence(state, consequenceOf([...effects]))).toThrow(pattern);
    expect(state).toEqual(snapshot);
  });

  it.each([
    ["a zero trigger turn", { triggerTurn: 0 }, /triggerTurn/],
    ["an unknown visibility", { visibility: "secret" }, /visibility/],
    ["a missing cause", { source: undefined }, /source/]
  ] as const)("refuses a consequence with %s", (_label, patch, pattern) => {
    const state = proof();
    const consequence = { ...consequenceOf([{ type: "PRESSURE_DELTA", value: 1 }]), ...patch } as unknown as DelayedConsequenceState;
    expect(() => scheduleDelayedConsequence(state, consequence)).toThrow(pattern);
  });

  it.each([
    ["a legacy effect in a baseline world", () => createSystemicScenario(7419), [{ type: "PRESSURE_DELTA", value: 1 }]],
    ["a legacy effect in a proof world", proof, [{ type: "RESOURCE_DELTA", key: "water", value: -1 }]],
    ["a proof effect in a proof world", proof, [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.1 }]],
    ["a memory in a proof world", proof, [memoryRecord({})]]
  ] as const)("keeps scheduling %s, into a world the boundary accepts", (_label, world, effects) => {
    const next = scheduleDelayedConsequence(world(), consequenceOf([...effects])).state;
    expect(validateSystemicWorldState(next)).toEqual({ ok: true, errors: [] });
  });

  it("refuses exactly what the boundary refuses once stored -- one contract, not two", () => {
    const cases: [() => WorldState, unknown[]][] = [
      [baseline, [{ type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1 }]],
      [baseline, [{ type: "PRESSURE_DELTA", value: 2 }]],
      [proof, [{ type: "EPIDEMIC_SHIFT", cause: "water_shortage", delta: 0.1 }]],
      [proof, [{ type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1 }]],
      [proof, [{ type: "FLAG_SET", key: "", value: true }]],
      [proof, [{ type: "FLAG_SET", key: "ok", value: true }]]
    ];
    for (const [world, effects] of cases) {
      const state = world();
      const boundary = validateSystemicWorldState(stored(state, effects)).ok;
      const direct = validateDelayedConsequence(consequenceOf(effects), state).length === 0;
      let scheduler = true;
      try {
        scheduleDelayedConsequence(state, consequenceOf(effects));
      } catch {
        scheduler = false;
      }
      expect([direct, scheduler]).toEqual([boundary, boundary]);
    }
  });
});

describe("MEMORY_PUBLISH names its holder, and publishes only what it can (P2-4)", () => {
  function secretOnMara(): WorldState {
    const state = proof();
    applyEventEffect(
      state,
      memoryRecord({ characterId: "mara_001", memoryId: "fact_secret", exposure: "private", behaviorHook: "call_in_debt", subjectId: "faction_front" }),
      [],
      CONTEXT
    );
    return state;
  }
  const publish = (characterId: string, memoryId = "fact_secret") =>
    ({ type: "MEMORY_PUBLISH", characterId, memoryId }) as EventEffect;

  it.each([
    ["no holder", { type: "MEMORY_PUBLISH", memoryId: "fact_secret" }, /characterId/],
    ["an unknown holder", { type: "MEMORY_PUBLISH", characterId: "ghost_999", memoryId: "fact_secret" }, /ghost_999/],
    ["an extra field", { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_secret", origin: "direct" }, /origin/]
  ])("refuses a payload with %s, touching nothing", (_label, effect, pattern) => {
    refusedWithoutMutation(secretOnMara(), effect, pattern);
  });

  it("refuses to publish from a holder who only heard it second-hand", () => {
    const state = secretOnMara();
    // Tarek received a reflected copy along the high bond.
    expect(memoriesOf(state, "tarek_001").find(m => m.id === "fact_secret")!.origin).toBe("reflected");
    refusedWithoutMutation(state, publish("tarek_001"), /holds it second-hand, not directly/);
  });

  it("refuses to publish from someone who does not hold the fact at all", () => {
    refusedWithoutMutation(secretOnMara(), publish("ira_001"), /'ira_001' does not hold that fact/);
  });

  it("publishes from the named direct holder", () => {
    const state = secretOnMara();
    applyEventEffect(state, publish("mara_001"), [], CONTEXT);
    expect(isFactPublic(state, state.simulation as never, "fact_secret")).toBe(true);
    expect(holderOf(state, "fact_secret").sort()).toEqual(["brann_001", "ira_001", "mara_001", "sela_001", "tarek_001"]);
  });

  it("stores a pending publication only if its holder can make it now", () => {
    const pending = (effect: EventEffect) => consequenceOf([effect], "con_publish");
    // Scheduler and boundary refuse the impossible: nobody holds it, or the
    // named holder holds it second-hand.
    for (const [state, effect, pattern] of [
      [proof(), publish("mara_001", "fact_typo"), /does not hold that fact/],
      [secretOnMara(), publish("tarek_001"), /second-hand/]
    ] as const) {
      const snapshot = structuredClone(state);
      expect(() => scheduleDelayedConsequence(state, pending(effect))).toThrow(pattern);
      expect(state).toEqual(snapshot);
      expect(validateSystemicWorldState(stored(state, [effect])).errors.join("; ")).toMatch(pattern);
    }
    // And accept what will work.
    const next = scheduleDelayedConsequence(secretOnMara(), pending(publish("mara_001"))).state;
    expect(validateSystemicWorldState(next)).toEqual({ ok: true, errors: [] });
    const fired = applyDueConsequences(next, 1).state;
    expect(isFactPublic(fired, fired.simulation as never, "fact_secret")).toBe(true);
    // Once applied, the publication is history, not a promise: still valid.
    expect(validateSystemicWorldState(fired).ok).toBe(true);
  });

  it("still requires an applied publication to name a real character", () => {
    // An applied consequence is history: its holder need not hold anything
    // now, but it must exist -- the reference check is what says so.
    const world = stored(proof(), [publish("ghost_999")]);
    world.simulation!.delayedConsequences.find(c => c.id === "con_probe")!.status = "applied";
    expect(validateSystemicWorldState(world).errors.join("; ")).toMatch(/characterId 'ghost_999' matches no party character/);
    const real = stored(proof(), [publish("mara_001", "fact_long_published")]);
    real.simulation!.delayedConsequences.find(c => c.id === "con_probe")!.status = "applied";
    expect(validateSystemicWorldState(real).ok).toBe(true);
  });
});

describe("One memory id, one fact, across the party (P2-7)", () => {
  const fact = (patch: Record<string, unknown>): CharacterMemory =>
    ({
      id: "fact_x",
      summary: "A",
      tags: ["t"],
      turn: 1,
      source: SOURCE,
      valence: "negative",
      subjectId: "faction_front",
      salience: 0.8,
      origin: "direct",
      callbackEligible: true,
      ...patch
    }) as CharacterMemory;
  function holding(entries: [string, CharacterMemory][]): WorldState {
    const state = proof();
    for (const [characterId, memory] of entries) {
      const character = state.party.find(c => c.id === characterId)!;
      character.memories = [...(character.memories ?? []), memory];
    }
    return state;
  }
  const errorsOf = (state: WorldState) => validateSystemicWorldState(state).errors.join("; ");

  it("refuses two first-hand holders of one id, with different contents", () => {
    const state = holding([
      ["mara_001", fact({ summary: "A" })],
      ["tarek_001", fact({ summary: "B" })]
    ]);
    expect(errorsOf(state)).toMatch(/fact 'fact_x' is held first-hand by more than one character: mara_001, tarek_001/);
    expect(errorsOf(state)).toMatch(/fact 'fact_x' held by tarek_001 differs from the fact it copies/);
  });

  it("refuses two first-hand holders even with identical contents", () => {
    expect(errorsOf(holding([["mara_001", fact({})], ["tarek_001", fact({})]]))).toMatch(/held first-hand by more than one character/);
  });

  it.each([
    ["summary", { summary: "B" }],
    ["tags", { tags: ["other"] }],
    ["valence", { valence: "positive" }],
    ["subject", { subjectId: "faction_compact" }],
    ["callback eligibility", { callbackEligible: false }]
  ])("refuses a copy whose %s differs from its fact", (_label, patch) => {
    const state = holding([["mara_001", fact({})], ["tarek_001", fact({ origin: "reflected", salience: 0.4, ...patch })]]);
    expect(errorsOf(state)).toMatch(/fact 'fact_x' held by tarek_001 differs from the fact it copies/);
  });

  it("refuses a second-hand copy with no first-hand holder, and a hook on a copy", () => {
    expect(errorsOf(holding([["tarek_001", fact({ origin: "public" })]]))).toMatch(/second-hand copies but no first-hand holder/);
    const hooked = holding([["mara_001", fact({})], ["tarek_001", fact({ origin: "reflected", behaviorHook: "call_in_debt" })]]);
    expect(errorsOf(hooked)).toMatch(/held second-hand by tarek_001 carries a behaviour hook/);
  });

  it("accepts a fact and its channel copies: origin, salience, turn and cause may differ", () => {
    const state = holding([
      ["mara_001", fact({ behaviorHook: "call_in_debt" })],
      ["tarek_001", fact({ origin: "reflected", salience: 0.4, turn: 3 })],
      ["sela_001", fact({ origin: "public", salience: 0.4, source: { kind: "choice", id: "evt_other:x" } })]
    ]);
    expect(validateSystemicWorldState(state)).toEqual({ ok: true, errors: [] });
  });

  it("refuses, at the applicator, to record a fact someone else already holds (P2-7b)", () => {
    // The first record is a secret, so nobody else has a copy; the second event
    // recording the same id first-hand on Tarek used to succeed and leave a world
    // the boundary rejects. It is refused now, touching nothing.
    const state = proof();
    applyEventEffect(state, memoryRecord({ characterId: "mara_001", memoryId: "fact_x", exposure: "secret" }), [], CONTEXT);
    refusedWithoutMutation(state, memoryRecord({ characterId: "tarek_001", memoryId: "fact_x", exposure: "secret" }), /Fact 'fact_x' is already recorded; mara_001 hold it/);
    // Same when the other holder only has a propagated copy.
    const reflected = proof();
    applyEventEffect(reflected, memoryRecord({ characterId: "mara_001", memoryId: "fact_y", exposure: "private" }), [], CONTEXT);
    refusedWithoutMutation(reflected, memoryRecord({ characterId: "ira_001", memoryId: "fact_y", exposure: "private" }), /Fact 'fact_y' is already recorded/);
    expect(validateSystemicWorldState(state).ok).toBe(true);
  });

  it("refuses the same through the resolver, whose final gate is not the only line", () => {
    const events: ProofEvent[] = ["a", "b"].map((suffix, i) => ({
      id: "evt_dup_" + suffix,
      familyId: "maintenance",
      taxonomy: "SIGNAL",
      eligibility: [],
      presentation: { title: "t", body: "b" },
      choices: [{ id: "c", label: "c", effects: [memoryRecord({ characterId: i === 0 ? "mara_001" : "tarek_001", memoryId: "fact_dup", exposure: "secret" })], disclosure: { risks: [], unknowns: [] } }]
    }));
    const first = resolveProofChoice(proof(), events, "evt_dup_a", "c").state;
    const snapshot = structuredClone(first);
    expect(() => resolveProofChoice(first, events, "evt_dup_b", "c")).toThrow(/Fact 'fact_dup' is already recorded/);
    expect(first).toEqual(snapshot);
  });

  it("holds on every world the proof itself produces", () => {
    const state = proof();
    applyEventEffect(state, memoryRecord({ characterId: "mara_001", memoryId: "fact_y", exposure: "public", behaviorHook: "call_in_debt", subjectId: "faction_front" }), [], CONTEXT);
    expect(validateSystemicWorldState(state)).toEqual({ ok: true, errors: [] });
  });
});
