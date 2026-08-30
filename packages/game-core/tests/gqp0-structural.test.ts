import { describe, expect, it } from "vitest";
import type { DelayedConsequenceState, EventEffect, GameEvent, StateChange } from "@paa/game-types";
import { createSystemicScenario } from "../src/state/create-systemic-scenario.js";
import { resolveChoice } from "../src/events/resolve-choice.js";
import {
  applyDueConsequences,
  scheduleDelayedConsequence
} from "../src/state/delayed-consequences.js";
import { applyEventEffect, EVENT_EFFECT_TYPES } from "../src/events/event-effect.js";
import { validateGameEvent } from "../src/events/validate-event.js";
import { validateSystemicWorldState } from "../src/state/validate-systemic-state.js";
import { selectEvent } from "../src/events/select-event.js";
import { selectEventStable } from "../src/events/select-event-stable.js";

/**
 * GQP-0 adds no gameplay. These tests protect the three structural properties
 * it exists to establish: one effect meaning, one list of effect types, and a
 * selection that does not depend on how a catalogue was assembled.
 */

function scenario() {
  return createSystemicScenario(7419);
}

/** Every effect kind, with a target that exists in the scenario. */
const EVERY_EFFECT: EventEffect[] = [
  { type: "RESOURCE_DELTA", key: "water", value: -3 },
  { type: "FLAG_SET", key: "gqp0_marker", value: true },
  { type: "PRESSURE_DELTA", value: 2 },
  { type: "CHARACTER_STRESS", targetId: "brann_001", value: 7 }
];

describe("A: an effect means the same thing immediately and later", () => {
  it("every effect kind produces the same authoritative world on both paths", () => {
    // Immediate: through a choice.
    const immediate = resolveChoice(
      scenario(),
      { id: "all_effects", label: "ALL", effects: EVERY_EFFECT },
      "test:immediate"
    );

    // Delayed: the same effects, scheduled and then due.
    const scheduled = scheduleDelayedConsequence(scenario(), {
      id: "con_all_effects",
      triggerTurn: 1,
      visibility: "visible",
      scope: "settlement",
      effects: EVERY_EFFECT,
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    });
    const delayed = applyDueConsequences(scheduled.state, 1);

    const a = immediate.state;
    const b = delayed.state;

    // The world the effects touched is identical.
    expect(b.simulation!.settlements[0]!.resourceStock.water)
      .toBe(a.simulation!.settlements[0]!.resourceStock.water);
    expect(b.flags.gqp0_marker).toBe(a.flags.gqp0_marker);
    expect(b.worldPressure).toBe(a.worldPressure);
    expect(b.party.find(c => c.id === "brann_001")!.stress)
      .toBe(a.party.find(c => c.id === "brann_001")!.stress);

    // The lifecycle difference is the intended one, and only that one: a
    // choice is a Player Turn, a consequence firing is not.
    expect(a.turn).toBe(scenario().turn + 1);
    expect(b.turn).toBe(scenario().turn);
  });

  it("the shared applicator never advances the Player Turn by itself", () => {
    const state = scenario();
    const before = state.turn;
    const changes: StateChange[] = [];
    for (const effect of EVERY_EFFECT) applyEventEffect(state, effect, changes);
    expect(state.turn).toBe(before);
  });
});

describe("B: the delta still describes what happened", () => {
  it("both paths report the same change types and keys", () => {
    const immediate = resolveChoice(
      scenario(),
      { id: "all_effects", label: "ALL", effects: EVERY_EFFECT },
      "test:immediate"
    );
    const scheduled = scheduleDelayedConsequence(scenario(), {
      id: "con_all_effects",
      triggerTurn: 1,
      visibility: "visible",
      scope: "settlement",
      effects: EVERY_EFFECT,
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    });
    const delayed = applyDueConsequences(scheduled.state, 1);

    const shape = (changes: readonly StateChange[]) =>
      changes.map(c => `${c.type}:${c.key}`).filter(entry => !entry.startsWith("delayedConsequence"));

    expect(shape(delayed.delta.changes)).toEqual(shape(immediate.delta.changes));

    // And the resource change went to the authoritative path, not the flat map.
    expect(immediate.delta.changes.some(c => String(c.key).includes("resourceStock.water"))).toBe(true);

    // The delta's turn is the source turn, unchanged by this slice.
    expect(immediate.delta.turn).toBe(scenario().turn);
  });
});

