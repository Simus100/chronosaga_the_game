import { createHash } from "node:crypto";
import type { EventFamilyId, ProofEvent, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  PacingDefect,
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  isProofChoiceAvailable,
  type ProofFocus
} from "../../src";

/**
 * Every lifecycle path from the proof seed, walked exhaustively.
 *
 * The selector picks every event; the walk branches only over the options the
 * player could actually take at each EVENT beat. So what it reaches is exactly
 * what a player can reach through `beginProofBeat` / `completeProofBeat` -- no
 * scripted event, no state assembled by hand. Identical worlds reached by
 * different paths at the same beat are visited once.
 *
 * Used for the properties that must hold wherever play can go: no fail-closed
 * inside a session, and the quality gates measured at every decision point the
 * network can present.
 */

export interface DecisionContext {
  /** Harness-local beat number (telemetry only). */
  readonly beat: number;
  readonly state: WorldState;
  readonly event: ProofEvent;
  readonly focus: Extract<ProofFocus, { kind: "event" }>;
  /** Options open to the player here. */
  readonly open: readonly string[];
  /** The path of choices that led here, for diagnostics. */
  readonly path: readonly string[];
}

export interface LifecycleWalk {
  readonly states: number;
  readonly decisions: readonly DecisionContext[];
  readonly defects: readonly { readonly beat: number; readonly defect: PacingDefect; readonly path: readonly string[] }[];
  /** How many decisions each distinct path had made after `countDecisionsAt` beats. */
  readonly decisionsByPath: Readonly<Record<number, number>>;
  /** Every complete session: the order in which its families were first resolved. */
  readonly sessions: readonly (readonly EventFamilyId[])[];
}

export interface WalkOptions {
  readonly beats: number;
  readonly catalogue?: readonly ProofEvent[];
  readonly start?: WorldState;
  readonly countDecisionsAt?: number;
}

function hash(state: WorldState): string {
  return createHash("sha1").update(JSON.stringify(state)).digest("hex");
}

export function walkLifecycle(options: WalkOptions): LifecycleWalk {
  const catalogue = options.catalogue ?? GQP_PROOF_EVENTS;
  const seen = new Set<string>();
  const decisions: DecisionContext[] = [];
  const defects: { beat: number; defect: PacingDefect; path: string[] }[] = [];
  const decisionsByPath: Record<number, number> = {};
  const sessions: EventFamilyId[][] = [];
  const countAt = options.countDecisionsAt ?? 12;

  const walk = (state: WorldState, beat: number, path: string[], made: number): void => {
    if (beat === countAt + 1) decisionsByPath[made] = (decisionsByPath[made] ?? 0) + 1;
    if (beat > options.beats) {
      const order: EventFamilyId[] = [];
      for (const entry of (state.simulation as SystemicSimulationStateV2).resolvedHistory) {
        if (!order.includes(entry.familyId)) order.push(entry.familyId);
      }
      sessions.push(order);
      return;
    }
    const key = `${hash(state)}:${beat}`;
    if (seen.has(key)) return;
    seen.add(key);

    let opened;
    try {
      opened = beginProofBeat(state, catalogue);
    } catch (error) {
      if (error instanceof PacingDefect) {
        defects.push({ beat, defect: error, path });
        return;
      }
      throw error;
    }
    const focus = opened.focus;
    if (focus.kind === "quiet") {
      walk(completeProofBeat(opened, catalogue).state, beat + 1, [...path, "QUIET"], made);
      return;
    }
    const open = focus.event.choices.filter(choice => isProofChoiceAvailable(choice, state)).map(choice => choice.id);
    decisions.push({ beat, state, event: focus.event, focus, open, path });
    for (const choiceId of open) {
      walk(completeProofBeat(opened, catalogue, choiceId).state, beat + 1, [...path, `${focus.event.id}:${choiceId}`], made + 1);
    }
  };

  walk(options.start ?? createGqpScenario(7419), 1, [], 0);
  return { states: seen.size, decisions, defects, decisionsByPath, sessions };
}
