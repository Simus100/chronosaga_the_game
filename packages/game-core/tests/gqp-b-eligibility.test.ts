import { describe, expect, it } from "vitest";
import type { ProofChoice, ProofPredicate, WorldState } from "@paa/game-types";
import {
  createSystemicScenario,
  describeProofChoice,
  eligibleProofEvents,
  evaluateProofPredicate,
  isProofChoiceAvailable,
  resolveProofChoice
} from "../src";
import { SYNTHETIC_CATALOGUE as CATALOGUE, proofWorld as proof } from "./support/synthetic-proof-catalogue";

/**
 * Proof eligibility (GQP-B, not GQP-C selection).
 *
 * Which events the state makes available, and which options can be taken: a
 * pure, deterministic, order-independent read of authoritative state. Every
 * predicate reads a typed field; none reads prose, tags or a role label.
 */

function holds(predicate: ProofPredicate, state: WorldState = proof()): boolean {
  return evaluateProofPredicate(predicate, state);
}

function tarekMemory(state: WorldState, patch: Record<string, unknown>): WorldState {
  const tarek = state.party.find(c => c.id === "tarek_001")!;
  tarek.memories = [
    ...(tarek.memories ?? []),
    {
      id: "fact_probe",
      summary: "probe",
      valence: "negative",
      turn: 1,
      tags: [],
      subjectId: "faction_front",
      salience: 0.8,
      origin: "direct",
      behaviorHook: "offer_unprompted_warning",
      callbackEligible: true,
      source: { kind: "system", id: "probe" },
      ...patch
    } as never
  ];
  return state;
}

