import type {
  EventEffect,
  ProofChoice,
  ProofEvent,
  ProofPredicate,
  ProofRiskCategory,
  WorldState
} from "@paa/game-types";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { agendaConditionHolds } from "./agenda-condition.js";
import { epidemicStage, pressureStage, settlementInfrastructurePressure } from "./pressure.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * Proof event eligibility: which events and options the authoritative state
 * makes available. Nothing here chooses among them.
 *
 * Selection -- urgency plus causal relevance minus repetition -- is GQP-C. This
 * module answers only "which events could happen now, and which of their
 * options could be taken", deterministically, from persisted state. The
 * trajectory harness and, later, the GQP-C selector both start from this set.
 *
 * Every function here is pure: it reads the world and returns a value. Nothing
 * is written, cached or remembered between calls, so asking whether an event is
 * eligible can never itself change whether it is.
 */

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function proofWorld(state: WorldState) {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    throw new Error("Proof events are evaluated only against a schema-v2 proof world");
  }
  return simulation;
}

/**
 * A flag read as a proof predicate sees it: an absent flag is `false`.
 *
 * Own property only. `state.flags` is an ordinary object, so `"toString"` and
 * `"__proto__"` answer from the prototype chain under plain indexing -- the
 * R39 finding on GQP-A. A flag that was never set is not the function
 * `Object.prototype.toString`.
 */
function flagOf(state: WorldState, key: string): unknown {
  return Object.hasOwn(state.flags, key) ? state.flags[key] : false;
}

/** Evaluate one named predicate against authoritative state. */
export function evaluateProofPredicate(predicate: ProofPredicate, state: WorldState): boolean {
  const simulation = proofWorld(state);
  switch (predicate.predicate) {
    case "epidemic_stage_in":
      return predicate.stages.includes(epidemicStage(simulation.epidemic));

    case "infrastructure_stage_in": {
      // Derived, never stored (spec 9.2): the stage comes from node condition.
      if (!simulation.settlements.some(item => item.id === predicate.settlementId)) return false;
      return predicate.stages.includes(
        pressureStage(settlementInfrastructurePressure(state, predicate.settlementId))
      );
    }

    case "node_condition_below": {
      // An absent node is not a degraded one. Refusing to guess keeps a renamed
      // node from silently making an event eligible.
      const node = simulation.productionNodes.find(item => item.id === predicate.nodeId);
      return node !== undefined && node.condition < predicate.value;
    }

    case "flag_equals":
      return flagOf(state, predicate.key) === predicate.value;

    case "memory_hook_present": {
      // The behavioural query spec 5.3 and 13.1 require: typed hook, typed
      // subject, direct memory. Never the summary, the tags or the role label.
      const character = state.party.find(item => item.id === predicate.characterId);
      const present = (character?.memories ?? []).some(
        memory =>
          memory.behaviorHook === predicate.hook &&
          memory.origin === "direct" &&
          (predicate.subjectId === undefined || memory.subjectId === predicate.subjectId)
      );
      return present === predicate.value;
    }

    case "memory_known": {
      const character = state.party.find(item => item.id === predicate.characterId);
      const known = (character?.memories ?? []).some(memory => memory.id === predicate.memoryId);
      return known === predicate.value;
    }

    case "agenda_satisfied": {
      // Faction behaviour names the agenda item behind it (GQP-6); it never
      // reads a reputation scalar.
      const item = simulation.factionAgenda.find(entry => entry.id === predicate.agendaId);
      if (!item) return false;
      return agendaConditionHolds(item.condition, state) === predicate.value;
    }

    case "consequence_status": {
      const consequence = simulation.delayedConsequences.find(
        item => item.id === predicate.consequenceId
      );
      if (predicate.status === "absent") return consequence === undefined;
      return consequence?.status === predicate.status;
    }

    default: {
      // Content that skipped the catalogue gate. Refused like an unknown
      // effect type, rather than read as `undefined` and quietly treated as
      // false: an event that silently never appears is a bug nobody sees.
      const unknown: never = predicate;
      throw new Error(`Unknown proof predicate ${JSON.stringify((unknown as { predicate: unknown }).predicate)}`);
    }
  }
}

/** Whether this event id has already been resolved in this run. */
export function hasResolved(state: WorldState, eventId: string): boolean {
  return proofWorld(state).resolvedHistory.some(entry => entry.eventId === eventId);
}

/**
 * Whether an event could be presented now.
 *
 * An event id resolves at most once per run, and that is enforced here rather
 * than authored into each event: it is what makes a repeated or retried
 * resolution impossible to write twice into the history. A family can still
 * return -- as a *different* event, in a different form, which is what spec 23
 * asks of a repeated crisis family.
 */
export function isProofEventEligible(event: ProofEvent, state: WorldState): boolean {
  if (hasResolved(state, event.id)) return false;
  return event.eligibility.every(predicate => evaluateProofPredicate(predicate, state));
}

/**
 * The negative resource costs a choice charges immediately, per resource.
 *
 * Summed per key, so two effects on the same stock are judged together rather
 * than each against the full balance.
 */
