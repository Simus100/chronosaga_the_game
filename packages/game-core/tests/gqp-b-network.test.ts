import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EventEffect, ProofChoice, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  createGqpScenario,
  eligibleProofEvents,
  findProofEvent,
  isProofChoiceAvailable,
  readAuthoritativeResource,
  readProofWorld,
  resolveProofChoice,
  runWorldTick,
  validateProofCatalogue
} from "../src";
import {
  COVERAGE_PATHS,
  PROOF_SEED,
  runTrajectory,
  type Decision,
  type Trajectory
} from "./support/proof-trajectory";

/**
 * The GQP-B network: F1-F3 as a state-sensitive network, not a quest chain.
 *
 * Every property here is measured on real runs from the proof seed, through
 * the same resolver, applicator and World Tick the game uses. Where the proof
 * makes a claim about the network -- no dominant option, three consequence
 * layers, characters acting for the right reason, secrets staying local -- the
 * claim is computed from authoritative state, never asserted from content.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const MAJOR = new Set(["DILEMMA", "COMPLICATION", "CRISIS_PAYOFF"]);

const runs = new Map<string, Trajectory>();
function run(name: string): Trajectory {
  let found = runs.get(name);
  if (!found) {
    found = runTrajectory(name, COVERAGE_PATHS[name]!);
    runs.set(name, found);
  }
  return found;
}

/** The world immediately before each decision of a trajectory. */
function decisionContexts(trajectory: Trajectory): { eventId: string; choiceId: string; before: WorldState }[] {
  const contexts: { eventId: string; choiceId: string; before: WorldState }[] = [];
  trajectory.steps.forEach((step, index) => {
    if (step.kind !== "decision") return;
    contexts.push({
      eventId: step.decision!.eventId,
      choiceId: step.decision!.choiceId,
      before: index === 0 ? trajectory.start : trajectory.steps[index - 1]!.after
    });
  });
  return contexts;
}

function allContexts() {
  return Object.keys(COVERAGE_PATHS).flatMap(name => decisionContexts(run(name)).map(context => ({ path: name, ...context })));
}

function stateAt(name: string, decisionIndex: number): WorldState {
  // The world after decision `decisionIndex` of path `name`, tick included.
  const steps = run(name).steps.filter(step => step.kind === "decision");
  return steps[decisionIndex]!.after;
}

function optionsOf(state: WorldState, eventId: string): string[] {
  return findProofEvent(CATALOGUE, eventId)
    .choices.filter(choice => isProofChoiceAvailable(choice, state))
    .map(choice => choice.id);
}

function eligibleIds(state: WorldState): string[] {
  return eligibleProofEvents(state, CATALOGUE).map(event => event.id);
}

function familyOrder(decisions: readonly Decision[]): string[] {
  const order: string[] = [];
  for (const [eventId] of decisions) {
    const family = findProofEvent(CATALOGUE, eventId).familyId;
    if (!order.includes(family)) order.push(family);
  }
  return order;
}

describe("GQP-B content", () => {
  it.each([1, PROOF_SEED, 20260919])("passes the catalogue gate against the proof world (seed %i)", seed => {
    expect(validateProofCatalogue(CATALOGUE, createGqpScenario(seed))).toEqual({ ok: true, errors: [] });
  });

  it("is exactly F1-F3, with more than one event per family", () => {
    const families = new Map<string, number>();
    for (const event of CATALOGUE) families.set(event.familyId, (families.get(event.familyId) ?? 0) + 1);
    expect([...families.keys()].sort()).toEqual(["maintenance", "scarcity_triage", "unregistered_conduit"]);
    for (const count of families.values()) expect(count).toBeGreaterThanOrEqual(2);
  });

  it("is pure data", () => {
    expect(JSON.parse(JSON.stringify(CATALOGUE))).toEqual(CATALOGUE);
  });
});

