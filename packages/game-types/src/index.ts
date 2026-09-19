export type ResourceMap = Record<string, number>;

export interface CausalSource {
  kind: "choice" | "event" | "world_tick" | "tactical" | "warfare" | "system";
  id: string;
  actorId?: string;
  tick?: number;
  rule?: string;
}

export interface CharacterMemory {
  id: string;
  summary: string;
  tags: string[];
  turn: number;
  source: CausalSource;
  /**
   * Salient-memory semantics introduced by the GQP proof (spec 5.3).
   *
   * Optional on the type because the M1 World Tick authors memories without
   * them and the accepted baseline is not being rewritten. The persistence
   * boundary is where the rule is enforced: under schema v1 these fields must
   * be **absent**, under v2 they are fully validated when present. That is the
   * asymmetry spec 24.1 is protecting -- an optional field on v1 would survive
   * a round trip outside the hostile-input guarantee, because the v1 validator
   * does not reject what it does not know.
   *
   * What each one governs is in the field docs; nothing here is descriptive.
   * Descriptive detail stays in `tags` and `summary`, which no rule reads.
   */
  /** Whether recalling this argues for, against, or cuts both ways. */
  valence?: MemoryValence;
  /** Which few memories are consulted, and the input to consolidation. */
  salience?: number;
  /** Who or what the memory is about; routes callbacks and reflection. */
  subjectId?: string;
  /** Which of the three propagation channels of spec 7.1 produced it. */
  origin?: MemoryOrigin;
  /** The typed rule this memory activates later. A rule id, not a sentence. */
  behaviorHook?: MemoryBehaviorHook;
  /** Whether this may be surfaced as a causal callback. */
  callbackEligible?: boolean;
  /**
   * How widely the fact is known. Schema v2 only, like the fields above; see
   * `MemoryExposure`. Required on every memory a proof effect writes.
   */
  exposure?: MemoryExposure;
}

export interface CharacterState {
  id: string;
  name: string;
  /**
   * Shown to the player, and shown only.
   *
   * No rule reads this. Which job a character holds is derived from their id
   * by `game-core`'s cast table rather than stored here, so that translating a
   * label cannot change the simulation and so that no build can read a
   * different world out of the same save than another build would.
   */
  role: string;
  health: number;
  stress: number;
  morale: number;
  traits: string[];
  memoryTags: string[];
  factionId?: string;
  locationId?: string;
  memories?: CharacterMemory[];
  /**
   * The two new authoritative character fields the proof introduces (spec
   * 5.2, which closes that list at core value, current goal, relationships
   * and the strictly necessary memory additions).
   *
   * Optional on the type, required by the validator under schema v2 and
   * refused under v1 -- same boundary rule as the memory extensions above.
   *
   * There is deliberately no third field naming the functional role of spec
   * 6.2. The role is already expressed by these two, and 5.2 does not permit
   * a field that only restates them.
   */
  coreValue?: CharacterCoreValue;
  currentGoal?: CharacterGoal;
}

export interface CampaignProfile {
  difficulty: "narrative" | "standard" | "hard" | "simulation";
  mortality: "protected" | "standard" | "permadeath";
  campaignLength: "standard" | "extended" | "persistent";
  aiMode: "local" | "cloud" | "auto" | "procedural";
  simulationDepth: "light" | "standard" | "deep";
}

export interface SettlementState {
  id: string;
  name: string;
  controllingFactionId: string;
  population: number;
  stability: number;
  satisfaction: number;
  resourceStock: ResourceMap;
  productionNodeIds: string[];
  cohortIds: string[];
  politicalGroupIds: string[];
}

export interface FactionState {
  id: string;
  name: string;
  influence: number;
  reputation: number;
  resources: ResourceMap;
  relations: Record<string, number>;
  memoryTags: string[];
}

