import type { EventChoice, StateDelta, WorldState } from "@paa/game-types";
import { readAuthoritativeResource } from "../state/resource-authority.js";
import { commitDecision } from "./commit-decision.js";
import { isProofSimulation } from "../proof/schema-version.js";

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
  // A schema-v2 proof world is refused outright, whatever the choice carries.
  //
  // GQP spec 12.3: the resolved-decision history is the only admissible record
  // of the proof's decisions, and `resolveProofChoice` is its only writer. A
  // legacy-only choice resolved here would still change a proof world and
  // advance its Player Turn -- a decision the history never saw, in a world
  // that stays save-valid. Refusing only proof *effects* left that door open;
  // the world's version is what decides which resolver may touch it.
  //
  // Judged before anything else, so no requirement is read against a world
  // this resolver will not decide on. A proof effect in an M1 world is still
  // refused, by the applicator, which never applies one to a baseline world.
  const simulation = state.simulation;
  if (simulation && isProofSimulation(simulation)) {
    throw new Error(
      "A schema-v2 proof world resolves decisions through resolveProofChoice, which records them in the resolved-decision history"
    );
  }

  if (!canChoose(choice, state)) throw new Error("Choice requirements not met");

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
