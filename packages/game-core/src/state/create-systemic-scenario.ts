import type { CharacterState, SystemicSimulationState, WorldState } from "@paa/game-types";
import { createCampaign } from "./create-campaign";

function characters(): CharacterState[] {
  return [
    {
      id: "ira_001",
      name: "Ira Venn",
      role: "Cartographer",
      health: 82,
      stress: 18,
      morale: 74,
      traits: ["analytical", "cautious"],
      memoryTags: ["relay_route"],
      factionId: "faction_compact",
      locationId: "settlement_helios",
      memories: [
        {
          id: "mem_ira_001",
          summary: "Mapped the exposed relay route before the current supply crisis.",
          tags: ["relay", "supply"],
          turn: 1,
          source: { kind: "system", id: "scenario_bootstrap", rule: "M1-A" }
        }
      ]
    },
    {
      id: "brann_001",
      name: "Brann Vale",
      role: "Security Lead",
      health: 96,
      stress: 24,
      morale: 81,
      traits: ["loyal", "impulsive"],
      memoryTags: ["border_skirmish"],
      factionId: "faction_compact",
      locationId: "settlement_helios",
      memories: []
    },
    {
      id: "mara_001",
      name: "Mara Senn",
      role: "Quartermaster",
      health: 88,
      stress: 31,
      morale: 69,
      traits: ["pragmatic", "resourceful"],
      memoryTags: ["water_shortage"],
      factionId: "faction_compact",
      locationId: "settlement_helios",
      memories: []
    },
    {
      id: "tarek_001",
      name: "Tarek Oss",
      role: "Field Technician",
      health: 91,
      stress: 21,
      morale: 72,
      traits: ["methodical", "stubborn"],
      memoryTags: ["recycler_repairs"],
      factionId: "faction_compact",
      locationId: "settlement_helios",
      memories: []
    },
    {
      id: "sela_001",
      name: "Sela Rhun",
      role: "Mediator",
      health: 79,
      stress: 27,
      morale: 77,
      traits: ["observant", "diplomatic"],
      memoryTags: ["front_contact"],
      factionId: "faction_compact",
      locationId: "settlement_helios",
      memories: []
    }
  ];
}

function simulation(): SystemicSimulationState {
  return {
    schemaVersion: 1,
    // A fresh world has not ticked yet. The first `runWorldTick` produces tick 1,
    // exactly as the first player decision produces Player Turn 2 from turn 1.
    tick: 0,
    settlements: [
      {
        id: "settlement_helios",
        name: "Helios Reach",
        controllingFactionId: "faction_compact",
        population: 1840,
        stability: 0.61,
        satisfaction: 0.54,
        resourceStock: {
          water: 14,
          energy: 42,
          food: 31,
          medicine: 8
        },
        productionNodeIds: ["prod_recycler_01"],
        cohortIds: ["cohort_industrial", "cohort_service"],
        politicalGroupIds: ["group_labor", "group_security"]
      }
    ],
    factions: [
      {
        id: "faction_compact",
        name: "Helios Civic Compact",
        influence: 58,
        reputation: 12,
        resources: { credits: 36, supply: 24 },
        relations: { faction_front: -38 },
        memoryTags: ["supply_route_contested"]
      },
      {
        id: "faction_front",
        name: "Rimward Front",
        influence: 46,
        reputation: -18,
        resources: { credits: 28, supply: 31 },
        relations: { faction_compact: -38 },
        memoryTags: ["relay_control"]
      }
    ],
    productionNodes: [
      {
        id: "prod_recycler_01",
        settlementId: "settlement_helios",
        recipe: "water_recycling",
        capacity: 12,
        efficiency: 0.68,
        labor: 22,
        inputs: { energy: 4 },
        outputs: { water: 8 },
        condition: 0.73,
        enabled: true
      }
    ],
    populationCohorts: [
      {
        id: "cohort_industrial",
        settlementId: "settlement_helios",
        population: 1080,
        occupation: "industrial",
        wealth: "low",
        culture: "frontier_settler",
        satisfaction: 0.49,
        loyalty: 0.58,
        politicalAffinity: "group_labor",
        needs: { water: 0.92, food: 0.78, security: 0.63, employment: 0.81 }
      },
      {
        id: "cohort_service",
        settlementId: "settlement_helios",
        population: 760,
        occupation: "service_and_logistics",
        wealth: "middle",
        culture: "frontier_settler",
        satisfaction: 0.61,
        loyalty: 0.66,
        politicalAffinity: "group_security",
        needs: { water: 0.88, food: 0.72, security: 0.79, employment: 0.69 }
      }
    ],
    politicalGroups: [
      {
        id: "group_labor",
        settlementId: "settlement_helios",
        name: "Labor Assembly",
        influence: 0.56,
        approval: 0.48,
        resources: 18,
        goals: ["stable_water_access", "protect_shifts"],
        redLines: ["water_rationing_without_voice"],
        leaderId: "mara_001",
        relationships: { group_security: -0.12 }
      },
      {
        id: "group_security",
        settlementId: "settlement_helios",
        name: "Security Council",
        influence: 0.44,
        approval: 0.59,
        resources: 16,
        goals: ["secure_relay_route", "preserve_order"],
        redLines: ["front_control_of_relay"],
        leaderId: "brann_001",
        relationships: { group_labor: -0.12 }
      }
    ],
    warfareSquads: [
      {
        id: "squad_compact_01",
        factionId: "faction_compact",
        name: "Helios First Watch",
        personnel: 14,
        morale: 72,
        readiness: 68,
        supply: 61,
        intelligence: 48,
        commanderId: "brann_001"
      },
      {
        id: "squad_front_01",
        factionId: "faction_front",
        name: "Rimward Relay Guard",
        personnel: 16,
        morale: 69,
        readiness: 74,
        supply: 73,
        intelligence: 64
      }
    ],
    delayedConsequences: [
      {
        id: "con_relay_debt_01",
        triggerTurn: 4,
        visibility: "hidden",
        scope: "settlement",
        effects: [
          { type: "RESOURCE_DELTA", key: "credits", value: -3 },
          { type: "FLAG_SET", key: "relay_debt_called", value: true }
        ],
        reversible: true,
        status: "pending",
        source: {
          kind: "system",
          id: "scenario_bootstrap",
          rule: "relay_emergency_credit"
        }
      }
    ]
  };
}

/**
 * Deterministic M1-A scenario: enough persistent entities to prove that person,
 * unit and society can share one authoritative WorldState without AI.
 */
export function createSystemicScenario(seed = 7419): WorldState {
  const base = createCampaign(seed);
  return {
    ...base,
    resources: {
      ...base.resources,
      water: 14,
      energy: 42,
      food: 31,
      medicine: 8
    },
    party: characters(),
    flags: {
      ...base.flags,
      relay_route_contested: true,
      water_shortage_risk: true
    },
    simulation: simulation()
  };
}
