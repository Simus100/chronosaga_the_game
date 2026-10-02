import type {
  CharacterCoreValue,
  CharacterMemory,
  CharacterState,
  DelayedConsequenceState,
  EventEffect,
  EventFamilyId,
  MemoryBehaviorHook,
  MemoryValence,
  PatternId,
  ProtectionDirection,
  ResolvedDecision,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { isFactPublic, REFLECTION_THRESHOLD } from "./propagation.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * The four pattern detectors of GQP spec 12 -- exactly four, and no engine.
 *
 * Each one is a pure function of persisted state: the resolved-decision
 * history, the memories decisions recorded (linked back to the decision by
 * their causal source), the delayed consequences those decisions scheduled,
 * and the typed character fields of schema v2. Nothing is stored, cached or
 * remembered between calls. A match is recomputed from the world every time it
 * is asked for, so a save and a load cannot change it, and a detector cannot
 * disagree with the state it describes.
 *
 * A detector recognises narrative potential; it never produces an outcome and
 * never writes the world (spec 12.2). What a match *does* is decided by content:
 * an event or an option names a pattern in a typed `pattern_detected`
 * predicate, and the selector counts that reference as causal relevance.
 *
 * No rule here reads a summary, a tag, a title or a role label. Who is "the
 * technician" is read from `coreValue`, a closed enum the v2 boundary
 * validates; what a decision meant is read from the typed memory it recorded.
 */

/**
 * The families each detector can make eligible or reprioritise (spec 12.2).
 *
 * Declared, and held to by tests: every family listed here has content that
 * reads the pattern, so a detector cannot be decorative.
 */
export const PATTERN_FAMILIES: Readonly<Record<PatternId, readonly EventFamilyId[]>> = {
  IGNORED_TECHNICAL_WARNINGS: ["maintenance", "public_accountability"],
  REPEATED_PROTECTION_OR_NEGLECT: ["scarcity_triage", "public_accountability"],
  FACTION_DEPENDENCY_GROWING: ["external_rescue", "unregistered_conduit", "public_accountability"],
  SECRET_ACTION_DISCOVERED: ["public_accountability", "unregistered_conduit"]
};

/** A resolved decision a match rests on. */
export interface DecisionEvidence {
  readonly kind: "decision";
  readonly familyId: EventFamilyId;
  readonly eventId: string;
  readonly choiceId: string;
  readonly playerTurn: number;
  readonly worldTick: number;
}

/** A first-hand memory a decision recorded, which is what the decision meant to someone. */
export interface MemoryEvidence {
  readonly kind: "memory";
  readonly characterId: string;
  readonly memoryId: string;
  readonly valence: MemoryValence | null;
  readonly behaviorHook: MemoryBehaviorHook | null;
}

/** A consequence a decision scheduled, and whether it has landed. */
export interface ConsequenceEvidence {
  readonly kind: "consequence";
  readonly consequenceId: string;
  readonly triggerTurn: number;
  readonly status: DelayedConsequenceState["status"];
}

/** The character in a position to notice a secret's trace. */
export interface ObserverEvidence {
  readonly kind: "observer";
  readonly characterId: string;
  readonly coreValue: CharacterCoreValue;
}

export type PatternEvidence = DecisionEvidence | MemoryEvidence | ConsequenceEvidence | ObserverEvidence;

/**
 * One detector match.
 *
 * `subject` names what the pattern is about -- the technician, the direction of
 * the political line, the faction, the fact -- so one pattern can hold for
 * two subjects at once without the two being merged.
 *
 * `evidence` is the inspectable answer to "why": the decisions, memories,
 * consequences and observer the predicate actually read, oldest decision
 * first. It is the same data the predicate decided on, not a description of it.
 */
export interface PatternMatch {
  readonly pattern: PatternId;
  readonly subject: string;
  readonly evidence: readonly PatternEvidence[];
}

/** How many times a line must be held before it is a pattern rather than a choice. */
export const REPEATED_THRESHOLD = 2;

/** Code units, never locale: matches must list identically on every machine. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function proofWorld(state: WorldState): SystemicSimulationStateV2 {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    throw new Error("Patterns are detected only on a schema-v2 proof world");
  }
  return simulation;
}

/** The causal-source id a decision stamps on everything it causes. */
export function decisionKey(entry: Pick<ResolvedDecision, "eventId" | "choiceId">): string {
  return `${entry.eventId}:${entry.choiceId}`;
}

function decisionEvidence(entry: ResolvedDecision): DecisionEvidence {
  return {
    kind: "decision",
    familyId: entry.familyId,
    eventId: entry.eventId,
    choiceId: entry.choiceId,
    playerTurn: entry.playerTurn,
    worldTick: entry.worldTick
  };
}

function memoryEvidence(character: CharacterState, memory: CharacterMemory): MemoryEvidence {
  return {
    kind: "memory",
    characterId: character.id,
    memoryId: memory.id,
    valence: memory.valence ?? null,
    behaviorHook: memory.behaviorHook ?? null
  };
}

/**
 * The per-invocation index every detector reads: which first-hand memories
 * each resolved decision recorded.
 *
 * Built once per call and thrown away -- a local index, not a cache. A memory
 * belongs to a decision when it is a direct memory whose causal source is that
 * decision: `resolveProofChoice` stamps `eventId:choiceId` on every effect of a
 * decision, and a delayed consequence carries the same source forward.
 */
interface DecisionRecord {
  readonly entry: ResolvedDecision;
  readonly memories: readonly { readonly character: CharacterState; readonly memory: CharacterMemory }[];
}

function decisionRecords(state: WorldState, simulation: SystemicSimulationStateV2): DecisionRecord[] {
  const byKey = new Map<string, { character: CharacterState; memory: CharacterMemory }[]>();
  for (const character of state.party) {
    for (const memory of character.memories ?? []) {
      if (memory.origin !== "direct" || memory.source.kind !== "choice") continue;
      const list = byKey.get(memory.source.id) ?? [];
      list.push({ character, memory });
      byKey.set(memory.source.id, list);
    }
  }
  return simulation.resolvedHistory.map(entry => ({ entry, memories: byKey.get(decisionKey(entry)) ?? [] }));
}

/** Salient: remarkable enough to be passed on, and so to count (spec 5.3). */
function salient(memory: CharacterMemory): boolean {
  return (memory.salience ?? 0) >= REFLECTION_THRESHOLD;
}

function holdsValue(character: CharacterState, value: CharacterCoreValue): boolean {
  return character.coreValue === value;
}

/**
 * IGNORED_TECHNICAL_WARNINGS -- the settlement's technician has been overruled
 * on maintenance at least twice.
 *
 *   inputs    resolvedHistory (family `maintenance`); the technician's
 *             first-hand memories, linked to each decision by causal source;
 *             `coreValue` (technical_integrity) to find the technician
 *   predicate >= 2 maintenance decisions each recorded a salient negative
 *             memory on the technician
 *   positive  patch the seals, then keep a failing pump running
 *   negative  patch the seals, then authorise the inspection: one overruling,
 *             one heeded warning -- not a pattern
 *
 * One overruled warning is a choice, not a pattern: the second is what makes
 * it a way of running the settlement.
 */
function ignoredTechnicalWarnings(state: WorldState, records: readonly DecisionRecord[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const technicians = state.party.filter(character => holdsValue(character, "technical_integrity"));
  for (const technician of [...technicians].sort((a, b) => byCodeUnit(a.id, b.id))) {
    const evidence: PatternEvidence[] = [];
    let overruled = 0;
    for (const record of records) {
      if (record.entry.familyId !== "maintenance") continue;
      const warnings = record.memories.filter(
        ({ character, memory }) => character.id === technician.id && memory.valence === "negative" && salient(memory)
      );
      if (warnings.length === 0) continue;
      overruled += 1;
      evidence.push(decisionEvidence(record.entry), ...warnings.map(item => memoryEvidence(item.character, item.memory)));
    }
    if (overruled >= REPEATED_THRESHOLD) {
      matches.push({ pattern: "IGNORED_TECHNICAL_WARNINGS", subject: technician.id, evidence });
    }
  }
  return matches;
}

/** The families whose decisions protect or expose the community (spec 12.1). */
const COMMUNITY_FACING: ReadonlySet<EventFamilyId> = new Set(["scarcity_triage", "external_rescue"]);

/**
 * REPEATED_PROTECTION_OR_NEGLECT -- the player has held one line toward the
 * community at least twice.
 *
 *   inputs    resolvedHistory (families scarcity_triage, external_rescue);
 *             the first-hand memories those decisions recorded on the people
 *             who carry the community's cost -- care (duty_of_care) and voice
 *             (community_voice)
 *   predicate >= 2 such decisions left a salient positive memory on them
 *             (protection), or >= 2 a salient negative one (neglect)
 *   positive  open the reserve to the clinic, then back the cistern drive
 *   negative  open the reserve once, and nothing else toward the district
 *
 * Direction is read from typed valence on the memory the decision wrote -- how
 * the people who bore it recorded it -- never from a label. No ideology of the
 * player is inferred: only what two decisions demonstrably did.
 *
 * Cohort satisfaction is deliberately not a predicate input. In Helios it is
 * written by the World Tick from resource shortage alone, so gating on it would
 * make this pattern read the economy instead of the player's line.
 */
function repeatedProtectionOrNeglect(state: WorldState, records: readonly DecisionRecord[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const carers = new Set(
    state.party
      .filter(character => holdsValue(character, "duty_of_care") || holdsValue(character, "community_voice"))
      .map(character => character.id)
  );
  const lines: Record<ProtectionDirection, { count: number; evidence: PatternEvidence[] }> = {
    protection: { count: 0, evidence: [] },
    neglect: { count: 0, evidence: [] }
  };
  for (const record of records) {
    if (!COMMUNITY_FACING.has(record.entry.familyId)) continue;
    const felt = record.memories.filter(({ character, memory }) => carers.has(character.id) && salient(memory));
    for (const direction of ["protection", "neglect"] as const) {
      const valence = direction === "protection" ? "positive" : "negative";
      const matching = felt.filter(({ memory }) => memory.valence === valence);
      if (matching.length === 0) continue;
      lines[direction].count += 1;
      lines[direction].evidence.push(
        decisionEvidence(record.entry),
        ...matching.map(item => memoryEvidence(item.character, item.memory))
      );
    }
  }
  for (const direction of ["neglect", "protection"] as const) {
    if (lines[direction].count >= REPEATED_THRESHOLD) {
      matches.push({ pattern: "REPEATED_PROTECTION_OR_NEGLECT", subject: direction, evidence: lines[direction].evidence });
    }
  }
  return matches;
}

/**
 * FACTION_DEPENDENCY_GROWING -- the settlement has taken on debt to one faction
 * at least twice.
 *
 *   inputs    resolvedHistory; the first-hand `call_in_debt` memories each
 *             decision recorded, and the faction each is about (`subjectId`)
 *   predicate >= 2 resolved decisions recorded a debt to the same faction
 *   0 debts   nothing
 *   1 debt    an initial debt -- readable as the memory itself, not a pattern
 *   2+ debts  a growing dependency: the pattern
 *
 * The load-bearing counterweight of spec 12.1: without it, calling for help is
 * free; with it, the third call is a political position.
 */
function factionDependencyGrowing(state: WorldState, simulation: SystemicSimulationStateV2, records: readonly DecisionRecord[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const faction of [...simulation.factions].sort((a, b) => byCodeUnit(a.id, b.id))) {
    const evidence: PatternEvidence[] = [];
    let debts = 0;
    for (const record of records) {
      const owed = record.memories.filter(
        ({ memory }) => memory.behaviorHook === "call_in_debt" && memory.subjectId === faction.id
      );
      if (owed.length === 0) continue;
      debts += 1;
      evidence.push(decisionEvidence(record.entry), ...owed.map(item => memoryEvidence(item.character, item.memory)));
    }
    if (debts >= REPEATED_THRESHOLD) {
      matches.push({ pattern: "FACTION_DEPENDENCY_GROWING", subject: faction.id, evidence });
    }
  }
  return matches;
}

/** How many decisions have put the settlement in debt to `factionId`: 0, 1, 2... */
export function factionDebtCount(state: WorldState, factionId: string): number {
  const simulation = proofWorld(state);
  return decisionRecords(state, simulation).filter(record =>
    record.memories.some(({ memory }) => memory.behaviorHook === "call_in_debt" && memory.subjectId === factionId)
  ).length;
}

/**
 * Who would notice the trace an effect leaves: the character whose core value
 * guards that part of the world. Effects that leave no trace anyone guards --
 * a memory, a flag, a stress change -- expose nothing.
 */
export function guardianOf(effect: Pick<EventEffect, "type">): CharacterCoreValue | null {
  switch (effect.type) {
    case "NODE_CONDITION_SHIFT":
      return "technical_integrity";
    case "EPIDEMIC_SHIFT":
      return "duty_of_care";
    case "RESOURCE_DELTA":
      return "practical_autonomy";
    case "POLITICAL_STANDING_SHIFT":
      return "community_voice";
    default:
      return null;
  }
}

/**
 * Whether `observer` was still engaged at `turn`: they had not yet turned
 * against the settlement's requests. A character who holds a first-hand
 * `refuse_similar_request` memory recorded before that turn has stopped
 * reporting what they find.
 */
function engagedAt(observer: CharacterState, turn: number): boolean {
  return !(observer.memories ?? []).some(
    memory => memory.origin === "direct" && memory.behaviorHook === "refuse_similar_request" && memory.turn < turn
  );
}

/**
 * The first time the settlement put `observer` to work after `since`: the
 * earliest first-hand memory a resolved decision recorded on them at a later
 * Player Turn. A character nobody has involved in a decision since the secret
 * was made has had no occasion to come across it.
 */
function firstInvolvementAfter(
  observer: CharacterState,
  since: number,
  decisions: ReadonlySet<string>
): CharacterMemory | undefined {
  return (observer.memories ?? [])
    .filter(memory => memory.origin === "direct" && memory.source.kind === "choice" && decisions.has(memory.source.id) && memory.turn > since)
    .sort((a, b) => a.turn - b.turn || byCodeUnit(a.id, b.id))[0];
}

/**
 * SECRET_ACTION_DISCOVERED -- an undisclosed fact has left a trace, and someone
 * in a position to read it was put to work there.
 *
 *   inputs    first-hand memories held by exactly one character, with no
 *             copies and no public trace (`isFactPublic`); the resolved
 *             decision that recorded the fact; the consequences that decision
 *             scheduled and their status; the observers' `coreValue` and the
 *             first-hand memories later decisions recorded on them
 *   predicate the fact is still undisclosed, AND a consequence of the same
 *             decision has applied (the action has a physical trace), AND an
 *             observer who guards that trace and is not the holder was
 *             involved in a decision after the secret was made, AND had not
 *             turned against the settlement by then
 *   positive  splice the line quietly, then patch the recycler: Tarek works
 *             the bus, and when the strain lands he traces the load
 *   negative  splice the line quietly, then borrow the clinic's power for
 *             the overhaul: the same strain lands, and nobody who could read
 *             it has been near the bus since
 *
 * Deterministic and replayable: no probability, no clock, no observer graph.
 * Discovery is sticky: an involvement that happened stays happened, and
 * dismissing the technician afterwards does not un-find what he found.
 *
 * A discovery is narrative potential -- it does not publish anything. A secret
 * becomes public only through the explicit publication channel, when a decision
 * the discovery made possible publishes it (spec 7.1). Until then no faction
 * and no community holds it: this is not a hive mind.
 */
function secretActionDiscovered(state: WorldState, simulation: SystemicSimulationStateV2, records: readonly DecisionRecord[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const holders = new Map<string, number>();
  for (const character of state.party) {
    for (const memory of character.memories ?? []) holders.set(memory.id, (holders.get(memory.id) ?? 0) + 1);
  }

  const decisionKeys = new Set(records.map(record => decisionKey(record.entry)));
  for (const record of records) {
    const key = decisionKey(record.entry);
    const traces = simulation.delayedConsequences
      .filter(consequence => consequence.source.kind === "choice" && consequence.source.id === key && consequence.status === "applied")
      .sort((a, b) => a.triggerTurn - b.triggerTurn || byCodeUnit(a.id, b.id));
    if (traces.length === 0) continue;

    for (const { character: holder, memory } of record.memories) {
      if (holders.get(memory.id) !== 1 || isFactPublic(state, simulation, memory.id)) continue;

      for (const trace of traces) {
        const guardians = new Set(trace.effects.map(guardianOf).filter((value): value is CharacterCoreValue => value !== null));
        let observer: CharacterState | undefined;
        let involvement: CharacterMemory | undefined;
        for (const character of [...state.party].sort((a, b) => byCodeUnit(a.id, b.id))) {
          if (character.id === holder.id || character.coreValue === undefined || !guardians.has(character.coreValue)) continue;
          const first = firstInvolvementAfter(character, memory.turn, decisionKeys);
          if (first && engagedAt(character, first.turn)) {
            observer = character;
            involvement = first;
            break;
          }
        }
        if (!observer || !involvement) continue;
        matches.push({
          pattern: "SECRET_ACTION_DISCOVERED",
          subject: memory.id,
          evidence: [
            decisionEvidence(record.entry),
            memoryEvidence(holder, memory),
            { kind: "consequence", consequenceId: trace.id, triggerTurn: trace.triggerTurn, status: trace.status },
            memoryEvidence(observer, involvement),
            { kind: "observer", characterId: observer.id, coreValue: observer.coreValue! }
          ]
        });
        break;
      }
    }
  }
  return matches.sort((a, b) => byCodeUnit(a.subject, b.subject));
}

/**
 * Every pattern the world currently shows, in a stable order: by detector,
 * then by subject.
 */
export function detectPatterns(state: WorldState): PatternMatch[] {
  const simulation = proofWorld(state);
  const records = decisionRecords(state, simulation);
  return [
    ...ignoredTechnicalWarnings(state, records),
    ...repeatedProtectionOrNeglect(state, records),
    ...factionDependencyGrowing(state, simulation, records),
    ...secretActionDiscovered(state, simulation, records)
  ];
}

/** Whether `pattern` matches now, for `subject` if one is named. */
export function isPatternDetected(state: WorldState, pattern: PatternId, subject?: string): boolean {
  return detectPatterns(state).some(match => match.pattern === pattern && (subject === undefined || match.subject === subject));
}
