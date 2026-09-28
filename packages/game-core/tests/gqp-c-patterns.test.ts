import { describe, expect, it } from "vitest";
import type { EventEffect, ProofEvent, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  applyDueConsequences,
  createGqpScenario,
  createSystemicScenario,
  detectPatterns,
  evaluateProofPredicate,
  factionDebtCount,
  isPatternDetected,
  loadSystemicWorldState,
  resolveProofChoice,
  runWorldTick,
  serializeSystemicWorldState,
  validateProofCatalogue
} from "../src";

/**
 * The four GQP-C pattern detectors (spec 12), each proven by counterfactual
 * pairs: the same world, differing in one condition the detector is supposed
 * to read, and the match flipping for exactly that reason.
 *
 * The worlds are produced by the real resolver, the real delayed-consequence
 * engine and the real World Tick from the proof seed -- never assembled by
 * hand -- so a detector is tested on state the game can actually produce.
 */

const CATALOGUE = GQP_PROOF_EVENTS;

function decide(state: WorldState, eventId: string, choiceId: string, catalogue: readonly ProofEvent[] = CATALOGUE): WorldState {
  return applyDueConsequences(resolveProofChoice(state, catalogue, eventId, choiceId).state).state;
}

function tick(state: WorldState, times = 1): WorldState {
  let world = state;
  for (let i = 0; i < times; i += 1) world = runWorldTick(world).state;
  return world;
}

const start = () => createGqpScenario(7419);

function matchesOf(state: WorldState, pattern: string) {
  return detectPatterns(state).filter(match => match.pattern === pattern);
}

describe("IGNORED_TECHNICAL_WARNINGS", () => {
  // Same world: the recycler warning was patched over once.
  const patched = () => decide(start(), "evt_f2_recycler_warning", "patch_and_defer");

  it("is not a pattern after a single overruled warning", () => {
    expect(matchesOf(patched(), "IGNORED_TECHNICAL_WARNINGS")).toEqual([]);
  });

  it("flips on the second overruling, and not on a heeded second warning", () => {
    const ignored = decide(patched(), "evt_f2_tarek_second_warning", "let_it_ride");
    const heeded = decide(patched(), "evt_f2_tarek_second_warning", "authorize_inspection");
    expect(isPatternDetected(ignored, "IGNORED_TECHNICAL_WARNINGS", "tarek_001")).toBe(true);
    expect(isPatternDetected(heeded, "IGNORED_TECHNICAL_WARNINGS")).toBe(false);
  });

  it("names the decisions and the memories that support it", () => {
    const ignored = decide(patched(), "evt_f2_tarek_second_warning", "let_it_ride");
    const [match] = matchesOf(ignored, "IGNORED_TECHNICAL_WARNINGS");
    expect(match!.subject).toBe("tarek_001");
    expect(match!.evidence).toEqual([
      { kind: "decision", familyId: "maintenance", eventId: "evt_f2_recycler_warning", choiceId: "patch_and_defer", playerTurn: 1, worldTick: 0 },
      { kind: "memory", characterId: "tarek_001", memoryId: "fact_f2_warning_ignored", valence: "negative", behaviorHook: "offer_unprompted_warning" },
      { kind: "decision", familyId: "maintenance", eventId: "evt_f2_tarek_second_warning", choiceId: "let_it_ride", playerTurn: 2, worldTick: 0 },
      { kind: "memory", characterId: "tarek_001", memoryId: "fact_f2_warning_dismissed", valence: "negative", behaviorHook: "refuse_similar_request" }
    ]);
  });

  it("reads the technician by core value, never by name or role label", () => {
    const ignored = decide(patched(), "evt_f2_tarek_second_warning", "let_it_ride");
    const relabelled = structuredClone(ignored);
    const tarek = relabelled.party.find(character => character.id === "tarek_001")!;
    tarek.role = "Poet";
    tarek.name = "Someone Else";
    expect(isPatternDetected(relabelled, "IGNORED_TECHNICAL_WARNINGS", "tarek_001")).toBe(true);
    tarek.coreValue = "community_voice";
    expect(isPatternDetected(relabelled, "IGNORED_TECHNICAL_WARNINGS")).toBe(false);
  });
});