describe("GQP-B predicates read typed state", () => {
  it("reads node condition strictly below, and an absent node as not degraded", () => {
    expect(holds({ predicate: "node_condition_below", nodeId: "prod_recycler_01", value: 0.74 })).toBe(true);
    expect(holds({ predicate: "node_condition_below", nodeId: "prod_recycler_01", value: 0.73 })).toBe(false);
    expect(holds({ predicate: "node_condition_below", nodeId: "prod_ghost", value: 1 })).toBe(false);
  });

  it("reads an own flag, and never the prototype chain", () => {
    const state = proof();
    state.flags.conduit_registered = true;
    expect(holds({ predicate: "flag_equals", key: "conduit_registered", value: true }, state)).toBe(true);
    expect(holds({ predicate: "flag_equals", key: "never_set", value: false }, state)).toBe(true);
    // Absent reads as false, including names that exist on Object.prototype.
    expect(holds({ predicate: "flag_equals", key: "toString", value: false }, state)).toBe(true);
    expect(holds({ predicate: "flag_equals", key: "__proto__", value: false }, state)).toBe(true);
    // A non-boolean flag equals neither boolean.
    state.flags.count = 1;
    expect(holds({ predicate: "flag_equals", key: "count", value: true }, state)).toBe(false);
  });

  it("reads a behaviour hook only from a direct memory, and only for the named subject", () => {
    const direct = tarekMemory(proof(), {});
    const hook = { predicate: "memory_hook_present", characterId: "tarek_001", hook: "offer_unprompted_warning", value: true } as const;
    expect(holds(hook, direct)).toBe(true);
    expect(holds({ ...hook, subjectId: "faction_front" }, direct)).toBe(true);
    expect(holds({ ...hook, subjectId: "faction_compact" }, direct)).toBe(false);
    expect(holds({ ...hook, value: false }, direct)).toBe(false);
    // Second-hand knowledge does not drive behaviour.
    expect(holds(hook, tarekMemory(proof(), { origin: "reflected" }))).toBe(false);
    expect(holds(hook, tarekMemory(proof(), { origin: undefined }))).toBe(false);
    // Someone else's memory is not Tarek's.
    expect(holds({ ...hook, characterId: "mara_001" }, direct)).toBe(false);
  });

  it("knows a memory by id, whatever its origin", () => {
    const state = tarekMemory(proof(), { origin: "reflected", behaviorHook: undefined });
    expect(holds({ predicate: "memory_known", characterId: "tarek_001", memoryId: "fact_probe", value: true }, state)).toBe(true);
    expect(holds({ predicate: "memory_known", characterId: "mara_001", memoryId: "fact_probe", value: false }, state)).toBe(true);
  });

  it("reads an agenda item through its own typed condition", () => {
    const state = proof();
    const reliability = { predicate: "agenda_satisfied", agendaId: "agenda_co_reliability", value: true } as const;
    expect(holds(reliability, state)).toBe(false);
    state.simulation!.productionNodes[0]!.condition = 0.8;
    expect(holds(reliability, state)).toBe(true);
    expect(holds({ predicate: "agenda_satisfied", agendaId: "agenda_nothing", value: false }, state)).toBe(false);
  });

  it("reads a consequence as absent, pending or applied", () => {
    const state = proof();
    const status = (s: "pending" | "applied" | "absent") =>
      holds({ predicate: "consequence_status", consequenceId: "con.x", status: s }, state);
    expect([status("absent"), status("pending"), status("applied")]).toEqual([true, false, false]);
    state.simulation!.delayedConsequences.push({
      id: "con.x", triggerTurn: 5, visibility: "hidden", scope: "settlement",
      effects: [{ type: "PRESSURE_DELTA", value: 1 }], reversible: false, status: "pending",
      source: { kind: "system", id: "probe" }
    });
    expect([status("absent"), status("pending"), status("applied")]).toEqual([false, true, false]);
    state.simulation!.delayedConsequences.find(c => c.id === "con.x")!.status = "applied";
    expect([status("absent"), status("pending"), status("applied")]).toEqual([false, false, true]);
  });

  it("derives both pressure stages, and refuses to guess an unknown settlement", () => {
    const state = proof();
    expect(holds({ predicate: "epidemic_stage_in", stages: ["STABLE"] }, state)).toBe(true);
    expect(holds({ predicate: "epidemic_stage_in", stages: ["STRAINED", "CRITICAL"] }, state)).toBe(false);
    const settlementId = state.simulation!.settlements[0]!.id;
    expect(holds({ predicate: "infrastructure_stage_in", settlementId, stages: ["CRITICAL"] }, state)).toBe(true);
    // A settlement with no nodes would derive some stage; an unknown one has none.
    expect(
      holds({ predicate: "infrastructure_stage_in", settlementId: "settlement_ghost", stages: ["STABLE", "STRAINED", "CRITICAL", "CRISIS"] }, state)
    ).toBe(false);
  });

  it("refuses a predicate it does not know, instead of reading it as false", () => {
    const hostile = { predicate: "reputation_at_least", value: 3 } as unknown as ProofPredicate;
    expect(() => holds(hostile)).toThrow(/Unknown proof predicate "reputation_at_least"/);
    const event = { ...CATALOGUE[0]!, eligibility: [hostile] };
    expect(() => eligibleProofEvents(proof(), [event])).toThrow(/Unknown proof predicate/);
  });

  it("refuses to describe an effect it does not know", () => {
    const hostile = { ...CATALOGUE[0]!.choices[0]!, effects: [{ type: "REPUTATION_SET", value: 1 }] } as unknown as ProofChoice;
    expect(() => describeProofChoice(hostile, proof())).toThrow(/Cannot describe effect type "REPUTATION_SET"/);
  });

  it("refuses to evaluate against a baseline world", () => {
    expect(() => evaluateProofPredicate({ predicate: "flag_equals", key: "x", value: true }, createSystemicScenario(7419))).toThrow(/schema-v2/);
    expect(() => eligibleProofEvents(createSystemicScenario(7419), CATALOGUE)).toThrow(/schema-v2/);
  });
});

describe("GQP-B option availability", () => {
  const gated: ProofChoice = {
    id: "gated",
    label: "Gated",
    availability: [{ predicate: "flag_equals", key: "front_access_granted", value: true }],
    effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -2 }],
    disclosure: { risks: ["supply"], unknowns: ["x"] }
  };

  it("closes an option whose authored availability does not hold", () => {
    const state = proof();
    expect(isProofChoiceAvailable(gated, state)).toBe(false);
    state.flags.front_access_granted = true;
    expect(isProofChoiceAvailable(gated, state)).toBe(true);
  });

  it("derives affordability from the effects, summing costs on one resource", () => {
    const state = proof();
    const stock = state.simulation!.settlements[0]!.resourceStock.energy!;
    const exact: ProofChoice = { ...gated, availability: [], effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -stock }] };
    expect(isProofChoiceAvailable(exact, state)).toBe(true);
    const split: ProofChoice = {
      ...exact,
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -stock },
        { type: "RESOURCE_DELTA", key: "energy", value: -1 }
      ]
    };
    expect(isProofChoiceAvailable(split, state)).toBe(false);
    // A gain is never a cost.
    const gain: ProofChoice = { ...exact, effects: [{ type: "RESOURCE_DELTA", key: "energy", value: 1000 }] };
    expect(isProofChoiceAvailable(gain, state)).toBe(true);
  });
});

