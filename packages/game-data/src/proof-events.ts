import type { EventEffect, ProofEvent } from "@paa/game-types";

/**
 * The proof event network (GQP spec 11, slice 25): F1 SCARCITY / TRIAGE,
 * F2 MAINTENANCE, F3 UNREGISTERED CONDUIT (GQP-B), F4 PUBLIC ACCOUNTABILITY
 * and F5 EXTERNAL RESCUE (GQP-C).
 *
 * Content, not rules. Every consequence here is a typed effect the Core
 * validates and applies; every condition is a typed predicate the Core
 * evaluates. Nothing in this file decides anything by itself, and no rule
 * anywhere reads the titles, bodies, labels or summaries below -- they are
 * PROVISIONAL presentation text, free to change without changing play.
 *
 * What is authoritative is the ids and the causal wiring:
 *
 *   - which fact a choice records, on whom, with which behaviour hook;
 *   - which predicate a later event or option reads;
 *   - which consequence a choice schedules, and which memory foreshadows it.
 *
 * The network is state-sensitive rather than sequential. No event requires a
 * specific earlier event; each reads state that more than one path can
 * produce, and several choices make later variants unnecessary.
 */

const SETTLEMENT = "settlement_helios";
const RECYCLER = "prod_recycler_01";

type MemoryFields = Omit<Extract<EventEffect, { type: "MEMORY_RECORD" }>, "type">;

function memory(fields: MemoryFields): EventEffect {
  return { type: "MEMORY_RECORD", ...fields };
}

// ---------------------------------------------------------------------------
// F2 MAINTENANCE -- spend scarce capacity now, or preserve short-term service.
// Tarek (technical integrity) warns early and remembers ignored warnings.
// ---------------------------------------------------------------------------

const f2RecyclerWarning: ProofEvent = {
  id: "evt_f2_recycler_warning",
  familyId: "maintenance",
  taxonomy: "DILEMMA",
  // Below a working condition. The Council's reliability desire is conceded
  // at 0.8, so this is also the event that can satisfy it.
  eligibility: [{ predicate: "node_condition_below", nodeId: RECYCLER, value: 0.8 }],
  presentation: {
    title: "Il riciclatore si sta surriscaldando",
    body: "Tarek Oss segnala rigature sulle guarnizioni della pompa del riciclatore. Una revisione completa toglie energia che oggi serve all'insediamento; una toppa lo tiene in funzione per ora."
  },
  choices: [
    {
      id: "full_maintenance",
      label: "Fermalo per una revisione completa",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -10 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.22 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_maintained",
          valence: "positive",
          salience: 0.7,
          exposure: "private",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Chi guida Helios ha dato al riciclatore la revisione che gli serviva.",
          tags: ["recycler", "maintenance"]
        })
      ],
      disclosure: {
        risks: ["supply"],
        unknowns: ["Quanto reggono le guarnizioni rifatte sotto un carico in più."]
      }
    },
    {
      id: "patch_and_defer",
      label: "Rattoppa le guarnizioni e tienilo acceso",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -3 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.04 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_warning_ignored",
          valence: "negative",
          salience: 0.8,
          exposure: "private",
          behaviorHook: "offer_unprompted_warning",
          callbackEligible: true,
          summary: "Il mio avvertimento sulle guarnizioni è stato coperto con una toppa.",
          tags: ["recycler", "warning"]
        })
      ],
      schedules: [
        {
          key: "wear",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: -0.3 }],
          breadcrumb: { memoryId: "fact_f2_warning_ignored" }
        }
      ],
      disclosure: {
        knownNotes: ["La toppa non è una riparazione."],
        risks: ["infrastructure", "social"],
        unknowns: ["Quando le guarnizioni rattoppate cederanno."]
      }
    },
    {
      id: "divert_clinic_power",
      label: "Prendi l'energia dell'ambulatorio per la revisione",
      effects: [
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.15 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.06 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f2_clinic_dark",
          valence: "negative",
          salience: 0.6,
          exposure: "public",
          callbackEligible: true,
          summary: "L'ambulatorio è rimasto al buio perché si potesse riparare il riciclatore.",
          tags: ["clinic", "power"]
        })
      ],
      disclosure: {
        risks: ["epidemic", "social"],
        unknowns: ["Quanti pazienti costeranno i giorni al buio."]
      }
    }
  ]
};

const f2TarekSecondWarning: ProofEvent = {
  id: "evt_f2_tarek_second_warning",
  familyId: "maintenance",
  // A warning that asks for a decision with a real cost either way -- power
  // now, or Tarek's willingness to help later -- is a dilemma, and passes the
  // same quality gates as every other one. (Was SIGNAL, which kept it out of
  // the GQP-1/GQP-2 audits.)
  taxonomy: "DILEMMA",
  // Tarek warns unprompted only because he remembers being overruled, and only
  // while the damage he warned about is still on its way.
  eligibility: [
    { predicate: "memory_hook_present", characterId: "tarek_001", hook: "offer_unprompted_warning", value: true },
    {
      predicate: "consequence_status",
      consequenceId: "con.evt_f2_recycler_warning.patch_and_defer.wear",
      status: "pending"
    }
  ],
  presentation: {
    title: "Tarek non molla",
    body: "Tarek torna senza che nessuno lo chiami. La toppa perde di nuovo, dice, e non reggerà un altro ciclo di turni."
  },
  choices: [
    {
      id: "authorize_inspection",
      label: "Autorizza subito un'ispezione",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -5 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.14 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_warning_heeded",
          valence: "positive",
          salience: 0.6,
          exposure: "private",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "La seconda volta, chi guida Helios mi ha ascoltato.",
          tags: ["recycler", "warning"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Se l'ispezione arriva in tempo."] }
    },
    {
      id: "let_it_ride",
      label: "Digli di tenerlo acceso",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 10 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_warning_dismissed",
          valence: "negative",
          salience: 0.9,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Per due volte mi hanno detto di tenere accesa una pompa che stava cedendo.",
          tags: ["recycler", "warning"]
        })
      ],
      disclosure: { risks: ["infrastructure", "social"], unknowns: ["Cosa farà Tarek la prossima volta."] }
    }
  ]
};

