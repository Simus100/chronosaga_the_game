import type { ProofEvent, ResolvedDecision, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  applyDueConsequences,
  createGqpScenario,
  eligibleProofEvents,
  inspectProofStep,
  loadSystemicWorldState,
  resolveProofChoice,
  runWorldTick,
  serializeSystemicWorldState,
  type ProofStepInspection
} from "../../src";

/**
 * The trajectory harness: one fixed, documented cadence for every proof run.
 *
 *   decision step:  resolveProofChoice -> applyDueConsequences -> runWorldTick
 *   quiet step:     runWorldTick only (no decision, no Player Turn, no history)
 *
 * A quiet step happens only when nothing is eligible. So two trajectories from
 * the same seed differ solely by the decisions they name: where the world
 * pauses is a function of state, not of the script. The event taken among
 * several eligible ones is part of the scripted decision -- there is no GQP-C
 * selector yet, and this harness does not pretend to be one.
 */

export type Decision = readonly [eventId: string, choiceId: string];

/**
 * The eight events GQP-B was accepted on (PR #43), by id.
 *
 * GQP-C adds F4 and F5 -- and two more F1/F2 events -- to the same catalogue.
 * This harness only ticks when nothing is eligible, so running the GQP-B
 * scripts against a larger catalogue would change when their worlds tick, and
 * with it every number GQP-B's evidence was reviewed on. The GQP-B suites
 * therefore keep proving their claims on exactly the network they were made
 * about; the full F1-F5 network is proven through the real selector in the
 * GQP-C suites. An explicit list, not a family filter: a family filter would
 * silently grow with every event later added to those families.
 */
export const GQP_B_EVENT_IDS = [
  "evt_f1_clinic_request",
  "evt_f1_ira_prevention_drive",
  "evt_f1_outbreak",
  "evt_f2_recycler_breakdown",
  "evt_f2_recycler_warning",
  "evt_f2_tarek_second_warning",
  "evt_f3_conduit_offer",
  "evt_f3_debt_called"
] as const;

export const GQP_B_CATALOGUE: readonly ProofEvent[] = GQP_B_EVENT_IDS.map(id => {
  const event = GQP_PROOF_EVENTS.find(item => item.id === id);
  if (!event) throw new Error(`GQP-B event '${id}' is missing from the proof catalogue`);
  return event;
});

export interface TrajectoryStep {
  readonly kind: "decision" | "quiet";
  readonly decision: ResolvedDecision | null;
  readonly appliedIds: readonly string[];
  /** Counts of StateChange types across decision, due consequences and tick. */
  readonly changeTypes: Readonly<Record<string, number>>;
  readonly inspection: ProofStepInspection;
  readonly after: WorldState;
}

export interface Trajectory {
  readonly name: string;
  readonly start: WorldState;
  readonly steps: readonly TrajectoryStep[];
  readonly final: WorldState;
}

export interface TrajectoryOptions {
  readonly catalogue?: readonly ProofEvent[];
  /** Round-trip the world through the real save boundary after these decision indices. */
  readonly saveAfter?: readonly number[];
  /** How many consecutive quiet steps the world may take before a decision is due. */
  readonly quietBudget?: number;
  readonly start?: WorldState;
}

export const PROOF_SEED = 7419;

