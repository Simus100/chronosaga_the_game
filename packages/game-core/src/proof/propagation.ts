import type {
  CausalSource,
  CharacterMemory,
  CharacterState,
  StateChange,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { rounded } from "../state/numeric.js";

/**
 * Social propagation: exactly the three channels of GQP spec 7.1, and nothing
 * that could become a fourth.
 *
 *   1 direct       the character the fact happened to            always
 *   2 reflection   someone who holds a HIGH bond toward them     private, public
 *   3 public       everyone at that settlement, and its faction  public only
 *
 * There is no witness graph, no knowledge graph and no opinion delta. Every
 * channel is one hop from the fact, and copies never propagate again: a
 * reflected memory does not reflect, a public copy does not publish. That is
 * what bounds the reach, and it is structural rather than a depth counter.
 *
 * A **secret** fact stays with its direct holder and goes nowhere else, strong
 * bonds included — the bond with Tarek is exactly how a secret would leak if
 * reflection were allowed to carry one. Only an explicit publication moves a
 * secret, and deciding when a secret is *discovered* is GQP-C's detector.
 *
 * Planning is separated from writing on purpose. Every recipient, copy and tag
 * is computed and checked first; only a complete, valid plan is applied. A
 * refused propagation therefore leaves the world exactly as it was, which is a
 * property the exported applicator must hold even when no caller cloned.
 */

/** Below this salience a fact is not remarkable enough to be passed on. */
export const REFLECTION_THRESHOLD = 0.5;

/** Second-hand knowledge carries half the weight of having been there. */
const SECOND_HAND = 0.5;

/** A copy to write on one character. */
export interface MemoryCopyPlan {
  readonly recipientId: string;
  readonly memory: CharacterMemory;
  readonly channel: "reflected" | "public";
}

/** Everything one propagation will write, computed before any of it is. */
export interface PropagationPlan {
  readonly copies: MemoryCopyPlan[];
  readonly factionAwareness: { readonly factionId: string; readonly tag: string } | null;
}

/** Code units, never locale: recipients must be visited identically everywhere. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function holds(character: CharacterState, memoryId: string): boolean {
  return (character.memories ?? []).some(memory => memory.id === memoryId);
}

/**
 * The copy a recipient receives: the same fact, second-hand.
 *
 * The behaviour hook is not copied. A hook is the holder's own disposition —
 * Tarek warning again because *his* warning was ignored — and a colleague who
 * heard about it does not acquire that disposition by hearing. What a copy
 * carries is knowledge, which `memory_known` can read.
 */
function secondHand(
  memory: CharacterMemory,
  origin: "reflected" | "public",
  source: CausalSource,
  turn: number
): CharacterMemory {
  const copy: CharacterMemory = {
    id: memory.id,
    summary: memory.summary,
    tags: [...memory.tags],
    turn,
    source: structuredClone(source),
    origin,
    exposure: memory.exposure,
    salience: rounded((memory.salience ?? 0) * SECOND_HAND),
    callbackEligible: memory.callbackEligible ?? false
  };
  if (memory.valence !== undefined) copy.valence = memory.valence;
  if (memory.subjectId !== undefined) copy.subjectId = memory.subjectId;
  return copy;
}

/** Channel 2: those who hold a HIGH bond toward the holder, one hop, no further. */
function planReflection(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  holder: CharacterState,
  memory: CharacterMemory,
  source: CausalSource,
  turn: number,
  planned: Set<string>
): MemoryCopyPlan[] {
  if ((memory.salience ?? 0) < REFLECTION_THRESHOLD) return [];

  const recipients = simulation.characterRelationships
    .filter(bond => bond.targetCharacterId === holder.id && bond.strength === "high")
    .map(bond => bond.sourceCharacterId)
    .sort(byCodeUnit);

  const copies: MemoryCopyPlan[] = [];
  for (const recipientId of recipients) {
    if (planned.has(recipientId)) continue;
    const recipient = state.party.find(character => character.id === recipientId);
    if (!recipient) {
      throw new Error(`Relationship names '${recipientId}', who is not in the party`);
    }
    // Knowing it already — directly or otherwise — is not a second memory.
    if (holds(recipient, memory.id)) continue;
    planned.add(recipientId);
    copies.push({ recipientId, memory: secondHand(memory, "reflected", source, turn), channel: "reflected" });
  }
  return copies;
}

/** Channel 3: the community at the holder's settlement, and its faction. */
function planPublic(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  holder: CharacterState,
  memory: CharacterMemory,
  source: CausalSource,
  turn: number,
  planned: Set<string>
): Pick<PropagationPlan, "copies" | "factionAwareness"> {
  // A fact with no place has no community to become known to.
  const location = holder.locationId;
  const settlement = location
    ? simulation.settlements.find(item => item.id === location)
    : undefined;
  if (!settlement) return { copies: [], factionAwareness: null };

  const copies: MemoryCopyPlan[] = [];
  const community = state.party
    .filter(character => character.locationId === settlement.id && character.id !== holder.id)
    .map(character => character.id)
    .sort(byCodeUnit);

  for (const recipientId of community) {
    if (planned.has(recipientId)) continue;
    const recipient = state.party.find(character => character.id === recipientId)!;
    if (holds(recipient, memory.id)) continue;
    planned.add(recipientId);
    copies.push({ recipientId, memory: secondHand(memory, "public", source, turn), channel: "public" });
  }

  const faction = simulation.factions.find(item => item.id === settlement.controllingFactionId);
  if (!faction) {
    throw new Error(
      `Settlement '${settlement.id}' names controlling faction '${settlement.controllingFactionId}', which does not exist`
    );
  }
  const tag = `aware:${memory.id}`;
  return {
    copies,
    factionAwareness: faction.memoryTags.includes(tag) ? null : { factionId: faction.id, tag }
  };
}

/**
 * Plan the propagation of a fact held directly by `holder`.
 *
 * `exposure` is read from the memory, so the channels a fact may travel are
 * decided by the fact itself, not by the caller.
 */
export function planPropagation(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  holder: CharacterState,
  memory: CharacterMemory,
  source: CausalSource,
  turn: number,
  channels: { readonly reflection: boolean }
): PropagationPlan {
  if (memory.exposure === "secret") return { copies: [], factionAwareness: null };

  const planned = new Set<string>([holder.id]);
  const reflected = channels.reflection
    ? planReflection(state, simulation, holder, memory, source, turn, planned)
    : [];

  if (memory.exposure !== "public") return { copies: reflected, factionAwareness: null };

  const publicPlan = planPublic(state, simulation, holder, memory, source, turn, planned);
  return { copies: [...reflected, ...publicPlan.copies], factionAwareness: publicPlan.factionAwareness };
}

/** Write a plan that has already been fully checked. */
export function commitPropagation(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  plan: PropagationPlan,
  changes: StateChange[]
): void {
  for (const copy of plan.copies) {
    const recipient = state.party.find(character => character.id === copy.recipientId)!;
    recipient.memories = [...(recipient.memories ?? []), copy.memory];
    changes.push({
      type: copy.channel === "reflected" ? "memoryReflected" : "memoryPublic",
      key: `${recipient.id}.memories.${copy.memory.id}`,
      before: undefined,
      after: { origin: copy.memory.origin, exposure: copy.memory.exposure, salience: copy.memory.salience }
    });
  }
  if (plan.factionAwareness) {
    const faction = simulation.factions.find(item => item.id === plan.factionAwareness!.factionId)!;
    const before = [...faction.memoryTags];
    faction.memoryTags = [...faction.memoryTags, plan.factionAwareness.tag];
    changes.push({
      type: "factionAware",
      key: `${faction.id}.memoryTags`,
      before,
      after: [...faction.memoryTags]
    });
  }
}