const f2RecyclerBreakdown: ProofEvent = {
  id: "evt_f2_recycler_breakdown",
  familyId: "maintenance",
  taxonomy: "CRISIS_PAYOFF",
  eligibility: [{ predicate: "node_condition_below", nodeId: RECYCLER, value: 0.6 }],
  // GQP-C: a breakdown Tarek warned about twice is the one that answers to it.
  relevance: [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "tarek_001", value: true }],
  presentation: {
    title: "Il riciclatore si guasta",
    body: "Le guarnizioni cedono. La produzione d'acqua si riduce a un filo, e ogni strada per tornare indietro costa qualcosa che l'insediamento stava mettendo da parte."
  },
  choices: [
    {
      // Recovery by consuming strategic stock.
      id: "emergency_rebuild",
      label: "Ricostruiscilo con la riserva di leghe",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -8 },
        { type: "RESOURCE_DELTA", key: "alloys", value: -4 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.3 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f2_reserve_spent",
          valence: "ambivalent",
          salience: 0.6,
          exposure: "private",
          callbackEligible: true,
          summary: "La riserva di leghe è finita nel riciclatore.",
          tags: ["recycler", "reserve"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["A cosa sarebbe servita la riserva di leghe."] }
    },
    {
      // Tarek helps -- unless he has already been overruled twice.
      id: "tarek_quick_fix",
      label: "Chiedi a Tarek una riparazione rapida",
      availability: [
        { predicate: "memory_hook_present", characterId: "tarek_001", hook: "refuse_similar_request", value: false }
      ],
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -3 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.2 },
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 15 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_quick_fix",
          valence: "ambivalent",
          salience: 0.6,
          exposure: "private",
          callbackEligible: true,
          summary: "L'ho rimesso in funzione, ma non come si deve.",
          tags: ["recycler", "repair"]
        })
      ],
      schedules: [
        {
          key: "relapse",
          delay: 3,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: -0.12 }],
          breadcrumb: { memoryId: "fact_f2_quick_fix" }
        }
      ],
      disclosure: { risks: ["infrastructure", "social"], unknowns: ["Quanto dura una riparazione rapida."] }
    },
    {
      // Channel 2 at work: Mara knows because Tarek told her.
      id: "mara_salvaged_parts",
      label: "Usa i pezzi che Mara ha messo da parte",
      availability: [
        { predicate: "memory_known", characterId: "mara_001", memoryId: "fact_f2_warning_ignored", value: true }
      ],
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -6 },
        { type: "RESOURCE_DELTA", key: "alloys", value: -1 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.28 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f2_parts_salvaged",
          valence: "positive",
          salience: 0.6,
          exposure: "private",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Avevo i pezzi pronti perché Tarek l'aveva visto arrivare.",
          tags: ["recycler", "supply"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Dove Mara ha trovato i pezzi."] }
    },
    {
      // Recovery by accepting technical dependency on a faction.
      id: "front_technicians",
      label: "Fallo riparare ai tecnici della Lega",
      availability: [
        { predicate: "memory_hook_present", characterId: "mara_001", hook: "refuse_similar_request", value: false },
        { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false }
      ],
      effects: [
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.3 },
        { type: "FLAG_SET", key: "front_access_granted", value: true },
        { type: "PRESSURE_DELTA", value: 1 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f2_league_contract",
          valence: "ambivalent",
          salience: 0.7,
          exposure: "public",
          callbackEligible: true,
          summary: "Ora sono i tecnici della Lega ad avere il contratto di manutenzione del riciclatore.",
          tags: ["recycler", "league"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["Cosa chiederà la Lega la prossima volta."] }
    },
    {
      id: "accept_degradation",
      label: "Fallo andare a regime ridotto e raziona l'acqua",
      effects: [
        { type: "FLAG_SET", key: "recycler_running_degraded", value: true },
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: 0.04 },
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 10 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_left_broken",
          valence: "negative",
          salience: 0.8,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Il riciclatore è stato lasciato rotto di proposito.",
          tags: ["recycler"]
        })
      ],
      disclosure: {
        risks: ["infrastructure", "epidemic", "social"],
        unknowns: ["Per quanto l'insediamento può vivere con un filo d'acqua."]
      }
    }
  ]
};

// ---------------------------------------------------------------------------
// F3 UNREGISTERED CONDUIT -- a fast, undeclared fix against political exposure.
// Mara (practical autonomy) opens informal options and carries their debts.
// ---------------------------------------------------------------------------

const f3ConduitOffer: ProofEvent = {
  id: "evt_f3_conduit_offer",
  familyId: "unregistered_conduit",
  taxonomy: "DILEMMA",
  // Offered while the recycler is failing; a maintained recycler makes the
  // conduit unnecessary and the offer never comes.
  eligibility: [{ predicate: "infrastructure_stage_in", settlementId: SETTLEMENT, stages: ["CRITICAL", "CRISIS"] }],
  // GQP-C: the League offers its line because it wants a way into Helios.
  relevance: [{ predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false }],
  presentation: {
    title: "Una linea dalla Lega",
    body: "Stanotte Mara Senn può collegare una linea elettrica della Lega del Libero Condotto alla dorsale del riciclatore. Nessuno nel Consiglio deve saperlo — a meno che non glielo dica tu."
  },
  choices: [
    {
      id: "tap_quietly",
      label: "Collegala senza dire nulla",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: 10 },
        { type: "FLAG_SET", key: "unregistered_conduit_active", value: true },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: -0.05 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f3_secret_tap",
          subjectId: "faction_front",
          valence: "ambivalent",
          salience: 0.9,
          exposure: "secret",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "Siamo in debito con la Lega per una linea che nessuno ha dichiarato.",
          tags: ["conduit", "league", "secret"]
        })
      ],
      schedules: [
        {
          key: "strain",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: -0.1 }],
          breadcrumb: { memoryId: "fact_f3_secret_tap" }
        }
      ],
      disclosure: {
        risks: ["infrastructure", "political"],
        unknowns: ["Cosa vorrà la Lega in cambio.", "Se qualcuno si accorge del prelievo."]
      }
    },
    {
      id: "register_the_line",
      label: "Registra la linea presso il Consiglio",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: 5 },
        { type: "RESOURCE_DELTA", key: "credits", value: -5 },
        { type: "FLAG_SET", key: "conduit_registered", value: true },
        { type: "FLAG_SET", key: "front_access_granted", value: true },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f3_line_registered",
          subjectId: "faction_front",
          valence: "positive",
          salience: 0.6,
          exposure: "public",
          callbackEligible: true,
          summary: "La linea della Lega è nei registri del Consiglio.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: {
        risks: ["political"],
        unknowns: ["Come il Consiglio leggerà una linea della Lega sulla sua rete."]
      }
    },
    {
      id: "decline",
      label: "Rifiuta la linea della Lega",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "mara_001", value: 5 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f3_offer_declined",
          subjectId: "faction_front",
          valence: "negative",
          salience: 0.7,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Ho bruciato un contatto della Lega per niente.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: {
        risks: ["supply", "social"],
        unknowns: ["Se la Lega lo chiederà di nuovo."]
      }
    }
  ]
};

