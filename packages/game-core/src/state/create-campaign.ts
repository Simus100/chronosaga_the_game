import type { WorldState } from "@paa/game-types";

export function createCampaign(seed = 7419): WorldState {
  return {
    campaignId: `cmp_${seed}`,
    seed,
    turn: 1,
    day: 1,
    worldPressure: 2,
    resources: {
      provisions: 18,
      credits: 27,
      alloys: 9,
      influence: 4
    },
    flags: {},
    party: [
      {
        id: "ira_001",
        name: "Ira Venn",
        role: "Cartographer",
        health: 82,
        stress: 18,
        morale: 74,
        traits: ["analytical", "cautious"],
        memoryTags: []
      },
      {
        id: "brann_001",
        name: "Brann",
        role: "Guardian",
        health: 96,
        stress: 24,
        morale: 81,
        traits: ["loyal", "impulsive"],
        memoryTags: []
      }
    ],
    profile: {
      difficulty: "standard",
      mortality: "standard",
      campaignLength: "extended",
      aiMode: "procedural",
      simulationDepth: "standard"
    }
  };
}
