import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import {
  BASELINE_SCHEMA_VERSION,
  PROOF_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  agendaConditionHolds,
  createGqpScenario,
  createSystemicScenario,
  deriveInfrastructurePressure,
  epidemicStage,
  isProofSimulation,
  isSupportedSchemaVersion,
  loadSystemicWorldState,
  serializeSystemicWorldState,
  pressureStage,
  resolveChoice,
  runWorldTick,
  satisfiedAgendaItems,
  settlementInfrastructurePressure,
  validateSystemicWorldState
} from "../src";

function proof(): WorldState {
  return createGqpScenario(7419);
}

/** The proof simulation, narrowed. Fails loudly rather than casting silently. */
function proofSimulation(state: WorldState): SystemicSimulationStateV2 {
  const simulation = state.simulation!;
  if (!isProofSimulation(simulation)) throw new Error("expected a proof simulation");
  return simulation;
}

/** A world's validation errors, or an empty list. */
function errorsOf(state: unknown): string[] {
  return validateSystemicWorldState(state).errors;
}

describe("GQP-A: the proof scenario is Helios Reach, derived", () => {
  it("reuses the baseline settlement, factions and cast identities", () => {
    const baseline = createSystemicScenario(7419);
    const state = proof();
    const simulation = proofSimulation(state);

    // Spec 6.1: no second world. The identities are the same ones.
    expect(simulation.settlements.map(s => s.id)).toEqual(
      baseline.simulation!.settlements.map(s => s.id)
    );
    expect(simulation.factions.map(f => f.id)).toEqual(
      baseline.simulation!.factions.map(f => f.id)
    );
    expect(state.party.map(c => c.id)).toEqual(baseline.party.map(c => c.id));
  });

  it("gives every character a distinct position toward the focal resources", () => {
    const state = proof();

    // Spec 6.2: a character whose position touches none of the focal resources
    // produces no predictable decision. Distinct values and distinct goals are
    // what make prediction possible.
    const values = state.party.map(c => c.coreValue);
    const goals = state.party.map(c => c.currentGoal);
    expect(new Set(values).size).toBe(state.party.length);
    expect(new Set(goals).size).toBe(state.party.length);
    for (const character of state.party) {
      expect(character.coreValue).toBeDefined();
      expect(character.currentGoal).toBeDefined();
    }
  });

  it("carries relationships that resolve, are directed, and never self-refer", () => {
    const simulation = proofSimulation(proof());
    const ids = new Set(proof().party.map(c => c.id));

    expect(simulation.characterRelationships.length).toBeGreaterThan(0);
    for (const relationship of simulation.characterRelationships) {
      expect(ids.has(relationship.sourceCharacterId)).toBe(true);
      expect(ids.has(relationship.targetCharacterId)).toBe(true);
      expect(relationship.sourceCharacterId).not.toBe(relationship.targetCharacterId);
    }
  });

  it("carries both agenda kinds, because they are not each other's inverse", () => {
    const simulation = proofSimulation(proof());
    const kinds = new Set(simulation.factionAgenda.map(item => item.kind));

    // Spec 8.1: a desire is satisfied by conceding, a grievance is resolved by
    // repairing. A scenario carrying only one kind could be modelled as a
    // signed scalar, which is exactly what the contract refuses.
    expect(kinds).toEqual(new Set(["desire", "grievance"]));
    const factions = new Set(simulation.factionAgenda.map(item => item.factionId));
    expect(factions.size).toBe(2);
  });

  it("starts with an attributed epidemic pressure and an empty history", () => {
    const simulation = proofSimulation(proof());

    // Spec 9.4: multiple causes. A pressure with one cause is a timer, and a
    // timer gives the player nothing to act on.
    expect(simulation.epidemic.contributors.length).toBeGreaterThanOrEqual(2);
    expect(new Set(simulation.epidemic.contributors.map(c => c.cause)).size).toBeGreaterThanOrEqual(2);
    for (const contributor of simulation.epidemic.contributors) {
      expect(contributor.source.id).toBeTruthy();
    }
    // Spec 14.6: an empty history is itself authoritative data.
    expect(simulation.resolvedHistory).toEqual([]);
  });

  it("validates", () => {
    expect(errorsOf(proof())).toEqual([]);
  });
});

