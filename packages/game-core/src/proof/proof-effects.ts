import type {
  CausalSource,
  CharacterMemory,
  ProofEventEffect,
  StateChange,
  SystemicSimulationStateV2,
  WorldState
} from "@paa/game-types";
import { requireFiniteResult, rounded, withinUnitInterval } from "../state/numeric.js";
import { shiftEpidemicContributor } from "./epidemic-contributors.js";
import {
  validateProofEffectReferences,
  validateProofEffectShape,
  type ProofEffectReferences
} from "./proof-effect-contract.js";
import { commitPropagation, isFactPublic, planPropagation } from "./propagation.js";
import { isProofSimulation } from "./schema-version.js";

/**
 * When and why an effect is being applied.
 *
 * A proof effect writes causal state — a memory's source and Player Turn, an
 * epidemic contributor's source — so it has to know what caused it. The same
 * effect applied immediately by a choice and later by a delayed consequence
 * lands the same authoritative transition; the context is the one thing that
 * legitimately differs, because the cause and the moment differ.
 */
export interface EffectContext {
  readonly source: CausalSource;
  readonly turn: number;
}

function proofWorld(state: WorldState, type: string): SystemicSimulationStateV2 {
  const simulation = state.simulation;
  if (!simulation || !isProofSimulation(simulation)) {
    // Not "ignored on v1": refused. A proof effect reaching a baseline world is
    // either a tampered save or a content wiring mistake, and applying nothing
    // quietly would hide both.
    throw new Error(`${type} is a schema-v2 proof effect and cannot apply to a baseline world`);
  }
  return simulation;
}

function requireContext(context: EffectContext | undefined, type: string): EffectContext {
  if (!context) throw new Error(`${type} needs an effect context: a causal source and a Player Turn`);
  return context;
}

function referencesOf(state: WorldState, simulation: SystemicSimulationStateV2): ProofEffectReferences {
  return {
    characterIds: new Set(state.party.map(character => character.id)),
    factionIds: new Set(simulation.factions.map(faction => faction.id)),
    nodeIds: new Set(simulation.productionNodes.map(node => node.id))
  };
}

/**
 * Why `holder` cannot publish `fact` in `state` now, or null if it can.
 *
 * The one precondition of a publication, read by everyone who needs it: the
 * applicator refuses on it, option availability is derived from it (an option
 * that would publish the impossible is closed, not an error at resolve time),
 * and the save boundary and the scheduler refuse a pending publication that
 * fails it (P2-4). The named character must hold the fact first-hand, and the
 * fact must not already be public.
 */
export function publicationRefusal(
  state: WorldState,
  simulation: SystemicSimulationStateV2,
  effect: { readonly characterId: string; readonly memoryId: string }
): string | null {
  const holder = state.party.find(character => character.id === effect.characterId);
  if (!holder) return `Cannot publish '${effect.memoryId}': '${effect.characterId}' is not a party character`;
  const memory = (holder.memories ?? []).find(item => item.id === effect.memoryId);
  if (!memory) return `Cannot publish '${effect.memoryId}': '${effect.characterId}' does not hold that fact`;
  if (memory.origin !== "direct") {
    return `Cannot publish '${effect.memoryId}': '${effect.characterId}' holds it second-hand, not directly`;
  }
  if (isFactPublic(state, simulation, effect.memoryId)) return `Cannot publish '${effect.memoryId}': it is already public`;
  return null;
}

/**
 * Apply one proof effect: validate it exactly as the boundaries do, compute the
 * whole result, check it, and only then write.
 *
 * The validation call is not a courtesy. It is how the applicator and the two
 * validators stay one semantics: a payload the save boundary would refuse is
 * refused here for the same reason, in the same words, because it is the same
 * function. GQP-0 and the A01 finding were both about letting two copies of a
 * rule exist; this path has one.
 */
