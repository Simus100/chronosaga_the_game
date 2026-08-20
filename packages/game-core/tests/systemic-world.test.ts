import { describe, expect, it } from "vitest";
import type { DelayedConsequenceState, EventEffect, GameEvent } from "@paa/game-types";
import {
  applyDueConsequences,
  createSystemicScenario,
  scheduleDelayedConsequence,
  validateGameEvent,
  validateSystemicWorldState
} from "../src";

describe("M1 systemic world foundation", () => {
  it("creates and round-trips the minimal persistent systemic scenario", () => {
    const state = createSystemicScenario(42);
    const simulation = state.simulation;

    expect(state.party).toHaveLength(5);
    expect(simulation).toBeDefined();
    expect(simulation?.settlements).toHaveLength(1);
    expect(simulation?.factions).toHaveLength(2);
    expect(simulation?.productionNodes).toHaveLength(1);
    expect(simulation?.populationCohorts).toHaveLength(2);
    expect(simulation?.politicalGroups).toHaveLength(2);
    expect(simulation?.warfareSquads).toHaveLength(2);
    expect(state.party.some(character => (character.memories?.length ?? 0) > 0)).toBe(true);

    const validation = validateSystemicWorldState(state);
    expect(validation).toEqual({ ok: true, errors: [] });

    const roundTrip = JSON.parse(JSON.stringify(state));
    expect(validateSystemicWorldState(roundTrip)).toEqual({ ok: true, errors: [] });
    expect(roundTrip).toEqual(state);
  });

  it("is deterministic for the same seed", () => {
    expect(createSystemicScenario(7419)).toEqual(createSystemicScenario(7419));
    expect(createSystemicScenario(12).campaignId).not.toBe(createSystemicScenario(13).campaignId);
  });

  it("rejects broken references and malformed consequence effects", () => {
    const brokenReference = structuredClone(createSystemicScenario(7));
    brokenReference.simulation!.productionNodes[0]!.settlementId = "settlement_missing";
    const referenceResult = validateSystemicWorldState(brokenReference);
    expect(referenceResult.ok).toBe(false);
    expect(referenceResult.errors.some(error => error.includes("unknown settlement"))).toBe(true);

    const malformedEffect = structuredClone(createSystemicScenario(7));
    malformedEffect.simulation!.delayedConsequences[0]!.effects = [
      { type: "RESOURCE_DELTA", value: -1 } as EventEffect
    ];
    const effectResult = validateSystemicWorldState(malformedEffect);
    expect(effectResult.ok).toBe(false);
    expect(effectResult.errors.some(error => error.includes("requires key"))).toBe(true);
  });

  it("rejects malformed authored event fixtures before resolution", () => {
    const event: GameEvent = {
      id: "evt_relay_offer",
      version: 1,
      title: "Relay Offer",
      body: "A contractor offers emergency access to the relay route.",
      category: "settlement",
      tags: ["relay", "supply"],
      weight: 1,
      choices: [
        {
          id: "accept",
          label: "Accept",
          effects: [{ type: "RESOURCE_DELTA", key: "credits", value: -2 }]
        }
      ]
    };
    expect(validateGameEvent(event)).toEqual({ ok: true, errors: [] });

    const malformed = structuredClone(event);
    malformed.choices[0]!.effects = [{ type: "RESOURCE_DELTA", value: -2 } as EventEffect];
    const result = validateGameEvent(malformed);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes("requires key"))).toBe(true);
  });

  it("schedules and applies a delayed consequence deterministically without AI", () => {
    const consequence: DelayedConsequenceState = {
      id: "con_test_water_ration",
      triggerTurn: 2,
      visibility: "hidden",
      scope: "settlement",
      effects: [
        { type: "RESOURCE_DELTA", key: "water", value: -2 },
        { type: "FLAG_SET", key: "rationing_started", value: true },
        { type: "CHARACTER_STRESS", targetId: "mara_001", value: 5 }
      ],
      reversible: true,
      status: "pending",
      source: {
        kind: "choice",
        id: "choice_delay_repairs",
        actorId: "ira_001",
        rule: "delayed_water_cost"
      }
    };

    const initial = createSystemicScenario(99);
    const scheduled = scheduleDelayedConsequence(initial, consequence, "test:schedule");
    expect(scheduled.state).not.toBe(initial);
    expect(initial.simulation!.delayedConsequences.some(item => item.id === consequence.id)).toBe(false);
    expect(scheduled.delta.changes[0]?.type).toBe("delayedConsequenceScheduled");

    const tooEarly = applyDueConsequences(scheduled.state, 1);
    expect(tooEarly.appliedIds).toEqual([]);
    expect(tooEarly.state.resources.water).toBe(14);

    const applied = applyDueConsequences(scheduled.state, 2);
    expect(applied.appliedIds).toEqual([consequence.id]);
    expect(applied.state.resources.water).toBe(12);
    expect(applied.state.flags.rationing_started).toBe(true);
    expect(applied.state.party.find(character => character.id === "mara_001")?.stress).toBe(36);
    expect(
      applied.state.simulation!.delayedConsequences.find(item => item.id === consequence.id)?.status
    ).toBe("applied");

    const replay = applyDueConsequences(
      scheduleDelayedConsequence(createSystemicScenario(99), consequence, "test:schedule").state,
      2
    );
    expect(replay).toEqual(applied);
  });
});