describe("GQP-A: the M1 baseline is untouched", () => {
  it("still declares schema v1 and carries no proof state", () => {
    const baseline = createSystemicScenario(7419);
    const simulation = baseline.simulation!;

    expect(simulation.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    expect(isProofSimulation(simulation)).toBe(false);
    for (const character of baseline.party) {
      expect(character.coreValue).toBeUndefined();
      expect(character.currentGoal).toBeUndefined();
    }
    expect(errorsOf(baseline)).toEqual([]);
  });

  it("differs from the proof world only where the proof declares ownership", () => {
    // The property that actually protects the baseline, stated as an equality
    // rather than as an absence.
    //
    // An earlier version of this test called the proof factory and then
    // re-read the baseline factory, which could never fail: each call builds
    // fresh objects, so mutating one has nothing to observe. Mutation testing
    // caught it. What matters is not that the factory is pure but that the
    // proof world is the baseline world plus exactly the declared additions --
    // so anything the derivation quietly changed shows up as a difference.
    const baseline = createSystemicScenario(7419);
    const state = proof();

    const stripped = {
      ...state,
      campaignId: baseline.campaignId,
      party: state.party.map(character => {
        const { coreValue, currentGoal, ...rest } = character;
        void coreValue;
        void currentGoal;
        return rest;
      }),
      simulation: (() => {
        const {
          schemaVersion,
          characterRelationships,
          factionAgenda,
          epidemic,
          resolvedHistory,
          ...rest
        } = proofSimulation(state);
        void schemaVersion;
        void characterRelationships;
        void factionAgenda;
        void epidemic;
        void resolvedHistory;
        return { ...rest, schemaVersion: 1 as const };
      })()
    };

    expect(stripped).toEqual(baseline);
  });

  it("is not aliased to a baseline world it could mutate later", () => {
    const state = proof();
    state.party[0]!.stress = 99;
    state.simulation!.settlements[0]!.resourceStock.water = 999;

    const fresh = createSystemicScenario(7419);
    expect(fresh.party[0]!.stress).not.toBe(99);
    expect(fresh.simulation!.settlements[0]!.resourceStock.water).not.toBe(999);
  });

  it("keeps M1 Player Turn and World Tick semantics exactly as they were", () => {
    const baseline = createSystemicScenario(7419);

    // One decision is one Player Turn.
    const decided = resolveChoice(
      baseline,
      { id: "probe", label: "PROBE", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
      "test"
    ).state;
    expect(decided.turn).toBe(baseline.turn + 1);

    // A tick advances the world, not the player.
    const ticked = runWorldTick(decided);
    expect(ticked.state.turn).toBe(decided.turn);
    expect(ticked.state.simulation!.tick).toBe(decided.simulation!.tick + 1);
  });

  it("applies the same clock semantics inside the proof scenario", () => {
    const state = proof();
    const decided = resolveChoice(
      state,
      { id: "probe", label: "PROBE", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
      "test"
    ).state;
    expect(decided.turn).toBe(state.turn + 1);

    const ticked = runWorldTick(decided);
    expect(ticked.state.turn).toBe(decided.turn);
    expect(ticked.state.simulation!.tick).toBe(decided.simulation!.tick + 1);
    // And the proof state survives a Core operation intact.
    expect(proofSimulation(ticked.state).factionAgenda.length).toBeGreaterThan(0);
  });
});

describe("GQP-A: schema version boundaries", () => {
  it("supports exactly v1 and v2", () => {
    expect([...SUPPORTED_SCHEMA_VERSIONS]).toEqual([1, 2]);
    expect(isSupportedSchemaVersion(1)).toBe(true);
    expect(isSupportedSchemaVersion(2)).toBe(true);
  });

  it.each([3, 0, -1, 1.5, "2", null, undefined, {}, [2]])(
    "refuses the unsupported version %s fail-closed",
    version => {
      const state = proof() as unknown as { simulation: { schemaVersion: unknown } };
      state.simulation.schemaVersion = version;

      const result = validateSystemicWorldState(state);
      expect(result.ok).toBe(false);
      // One clear reason, not a pile of errors about a contract we do not have.
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Unsupported simulation schema/);
    }
  );

  it("refuses a v1 world carrying proof simulation state", () => {
    const baseline = createSystemicScenario(7419) as unknown as {
      simulation: Record<string, unknown>;
    };
    baseline.simulation.epidemic = { value: 0.5, contributors: [] };

    const errors = errorsOf(baseline);
    expect(errors.some(e => /schema v2 state and must not appear at schema v1/.test(e))).toBe(true);
  });

  it("refuses a v1 world carrying proof character state", () => {
    const baseline = createSystemicScenario(7419);
    (baseline.party[0] as { coreValue?: string }).coreValue = "duty_of_care";

    expect(errorsOf(baseline).some(e => /coreValue is schema v2 state/.test(e))).toBe(true);
  });

  it("refuses a v1 world carrying proof memory state", () => {
    const baseline = createSystemicScenario(7419);
    const memory = baseline.party.find(c => c.memories?.length)!.memories![0]!;
    (memory as { valence?: string }).valence = "negative";

    expect(errorsOf(baseline).some(e => /valence is schema v2 state/.test(e))).toBe(true);
  });

  it("refuses a v2 world that is missing the proof contracts", () => {
    // The reinterpretation guard in the other direction: relabelling a
    // baseline world as v2 does not make it a proof world.
    const relabelled = createSystemicScenario(7419) as unknown as {
      simulation: { schemaVersion: number };
    };
    relabelled.simulation.schemaVersion = PROOF_SCHEMA_VERSION;

    const errors = errorsOf(relabelled);
    expect(errors.some(e => /characterRelationships must be an array at schema v2/.test(e))).toBe(true);
    expect(errors.some(e => /factionAgenda must be an array at schema v2/.test(e))).toBe(true);
    expect(errors.some(e => /epidemic must be an object at schema v2/.test(e))).toBe(true);
    expect(errors.some(e => /resolvedHistory must be an array at schema v2/.test(e))).toBe(true);
    expect(errors.some(e => /coreValue must be one of/.test(e))).toBe(true);
  });

  it("gives an older build a version number it can refuse", () => {
    // Spec 24.1 rule 5 is what makes the bump necessary rather than optional:
    // without a number that changes, a previous build has no way to know the
    // world contains decisions it cannot interpret. This is that build's rule,
    // reproduced literally.
    const olderBuildAccepts = (state: WorldState) => state.simulation!.schemaVersion === 1;

    expect(olderBuildAccepts(createSystemicScenario(7419))).toBe(true);
    expect(olderBuildAccepts(proof())).toBe(false);
  });

  it("performs no automatic v1 to v2 migration", () => {
    // Spec 24.1 rule 4: an M1 world does not become a proof world by being
    // opened, saved, ticked or decided upon.
    const baseline = createSystemicScenario(7419);

    const decided = resolveChoice(
      baseline,
      { id: "probe", label: "PROBE", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
      "test"
    ).state;
    const ticked = runWorldTick(decided).state;
    const roundTripped = JSON.parse(JSON.stringify(ticked)) as WorldState;

    expect(decided.simulation!.schemaVersion).toBe(1);
    expect(ticked.simulation!.schemaVersion).toBe(1);
    expect(roundTripped.simulation!.schemaVersion).toBe(1);
    expect(validateSystemicWorldState(roundTripped).ok).toBe(true);
    expect(isProofSimulation(roundTripped.simulation!)).toBe(false);
  });
});

describe("GQP-A: every new contract is validated against hostile input", () => {
  function corrupt(mutate: (simulation: Record<string, any>, state: any) => void): string[] {
    const state = proof() as any;
    mutate(state.simulation, state);
    return errorsOf(state);
  }

  it("refuses a relationship whose source or target does not exist", () => {
    // The example spec 24.1 gives of what an unvalidated field would admit.
    // Both ends, because a relationship is directed and each end is a separate
    // lookup: checking only one leaves the other unguarded.
    expect(
      corrupt(s => {
        s.characterRelationships[0].targetCharacterId = "ghost_999";
      }).some(e => /targetCharacterId 'ghost_999' matches no party character/.test(e))
    ).toBe(true);

    expect(
      corrupt(s => {
        s.characterRelationships[0].sourceCharacterId = "ghost_999";
      }).some(e => /sourceCharacterId 'ghost_999' matches no party character/.test(e))
    ).toBe(true);
  });

  it("refuses a self-relationship and an unknown relationship type", () => {
    expect(
      corrupt(s => {
        s.characterRelationships[0].targetCharacterId = s.characterRelationships[0].sourceCharacterId;
      }).some(e => /relates '.*' to itself/.test(e))
    ).toBe(true);

    expect(
      corrupt(s => {
        s.characterRelationships[0].type = "nemesis";
      }).some(e => /type must be one of/.test(e))
    ).toBe(true);
  });

  it("refuses a duplicated relationship", () => {
    const errors = corrupt(s => {
      s.characterRelationships.push({ ...s.characterRelationships[0] });
    });
    expect(errors.some(e => /duplicates the relationship/.test(e))).toBe(true);
  });

  it("refuses an agenda item with an unknown kind, subject or faction", () => {
    expect(corrupt(s => { s.factionAgenda[0].kind = "resentment"; }).some(e => /kind must be one of/.test(e))).toBe(true);
    expect(corrupt(s => { s.factionAgenda[0].subject = "vibes"; }).some(e => /subject must be one of/.test(e))).toBe(true);
    expect(corrupt(s => { s.factionAgenda[0].factionId = "faction_ghost"; }).some(e => /matches no faction/.test(e))).toBe(true);
  });

  it("refuses agenda intensity outside 0..1 and non-finite", () => {
    expect(corrupt(s => { s.factionAgenda[0].intensity = 4; }).some(e => /within 0\.\.1/.test(e))).toBe(true);
    expect(corrupt(s => { s.factionAgenda[0].intensity = Number.NaN; }).some(e => /must be a finite number/.test(e))).toBe(true);
  });

  it("refuses an agenda condition whose arguments do not resolve", () => {
    expect(
      corrupt(s => {
        s.factionAgenda[0].condition = {
          predicate: "production_condition_at_least",
          nodeId: "prod_ghost",
          value: 0.5
        };
      }).some(e => /matches no production node/.test(e))
    ).toBe(true);

    expect(
      corrupt(s => {
        s.factionAgenda[0].condition = { predicate: "flag_equals", key: "x", value: "true" };
      }).some(e => /condition.value must be a boolean/.test(e))
    ).toBe(true);

    expect(
      corrupt(s => {
        s.factionAgenda[0].condition = { predicate: "run_arbitrary_code", args: [] };
      }).some(e => /predicate must be one of/.test(e))
    ).toBe(true);
  });

  it("refuses an epidemic value outside 0..1, non-finite, or with a stored stage", () => {
    expect(corrupt(s => { s.epidemic.value = 1.4; }).some(e => /within 0\.\.1/.test(e))).toBe(true);
    expect(corrupt(s => { s.epidemic.value = Number.POSITIVE_INFINITY; }).some(e => /finite number/.test(e))).toBe(true);
    // The stage is derived. A stored one would be a second copy that drifts.
    expect(corrupt(s => { s.epidemic.stage = "CRISIS"; }).some(e => /stage must not be stored/.test(e))).toBe(true);
  });

  it("refuses an epidemic contributor with an unknown cause or a broken source", () => {
    expect(corrupt(s => { s.epidemic.contributors[0].cause = "bad_luck"; }).some(e => /cause must be one of/.test(e))).toBe(true);
    expect(corrupt(s => { s.epidemic.contributors[0].source = { kind: "oracle", id: "x" }; }).some(e => /source.kind must be one of/.test(e))).toBe(true);
  });

  it("refuses a memory subject that matches no character or faction", () => {
    const state = proof() as any;
    state.party[0].memories = [
      {
        id: "mem_probe",
        summary: "probe",
        tags: [],
        turn: 1,
        source: { kind: "system", id: "test" },
        subjectId: "ghost_999"
      }
    ];
    expect(errorsOf(state).some(e => /matches no character or faction/.test(e))).toBe(true);
  });

  it("accepts a fully specified proof memory", () => {
    const state = proof() as any;
    state.party[0].memories = [
      {
        id: "mem_probe",
        summary: "probe",
        tags: ["water"],
        turn: 1,
        source: { kind: "choice", id: "c1" },
        valence: "negative",
        salience: 0.8,
        subjectId: state.party[1].id,
        origin: "reflected",
        behaviorHook: "refuse_similar_request",
        callbackEligible: true
      }
    ];
    expect(errorsOf(state)).toEqual([]);
  });

  it("refuses each malformed proof memory field", () => {
    const withMemory = (extra: Record<string, unknown>) => {
      const state = proof() as any;
      state.party[0].memories = [
        { id: "m", summary: "s", tags: [], turn: 1, source: { kind: "system", id: "t" }, ...extra }
      ];
      return errorsOf(state);
    };

    expect(withMemory({ valence: "furious" }).some(e => /valence must be one of/.test(e))).toBe(true);
    expect(withMemory({ salience: 2 }).some(e => /salience must be within/.test(e))).toBe(true);
    expect(withMemory({ origin: "telepathy" }).some(e => /origin must be one of/.test(e))).toBe(true);
    expect(withMemory({ behaviorHook: "do_whatever" }).some(e => /behaviorHook must be one of/.test(e))).toBe(true);
    expect(withMemory({ callbackEligible: "yes" }).some(e => /callbackEligible must be a boolean/.test(e))).toBe(true);
  });
});

describe("GQP-A: resolved history clocks are validated substantively", () => {
  function withHistory(entries: unknown[], turn = 6, tick = 4): unknown {
    const state = proof() as any;
    state.turn = turn;
    state.simulation.tick = tick;
    state.simulation.resolvedHistory = entries;
    return state;
  }

  const entry = (overrides: Record<string, unknown> = {}) => ({
    familyId: "scarcity_triage",
    eventId: "evt_probe",
    choiceId: "ration",
    playerTurn: 2,
    worldTick: 1,
    ...overrides
  });

  it("accepts a well-formed history", () => {
    expect(errorsOf(withHistory([entry(), entry({ playerTurn: 3, worldTick: 2 })]))).toEqual([]);
  });

  it("refuses a history entry whose clocks lead the world", () => {
    // Spec 24.1: substantive, not formal. A forged future worldTick would make
    // the quiet bound of 14.6 permanently satisfied, switching off the
    // liveness contract from inside a save file.
    expect(
      errorsOf(withHistory([entry({ worldTick: 99 })])).some(e =>
        /history cannot lead the world/.test(e)
      )
    ).toBe(true);
    expect(
      errorsOf(withHistory([entry({ playerTurn: 99 })])).some(e =>
        /history cannot lead the world/.test(e)
      )
    ).toBe(true);
  });

  it("refuses non-integer and negative clocks", () => {
    expect(errorsOf(withHistory([entry({ worldTick: 1.5 })])).some(e => /must be an integer/.test(e))).toBe(true);
    expect(errorsOf(withHistory([entry({ playerTurn: 0 })])).some(e => /must be at least 1/.test(e))).toBe(true);
    expect(errorsOf(withHistory([entry({ worldTick: -1 })])).some(e => /must be at least 0/.test(e))).toBe(true);
  });

  it("refuses history that goes backwards or repeats a Player Turn", () => {
    expect(
      errorsOf(withHistory([entry({ playerTurn: 3 }), entry({ playerTurn: 2 })])).some(e =>
        /does not follow/.test(e)
      )
    ).toBe(true);
    // One resolved decision is one Player Turn: two entries cannot share one.
    expect(
      errorsOf(withHistory([entry({ playerTurn: 2 }), entry({ playerTurn: 2 })])).some(e =>
        /does not follow/.test(e)
      )
    ).toBe(true);
    expect(
      errorsOf(
        withHistory([entry({ playerTurn: 2, worldTick: 3 }), entry({ playerTurn: 3, worldTick: 1 })])
      ).some(e => /goes back before/.test(e))
    ).toBe(true);
  });

  it("refuses a family id outside the closed set", () => {
    // Spec 12.3 rule 2: history carries what is needed to read it, and a
    // renamed or removed event must not be able to rewrite a saved past.
    expect(
      errorsOf(withHistory([entry({ familyId: "some_new_family" })])).some(e =>
        /familyId must be one of/.test(e)
      )
    ).toBe(true);
  });

  it("refuses an empty event or choice id", () => {
    expect(errorsOf(withHistory([entry({ eventId: "  " })])).some(e => /eventId must be a non-empty string/.test(e))).toBe(true);
    expect(errorsOf(withHistory([entry({ choiceId: "" })])).some(e => /choiceId must be a non-empty string/.test(e))).toBe(true);
  });
});

describe("GQP-A: pressures", () => {
  it("derives the epidemic stage rather than storing it", () => {
    expect(pressureStage(0)).toBe("STABLE");
    expect(pressureStage(0.3)).toBe("STRAINED");
    expect(pressureStage(0.6)).toBe("CRITICAL");
    expect(pressureStage(0.9)).toBe("CRISIS");
    expect(epidemicStage(proofSimulation(proof()).epidemic)).toBe("STABLE");
  });

  it("refuses to classify a non-finite pressure", () => {
    expect(() => pressureStage(Number.NaN)).toThrow(/finite value/);
  });

  it("derives infrastructure pressure from node state with no stored counter", () => {
    const state = proof();
    const simulation = proofSimulation(state);

    // Spec 9.2: no parallel counter. The value comes from the nodes.
    expect(Object.keys(simulation)).not.toContain("infrastructure");

    const node = simulation.productionNodes[0]!;
    const before = settlementInfrastructurePressure(state, "settlement_helios");
    expect(before).toBeCloseTo(1 - node.condition * node.efficiency, 10);

    // A repaired node lowers the pressure; a disabled one maximises it.
    expect(deriveInfrastructurePressure([{ ...node, condition: 1, efficiency: 1 }])).toBe(0);
    expect(deriveInfrastructurePressure([{ ...node, enabled: false }])).toBe(1);
    // No production at all is maximum pressure, not none.
    expect(deriveInfrastructurePressure([])).toBe(1);
  });

  it("tracks the authoritative node state as the World Tick changes it", () => {
    const state = proof();
    const damaged = structuredClone(state);
    damaged.simulation!.productionNodes[0]!.condition = 0.2;

    expect(settlementInfrastructurePressure(damaged, "settlement_helios")).toBeGreaterThan(
      settlementInfrastructurePressure(state, "settlement_helios")
    );
  });
});

describe("GQP-A: agenda conditions are typed predicates over authoritative state", () => {
  it("reads the authority, and reports each predicate deterministically", () => {
    const state = proof();
    const simulation = proofSimulation(state);

    const reliability = simulation.factionAgenda.find(i => i.id === "agenda_co_reliability")!;
    // The recycler opens below the Council's threshold: the desire is unmet.
    expect(agendaConditionHolds(reliability.condition, state)).toBe(false);

    const repaired = structuredClone(state);
    repaired.simulation!.productionNodes[0]!.condition = 0.95;
    expect(agendaConditionHolds(reliability.condition, repaired)).toBe(true);
  });

  it("refuses to treat an unresolvable reference as satisfied", () => {
    const state = proof();
    expect(
      agendaConditionHolds(
        { predicate: "production_condition_at_least", nodeId: "prod_ghost", value: 0 },
        state
      )
    ).toBe(false);
  });

  it("compares flags strictly", () => {
    const state = proof();
    state.flags.conduit_registered = "true";
    expect(
      agendaConditionHolds({ predicate: "flag_equals", key: "conduit_registered", value: true }, state)
    ).toBe(false);

    state.flags.conduit_registered = true;
    expect(
      agendaConditionHolds({ predicate: "flag_equals", key: "conduit_registered", value: true }, state)
    ).toBe(true);
  });

  it("reads resources through the authority, not the projection", () => {
    const state = proof();
    const condition = {
      predicate: "resource_stock_at_least",
      settlementId: "settlement_helios",
      resourceKey: "water",
      amount: 20
    } as const;

    expect(agendaConditionHolds(condition, state)).toBe(false);

    // Raising only the projection must change nothing: it is a mirror.
    state.resources.water = 500;
    expect(agendaConditionHolds(condition, state)).toBe(false);

    state.simulation!.settlements[0]!.resourceStock.water = 500;
    expect(agendaConditionHolds(condition, state)).toBe(true);
  });

  it("reports which items of a faction currently hold", () => {
    const state = proof();
    const simulation = proofSimulation(state);
    const council = simulation.factionAgenda.filter(i => i.factionId === "faction_compact");

    expect(satisfiedAgendaItems(council, state)).toEqual([]);
    state.flags.conduit_registered = true;
    expect(satisfiedAgendaItems(council, state).map(i => i.id)).toEqual([
      "agenda_co_unregistered_access"
    ]);
  });
});

describe("GQP-A: determinism and round trip", () => {
  it("produces the same world from the same seed", () => {
    expect(JSON.stringify(createGqpScenario(7419))).toBe(JSON.stringify(createGqpScenario(7419)));
    expect(createGqpScenario(7419)).toEqual(createGqpScenario(7419));
  });

  it("produces a different world from a different seed, and files it separately", () => {
    expect(createGqpScenario(7419).campaignId).not.toBe(createGqpScenario(4201).campaignId);
    // And a proof run is never filed under a baseline run's key.
    expect(createGqpScenario(7419).campaignId).not.toBe(createSystemicScenario(7419).campaignId);
  });

  it("survives a JSON round trip with every proof contract intact", () => {
    const state = proof();
    const reloaded = JSON.parse(JSON.stringify(state)) as WorldState;

    expect(validateSystemicWorldState(reloaded).ok).toBe(true);
    expect(reloaded).toEqual(state);
    expect(proofSimulation(reloaded).factionAgenda).toEqual(proofSimulation(state).factionAgenda);
  });

  it("replays a mixed sequence of decisions and ticks identically", () => {
    const run = (): WorldState => {
      let state = createGqpScenario(7419);
      for (let i = 0; i < 4; i += 1) {
        state = resolveChoice(
          state,
          { id: `c${i}`, label: "C", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
          "replay"
        ).state;
        state = runWorldTick(state).state;
      }
      return state;
    };

    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(validateSystemicWorldState(a).ok).toBe(true);
    // Still a proof world after eight Core operations, and still not migrated.
    expect(a.simulation!.schemaVersion).toBe(PROOF_SCHEMA_VERSION);
  });

  it("keeps no pacing state in the persisted world", () => {
    // Spec 4.3: GameplayFocus is a rhythm concept, not authoritative state. It
    // is not persisted, so a beat cannot be replayed into a Player Turn.
    const serialised = JSON.stringify(proof());
    expect(serialised).not.toMatch(/"focus"/);
    expect(serialised).not.toMatch(/"quiet"/);
    expect(serialised).not.toMatch(/beat/i);
  });
});

/**
 * Regressions for the three boundary defects found by external audit on
 * `ccf2e45`, each reproduced before it was fixed.
 *
 * The reason all three survived a green suite with mutation coverage is worth
 * recording, because it is a lesson about how these tests were written rather
 * than about the code. Every assertion in the original slice was aimed at what
 * the implementation did: the proof validator checked `kind` and `id`, so the
 * tests checked `kind` and `id`. A test written from the code cannot find a
 * contract the code never implemented. These are written from the contract.
 */
describe("audit regressions: contract boundaries the first pass missed", () => {
  const hostileSource = {
    kind: "system",
    id: "gqp_scenario_bootstrap",
    tick: -1,
    actorId: 123,
    rule: { invalid: true }
  };

  /**
   * A01. The proof validator carried its own `CausalSource` check and it was
   * weaker than the one M1 already had: the same payload was refused on a
   * delayed consequence and accepted on a faction agenda item. Two
   * implementations of one contract, diverging — the exact defect class GQP-0
   * exists to remove, reintroduced three slices later.
   *
   * The fix is not "check the optionals here too". It is that
   * `validateCausalSource` is now the only implementation, so a future
   * collection cannot acquire a third opinion.
   */
  it("applies one CausalSource contract to every collection that carries one", () => {
    const withSource = (place: (state: any) => void): string[] => {
      const state = proof() as any;
      place(state);
      return errorsOf(state);
    };

    const agenda = withSource(s => Object.assign(s.simulation.factionAgenda[0].source, hostileSource));
    const epidemic = withSource(s =>
      Object.assign(s.simulation.epidemic.contributors[0].source, hostileSource)
    );
    const memory = withSource(s => {
      s.party[0].memories = [
        { id: "m", summary: "s", tags: [], turn: 1, source: { ...hostileSource } }
      ];
    });

    for (const errors of [agenda, epidemic, memory]) {
      expect(errors.some(e => /actorId must be a string, got number/.test(e))).toBe(true);
      expect(errors.some(e => /rule must be a string, got object/.test(e))).toBe(true);
      expect(errors.some(e => /tick must be at least 0/.test(e))).toBe(true);
    }
  });

  it("rejects each malformed causal field on a proof collection", () => {
    const agendaSource = (source: Record<string, unknown>): string[] => {
      const state = proof() as any;
      state.simulation.factionAgenda[0].source = source;
      return errorsOf(state);
    };
    const base = { kind: "system", id: "x" };

    expect(agendaSource({ ...base, tick: 1.5 }).some(e => /tick must be an integer/.test(e))).toBe(true);
    expect(agendaSource({ ...base, actorId: "  " }).some(e => /actorId must not be empty/.test(e))).toBe(true);
    expect(agendaSource({ ...base, rule: "" }).some(e => /rule must not be empty/.test(e))).toBe(true);
    expect(agendaSource({ kind: "oracle", id: "x" }).some(e => /kind must be one of/.test(e))).toBe(true);
    expect(agendaSource({ kind: "system", id: " " }).some(e => /id must not be empty/.test(e))).toBe(true);
    expect(agendaSource({ ...base }).filter(e => /source/.test(e))).toEqual([]);
  });

  /**
   * A02. History accepted an entry claiming the turn the world is currently
   * sitting on.
   *
   * Spec 12.3 rule 3 makes `playerTurn` the turn a decision came *from*, and
   * resolving carries the world to `turn + 1` — so a world at turn T cannot
   * hold a decision resolved at T. Spec 14.3 then derives repetition as
   * `elapsed = turn - lastResolved.playerTurn` and states that `1` is the
   * minimum possible value. Equality admitted `elapsed = 0`: a distance the
   * model calls unreachable, producing the maximum repetition penalty from a
   * world that has decided nothing.
   */
  it("refuses a history entry claiming the turn still open", () => {
    const fresh = proof() as any;
    expect(fresh.turn).toBe(1);
    fresh.simulation.resolvedHistory = [
      {
        familyId: "scarcity_triage",
        eventId: "evt",
        choiceId: "c",
        playerTurn: fresh.turn,
        worldTick: fresh.simulation.tick
      }
    ];

    // A brand new world has resolved nothing, so no entry can be legal in it.
    expect(errorsOf(fresh).some(e => /the last resolved Player Turn/.test(e))).toBe(true);
  });

  it("accepts the turn before, and keeps elapsed at its documented minimum", () => {
    const state = proof() as any;
    state.turn = 4;
    state.simulation.tick = 2;
    state.simulation.resolvedHistory = [
      {
        familyId: "scarcity_triage",
        eventId: "evt",
        choiceId: "c",
        playerTurn: state.turn - 1,
        worldTick: 2
      }
    ];

    expect(errorsOf(state)).toEqual([]);
    // Spec 14.3: the value immediately after resolving, and the smallest one.
    const elapsed = state.turn - state.simulation.resolvedHistory[0].playerTurn;
    expect(elapsed).toBe(1);
  });

  it("keeps a real resolved decision valid end to end", () => {
    // The rule has to admit the history the Core itself will write. A choice
    // resolved at turn 1 leaves the world at turn 2, and that entry validates.
    const resolved = resolveChoice(
      proof(),
      { id: "ration", label: "RATION", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
      "test"
    );
    const state = resolved.state as any;
    expect(state.turn).toBe(2);
    expect(resolved.delta.turn).toBe(1);

    state.simulation.resolvedHistory = [
      {
        familyId: "scarcity_triage",
        eventId: "evt",
        choiceId: "ration",
        // Exactly what spec 12.3 rule 3 says to write: the delta's turn.
        playerTurn: resolved.delta.turn,
        worldTick: state.simulation.tick
      }
    ];
    expect(errorsOf(state)).toEqual([]);
  });

  /**
   * A07. `flag_equals` accepted a `nodeId`, which belongs to a different
   * predicate, and the comment above the validator claimed it could not.
   *
   * The argument set is closed only here. The rest of this boundary tolerates
   * unknown keys, and spec 24.1 names that tolerance as the reason the proof
   * needed a version bump rather than optional fields — so this is a scoped
   * exception for the one contract 13.1 requires to be a typed predicate, not
   * a new policy for the whole validator.
   */
  it("refuses an argument belonging to a different predicate", () => {
    const withCondition = (condition: Record<string, unknown>): string[] => {
      const state = proof() as any;
      state.simulation.factionAgenda[0].condition = condition;
      return errorsOf(state);
    };

    const errors = withCondition({
      predicate: "flag_equals",
      key: "conduit_registered",
      value: true,
      nodeId: 123
    });
    expect(errors.some(e => /nodeId is not an argument of flag_equals/.test(e))).toBe(true);
    expect(errors.some(e => /accepted: key, value/.test(e))).toBe(true);

    // Each variant rejects the others' arguments, not just this one pair.
    expect(
      withCondition({
        predicate: "production_condition_at_least",
        nodeId: "prod_recycler_01",
        value: 0.5,
        key: "smuggled"
      }).some(e => /key is not an argument of production_condition_at_least/.test(e))
    ).toBe(true);

    expect(
      withCondition({
        predicate: "political_approval_at_least",
        groupId: "group_labor",
        value: 0.5,
        amount: 3
      }).some(e => /amount is not an argument of political_approval_at_least/.test(e))
    ).toBe(true);
  });

  it("still accepts every well-formed predicate variant", () => {
    const variants = [
      { predicate: "production_condition_at_least", nodeId: "prod_recycler_01", value: 0.8 },
      {
        predicate: "resource_stock_at_least",
        settlementId: "settlement_helios",
        resourceKey: "water",
        amount: 10
      },
      { predicate: "political_approval_at_least", groupId: "group_labor", value: 0.6 },
      { predicate: "flag_equals", key: "conduit_registered", value: true }
    ];

    for (const condition of variants) {
      const state = proof() as any;
      state.simulation.factionAgenda[0].condition = condition;
      expect(errorsOf(state)).toEqual([]);
      // And the evaluator still reads it without throwing.
      expect(typeof agendaConditionHolds(condition as any, state)).toBe("boolean");
    }
  });

  /**
   * The scenario the proof ships must satisfy every rule tightened above. A
   * boundary that refuses its own content is a boundary nobody will keep.
   */
  it("leaves the shipped proof scenario valid under all three tightened rules", () => {
    expect(errorsOf(proof())).toEqual([]);
    expect(errorsOf(createGqpScenario(4201))).toEqual([]);
  });
});

/**
 * `resource_stock_at_least` means one settlement's own stock.
 *
 * It used to resolve the settlement and then read through
 * `readAuthoritativeResource`, which resolves its own target from the key —
 * so `settlementId` decided nothing. A key the settlement does not stock fell
 * through to the campaign map. With one settlement in the scenario the two
 * readings agree for `water` by coincidence, which is why it survived a green
 * suite; the coincidence ends at the second settlement, or at any campaign
 * resource.
 */
describe("R39-1: the named settlement governs the reading", () => {
  const condition = (overrides: Record<string, unknown> = {}) =>
    ({
      predicate: "resource_stock_at_least",
      settlementId: "settlement_helios",
      resourceKey: "water",
      amount: 20,
      ...overrides
    }) as any;

  it("reads that settlement's water", () => {
    const state = proof();
    expect(agendaConditionHolds(condition(), state)).toBe(false);

    state.simulation!.settlements[0]!.resourceStock.water = 25;
    expect(agendaConditionHolds(condition(), state)).toBe(true);

    state.simulation!.settlements[0]!.resourceStock.water = 19.9999;
    expect(agendaConditionHolds(condition(), state)).toBe(false);
  });

  it("ignores the projection entirely", () => {
    const state = proof();
    // `WorldState.resources` mirrors the stock; it is not the authority and it
    // must not be able to answer this question.
    state.resources.water = 10_000;
    expect(agendaConditionHolds(condition(), state)).toBe(false);

    state.simulation!.settlements[0]!.resourceStock.water = 20;
    state.resources.water = 0;
    expect(agendaConditionHolds(condition(), state)).toBe(true);
  });

  it("cannot be satisfied by a campaign resource the settlement does not stock", () => {
    const state = proof();
    // `credits` is authoritative in the flat map — no settlement holds it.
    expect("credits" in state.simulation!.settlements[0]!.resourceStock).toBe(false);
    expect(state.resources.credits).toBeGreaterThan(20);

    // This is the defect stated as a test: Helios plus `credits` used to be
    // satisfied by campaign credits Helios does not have.
    expect(
      agendaConditionHolds(condition({ resourceKey: "credits", amount: 20 }), state)
    ).toBe(false);
  });

  it("does not read an unstocked resource as zero of it", () => {
    // The distinction only shows at `amount: 0`, which is a legal condition:
    // "at least zero credits" is trivially true of a settlement that holds
    // credits and meaningless for one that does not. Treating an absent key as
    // `0` would satisfy a Council desire about a resource Helios has no
    // relationship with at all.
    //
    // `agendaConditionHolds` is exported, so it has to hold this on its own —
    // the validator refusing such a condition in a save is a second line, not
    // the first one.
    const state = proof();
    expect("credits" in state.simulation!.settlements[0]!.resourceStock).toBe(false);

    expect(agendaConditionHolds(condition({ resourceKey: "credits", amount: 0 }), state)).toBe(false);
    // A resource it does stock, at zero, is genuinely satisfied.
    state.simulation!.settlements[0]!.resourceStock.medicine = 0;
    state.resources.medicine = 0;
    expect(agendaConditionHolds(condition({ resourceKey: "medicine", amount: 0 }), state)).toBe(true);
  });

  it("refuses a settlement that does not exist", () => {
    expect(
      agendaConditionHolds(condition({ settlementId: "settlement_ghost", amount: 0 }), proof())
    ).toBe(false);
  });

  it("distinguishes two settlements holding the same resource", () => {
    // The clearest statement of what the argument is for. One settlement is
    // full and the other is empty; the condition must follow the id.
    const state = proof();
    const helios = state.simulation!.settlements[0]!;
    const second = structuredClone(helios);
    second.id = "settlement_second";
    second.resourceStock = { ...helios.resourceStock, water: 500 };
    second.productionNodeIds = [];
    second.cohortIds = [];
    second.politicalGroupIds = [];
    state.simulation!.settlements = [helios, second];

    expect(agendaConditionHolds(condition({ amount: 100 }), state)).toBe(false);
    expect(
      agendaConditionHolds(condition({ settlementId: "settlement_second", amount: 100 }), state)
    ).toBe(true);
  });

  it("refuses a save whose condition names a resource that settlement never stocks", () => {
    // An agenda item nothing can ever resolve is a content defect frozen into a
    // save. Better a rejected save than a faction stuck forever, silently.
    const state = proof() as any;
    state.simulation.factionAgenda[0].condition = condition({ resourceKey: "credits" });

    const errors = errorsOf(state);
    expect(errors.some(e => /is not stocked by settlement 'settlement_helios'/.test(e))).toBe(true);
    expect(errors.some(e => /could never be satisfied/.test(e))).toBe(true);
  });

  it("accepts a condition on a resource that settlement does stock", () => {
    const state = proof() as any;
    state.simulation.factionAgenda[0].condition = condition({ resourceKey: "medicine" });
    expect(errorsOf(state)).toEqual([]);
  });
});

/**
 * The proof crosses the real persistence boundary, not a JSON round trip.
 *
 * `JSON.parse(JSON.stringify(state))` proves the shape survives structured
 * cloning. It does not prove the boundary accepts the world back: that path
 * runs through `serializeSystemicWorldState`, which validates on the way out
 * and refuses to write anything the loader would refuse, and
 * `loadSystemicWorldState`, which validates on the way in and checks the
 * campaign identity. GQP-A's stated exit is a deterministic round trip on a
 * real file, so it has to be tested at that boundary.
 */
describe("R39-2: the proof exits and re-enters through the persistence boundary", () => {
  function saved(state: WorldState) {
    const outcome = serializeSystemicWorldState(state);
    if (!outcome.ok) throw new Error(`serialize refused: ${outcome.errors.join("; ")}`);
    return outcome;
  }

  function reloaded(payload: string, campaignId: string): WorldState {
    const outcome = loadSystemicWorldState(payload, campaignId);
    if (!outcome.ok) throw new Error(`load refused: ${outcome.reason} ${outcome.errors.join("; ")}`);
    return outcome.state;
  }

  it("returns the same v2 world, contracts intact", () => {
    const state = proof();
    const stored = saved(state);
    expect(stored.campaignId).toBe(state.campaignId);

    const back = reloaded(stored.payload, stored.campaignId);
    expect(back).toEqual(state);

    const simulation = proofSimulation(back);
    expect(simulation.schemaVersion).toBe(PROOF_SCHEMA_VERSION);
    expect(simulation.factionAgenda).toEqual(proofSimulation(state).factionAgenda);
    expect(simulation.characterRelationships).toEqual(proofSimulation(state).characterRelationships);
    expect(simulation.epidemic).toEqual(proofSimulation(state).epidemic);
    expect(simulation.resolvedHistory).toEqual([]);
    expect(back.party.map(c => [c.coreValue, c.currentGoal])).toEqual(
      state.party.map(c => [c.coreValue, c.currentGoal])
    );
  });

  it("plays on identically after the round trip", () => {
    // The exit criterion: a world that came off disk decides and ticks exactly
    // as the one that never left.
    const play = (start: WorldState): WorldState => {
      let current = start;
      for (let i = 0; i < 3; i += 1) {
        current = resolveChoice(
          current,
          { id: `c${i}`, label: "C", effects: [{ type: "PRESSURE_DELTA", value: 1 }] },
          "round-trip"
        ).state;
        current = runWorldTick(current).state;
      }
      return current;
    };

    const direct = play(proof());
    const stored = saved(proof());
    const afterDisk = play(reloaded(stored.payload, stored.campaignId));

    expect(JSON.stringify(afterDisk)).toBe(JSON.stringify(direct));

    // And the world that has been played is itself still storable.
    const again = saved(afterDisk);
    expect(reloaded(again.payload, again.campaignId)).toEqual(afterDisk);
  });

  it("keeps a v1 baseline world v1 across the same boundary", () => {
    const baseline = createSystemicScenario(7419);
    const stored = saved(baseline);
    const back = reloaded(stored.payload, stored.campaignId);

    expect(back).toEqual(baseline);
    expect(back.simulation!.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    expect(isProofSimulation(back.simulation!)).toBe(false);
  });

  it("refuses a schema the build cannot read, at the load boundary", () => {
    const stored = saved(proof());
    const tampered = stored.payload.replace('"schemaVersion":2', '"schemaVersion":3');
    expect(tampered).not.toBe(stored.payload);

    const outcome = loadSystemicWorldState(tampered, stored.campaignId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason).toBe("invalid_world_state");
    expect(outcome.errors.some(e => /Unsupported simulation schema 3/.test(e))).toBe(true);
  });

  it("refuses a v1 payload carrying proof fields, at the load boundary", () => {
    const baseline = createSystemicScenario(7419) as any;
    const stored = saved(baseline);
    // Injected into the stored bytes, which is where a tampered save lives.
    const tampered = stored.payload.replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"epidemic":{"value":0.5,"contributors":[]}'
    );

    const outcome = loadSystemicWorldState(tampered, stored.campaignId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(
      outcome.errors.some(e => /schema v2 state and must not appear at schema v1/.test(e))
    ).toBe(true);
  });

  it("refuses a v2 payload with a corrupted causal source, at the load boundary", () => {
    const stored = saved(proof());
    const tampered = stored.payload.replace(
      '"id":"gqp_scenario_bootstrap"',
      '"id":"gqp_scenario_bootstrap","actorId":123'
    );
    expect(tampered).not.toBe(stored.payload);

    const outcome = loadSystemicWorldState(tampered, stored.campaignId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.errors.some(e => /actorId must be a string, got number/.test(e))).toBe(true);
  });

  it("refuses to write a proof world it would later refuse to read", () => {
    // Save and load enforce the same contract, so a world that cannot come
    // back never reaches the disk. Failing at save costs one refused click;
    // failing at load costs the campaign.
    const broken = proof() as any;
    broken.simulation.characterRelationships[0].targetCharacterId = "ghost_999";

    const outcome = serializeSystemicWorldState(broken);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.errors.some(e => /matches no party character/.test(e))).toBe(true);
  });

  it("refuses a payload filed under another campaign's key", () => {
    const stored = saved(proof());
    const outcome = loadSystemicWorldState(stored.payload, "cmp_7419");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason).toBe("campaign_identity_mismatch");
  });

  /**
   * The bytes the Rust transport test carries.
   *
   * The desktop side stores and returns an opaque string; it must never parse
   * or reshape a world. To prove that on a real file without teaching Rust what
   * a `WorldState` is, both sides share one committed fixture: this test keeps
   * the fixture equal to what the boundary produces today, and the Rust test
   * proves file-backed SQLite hands those exact bytes back.
   *
   * If the proof scenario changes, this fails and the fixture is regenerated —
   * which is the point. A stale fixture would let the transport test pass on a
   * payload nothing produces any more.
   */
  it("matches the committed fixture the desktop transport test carries", () => {
    const fixture = readFileSync(
      fileURLToPath(new URL("../../../fixtures/gqp-v2-save.json", import.meta.url)),
      "utf8"
    );
    expect(saved(proof()).payload).toBe(fixture);

    // And the fixture is a world this build accepts, not just a matching string.
    const back = loadSystemicWorldState(fixture, `gqp_${7419}`);
    expect(back.ok).toBe(true);
  });
});
