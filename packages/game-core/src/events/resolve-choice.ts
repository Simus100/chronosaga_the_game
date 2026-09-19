import type { EventChoice, StateDelta, WorldState } from "@paa/game-types";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { commitDecision } from "./commit-decision.js";
import { isProofEffectType } from "../proof/proof-effect-contract.js";

/**
 * Whether the player may take this choice.
 *
 * Requirements read the same authoritative source the effects write. Checking
 * the flat projection while writing the systemic stock would let a choice be
 * permitted by one number and applied to another.
 */
export function canChoose(choice: EventChoice, state: WorldState): boolean {
  const req = choice.requirements;
  if (!req) return true;
  if (req.resources) {
    for (const [key, amount] of Object.entries(req.resources)) {
      if (readAuthoritativeResource(state, key) < amount) return false;
    }
  }
  if (req.flagsAll?.some(flag => !state.flags[flag])) return false;
  if (req.flagsNone?.some(flag => Boolean(state.flags[flag]))) return false;
  return true;
}

export function resolveChoice(
  state: WorldState,
  choice: EventChoice,
  source: string
): { state: WorldState; delta: StateDelta } {
  if (!canChoose(choice, state)) throw new Error("Choice requirements not met");

  // A proof effect in an M1 choice is refused, not applied without a record.
  // `resolveProofChoice` is the only path that writes the resolved-decision
  // history GQP spec 12.3 requires, and a choice that moved the epidemic or a
  // character's memory without an entry there would be a decision the proof's
  // repetition and liveness rules could never see.
  const proofEffect = choice.effects.find(effect => isProofEffectType((effect as { type: unknown }).type));
  if (proofEffect) {
    throw new Error(
      `${proofEffect.type} is a proof effect; proof choices resolve through resolveProofChoice, which records the decision`
    );
  }

  // The same applicator a delayed consequence uses, and the same single
  // Player Turn increment the proof resolver uses.
  const { state: next, changes } = commitDecision(state, choice.effects);

  return {
    state: next,
    delta: {
      turn: state.turn,
      source,
      changes
    }
  };
}