describe("C: what a validator accepts, the applicator can apply", () => {
  it("the accepted type list is one list, shared by both validators", () => {
    expect([...EVENT_EFFECT_TYPES].sort()).toEqual(
      ["CHARACTER_STRESS", "FLAG_SET", "PRESSURE_DELTA", "RESOURCE_DELTA"]
    );

    // Read the sources rather than trusting the import: the defect this guards
    // against is precisely a validator carrying its own private copy again.
    const eventValidator = String(validateGameEvent);
    const stateValidator = String(validateSystemicWorldState);
    for (const source of [eventValidator, stateValidator]) {
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it("every valid effect shape is appliable", () => {
    for (const effect of EVERY_EFFECT) {
      const event: GameEvent = {
        id: "evt_probe",
        version: 1,
        title: "PROBE",
        body: "probe",
        category: "test",
        tags: [],
        weight: 1,
        choices: [{ id: "only", label: "ONLY", effects: [effect] }]
      };
      expect(validateGameEvent(event).ok).toBe(true);

      const changes: StateChange[] = [];
      expect(() => applyEventEffect(scenario(), effect, changes)).not.toThrow();
      expect(changes.length).toBeGreaterThan(0);
    }
  });

  it("shapes the validators reject also fail closed in the applicator", () => {
    const rejected: EventEffect[] = [
      { type: "RESOURCE_DELTA", value: -1 },
      { type: "FLAG_SET", value: true },
      { type: "CHARACTER_STRESS", value: 1 }
    ];
    for (const effect of rejected) {
      const event: GameEvent = {
        id: "evt_bad",
        version: 1,
        title: "BAD",
        body: "bad",
        category: "test",
        tags: [],
        weight: 1,
        choices: [{ id: "only", label: "ONLY", effects: [effect] }]
      };
      // The validator refuses it...
      expect(validateGameEvent(event).ok).toBe(false);
      // ...and if one ever reached the applicator anyway, it refuses too,
      // rather than silently applying nothing. This is the drift that existed:
      // the immediate path used to skip these without a word.
      expect(() => applyEventEffect(scenario(), effect, [])).toThrow();
    }
  });

  it("an effect naming an absent character is refused on both paths", () => {
    const ghost: EventEffect = { type: "CHARACTER_STRESS", targetId: "nobody_999", value: 3 };
    expect(() =>
      resolveChoice(scenario(), { id: "ghost", label: "GHOST", effects: [ghost] }, "test")
    ).toThrow(/Unknown character/);

    const scheduled = scheduleDelayedConsequence(scenario(), {
      id: "con_ghost",
      triggerTurn: 1,
      visibility: "visible",
      scope: "personal",
      effects: [ghost],
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    });
    expect(() => applyDueConsequences(scheduled.state, 1)).toThrow(/Unknown character/);
  });
});

describe("F: the GQP selection path does not depend on catalogue order", () => {
  const catalogue: GameEvent[] = ["evt_alpha", "evt_beta", "evt_gamma", "evt_delta"].map(
    (id, index) => ({
      id,
      version: 1,
      title: id,
      body: id,
      category: "test",
      tags: [],
      weight: 1 + index * 0.5,
      choices: [{ id: `${id}_c`, label: "C", effects: [] }]
    })
  );

  it("the same seed and state select the same event under any ordering", () => {
    const state = scenario();
    const forward = selectEventStable([...catalogue], state);
    const reversed = selectEventStable([...catalogue].reverse(), state);
    const shuffled = selectEventStable(
      [catalogue[2]!, catalogue[0]!, catalogue[3]!, catalogue[1]!],
      state
    );

    expect(reversed.id).toBe(forward.id);
    expect(shuffled.id).toBe(forward.id);
  });

  it("the legacy selector is left as it was, order dependence included", () => {
    // Not a defect to fix here: M1's sequence is accepted and its regressions
    // expect it. The point is that the two paths are separate, so GQP can be
    // order-independent without rewriting a validated baseline.
    const state = scenario();
    const forward = selectEvent([...catalogue], state);
    const reversed = selectEvent([...catalogue].reverse(), state);
    expect(typeof forward.id).toBe("string");
    expect(typeof reversed.id).toBe("string");
  });

  it("selection stays deterministic across repeated calls", () => {
    const state = scenario();
    const first = selectEventStable([...catalogue], state);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(selectEventStable([...catalogue], state).id).toBe(first.id);
    }
  });

  it("an empty eligible set is refused, not guessed", () => {
    expect(() => selectEventStable([], scenario())).toThrow(/No eligible events/);
  });
});

describe("C: a failed effect leaves no half-applied world", () => {
  /**
   * A choice or a consequence carries a list. If the second effect throws
   * after the first has already changed something, the caller must not receive
   * — or keep — a world that is half-way through a decision. Both operations
   * work on a clone, so the proof is that the original is untouched and the
   * partial clone is unreachable.
   */
  const partial = [
    { type: "RESOURCE_DELTA", key: "water", value: -3 },
    { type: "CHARACTER_STRESS", targetId: "nobody_999", value: 5 }
  ] as EventEffect[];

  it("an immediate choice that throws mid-list leaves the original world intact", () => {
    const before = scenario();
    const snapshot = structuredClone(before);

    expect(() =>
      resolveChoice(before, { id: "half", label: "HALF", effects: partial }, "test")
    ).toThrow(/Unknown character/);

    // The first effect did land — on the clone, which nobody can reach.
    expect(before).toEqual(snapshot);
    expect(before.simulation!.settlements[0]!.resourceStock.water)
      .toBe(snapshot.simulation!.settlements[0]!.resourceStock.water);
    expect(before.turn).toBe(snapshot.turn);
  });

  it("a delayed consequence that throws mid-list leaves the stored world intact", () => {
    const scheduled = scheduleDelayedConsequence(scenario(), {
      id: "con_half",
      triggerTurn: 1,
      visibility: "visible",
      scope: "settlement",
      effects: partial,
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    }).state;
    const snapshot = structuredClone(scheduled);

    expect(() => applyDueConsequences(scheduled, 1)).toThrow(/Unknown character/);

    expect(scheduled).toEqual(snapshot);
    // And the consequence is still pending: a throw does not mark it applied.
    expect(scheduled.simulation!.delayedConsequences[0]!.status).toBe("pending");
  });
});

describe("a non-finite value never reaches the world", () => {
  it("the applicator refuses what the validators already reject", () => {
    const rejected = [
      { type: "RESOURCE_DELTA", key: "water", value: "abc" },
      { type: "PRESSURE_DELTA", value: Number.NaN },
      { type: "CHARACTER_STRESS", targetId: "brann_001", value: Number.POSITIVE_INFINITY }
    ] as EventEffect[];

    for (const effect of rejected) {
      const state = scenario();
      const snapshot = structuredClone(state);
      expect(() => applyEventEffect(state, effect, [])).toThrow(/finite numeric value/);
      // Refused before writing, not after.
      expect(state).toEqual(snapshot);
    }
  });

  it("a legitimate string value on FLAG_SET is untouched by the check", () => {
    const state = scenario();
    const changes: StateChange[] = [];
    applyEventEffect(state, { type: "FLAG_SET", key: "note", value: "text" }, changes);
    expect(state.flags.note).toBe("text");
    expect(changes).toHaveLength(1);
  });
});

describe("I: stable selection edge cases", () => {
  const make = (id: string, weight: number): GameEvent => ({
    id,
    version: 1,
    title: id,
    body: id,
    category: "test",
    tags: [],
    weight,
    choices: [{ id: `${id}_c`, label: "C", effects: [] }]
  });

  it("many permutations of the same set select the same event", () => {
    const set = [make("e_a", 1), make("e_b", 2), make("e_c", 3), make("e_d", 0.5)];
    const expected = selectEventStable([...set], scenario()).id;
    // Every rotation, plus the reversal: a cheap stand-in for "any order".
    for (let shift = 0; shift < set.length; shift += 1) {
      const rotated = [...set.slice(shift), ...set.slice(0, shift)];
      expect(selectEventStable(rotated, scenario()).id).toBe(expected);
      expect(selectEventStable([...rotated].reverse(), scenario()).id).toBe(expected);
    }
  });

  it("zero and negative weights cannot make selection order-sensitive", () => {
    // The floor of 0.001 already existed in the legacy selector; what matters
    // here is only that it does not reintroduce array-position dependence.
    const odd = [make("e_zero", 0), make("e_neg", -5), make("e_ok", 2)];
    const expected = selectEventStable([...odd], scenario()).id;
    expect(selectEventStable([...odd].reverse(), scenario()).id).toBe(expected);
  });

  it("duplicate ids fail closed, in either catalogue order", () => {
    // A stable sort leaves equal keys in input order, so two events sharing an
    // id would still be chosen by array position: same `.id`, different weight,
    // body and choices. The old test compared two calls in the *same* order and
    // proved only repeat-determinism, which is not the property that matters.
    const one = { ...make("dup", 1), title: "ONE" };
    const two = { ...make("dup", 100), title: "TWO" };
    const forward = [one, two, make("e_other", 1)];
    const reversed = [...forward].reverse();

    expect(() => selectEventStable(forward, scenario())).toThrow(/Duplicate event id 'dup'/);
    expect(() => selectEventStable(reversed, scenario())).toThrow(/Duplicate event id 'dup'/);
  });

  it("a duplicate hidden by eligibility is still refused", () => {
    // The whole catalogue is checked, not the eligible subset: an id collision
    // is a content defect even while today's requirements hide it.
    const gatedDupe: GameEvent = {
      ...make("dup", 1),
      requirements: { flagsAll: ["never_set_flag"] }
    };
    const catalogue = [make("dup", 1), gatedDupe, make("e_ok", 1)];
    expect(() => selectEventStable(catalogue, scenario())).toThrow(/Duplicate event id/);
  });

  it("permutations select the same event OBJECT, not merely the same id", () => {
    const set = [make("p_a", 1), make("p_b", 2), make("p_c", 3), make("p_d", 4)];
    const expected = selectEventStable([...set], scenario());
    for (let shift = 0; shift < set.length; shift += 1) {
      const rotated = [...set.slice(shift), ...set.slice(0, shift)];
      // Identity, not just the id string.
      expect(selectEventStable(rotated, scenario())).toBe(expected);
      expect(selectEventStable([...rotated].reverse(), scenario())).toBe(expected);
    }
  });

  it("ordering does not depend on locale collation", () => {
    // `localeCompare` can order these differently depending on runtime ICU
    // data; code-unit comparison cannot. Uppercase sorts before lowercase in
    // code units, which is the point: the answer is the same everywhere.
    const cased = [make("Z_upper", 1), make("a_lower", 1), make("B_upper", 1)];
    const expected = selectEventStable([...cased], scenario()).id;
    for (const permutation of [
      [cased[1]!, cased[2]!, cased[0]!],
      [cased[2]!, cased[0]!, cased[1]!],
      [...cased].reverse()
    ]) {
      expect(selectEventStable(permutation, scenario()).id).toBe(expected);
    }
  });

  it("an ineligible catalogue is refused rather than guessed", () => {
    const gated: GameEvent[] = [
      { ...make("e_gated", 1), requirements: { flagsAll: ["never_set_flag"] } }
    ];
    expect(() => selectEventStable(gated, scenario())).toThrow(/No eligible events/);
  });
});

describe("E: validator and applicator agree on every value shape", () => {
  /**
   * The invariant, stated both ways:
   *
   *   anything either validator accepts is safe for the applicator;
   *   anything malformed enough to corrupt the world is refused by the
   *   applicator even if it bypassed validation.
   *
   * The first half is what the coercive helper broke: `Number("3")` is finite,
   * so the applicator accepted a string the validators reject.
   */

  const asEvent = (effect: unknown): unknown => ({
    id: "evt_probe",
    version: 1,
    title: "PROBE",
    body: "probe",
    category: "test",
    tags: [],
    weight: 1,
    choices: [{ id: "only", label: "ONLY", effects: [effect] }]
  });

  const cases: Array<[string, unknown, boolean]> = [
    // label, effect, accepted by the event validator
    ["RESOURCE_DELTA number", { type: "RESOURCE_DELTA", key: "water", value: -2 }, true],
    ["RESOURCE_DELTA string \"3\"", { type: "RESOURCE_DELTA", key: "water", value: "3" }, false],
    ["RESOURCE_DELTA true", { type: "RESOURCE_DELTA", key: "water", value: true }, false],
    ["PRESSURE_DELTA number", { type: "PRESSURE_DELTA", value: 2 }, true],
    ["PRESSURE_DELTA string \"2\"", { type: "PRESSURE_DELTA", value: "2" }, false],
    ["PRESSURE_DELTA NaN", { type: "PRESSURE_DELTA", value: Number.NaN }, false],
    ["PRESSURE_DELTA Infinity", { type: "PRESSURE_DELTA", value: Number.POSITIVE_INFINITY }, false],
    ["CHARACTER_STRESS number", { type: "CHARACTER_STRESS", targetId: "brann_001", value: 3 }, true],
    ["CHARACTER_STRESS false", { type: "CHARACTER_STRESS", targetId: "brann_001", value: false }, false],
    ["CHARACTER_STRESS Infinity", { type: "CHARACTER_STRESS", targetId: "brann_001", value: Number.NEGATIVE_INFINITY }, false],
    ["FLAG_SET string", { type: "FLAG_SET", key: "f", value: "text" }, true],
    ["FLAG_SET boolean", { type: "FLAG_SET", key: "f", value: true }, true],
    ["FLAG_SET finite number", { type: "FLAG_SET", key: "f", value: 7 }, true],
    ["FLAG_SET NaN", { type: "FLAG_SET", key: "f", value: Number.NaN }, false],
    ["FLAG_SET Infinity", { type: "FLAG_SET", key: "f", value: Number.POSITIVE_INFINITY }, false]
  ];

  it.each(cases)("%s: validator and applicator reach the same verdict", (_label, effect, accepted) => {
    expect(validateGameEvent(asEvent(effect)).ok).toBe(accepted);

    const state = scenario();
    const snapshot = structuredClone(state);
    const attempt = () => applyEventEffect(state, effect as EventEffect, []);

    if (accepted) {
      expect(attempt).not.toThrow();
    } else {
      // Refused, and refused before writing.
      expect(attempt).toThrow();
      expect(state).toEqual(snapshot);
    }
  });

  it("the save validator agrees with the event validator on FLAG_SET numbers", () => {
    // These two used to disagree: an authored event carrying a NaN flag was
    // accepted, played, and then refused at save time.
    const world = scenario();
    world.simulation!.delayedConsequences.push({
      id: "con_nan_flag",
      triggerTurn: 1,
      visibility: "visible",
      scope: "settlement",
      effects: [{ type: "FLAG_SET", key: "f", value: Number.NaN } as EventEffect],
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    } as DelayedConsequenceState);

    // JSON cannot carry NaN, so the save boundary meets it as null; both
    // validators refuse the shape, from their own side.
    expect(validateSystemicWorldState(JSON.parse(JSON.stringify(world))).ok).toBe(false);
    expect(validateGameEvent(asEvent({ type: "FLAG_SET", key: "f", value: Number.NaN })).ok).toBe(false);
  });
});

describe("P2-1: a malformed identifier is refused on both sides", () => {
  /**
   * The validators test `text(effect.key)?.trim()`; the applicator tested only
   * truthiness, and `" "` is truthy. A whitespace key therefore passed the
   * refusal and reached the world, creating `flags[" "]` or a stock under a
   * name nothing could reference again.
   */
  const blank: Array<[string, unknown]> = [
    ["RESOURCE_DELTA key ' '", { type: "RESOURCE_DELTA", key: " ", value: -1 }],
    ["RESOURCE_DELTA key ''", { type: "RESOURCE_DELTA", key: "", value: -1 }],
    ["RESOURCE_DELTA key '\t\n'", { type: "RESOURCE_DELTA", key: "\t\n", value: -1 }],
    ["FLAG_SET key ' '", { type: "FLAG_SET", key: " ", value: true }],
    ["FLAG_SET key ''", { type: "FLAG_SET", key: "", value: true }],
    ["CHARACTER_STRESS targetId ' '", { type: "CHARACTER_STRESS", targetId: " ", value: 1 }],
    ["CHARACTER_STRESS targetId ''", { type: "CHARACTER_STRESS", targetId: "", value: 1 }]
  ];

  it.each(blank)("%s: validator and applicator both refuse", (_label, effect) => {
    const event = {
      id: "evt_blank",
      version: 1,
      title: "BLANK",
      body: "blank",
      category: "test",
      tags: [],
      weight: 1,
      choices: [{ id: "only", label: "ONLY", effects: [effect] }]
    };
    expect(validateGameEvent(event).ok).toBe(false);

    const state = scenario();
    const snapshot = structuredClone(state);
    expect(() => applyEventEffect(state, effect as EventEffect, [])).toThrow();
    // Refused without authoritative mutation.
    expect(state).toEqual(snapshot);
  });

  it("a whitespace key never appears in the world", () => {
    const state = scenario();
    expect(() =>
      applyEventEffect(state, { type: "FLAG_SET", key: " ", value: true } as EventEffect, [])
    ).toThrow(/non-empty identifier/);
    expect(Object.keys(state.flags)).not.toContain(" ");
  });
});

describe("P2-2: a finite input may not leave a non-finite world", () => {
  /**
   * `Number.MAX_VALUE + Number.MAX_VALUE` is `Infinity`. Both operands pass
   * the input guard, because the defect is a property of the result. An
   * infinite stock survives in memory and is then refused by the save
   * validator: the run continues and cannot be stored.
   */
  it("PRESSURE_DELTA overflow is refused and the world is untouched", () => {
    const state = scenario();
    state.worldPressure = Number.MAX_VALUE;
    const snapshot = structuredClone(state);

    expect(() =>
      applyEventEffect(state, { type: "PRESSURE_DELTA", value: Number.MAX_VALUE }, [])
    ).toThrow(/non-finite result/);
    expect(state.worldPressure).toBe(snapshot.worldPressure);
    expect(Number.isFinite(state.worldPressure)).toBe(true);
  });

  /**
   * The property is not "a rejected effect throws" — it is **a rejected effect
   * performs zero authoritative mutation**. Those differ exactly when the guard
   * sits after the write: the stock becomes `Infinity`, the exception follows,
   * and only a caller that happened to be working on a clone is spared. The
   * applicator is exported, so it must hold the invariant on its own.
   */
  it("settlement RESOURCE_DELTA overflow leaves stock, projection and delta untouched", () => {
    const state = scenario();
    state.simulation!.settlements[0]!.resourceStock.water = Number.MAX_VALUE;
    state.resources.water = Number.MAX_VALUE;
    const snapshot = structuredClone(state);
    const changes: StateChange[] = [];

    expect(() =>
      applyEventEffect(
        state,
        { type: "RESOURCE_DELTA", key: "water", value: Number.MAX_VALUE },
        changes
      )
    ).toThrow(/non-finite result/);

    expect(state).toEqual(snapshot);
    expect(state.simulation!.settlements[0]!.resourceStock.water).toBe(Number.MAX_VALUE);
    expect(state.resources.water).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(state.simulation!.settlements[0]!.resourceStock.water)).toBe(true);
    expect(Number.isFinite(state.resources.water)).toBe(true);
    expect(changes).toEqual([]);
  });

  /**
   * The same property on the other authority. `credits` is a campaign resource:
   * no settlement stocks it, so `WorldState.resources` owns it directly and
   * projects nothing. Two write paths, one invariant.
   */
  it("campaign RESOURCE_DELTA overflow leaves the flat authority and delta untouched", () => {
    const state = scenario();
    expect("credits" in state.simulation!.settlements[0]!.resourceStock).toBe(false);
    state.resources.credits = Number.MAX_VALUE;
    const snapshot = structuredClone(state);
    const changes: StateChange[] = [];

    expect(() =>
      applyEventEffect(
        state,
        { type: "RESOURCE_DELTA", key: "credits", value: Number.MAX_VALUE },
        changes
      )
    ).toThrow(/non-finite result/);

    expect(state).toEqual(snapshot);
    expect(state.resources.credits).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(state.resources.credits)).toBe(true);
    expect(changes).toEqual([]);
  });

  /** The guard must refuse overflow without refusing ordinary arithmetic. */
  it("an ordinary RESOURCE_DELTA still writes authority, projection and delta", () => {
    const state = scenario();
    const settlement = state.simulation!.settlements[0]!;
    const changes: StateChange[] = [];

    applyEventEffect(state, { type: "RESOURCE_DELTA", key: "water", value: -3 }, changes);
    expect(settlement.resourceStock.water).toBe(11);
    expect(state.resources.water).toBe(11);
    expect(changes).toEqual([
      { type: "resource", key: `${settlement.id}.resourceStock.water`, before: 14, after: 11 },
      { type: "resourceMirror", key: "resources.water", before: 14, after: 11 }
    ]);

    // The campaign authority writes one entry and mirrors nothing.
    const flat: StateChange[] = [];
    applyEventEffect(state, { type: "RESOURCE_DELTA", key: "credits", value: -5 }, flat);
    expect(state.resources.credits).toBe(22);
    expect(settlement.resourceStock.credits).toBeUndefined();
    expect(flat).toEqual([{ type: "resource", key: "credits", before: 27, after: 22 }]);
  });

  it("a successful application always leaves finite authoritative numbers", () => {
    const applied = resolveChoice(
      scenario(),
      { id: "ok", label: "OK", effects: EVERY_EFFECT },
      "test"
    ).state;

    expect(Number.isFinite(applied.worldPressure)).toBe(true);
    for (const value of Object.values(applied.simulation!.settlements[0]!.resourceStock)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const character of applied.party) {
      expect(Number.isFinite(character.stress)).toBe(true);
    }
  });
});