describe("REPEATED_PROTECTION_OR_NEGLECT", () => {
  // The epidemic reaches STRAINED after two World Ticks from the proof seed.
  const strained = () => tick(start(), 2);

  it("reads protection from two decisions, and not from one", () => {
    const supplied = decide(strained(), "evt_f1_clinic_request", "treat_now");
    expect(matchesOf(supplied, "REPEATED_PROTECTION_OR_NEGLECT")).toEqual([]);

    // Same world, one condition: back the drive, or keep Ira at the clinic.
    const backed = decide(supplied, "evt_f1_ira_prevention_drive", "back_the_drive");
    const kept = decide(supplied, "evt_f1_ira_prevention_drive", "keep_ira_at_the_clinic");
    expect(isPatternDetected(backed, "REPEATED_PROTECTION_OR_NEGLECT", "protection")).toBe(true);
    expect(isPatternDetected(kept, "REPEATED_PROTECTION_OR_NEGLECT")).toBe(false);
  });

  it("reads neglect from two decisions that left the carers' cost on record", () => {
    const refused = decide(tick(start(), 5), "evt_f1_clinic_request", "protect_reserve");
    expect(matchesOf(refused, "REPEATED_PROTECTION_OR_NEGLECT")).toEqual([]);
    const endured = decide(refused, "evt_f1_outbreak", "ride_it_out");
    const treated = decide(refused, "evt_f1_outbreak", "full_treatment_campaign");
    expect(isPatternDetected(endured, "REPEATED_PROTECTION_OR_NEGLECT", "neglect")).toBe(true);
    expect(isPatternDetected(endured, "REPEATED_PROTECTION_OR_NEGLECT", "protection")).toBe(false);
    expect(isPatternDetected(treated, "REPEATED_PROTECTION_OR_NEGLECT")).toBe(false);
  });

  it("counts only community-facing families: a maintenance decision that darkened the clinic is not triage", () => {
    // divert_clinic_power (maintenance) leaves Ira a salient negative memory,
    // exactly like a triage refusal would -- but it is not a triage decision.
    const diverted = decide(start(), "evt_f2_recycler_warning", "divert_clinic_power");
    const refused = decide(tick(diverted, 2), "evt_f1_clinic_request", "protect_reserve");
    expect(isPatternDetected(refused, "REPEATED_PROTECTION_OR_NEGLECT")).toBe(false);
  });
});

describe("FACTION_DEPENDENCY_GROWING", () => {
  // Contract-level catalogue: two independent requests for help from the same
  // faction, and one from the other. The real F5 network is proven in the
  // pacing suites; here only the counting is under test.
  const debt = (memoryId: string, subjectId: string): EventEffect => ({
    type: "MEMORY_RECORD",
    characterId: "brann_001",
    memoryId,
    subjectId,
    valence: "ambivalent",
    salience: 0.7,
    exposure: "private",
    behaviorHook: "call_in_debt",
    callbackEligible: true,
    summary: "We owe them.",
    tags: ["debt"]
  });
  const ask = (id: string, memoryId: string, subjectId: string): ProofEvent => ({
    id,
    familyId: "external_rescue",
    taxonomy: "DILEMMA",
    eligibility: [],
    presentation: { title: "Help", body: "help" },
    choices: [
      { id: "accept", label: "Accept", effects: [{ type: "RESOURCE_DELTA", key: "water", value: 4 }, debt(memoryId, subjectId)], disclosure: { risks: ["political"], unknowns: ["price"] } },
      { id: "refuse", label: "Refuse", effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["cost"] } }
    ]
  });
  const RESCUES: ProofEvent[] = [
    ask("evt_x_front_1", "fact_x_front_1", "faction_front"),
    ask("evt_x_front_2", "fact_x_front_2", "faction_front"),
    ask("evt_x_compact_1", "fact_x_compact_1", "faction_compact")
  ];

  it("passes the catalogue gate", () => {
    expect(validateProofCatalogue(RESCUES, start())).toEqual({ ok: true, errors: [] });
  });

  it("is nothing at zero debts, an initial debt at one, a growing dependency at two", () => {
    const zero = start();
    const one = decide(zero, "evt_x_front_1", "accept", RESCUES);
    const two = decide(one, "evt_x_front_2", "accept", RESCUES);
    expect([0, 1, 2].map(n => [zero, one, two][n]!).map(w => factionDebtCount(w, "faction_front"))).toEqual([0, 1, 2]);
    expect(isPatternDetected(zero, "FACTION_DEPENDENCY_GROWING")).toBe(false);
    expect(isPatternDetected(one, "FACTION_DEPENDENCY_GROWING")).toBe(false);
    expect(isPatternDetected(two, "FACTION_DEPENDENCY_GROWING", "faction_front")).toBe(true);
    expect(isPatternDetected(two, "FACTION_DEPENDENCY_GROWING", "faction_compact")).toBe(false);
  });

  it("does not add debts to different factions together", () => {
    const one = decide(start(), "evt_x_front_1", "accept", RESCUES);
    const mixed = decide(one, "evt_x_compact_1", "accept", RESCUES);
    expect(isPatternDetected(mixed, "FACTION_DEPENDENCY_GROWING")).toBe(false);
  });

  it("counts a refusal as no debt: same world, one condition", () => {
    const one = decide(start(), "evt_x_front_1", "accept", RESCUES);
    expect(isPatternDetected(decide(one, "evt_x_front_2", "refuse", RESCUES), "FACTION_DEPENDENCY_GROWING")).toBe(false);
    expect(isPatternDetected(decide(one, "evt_x_front_2", "accept", RESCUES), "FACTION_DEPENDENCY_GROWING")).toBe(true);
  });
});

