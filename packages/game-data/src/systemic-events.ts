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
 * world tick    population consumption draws on a thinner stock
 * cohorts       satisfaction falls as the shortage margin closes
 * politics      groups react to their cohorts
 * memory        a character who lives through it carries the tag
 * ```
 *
 * Note what is NOT in that chain: production. The recycler's recipe takes
 * energy and yields water, so spending water does not slow production — it
 * shortens the margin population consumption eats into. Prose that promised
 * otherwise would teach the player the wrong causal model, which is worse
 * than prose that says less.
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
          "Distribuire subito 4 unità d'acqua. La popolazione è servita oggi, e la riserva su cui " +
          "il consumo attinge si assottiglia.",
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
          "Nessuna distribuzione straordinaria. Lo stock regge; la decisione resta a verbale.",
        effects: [
          { type: "PRESSURE_DELTA", value: 1 },
          { type: "FLAG_SET", key: "reserve_withheld", value: true }
        ]
      },
      {
        id: "ration_strictly",
        label: "RAZIONARE",
        description:
          "Mezza distribuzione, sotto controllo di Brann Vale. Costa poco alla cisterna e molto a lui.",
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
      "Tarek Oss riferisce che il riciclatore perde efficienza. Fermarlo costa energia adesso. " +
      "Lasciarlo andare non costa nulla oggi, e Tarek non promette che resti così.",
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