describe("GQP-B eligibility is pure, stable and order-independent", () => {
  it("is one-shot per event id", () => {
    const state = proof();
    expect(eligibleProofEvents(state, CATALOGUE).map(e => e.id)).toEqual(["evt_t_maint"]);
    const after = resolveProofChoice(state, CATALOGUE, "evt_t_maint", "defer").state;
    expect(eligibleProofEvents(after, CATALOGUE).map(e => e.id)).toEqual(["evt_t_signal"]);
  });

  it("returns the same set in the same order however the catalogue is assembled", () => {
    const state = proof();
    state.simulation!.productionNodes[0]!.condition = 0.5;
    const both: typeof CATALOGUE = [
      CATALOGUE[0]!,
      { ...CATALOGUE[0]!, id: "evt_a_first", eligibility: [] },
      { ...CATALOGUE[0]!, id: "evt_Z_upper", eligibility: [] }
    ];
    const ids = (catalogue: typeof CATALOGUE) => eligibleProofEvents(state, catalogue).map(e => e.id);
    // Code-unit order: uppercase before lowercase, never locale collation.
    expect(ids(both)).toEqual(["evt_Z_upper", "evt_a_first", "evt_t_maint"]);
    expect(ids([...both].reverse())).toEqual(ids(both));
    expect(ids([both[1]!, both[2]!, both[0]!])).toEqual(ids(both));
  });

  it("refuses a catalogue with a duplicated event id", () => {
    expect(() => eligibleProofEvents(proof(), [...CATALOGUE, CATALOGUE[0]!])).toThrow(/Duplicate proof event id/);
  });

  it("never writes to the world or the catalogue it reads", () => {
    const state = proof();
    const snapshot = structuredClone(state);
    const catalogue = structuredClone(CATALOGUE);
    eligibleProofEvents(state, catalogue);
    for (const event of catalogue) for (const choice of event.choices) isProofChoiceAvailable(choice, state);
    expect(state).toEqual(snapshot);
    expect(catalogue).toEqual(CATALOGUE);
  });
});

describe("GQP-B disclosure is derived where it can be", () => {
  it("derives KNOWN from the effects applied to the current world, so shown costs are charged costs", () => {
    const described = describeProofChoice(CATALOGUE[0]!.choices[0]!, proof());
    expect(described.available).toBe(true);
    expect(described.known).toEqual([
      { kind: "resource", key: "energy", before: 42, after: 32, delta: -10 },
      { kind: "node_condition", nodeId: "prod_recycler_01", before: 0.73, after: 0.93, delta: 0.2 }
    ]);
    expect(described.risks).toEqual(["supply"]);
    expect(described.unknowns).toEqual(["how long it holds"]);
  });

  it("never shows what a delayed consequence will do, only that there is a risk", () => {
    const described = describeProofChoice(CATALOGUE[0]!.choices[1]!, proof());
    expect(described.known!.map(k => k.kind)).toEqual(["memory"]);
    expect(JSON.stringify(described)).not.toContain("-0.2");
    expect(described.risks).toEqual(["infrastructure", "social"]);
  });
});

