import { describe, expect, it } from "vitest";
import type { EventEffect, ProofEvent, StateChange, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import {
  agendaConditionHolds,
  applyDueConsequences,
  applyEventEffect,
  createGqpScenario,
  describeProofChoice,
  evaluateProofPredicate,
  isProofChoiceAvailable,
  resolveProofChoice,
  runWorldTick,
  scheduleDelayedConsequence,
  validateProofCatalogue,
  validateSystemicWorldState,
  weightedSettlementSatisfaction
} from "../src";

/**
 * The typed levers GQP-C adds for F4 and F5, each through the shared
 * validator/applicator path the other proof effects use.
 *
 * POLITICAL_STANDING_SHIFT is the only new effect. It is justified by what it
 * moves: political-group approval and cohort satisfaction are authoritative
 * legitimacy (spec 9.3), F4 must touch them (spec 11), and before GQP-C no
 * decision could -- only the World Tick wrote them, from shortage alone.
 */

const SOURCE = { kind: "choice", id: "evt_probe:probe", rule: "public_accountability" } as const;
const start = () => createGqpScenario(7419);
const group = (world: WorldState, id: string) => world.simulation!.politicalGroups.find(item => item.id === id)!;
const cohort = (world: WorldState, id: string) => world.simulation!.populationCohorts.find(item => item.id === id)!;
const settlement = (world: WorldState) => world.simulation!.settlements[0]!;

function apply(world: WorldState, effect: EventEffect): StateChange[] {
  const changes: StateChange[] = [];
  applyEventEffect(world, effect, changes, { source: SOURCE, turn: world.turn });
  return changes;
}

describe("POLITICAL_STANDING_SHIFT", () => {
  it("moves the group's approval, its cohorts' satisfaction, and re-derives the settlement's by the tick's own rule", () => {
    const world = start();
    const changes = apply(world, { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.1 });
    expect(group(world, "group_labor").approval).toBe(0.58);
    expect(cohort(world, "cohort_industrial").satisfaction).toBe(0.59);
    // The other group's base is untouched.
    expect(cohort(world, "cohort_service").satisfaction).toBe(0.61);
    expect(group(world, "group_security").approval).toBe(0.59);
    // Settlement satisfaction is derived, never set: the population-weighted mean.
    expect(settlement(world).satisfaction).toBe(weightedSettlementSatisfaction(world.simulation!.populationCohorts));
    expect(changes.map(change => change.type)).toEqual(["politicalApproval", "cohortSatisfaction", "settlementSatisfaction"]);
    expect(validateSystemicWorldState(world).ok).toBe(true);
  });

  it("saturates inside 0..1 and records the value actually written", () => {
    const world = start();
    const changes = apply(world, { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -1 });
    expect(group(world, "group_labor").approval).toBe(0);
    expect(cohort(world, "cohort_industrial").satisfaction).toBe(0);
    expect(changes[0]).toEqual({ type: "politicalApproval", key: "group_labor.approval", before: 0.48, after: 0 });
    // A shift into a wall already reached writes nothing and records nothing.
    expect(apply(world, { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.2 })).toEqual([]);
  });

  it("is where the League's lockout grievance is resolved from: an agenda condition reads the approval it moves", () => {
    const world = start();
    const lockout = (world.simulation as SystemicSimulationStateV2).factionAgenda.find(item => item.id === "agenda_fcl_lockout")!;
    expect(agendaConditionHolds(lockout.condition, world)).toBe(false);
    apply(world, { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.12 });
    expect(agendaConditionHolds(lockout.condition, world)).toBe(true);
  });

  it("carries on through the World Tick from the values it wrote", () => {
    const shifted = start();
    apply(shifted, { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.1 });
    const baseline = runWorldTick(start()).state;
    const ticked = runWorldTick(shifted).state;
    expect(group(ticked, "group_labor").approval).toBeGreaterThan(group(baseline, "group_labor").approval);
  });

  it.each([
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_ghost", delta: 0.1 }, /groupId 'group_ghost' matches no political group/],
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: " ", delta: 0.1 }, /groupId must be a non-empty string/],
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0 }, /delta must not be zero/],
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 1.5 }, /delta must be within -1\.\.1/],
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: "a lot" }, /delta must be a finite number/],
    [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.1, factionId: "faction_front" }, /factionId is not a field of POLITICAL_STANDING_SHIFT/]
  ])("is refused by the applicator, touching nothing: %o", (effect, pattern) => {
    const world = start();
    const before = structuredClone(world);
    expect(() => apply(world, effect as unknown as EventEffect)).toThrow(pattern);
    expect(world).toEqual(before);
  });

  it("is refused in a pending consequence the boundary cannot apply, by the same words", () => {
    const world = start();
    world.simulation!.delayedConsequences.push({
      id: "con_hostile_standing",
      triggerTurn: 3,
      visibility: "hidden",
      scope: "settlement",
      effects: [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_ghost", delta: 0.1 }],
      reversible: false,
      status: "pending",
      source: SOURCE
    });
    expect(validateSystemicWorldState(world).errors.join("; ")).toMatch(/groupId 'group_ghost' matches no political group/);
  });

  it("lands the same transition immediately and as a delayed consequence", () => {
    const effect: EventEffect = { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.12 };
    const immediate = start();
    apply(immediate, effect);

    const scheduled = scheduleDelayedConsequence(start(), {
      id: "con_standing",
      triggerTurn: 1,
      visibility: "hidden",
      scope: "settlement",
      effects: [effect],
      reversible: false,
      status: "pending",
      source: SOURCE
    }).state;
    const delayed = applyDueConsequences(scheduled).state;
    for (const key of ["group_labor", "group_security"]) expect(group(delayed, key).approval).toBe(group(immediate, key).approval);
    expect(delayed.simulation!.populationCohorts).toEqual(immediate.simulation!.populationCohorts);
    expect(settlement(delayed).satisfaction).toBe(settlement(immediate).satisfaction);
  });

  it("is previewed in KNOWN as the transition the Core makes, saturation included", () => {
    const world = start();
    group(world, "group_labor").approval = 0.95;
    const choice = { id: "c", label: "c", effects: [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.12 } as EventEffect], disclosure: { risks: [], unknowns: [] } };
    const known = describeProofChoice(choice, world).known!;
    expect(known).toEqual([{ kind: "standing", groupId: "group_labor", before: 0.95, after: 1, delta: 0.05 }]);
  });
});