const f3DebtCalled: ProofEvent = {
  id: "evt_f3_debt_called",
  familyId: "unregistered_conduit",
  taxonomy: "COMPLICATION",
  // The League's desire for access is what calls the debt in (GQP-6), and it
  // reaches the steward through the one person who holds the secret.
  eligibility: [
    { predicate: "flag_equals", key: "unregistered_conduit_active", value: true },
    { predicate: "memory_hook_present", characterId: "mara_001", hook: "call_in_debt", subjectId: "faction_front", value: true },
    { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false }
  ],
  // GQP-C: a League that already holds the settlement's debts, or whose line
  // has been found, calls it in with more weight.
  relevance: [
    { predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: true },
    { predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", subject: "fact_f3_secret_tap", value: true }
  ],
  presentation: {
    title: "La Lega presenta il conto della linea",
    body: "Mara porta un messaggio: la Lega vuole un accesso stabile a Helios in cambio dell'energia che ha mandato finora. In silenzio, oppure smette."
  },
  choices: [
    {
      id: "grant_access_quietly",
      label: "Concedi l'accesso, senza dire nulla",
      effects: [
        { type: "FLAG_SET", key: "front_access_granted", value: true },
        { type: "RESOURCE_DELTA", key: "energy", value: 4 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f3_quiet_deal",
          subjectId: "faction_front",
          valence: "ambivalent",
          salience: 0.8,
          exposure: "secret",
          callbackEligible: true,
          summary: "Ho dato alla Lega un accesso che il Consiglio non ha mai approvato.",
          tags: ["conduit", "league", "secret"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["Chi altro verrà a sapere dell'accordo."] }
    },
    {
      // Channel 3 made explicit: the secret is published, not discovered.
      id: "disclose_and_register",
      label: "Rendi pubblica la linea e registrala",
      effects: [
        { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_f3_secret_tap" },
        { type: "FLAG_SET", key: "conduit_registered", value: true },
        { type: "FLAG_SET", key: "unregistered_conduit_active", value: false },
        { type: "PRESSURE_DELTA", value: 2 },
        { type: "CHARACTER_STRESS", targetId: "brann_001", value: 10 }
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Come la comunità prenderà l'essere informata tardi."]
      }
    },
    {
      id: "cut_the_line",
      label: "Taglia la linea e salda il debito con la Lega",
      effects: [
        { type: "FLAG_SET", key: "unregistered_conduit_active", value: false },
        { type: "RESOURCE_DELTA", key: "energy", value: -6 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f3_line_cut",
          subjectId: "faction_front",
          valence: "negative",
          salience: 0.8,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Mi hanno fatto tagliare la linea che avevo collegato.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: { risks: ["supply", "social"], unknowns: ["Se Mara tratterà ancora con la Lega."] }
    }
  ]
};

// ---------------------------------------------------------------------------
// F1 SCARCITY / TRIAGE -- the clinic's survival against the strategic reserve.
// Ira (duty of care) carries triage; Sela (community voice) carries the public.
// ---------------------------------------------------------------------------

const f1ClinicRequest: ProofEvent = {
  id: "evt_f1_clinic_request",
  familyId: "scarcity_triage",
  taxonomy: "DILEMMA",
  eligibility: [{ predicate: "epidemic_stage_in", stages: ["STRAINED", "CRITICAL", "CRISIS"] }],
  presentation: {
    title: "L'ambulatorio chiede la riserva",
    body: "Ira Venn ha bisogno di acqua e medicinali dalla riserva strategica per evitare che il reparto sovraffollato diventi un focolaio."
  },
  choices: [
    {
      id: "treat_now",
      label: "Apri la riserva all'ambulatorio",
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: -3 },
        { type: "RESOURCE_DELTA", key: "water", value: -3 },
        { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: -0.04 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_clinic_supplied",
          valence: "positive",
          salience: 0.7,
          exposure: "private",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Quando il reparto ne ha avuto bisogno, la riserva è stata aperta.",
          tags: ["clinic", "triage"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Se la riserva durerà per tutta la stagione."] }
    },
    {
      id: "protect_reserve",
      label: "Tieni sigillata la riserva",
      effects: [
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.1 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_clinic_refused",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "All'ambulatorio è stata negata la riserva, davanti a tutti.",
          tags: ["clinic", "triage"]
        })
      ],
      schedules: [
        {
          key: "spread",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: 0.08 }],
          breadcrumb: { memoryId: "fact_f1_clinic_refused" }
        }
      ],
      disclosure: {
        risks: ["epidemic", "social"],
        unknowns: ["Quanto in fretta si diffondono i casi non curati."]
      }
    },
    {
      id: "ration_district",
      label: "Raziona invece il distretto basso",
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: -1 },
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: 0.05 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f1_district_rationed",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "raise_publicly",
          callbackEligible: true,
          summary: "Il distretto basso ha sopportato la carenza al posto di tutti gli altri.",
          tags: ["rationing", "district"]
        })
      ],
      disclosure: {
        risks: ["epidemic", "political"],
        unknowns: ["Se il distretto lo accetterà."]
      }
    }
  ]
};

const f1IraPreventionDrive: ProofEvent = {
  id: "evt_f1_ira_prevention_drive",
  familyId: "scarcity_triage",
  taxonomy: "OPPORTUNITY_REQUEST",
  // Ira proposes this only because she remembers the reserve being opened.
  eligibility: [
    { predicate: "memory_hook_present", characterId: "ira_001", hook: "volunteer_help", value: true },
    { predicate: "epidemic_stage_in", stages: ["STRAINED", "CRITICAL", "CRISIS"] }
  ],
  presentation: {
    title: "Ira ha un piano",
    body: "Ira si offre di guidare dei volontari nel distretto per riparare le cisterne delle case prima delle settimane secche, se l'ambulatorio può fare a meno di lei."
  },
  choices: [
    {
      id: "back_the_drive",
      label: "Sostieni la campagna delle cisterne",
      effects: [
        { type: "RESOURCE_DELTA", key: "water", value: 4 },
        { type: "RESOURCE_DELTA", key: "medicine", value: -1 },
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 10 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f1_drive_joined",
          valence: "positive",
          salience: 0.6,
          exposure: "public",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Il distretto ha riparato le proprie cisterne insieme all'ambulatorio.",
          tags: ["district", "water"]
        })
      ],
      disclosure: { risks: ["supply", "social"], unknowns: ["Se l'ambulatorio se la caverà senza Ira."] }
    },
    {
      id: "keep_ira_at_the_clinic",
      label: "Tieni Ira all'ambulatorio",
      effects: [
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_drive_declined",
          valence: "negative",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "Il mio piano per le cisterne è stato messo da parte.",
          tags: ["clinic", "water"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Se le settimane secche arriveranno in anticipo."] }
    }
  ]
};

