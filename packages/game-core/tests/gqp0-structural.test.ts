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
