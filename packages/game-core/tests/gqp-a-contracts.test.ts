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
