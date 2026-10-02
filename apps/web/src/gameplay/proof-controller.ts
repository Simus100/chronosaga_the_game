import {
  PacingDefect,
  PROOF_SCHEMA_VERSION,
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  describeProofChoice,
  explainProofFocus,
  loadSystemicWorldState,
  serializeSystemicWorldState,
  type FocusExplanation,
  type PacingDefectReason,
  type ProofBeat,
  type ProofBeatOutcome
} from "@paa/game-core";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import type { ProofEvent, WorldState } from "@paa/game-types";
import type { SystemicPersistence } from "../platform/persistence";
import { saveGame, type SaveOutcome } from "./controller";

/**
 * The Gameplay Quality Proof, as the playable screen reaches it (GQP-D).
 *
 * The proof's rules live in `@paa/game-core` and nowhere else. This module is
 * the thin wiring between that Core and a screen, in the same spirit as the M1
 * `controller.ts` beside it -- which it deliberately does not touch:
 *
 *   - the world is created by `createGqpScenario` (schema v2), never by M1's
 *     `createSystemicScenario`;
 *   - what the game asks of the player is `beginProofBeat`, the Core's pure
 *     selector -- this module has no selector, no score and no quiet policy;
 *   - every step forward is `completeProofBeat`: a choice for an EVENT, the
 *     World Tick for a QUIET beat. There is no other way past a focus;
 *   - KNOWN / RISK / UNKNOWN is `describeProofChoice`, and the explanation is
 *     `explainProofFocus`. Nothing is recomputed here.
 *
 * A session is presentation: it is not persisted, and the Gameplay Beat index
 * is not in it -- that belongs to playtest telemetry, which the Core never
 * reads (spec 4.3, 22).
 */

/** The proof's catalogue: the one GQP-C network, unfiltered. */
export const PROOF_CATALOGUE: readonly ProofEvent[] = GQP_PROOF_EVENTS;

/** The canonical founder-playtest seed. */
export const PROOF_SEED = 7419;

/** A fail-closed pacing defect, as the screen shows it. Never a game state. */
export interface ProofDefect {
  readonly reason: PacingDefectReason;
  readonly message: string;
}

/** What the last completed beat did, for the screen to show and telemetry to record. */
export type ProofStep =
  | {
      readonly kind: "event";
      /** The world the decision was taken on. */
      readonly before: WorldState;
      readonly eventId: string;
      readonly choiceId: string;
      readonly outcome: Extract<ProofBeatOutcome, { kind: "event" }>;
    }
  | {
      readonly kind: "quiet";
      readonly before: WorldState;
      readonly outcome: Extract<ProofBeatOutcome, { kind: "quiet" }>;
    };

export interface ProofSession {
  readonly state: WorldState;
  /** The beat on offer; `null` only when the Core failed closed. */
  readonly beat: ProofBeat | null;
  /** The Core's Normal-mode explanation of `beat.focus`. */
  readonly explanation: FocusExplanation | null;
  readonly defect: ProofDefect | null;
  /** The beat that produced this session, or `null` at a start or a load. */
  readonly last: ProofStep | null;
}

/**
 * Open the beat the world offers. **Internal**: it derives a focus from a world
 * with no predecessor to answer to, which is legitimate only for a fresh game,
 * a load, or a world `completeProofBeat` itself just produced. Exporting it
 * would hand a caller holding a quiet session a way to ask again without the
 * World Tick (spec 14.5).
 */
function openBeat(state: WorldState, last: ProofStep | null): ProofSession {
  try {
    const beat = beginProofBeat(state, PROOF_CATALOGUE);
    return { state, beat, explanation: explainProofFocus(state, beat.focus), defect: null, last };
  } catch (error) {
    // Fail closed, visibly: a content/eligibility defect is never hidden
    // behind another quiet beat, a filler event or a reset (spec 14.6).
    if (error instanceof PacingDefect) {
      return { state, beat: null, explanation: null, defect: { reason: error.reason, message: error.message }, last };
    }
    throw error;
  }
}

/** Start the Gameplay Quality Proof of Helios Reach. */
export function newProofGame(seed = PROOF_SEED): ProofSession {
  return openBeat(createGqpScenario(seed), null);
}

/** A choice the Core does not offer now. The session is left untouched. */
export class ChoiceUnavailable extends Error {
  constructor(eventId: string, choiceId: string) {
    super(`La scelta '${choiceId}' di '${eventId}' non è disponibile ora.`);
    this.name = "ChoiceUnavailable";
  }
}

/**
 * Answer the EVENT on offer. The Core resolves the decision, advances the
 * Player Turn, writes the history and applies what fell due; this function
 * only refuses early what the Core would refuse anyway, so that nothing is
 * half-attempted.
 */