const f1Outbreak: ProofEvent = {
  id: "evt_f1_outbreak",
  familyId: "scarcity_triage",
  taxonomy: "CRISIS_PAYOFF",
  eligibility: [{ predicate: "epidemic_stage_in", stages: ["CRITICAL", "CRISIS"] }],
  // GQP-C: an outbreak in a district that has carried the cost twice.
  relevance: [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", value: true }],
  presentation: {
    title: "Focolaio",
    body: "La febbre è in tre distretti. Ira ha bisogno di una decisione prima che finisca il giorno."
  },
  choices: [
    {
      // Recovery by spending medicine and productive capacity.
      id: "full_treatment_campaign",
      label: "Avvia una campagna di cure completa",
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: -4 },
        { type: "RESOURCE_DELTA", key: "energy", value: -6 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.12 },
        { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: -0.06 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_campaign_run",
          valence: "ambivalent",
          salience: 0.7,
          exposure: "private",
          callbackEligible: true,
          summary: "L'abbiamo respinta, e per farlo abbiamo svuotato gli scaffali.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Se tornerà."] }
    },
    {
      // Ira stretches the clinic for a steward -- unless she remembers being
      // turned away by the same steward in front of everyone.
      id: "clinic_stretches_supplies",
      label: "Lascia che Ira faccia bastare quello che l'ambulatorio ha",
      availability: [
        { predicate: "memory_hook_present", characterId: "ira_001", hook: "refuse_similar_request", value: false }
      ],
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: -2 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.08 },
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 20 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_stretched_thin",
          valence: "negative",
          salience: 0.7,
          exposure: "private",
          callbackEligible: true,
          summary: "Ho contenuto il focolaio con la metà di quello che serviva.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["social"], unknowns: ["Per quanto Ira potrà reggere così."] }
    },
    {
      // Recovery by isolating a district and paying in consent. Closed once
      // the community has publicly seen the clinic turned away.
      id: "quarantine_district",
      label: "Metti il distretto in quarantena",
      availability: [
        { predicate: "memory_known", characterId: "sela_001", memoryId: "fact_f1_clinic_refused", value: false }
      ],
      effects: [
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.08 },
        { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: -0.06 },
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: 0.04 },
        { type: "PRESSURE_DELTA", value: 1 },
        { type: "CHARACTER_STRESS", targetId: "sela_001", value: 10 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f1_quarantine_imposed",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "raise_publicly",
          callbackEligible: true,
          summary: "Hanno sigillato il distretto e l'hanno chiamata cura.",
          tags: ["district", "outbreak"]
        })
      ],
      disclosure: { risks: ["political", "social"], unknowns: ["Se il distretto terrà duro."] }
    },
    {
      // Recovery by external supply, at a political price. The Council opens
      // its stores to a settlement it considers reliable -- an agenda item.
      id: "council_medical_stores",
      label: "Chiedi al Consiglio le sue scorte mediche",
      availability: [{ predicate: "agenda_satisfied", agendaId: "agenda_co_reliability", value: true }],
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: 4 },
        { type: "RESOURCE_DELTA", key: "credits", value: -5 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.1 },
        { type: "PRESSURE_DELTA", value: 1 },
        { type: "FLAG_SET", key: "council_stores_drawn", value: true },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f1_council_favour",
          subjectId: "faction_compact",
          valence: "ambivalent",
          salience: 0.7,
          exposure: "private",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "Le scorte del Consiglio sono arrivate insieme alla memoria del Consiglio.",
          tags: ["outbreak", "council"]
        })
      ],
      disclosure: {
        knownNotes: ["Le scorte si vendono al prezzo del Consiglio, sotto gli occhi del Consiglio."],
        risks: ["political"],
        unknowns: ["Cosa chiederà il Consiglio in cambio."]
      }
    },
    {
      id: "ride_it_out",
      label: "Tieni quello che hai e aspetta che passi",
      effects: [
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: 0.05 },
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 15 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_outbreak_endured",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          callbackEligible: true,
          summary: "Ci hanno detto di sopportare.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["epidemic", "social"], unknowns: ["Quante vite costerà."] }
    }
  ]
};

// ---------------------------------------------------------------------------
// F5 EXTERNAL RESCUE -- solve a crisis now, or take on political debt.
// Help always costs an immediate agenda item with the *other* faction, and a
// growing dependency (FACTION_DEPENDENCY_GROWING) changes what the same faction
// asks the next time: the third call for help is a political position.
// ---------------------------------------------------------------------------

const noLeagueDependency = { predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: false } as const;
const leagueDependency = { predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front", value: true } as const;
const noCouncilDependency = { predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_compact", value: false } as const;
const councilTrusts = { predicate: "agenda_satisfied", agendaId: "agenda_co_reliability", value: true } as const;
// The League offers help because it wants a way into Helios (spec 8, FCL short
// desire). While that desire is open, its offers answer to it (GQP-6).
const leagueWantsAccess = { predicate: "agenda_satisfied", agendaId: "agenda_fcl_access", value: false } as const;

const f5WaterConvoy: ProofEvent = {
  id: "evt_f5_water_convoy",
  familyId: "external_rescue",
  taxonomy: "DILEMMA",
  // The cisterns are nearly dry: under a day of the settlement's own demand.
  eligibility: [{ predicate: "resource_below", key: "water", value: 5 }],
  relevance: [leagueWantsAccess, leagueDependency],
  presentation: {
    title: "Le cisterne sono quasi vuote",
    body: "Entrambe le fazioni se ne sono accorte. I trasportatori della Lega possono essere al cancello entro sera; il Consiglio manderà una quota, al prezzo del Consiglio. Oppure Helios razionerà quello che ha."
  },
  choices: [
    {
      // Once Helios owes the League twice, the League stops sending water as a
      // favour: the option closes, and its ledger (league_calls_in) opens.
      id: "league_convoy",
      label: "Prendi l'acqua della Lega",
      availability: [noLeagueDependency],
      effects: [
        { type: "RESOURCE_DELTA", key: "water", value: 10 },
        { type: "FLAG_SET", key: "league_aid_accepted", value: true },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_league_water",
          subjectId: "faction_front",
          valence: "ambivalent",
          salience: 0.7,
          exposure: "public",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "L'acqua della Lega è arrivata insieme al registro dei debiti della Lega.",
          tags: ["water", "league", "debt"]
        })
      ],
      schedules: [
        {
          key: "tithe",
          delay: 2,
          visibility: "visible",
          scope: "settlement",
          effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -4 }],
          breadcrumb: { memoryId: "fact_f5_league_water" }
        }
      ],
      disclosure: {
        knownNotes: ["Il Consiglio lo metterà in conto a Helios."],
        risks: ["political", "supply"],
        unknowns: ["Cosa chiederà la Lega la volta successiva."]
      }
    },
    {
      // The Council helps a settlement that keeps its plant running, and only
      // while Helios is not already living on its allocations.
      id: "council_allocation",
      label: "Chiedi una quota al Consiglio",
      availability: [councilTrusts, noCouncilDependency],
      effects: [
        { type: "RESOURCE_DELTA", key: "water", value: 7 },
        { type: "RESOURCE_DELTA", key: "credits", value: -6 },
        { type: "FLAG_SET", key: "council_aid_accepted", value: true },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_council_water",
          subjectId: "faction_compact",
          valence: "ambivalent",
          salience: 0.6,
          exposure: "public",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "L'acqua del Consiglio è arrivata insieme agli ispettori del Consiglio.",
          tags: ["water", "council", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["La Lega lo leggerà come una scelta di campo di Helios."],
        risks: ["political", "supply"],
        unknowns: ["Cosa si aspetta il Consiglio per la sua quota."]
      }
    },
    {
      id: "ration_the_cisterns",
      label: "Raziona le cisterne e non chiedere a nessuno",
      effects: [
        { type: "RESOURCE_DELTA", key: "water", value: 3 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.08 },
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: 0.04 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f5_cisterns_rationed",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "raise_publicly",
          callbackEligible: true,
          summary: "Il distretto ha fatto la fila davanti a rubinetti asciutti perché Helios non dovesse niente a nessuno.",
          tags: ["water", "rationing"]
        })
      ],
      disclosure: {
        knownNotes: ["Il razionamento fa risparmiare solo ciò di cui il distretto si priva."],
        risks: ["epidemic", "political", "social"],
        unknowns: ["Per quanto il distretto accetterà le file."]
      }
    }
  ]
};

