import type { ProofEvent, ResolvedDecision, StateDelta, WorldState } from "@paa/game-types";
import { applyDueConsequences } from "../state/delayed-consequences.js";
import { runWorldTick, type WorldTickTrace } from "../state/run-world-tick.js";
import { resolveProofChoice } from "./resolve-proof-choice.js";
import { relevantDevelopments, selectProofFocus, type ProofFocus, type QuietDevelopment } from "./select-proof-focus.js";

/**
 * The proof's beat lifecycle: the one owner of "what happens after a focus".
 *
 * Spec 14.5 requires an authoritative progression between a quiet beat and the
 * next selection; otherwise a pure selector asked twice about an unchanged
 * world answers QUIET twice, forever. That rule lives here and nowhere else --
 * not in the selector, which must stay pure, not in a React controller, and
 * not in a test harness.
 *
 *   beginProofBeat     select the focus for a world (pure)
 *   completeProofBeat  EVENT: resolve the player's choice, then apply what
 *                      fell due -- the only path that advances the Player
 *                      Turn and writes the resolved history
 *                      QUIET: run the World Tick -- the only way past a quiet
 *                      focus; no choice, no Player Turn, no history
 *
 * A decision does not run a World Tick. The quiet beat is the moment the
 * simulation advances (14.5), which is what gives it something to show; the
 * M1 flow likewise keeps the tick a separate authoritative step.
 *
 * Nothing is remembered between calls. A beat carries the world it was
 * selected on, and completing it re-derives the focus from that world: a
 * focus that is not what the selector says for it -- stale, edited, or
 * assembled by hand -- is refused rather than trusted.
 */

export interface ProofBeat {
  readonly state: WorldState;
  readonly focus: ProofFocus;
}

export type ProofBeatOutcome =
  | {
      readonly kind: "event";
      readonly state: WorldState;
      readonly decision: ResolvedDecision;
      readonly delta: StateDelta;
      readonly consequences: { readonly appliedIds: readonly string[]; readonly delta: StateDelta };
    }
  | {
      readonly kind: "quiet";
      readonly state: WorldState;
      readonly tick: { readonly delta: StateDelta; readonly trace: WorldTickTrace };
      readonly developments: readonly QuietDevelopment[];
    };

/** Refusal to complete a beat whose focus the world does not produce. */
export class StaleFocus extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleFocus";
  }
}

/** Select the focus for a world. Pure: the world is only read. */
export function beginProofBeat(state: WorldState, catalogue: readonly ProofEvent[]): ProofBeat {
  return { state, focus: selectProofFocus(state, catalogue) };
}

/**
 * Complete a beat: the one authoritative step after a focus.
 *
 * `choiceId` is required for an EVENT and forbidden for a QUIET beat -- a quiet
 * beat carries no decision (spec 4.3), and a decision is never a quiet beat.
 */
export function completeProofBeat(beat: ProofBeat, catalogue: readonly ProofEvent[], choiceId?: string): ProofBeatOutcome {
  const current = selectProofFocus(beat.state, catalogue);
  if (current.kind !== beat.focus.kind || (current.kind === "event" && beat.focus.kind === "event" && current.event.id !== beat.focus.event.id)) {
    throw new StaleFocus(
      `The beat offers ${describe(beat.focus)}, but this world selects ${describe(current)}; begin a new beat from the current world`
    );
  }

  if (current.kind === "quiet") {
    if (choiceId !== undefined) throw new Error("A quiet beat carries no decision; nothing can be chosen");
    // The same World Tick the selector previewed, run for real: one tick
    // implementation, deterministic, so the preview and the progression agree.
    const ticked = runWorldTick(beat.state);
    return {
      kind: "quiet",
      state: ticked.state,
      tick: { delta: ticked.delta, trace: ticked.trace },
      developments: relevantDevelopments(beat.state, ticked.state, catalogue)
    };
  }

  if (choiceId === undefined) throw new Error(`Event '${current.event.id}' needs a choice to be completed`);
  const resolved = resolveProofChoice(beat.state, catalogue, current.event.id, choiceId);
  const due = applyDueConsequences(resolved.state);
  return {
    kind: "event",
    state: due.state,
    decision: resolved.entry,
    delta: resolved.delta,
    consequences: { appliedIds: due.appliedIds, delta: due.delta }
  };
}

function describe(focus: ProofFocus): string {
  return focus.kind === "event" ? `event '${focus.event.id}'` : "a quiet beat";
}
