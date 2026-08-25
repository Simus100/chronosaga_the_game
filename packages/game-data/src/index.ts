export * from "./systemic-events";
import type { GameEvent } from "@paa/game-types";

export const demoEvents: GameEvent[] = [
  {
    id: "evt_bridge_memory",
    version: 1,
    title: "THE BRIDGE REMEMBERS",
    body: "A basalt bridge beneath the dormant relay repeats fragments of voices belonging to previous travelers. Then it speaks one of your names.",
    category: "exploration",
    tags: ["mystery", "memory"],
    weight: 1.3,
    choices: [
      {
        id: "investigate",
        label: "INVESTIGATE",
        description: "Spend provisions and examine the signal.",
        requirements: { resources: { provisions: 1 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "provisions", value: -1 },
          { type: "FLAG_SET", key: "bridge_memory", value: true }
        ]
      },
      {
        id: "escort",
        label: "ESCORT THE CARAVAN",
        description: "Convert risk into material gain.",
        effects: [
          { type: "RESOURCE_DELTA", key: "credits", value: 8 },
          { type: "PRESSURE_DELTA", value: 1 },
          { type: "FLAG_SET", key: "caravan_debt", value: true }
        ]
      },
      {
        id: "wake_relay",
        label: "WAKE THE RELAY",
        description: "Force the sealed system online.",
        requirements: { resources: { alloys: 2 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "alloys", value: -2 },
          { type: "PRESSURE_DELTA", value: 2 },
          { type: "FLAG_SET", key: "relay_awake", value: true }
        ]
      }
    ]
  },
  {
    id: "evt_masked_levy",
    version: 1,
    title: "THE MASKED LEVY",
    body: "Three masked collectors demand a tax that does not exist in any local registry.",
    category: "social",
    tags: ["faction", "pressure"],
    weight: 1,
    requirements: { minTurn: 2 },
    choices: [
      {
        id: "pay",
        label: "PAY",
        requirements: { resources: { credits: 6 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "credits", value: -6 },
          { type: "PRESSURE_DELTA", value: -1 }
        ]
      },
      {
        id: "refuse",
        label: "REFUSE",
        effects: [
          { type: "PRESSURE_DELTA", value: 1 },
          { type: "FLAG_SET", key: "collectors_hostile", value: true }
        ]
      }
    ]
  }
];