function immediateCosts(choice: ProofChoice): Map<string, number> {
  const costs = new Map<string, number>();
  for (const effect of choice.effects) {
    if (effect.type === "RESOURCE_DELTA" && effect.value < 0) {
      costs.set(effect.key, (costs.get(effect.key) ?? 0) + effect.value);
    }
  }
  return costs;
}

/**
 * Whether an option can be taken now: its authored availability, and whether
 * the settlement can pay for it.
 *
 * Affordability is derived from the effects rather than authored beside them,
 * so a cost cannot be changed without the gate changing with it. It reads the
 * same authority the effect will write.
 */
export function isProofChoiceAvailable(choice: ProofChoice, state: WorldState): boolean {
  if (!(choice.availability ?? []).every(predicate => evaluateProofPredicate(predicate, state))) {
    return false;
  }
  for (const [key, cost] of immediateCosts(choice)) {
    if (readAuthoritativeResource(state, key) + cost < 0) return false;
  }
  return true;
}

/**
 * Every event the state makes eligible, in a stable order.
 *
 * Order independence is the point of the sort: the same catalogue assembled in
 * a different order yields the same set in the same sequence. Code units, not
 * locale collation, because the order must replay identically on every
 * machine. Duplicate ids are refused rather than resolved: two events sharing
 * an id would make "which one is eligible" depend on array position.
 */
export function eligibleProofEvents(
  state: WorldState,
  catalogue: readonly ProofEvent[]
): ProofEvent[] {
  proofWorld(state);
  requireUniqueIds(catalogue);
  return catalogue
    .filter(event => isProofEventEligible(event, state))
    .sort((a, b) => byCodeUnit(a.id, b.id));
}

function requireUniqueIds(catalogue: readonly ProofEvent[]): void {
  const seen = new Set<string>();
  for (const event of catalogue) {
    if (seen.has(event.id)) throw new Error(`Duplicate proof event id '${event.id}'`);
    seen.add(event.id);
  }
}

/** Find one event by id, refusing an ambiguous catalogue. */
export function findProofEvent(catalogue: readonly ProofEvent[], eventId: string): ProofEvent {
  requireUniqueIds(catalogue);
  const event = catalogue.find(item => item.id === eventId);
  if (!event) throw new Error(`Unknown proof event '${eventId}'`);
  return event;
}

/** The stable id of a consequence a choice schedules. Derived, never authored. */
export function proofConsequenceId(eventId: string, choiceId: string, key: string): string {
  return `con.${eventId}.${choiceId}.${key}`;
}

/** One certain, immediate consequence of a choice, as the Core will apply it. */
export type KnownItem =
  | { kind: "resource"; key: string; delta: number }
  | { kind: "flag"; key: string; value: string | number | boolean }
  | { kind: "pressure"; delta: number }
  | { kind: "stress"; characterId: string; delta: number }
  | { kind: "epidemic"; cause: string; delta: number }
  | { kind: "node_condition"; nodeId: string; delta: number }
  | { kind: "memory"; characterId: string; memoryId: string; valence: string; exposure: string }
  | { kind: "publish"; memoryId: string };

function knownOf(effect: EventEffect): KnownItem {
  switch (effect.type) {
    case "RESOURCE_DELTA":
      return { kind: "resource", key: effect.key, delta: effect.value };
    case "FLAG_SET":
      return { kind: "flag", key: effect.key, value: effect.value };
    case "PRESSURE_DELTA":
      return { kind: "pressure", delta: effect.value };
    case "CHARACTER_STRESS":
      return { kind: "stress", characterId: effect.targetId, delta: effect.value };
    case "EPIDEMIC_SHIFT":
      return { kind: "epidemic", cause: effect.cause, delta: effect.delta };
    case "NODE_CONDITION_SHIFT":
      return { kind: "node_condition", nodeId: effect.nodeId, delta: effect.delta };
    case "MEMORY_RECORD":
      return {
        kind: "memory",
        characterId: effect.characterId,
        memoryId: effect.memoryId,
        valence: effect.valence,
        exposure: effect.exposure
      };
    case "MEMORY_PUBLISH":
      return { kind: "publish", memoryId: effect.memoryId };
    default: {
      const unknown: never = effect;
      throw new Error(`Cannot describe effect type ${JSON.stringify((unknown as { type: unknown }).type)}`);
    }
  }
}

/**
 * What a player may know before choosing (GQP-3), as presentation data.
 *
 * KNOWN is derived from the choice's immediate effects, so the costs shown are
 * the costs charged and cannot drift apart. RISK and UNKNOWN are authored:
 * categories and open questions, not outcomes. None of this is authority -- the
 * rule that decides whether infrastructure worsens lives in the effects and
 * the World Tick, never here.
 */
export function describeProofChoice(choice: ProofChoice): {
  known: KnownItem[];
  knownNotes: string[];
  risks: ProofRiskCategory[];
  unknowns: string[];
} {
  return {
    known: choice.effects.map(knownOf),
    knownNotes: [...(choice.disclosure.knownNotes ?? [])],
    risks: [...choice.disclosure.risks],
    unknowns: [...choice.disclosure.unknowns]
  };
}
