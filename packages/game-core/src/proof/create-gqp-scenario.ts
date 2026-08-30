import type {
  CharacterCoreValue,
  CharacterGoal,
  CharacterRelationship,
  FactionAgendaItem,
  EpidemicPressureState,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { createSystemicScenario } from "../state/create-systemic-scenario.js";
import { PROOF_SCHEMA_VERSION } from "./schema-version.js";

/**
 * The Gameplay Quality Proof scenario: Helios Reach, derived.
 *
 * Spec 6.1 rules out a second world. A new settlement would double the content
 * to maintain and halve the attention paid to it, and would buy nothing but
 * names — while the existing cast already has memories the World Tick writes.
 *
 * So this is a **derived variant**, and the derivation direction matters. It
 * calls `createSystemicScenario` and adds to the result; it does not edit the
 * baseline to make proof content convenient. The accepted M1 scenario is
 * therefore unchanged by construction rather than by discipline: there is no
 * line in this file that could change it, and the M1 regressions that pin its
 * exact numbers keep passing without being consulted.
 *
 * Deterministic in the same sense the baseline is: same seed, same world. No
 * clock, no unseeded randomness, no LLM. Two calls with one seed produce
 * structurally equal states, and the proof state survives a JSON round trip
 * unchanged.
 */
export function createGqpScenario(seed = 7419): WorldState {
  const base = createSystemicScenario(seed);
  const simulation = base.simulation!;

  return {
    ...base,
    // Campaign identity is distinct so a proof run and a baseline run of the
    // same seed cannot be filed under one key by the persistence layer, which
    // derives the storage key from this field.
    campaignId: `gqp_${seed}`,
    party: base.party.map(character => ({
      ...character,
      coreValue: CAST_VALUES[character.id] ?? "institutional_order",
      currentGoal: CAST_GOALS[character.id] ?? "hold_settlement_together"
    })),
    simulation: {
      ...simulation,
      schemaVersion: PROOF_SCHEMA_VERSION,
      characterRelationships: relationships(),
      factionAgenda: factionAgenda(),
      epidemic: epidemic(),
      // A fresh proof run has resolved nothing. Spec 14.6 leans on exactly
      // this: an empty history is itself authoritative data, so the quiet
      // bound measures from the scenario's opening tick with no extra field.
      resolvedHistory: []
    } satisfies SystemicSimulationStateV2
  };
}

/**
 * Functional roles from spec 6.2, expressed the only way 5.2 permits.
 *
 * Section 5.2 closes the list of new authoritative character state at core
 * value, current goal, relationships and the necessary memory additions. So
 * there is no `proofRole` field: the role a character plays is what their
 * value and goal make them do. Adding a third field naming the role would
 * restate the other two and fail the 5.1 test.
 *
 * The assignment is PROVISIONAL by 6.2 and is not canon. Each character takes
 * a different side of the proof's dilemmas, which is what makes them
 * predictable for the right reasons rather than merely present.
 *
 *   governance / steward   Brann Vale   arbitrates, carries the political cost
 *   infrastructure         Tarek Oss    warns early, remembers ignored warnings
 *   care / clinic          Ira Venn     carries triage and epidemic pressure
 *   logistics / supply     Mara Senn    opens informal options and their debts
 *   community / voice      Sela Rhun    carries cohort voice and accountability
 */
const CAST_VALUES: Readonly<Record<string, CharacterCoreValue>> = {
  brann_001: "institutional_order",
  tarek_001: "technical_integrity",
  ira_001: "duty_of_care",
  mara_001: "practical_autonomy",
  sela_001: "community_voice"
};

const CAST_GOALS: Readonly<Record<string, CharacterGoal>> = {
  brann_001: "hold_settlement_together",
  tarek_001: "restore_recycler_condition",
  ira_001: "prevent_outbreak",
  mara_001: "secure_water_supply",
  sela_001: "keep_decisions_public"
};

/**
 * Key relationships — one to two per character, as spec 5 asks.
 *
 * Directed, because the obligations are not symmetric. The clinic owing the
 * quartermaster for medical supply is a different fact from the quartermaster
 * owing the clinic, and channel 2 of spec 7.1 propagates along the direction
 * that exists.
 *
 * Every bond here has a job. The rival pair is what makes public
 * accountability cost something; the debt is what makes the informal supply
 * route bite later; the ally pair is the strong relationship a reflected
 * memory can travel down.
 */
function relationships(): CharacterRelationship[] {
  return [
    // Supply and repairs depend on each other daily: the channel a salient
    // event about one can reflect into the other.
    { sourceCharacterId: "mara_001", targetCharacterId: "tarek_001", type: "ally_friend", strength: "high" },
    { sourceCharacterId: "tarek_001", targetCharacterId: "mara_001", type: "ally_friend", strength: "high" },
    // Order against voice. Public accountability is only a decision if
    // someone pays for it.
    { sourceCharacterId: "brann_001", targetCharacterId: "sela_001", type: "rival", strength: "medium" },
    // The clinic cannot treat what logistics does not deliver.
    { sourceCharacterId: "ira_001", targetCharacterId: "mara_001", type: "debt_obligation", strength: "medium" },
    // The technician reports to the steward, which is what makes an ignored
    // warning attributable rather than merely unfortunate.
    { sourceCharacterId: "tarek_001", targetCharacterId: "brann_001", type: "authority_dependent", strength: "medium" }
  ];
}

/**
 * Faction agenda — the existing Helios factions in the proof's two roles.
 *
 * `faction_compact` plays the Council of Order: reliability, standards,
 * predictability. `faction_front` plays the Free Conduit League: independent
 * access, local networks. Spec 8 assigns these roles to the factions that
 * already exist rather than inventing two more.
 *
 * One desire and one grievance each, and they are not each other's inverse. A
 * desire is satisfied by conceding something; a grievance is resolved by
 * repairing something. That is why they cannot share a numeric axis: a faction
 * that got what it wanted and a faction that stopped being angry play
 * differently, and a signed scalar cannot tell them apart.
 *
 * Every condition is a typed predicate over authoritative state, so a
 * political event can name which agenda item makes it possible — which is what
 * GQP-6 demands instead of a reaction that depends on a reputation scalar.
 */
function factionAgenda(): FactionAgendaItem[] {
  const bootstrap = { kind: "system", id: "gqp_scenario_bootstrap", rule: "GQP-A" } as const;

  return [
    {
      id: "agenda_co_reliability",
      factionId: "faction_compact",
      kind: "desire",
      subject: "network_reliability",
      intensity: 0.7,
      // Conceded by bringing the recycler back above a working condition.
      condition: {
        predicate: "production_condition_at_least",
        nodeId: "prod_recycler_01",
        value: 0.8
      },
      source: bootstrap
    },
    {
      id: "agenda_co_unregistered_access",
      factionId: "faction_compact",
      kind: "grievance",
      subject: "informal_access",
      intensity: 0.4,
      // Repaired by the conduit being registered, not by conceding anything.
      condition: { predicate: "flag_equals", key: "conduit_registered", value: true },
      source: bootstrap
    },
    {
      id: "agenda_fcl_access",
      factionId: "faction_front",
      kind: "desire",
      subject: "informal_access",
      intensity: 0.65,
      condition: { predicate: "flag_equals", key: "front_access_granted", value: true },
      source: bootstrap
    },
    {
      id: "agenda_fcl_lockout",
      factionId: "faction_front",
      kind: "grievance",
      subject: "settlement_autonomy",
      intensity: 0.5,
      // Repaired when the settlement's own labour assembly is heard, which is
      // internal politics the League reads as the settlement not being run
      // entirely from the Council's standards.
      condition: {
        predicate: "political_approval_at_least",
        groupId: "group_labor",
        value: 0.6
      },
      source: bootstrap
    }
  ];
}

/**
 * The explicit epidemic pressure at the start of a proof run.
 *
 * Spec 9.1: the one pressure that creates a dilemma M1 state cannot express.
 * Medicine and water compete for the same attention, and "treat now or prevent
 * later" has no representation in the baseline.
 *
 * It starts low and already attributed. Multiple causes are a requirement, not
 * a flourish: a pressure with one cause is a timer, and a timer offers the
 * player nothing to act on. The contributors carry a `CausalSource` so the UI
 * can answer "why is this rising" from the Core rather than from prose.
 *
 * The qualitative stage is absent by design — `pressureStage` derives it.
 */
function epidemic(): EpidemicPressureState {
  const bootstrap = { kind: "system", id: "gqp_scenario_bootstrap", rule: "GQP-A" } as const;

  return {
    value: 0.18,
    contributors: [
      // The baseline already opens with a water reserve under its target and
      // the flag that says so; the epidemic reads that as a standing cause.
      { cause: "water_shortage", magnitude: 0.12, source: bootstrap },
      { cause: "crowding", magnitude: 0.06, source: bootstrap }
    ]
  };
}
