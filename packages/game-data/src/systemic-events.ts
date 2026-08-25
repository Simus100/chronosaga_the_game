import type { GameEvent } from "@paa/game-types";

/**
 * Events that touch the settlement's own stock, so the world can answer.
 *
 * `demoEvents` spend credits, provisions and alloys — campaign resources no
 * settlement holds. Spending them is a real authoritative change, but nothing
 * downstream reacts: production consumes water and food, cohorts go hungry over
 * shortage, politics answers cohorts. A choice about credits therefore produces
 * a number that moves and a world that does not notice.
 *
 * These spend water, which is the resource the M1 simulation is actually built
 * around. That is what makes the chain visible to a player:
 *
 * ```text
 * choice        water leaves the settlement stock
 * world tick    production runs short, consumption bites
 * cohorts       satisfaction falls
 * politics      groups react to their cohorts
 * faction       resource pressure flag is raised
 * memory        the quartermaster remembers the shortage
 * ```
 *
 * Deliberately few. A narrow first playable loop needs enough content to show
 * cause and effect, not a content library.
 */
export const systemicEvents: GameEvent[] = [
  {
    id: "evt_reservoir_rationing",
    version: 1,
    title: "LA RISERVA CALA",
    body:
      "Il livello della cisterna di Helios Reach è sceso sotto la soglia di sicurezza. " +
      "Mara Senn aspetta una decisione prima che il turno di distribuzione cominci.",
    category: "settlement",
    tags: ["resource", "water", "systemic"],
    weight: 2,
    choices: [
      {
        id: "release_reserve",
        label: "APRIRE LA RISERVA",
        description:
          "Distribuire subito 4 unità d'acqua. La popolazione è servita oggi; la produzione ne risentirà.",
        requirements: { resources: { water: 4 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "water", value: -4 },
          { type: "FLAG_SET", key: "reserve_released", value: true }
        ]
      },
      {
        id: "hold_reserve",
        label: "TRATTENERE LA RISERVA",
        description:
          "Nessuna distribuzione straordinaria. Lo stock regge, il malcontento cresce.",
        effects: [
          { type: "PRESSURE_DELTA", value: 1 },
          { type: "FLAG_SET", key: "reserve_withheld", value: true }
        ]
      },
      {
        id: "ration_strictly",
        label: "RAZIONARE",
        description:
          "Mezza distribuzione, sotto controllo di Brann Vale. Costa poco e scontenta un po' tutti.",
        requirements: { resources: { water: 2 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "water", value: -2 },
          { type: "CHARACTER_STRESS", targetId: "brann_001", value: 4 },
          { type: "FLAG_SET", key: "strict_rationing", value: true }
        ]
      }
    ]
  },
  {
    id: "evt_recycler_maintenance",
    version: 1,
    title: "IL RICICLATORE CHIEDE MANUTENZIONE",
    body:
      "Tarek Oss riferisce che il riciclatore perde efficienza. Fermarlo costa energia adesso; " +
      "lasciarlo andare costa acqua per tutti i turni a venire.",
    category: "settlement",
    tags: ["production", "energy", "systemic"],
    weight: 1.5,
    requirements: { flagsNone: ["recycler_serviced"] },
    choices: [
      {
        id: "service_now",
        label: "MANUTENZIONE IMMEDIATA",
        description: "Spendere 6 unità di energia per rimettere in servizio il riciclatore.",
        requirements: { resources: { energy: 6 } },
        effects: [
          { type: "RESOURCE_DELTA", key: "energy", value: -6 },
          { type: "FLAG_SET", key: "recycler_serviced", value: true }
        ]
      },
      {
        id: "defer_service",
        label: "RIMANDARE",
        description: "Nessun costo oggi. Il problema resta aperto.",
        effects: [
          { type: "PRESSURE_DELTA", value: 1 },
          { type: "FLAG_SET", key: "recycler_deferred", value: true }
        ]
      }
    ]
  }
];