export interface ProductionNodeState {
  id: string;
  settlementId: string;
  recipe: string;
  capacity: number;
  efficiency: number;
  labor: number;
  inputs: ResourceMap;
  outputs: ResourceMap;
  condition: number;
  enabled: boolean;
}

export interface PopulationCohortState {
  id: string;
  settlementId: string;
  population: number;
  occupation: string;
  wealth: string;
  culture: string;
  satisfaction: number;
  loyalty: number;
  politicalAffinity: string;
  needs: Record<string, number>;
}

export interface PoliticalGroupState {
  id: string;
  settlementId: string;
  name: string;
  influence: number;
  approval: number;
  resources: number;
  goals: string[];
  redLines: string[];
  leaderId?: string;
  relationships: Record<string, number>;
}

export interface WarfareSquadState {
  id: string;
  factionId: string;
  name: string;
  personnel: number;
  morale: number;
  readiness: number;
  supply: number;
  intelligence: number;
  commanderId?: string;
}

/**
 * The four effects M1 shipped with, each in the exact shape it always had.
 *
 * These used to share one loose interface, `{ type, key?, value, targetId? }`,
 * which made shapes like a `PRESSURE_DELTA` carrying a `key` representable and
 * meaningless. That looseness was tolerable while every effect was a number on a
 * key. GQP-B adds effects whose payload is a structure — a salient memory has a
 * character, a subject, a valence, a hook — and fitting that into `value` would
 * have meant letting `value` hold an object for every legacy effect too.
 *
 * So the loose interface is split into its members. The JSON on disk is the
 * same: every delayed consequence ever saved is still exactly one of these.
 */
export type LegacyEventEffect =
  | { type: "RESOURCE_DELTA"; key: string; value: number }
  | { type: "FLAG_SET"; key: string; value: string | number | boolean }
  | { type: "PRESSURE_DELTA"; value: number }
  | { type: "CHARACTER_STRESS"; targetId: string; value: number };

/**
 * Epidemic causes an author may move. `water_shortage` is absent on purpose.
 *
 * The World Tick derives that contributor from the settlement's actual water
 * shortfall every tick (GQP spec 9.1 names water shortage as a cause). An
 * authored shift on it would be overwritten one tick later, which is a way for
 * content to promise an effect the Core does not keep.
 */
export const AUTHORABLE_EPIDEMIC_CAUSES = [
  "cohort_dissatisfaction",
  "deferred_triage",
  "crowding"
] as const;
export type AuthorableEpidemicCause = (typeof AUTHORABLE_EPIDEMIC_CAUSES)[number];

/**
 * Move one named cause of the epidemic, and the epidemic with it.
 *
 * The cause is part of the payload so the pressure can always answer *why* it
 * moved: value and contributors change together and cannot contradict each
 * other. There is no bare "epidemic minus 0.2".
 */
export interface EpidemicShiftEffect {
  type: "EPIDEMIC_SHIFT";
  cause: AuthorableEpidemicCause;
  delta: number;
}

/**
 * Maintenance, deferral, strain and repair of one production node.
 *
 * GQP spec 9.2 is binding: INFRASTRUCTURE is derived from node condition, and
 * the proof must give the player Core-owned agency over that condition rather
 * than a parallel infrastructure counter.
 */
export interface NodeConditionShiftEffect {
  type: "NODE_CONDITION_SHIFT";
  nodeId: string;
  delta: number;
}

/**
 * How widely the fact behind a memory is known.
 *
 * Not the same thing as `origin`, which says how *this copy* reached *this
 * character*. Exposure is a property of the fact, and it decides which of the
 * three propagation channels of spec 7.1 may carry it:
 *
 *   secret   direct holder only; no reflection, no public knowledge
 *   private  direct holder, plus reflection along a strong relationship
 *   public   the above, plus the settlement's community and its faction
 *
 * A secret stays local until an explicit decision publishes it. Deciding *when*
 * a secret is discovered is GQP-C's `SECRET_ACTION_DISCOVERED`, not this.
 */