describe("GQP-B reachability: every option can actually be taken", () => {
  it("resolves every option of the catalogue on some real run from the proof seed", () => {
    const taken = new Set(allContexts().map(context => `${context.eventId}:${context.choiceId}`));
    const every = CATALOGUE.flatMap(event => event.choices.map(choice => `${event.id}:${choice.id}`));
    expect(every.filter(option => !taken.has(option))).toEqual([]);
  });
});

/** The GQP-2 consequence layers a resolution touches, measured on state. */
function layersOf(state: WorldState, eventId: string, choiceId: string): string[] {
  const resolved = resolveProofChoice(state, CATALOGUE, eventId, choiceId).state;
  const a = readProofWorld(state, CATALOGUE);
  const b = readProofWorld(resolved, CATALOGUE);
  const layers: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

  const stocks = (w: WorldState) => [w.simulation!.settlements.map(s => s.resourceStock), w.resources];
  if (!same(stocks(state), stocks(resolved))) layers.push("resource");

  const people = (w: WorldState) => w.party.map(c => [c.id, c.stress, c.morale, c.health]);
  if (!same(people(state), people(resolved))) layers.push("character");

  if (!same(a.memories, b.memories) || !same(a.factionAwareness, b.factionAwareness)) layers.push("memory");
  if (!same(a.agenda, b.agenda)) layers.push("agenda");

  const scheduled = resolved.simulation!.delayedConsequences.filter(item => !a.consequences.some(c => c.id === item.id));
  const delayedPressure = scheduled.some(item =>
    item.effects.some(effect => ["EPIDEMIC_SHIFT", "NODE_CONDITION_SHIFT", "PRESSURE_DELTA"].includes(effect.type))
  );
  if (
    a.epidemic.value !== b.epidemic.value ||
    !same(a.infrastructure, b.infrastructure) ||
    a.worldPressure !== b.worldPressure ||
    delayedPressure
  ) {
    layers.push("pressure");
  }

  const others = (r: typeof a) => r.eligibleEvents.filter(id => id !== eventId);
  if (!same(others(a), others(b)) || scheduled.length > 0) layers.push("eligibility");

  const openable = (w: WorldState) =>
    CATALOGUE.filter(event => event.id !== eventId).flatMap(event =>
      event.choices.filter(choice => isProofChoiceAvailable(choice, w)).map(choice => `${event.id}:${choice.id}`)
    );
  if (!same(openable(state), openable(resolved))) layers.push("options");

  return layers;
}