const f5MedicalRelief: ProofEvent = {
  id: "evt_f5_medical_relief",
  familyId: "external_rescue",
  taxonomy: "DILEMMA",
  // The fever is spreading and the clinic's shelves are nearly bare.
  eligibility: [
    { predicate: "epidemic_stage_in", stages: ["STRAINED", "CRITICAL", "CRISIS"] },
    { predicate: "resource_below", key: "medicine", value: 6 }
  ],
  relevance: [leagueWantsAccess, leagueDependency],
  presentation: {
    title: "Gli scaffali dell'ambulatorio sono vuoti",
    body: "Ira ha razionato le ultime dosi del tonico contro la febbre. La Lega ha medici al ripetitore; il Consiglio tiene una squadra sul campo per gli insediamenti di cui si fida."
  },
  choices: [
    {
      id: "league_medics",
      label: "Fai venire i medici della Lega",
      availability: [noLeagueDependency],
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: 5 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.06 },
        { type: "FLAG_SET", key: "league_aid_accepted", value: true },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f5_league_medics",
          subjectId: "faction_front",
          valence: "ambivalent",
          salience: 0.7,
          exposure: "public",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "I medici della Lega hanno tenuto in piedi il mio reparto. Vorranno che non lo si dimentichi.",
          tags: ["clinic", "league", "debt"]
        })
      ],
      schedules: [
        {
          key: "claim",
          delay: 2,
          visibility: "visible",
          scope: "settlement",
          effects: [{ type: "RESOURCE_DELTA", key: "credits", value: -4 }],
          breadcrumb: { memoryId: "fact_f5_league_medics" }
        }
      ],
      disclosure: {
        knownNotes: ["Il Consiglio lo metterà in conto a Helios."],
        risks: ["political", "supply"],
        unknowns: ["Cosa chiederà la Lega la volta successiva."]
      }
    },
    {
      id: "league_medics_on_terms",
      label: "Fai venire i medici della Lega, alle condizioni della Lega",
      availability: [leagueDependency],
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: 5 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.06 },
        { type: "FLAG_SET", key: "league_aid_accepted", value: true },
        { type: "FLAG_SET", key: "front_access_granted", value: true },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.12 },
        { type: "PRESSURE_DELTA", value: 1 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f5_league_medic_terms",
          subjectId: "faction_front",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "I medici della Lega sono arrivati con uno statuto della Lega per l'ambulatorio.",
          tags: ["clinic", "league", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["Helios è già in debito con la Lega. Questa volta il prezzo è un accesso stabile."],
        risks: ["political", "social"],
        unknowns: ["Di chi sarà questo ambulatorio, fra una stagione."]
      }
    },
    {
      id: "council_field_team",
      label: "Chiedi la squadra sul campo del Consiglio",
      availability: [councilTrusts, noCouncilDependency],
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: 4 },
        { type: "RESOURCE_DELTA", key: "credits", value: -6 },
        { type: "EPIDEMIC_SHIFT", cause: "deferred_triage", delta: -0.08 },
        { type: "FLAG_SET", key: "council_aid_accepted", value: true },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_council_medics",
          subjectId: "faction_compact",
          valence: "ambivalent",
          salience: 0.6,
          exposure: "public",
          behaviorHook: "call_in_debt",
          callbackEligible: true,
          summary: "La squadra sul campo del Consiglio ha messo tutto per iscritto.",
          tags: ["clinic", "council", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["La Lega lo leggerà come una scelta di campo di Helios."],
        risks: ["political", "supply"],
        unknowns: ["Cosa si aspetta il Consiglio per la sua squadra."]
      }
    },
    {
      id: "pool_household_remedies",
      label: "Raccogli i rimedi delle case del distretto",
      effects: [
        { type: "RESOURCE_DELTA", key: "medicine", value: 2 },
        { type: "RESOURCE_DELTA", key: "food", value: -4 },
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 10 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f5_remedies_pooled",
          valence: "positive",
          salience: 0.6,
          exposure: "public",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Il distretto ha svuotato le proprie dispense per il reparto.",
          tags: ["clinic", "district"]
        })
      ],
      disclosure: {
        knownNotes: ["I rimedi delle case vengono scambiati con cibo che serve al distretto."],
        risks: ["epidemic", "supply", "social"],
        unknowns: ["Se i rimedi basteranno."]
      }
    }
  ]
};

// ---------------------------------------------------------------------------
// F4 PUBLIC ACCOUNTABILITY -- tell the truth about the costs, or keep room to
// manoeuvre. Every variant is gated on what actually happened: a line of
// protection, a line of neglect, a secret someone found, warnings overruled.
// Consent is the currency (POLITICAL_STANDING_SHIFT), and the League's
// lockout grievance reads the Labour Assembly's approval.
// ---------------------------------------------------------------------------

const f4OpenTheBooks: ProofEvent = {
  id: "evt_f4_open_the_books",
  familyId: "public_accountability",
  taxonomy: "DILEMMA",
  // Accountability with credibility: the player has paid real costs for the
  // district twice, and can show the numbers.
  eligibility: [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "protection", value: true }],
  presentation: {
    title: "Sela chiede i conti veri",
    body: "Finché il distretto si fida ancora di te, Sela vuole il livello reale della riserva davanti all'assemblea: quanto conteneva, quanto è costata, cosa sta arrivando."
  },
  choices: [
    {
      id: "publish_the_accounts",
      label: "Porta i conti veri davanti all'assemblea",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.12 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.06 },
        { type: "PRESSURE_DELTA", value: 1 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_books_opened",
          valence: "positive",
          salience: 0.7,
          exposure: "public",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Chi guida Helios ha letto ad alta voce i numeri veri della riserva.",
          tags: ["assembly", "accounts"]
        })
      ],
      disclosure: {
        knownNotes: ["Al comitato di sicurezza non piace che un ammanco venga letto ad alta voce."],
        risks: ["political"],
        unknowns: ["Cosa farà l'assemblea con quei numeri."]
      }
    },
    {
      id: "keep_the_margin",
      label: "Dai all'assemblea un riassunto e tieniti un margine",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.04 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_books_kept",
          valence: "negative",
          salience: 0.6,
          exposure: "private",
          behaviorHook: "raise_publicly",
          callbackEligible: true,
          summary: "Ho chiesto i numeri e ho avuto un riassunto.",
          tags: ["assembly", "accounts"]
        })
      ],
      schedules: [
        {
          key: "doubt",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.06 }],
          breadcrumb: { memoryId: "fact_f4_books_kept" }
        }
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Se Sela lascerà perdere."]
      }
    }
  ]
};

