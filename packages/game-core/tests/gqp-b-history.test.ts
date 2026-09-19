import { describe, expect, it } from "vitest";
import type { ProofEvent } from "@paa/game-types";
import {
  applyDueConsequences,
  createSystemicScenario,
  describeProofChoice,
  eligibleProofEvents,
  resolveChoice,
  resolveProofChoice,
  runWorldTick,
  validateSystemicWorldState
} from "../src";
import {
  SYNTHETIC_CATALOGUE as CATALOGUE,
  proofWorld as proof,
  resolvedHistory as history
} from "./support/synthetic-proof-catalogue";

/**
 * Proof resolution and resolved-decision history (GQP spec 12.3).
 *
 * The contract: exactly one history entry per resolved decision, stamped with
 * the Player Turn it came from and the World Tick it happened in, and nothing
 * at all for anything short of a resolution. The resolver is atomic, its last
 * step included, and schedules through the one real scheduler.
 */

describe("GQP-B history: one resolved decision, one entry", () => {
  it("appends exactly one entry with family, ids and pre-increment turn", () => {
    const state = proof();
    const resolved = resolveProofChoice(state, CATALOGUE, "evt_t_maint", "repair");

    expect(history(resolved.state)).toEqual([
      { familyId: "maintenance", eventId: "evt_t_maint", choiceId: "repair", playerTurn: 1, worldTick: 0 }
    ]);
    expect(resolved.entry.playerTurn).toBe(state.turn);
    expect(resolved.state.turn).toBe(state.turn + 1);
    // The same turn the delta reports, per spec 12.3 rule 3.
    expect(resolved.delta.turn).toBe(resolved.entry.playerTurn);
    expect(validateSystemicWorldState(resolved.state).ok).toBe(true);
  });

  it("records the World Tick during which the decision happened", () => {
    let state = proof();
    state = runWorldTick(runWorldTick(state).state).state;
    const resolved = resolveProofChoice(state, CATALOGUE, "evt_t_maint", "repair");
    expect(resolved.entry.worldTick).toBe(2);
    // A choice does not advance the tick.
    expect(resolved.state.simulation!.tick).toBe(2);
  });

  it("stamps every effect of the decision with the decision as its cause", () => {
    const resolved = resolveProofChoice(proof(), CATALOGUE, "evt_t_maint", "defer");
    const memory = resolved.state.party.find(c => c.id === "tarek_001")!.memories!.find(m => m.id === "fact_t_warning")!;
    expect(memory.source).toEqual({ kind: "choice", id: "evt_t_maint:defer", rule: "maintenance" });
    expect(memory.turn).toBe(1);
  });

  it("writes nothing when events are listed, described or asked about", () => {
    const state = proof();
    const snapshot = structuredClone(state);
    for (let i = 0; i < 5; i += 1) {
      const eligible = eligibleProofEvents(state, CATALOGUE);
      for (const event of eligible) for (const choice of event.choices) describeProofChoice(choice);
    }
    expect(state).toEqual(snapshot);
    expect(history(state)).toEqual([]);
  });

  it("writes nothing on a World Tick with no decision", () => {
    const ticked = runWorldTick(proof()).state;
    expect(history(ticked)).toEqual([]);
    expect(ticked.turn).toBe(1);
  });

  it.each([
    ["an unknown event", "evt_nothing", "repair", /Unknown proof event/],
    ["an unknown choice", "evt_t_maint", "pray", /has no choice 'pray'/],
    ["an ineligible event", "evt_t_signal", "inspect", /not eligible now/]
  ])("refuses %s and leaves the world and the history untouched", (_label, eventId, choiceId, pattern) => {
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, CATALOGUE, eventId, choiceId)).toThrow(pattern);
    expect(state).toEqual(snapshot);
    expect(history(state)).toEqual([]);
  });

  it("refuses a choice the settlement cannot pay for", () => {
    const state = proof();
    state.simulation!.settlements[0]!.resourceStock.energy = 4;
    state.resources.energy = 4;
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, CATALOGUE, "evt_t_maint", "repair")).toThrow(/not available now/);
    expect(state).toEqual(snapshot);
  });

  it("refuses a baseline world outright", () => {
    const baseline = createSystemicScenario(7419);
    expect(() => resolveProofChoice(baseline, CATALOGUE, "evt_t_maint", "repair")).toThrow(/schema-v2 proof world/);
    // The world is judged before the catalogue is read: an empty or unrelated
    // catalogue does not turn a version refusal into an unknown-event one.
    expect(() => resolveProofChoice(baseline, [], "evt_t_maint", "repair")).toThrow(/schema-v2 proof world/);
  });

  it("cannot write the same decision twice: a resolved event is no longer eligible", () => {
    const once = resolveProofChoice(proof(), CATALOGUE, "evt_t_maint", "repair").state;
    expect(() => resolveProofChoice(once, CATALOGUE, "evt_t_maint", "repair")).toThrow(/not eligible now/);
    expect(() => resolveProofChoice(once, CATALOGUE, "evt_t_maint", "defer")).toThrow(/not eligible now/);
    expect(history(once)).toHaveLength(1);
  });

  it("keeps turns strictly increasing across a run", () => {
    const first = resolveProofChoice(proof(), CATALOGUE, "evt_t_maint", "defer").state;
    const second = resolveProofChoice(first, CATALOGUE, "evt_t_signal", "inspect").state;
    expect((history(second) as Array<{ playerTurn: number }>).map(e => e.playerTurn)).toEqual([1, 2]);
    expect(validateSystemicWorldState(second).ok).toBe(true);
  });
});

