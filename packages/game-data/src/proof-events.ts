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
    title: "The recycler is running hot",
    body: "Tarek Oss reports scoring on the recycler's pump seals. A full overhaul takes power the settlement needs today; a patch keeps it running for now."
  },
  choices: [
    {
      id: "full_maintenance",
      label: "Take it offline for a full overhaul",
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
          summary: "The steward gave the recycler the overhaul it needed.",
          tags: ["recycler", "maintenance"]
        })
      ],
      disclosure: {
        risks: ["supply"],
        unknowns: ["How long the rebuilt seals hold under extra load."]
      }
    },
    {
      id: "patch_and_defer",
      label: "Patch the seals and keep it running",
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
          summary: "My warning about the seals was patched over.",
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
        knownNotes: ["The patch is not a repair."],
        risks: ["infrastructure", "social"],
        unknowns: ["When the patched seals give way."]
      }
    },
    {
      id: "divert_clinic_power",
      label: "Borrow the clinic's power for the overhaul",
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
          summary: "The clinic went dark so the recycler could be serviced.",
          tags: ["clinic", "power"]
        })
      ],
      disclosure: {
        risks: ["epidemic", "social"],
        unknowns: ["How many patients the dark days cost."]
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
    title: "Tarek will not let it go",
    body: "Tarek comes back unasked. The patch is weeping again, he says, and it will not last another shift cycle."
  },
  choices: [
    {
      id: "authorize_inspection",
      label: "Authorize an inspection now",
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
          summary: "The second time, the steward listened.",
          tags: ["recycler", "warning"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Whether the inspection is in time."] }
    },
    {
      id: "let_it_ride",
      label: "Tell him to keep it running",
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
          summary: "I was told twice to keep a failing pump running.",
          tags: ["recycler", "warning"]
        })
      ],
      disclosure: { risks: ["infrastructure", "social"], unknowns: ["What Tarek will do next time."] }
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
    title: "The recycler fails",
    body: "The seals go. Water output collapses to a trickle, and every route back costs something the settlement was saving."
  },
  choices: [
    {
      // Recovery by consuming strategic stock.
      id: "emergency_rebuild",
      label: "Rebuild it from the alloy reserve",
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
          summary: "The alloy reserve went into the recycler.",
          tags: ["recycler", "reserve"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["What the alloy reserve was going to be needed for."] }
    },
    {
      // Tarek helps -- unless he has already been overruled twice.
      id: "tarek_quick_fix",
      label: "Ask Tarek for a fast repair",
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
          summary: "I got it running again, but not properly.",
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
      disclosure: { risks: ["infrastructure", "social"], unknowns: ["How long a fast repair lasts."] }
    },
    {
      // Channel 2 at work: Mara knows because Tarek told her.
      id: "mara_salvaged_parts",
      label: "Use the parts Mara set aside",
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
          summary: "I had the parts ready because Tarek saw it coming.",
          tags: ["recycler", "supply"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Where Mara found the parts."] }
    },
    {
      // Recovery by accepting technical dependency on a faction.
      id: "front_technicians",
      label: "Let the League's technicians fix it",
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
          summary: "League technicians now hold the recycler's service contract.",
          tags: ["recycler", "league"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["What the League will ask for next."] }
    },
    {
      id: "accept_degradation",
      label: "Run it degraded and ration water",
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
          summary: "The recycler was left broken on purpose.",
          tags: ["recycler"]
        })
      ],
      disclosure: {
        risks: ["infrastructure", "epidemic", "social"],
        unknowns: ["How long the settlement can live on a trickle."]
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
    title: "A line from the League",
    body: "Mara Senn can splice a Free Conduit League power line into the recycler bus tonight. Nobody on the Council needs to know -- unless you tell them."
  },
  choices: [
    {
      id: "tap_quietly",
      label: "Splice it in quietly",
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
          summary: "We owe the League for a line nobody declared.",
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
        unknowns: ["What the League will want in return.", "Whether anyone notices the draw."]
      }
    },
    {
      id: "register_the_line",
      label: "Register the line with the Council",
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
          summary: "The League line is on the Council's books.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: {
        risks: ["political"],
        unknowns: ["How the Council reads a League line on its grid."]
      }
    },
    {
      id: "decline",
      label: "Refuse the League's line",
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
          summary: "I burned a League contact for nothing.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: {
        risks: ["supply", "social"],
        unknowns: ["Whether the League asks again."]
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
    title: "The League calls in the line",
    body: "Mara brings a message: the League wants standing access to Helios in return for the power it has been sending. Quietly, or it stops."
  },
  choices: [
    {
      id: "grant_access_quietly",
      label: "Grant the access, say nothing",
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
          summary: "I gave the League access the Council never approved.",
          tags: ["conduit", "league", "secret"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["Who else learns of the deal."] }
    },
    {
      // Channel 3 made explicit: the secret is published, not discovered.
      id: "disclose_and_register",
      label: "Disclose the line and register it",
      effects: [
        { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_f3_secret_tap" },
        { type: "FLAG_SET", key: "conduit_registered", value: true },
        { type: "FLAG_SET", key: "unregistered_conduit_active", value: false },
        { type: "PRESSURE_DELTA", value: 2 },
        { type: "CHARACTER_STRESS", targetId: "brann_001", value: 10 }
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["How the community takes being told late."]
      }
    },
    {
      id: "cut_the_line",
      label: "Cut the line and pay the League off",
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
          summary: "I was made to cut the line I spliced.",
          tags: ["conduit", "league"]
        })
      ],
      disclosure: { risks: ["supply", "social"], unknowns: ["Whether Mara deals with the League again."] }
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
    title: "The clinic asks for the reserve",
    body: "Ira Venn needs water and medicine from the strategic reserve to keep the crowded ward from turning into an outbreak."
  },
  choices: [
    {
      id: "treat_now",
      label: "Open the reserve to the clinic",
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
          summary: "When the ward needed it, the reserve was opened.",
          tags: ["clinic", "triage"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Whether the reserve lasts the season."] }
    },
    {
      id: "protect_reserve",
      label: "Keep the reserve sealed",
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
          summary: "The clinic was turned away from the reserve, in front of everyone.",
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
        unknowns: ["How fast untreated cases spread."]
      }
    },
    {
      id: "ration_district",
      label: "Ration the lower district instead",
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
          summary: "The lower district carried the shortage for everyone else.",
          tags: ["rationing", "district"]
        })
      ],
      disclosure: {
        risks: ["epidemic", "political"],
        unknowns: ["Whether the district accepts it."]
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
    title: "Ira has a plan",
    body: "Ira offers to lead volunteers through the district to repair household cisterns before the dry weeks, if the clinic can spare her."
  },
  choices: [
    {
      id: "back_the_drive",
      label: "Back the cistern drive",
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
          summary: "The district fixed its own cisterns with the clinic.",
          tags: ["district", "water"]
        })
      ],
      disclosure: { risks: ["supply", "social"], unknowns: ["Whether the clinic copes without Ira."] }
    },
    {
      id: "keep_ira_at_the_clinic",
      label: "Keep Ira at the clinic",
      effects: [
        memory({
          characterId: "ira_001",
          memoryId: "fact_f1_drive_declined",
          valence: "negative",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "My cistern plan was set aside.",
          tags: ["clinic", "water"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Whether the dry weeks come early."] }
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
    title: "Outbreak",
    body: "The fever is in three districts. Ira needs a decision before the day is out."
  },
  choices: [
    {
      // Recovery by spending medicine and productive capacity.
      id: "full_treatment_campaign",
      label: "Run a full treatment campaign",
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
          summary: "We beat it back, and emptied the shelves doing it.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Whether it comes back."] }
    },
    {
      // Ira stretches the clinic for a steward -- unless she remembers being
      // turned away by the same steward in front of everyone.
      id: "clinic_stretches_supplies",
      label: "Let Ira stretch what the clinic has",
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
          summary: "I held the outbreak with half of what it needed.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["social"], unknowns: ["How long Ira can keep this up."] }
    },
    {
      // Recovery by isolating a district and paying in consent. Closed once
      // the community has publicly seen the clinic turned away.
      id: "quarantine_district",
      label: "Quarantine the district",
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
          summary: "They sealed the district and called it care.",
          tags: ["district", "outbreak"]
        })
      ],
      disclosure: { risks: ["political", "social"], unknowns: ["Whether the district holds the line."] }
    },
    {
      // Recovery by external supply, at a political price. The Council opens
      // its stores to a settlement it considers reliable -- an agenda item.
      id: "council_medical_stores",
      label: "Ask the Council for its medical stores",
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
          summary: "The Council's stores came with the Council's memory.",
          tags: ["outbreak", "council"]
        })
      ],
      disclosure: {
        knownNotes: ["The stores are sold at the Council's price, under the Council's eye."],
        risks: ["political"],
        unknowns: ["What the Council will ask for in return."]
      }
    },
    {
      id: "ride_it_out",
      label: "Hold what you have and ride it out",
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
          summary: "We were told to endure it.",
          tags: ["clinic", "outbreak"]
        })
      ],
      disclosure: { risks: ["epidemic", "social"], unknowns: ["How many it costs."] }
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
    title: "The cisterns are nearly dry",
    body: "Both factions have noticed. League haulers can be at the gate by nightfall; the Council will send an allocation, at the Council's price. Or Helios rations what it has."
  },
  choices: [
    {
      // Once Helios owes the League twice, the League stops sending water as a
      // favour: the option closes, and its ledger (league_calls_in) opens.
      id: "league_convoy",
      label: "Take the League's water",
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
          summary: "The League's water came with the League's ledger.",
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
        knownNotes: ["The Council will count this against Helios."],
        risks: ["political", "supply"],
        unknowns: ["What the League asks for the next time."]
      }
    },
    {
      // The Council helps a settlement that keeps its plant running, and only
      // while Helios is not already living on its allocations.
      id: "council_allocation",
      label: "Ask the Council for an allocation",
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
          summary: "The Council's water arrived with the Council's inspectors.",
          tags: ["water", "council", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["The League will read this as Helios choosing a side."],
        risks: ["political", "supply"],
        unknowns: ["What the Council expects for its allocation."]
      }
    },
    {
      id: "ration_the_cisterns",
      label: "Ration the cisterns and ask no one",
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
          summary: "The district queued at dry taps so Helios would owe nobody.",
          tags: ["water", "rationing"]
        })
      ],
      disclosure: {
        knownNotes: ["Rationing saves only what the district goes without."],
        risks: ["epidemic", "political", "social"],
        unknowns: ["How long the district accepts the queues."]
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
    title: "The clinic's shelves are bare",
    body: "Ira has rationed the last of the fever tonic. The League has medics on the relay; the Council keeps a field team for settlements it trusts."
  },
  choices: [
    {
      id: "league_medics",
      label: "Bring in the League's medics",
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
          summary: "League medics held my ward. They will want that remembered.",
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
        knownNotes: ["The Council will count this against Helios."],
        risks: ["political", "supply"],
        unknowns: ["What the League asks for the next time."]
      }
    },
    {
      id: "league_medics_on_terms",
      label: "Bring in the League's medics, on the League's terms",
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
          summary: "The League's medics came with a League clinic charter.",
          tags: ["clinic", "league", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["Helios already owes the League. This time the price is standing access."],
        risks: ["political", "social"],
        unknowns: ["Whose clinic this is, a season from now."]
      }
    },
    {
      id: "council_field_team",
      label: "Request the Council's field team",
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
          summary: "The Council's field team wrote everything down.",
          tags: ["clinic", "council", "debt"]
        })
      ],
      disclosure: {
        knownNotes: ["The League will read this as Helios choosing a side."],
        risks: ["political", "supply"],
        unknowns: ["What the Council expects for its team."]
      }
    },
    {
      id: "pool_household_remedies",
      label: "Pool the district's household remedies",
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
          summary: "The district emptied its own cupboards for the ward.",
          tags: ["clinic", "district"]
        })
      ],
      disclosure: {
        knownNotes: ["Household remedies are traded for food the district needs."],
        risks: ["epidemic", "supply", "social"],
        unknowns: ["Whether the remedies are enough."]
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
    title: "Sela asks for the real accounts",
    body: "While the district still trusts you, Sela wants the reserve's true level before the assembly: what it held, what it cost, what is coming."
  },
  choices: [
    {
      id: "publish_the_accounts",
      label: "Put the real accounts before the assembly",
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
          summary: "The steward read the reserve's real numbers aloud.",
          tags: ["assembly", "accounts"]
        })
      ],
      disclosure: {
        knownNotes: ["The Security Council dislikes a shortfall read aloud."],
        risks: ["political"],
        unknowns: ["What the assembly does with the numbers."]
      }
    },
    {
      id: "keep_the_margin",
      label: "Give the assembly a summary and keep your margin",
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
          summary: "I asked for the numbers and got a summary.",
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
        unknowns: ["Whether Sela lets it go."]
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
    title: "The district wants an answer",
    body: "The lower district has paid for the settlement's choices twice. Sela brings its question to the assembly floor: why them, and what now."
  },
  choices: [
    {
      id: "make_restitution",
      label: "Admit it and make restitution",
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
          summary: "The steward owned the district's losses and paid some of them back.",
          tags: ["assembly", "district"]
        })
      ],
      disclosure: {
        risks: ["supply"],
        unknowns: ["Whether restitution is enough."]
      }
    },
    {
      id: "defend_the_triage",
      label: "Defend the triage as necessary",
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
          summary: "The steward told the district its losses were the price of order.",
          tags: ["assembly", "district"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["What the district does with its anger."]
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
    title: "Tarek found the line",
    body: "Tarek traced the unexplained load on the recycler bus to a League line nobody registered. He brings it to you before the Council's inspectors do."
  },
  choices: [
    {
      id: "own_it_publicly",
      label: "Own the line before the assembly and register it",
      effects: [
        { type: "MEMORY_PUBLISH", characterId: "mara_001", memoryId: "fact_f3_secret_tap" },
        { type: "FLAG_SET", key: "conduit_registered", value: true },
        { type: "POLITICAL_STANDING_SHIFT", groupId: "group_security", delta: -0.1 },
        { type: "PRESSURE_DELTA", value: 1 },
        { type: "CHARACTER_STRESS", targetId: "brann_001", value: 10 }
      ],
      disclosure: {
        knownNotes: ["Everyone will know Helios ran on an undeclared League line."],
        risks: ["political", "social"],
        unknowns: ["Whether the Council accepts a late registration."]
      }
    },
    {
      id: "bury_it",
      label: "Tell Tarek to forget what he found",
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
          summary: "I found a line nobody declared, and was told to forget it.",
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
        unknowns: ["Who else Tarek tells."]
      }
    },
    {
      id: "blame_the_quartermaster",
      label: "Name Mara as the one who spliced it",
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
          summary: "I spliced that line for Helios, and Helios hung it on me.",
          tags: ["conduit", "blame"]
        })
      ],
      disclosure: {
        knownNotes: ["The line comes out, and so does who spliced it."],
        risks: ["political", "social", "supply"],
        unknowns: ["What Mara does next."]
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
    title: "Tarek tells the assembly",
    body: "In his own flat words, Tarek lists every time the recycler warnings were overruled, and who overruled them."
  },
  choices: [
    {
      id: "back_tarek",
      label: "Stand beside him and commit to the overhauls",
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
          summary: "The steward stood up beside me and owned the warnings.",
          tags: ["assembly", "recycler"]
        })
      ],
      disclosure: {
        knownNotes: ["The overhaul schedule takes power the settlement is short of."],
        risks: ["political", "supply"],
        unknowns: ["Whether owning it is enough for the assembly."]
      }
    },
    {
      id: "discredit_tarek",
      label: "Call his account exaggerated",
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
          summary: "They called Tarek a liar in front of the assembly.",
          tags: ["assembly", "recycler"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["What Tarek's friends make of it."]
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
    title: "Sela takes it to the floor",
    body: "Sela reads the district's grievance into the assembly record, with names and dates, and waits for the steward to answer."
  },
  choices: [
    {
      id: "answer_on_the_floor",
      label: "Answer her on the floor",
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
          summary: "The steward stood and answered the district in front of everyone.",
          tags: ["assembly"]
        })
      ],
      disclosure: {
        knownNotes: ["An answer on the record is an answer the assembly will quote back."],
        risks: ["political", "social"],
        unknowns: ["Whether the answer satisfies the district."]
      }
    },
    {
      id: "close_the_session",
      label: "Close the session",
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
          summary: "The session was closed before the district was answered.",
          tags: ["assembly"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["What the district does outside the chamber."]
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
    title: "The Council sends its envoy",
    body: "The Council's envoy arrives with the ledger. Its help is to be repaid: in credits, or with Council inspectors resident on the recycler."
  },
  choices: [
    {
      id: "repay_in_credits",
      label: "Repay it in credits",
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
          summary: "We paid the Council back, and paid dearly.",
          tags: ["council", "debt"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["What the credits were going to be needed for."] }
    },
    {
      id: "admit_the_inspectors",
      label: "Admit Council inspectors to the recycler",
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
          summary: "Council inspectors now sign off on my recycler.",
          tags: ["council", "recycler"]
        })
      ],
      disclosure: { risks: ["political", "social"], unknowns: ["What else the inspectors look at."] }
    },
    {
      id: "refuse_the_envoy",
      label: "Send the envoy away",
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
          summary: "I sent the Council's envoy home with nothing.",
          tags: ["council", "debt"]
        })
      ],
      disclosure: { risks: ["political"], unknowns: ["How the Council answers a refusal."] }
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
    title: "Tarek wants to go further",
    body: "With the seals holding, Tarek proposes rebuilding the intake manifold so the recycler draws less power -- if he can have the alloys and a day of downtime."
  },
  choices: [
    {
      id: "fund_the_upgrade",
      label: "Give him the alloys and the downtime",
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
          summary: "They let me build it properly, for once.",
          tags: ["recycler", "upgrade"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["Whether the manifold is worth a day without water."] }
    },
    {
      id: "not_now",
      label: "Not now; the settlement needs the power",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "tarek_001", value: 5 },
        memory({
          characterId: "tarek_001",
          memoryId: "fact_f2_upgrade_shelved",
          valence: "ambivalent",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "The manifold can wait, they said.",
          tags: ["recycler", "upgrade"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Whether he offers again."] }
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
    title: "The district offers its hands",
    body: "Sela brings a list of names: people willing to run the water queues and the clinic's night shift, if the steward will put them on the rota and pay them a stipend."
  },
  choices: [
    {
      id: "put_them_on_the_rota",
      label: "Put them on the rota",
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
          summary: "The district covered my night shift.",
          tags: ["clinic", "district"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["How long the volunteers keep coming."] }
    },
    {
      id: "thank_and_decline",
      label: "Thank them and keep the rota as it is",
      effects: [
        { type: "CHARACTER_STRESS", targetId: "ira_001", value: 5 },
        memory({
          characterId: "sela_001",
          memoryId: "fact_f1_volunteers_declined",
          valence: "ambivalent",
          salience: 0.4,
          exposure: "private",
          callbackEligible: false,
          summary: "The district offered; the rota stayed as it was.",
          tags: ["district"]
        })
      ],
      disclosure: { risks: [], unknowns: ["Whether the district offers again."] }
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
    title: "The League presents its ledger",
    body: "A League factor arrives with every favour Helios has taken, itemised. The League wants standing access -- or payment, or it stops sending anything at all."
  },
  choices: [
    {
      id: "grant_standing_access",
      label: "Grant the League standing access",
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
          summary: "The League has a standing right of way into Helios now.",
          tags: ["league", "access"]
        })
      ],
      disclosure: {
        knownNotes: ["The Security Council's red line is League control of the relay."],
        risks: ["political", "social"],
        unknowns: ["What the League does with a foothold."]
      }
    },
    {
      id: "pay_the_league_off",
      label: "Pay the ledger off",
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
          summary: "We paid the League's ledger in full, and it cost us.",
          tags: ["league", "debt"]
        })
      ],
      disclosure: { risks: ["supply"], unknowns: ["What the credits were going to be needed for."] }
    },
    {
      id: "refuse_the_ledger",
      label: "Refuse the ledger",
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
          summary: "We took the League's help and refused its bill. My contacts will remember.",
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
      disclosure: { risks: ["political", "supply"], unknowns: ["What the League stops sending."] }
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
    title: "Whose settlement is this?",
    body: "The assembly has counted the favours. Sela puts the question plainly: does Helios still decide for itself, or does it answer to whoever last filled its cisterns?"
  },
  choices: [
    {
      id: "pledge_self_reliance",
      label: "Pledge to stand on Helios's own stores",
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
          summary: "The steward promised the assembly Helios would stand on its own.",
          tags: ["assembly", "dependency"]
        })
      ],
      disclosure: {
        knownNotes: ["A pledge made on the record is one the assembly will hold you to."],
        risks: ["political", "supply"],
        unknowns: ["Whether Helios can keep it."]
      }
    },
    {
      id: "defend_the_arrangements",
      label: "Defend the arrangements as what kept Helios alive",
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
          summary: "The steward told the assembly the favours were the price of survival.",
          tags: ["assembly", "dependency"]
        })
      ],
      disclosure: {
        risks: ["political", "social"],
        unknowns: ["Whether the assembly accepts the price."]
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