export function applyProofEffect(
  state: WorldState,
  effect: ProofEventEffect,
  changes: StateChange[],
  context: EffectContext | undefined
): void {
  const simulation = proofWorld(state, String((effect as { type: unknown }).type));

  const errors: string[] = [];
  validateProofEffectShape(effect, String(effect.type), errors);
  validateProofEffectReferences(effect, String(effect.type), errors, referencesOf(state, simulation));
  if (errors.length > 0) throw new Error(`Refused ${String(effect.type)}: ${errors.join("; ")}`);

  switch (effect.type) {
    case "EPIDEMIC_SHIFT": {
      const { source } = requireContext(context, effect.type);
      shiftEpidemicContributor(simulation.epidemic, effect.cause, effect.delta, source, changes);
      return;
    }

    case "NODE_CONDITION_SHIFT": {
      const node = simulation.productionNodes.find(item => item.id === effect.nodeId)!;
      const before = node.condition;
      // Condition is validated to 0..1 by the persistence boundary. Staying
      // inside that range is keeping an existing rule, not inventing a cap.
      const after = rounded(withinUnitInterval(requireFiniteResult(before + effect.delta, `${node.id}.condition`)));
      requireFiniteResult(after, `${node.id}.condition`);
      if (after === before) return;
      node.condition = after;
      changes.push({ type: "nodeCondition", key: `${node.id}.condition`, before, after });
      return;
    }

    case "MEMORY_RECORD": {
      const { source, turn } = requireContext(context, effect.type);
      const holder = state.party.find(character => character.id === effect.characterId)!;
      if ((holder.memories ?? []).some(memory => memory.id === effect.memoryId)) {
        // Not a silent merge and not an overwrite. The same fact recorded twice
        // on one character means content or a replay went wrong, and saying so
        // is cheaper than a character who remembers a thing twice.
        throw new Error(`${holder.id} already holds memory '${effect.memoryId}'`);
      }
      // A memory id names one fact across the party (P2-7): a fact is recorded
      // once, first-hand, and only propagation makes copies of it. Checking the
      // holder alone let a second event record the same id first-hand on someone
      // who had not heard it -- a secret, say -- and this exported applicator
      // then returned, as a success, a world the save boundary rejects.
      const others = state.party
        .filter(character => character.id !== holder.id)
        .filter(character => (character.memories ?? []).some(memory => memory.id === effect.memoryId))
        .map(character => character.id);
      if (others.length > 0) {
        throw new Error(`Fact '${effect.memoryId}' is already recorded; ${others.join(", ")} hold it. A fact is recorded once`);
      }

      const memory: CharacterMemory = {
        id: effect.memoryId,
        summary: effect.summary,
        tags: [...effect.tags],
        turn,
        source: structuredClone(source),
        valence: effect.valence,
        salience: effect.salience,
        origin: "direct",
        callbackEligible: effect.callbackEligible
      };
      if (effect.subjectId !== undefined) memory.subjectId = effect.subjectId;
      if (effect.behaviorHook !== undefined) memory.behaviorHook = effect.behaviorHook;

      // Plan every copy before writing the first one.
      const plan = planPropagation(state, simulation, holder, memory, effect.exposure, source, turn, {
        reflection: true
      });

      holder.memories = [...(holder.memories ?? []), memory];
      changes.push({
        type: "memoryRecorded",
        key: `${holder.id}.memories.${memory.id}`,
        before: undefined,
        // The exposure goes in the delta -- what this decision did -- not on
        // the memory, which would persist it (P2-5).
        after: { origin: "direct", exposure: effect.exposure, hook: memory.behaviorHook ?? null }
      });
      commitPropagation(state, simulation, plan, changes);
      return;
    }

    case "MEMORY_PUBLISH": {
      const { source, turn } = requireContext(context, effect.type);
      const refusal = publicationRefusal(state, simulation, effect);
      if (refusal) throw new Error(refusal);
      const holder = state.party.find(character => character.id === effect.characterId)!;
      const memory = holder.memories!.find(item => item.id === effect.memoryId)!;

      // Channel 3 from the named holder's settlement, as though the fact had
      // been public from the start. Reflection is not re-run: a publication
      // reaches the community, not a second round of confidants. Nothing is
      // rewritten on copies that already exist -- the public copies and the
      // faction's awareness are the publication (P2-5).
      const plan = planPropagation(state, simulation, holder, memory, "public", source, turn, { reflection: false });
      commitPropagation(state, simulation, plan, changes);
      return;
    }
  }
}