describe("resource_below", () => {
  it("reads the authoritative stock the effects write", () => {
    const world = start();
    expect(evaluateProofPredicate({ predicate: "resource_below", key: "water", value: 15 }, world)).toBe(true);
    expect(evaluateProofPredicate({ predicate: "resource_below", key: "water", value: 14 }, world)).toBe(false);
    world.simulation!.settlements[0]!.resourceStock.water = 2;
    expect(evaluateProofPredicate({ predicate: "resource_below", key: "water", value: 5 }, world)).toBe(true);
  });

  it("is refused by the gate when nothing stocks the key and no choice writes it", () => {
    // A missing key reads as zero: without this, a typo is a shortage.
    const reading = (key: string): ProofEvent[] => [
      ...catalogue(),
      {
        id: "evt_x_short",
        familyId: "external_rescue",
        taxonomy: "COMPLICATION",
        eligibility: [{ predicate: "resource_below", key, value: 5 }],
        presentation: { title: "R", body: "r" },
        choices: [
          { id: "wait", label: "Wait", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } },
          { id: "ask", label: "Ask", effects: [{ type: "PRESSURE_DELTA", value: 1 }], disclosure: { risks: ["political"], unknowns: ["x"] } }
        ]
      }
    ];
    expect(validateProofCatalogue(reading("water"), start()).errors).toEqual([]); // settlement stock
    // The stock is the authority, not the flat projection of it.
    const unprojected = start();
    delete unprojected.resources.water;
    expect(validateProofCatalogue(reading("water"), unprojected).errors).toEqual([]);
    expect(validateProofCatalogue(reading("credits"), start()).errors).toEqual([]); // campaign resource
    expect(validateProofCatalogue(reading("wattr"), start()).errors).toEqual([
      "event evt_x_short.eligibility[0].key 'wattr' is stocked by nothing and written by no choice"
    ]);
    // A key no world holds yet is fine once some choice writes it.
    const written = reading("salvage");
    written[2]!.choices[0]!.effects = [{ type: "RESOURCE_DELTA", key: "salvage", value: 2 }];
    expect(validateProofCatalogue(written, start()).errors).toEqual([]);
  });
});

