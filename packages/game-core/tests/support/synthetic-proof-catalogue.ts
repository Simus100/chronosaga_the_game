import type { EventEffect, ProofEvent, WorldState } from "@paa/game-types";
import { createGqpScenario } from "../../src";

/**
 * A deliberately tiny synthetic proof catalogue.
 *
 * The resolver, eligibility and catalogue-gate suites test contracts, not
 * content: exactly one history entry per resolved decision, eligibility that
 * reads state and nothing else, a gate that refuses broken content. So they
 * use two events that exist only to exercise those contracts, and the real
 * F1-F3 network is tested separately against the same functions.
 */

export const warningMemory: EventEffect = {
  type: "MEMORY_RECORD",
  characterId: "tarek_001",
  memoryId: "fact_t_warning",
  valence: "negative",
  salience: 0.8,
  exposure: "private",
  behaviorHook: "offer_unprompted_warning",
  callbackEligible: true,
  summary: "The warning went unheeded.",
  tags: ["recycler"]
};

export const SYNTHETIC_CATALOGUE: ProofEvent[] = [
  {
    id: "evt_t_maint",
    familyId: "maintenance",
    taxonomy: "DILEMMA",
    eligibility: [{ predicate: "node_condition_below", nodeId: "prod_recycler_01", value: 0.8 }],
    presentation: { title: "T", body: "t" },
    choices: [
      {
        id: "repair",
        label: "Repair",
        effects: [
          { type: "RESOURCE_DELTA", key: "energy", value: -10 },
          { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.2 }
        ],
        disclosure: { risks: ["supply"], unknowns: ["how long it holds"] }
      },
      {
        id: "defer",
        label: "Defer",
        effects: [warningMemory],
        schedules: [
          {
            key: "wear",
            delay: 1,
            visibility: "hidden",
            scope: "settlement",
            effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.2 }],
            breadcrumb: { memoryId: "fact_t_warning" }
          }
        ],
        disclosure: { risks: ["infrastructure", "social"], unknowns: ["when it gives"] }
      }
    ]
  },
  {
    id: "evt_t_signal",
    familyId: "maintenance",
    taxonomy: "SIGNAL",
    eligibility: [
      { predicate: "memory_hook_present", characterId: "tarek_001", hook: "offer_unprompted_warning", value: true },
      { predicate: "consequence_status", consequenceId: "con.evt_t_maint.defer.wear", status: "pending" }
    ],
    presentation: { title: "S", body: "s" },
    choices: [
      {
        id: "inspect",
        label: "Inspect",
        effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -3 }],
        disclosure: { risks: [], unknowns: [] }
      }
    ]
  }
];

export function proofWorld(): WorldState {
  return createGqpScenario(7419);
}

export function resolvedHistory(state: WorldState): unknown[] {
  return (state.simulation as unknown as { resolvedHistory: unknown[] }).resolvedHistory;
}