describe("SECRET_ACTION_DISCOVERED", () => {
  // Same world: the League line is spliced in quietly at turn 1; its strain on
  // the recycler falls due at turn 4. Turn 2 decides whether Tarek is put to
  // work on the recycler after the splice; turn 3 lands the strain.
  const tapped = () => decide(start(), "evt_f3_conduit_offer", "tap_quietly");
  const involved = () => decide(tapped(), "evt_f2_recycler_warning", "patch_and_defer");
  const uninvolved = () => decide(tapped(), "evt_f2_recycler_warning", "divert_clinic_power");
  const land = (world: WorldState) => decide(tick(world, 2), "evt_f1_clinic_request", "treat_now");
  const strain = "con.evt_f3_conduit_offer.tap_quietly.strain";

  it("finds nothing before the secret leaves a trace", () => {
    expect(matchesOf(involved(), "SECRET_ACTION_DISCOVERED")).toEqual([]);
  });

  it("is discovered when the strain lands and the technician worked the bus after the splice -- and stays secret when nobody who could read it was near", () => {
    const found = land(involved());
    const kept = land(uninvolved());
    for (const world of [found, kept]) {
      expect(world.simulation!.delayedConsequences.find(item => item.id === strain)?.status).toBe("applied");
    }
    expect(isPatternDetected(found, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap")).toBe(true);
    expect(isPatternDetected(kept, "SECRET_ACTION_DISCOVERED")).toBe(false);
  });

  it("reads nothing through an observer already turned away when he was put to work", () => {
    // The `found` world, one condition changed: Tarek had refused a request
    // before turn 2, when the patch put him on the bus.
    const turned = land(involved());
    const tarek = turned.party.find(character => character.id === "tarek_001")!;
    tarek.memories = [
      ...tarek.memories!,
      { ...tarek.memories!.find(memory => memory.id === "fact_f2_warning_ignored")!, id: "fact_x_turned_away", turn: 1, behaviorHook: "refuse_similar_request" }
    ];
    expect(isPatternDetected(turned, "SECRET_ACTION_DISCOVERED")).toBe(false);
  });

  it("explains the discovery by the decision, the fact, the trace, the involvement and the observer", () => {
    const [match] = matchesOf(land(involved()), "SECRET_ACTION_DISCOVERED");
    expect(match!.evidence).toEqual([
      { kind: "decision", familyId: "unregistered_conduit", eventId: "evt_f3_conduit_offer", choiceId: "tap_quietly", playerTurn: 1, worldTick: 0 },
      { kind: "memory", characterId: "mara_001", memoryId: "fact_f3_secret_tap", valence: "ambivalent", behaviorHook: "call_in_debt" },
      { kind: "consequence", consequenceId: "con.evt_f3_conduit_offer.tap_quietly.strain", triggerTurn: 4, status: "applied" },
      { kind: "memory", characterId: "tarek_001", memoryId: "fact_f2_warning_ignored", valence: "negative", behaviorHook: "offer_unprompted_warning" },
      { kind: "observer", characterId: "tarek_001", coreValue: "technical_integrity" }
    ]);
  });

  it("does not undo a discovery when the observer turns later", () => {
    // Tarek is told to keep a failing pump running -- after he found the line.
    const dismissed = decide(land(involved()), "evt_f2_tarek_second_warning", "let_it_ride");
    const tarek = dismissed.party.find(character => character.id === "tarek_001")!;
    expect(tarek.memories!.some(memory => memory.behaviorHook === "refuse_similar_request")).toBe(true);
    expect(isPatternDetected(dismissed, "SECRET_ACTION_DISCOVERED", "fact_f3_secret_tap")).toBe(true);
  });

  it("is not a discovery once the secret has been published by a decision", () => {
    const disclosed = decide(decide(start(), "evt_f3_conduit_offer", "tap_quietly"), "evt_f3_debt_called", "disclose_and_register");
    const later = decide(disclosed, "evt_f2_recycler_warning", "full_maintenance");
    expect(later.simulation!.delayedConsequences.find(item => item.id.endsWith("tap_quietly.strain"))?.status).toBe("applied");
    expect(isPatternDetected(later, "SECRET_ACTION_DISCOVERED")).toBe(false);
  });

  it("never treats a public action as a discovered secret: same action, one condition -- its exposure", () => {
    // Contract-level pair: one action on the recycler bus that leaves a trace
    // Tarek guards, recorded secret in one catalogue and public in the other.
    const works = (exposure: "secret" | "public"): ProofEvent[] => [
      {
        id: "evt_x_works",
        familyId: "unregistered_conduit",
        taxonomy: "DILEMMA",
        eligibility: [],
        presentation: { title: "Works", body: "works" },
        choices: [
          {
            id: "do_it",
            label: "Do it",
            effects: [
              {
                type: "MEMORY_RECORD", characterId: "mara_001", memoryId: "fact_x_works", valence: "ambivalent",
                salience: 0.7, exposure, callbackEligible: true, summary: "Works on the bus.", tags: []
              }
            ],
            schedules: [
              {
                key: "trace", delay: 1, visibility: "hidden", scope: "settlement",
                effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.05 }],
                breadcrumb: { memoryId: "fact_x_works" }
              }
            ],
            disclosure: { risks: ["infrastructure"], unknowns: ["who notices"] }
          },
          { id: "skip", label: "Skip", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["cost"] } }
        ]
      },
      {
        id: "evt_x_filler",
        familyId: "maintenance",
        taxonomy: "DILEMMA",
        eligibility: [],
        presentation: { title: "Filler", body: "filler" },
        choices: [
          {
            // Puts Tarek to work on the recycler after the action.
            id: "a",
            label: "A",
            effects: [
              { type: "RESOURCE_DELTA", key: "energy", value: -1 },
              { type: "MEMORY_RECORD", characterId: "tarek_001", memoryId: "fact_x_serviced", valence: "positive", salience: 0.6, exposure: "private", callbackEligible: true, summary: "Serviced.", tags: [] }
            ],
            disclosure: { risks: ["supply"], unknowns: ["x"] }
          },
          { id: "b", label: "B", effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
        ]
      }
    ];
    const run = (exposure: "secret" | "public") => {
      const catalogue = works(exposure);
      expect(validateProofCatalogue(catalogue, start()).ok).toBe(true);
      return decide(decide(start(), "evt_x_works", "do_it", catalogue), "evt_x_filler", "a", catalogue);
    };
    for (const exposure of ["secret", "public"] as const) {
      const trace = run(exposure).simulation!.delayedConsequences.find(item => item.id === "con.evt_x_works.do_it.trace");
      expect(trace?.status).toBe("applied");
    }
    expect(isPatternDetected(run("secret"), "SECRET_ACTION_DISCOVERED", "fact_x_works")).toBe(true);
    expect(isPatternDetected(run("public"), "SECRET_ACTION_DISCOVERED")).toBe(false);
  });

  it("does not discover a secret that left no trace, however long the run", () => {
    // The quiet deal with the League schedules nothing: there is nothing to
    // find, even in a run where the spliced line beside it is found.
    const deal = decide(decide(start(), "evt_f3_conduit_offer", "tap_quietly"), "evt_f3_debt_called", "grant_access_quietly");
    const later = decide(deal, "evt_f2_recycler_warning", "full_maintenance");
    const subjects = matchesOf(later, "SECRET_ACTION_DISCOVERED").map(match => match.subject);
    expect(subjects).toEqual(["fact_f3_secret_tap"]);
    expect(later.party.find(c => c.id === "brann_001")!.memories!.some(m => m.id === "fact_f3_quiet_deal")).toBe(true);
  });
});