describe("GQP-B history: the M1 resolver writes none, and cannot carry proof effects", () => {
  it("leaves a baseline world without any proof history", () => {
    const resolved = resolveChoice(
      createSystemicScenario(7419),
      { id: "m1", label: "M1", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
      "test"
    );
    expect(Object.hasOwn(resolved.state.simulation!, "resolvedHistory")).toBe(false);
    expect(resolved.state.turn).toBe(2);
  });

  it("refuses a proof effect even on a proof world, so history cannot be bypassed", () => {
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() =>
      resolveChoice(
        state,
        { id: "sneak", label: "S", effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.2 }] },
        "test"
      )
    ).toThrow(/resolve through resolveProofChoice/);
    expect(state).toEqual(snapshot);
  });
});

describe("GQP-B resolution is atomic, the last step included", () => {
  type Choice = ProofEvent["choices"][number];

  function withChoice(effects: Choice["effects"], schedules?: Choice["schedules"]): ProofEvent[] {
    return [
      {
        ...CATALOGUE[0]!,
        choices: [
          {
            id: "repair",
            label: "Repair",
            effects,
            ...(schedules ? { schedules } : {}),
            disclosure: { risks: ["supply", "infrastructure"], unknowns: ["x"] }
          },
          CATALOGUE[0]!.choices[1]!
        ]
      }
    ];
  }

  it("refuses a decision whose final effect is impossible, with nothing applied", () => {
    const broken = withChoice([
      { type: "RESOURCE_DELTA", key: "energy", value: -10 },
      { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.2 },
      { type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: 0.1 }
    ]);
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, broken, "evt_t_maint", "repair")).toThrow(/prod_ghost/);
    expect(state).toEqual(snapshot);
  });

  it("refuses a decision whose schedule collides after its effects applied, with nothing applied", () => {
    const state = proof();
    // A consequence with the id this choice will derive is already pending.
    state.simulation!.delayedConsequences.push({
      id: "con.evt_t_maint.defer.wear",
      triggerTurn: 9,
      visibility: "hidden",
      scope: "settlement",
      effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.1 }],
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "seed" }
    });
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, CATALOGUE, "evt_t_maint", "defer")).toThrow(/already exists/);
    expect(state).toEqual(snapshot);
  });

  it("refuses at the final gate a schedule the save would reject, with nothing applied", () => {
    // Shape-valid, so it passes the scheduler; it names a node that does not
    // exist, which only the persistence boundary checks. Without the final
    // gate the resolver would return a world that cannot be saved.
    const broken = withChoice(
      [{ type: "RESOURCE_DELTA", key: "energy", value: -10 }],
      [
        {
          key: "ghost",
          delay: 1,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: -0.1 }],
          breadcrumb: { memoryId: "fact_t_warning" }
        }
      ]
    );
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, broken, "evt_t_maint", "repair")).toThrow(/would produce an invalid world.*prod_ghost/);
    expect(state).toEqual(snapshot);
  });

  it.each([
    ["a zero delay", { delay: 0 }, /positive whole delay/],
    ["a fractional delay", { delay: 1.5 }, /positive whole delay/],
    ["a delay past the safe integers", { delay: 2 ** 53 }, /positive whole delay/],
    [
      "a malformed delayed effect",
      { effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: Number.NaN }] },
      /Refused schedule 'wear'/
    ]
  ])("refuses a schedule with %s, with nothing applied", (_label, patch, pattern) => {
    const planned = { ...CATALOGUE[0]!.choices[1]!.schedules![0]!, ...patch } as never;
    const broken = withChoice([{ type: "RESOURCE_DELTA", key: "energy", value: -10 }], [planned]);
    const state = proof();
    const snapshot = structuredClone(state);
    expect(() => resolveProofChoice(state, broken, "evt_t_maint", "repair")).toThrow(pattern);
    expect(state).toEqual(snapshot);
  });
});

describe("GQP-B scheduling goes through the one real scheduler", () => {
  it("derives the id, the trigger turn and the cause, and fires after the next decision", () => {
    const deferred = resolveProofChoice(proof(), CATALOGUE, "evt_t_maint", "defer");
    const consequence = deferred.state.simulation!.delayedConsequences.find(c => c.id === "con.evt_t_maint.defer.wear");
    // Decided at turn 1, delay 1: due after the next decision, at turn 3.
    expect(consequence).toMatchObject({
      triggerTurn: 3,
      status: "pending",
      reversible: false,
      source: { kind: "choice", id: "evt_t_maint:defer", rule: "maintenance" }
    });
    expect(
      deferred.delta.changes.some(c => c.type === "delayedConsequenceScheduled" && c.key === "con.evt_t_maint.defer.wear")
    ).toBe(true);

    // Not yet: the world is at turn 2.
    const early = applyDueConsequences(deferred.state);
    expect(early.appliedIds).toEqual([]);

    const next = resolveProofChoice(early.state, CATALOGUE, "evt_t_signal", "inspect");
    const due = applyDueConsequences(next.state);
    expect(due.appliedIds).toEqual(["con.evt_t_maint.defer.wear"]);
    expect(due.state.simulation!.productionNodes[0]!.condition).toBe(0.53);
  });
});