const f4DistrictDemandsAnswers: ProofEvent = {
  id: "evt_f4_district_demands_answers",
  familyId: "public_accountability",
  taxonomy: "COMPLICATION",
  // Accountability after neglect: the district has carried the cost twice.
  eligibility: [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", value: true }],
  presentation: {
    title: "Il distretto vuole una risposta",
    body: "Il distretto basso ha pagato due volte per le scelte dell'insediamento. Sela porta la sua domanda in assemblea: perché proprio loro, e adesso cosa."
  },
  choices: [
    {
      id: "make_restitution",
      label: "Ammettilo e risarcisci",
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -5 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.1 },
        { type: "EPIDEMIC_SHIFT", cause: "cohort_dissatisfaction", delta: -0.04 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_restitution",
          valence: "positive",
          salience: 0.7,
          exposure: "public",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Chi guida Helios si è assunto le perdite del distretto e ne ha ripagata una parte.",
          tags: ["assembly", "district"]
        })
      ],
      disclosure: {
        risks: ["supply"],
        unknowns: ["Se il risarcimento basterà."]
      }
    },
    {
      id: "defend_the_triage",
      label: "Difendi il triage come necessario",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.08 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.05 },
        { type: "PRESSURE_DELTA", value: 1 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_triage_defended",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          behaviorHook: "raise_publicly",
          callbackEligible: true,
          summary: "Chi guida Helios ha detto al distretto che le sue perdite erano il prezzo dell'ordine.",
          tags: ["assembly", "district"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Cosa farà il distretto con la sua rabbia."]
      }
    }
  ]
};

const f4ConduitExposed: ProofEvent = {
  id: "evt_f4_conduit_exposed",
  familyId: "public_accountability",
  taxonomy: "COMPLICATION",
  // Accountability after concealment: the spliced line has been found.
  eligibility: [{ predicate: "pattern_detected", pattern: "SECRET_ACTION_DISCOVERED", subject: "fact_f3_secret_tap", value: true }],
  presentation: {
    title: "Tarek ha trovato la linea",
    body: "Tarek ha seguito il carico inspiegato sulla dorsale del riciclatore fino a una linea della Lega che nessuno ha registrato. Te lo porta prima che lo facciano gli ispettori del Consiglio."
  },
  choices: [
    {
      id: "own_it_publicly",
      label: "Assumiti la linea davanti all'assemblea e registrala",
      effects: [
        { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_f3_secret_tap" },
        { type: "FLAG_SET", key: "conduit_registered", value: true },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.1 },
        { type: "PRESSURE_DELTA", value: 1 },
        { type: "CHARACTER_STRESS", targetId: "brann_001", value: 10 }
      ],
      disclosure: {
        knownNotes: ["Tutti sapranno che Helios andava avanti con una linea della Lega non dichiarata."],
        risks: ["political", "social"],
        unknowns: ["Se il Consiglio accetterà una registrazione tardiva."]
      }
    },
    {
      id: "bury_it",
      label: "Di' a Tarek di dimenticare quello che ha trovato",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 10 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f4_told_to_bury",
          valence: "negative",
          salience: 0.8,
          exposure: "secret",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Ho trovato una linea che nessuno aveva dichiarato, e mi hanno detto di dimenticarla.",
          tags: ["conduit", "secret"]
        })
      ],
      schedules: [
        {
          key: "leak",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.15 }],
          breadcrumb: { memoryId: "fact_f4_told_to_bury" }
        }
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["A chi altro lo dirà Tarek."]
      }
    },
    {
      id: "blame_the_quartermaster",
      label: "Fai il nome di Mara come chi l'ha collegata",
      effects: [
        { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_f3_secret_tap" },
        { type: "FLAG_SET", key: "unregistered_conduit_active", value: false },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.08 },
        { type: "CHARACTER_STRESS", targetId: "mara_001", value: 15 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f4_mara_blamed",
          valence: "negative",
          salience: 0.9,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Ho collegato quella linea per Helios, e Helios l'ha scaricata su di me.",
          tags: ["conduit", "blame"]
        })
      ],
      disclosure: {
        knownNotes: ["La linea viene staccata, e viene fuori anche chi l'ha collegata."],
        risks: ["political", "social", "supply"],
        unknowns: ["Cosa farà Mara adesso."]
      }
    }
  ]
};

const f4TarekGoesPublic: ProofEvent = {
  id: "evt_f4_tarek_goes_public",
  familyId: "public_accountability",
  taxonomy: "DILEMMA",
  // Accountability after ignored warnings: overruled twice, Tarek says so.
  eligibility: [{ predicate: "pattern_detected", pattern: "IGNORED_TECHNICAL_WARNINGS", subject: "tarek_001", value: true }],
  presentation: {
    title: "Tarek parla all'assemblea",
    body: "Con le sue parole asciutte, Tarek elenca ogni volta che i suoi avvertimenti sul riciclatore sono stati ignorati, e chi li ha ignorati."
  },
  choices: [
    {
      id: "back_tarek",
      label: "Mettiti al suo fianco e impegnati con le revisioni",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.08 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.06 },
        { type: "RESOURCE_DELTA", key: "energy", value: -4 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.06 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f4_tarek_backed",
          valence: "positive",
          salience: 0.7,
          exposure: "public",
          behaviorHook: "volunteer_help",
          callbackEligible: true,
          summary: "Chi guida Helios si è alzato al mio fianco e si è assunto gli avvertimenti ignorati.",
          tags: ["assembly", "recycler"]
        })
      ],
      disclosure: {
        knownNotes: ["Il programma di revisioni toglie energia di cui l'insediamento è a corto."],
        risks: ["political", "supply"],
        unknowns: ["Se assumersene la responsabilità basterà all'assemblea."]
      }
    },
    {
      id: "discredit_tarek",
      label: "Definisci esagerato il suo racconto",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 15 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.06 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.04 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f4_tarek_discredited",
          subjectId: "tarek_001",
          valence: "negative",
          salience: 0.7,
          exposure: "private",
          behaviorHook: "refuse_similar_request",
          callbackEligible: true,
          summary: "Hanno dato del bugiardo a Tarek davanti all'assemblea.",
          tags: ["assembly", "recycler"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Cosa ne penseranno gli amici di Tarek."]
      }
    }
  ]
};

