import {
  applyDueConsequences,
  canChoose,
  createSystemicScenario,
  loadSystemicWorldState,
  resolveChoice,
  runWorldTick,
  selectEvent,
  serializeSystemicWorldState
} from "@paa/game-core";
import { demoEvents, systemicEvents } from "@paa/game-data";
import type { GameEvent, StateDelta, WorldState } from "@paa/game-types";
import type { SystemicPersistence } from "../platform/persistence";

/**
 * Every authoritative action the playable screen can take.
 *
 * React renders and dispatches; it never reaches into `WorldState`. Each
 * function here takes the current world, asks `@paa/game-core` for the next
 * one, and returns both the new state and what changed — so a component can
 * show a consequence without ever computing one.
 *
 * Nothing in this file decides an outcome. Requirements, effects, ticks,
 * consequences and eligibility all come from the shared core, which is the only
 * place that knows the rules and the only place they are tested.
 */

/** The events this slice plays with. */
export const PLAYABLE_EVENTS: GameEvent[] = [...systemicEvents, ...demoEvents];

/**
 * What the game is asking of the player right now.
 *
 * `QUIET` is a decision the game makes, not the absence of one. Modelling it as
 * `event: GameEvent | null` would scatter a null check across every consumer,
 * and the one place somebody forgets is the place the screen breaks. A
 * discriminated union makes the compiler ask the question instead.
 *
 * This is pacing and presentation, never authority: `GameplayFocus` is not part
 * of `WorldState`, is not persisted, is not a Gameplay Beat counter, and a
 * `quiet` focus does not advance the Player Turn.
 *
 * GQP-0 introduces the shape only. The policy that decides when a quiet focus
 * is produced, and the bound that stops it repeating, belong to GQP-C.
 */
export type GameplayFocus =
  | { readonly kind: "event"; readonly event: GameEvent }
  | { readonly kind: "quiet" };

/** What the screen needs to draw one moment of play. */
export interface GameplaySession {
  readonly state: WorldState;
  readonly focus: GameplayFocus;
  /** Newest first. Presentation only; never part of the world. */
  readonly feed: readonly FeedEntry[];
}

/**
 * The event a session is offering, or `undefined` during a quiet focus.
 *
 * A narrowing helper for the callers that legitimately only care about the
 * event case. It does not replace exhaustive handling where the quiet case
 * needs its own behaviour.
 */
export function focusedEvent(session: GameplaySession): GameEvent | undefined {
  return session.focus.kind === "event" ? session.focus.event : undefined;
}

/** One authoritative change, as the consequence feed shows it. */
export interface FeedEntry {
  readonly id: string;
  readonly kind: "choice" | "world_tick" | "consequence";
  readonly label: string;
  readonly delta: StateDelta;
}

let feedCounter = 0;
/** Feed ids are presentation identity, deliberately outside the world. */
function entry(kind: FeedEntry["kind"], label: string, delta: StateDelta): FeedEntry {
  feedCounter += 1;
  return { id: `feed_${feedCounter}`, kind, label, delta };
}

/**
 * The event the world is currently offering.
 *
 * Recomputed from the state every time rather than remembered, because
 * eligibility depends on turn, pressure and flags — all of which an action may
 * have just changed. A remembered event is a stale event.
 */
export function currentEvent(state: WorldState): GameEvent {
  // Still M1's selector, deliberately. `selectEventStable` is the
  // order-independent path GQP will select through; switching the live M1 flow
  // to it would change which event this accepted baseline offers at each turn,
  // which is a gameplay change GQP-0 is not allowed to make.
  return selectEvent(PLAYABLE_EVENTS, state);
}

/**
 * The focus the world is currently offering.
 *
 * GQP-0 always resolves to an event, which is exactly M1's behaviour: no quiet
 * policy exists yet, and inventing one here would be gameplay this slice is not
 * allowed to add. What changes is the shape, so that the quiet case has a
 * declared home before GQP-C fills it.
 */
export function currentFocus(state: WorldState): GameplayFocus {
  return { kind: "event", event: currentEvent(state) };
}

/**
 * Whether a new focus may be selected from this session.
 *
 * A quiet focus changes neither the world nor its history. Selecting again from
 * an unchanged world would therefore return the same answer, and a game that
 * asks the same question forever is not paused — it is stuck. So a quiet
 * session must see an authoritative progression before it may select again.
 *
 * The progression is read from the world itself — the World Tick counter, which
 * `runWorldTick` always advances — rather than from a flag this module keeps.
 * That matters: a remembered flag would be hidden selector state, it would not
 * survive a save, and it could disagree with the world it claims to describe.
 *
 * GQP-0 provides the boundary. The bounded-quiet policy of GQP-C decides how
 * many such progressions a quiet sequence may consume before an event must be
 * offered.
 */
export function canSelectNewFocus(session: GameplaySession, state: WorldState): boolean {
  if (session.focus.kind === "event") return true;
  return worldTickOf(state) !== worldTickOf(session.state);
}

/** The authoritative World Tick, or 0 for a world without a simulation. */
function worldTickOf(state: WorldState): number {
  return state.simulation?.tick ?? 0;
}