export const MEMORY_EXPOSURES = ["secret", "private", "public"] as const;
export type MemoryExposure = (typeof MEMORY_EXPOSURES)[number];

/**
 * Record a salient memory on one character, and propagate it by its exposure.
 *
 * The memory's `origin` is not part of the payload: the recorded copy is always
 * `direct`, and reflected or public copies are produced by the propagation rule.
 * An author who could write `origin: "reflected"` could invent second-hand
 * knowledge the social rules never granted.
 */
export interface MemoryRecordEffect {
  type: "MEMORY_RECORD";
  characterId: string;
  memoryId: string;
  subjectId?: string;
  valence: MemoryValence;
  salience: number;
  exposure: MemoryExposure;
  behaviorHook?: MemoryBehaviorHook;
  callbackEligible: boolean;
  summary: string;
  tags: string[];
}

/**
 * Make a fact that was secret or private public, by an explicit decision.
 *
 * The publication mechanism GQP-C's discovery detector will later call. Here it
 * only ever runs because a player chose transparency.
 */
export interface MemoryPublishEffect {
  type: "MEMORY_PUBLISH";
  memoryId: string;
}

/** Effects only a schema-v2 proof world can apply. */
export type ProofEventEffect =
  | EpidemicShiftEffect
  | NodeConditionShiftEffect
  | MemoryRecordEffect
  | MemoryPublishEffect;

export type EventEffect = LegacyEventEffect | ProofEventEffect;

export interface DelayedConsequenceState {
  id: string;
  triggerTurn: number;
  visibility: "visible" | "hidden";
  scope: "personal" | "local" | "settlement" | "faction" | "regional";
  effects: EventEffect[];
  reversible: boolean;
  status: "pending" | "applied";
  source: CausalSource;
}

/**
 * Everything both schema versions carry.
 *
 * Split out so a reader of a common field does not have to narrow, while a
 * reader of a proof field cannot avoid it.
 */
export interface SystemicSimulationCore {
  /**
   * World Tick counter, distinct from `WorldState.turn`.
   *
   * `GAME_SYSTEMS_SCHEMA_v0.1` section 46 separates a Player Turn — one
   * significant decision — from a World Tick, which advances the simulation,
   * and states they need not be 1:1. One counter cannot represent both: when
   * `runWorldTick` also advanced `turn`, a single player decision followed by
   * one tick consumed two Player Turns.
   */
  tick: number;
  settlements: SettlementState[];
  factions: FactionState[];
  productionNodes: ProductionNodeState[];
  populationCohorts: PopulationCohortState[];
  politicalGroups: PoliticalGroupState[];
  warfareSquads: WarfareSquadState[];
  delayedConsequences: DelayedConsequenceState[];
}

/** The accepted M1 baseline shape. Unchanged, and it stays that way. */
export interface SystemicSimulationStateV1 extends SystemicSimulationCore {
  schemaVersion: 1;
}

/**
 * The Gameplay Quality Proof shape.
 *
 * The proof's authoritative semantics require a version bump rather than
 * optional additions (spec 24.1). The reason is safety: the v1 validator does
 * not reject fields it does not know, so proof state carried on a v1 save
 * would survive a round trip **outside** the hostile-input guarantee the M1
 * persistence boundary was built to provide. A tampered save could inject a
 * non-finite pressure or a relationship pointing at a character who does not
 * exist and the boundary would not notice.
 *
 * The number changing is also the only way an older build can know it is
 * looking at a world containing decisions it cannot interpret. Without it,
 * old code opens the world and silently ignores authoritative state.
 *
 * A v1 world does not become a proof world by being opened: there is no
 * automatic migration, by rule 4 of the same section.
 */
