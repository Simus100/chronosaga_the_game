import type { EventEffect, ProofEvent } from "@paa/game-types";

/**
 * GQP-B proof event network: F1 SCARCITY / TRIAGE, F2 MAINTENANCE,
 * F3 UNREGISTERED CONDUIT (GQP spec 11, slice 25).
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
  taxonomy: "SIGNAL",
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
        { type: "MEMORY_PUBLISH", memoryId: "fact_f3_secret_tap" },
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

/**
 * The GQP-B proof catalogue. Order carries no meaning: eligibility is sorted by
 * id, and a test reorders this array to prove it.
 */
export const GQP_PROOF_EVENTS: readonly ProofEvent[] = [
  f2RecyclerWarning,
  f2TarekSecondWarning,
  f2RecyclerBreakdown,
  f3ConduitOffer,
  f3DebtCalled,
  f1ClinicRequest,
  f1IraPreventionDrive,
  f1Outbreak
];