describe("An option that would publish the impossible is closed, not an error (P2-4)", () => {
  const publishing: ProofChoice = {
    id: "disclose",
    label: "Disclose",
    effects: [{ type: "MEMORY_PUBLISH", characterId: "tarek_001", memoryId: "fact_t_warning" }],
    disclosure: { risks: ["political"], unknowns: ["x"] }
  };

  it("opens only when the named holder holds the fact first-hand and it is not yet public", () => {
    const before = proof();
    expect(isProofChoiceAvailable(publishing, before)).toBe(false);
    const recorded = resolveProofChoice(before, CATALOGUE, "evt_t_maint", "defer").state;
    expect(isProofChoiceAvailable(publishing, recorded)).toBe(true);
    // Mara holds it too -- reflected. Naming her keeps the option closed.
    expect(isProofChoiceAvailable({ ...publishing, effects: [{ type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_t_warning" }] }, recorded)).toBe(false);
    const published = structuredClone(recorded);
    published.simulation!.factions[0]!.memoryTags.push("aware:fact_t_warning");
    expect(isProofChoiceAvailable(publishing, published)).toBe(false);
  });
});

describe("KNOWN is the transition the Core makes, not the delta the content asks for (P2-6)", () => {
  const only = (effects: ProofChoice["effects"]): ProofChoice => ({
    id: "probe",
    label: "probe",
    effects,
    disclosure: { risks: ["supply"], unknowns: ["x"] }
  });

  it("shows a node's saturation: 0.79 + 0.22 is +0.21, to 1", () => {
    const state = proof();
    state.simulation!.productionNodes[0]!.condition = 0.79;
    const [item] = describeProofChoice(only([{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.22 }]), state).known!;
    expect(item).toEqual({ kind: "node_condition", nodeId: "prod_recycler_01", before: 0.79, after: 1, delta: 0.21 });
  });

  it("shows an epidemic cause's floor: -0.12 on a cause at 0 changes nothing", () => {
    const [item] = describeProofChoice(only([{ type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.12 }]), proof()).known!;
    expect(item).toEqual({ kind: "epidemic", cause: "deferred_triage", before: 0, after: 0, delta: 0 });
  });

  it("shows an epidemic cause's ceiling: the room the other causes leave", () => {
    const state = proof();
    const epidemic = (state.simulation as unknown as { epidemic: { value: number; contributors: { cause: string; magnitude: number }[] } }).epidemic;
    epidemic.contributors.find(c => c.cause === "water_shortage")!.magnitude = 0.89;
    epidemic.value = 0.95;
    const [item] = describeProofChoice(only([{ type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1 }]), state).known!;
    expect(item).toEqual({ kind: "epidemic", cause: "crowding", before: 0.06, after: 0.11, delta: 0.05 });
  });

  it("shows stress clamped at 100: 95 + 10 is +5", () => {
    const state = proof();
    state.party.find(c => c.id === "tarek_001")!.stress = 95;
    const [item] = describeProofChoice(only([{ type: "CHARACTER_STRESS", targetId: "tarek_001", value: 10 }]), state).known!;
    expect(item).toEqual({ kind: "stress", characterId: "tarek_001", before: 95, after: 100, delta: 5 });
  });

  it("shows a resource cost exactly, and several on one stock in order", () => {
    const [first, second] = describeProofChoice(
      only([{ type: "RESOURCE_DELTA", key: "energy", value: -10 }, { type: "RESOURCE_DELTA", key: "energy", value: -5 }]),
      proof()
    ).known!;
    expect(first).toEqual({ kind: "resource", key: "energy", before: 42, after: 32, delta: -10 });
    expect(second).toEqual({ kind: "resource", key: "energy", before: 32, after: 27, delta: -5 });
  });

  it("shows who a fact will reach, which is how a secret shows it stays secret", () => {
    const secret = describeProofChoice(CATALOGUE[0]!.choices[1]!, proof()).known![0]!;
    expect(secret).toMatchObject({ kind: "memory", memoryId: "fact_t_warning", reach: ["mara_001", "tarek_001"] });
  });

  it("has no KNOWN for an option that cannot be taken, only the reason", () => {
    const state = proof();
    state.simulation!.settlements[0]!.resourceStock.energy = 4;
    state.resources.energy = 4;
    expect(describeProofChoice(CATALOGUE[0]!.choices[0]!, state)).toMatchObject({ available: false, refusal: "not available now", known: null });
  });

  it("never touches the world it previews", () => {
    const state = proof();
    const snapshot = structuredClone(state);
    for (const choice of CATALOGUE[0]!.choices) describeProofChoice(choice, state);
    expect(state).toEqual(snapshot);
  });
});