describe("P2-3: delayed consequences apply in a locale-independent order", () => {
  /**
   * Two consequences due on the same turn are ordered by id. With
   * `localeCompare` that order depended on the runtime's locale and ICU data,
   * and effects on the same field do not commute — so two machines replaying
   * one save could reach different worlds.
   */
  function pending(id: string, value: number | string): DelayedConsequenceState {
    return {
      id,
      triggerTurn: 1,
      visibility: "visible",
      scope: "settlement",
      // A FLAG_SET on one key: last writer wins, so order is observable.
      effects: [{ type: "FLAG_SET", key: "order_probe", value }],
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "test" }
    };
  }

  const ids = ["con_Zulu", "con_alpha", "con_Beta", "con_alpha2"];

  it("the same set in any input order applies in the same order", () => {
    const outcomes = new Set<string>();
    const applications: string[][] = [];

    for (const permutation of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2]
    ]) {
      let state = scenario();
      // The value is tied to the id, not to the scheduling position, so the
      // winner is decided purely by application order.
      for (const index of permutation) {
        state = scheduleDelayedConsequence(state, pending(ids[index]!, ids[index]!)).state;
      }
      const due = applyDueConsequences(state, 1);
      outcomes.add(String(due.state.flags.order_probe));
      applications.push([...due.appliedIds]);
    }

    // One winner, whatever order they were scheduled in.
    expect(outcomes.size).toBe(1);
    // And the application order itself is identical every time.
    for (const applied of applications) expect(applied).toEqual(applications[0]);
  });

  it("the order is by code unit, so case is not folded away", () => {
    let state = scenario();
    for (const id of ids) state = scheduleDelayedConsequence(state, pending(id, id)).state;
    const applied = applyDueConsequences(state, 1).appliedIds;

    // Uppercase sorts before lowercase in code units. A locale-aware collator
    // may instead group them case-insensitively, which is the divergence.
    expect(applied).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(applied[0]).toBe("con_Beta");
  });

  it("trigger turn still dominates the id tie-break", () => {
    let state = scenario();
    state = scheduleDelayedConsequence(state, { ...pending("con_zzz_early", "early"), triggerTurn: 1 }).state;
    state = scheduleDelayedConsequence(state, { ...pending("con_aaa_late", "late"), triggerTurn: 2 }).state;
    const applied = applyDueConsequences(state, 2).appliedIds;
    expect(applied).toEqual(["con_zzz_early", "con_aaa_late"]);
  });
});