export interface SystemicSimulationStateV2 extends SystemicSimulationCore {
  schemaVersion: 2;
  /** Directed bonds between party characters (spec 7). */
  characterRelationships: CharacterRelationship[];
  /** One structured collection, not two parallel ones (spec 8.1). */
  factionAgenda: FactionAgendaItem[];
  /** The one explicitly stored pressure (spec 9.1). */
  epidemic: EpidemicPressureState;
  /**
   * Authoritatively resolved decisions, oldest first (spec 12.3).
   *
   * The only admitted source for novelty, repetition and the quiet bound.
   * Deriving it from memories is not workable: memories are written only when
   * a World Tick rule decides to, and a history with holes produces arbitrary
   * repetition penalties.
   */
  resolvedHistory: ResolvedDecision[];
}

/**
 * The persisted simulation state, at whichever schema version it declares.
 *
 * A union rather than one interface with optional fields, so that reading
 * proof state off a world that may be a baseline world is a compile error
 * rather than an `undefined` nobody checked.
 */
export type SystemicSimulationState = SystemicSimulationStateV1 | SystemicSimulationStateV2;

export interface WorldState {
  campaignId: string;
  seed: number;
  turn: number;
  day: number;
  worldPressure: number;
  resources: ResourceMap;
  flags: Record<string, boolean | number | string>;
  party: CharacterState[];
  profile: CampaignProfile;
  /**
   * Optional until the M1 migration is complete. New systemic scenarios populate
   * it; legacy P0 smoke saves remain valid without a schema migration.
   */
  simulation?: SystemicSimulationState;
}

export interface EventChoice {
  id: string;
  label: string;
  description?: string;
  requirements?: {
    resources?: ResourceMap;
    flagsAll?: string[];
    flagsNone?: string[];
  };
  effects: EventEffect[];
}

export interface GameEvent {
  id: string;
  version: number;
  title: string;
  body: string;
  category: string;
  tags: string[];
  weight: number;
  requirements?: {
    minTurn?: number;
    maxPressure?: number;
    flagsAll?: string[];
    flagsNone?: string[];
  };
  choices: EventChoice[];
}

export interface StateChange {
  type: string;
  key: string;
  before: unknown;
  after: unknown;
}

export interface StateDelta {
  turn: number;
  source: string;
  changes: StateChange[];
}
/* ------------------------------------------------------------------ *
 * GQP proof contracts — schema v2
 *
 * Every value below that a game rule may branch on is a closed enum, a
 * stable semantic id, or a typed predicate with validated arguments.
 * Labels, summaries and titles stay presentation data and no rule reads
 * them (GQP §13.1). The reason is not style: a rule that compares prose
 * breaks silently when someone fixes a typo, and a save carrying prose as
 * authoritative state cannot be validated against hostile input — there is
 * no way to say whether a free string is legitimate. An enum can.
 * ------------------------------------------------------------------ */

/**
 * What a character will not trade away.
 *
 * One per functional role of GQP §6.2, and each one takes a different side
 * of the proof's dilemmas — triage, the unregistered conduit, public
 * accountability. A value that never opposes another value produces no
 * predictable refusal, so it would fail the §5.1 rule.
 */
export const CHARACTER_CORE_VALUES = [
  "institutional_order",
  "technical_integrity",
  "duty_of_care",
  "practical_autonomy",
  "community_voice"
] as const;
export type CharacterCoreValue = (typeof CHARACTER_CORE_VALUES)[number];

/**
 * What a character is trying to achieve right now.
 *
 * Distinct from `coreValue` on purpose: two characters who both hold
 * `duty_of_care` can want opposite things this turn, and it is the goal —
 * not the value — that decides what they propose when handed a choice.
 */
export const CHARACTER_GOALS = [
  "hold_settlement_together",
  "restore_recycler_condition",
  "prevent_outbreak",
  "secure_water_supply",
  "keep_decisions_public"
] as const;
export type CharacterGoal = (typeof CHARACTER_GOALS)[number];