/** Whether the player may take this choice, per the core's own rule. */
export function choiceAvailable(state: WorldState, event: GameEvent, choiceId: string): boolean {
  const choice = event.choices.find(candidate => candidate.id === choiceId);
  return choice !== undefined && canChoose(choice, state);
}

/** Start a fresh systemic campaign. */
export function newSystemicGame(seed = 7419): GameplaySession {
  const state = createSystemicScenario(seed);
  return { state, focus: currentFocus(state), feed: [] };
}

/**
 * Resolve one player choice, then let any consequence that came due fire.
 *
 * A choice advances the Player Turn, which is what can bring a delayed
 * consequence to its trigger — so they are applied here rather than left for
 * the next tick, where the player would see them detached from the decision
 * that caused them.
 */
export function playChoice(session: GameplaySession, choiceId: string): GameplaySession {
  const event = focusedEvent(session);
  if (event === undefined) throw new Error("no event is being offered");
  const choice = event.choices.find(candidate => candidate.id === choiceId);
  if (choice === undefined) throw new Error(`unknown choice '${choiceId}'`);
  if (!canChoose(choice, session.state)) {
    throw new Error(`choice '${choiceId}' does not meet its requirements`);
  }

  const resolved = resolveChoice(session.state, choice, `player_choice:${choice.id}`);
  const feed = [entry("choice", choice.label, resolved.delta), ...session.feed];

  const due = applyDueConsequences(resolved.state);
  const state = due.state;
  const withConsequences =
    due.appliedIds.length > 0
      ? [entry("consequence", `Conseguenze: ${due.appliedIds.join(", ")}`, due.delta), ...feed]
      : feed;

  return { state, focus: currentFocus(state), feed: withConsequences };
}

/** Advance the simulation by one World Tick. */
export function playWorldTick(session: GameplaySession): GameplaySession {
  const ticked = runWorldTick(session.state);
  const state = ticked.state;
  return {
    state,
    focus: currentFocus(state),
    feed: [entry("world_tick", `World Tick ${ticked.trace.tick}`, ticked.delta), ...session.feed]
  };
}

/** How a save attempt ended, in the words the screen will use. */
export type SaveOutcome =
  | { readonly ok: true; readonly campaignId: string; readonly bytes: number }
  | { readonly ok: false; readonly message: string };

/**
 * Persist the world.
 *
 * The campaign id is never supplied by the interface: it comes out of
 * `serializeSystemicWorldState`, derived from the state that was just proven
 * valid, so the key a row is filed under and the world inside it cannot
 * disagree.
 */
export async function saveGame(
  state: WorldState,
  persistence: SystemicPersistence
): Promise<SaveOutcome> {
  const serialized = serializeSystemicWorldState(state);
  if (!serialized.ok) {
    return { ok: false, message: `Salvataggio rifiutato: ${serialized.errors.join("; ")}` };
  }

  try {
    const receipt = await persistence.save(serialized.campaignId, serialized.payload);
    return { ok: true, campaignId: receipt.campaignId, bytes: receipt.payloadBytes };
  } catch (error) {
    // The in-memory world is untouched: a failed write loses nothing.
    return { ok: false, message: `Il salvataggio non è riuscito: ${(error as Error).message}` };
  }
}

/** How a load attempt ended. Every failure is a different situation. */
export type LoadOutcome =
  | { readonly ok: true; readonly session: GameplaySession }
  | { readonly ok: false; readonly reason: LoadFailure; readonly message: string };

export type LoadFailure =
  | "not_found"
  | "incompatible_envelope"
  | "corrupted"
  | "transport_error";

/**
 * Read a campaign back.
 *
 * The four failures stay apart because the player needs different things from
 * each. "No save" offers a new game; "corrupted" must never do that quietly,
 * because starting fresh over a damaged file is how a campaign disappears with
 * a cheerful message.
 */
export async function loadGame(
  campaignId: string,
  persistence: SystemicPersistence
): Promise<LoadOutcome> {
  let stored;
  try {
    stored = await persistence.load(campaignId);
  } catch (error) {
    return {
      ok: false,
      reason: "transport_error",
      message: `Impossibile leggere il database: ${(error as Error).message}`
    };
  }

  if (stored.status === "notFound") {
    return { ok: false, reason: "not_found", message: "Nessun salvataggio per questa campagna." };
  }

  if (stored.status === "incompatibleEnvelope") {
    return {
      ok: false,
      reason: "incompatible_envelope",
      message:
        `Il salvataggio usa il formato ${stored.storedVersion}, questa versione ne supporta ` +
        `${stored.supportedVersion}. Non è stato modificato.`
    };
  }

  // The requested id is passed in, so a row filed under one campaign cannot
  // return another's world.
  const validated = loadSystemicWorldState(stored.save.payload, campaignId);
  if (!validated.ok) {
    return {
      ok: false,
      reason: "corrupted",
      message: `Salvataggio non valido (${validated.reason}): ${validated.errors.slice(0, 3).join("; ")}`
    };
  }

  const state = validated.state;
  return { ok: true, session: { state, focus: currentFocus(state), feed: [] } };
}