describe("detectors are pure derivations of persisted state", () => {
  const busy = () =>
    decide(decide(decide(start(), "evt_f3_conduit_offer", "tap_quietly"), "evt_f2_recycler_warning", "patch_and_defer"), "evt_f2_tarek_second_warning", "let_it_ride");

  it("never mutate the world they read", () => {
    const world = busy();
    const before = structuredClone(world);
    detectPatterns(world);
    expect(world).toEqual(before);
  });

  it("give the same matches after a save and a load", () => {
    const world = busy();
    const saved = serializeSystemicWorldState(world);
    if (!saved.ok) throw new Error(saved.errors.join("; "));
    const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
    if (!loaded.ok) throw new Error(loaded.errors.join("; "));
    expect(detectPatterns(loaded.state)).toEqual(detectPatterns(world));
  });

  it("do not read the catalogue, titles, summaries or tags", () => {
    const world = busy();
    const reworded = structuredClone(world);
    for (const character of reworded.party) {
      for (const memory of character.memories ?? []) {
        memory.summary = "reworded";
        memory.tags = ["reworded"];
      }
    }
    expect(detectPatterns(reworded)).toEqual(detectPatterns(world));
  });

  it("are reachable from content through a typed predicate", () => {
    const world = decide(decide(start(), "evt_f2_recycler_warning", "patch_and_defer"), "evt_f2_tarek_second_warning", "let_it_ride");
    expect(evaluateProofPredicate({ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", value: true }, world)).toBe(true);
    expect(evaluateProofPredicate({ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "ira_001", value: true }, world)).toBe(false);
    expect(evaluateProofPredicate({ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", value: false }, world)).toBe(true);
  });

  it("refuse a baseline world", () => {
    expect(() => detectPatterns(createSystemicScenario(7419))).toThrow(/schema-v2/);
  });
});

describe("the catalogue gate reads pattern predicates as typed contracts", () => {
  const reading = (predicate: Record<string, unknown>): ProofEvent[] => [
    ...CATALOGUE,
    {
      id: "evt_x_reads_pattern",
      familyId: "public_accountability",
      taxonomy: "DILEMMA",
      eligibility: [predicate as never],
      presentation: { title: "Reads", body: "reads" },
      choices: [
        { id: "a", label: "A", effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } },
        { id: "b", label: "B", effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }], disclosure: { risks: ["supply"], unknowns: ["x"] } }
      ]
    }
  ];
  const errorsOf = (predicate: Record<string, unknown>) => validateProofCatalogue(reading(predicate), start()).errors.join("; ");

  it.each([
    [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", value: true }],
    [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "tarek_001", value: true }],
    [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", value: false }],
    [{ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: true }],
    [{ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", subject: "fact_f3_secret_tap", value: true }]
  ])("accepts %o", predicate => {
    expect(errorsOf(predicate)).toBe("");
  });

  it.each([
    [{ predicate: "pattern_detected", pattern: "DRAMA_METER", value: true }, /pattern must be one of/],
    [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", value: "yes" }, /value must be a boolean/],
    [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "ira_001", value: true }, /is not a technician/],
    [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "kindness", value: true }, /must be one of protection, neglect/],
    [{ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_ghost", value: true }, /must be a faction/],
    [{ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", subject: "fact_ghost", value: true }, /is a fact no choice records/],
    [{ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", subject: "fact_f3_quiet_deal", value: true }, /leaves a trace to discover/],
    [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", value: true, weight: 3 }, /weight is not an argument of pattern_detected/]
  ])("refuses %o", (predicate, pattern) => {
    expect(errorsOf(predicate)).toMatch(pattern);
  });

  it("refuses a dependency on a faction no choice ever puts the settlement in debt to", () => {
    const alone = reading({ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_compact", value: true }).slice(-1);
    expect(validateProofCatalogue(alone, start()).errors.join("; ")).toMatch(/'faction_compact' is a faction no choice records a debt to/);
  });
});