/** A two-event catalogue exercising the contracts below. */
function catalogue(extra: Partial<ProofEvent> = {}): ProofEvent[] {
  return [
    {
      id: "evt_x_secret",
      familyId: "unregistered_conduit",
      taxonomy: "DILEMMA",
      eligibility: [],
      presentation: { title: "S", body: "s" },
      choices: [
        {
          id: "hide",
          label: "Hide",
          effects: [
            { type: "MEMORY_RECORD", characterId: "mara_001", memoryId: "fact_x", valence: "ambivalent", salience: 0.8, exposure: "secret", callbackEligible: true, summary: "x", tags: [] }
          ],
          disclosure: { risks: ["political"], unknowns: ["x"] }
        },
        { id: "skip", label: "Skip", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
      ]
    },
    {
      id: "evt_x_confess",
      familyId: "public_accountability",
      taxonomy: "DILEMMA",
      eligibility: [],
      presentation: { title: "C", body: "c" },
      choices: [
        { id: "confess", label: "Confess", effects: [{ type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_x" }], disclosure: { risks: ["political"], unknowns: ["x"] } },
        { id: "no", label: "No", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
      ]
    },
    {
      id: "evt_x_expose",
      familyId: "public_accountability",
      taxonomy: "DILEMMA",
      eligibility: [],
      presentation: { title: "E", body: "e" },
      choices: [
        { id: "expose", label: "Expose", effects: [{ type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_x" }], disclosure: { risks: ["political"], unknowns: ["x"] } },
        { id: "no", label: "No", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
      ],
      ...extra
    }
  ];
}

describe("one fact, several immediate publishers (GQP-C: confessed, or exposed where found)", () => {
  it("passes the gate, and the first publication closes the other by availability", () => {
    const content = catalogue();
    expect(validateProofCatalogue(content, start())).toEqual({ ok: true, errors: [] });
    const hidden = resolveProofChoice(start(), content, "evt_x_secret", "hide").state;
    const expose = content[2]!.choices[0]!;
    expect(isProofChoiceAvailable(expose, hidden)).toBe(true);
    const confessed = resolveProofChoice(hidden, content, "evt_x_confess", "confess").state;
    expect(isProofChoiceAvailable(expose, confessed)).toBe(false);
    expect(() => resolveProofChoice(confessed, content, "evt_x_expose", "expose")).toThrow(/is not available now/);
  });
});

describe("relevance: typed causal references that reprioritise without gating", () => {
  const withRelevance = (relevance: unknown[]) => catalogue({ relevance: relevance as never });

  it("accepts references to things the world can hold", () => {
    expect(
      validateProofCatalogue(
        withRelevance([
          { predicate: "memory_known", characterId: "mara_001", memoryId: "fact_x", value: true },
          { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false },
          { predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", value: true }
        ]),
        start()
      ).errors
    ).toEqual([]);
  });

  it.each([
    [{ predicate: "epidemic_stage_in", stages: ["CRISIS"] }],
    [{ predicate: "memory_known", characterId: "mara_001", memoryId: "fact_x", value: false }],
    [{ predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: true }],
    [{ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", value: false }]
  ])("refuses a reference that could never count: %o", reference => {
    expect(validateProofCatalogue(withRelevance([reference]), start()).errors.join("; ")).toMatch(/relevance\[0\] must point at something the world holds/);
  });

  it("validates each reference like an eligibility predicate", () => {
    expect(
      validateProofCatalogue(withRelevance([{ predicate: "agenda_satisfied", agendaId: "agenda_ghost", value: false }]), start()).errors.join("; ")
    ).toMatch(/relevance\[0\]\.agendaId matches no agenda item/);
  });

  it("never gates: an event whose relevance does not hold is still eligible", () => {
    const content = withRelevance([{ predicate: "memory_known", characterId: "mara_001", memoryId: "fact_x", value: true }]);
    expect(content[2]!.eligibility).toEqual([]);
    // Nothing recorded fact_x yet; the event is eligible regardless.
    expect(resolveProofChoice(start(), content, "evt_x_expose", "no").entry.eventId).toBe("evt_x_expose");
  });
});