function countTypes(changes: readonly { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  return counts;
}

/** Through the real persistence boundary: the one a player's save takes. */
export function saveAndLoad(state: WorldState): WorldState {
  const saved = serializeSystemicWorldState(state);
  if (!saved.ok) throw new Error(`save refused: ${saved.errors.join("; ")}`);
  const loaded = loadSystemicWorldState(saved.payload, saved.campaignId);
  if (!loaded.ok) throw new Error(`load refused: ${loaded.errors.join("; ")}`);
  return loaded.state;
}

export function runTrajectory(name: string, decisions: readonly Decision[], options: TrajectoryOptions = {}): Trajectory {
  const catalogue = options.catalogue ?? GQP_B_CATALOGUE;
  const quietBudget = options.quietBudget ?? 4;
  const start = options.start ?? createGqpScenario(PROOF_SEED);
  let state = start;
  const steps: TrajectoryStep[] = [];

  decisions.forEach(([eventId, choiceId], index) => {
    let quiet = 0;
    while (eligibleProofEvents(state, catalogue).length === 0) {
      if (quiet >= quietBudget) throw new Error(`${name}: nothing eligible for ${quietBudget} ticks before ${eventId}`);
      const tick = runWorldTick(state);
      steps.push({
        kind: "quiet",
        decision: null,
        appliedIds: [],
        changeTypes: countTypes(tick.delta.changes),
        inspection: inspectProofStep(state, tick.state, catalogue),
        after: tick.state
      });
      state = tick.state;
      quiet += 1;
    }

    const before = state;
    const resolved = resolveProofChoice(state, catalogue, eventId, choiceId);
    const due = applyDueConsequences(resolved.state);
    const tick = runWorldTick(due.state);
    state = tick.state;
    steps.push({
      kind: "decision",
      decision: resolved.entry,
      appliedIds: due.appliedIds,
      changeTypes: countTypes([...resolved.delta.changes, ...due.delta.changes, ...tick.delta.changes]),
      inspection: inspectProofStep(before, state, catalogue),
      after: state
    });

    if (options.saveAfter?.includes(index)) state = saveAndLoad(state);
  });

  return { name, start, steps, final: state };
}

/**
 * The two named trajectories GQP-B exit 9 requires, and the setback/recovery
 * path GQP-7 asks for. Same seed, same start; only the decisions differ.
 */
export const TRAJECTORY_A: readonly Decision[] = [
  // Conservative and transparent: declare the line, maintain properly, treat.
  ["evt_f3_conduit_offer", "register_the_line"],
  ["evt_f2_recycler_warning", "full_maintenance"],
  ["evt_f1_clinic_request", "treat_now"],
  ["evt_f1_ira_prevention_drive", "back_the_drive"]
];

export const TRAJECTORY_B: readonly Decision[] = [
  // Expedient and risk-taking: take the quiet power, patch, hold the reserve.
  ["evt_f3_conduit_offer", "tap_quietly"],
  ["evt_f2_recycler_warning", "patch_and_defer"],
  ["evt_f1_clinic_request", "protect_reserve"],
  ["evt_f2_tarek_second_warning", "let_it_ride"],
  ["evt_f3_debt_called", "grant_access_quietly"],
  ["evt_f2_recycler_breakdown", "accept_degradation"],
  ["evt_f1_outbreak", "ride_it_out"]
];

export const TRAJECTORY_C: readonly Decision[] = [
  // Setback, then recovery of both pressures at a price.
  ["evt_f2_recycler_warning", "patch_and_defer"],
  ["evt_f2_tarek_second_warning", "let_it_ride"],
  ["evt_f1_clinic_request", "protect_reserve"],
  ["evt_f2_recycler_breakdown", "emergency_rebuild"],
  ["evt_f1_outbreak", "full_treatment_campaign"]
];

/**
 * Scripted paths that, between them, take every option in the catalogue at
 * least once from the proof seed. Reachability is a property of the network,
 * not only of the static gate: an option whose predicates can all be satisfied
 * individually may still never be open in a real run.
 */
export const COVERAGE_PATHS: Readonly<Record<string, readonly Decision[]>> = {
  A: TRAJECTORY_A,
  B: TRAJECTORY_B,
  C: TRAJECTORY_C,
  "A-keep-ira": [
    ["evt_f3_conduit_offer", "register_the_line"],
    ["evt_f2_recycler_warning", "full_maintenance"],
    ["evt_f1_clinic_request", "treat_now"],
    ["evt_f1_ira_prevention_drive", "keep_ira_at_the_clinic"]
  ],
  "D-decline-divert-ration": [
    ["evt_f3_conduit_offer", "decline"],
    ["evt_f2_recycler_warning", "divert_clinic_power"],
    ["evt_f1_clinic_request", "ration_district"],
    ["evt_f1_outbreak", "quarantine_district"]
  ],
  "D-stretch": [
    ["evt_f3_conduit_offer", "decline"],
    ["evt_f2_recycler_warning", "divert_clinic_power"],
    ["evt_f1_clinic_request", "ration_district"],
    ["evt_f1_outbreak", "clinic_stretches_supplies"]
  ],
  "E-maintenance-payoff": [
    ["evt_f2_recycler_warning", "full_maintenance"],
    ["evt_f1_clinic_request", "protect_reserve"],
    ["evt_f1_outbreak", "council_medical_stores"]
  ],
  "F-warning-heeded": [
    ["evt_f2_recycler_warning", "patch_and_defer"],
    ["evt_f2_tarek_second_warning", "authorize_inspection"],
    ["evt_f1_clinic_request", "treat_now"]
  ],
  "G-disclose": [
    ["evt_f3_conduit_offer", "tap_quietly"],
    ["evt_f3_debt_called", "disclose_and_register"],
    ["evt_f1_clinic_request", "treat_now"],
    ["evt_f2_recycler_warning", "full_maintenance"]
  ],
  "H-cut-line": [
    ["evt_f3_conduit_offer", "tap_quietly"],
    ["evt_f3_debt_called", "cut_the_line"],
    ["evt_f2_recycler_warning", "patch_and_defer"]
  ],
  "I-tarek-helps": [
    ["evt_f3_conduit_offer", "tap_quietly"],
    ["evt_f2_recycler_warning", "patch_and_defer"],
    ["evt_f2_tarek_second_warning", "authorize_inspection"],
    ["evt_f3_debt_called", "grant_access_quietly"],
    ["evt_f2_recycler_breakdown", "tarek_quick_fix"]
  ],
  "J-league-repair": [
    ["evt_f2_recycler_warning", "patch_and_defer"],
    ["evt_f2_tarek_second_warning", "let_it_ride"],
    ["evt_f1_clinic_request", "protect_reserve"],
    ["evt_f2_recycler_breakdown", "front_technicians"]
  ],
  "K-mara-parts": [
    ["evt_f2_recycler_warning", "patch_and_defer"],
    ["evt_f2_tarek_second_warning", "let_it_ride"],
    ["evt_f1_clinic_request", "protect_reserve"],
    ["evt_f2_recycler_breakdown", "mara_salvaged_parts"]
  ]
};

/**
 * The facts a catalogue records as secret.
 *
 * Exposure lives in the `MEMORY_RECORD` payload that decided the channels, not
 * on the stored memory (P2-5), so secrecy is read from the content that
 * produced the fact.
 */
export function secretFacts(catalogue: readonly ProofEvent[] = GQP_B_CATALOGUE): Set<string> {
  const secrets = new Set<string>();
  for (const event of catalogue) {
    for (const choice of event.choices) {
      const effects = [...choice.effects, ...(choice.schedules ?? []).flatMap(schedule => schedule.effects)];
      for (const effect of effects) {
        if (effect.type === "MEMORY_RECORD" && effect.exposure === "secret") secrets.add(effect.memoryId);
      }
    }
  }
  return secrets;
}

/** The facts a run has published by a resolved decision, read from its history. */
export function publishedFacts(state: WorldState, catalogue: readonly ProofEvent[] = GQP_B_CATALOGUE): Set<string> {
  const published = new Set<string>();
  const history = (state.simulation as unknown as { resolvedHistory: ResolvedDecision[] }).resolvedHistory;
  for (const entry of history) {
    const choice = catalogue.find(event => event.id === entry.eventId)?.choices.find(item => item.id === entry.choiceId);
    for (const effect of choice?.effects ?? []) {
      if (effect.type === "MEMORY_PUBLISH") published.add(effect.memoryId);
    }
  }
  return published;
}
