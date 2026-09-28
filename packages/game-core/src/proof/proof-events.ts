import type {
  CausalSource,
  EventEffect,
  ProofChoice,
  ProofEvent,
  ProofPredicate,
  ProofRiskCategory,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { applyEventEffect } from "../events/event-effect.js";
import { rounded } from "../state/numeric.js";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { agendaConditionHolds } from "./agenda-condition.js";
import { epidemicStage, pressureStage, settlementInfrastructurePressure } from "./pressure.js";
import { publicationRefusal } from "./proof-effects.js";
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
  // A publication the named holder cannot make now closes the option, by the
  // applicator's own precondition (P2-4). The catalogue gate guarantees the
  // fact is produced somewhere and not by this same choice, so reading the
  // current world is reading the world the effect will meet.
  const simulation = proofWorld(state);
  for (const effect of choice.effects) {
    if (effect.type === "MEMORY_PUBLISH" && publicationRefusal(state, simulation, effect) !== null) return false;
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

/**
 * One certain, immediate consequence of a choice: the transition the Core will
 * actually make from the current world, not the delta the content requests.
 *
 * `before` / `after` are read from the authority itself; `delta` is their
 * difference. They differ from the authored delta exactly when the Core
 * saturates -- a node already near 1, a cause already at 0, stress at 100 --
 * which is when a player most needs the true figure (GQP-3, P2-6).
 */
export type KnownItem =
  | { kind: "resource"; key: string; before: number; after: number; delta: number }
  | { kind: "flag"; key: string; before: string | number | boolean | null; after: string | number | boolean }
  | { kind: "pressure"; before: number; after: number; delta: number }
  | { kind: "stress"; characterId: string; before: number; after: number; delta: number }
  | { kind: "epidemic"; cause: string; before: number; after: number; delta: number }
  | { kind: "node_condition"; nodeId: string; before: number; after: number; delta: number }
  | { kind: "memory"; characterId: string; memoryId: string; valence: string; exposure: string; reach: string[] }
  | { kind: "publish"; characterId: string; memoryId: string; reach: string[] };

/** The cause a preview records on its throwaway clone. Never reaches a real world. */
const PREVIEW: CausalSource = { kind: "choice", id: "preview:known" };

function holdersOf(world: WorldState, memoryId: string): string[] {
  return world.party
    .filter(character => (character.memories ?? []).some(memory => memory.id === memoryId))
    .map(character => character.id)
    .sort(byCodeUnit);
}

/**
 * Apply one effect to the preview clone with the real applicator, reading the
 * authority before and after. The arithmetic is the Core's, run once: there is
 * no second copy of saturation, clamping or rounding here.
 */
function previewEffect(world: WorldState, effect: EventEffect, turn: number): KnownItem {
  const apply = () => applyEventEffect(world, effect, [], { source: PREVIEW, turn });
  const simulation = world.simulation as SystemicSimulationStateV2;
  const change = (before: number, after: number) => ({ before, after, delta: rounded(after - before) });
  switch (effect.type) {
    case "RESOURCE_DELTA": {
      const before = readAuthoritativeResource(world, effect.key);
      apply();
      return { kind: "resource", key: effect.key, ...change(before, readAuthoritativeResource(world, effect.key)) };
    }
    case "FLAG_SET": {
      const before = Object.hasOwn(world.flags, effect.key) ? world.flags[effect.key]! : null;
      apply();
      return { kind: "flag", key: effect.key, before, after: world.flags[effect.key]! };
    }
    case "PRESSURE_DELTA": {
      const before = world.worldPressure;
      apply();
      return { kind: "pressure", ...change(before, world.worldPressure) };
    }
    case "CHARACTER_STRESS": {
      const stress = () => world.party.find(character => character.id === effect.targetId)?.stress ?? 0;
      const before = stress();
      apply();
      return { kind: "stress", characterId: effect.targetId, ...change(before, stress()) };
    }
    case "EPIDEMIC_SHIFT": {
      const magnitude = () => simulation.epidemic.contributors.find(item => item.cause === effect.cause)?.magnitude ?? 0;
      const before = magnitude();
      apply();
      return { kind: "epidemic", cause: effect.cause, ...change(before, magnitude()) };
    }
    case "NODE_CONDITION_SHIFT": {
      const condition = () => simulation.productionNodes.find(node => node.id === effect.nodeId)?.condition ?? 0;
      const before = condition();
      apply();
      return { kind: "node_condition", nodeId: effect.nodeId, ...change(before, condition()) };
    }
    case "MEMORY_RECORD": {
      apply();
      return {
        kind: "memory",
        characterId: effect.characterId,
        memoryId: effect.memoryId,
        valence: effect.valence,
        exposure: effect.exposure,
        reach: holdersOf(world, effect.memoryId)
      };
    }
    case "MEMORY_PUBLISH": {
      const before = new Set(holdersOf(world, effect.memoryId));
      apply();
      return {
        kind: "publish",
        characterId: effect.characterId,
        memoryId: effect.memoryId,
        reach: holdersOf(world, effect.memoryId).filter(id => !before.has(id))
      };
    }
    default: {
      const unknown: never = effect;
      throw new Error(`Cannot describe effect type ${JSON.stringify((unknown as { type: unknown }).type)}`);
    }
  }
}

/**
 * What a player may know before choosing (GQP-3), as presentation data.
 *
 * KNOWN is the transition the Core would make from `state` (P2-6): the choice's
 * immediate effects run through the real applicator, in order, on a clone,
 * and read back from the authority. So the costs shown are the costs charged,
 * saturation included, and they cannot drift apart. The world passed in is
 * never touched. An option that cannot be taken now has no KNOWN -- only the
 * reason.
 *
 * RISK and UNKNOWN are authored: categories and open questions, not outcomes.
 * None of this is authority.
 */
export function describeProofChoice(
  choice: ProofChoice,
  state: WorldState
): {
  available: boolean;
  refusal: string | null;
  known: KnownItem[] | null;
  knownNotes: string[];
  risks: ProofRiskCategory[];
  unknowns: string[];
} {
  proofWorld(state);
  const disclosure = {
    knownNotes: [...(choice.disclosure.knownNotes ?? [])],
    risks: [...choice.disclosure.risks],
    unknowns: [...choice.disclosure.unknowns]
  };
  if (!isProofChoiceAvailable(choice, state)) {
    return { available: false, refusal: "not available now", known: null, ...disclosure };
  }
  const world = structuredClone(state);
  const known = choice.effects.map(effect => previewEffect(world, effect, state.turn));
  return { available: true, refusal: null, known, ...disclosure };
}