/**
 * The kinds of bond the proof scenario actually uses.
 *
 * GQP §7 lists five candidate types and permits a shorter list when the
 * scenario does not use them all. `family_bond` is absent because no
 * relationship in the proof cast is one, and an enum member nothing can
 * produce is a branch no test can reach.
 */
export const CHARACTER_RELATIONSHIP_TYPES = [
  "ally_friend",
  "rival",
  "authority_dependent",
  "debt_obligation"
] as const;
export type CharacterRelationshipType = (typeof CHARACTER_RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_STRENGTHS = ["low", "medium", "high"] as const;
export type RelationshipStrength = (typeof RELATIONSHIP_STRENGTHS)[number];

/**
 * A directed bond between two characters.
 *
 * Directed because the obligations are not symmetric: the clinic owing the
 * quartermaster is not the quartermaster owing the clinic. This is the data
 * channel 2 of GQP §7.1 walks — a salient event about A can create a
 * reflected memory in B when a strong relationship exists.
 */
export interface CharacterRelationship {
  sourceCharacterId: string;
  targetCharacterId: string;
  type: CharacterRelationshipType;
  strength: RelationshipStrength;
}

/** Whether recalling this memory argues for, against, or cuts both ways. */
export const MEMORY_VALENCES = ["positive", "negative", "ambivalent"] as const;
export type MemoryValence = (typeof MEMORY_VALENCES)[number];

/**
 * Which of the three propagation channels of GQP §7.1 produced the memory.
 *
 * Load-bearing rather than descriptive: secret actions stay local until a
 * deterministic discovery event exposes them, and without this field a
 * reflected memory is indistinguishable from something the character saw.
 */
export const MEMORY_ORIGINS = ["direct", "reflected", "public"] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

/**
 * The typed rule a memory activates later.
 *
 * A rule id, not a sentence (§13.1). The behaviour each id names is built in
 * GQP-B; the vocabulary is fixed here so history written now stays readable
 * when it arrives.
 */
export const MEMORY_BEHAVIOR_HOOKS = [
  "refuse_similar_request",
  "offer_unprompted_warning",
  "volunteer_help",
  "raise_publicly",
  "call_in_debt"
] as const;
export type MemoryBehaviorHook = (typeof MEMORY_BEHAVIOR_HOOKS)[number];

/** A desire is satisfied by conceding; a grievance is resolved by repairing. */
export const FACTION_AGENDA_KINDS = ["desire", "grievance"] as const;
export type FactionAgendaKind = (typeof FACTION_AGENDA_KINDS)[number];

/** What an agenda item is about. A stable semantic id, never a label. */
export const FACTION_AGENDA_SUBJECTS = [
  "network_reliability",
  "informal_access",
  "public_transparency",
  "medical_supply",
  "settlement_autonomy"
] as const;
export type FactionAgendaSubject = (typeof FACTION_AGENDA_SUBJECTS)[number];

/**
 * The satisfy/resolve condition of an agenda item.
 *
 * A named predicate with typed arguments — deliberately **not** a general
 * expression language. GQP §13.1 asks for the smallest typed contract
 * sufficient for the proof, and an interpreter would be a new evaluator to
 * validate against hostile input for no gameplay gained.
 */
export type AgendaCondition =
  | {
      predicate: "production_condition_at_least";
      nodeId: string;
      value: number;
    }
  | {
      predicate: "resource_stock_at_least";
      settlementId: string;
      resourceKey: string;
      amount: number;
    }
  | {
      predicate: "political_approval_at_least";
      groupId: string;
      value: number;
    }
  | {
      predicate: "flag_equals";
      key: string;
      value: boolean;
    };

export const AGENDA_PREDICATES = [
  "production_condition_at_least",
  "resource_stock_at_least",
  "political_approval_at_least",
  "flag_equals"
] as const;
export type AgendaPredicate = (typeof AGENDA_PREDICATES)[number];

/**
 * One structured concept, not two parallel collections.
 *
 * `kind` is a real semantic distinction rather than the sign of a number.
 * A desire is not a grievance with negative severity: modelling both on one
 * numeric axis would make a sated faction indistinguishable from a placated
 * one, and those call for opposite play.
 */
export interface FactionAgendaItem {
  id: string;
  factionId: string;
  kind: FactionAgendaKind;
  subject: FactionAgendaSubject;
  intensity: number;
  condition: AgendaCondition;
  source: CausalSource;
}

/** The visible qualitative stage of a pressure. Derived, never stored. */
export const PRESSURE_STAGES = ["STABLE", "STRAINED", "CRITICAL", "CRISIS"] as const;
export type PressureStage = (typeof PRESSURE_STAGES)[number];

/** Why the epidemic pressure is where it is. Typed causes, not prose. */
export const EPIDEMIC_CAUSES = [
  "water_shortage",
  "cohort_dissatisfaction",
  "deferred_triage",
  "crowding"
] as const;
export type EpidemicCause = (typeof EPIDEMIC_CAUSES)[number];

export interface EpidemicContributor {
  cause: EpidemicCause;
  magnitude: number;
  source: CausalSource;
}

/**
 * The one pressure the proof stores explicitly.
 *
 * GQP §9.1: it is the only pressure that creates a dilemma M1 state cannot
 * already express — medicine and water compete, and "treat now or prevent
 * later" has no representation today.
 *
 * The qualitative stage is **not** a field. It is derived from `value`, so
 * the two cannot drift apart; storing both would repeat the mistake §9.3
 * refuses when it declines a fourth legitimacy counter.
 */
export interface EpidemicPressureState {
  value: number;
  contributors: EpidemicContributor[];
}

/**
 * The five families of GQP §11, as stable gameplay ids.
 *
 * Only the vocabulary. No event content belongs to this slice. `familyId` is
 * required in history and is not derivable from `eventId`, because the
 * repetition the proof penalises is defined per family: re-asking the same
 * question with a different instance is still repetition.
 */
export const EVENT_FAMILY_IDS = [
  "scarcity_triage",
  "maintenance",
  "unregistered_conduit",
  "public_accountability",
  "external_rescue"
] as const;
export type EventFamilyId = (typeof EVENT_FAMILY_IDS)[number];

/**
 * One authoritatively resolved decision.
 *
 * Records decisions, never presentation: a quiet beat and an event shown but
 * not answered write nothing (§12.3 rules 5–6).
 *
 * Both clocks are kept because they answer different questions. `playerTurn`
 * measures how many decisions have passed — the right scale for repetition —
 * and carries pre-increment semantics consistent with `StateDelta.turn`: the
 * turn the decision came from, not the one it produced. `worldTick` measures
 * how much world has passed, and is the only scale that advances while the
 * player decides nothing, which is what the §14.6 quiet bound is measured in.
 *
 * The family id travels with the entry rather than being looked up later:
 * the catalogue is mutable, and a future event that is renamed or removed
 * must not be able to rewrite the past of a saved run.
 */
export interface ResolvedDecision {
  familyId: EventFamilyId;
  eventId: string;
  choiceId: string;
  playerTurn: number;
  worldTick: number;
}

/* ------------------------------------------------------------------ *
 * GQP-B proof events
 *
 * A separate type rather than an extension of `GameEvent`. The M1 event gates
 * on flags, turn and pressure and carries prose; a proof event needs a family,
 * a taxonomy, eligibility over memory, agenda and pressure, and disclosure
 * data for KNOWN / RISK / UNKNOWN. Folding all of that into `GameEvent` would
 * give every M1 event a set of fields it can never use, and give the M1
 * validator a contract it was never written for.
 * ------------------------------------------------------------------ */

/** The six functional categories of GQP spec 10. */
export const PROOF_EVENT_TAXONOMY = [
  "SIGNAL",
  "OPPORTUNITY_REQUEST",
  "DILEMMA",
  "COMPLICATION",
  "CRISIS_PAYOFF",
  "AFTERMATH"
] as const;
export type ProofEventTaxonomy = (typeof PROOF_EVENT_TAXONOMY)[number];

/**
 * A named condition over authoritative state. Eligibility is a conjunction of
 * these; there is no OR, no nesting and no expression language (spec 13.1).
 *
 * `value: false` is how a predicate is negated, so "Ira has not refused" is one
 * predicate rather than a NOT combinator.
 */
export type ProofPredicate =
  | { predicate: "epidemic_stage_in"; stages: PressureStage[] }
  | { predicate: "infrastructure_stage_in"; settlementId: string; stages: PressureStage[] }
  | { predicate: "node_condition_below"; nodeId: string; value: number }
  | { predicate: "flag_equals"; key: string; value: boolean }
  | {
      predicate: "memory_hook_present";
      characterId: string;
      hook: MemoryBehaviorHook;
      subjectId?: string;
      value: boolean;
    }
  | { predicate: "memory_known"; characterId: string; memoryId: string; value: boolean }
  | { predicate: "agenda_satisfied"; agendaId: string; value: boolean }
  | {
      predicate: "consequence_status";
      consequenceId: string;
      status: "pending" | "applied" | "absent";
    };

export const PROOF_PREDICATES = [
  "epidemic_stage_in",
  "infrastructure_stage_in",
  "node_condition_below",
  "flag_equals",
  "memory_hook_present",
  "memory_known",
  "agenda_satisfied",
  "consequence_status"
] as const;

/**
 * Risk categories a choice may disclose. Presentation, not authority: the Core
 * decides whether infrastructure actually worsens. The catalogue validator only
 * checks that no delayed harm arrives in a category the choice never named.
 */
export const PROOF_RISK_CATEGORIES = [
  "epidemic",
  "infrastructure",
  "supply",
  "political",
  "social"
] as const;
export type ProofRiskCategory = (typeof PROOF_RISK_CATEGORIES)[number];

/**
 * What the player may know before choosing (GQP-3).
 *
 * KNOWN is mostly *derived* from the choice's immediate effects by the Core, so
 * the costs it shows cannot drift from the costs it charges. `knownNotes` adds
 * authored context. RISK names categories without outcomes; UNKNOWN names what
 * genuinely cannot be known yet.
 */
export interface ProofChoiceDisclosure {
  knownNotes?: string[];
  risks: ProofRiskCategory[];
  unknowns: string[];
}

/**
 * A consequence a choice schedules through the real delayed-consequence engine.
 *
 * `delay` counts subsequent decisions: 1 means "after the next decision". The
 * consequence id is derived from event, choice and `key`, so it is stable and
 * unique without being authored.
 *
 * `breadcrumb` names a memory the same choice records. A delayed outcome with no
 * earlier signal is refused by the catalogue validator (GQP-4).
 */
export interface ProofScheduledConsequence {
  key: string;
  delay: number;
  visibility: "visible" | "hidden";
  scope: DelayedConsequenceState["scope"];
  effects: EventEffect[];
  breadcrumb: { memoryId: string };
}

export interface ProofChoice {
  id: string;
  /** Presentation. No rule reads it. */
  label: string;
  /** Option availability, beyond affordability, which is derived. */
  availability?: ProofPredicate[];
  effects: EventEffect[];
  schedules?: ProofScheduledConsequence[];
  disclosure: ProofChoiceDisclosure;
}

export interface ProofEvent {
  /** Stable gameplay id. Never shown, never compared to anything readable. */
  id: string;
  familyId: EventFamilyId;
  taxonomy: ProofEventTaxonomy;
  eligibility: ProofPredicate[];
  /** Presentation only. Titles and bodies are never read by a rule. */
  presentation: { title: string; body: string };
  choices: ProofChoice[];
}