export function playProofChoice(session: ProofSession, choiceId: string): ProofSession {
  const beat = session.beat;
  if (beat === null || beat.focus.kind !== "event") throw new Error("Nessuna decisione è in attesa.");
  const event = beat.focus.event;
  const choice = event.choices.find(candidate => candidate.id === choiceId);
  if (!choice || !describeProofChoice(choice, beat.state).available) throw new ChoiceUnavailable(event.id, choiceId);

  const outcome = completeProofBeat(beat, PROOF_CATALOGUE, choiceId);
  if (outcome.kind !== "event") throw new Error("Il Core ha completato un beat diverso da quello offerto.");
  return openBeat(outcome.state, { kind: "event", before: beat.state, eventId: event.id, choiceId, outcome });
}

/**
 * Let the quiet beat pass: the Core runs the one World Tick, and only then
 * selects again. The Player Turn does not move.
 */
export function advanceQuietBeat(session: ProofSession): ProofSession {
  const beat = session.beat;
  if (beat === null || beat.focus.kind !== "quiet") throw new Error("Non c'è un momento di quiete da lasciar passare.");
  const outcome = completeProofBeat(beat, PROOF_CATALOGUE);
  if (outcome.kind !== "quiet") throw new Error("Il Core ha completato un beat diverso da quello offerto.");
  return openBeat(outcome.state, { kind: "quiet", before: beat.state, outcome });
}

/** KNOWN / RISK / UNKNOWN for each option of the event on offer, from the Core. */
export function describeOptions(session: ProofSession) {
  const beat = session.beat;
  if (beat === null || beat.focus.kind !== "event") return [];
  return beat.focus.event.choices.map(choice => ({ choice, disclosure: describeProofChoice(choice, beat.state) }));
}

/** The campaign id of the proof's save slot: the scenario's own, never typed by the UI. */
export function proofCampaignId(seed = PROOF_SEED): string {
  return createGqpScenario(seed).campaignId;
}

/** Save the proof world through the same validated boundary M1 uses. */
export function saveProofGame(session: ProofSession, persistence: SystemicPersistence): Promise<SaveOutcome> {
  return saveGame(session.state, persistence);
}

/**
 * The world as the save boundary writes it, for the playtest bundle and the
 * save/load continuity digest. `null` if the boundary refuses the world --
 * which a world the Core produced never is.
 */
export function proofPayload(state: WorldState): string | null {
  const serialized = serializeSystemicWorldState(state);
  return serialized.ok ? serialized.payload : null;
}

export type ProofLoadFailure = "not_found" | "incompatible_envelope" | "corrupted" | "wrong_mode" | "transport_error";

export type ProofLoadOutcome =
  | { readonly ok: true; readonly session: ProofSession }
  | { readonly ok: false; readonly reason: ProofLoadFailure; readonly message: string };

/**
 * Read the proof back. Every failure is reported as itself; none of them ever
 * becomes a new game. A world that is not a schema-v2 proof world is refused
 * by name: there is no migration from M1 (spec 24.1 rule 4).
 */
export async function loadProofGame(persistence: SystemicPersistence, campaignId = proofCampaignId()): Promise<ProofLoadOutcome> {
  let stored;
  try {
    stored = await persistence.load(campaignId);
  } catch (error) {
    return { ok: false, reason: "transport_error", message: `Impossibile leggere il database: ${(error as Error).message}` };
  }
  if (stored.status === "notFound") {
    return { ok: false, reason: "not_found", message: `Nessun salvataggio del Gameplay Quality Proof (${campaignId}).` };
  }
  if (stored.status === "incompatibleEnvelope") {
    return {
      ok: false,
      reason: "incompatible_envelope",
      message: `Il salvataggio usa il formato ${stored.storedVersion}, questa versione ne supporta ${stored.supportedVersion}. Non è stato modificato.`
    };
  }
  const validated = loadSystemicWorldState(stored.save.payload, campaignId);
  if (!validated.ok) {
    return {
      ok: false,
      reason: "corrupted",
      message: `Salvataggio non valido (${validated.reason}): ${validated.errors.slice(0, 3).join("; ")}. Non è stato modificato.`
    };
  }
  const schemaVersion = validated.state.simulation?.schemaVersion;
  if (schemaVersion !== PROOF_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "wrong_mode",
      message: `Il salvataggio ${campaignId} è un mondo schema v${String(schemaVersion)}, non del Gameplay Quality Proof (v${PROOF_SCHEMA_VERSION}). Nessuna migrazione: non è stato aperto.`
    };
  }
  // A load is a bootstrap: the world opened has no earlier session to answer to.
  return { ok: true, session: openBeat(validated.state, null) };
}