const f4SelaTakesItPublic: ProofEvent = {
  id: "evt_f4_sela_takes_it_public",
  familyId: "public_accountability",
  taxonomy: "DILEMMA",
  // Sela carries a grievance she promised to raise: the hook a rationing, a
  // quarantine or a withheld account leaves on her. GQP-B recorded the hook;
  // this is where she acts on it.
  eligibility: [{ predicate: "memory_hook_present", characterId: "sela_001", hook: "raise_publicly", value: true }],
  relevance: [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "neglect", value: true }],
  presentation: {
    title: "Sela porta la questione in aula",
    body: "Sela mette a verbale in assemblea la protesta del distretto, con nomi e date, e aspetta che chi guida Helios risponda."
  },
  choices: [
    {
      id: "answer_on_the_floor",
      label: "Rispondile in aula",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.06 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.04 },
        { type: "CHARACTER_STRESS", targetId: "brann_001", value: 10 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_answered_on_floor",
          valence: "positive",
          salience: 0.6,
          exposure: "public",
          callbackEligible: true,
          summary: "Chi guida Helios si è alzato e ha risposto al distretto davanti a tutti.",
          tags: ["assembly"]
        })
      ],
      disclosure: {
        knownNotes: ["Una risposta messa a verbale è una risposta che l'assemblea ti ricorderà."],
        risks: ["political", "social"],
        unknowns: ["Se la risposta soddisferà il distretto."]
      }
    },
    {
      id: "close_the_session",
      label: "Chiudi la seduta",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.1 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.05 },
        { type: "PRESSURE_DELTA", value: 1 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_session_closed",
          valence: "negative",
          salience: 0.8,
          exposure: "public",
          callbackEligible: true,
          summary: "La seduta è stata chiusa prima che il distretto avesse una risposta.",
          tags: ["assembly"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Cosa farà il distretto fuori dall'aula."]
      }
    }
  ]
};

const f5CouncilCallsIn: ProofEvent = {
  id: "evt_f5_council_calls_in",
  familyId: "external_rescue",
  taxonomy: "COMPLICATION",
  // The price of Council help, collected: Brann holds the settlement's debt to
  // the Council, from its stores, its allocation or its field team.
  eligibility: [{ predicate: "memory_hook_present", characterId: "brann_001", hook: "call_in_debt", subjectId: "faction_compact", value: true }],
  relevance: [{ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_compact", value: true }],
  presentation: {
    title: "Il Consiglio manda il suo inviato",
    body: "L'inviato del Consiglio arriva con il registro dei debiti. Il suo aiuto va ripagato: in crediti, oppure con ispettori del Consiglio residenti al riciclatore."
  },
  choices: [
    {
      id: "repay_in_credits",
      label: "Ripagalo in crediti",
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -8 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.03 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_council_repaid",
          subjectId: "faction_compact",
          valence: "ambivalent",
          salience: 0.5,
          exposure: "private",
          callbackEligible: true,
          summary: "Abbiamo ripagato il Consiglio, e l'abbiamo pagata cara.",
          tags: ["council", "debt"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["A cosa sarebbero serviti quei crediti."] }
    },
    {
      id: "admit_the_inspectors",
      label: "Ammetti gli ispettori del Consiglio al riciclatore",
      effects: [
        { type: "FLAG_SET", key: "council_inspectors_resident", value: true },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.05 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.06 },
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 10 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f5_inspectors_resident",
          subjectId: "faction_compact",
          valence: "negative",
          salience: 0.6,
          exposure: "public",
          callbackEligible: true,
          summary: "Ora sono gli ispettori del Consiglio a firmare per il mio riciclatore.",
          tags: ["council", "recycler"]
        })
      ],
      disclosure: { risks: ["political", "social"], unknowns: ["Cos'altro guarderanno gli ispettori."] }
    },
    {
      id: "refuse_the_envoy",
      label: "Rimanda indietro l'inviato",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.08 },
        { type: "PRESSURE_DELTA", value: 2 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_envoy_refused",
          subjectId: "faction_compact",
          valence: "negative",
          salience: 0.7,
          exposure: "public",
          callbackEligible: true,
          summary: "Ho rimandato a casa l'inviato del Consiglio a mani vuote.",
          tags: ["council", "debt"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["Come risponderà il Consiglio a un rifiuto."] }
    }
  ]
};