describe("GQP-2: every major choice touches at least three consequence layers", () => {
  const majors = () =>
    allContexts().filter(context => MAJOR.has(findProofEvent(CATALOGUE, context.eventId).taxonomy));

  it("holds for every major option, measured where it was taken", () => {
    const seen = new Set<string>();
    const thin: string[] = [];
    for (const context of majors()) {
      const key = `${context.eventId}:${context.choiceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const layers = layersOf(context.before, context.eventId, context.choiceId);
      if (layers.length < 3) thin.push(`${key} [${layers.join(",")}]`);
    }
    expect(thin).toEqual([]);
    // Every major option was measured, not only the ones on A/B/C.
    const everyMajor = CATALOGUE.filter(event => MAJOR.has(event.taxonomy)).flatMap(event =>
      event.choices.map(choice => `${event.id}:${choice.id}`)
    );
    expect([...seen].sort()).toEqual(everyMajor.sort());
  });
});

/**
 * The outcome of an option as a vector where higher is better on every axis.
 * Certain immediate effects and authored delayed effects both count; the
 * number of disclosed risk categories counts against. Agenda items count per
 * item, because conceding to one faction is not better or worse than
 * repairing another -- which is exactly what makes them incomparable.
 */
function outcome(state: WorldState, eventId: string, choice: ProofChoice): number[] {
  const resolved = resolveProofChoice(state, CATALOGUE, eventId, choice.id).state;
  const a = readProofWorld(state, CATALOGUE);
  const b = readProofWorld(resolved, CATALOGUE);
  const delayed = (choice.schedules ?? []).flatMap(schedule => schedule.effects);
  const sum = (effects: EventEffect[], type: string) =>
    effects.reduce((total, effect) => {
      if (effect.type !== type) return total;
      return total + ("delta" in effect ? effect.delta : "value" in effect && typeof effect.value === "number" ? effect.value : 0);
    }, 0);
  const node = (r: typeof a) => Object.values(r.nodeCondition).reduce((x, y) => x + y, 0);
  const stress = (w: WorldState) => w.party.reduce((total, c) => total + c.stress, 0);
  const recorded = choice.effects.filter(effect => effect.type === "MEMORY_RECORD");
  const secrets = (r: typeof a) => r.memories.filter(m => m.exposure === "secret").length;

  return [
    ...["energy", "water", "medicine", "food", "alloys", "credits"].map(
      key => readAuthoritativeResource(resolved, key) - readAuthoritativeResource(state, key)
    ),
    -(b.epidemic.value - a.epidemic.value) - sum(delayed, "EPIDEMIC_SHIFT"),
    node(b) - node(a) + sum(delayed, "NODE_CONDITION_SHIFT"),
    -(b.worldPressure - a.worldPressure) - sum(delayed, "PRESSURE_DELTA"),
    -(stress(resolved) - stress(state)),
    -recorded.filter(effect => effect.valence === "negative").length,
    recorded.filter(effect => effect.valence === "positive").length,
    -(secrets(b) - secrets(a)),
    -choice.disclosure.risks.length,
    ...Object.keys(b.agenda).map(id => Number(b.agenda[id]) - Number(a.agenda[id]))
  ];
}

function dominates(x: number[], y: number[]): boolean {
  const epsilon = 1e-9;
  return x.every((value, index) => value >= y[index]! - epsilon) && x.some((value, index) => value > y[index]! + epsilon);
}

describe("GQP-1: no option dominates another in the situations the network produces", () => {
  it("finds no dominated major option at any decision point on the coverage runs", () => {
    const dominated: string[] = [];
    let compared = 0;
    for (const context of allContexts()) {
      const event = findProofEvent(CATALOGUE, context.eventId);
      if (!MAJOR.has(event.taxonomy)) continue;
      const open = event.choices.filter(choice => isProofChoiceAvailable(choice, context.before));
      const vectors = open.map(choice => ({ id: choice.id, v: outcome(context.before, event.id, choice) }));
      for (const x of vectors) {
        for (const y of vectors) {
          if (x === y) continue;
          compared += 1;
          if (dominates(x.v, y.v)) dominated.push(`${context.path} ${event.id}: ${x.id} dominates ${y.id}`);
        }
      }
    }
    expect(dominated).toEqual([]);
    expect(compared).toBeGreaterThan(50);
  });

  it("gives every major option a benefit over each alternative, a real cost, and a future", () => {
    // GQP-1 asks for a real benefit, a real cost and a plausible future
    // consequence. A benefit is relative -- patching is "better" only in that
    // it costs less than an overhaul -- so it is measured against each option
    // open at the same moment, on at least one axis.
    const missing: string[] = [];
    for (const context of allContexts()) {
      const event = findProofEvent(CATALOGUE, context.eventId);
      if (!MAJOR.has(event.taxonomy)) continue;
      const open = event.choices.filter(choice => isProofChoiceAvailable(choice, context.before));
      const vectors = new Map(open.map(choice => [choice.id, outcome(context.before, event.id, choice)]));
      const taken = vectors.get(context.choiceId)!;
      for (const [other, v] of vectors) {
        if (other !== context.choiceId && !taken.some((value, index) => value > v[index]! + 1e-9)) {
          missing.push(`${event.id}:${context.choiceId} is nowhere better than ${other}`);
        }
      }
      if (!taken.some(value => value < -1e-9)) missing.push(`${event.id}:${context.choiceId} costs nothing`);
      const future = layersOf(context.before, event.id, context.choiceId).filter(layer =>
        ["memory", "agenda", "eligibility", "options"].includes(layer)
      );
      if (future.length === 0) missing.push(`${event.id}:${context.choiceId} has no future consequence`);
    }
    expect(missing).toEqual([]);
  });
});

describe("GQP-B network properties (GQP spec 11.3, issue #42)", () => {
  it("lets a branch make later variants unnecessary: a maintained recycler never breaks and never needs the conduit", () => {
    // Exhaustive over every continuation from the maintained world, to depth 4.
    const start = runTrajectory("maintained", [["evt_f2_recycler_warning", "full_maintenance"]]).final;
    const seen = new Set<string>();
    const walk = (state: WorldState, depth: number) => {
      let world = state;
      for (let quiet = 0; quiet < 4 && eligibleIds(world).length === 0; quiet += 1) world = runWorldTick(world).state;
      for (const id of eligibleIds(world)) seen.add(id);
      if (depth === 0) return;
      for (const event of eligibleProofEvents(world, CATALOGUE)) {
        for (const choice of event.choices.filter(item => isProofChoiceAvailable(item, world))) {
          walk(runTrajectory("branch", [[event.id, choice.id]], { start: world }).final, depth - 1);
        }
      }
    };
    walk(start, 4);
    expect(seen.has("evt_f2_recycler_breakdown")).toBe(false);
    expect(seen.has("evt_f3_conduit_offer")).toBe(false);
    expect(seen.has("evt_f1_clinic_request")).toBe(true);
  });

  it("lets a heeded warning make the breakdown unnecessary, where an ignored one does not", () => {
    const heeded = run("F-warning-heeded").final;
    const ignored = stateAt("C", 2);
    // Both worlds have taken the delayed wear.
    const wear = "con.evt_f2_recycler_warning.patch_and_defer.wear";
    expect(readProofWorld(heeded, CATALOGUE).consequences.find(c => c.id === wear)?.status).toBe("applied");
    expect(readProofWorld(ignored, CATALOGUE).consequences.find(c => c.id === wear)?.status).toBe("applied");
    expect(eligibleIds(heeded)).not.toContain("evt_f2_recycler_breakdown");
    expect(eligibleIds(ignored)).toContain("evt_f2_recycler_breakdown");
  });

  it("changes options in all three families from accumulated state", () => {
    // F1: the outbreak offers different ways out depending on who remembers what.
    const outbreakB = optionsOf(decisionContexts(run("B")).find(c => c.eventId === "evt_f1_outbreak")!.before, "evt_f1_outbreak");
    const outbreakD = optionsOf(
      decisionContexts(run("D-decline-divert-ration")).find(c => c.eventId === "evt_f1_outbreak")!.before,
      "evt_f1_outbreak"
    );
    expect(outbreakB).toEqual(["full_treatment_campaign", "ride_it_out"]);
    expect(outbreakD).toEqual(
      expect.arrayContaining(["clinic_stretches_supplies", "quarantine_district", "council_medical_stores"])
    );

    // F2: who helps with the breakdown depends on how Tarek and Mara were treated.
    const breakdownC = optionsOf(decisionContexts(run("C")).find(c => c.eventId === "evt_f2_recycler_breakdown")!.before, "evt_f2_recycler_breakdown");
    const breakdownI = optionsOf(
      decisionContexts(run("I-tarek-helps")).find(c => c.eventId === "evt_f2_recycler_breakdown")!.before,
      "evt_f2_recycler_breakdown"
    );
    expect(breakdownC).not.toContain("tarek_quick_fix");
    expect(breakdownC).toContain("front_technicians");
    expect(breakdownI).toContain("tarek_quick_fix");
    expect(breakdownI).not.toContain("front_technicians");

    // F3: the League calls in its debt only after a quiet tap, never after a declared line.
    expect(eligibleIds(stateAt("B", 0))).toContain("evt_f3_debt_called");
    for (const step of run("A").steps) expect(eligibleIds(step.after)).not.toContain("evt_f3_debt_called");
  });

  it("pays back costly early decisions later", () => {
    // Maintenance cost ten energy, and made the settlement reliable in the
    // Council's eyes -- which is what opens the Council's stores at the outbreak.
    const maintained = decisionContexts(run("E-maintenance-payoff")).find(c => c.eventId === "evt_f1_outbreak")!.before;
    const neglected = decisionContexts(run("B")).find(c => c.eventId === "evt_f1_outbreak")!.before;
    expect(optionsOf(maintained, "evt_f1_outbreak")).toContain("council_medical_stores");
    expect(optionsOf(neglected, "evt_f1_outbreak")).not.toContain("council_medical_stores");

    // Opening the reserve to the clinic is what makes Ira propose the cistern drive.
    expect(eligibleIds(stateAt("A", 2))).toContain("evt_f1_ira_prevention_drive");
    for (const name of ["B", "C", "E-maintenance-payoff"]) {
      for (const step of run(name).steps) expect(eligibleIds(step.after)).not.toContain("evt_f1_ira_prevention_drive");
    }
  });

  it("lets apparently helpful choices complicate things later", () => {
    const b = run("B");
    // The quiet tap: ten energy now, and nothing visible against it...
    const tap = b.steps[0]!;
    expect(tap.inspection.decisions[0]!.choiceId).toBe("tap_quietly");
    expect(readAuthoritativeResource(tap.after, "energy")).toBeGreaterThan(readAuthoritativeResource(b.start, "energy"));
    // ...then the strain arrives, and the League calls the debt in.
    expect(b.steps.some(step => step.inspection.consequencesApplied.includes("con.evt_f3_conduit_offer.tap_quietly.strain"))).toBe(true);
    expect(eligibleIds(tap.after)).toContain("evt_f3_debt_called");

    // The patch: infrastructure improves at once, then the wear lands.
    const c = run("C");
    expect(c.steps[0]!.inspection.infrastructure.settlement_helios!.before.stage).toBe("CRITICAL");
    expect(c.steps[0]!.inspection.infrastructure.settlement_helios!.after.stage).toBe("STRAINED");
    const wearStep = c.steps.find(step => step.inspection.consequencesApplied.includes("con.evt_f2_recycler_warning.patch_and_defer.wear"))!;
    expect(wearStep.inspection.optionsOpened).toContain("evt_f2_recycler_breakdown:emergency_rebuild");
  });

  it("imposes no fixed family sequence", () => {
    const orders = new Set(Object.values(COVERAGE_PATHS).map(path => familyOrder(path).join(">")));
    expect(orders.size).toBeGreaterThanOrEqual(3);
    // F1 before F2, and F2 before F1, both occur.
    expect([...orders].some(order => order.indexOf("scarcity_triage") < order.indexOf("maintenance") && order.includes("maintenance"))).toBe(true);
    expect([...orders].some(order => order.indexOf("maintenance") < order.indexOf("scarcity_triage"))).toBe(true);
  });
});

/** A counterfactual: the same world, with one character's memory edited. */
function editMemory(state: WorldState, characterId: string, memoryId: string, edit: (memory: Record<string, unknown>) => void): WorldState {
  const copy = structuredClone(state);
  const memory = copy.party.find(c => c.id === characterId)!.memories!.find(m => m.id === memoryId)!;
  edit(memory as unknown as Record<string, unknown>);
  return copy;
}

function withoutMemory(state: WorldState, characterId: string, memoryId: string): WorldState {
  const copy = structuredClone(state);
  const character = copy.party.find(c => c.id === characterId)!;
  character.memories = character.memories!.filter(m => m.id !== memoryId);
  return copy;
}

describe("GQP-5: characters act on what they remember, for the right reason", () => {
  it("Tarek warns unprompted because he remembers being overruled", () => {
    const world = stateAt("C", 0);
    expect(eligibleIds(world)).toContain("evt_f2_tarek_second_warning");
    // Not the fact alone: the typed hook on a direct memory.
    const noHook = editMemory(world, "tarek_001", "fact_f2_warning_ignored", m => delete m.behaviorHook);
    const secondHand = editMemory(world, "tarek_001", "fact_f2_warning_ignored", m => (m.origin = "reflected"));
    expect(eligibleIds(noHook)).not.toContain("evt_f2_tarek_second_warning");
    expect(eligibleIds(secondHand)).not.toContain("evt_f2_tarek_second_warning");
  });

  it("Tarek refuses a fast repair after being dismissed twice", () => {
    const world = decisionContexts(run("C")).find(c => c.eventId === "evt_f2_recycler_breakdown")!.before;
    expect(optionsOf(world, "evt_f2_recycler_breakdown")).not.toContain("tarek_quick_fix");
    const forgiven = withoutMemory(world, "tarek_001", "fact_f2_warning_dismissed");
    expect(optionsOf(forgiven, "evt_f2_recycler_breakdown")).toContain("tarek_quick_fix");
  });

  it("Ira proposes the cistern drive because she was helped, and refuses to stretch after being turned away", () => {
    const helped = stateAt("A", 2);
    expect(eligibleIds(helped)).toContain("evt_f1_ira_prevention_drive");
    const noHook = editMemory(helped, "ira_001", "fact_f1_clinic_supplied", m => delete m.behaviorHook);
    expect(eligibleIds(noHook)).not.toContain("evt_f1_ira_prevention_drive");

    const refused = decisionContexts(run("B")).find(c => c.eventId === "evt_f1_outbreak")!.before;
    expect(optionsOf(refused, "evt_f1_outbreak")).not.toContain("clinic_stretches_supplies");
    const unrefused = editMemory(refused, "ira_001", "fact_f1_clinic_refused", m => delete m.behaviorHook);
    expect(optionsOf(unrefused, "evt_f1_outbreak")).toContain("clinic_stretches_supplies");
  });

  it("Mara brings the League's demand because she holds the debt, about the League", () => {
    const world = stateAt("B", 0);
    expect(eligibleIds(world)).toContain("evt_f3_debt_called");
    const otherSubject = editMemory(world, "mara_001", "fact_f3_secret_tap", m => (m.subjectId = "faction_compact"));
    expect(eligibleIds(otherSubject)).not.toContain("evt_f3_debt_called");
  });

  it("Mara has parts ready only because Tarek told her -- the reflected memory is the reason", () => {
    const world = decisionContexts(run("K-mara-parts")).find(c => c.eventId === "evt_f2_recycler_breakdown")!.before;
    const copy = world.party.find(c => c.id === "mara_001")!.memories!.find(m => m.id === "fact_f2_warning_ignored")!;
    expect(copy.origin).toBe("reflected");
    expect(optionsOf(world, "evt_f2_recycler_breakdown")).toContain("mara_salvaged_parts");
    expect(optionsOf(withoutMemory(world, "mara_001", "fact_f2_warning_ignored"), "evt_f2_recycler_breakdown")).not.toContain(
      "mara_salvaged_parts"
    );
  });

  it("Sela will not accept a quarantine after the clinic was publicly turned away", () => {
    const world = decisionContexts(run("B")).find(c => c.eventId === "evt_f1_outbreak")!.before;
    expect(world.party.find(c => c.id === "sela_001")!.memories!.find(m => m.id === "fact_f1_clinic_refused")!.origin).toBe("public");
    expect(optionsOf(world, "evt_f1_outbreak")).not.toContain("quarantine_district");
    expect(optionsOf(withoutMemory(world, "sela_001", "fact_f1_clinic_refused"), "evt_f1_outbreak")).toContain(
      "quarantine_district"
    );
  });

  it("shows at least two characters acting from memory on the named trajectories alone", () => {
    const actors = new Set<string>();
    const appears = (t: Trajectory, eventId: string) => t.steps.some(step => eligibleIds(step.after).includes(eventId));
    if (appears(run("B"), "evt_f2_tarek_second_warning")) actors.add("tarek_001");
    if (appears(run("A"), "evt_f1_ira_prevention_drive")) actors.add("ira_001");
    if (appears(run("B"), "evt_f3_debt_called")) actors.add("mara_001");
    expect(actors.size).toBeGreaterThanOrEqual(2);
  });
});

describe("Social propagation: three channels, no hive mind", () => {
  it("reflects a salient private memory one hop along a strong bond, without its behaviour", () => {
    const world = stateAt("C", 0);
    const tarek = world.party.find(c => c.id === "tarek_001")!.memories!.find(m => m.id === "fact_f2_warning_ignored")!;
    const mara = world.party.find(c => c.id === "mara_001")!.memories!.find(m => m.id === "fact_f2_warning_ignored")!;
    expect(tarek.origin).toBe("direct");
    expect(mara).toMatchObject({ origin: "reflected", salience: 0.4 });
    expect(mara.behaviorHook).toBeUndefined();
    // One hop: nobody else learns it.
    const holders = world.party.filter(c => (c.memories ?? []).some(m => m.id === "fact_f2_warning_ignored")).map(c => c.id);
    expect(holders.sort()).toEqual(["mara_001", "tarek_001"]);
  });

  it("makes a public action known to the community and the controlling faction only", () => {
    const world = stateAt("B", 2);
    const holders = world.party.filter(c => (c.memories ?? []).some(m => m.id === "fact_f1_clinic_refused")).map(c => c.id);
    expect(holders.length).toBe(world.party.length);
    const factions = readProofWorld(world, CATALOGUE).factionAwareness;
    expect(factions).toContain("faction_compact:aware:fact_f1_clinic_refused");
    expect(factions.some(tag => tag.startsWith("faction_front:"))).toBe(false);
  });

  it("keeps secrets local, however long the run and however close the bonds", () => {
    const b = run("B");
    for (const step of b.steps) {
      const reading = readProofWorld(step.after, CATALOGUE);
      for (const secret of ["fact_f3_secret_tap", "fact_f3_quiet_deal"]) {
        const holders = reading.memories.filter(m => m.memoryId === secret);
        expect(holders.length).toBeLessThanOrEqual(1);
        expect(reading.factionAwareness.some(tag => tag.endsWith(`:aware:${secret}`))).toBe(false);
      }
    }
    // Mara and Tarek share a strong bond both ways; the secret still stays with Mara.
    expect(b.final.party.find(c => c.id === "tarek_001")!.memories!.some(m => m.id === "fact_f3_secret_tap")).toBe(false);
  });

  it("moves no faction opinion on a secret, or on anything else the proof does", () => {
    const opinions = (w: WorldState) => w.simulation!.factions.map(f => [f.id, f.reputation, f.relations]);
    for (const name of Object.keys(COVERAGE_PATHS)) {
      const trajectory = run(name);
      for (const step of trajectory.steps) expect(opinions(step.after)).toEqual(opinions(trajectory.start));
    }
  });

  it("publishes a secret only through the explicit publication channel", () => {
    const disclosed = stateAt("G-disclose", 1);
    const reading = readProofWorld(disclosed, CATALOGUE);
    const holders = reading.memories.filter(m => m.memoryId === "fact_f3_secret_tap");
    expect(holders.length).toBe(disclosed.party.length);
    expect(holders.every(m => m.exposure === "public")).toBe(true);
    expect(reading.factionAwareness).toContain("faction_compact:aware:fact_f3_secret_tap");
  });
});

describe("GQP-4: every delayed consequence arrives after its breadcrumb", () => {
  it("finds the breadcrumb memory in the world before each applied consequence", () => {
    let checked = 0;
    for (const name of Object.keys(COVERAGE_PATHS)) {
      const trajectory = run(name);
      trajectory.steps.forEach((step, index) => {
        const before = index === 0 ? trajectory.start : trajectory.steps[index - 1]!.after;
        for (const id of step.inspection.consequencesApplied) {
          if (!id.startsWith("con.evt_")) continue; // M1 scenario consequences predate the proof
          const [, eventId, choiceId, key] = id.split(".");
          const schedule = findProofEvent(CATALOGUE, eventId!).choices.find(c => c.id === choiceId)!.schedules!.find(s => s.key === key)!;
          const crumb = schedule.breadcrumb.memoryId;
          expect(before.party.some(c => (c.memories ?? []).some(m => m.id === crumb && m.callbackEligible === true))).toBe(true);
          checked += 1;
        }
      });
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

describe("GQP-7: each pressure has a costly recovery", () => {
  it("recovers infrastructure from a breakdown, at the cost of the strategic reserve", () => {
    const c = run("C");
    const rebuild = c.steps.find(step => step.decision?.choiceId === "emergency_rebuild")!;
    expect(rebuild.inspection.infrastructure.settlement_helios!.before.stage).toBe("CRITICAL");
    expect(rebuild.inspection.infrastructure.settlement_helios!.after.stage).toBe("STRAINED");
    const before = c.steps[c.steps.indexOf(rebuild) - 1]!.after;
    expect(readAuthoritativeResource(rebuild.after, "alloys")).toBe(readAuthoritativeResource(before, "alloys") - 4);
  });

  it("recovers the epidemic from CRITICAL, at the cost of medicine and power, leaving a scar", () => {
    const c = run("C");
    const campaign = c.steps.find(step => step.decision?.choiceId === "full_treatment_campaign")!;
    expect(campaign.inspection.epidemic.before.stage).toBe("CRITICAL");
    expect(campaign.inspection.epidemic.after.stage).toBe("STRAINED");
    // The refusal that caused it still weighs: its delayed spread landed after the recovery.
    const epidemic = (c.final.simulation as unknown as { epidemic: { contributors: { cause: string; magnitude: number }[] } }).epidemic;
    const contributors = epidemic.contributors;
    expect(contributors.find(x => x.cause === "deferred_triage")!.magnitude).toBeGreaterThan(0);
    expect(campaign.inspection.consequencesApplied).toContain("con.evt_f1_clinic_request.protect_reserve.spread");
  });

  it("offers more than one way out of each crisis, in different currencies", () => {
    const breakdown = decisionContexts(run("C")).find(c => c.eventId === "evt_f2_recycler_breakdown")!.before;
    expect(optionsOf(breakdown, "evt_f2_recycler_breakdown").length).toBeGreaterThanOrEqual(3);
    const outbreak = decisionContexts(run("D-decline-divert-ration")).find(c => c.eventId === "evt_f1_outbreak")!.before;
    expect(optionsOf(outbreak, "evt_f1_outbreak").length).toBeGreaterThanOrEqual(4);
  });
});

describe("game-data / game-core boundary", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
    });
  }

  it("keeps content out of the Core and rules out of the content", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const core = sources(join(here, "..", "src"));
    const data = sources(join(here, "..", "..", "game-data", "src"));
    expect(core.length).toBeGreaterThan(20);
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(core.filter(file => readFileSync(file, "utf8").includes("@paa/game-data"))).toEqual([]);
    expect(data.filter(file => readFileSync(file, "utf8").includes("@paa/game-core"))).toEqual([]);
  });
});