const f2TarekUpgrade: ProofEvent = {
  id: "evt_f2_tarek_upgrade",
  familyId: "maintenance",
  taxonomy: "OPPORTUNITY_REQUEST",
  // Tarek offers more because he was listened to: the volunteer_help hook a
  // proper overhaul, a heeded warning or public backing leaves on him (GQP-B
  // recorded it; this is where he acts on it). A settlement that treats its
  // technician well gets a technician who brings it the next thing.
  eligibility: [{ predicate: "memory_hook_present", characterId: "tarek_001", hook: "volunteer_help", value: true }],
  presentation: {
    title: "Tarek vuole andare oltre",
    body: "Ora che le guarnizioni reggono, Tarek propone di ricostruire il collettore di aspirazione perché il riciclatore consumi meno energia — se può avere le leghe e un giorno di fermo."
  },
  choices: [
    {
      id: "fund_the_upgrade",
      label: "Dagli le leghe e il giorno di fermo",
      effects: [
        { type: "RESOURCE_DELTA", key: "energy", value: -6 },
        { type: "RESOURCE_DELTA", key: "alloys", value: -2 },
        { type: "NODE_CONDITION_SHIFT", nodeId: RECYCLER, delta: 0.05 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_upgrade_funded",
          valence: "positive",
          salience: 0.6,
          exposure: "private",
          callbackEligible: true,
          summary: "Per una volta mi hanno lasciato costruirlo come si deve.",
          tags: ["recycler", "upgrade"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Se il collettore vale un giorno senz'acqua."] }
    },
    {
      id: "not_now",
      label: "Non ora; l'insediamento ha bisogno dell'energia",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 5 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_upgrade_shelved",
          valence: "ambivalent",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "Il collettore può aspettare, hanno detto.",
          tags: ["recycler", "upgrade"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Se si offrirà di nuovo."] }
    }
  ]
};

const f1DistrictVolunteers: ProofEvent = {
  id: "evt_f1_district_volunteers",
  familyId: "scarcity_triage",
  taxonomy: "OPPORTUNITY_REQUEST",
  // The district helps a steward who helped it: Sela's volunteer_help hook,
  // left by a drive the district joined, remedies it pooled, accounts it was
  // shown or restitution it was paid.
  eligibility: [{ predicate: "memory_hook_present", characterId: "sela_001", hook: "volunteer_help", value: true }],
  relevance: [{ predicate: "pattern_detected", pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: "protection", value: true }],
  presentation: {
    title: "Il distretto offre le sue braccia",
    body: "Sela porta una lista di nomi: persone disposte a gestire le file per l'acqua e il turno di notte dell'ambulatorio, se chi guida Helios le mette nei turni e paga loro un compenso."
  },
  choices: [
    {
      id: "put_them_on_the_rota",
      label: "Mettili nei turni",
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -3 },
        { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: -0.03 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.04 },
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_night_shift_staffed",
          valence: "positive",
          salience: 0.4,
          exposure: "private",
          callbackEligible: true,
          summary: "Il distretto ha coperto il mio turno di notte.",
          tags: ["clinic", "district"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Per quanto continueranno a venire i volontari."] }
    },
    {
      id: "thank_and_decline",
      label: "Ringraziali e lascia i turni come sono",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 5 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f1_volunteers_declined",
          valence: "ambivalent",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "Il distretto si è offerto; i turni sono rimasti come erano.",
          tags: ["district"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Se il distretto si offrirà di nuovo."] }
    }
  ]
};

const f5LeagueCallsIn: ProofEvent = {
  id: "evt_f5_league_calls_in",
  familyId: "external_rescue",
  taxonomy: "COMPLICATION",
  // The League collects once Helios owes it twice (FACTION_DEPENDENCY_GROWING).
  // One debt is a favour; two are leverage. What it asks for depends on
  // whether it already has a way in.
  eligibility: [leagueDependency],
  relevance: [leagueWantsAccess],
  presentation: {
    title: "La Lega presenta il suo registro dei debiti",
    body: "Arriva un agente della Lega con l'elenco di ogni favore che Helios ha ricevuto, voce per voce. La Lega vuole un accesso stabile — oppure un pagamento, altrimenti smette di mandare qualsiasi cosa."
  },
  choices: [
    {
      id: "grant_standing_access",
      label: "Concedi alla Lega un accesso stabile",
      availability: [leagueWantsAccess],
      effects: [
        { type: "FLAG_SET", key: "front_access_granted", value: true },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.1 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_league_access_granted",
          subjectId: "faction_front",
          valence: "negative",
          salience: 0.7,
          exposure: "public",
          callbackEligible: true,
          summary: "Ora la Lega ha un diritto di passaggio permanente dentro Helios.",
          tags: ["league", "access"]
        })
      ],
      disclosure: {
        knownNotes: ["La linea rossa del comitato di sicurezza è il controllo del ripetitore da parte della Lega."],
        risks: ["political", "social"],
        unknowns: ["Cosa farà la Lega con un punto d'appoggio."]
      }
    },
    {
      id: "pay_the_league_off",
      label: "Salda il registro dei debiti",
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -8 },
        { type: "RESOURCE_DELTA", key: "energy", value: -4 },
        // The Security Council sees the League paid and kept out.
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.03 },
        memory({
          characterId: "brann_001",
          memoryId: "fact_f5_league_paid",
          subjectId: "faction_front",
          valence: "ambivalent",
          salience: 0.5,
          exposure: "private",
          callbackEligible: true,
          summary: "Abbiamo saldato per intero il registro della Lega, e ci è costato.",
          tags: ["league", "debt"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["A cosa sarebbero serviti quei crediti."] }
    },
    {
      id: "refuse_the_ledger",
      label: "Rifiuta il registro dei debiti",
      effects: [
        { type: "PRESSURE_DELTA", value: 2 },
        memory({
          characterId: "mara_001",
          memoryId: "fact_f5_ledger_refused",
          subjectId: "faction_front",
          valence: "negative",
          salience: 0.7,
          exposure: "private",
          callbackEligible: true,
          summary: "Abbiamo preso l'aiuto della Lega e rifiutato il suo conto. I miei contatti se ne ricorderanno.",
          tags: ["league", "debt"]
        })
      ],
      schedules: [
        {
          key: "cut_off",
          delay: 2,
          visibility: "hidden",
          scope: "settlement",
          effects: [{ type: "RESOURCE_DELTA", key: "energy", value: -6 }],
          breadcrumb: { memoryId: "fact_f5_ledger_refused" }
        }
      ],
      disclosure: { risks: ["political", "supply"], unknowns: ["Cosa smetterà di mandare la Lega."] }
    }
  ]
};

const f4WhoseSettlement: ProofEvent = {
  id: "evt_f4_whose_settlement",
  familyId: "public_accountability",
  taxonomy: "DILEMMA",
  // Accountability for dependence: Helios owes one faction twice, whichever it
  // is, and the assembly wants to know whose settlement this still is.
  eligibility: [{ predicate: "pattern_detected", pattern: "FACTION_DEPENDENCY_GROWING", value: true }],
  presentation: {
    title: "Di chi è questo insediamento?",
    body: "L'assemblea ha contato i favori. Sela pone la domanda senza giri di parole: Helios decide ancora da sola, o risponde a chiunque le abbia riempito le cisterne per ultimo?"
  },
  choices: [
    {
      id: "pledge_self_reliance",
      label: "Impegnati a far vivere Helios delle sue scorte",
      effects: [
        { type: "RESOURCE_DELTA", key: "credits", value: -4 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: 0.06 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.04 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_self_reliance_pledged",
          valence: "positive",
          salience: 0.6,
          exposure: "public",
          callbackEligible: true,
          summary: "Chi guida Helios ha promesso all'assemblea che Helios si sarebbe retta da sola.",
          tags: ["assembly", "dependency"]
        })
      ],
      disclosure: {
        knownNotes: ["Un impegno preso a verbale è un impegno che l'assemblea ti chiederà di mantenere."],
        risks: ["political", "supply"],
        unknowns: ["Se Helios riuscirà a mantenerlo."]
      }
    },
    {
      id: "defend_the_arrangements",
      label: "Difendi gli accordi come ciò che ha tenuto in vita Helios",
      effects: [
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_labor", delta: -0.06 },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: 0.04 },
        // Sela asked the question in front of the assembly and was told no.
        { type: "CHARACTER_STRESS", targetId: "sela_001", value: 8 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f4_arrangements_defended",
          valence: "negative",
          salience: 0.7,
          exposure: "public",
          callbackEligible: true,
          summary: "Chi guida Helios ha detto all'assemblea che i favori erano il prezzo della sopravvivenza.",
          tags: ["assembly", "dependency"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Se l'assemblea accetterà il prezzo."]
      }
    }
  ]
};

/**
 * The proof catalogue: F1-F3 (GQP-B) and F4-F5 (GQP-C). Order carries no
 * meaning: eligibility is sorted by id, selection breaks ties by id, and tests
 * reorder this array to prove it.
 */
export const GQP_PROOF_EVENTS: readonly ProofEvent[] = [
  f2RecyclerWarning,
  f2TarekSecondWarning,
  f2RecyclerBreakdown,
  f3ConduitOffer,
  f3DebtCalled,
  f1ClinicRequest,
  f1IraPreventionDrive,
  f1Outbreak,
  f2TarekUpgrade,
  f1DistrictVolunteers,
  f4OpenTheBooks,
  f4DistrictDemandsAnswers,
  f4ConduitExposed,
  f4TarekGoesPublic,
  f4SelaTakesItPublic,
  f4WhoseSettlement,
  f5WaterConvoy,
  f5MedicalRelief,
  f5CouncilCallsIn,
  f5LeagueCallsIn
];
