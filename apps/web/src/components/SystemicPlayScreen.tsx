import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorldState } from "@paa/game-types";
import {
  choiceAvailable,
  loadGame,
  newSystemicGame,
  playChoice,
  playWorldTick,
  saveGame,
  type FeedEntry,
  type GameplaySession
} from "../gameplay/controller";
import {
  narrateEntry,
  proceduralNarration,
  type NarrationSource
} from "../gameplay/narration";
import { tauriPersistence, type SystemicPersistence } from "../platform/persistence";

/**
 * The first playable systemic screen.
 *
 * Everything shown here is read from the authoritative `WorldState`; every
 * button dispatches one of the controller's actions and replaces the session
 * with what the core returned. No component computes a resource, a turn or a
 * consequence.
 *
 * Presentation state — narration text, save status, which panel is open —
 * lives in `useState` and never touches the world. That separation is why the
 * save payload cannot accidentally carry a toast.
 */

interface Props {
  readonly persistence?: SystemicPersistence;
  readonly narration?: NarrationSource;
  readonly onExit?: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function SystemicPlayScreen({
  persistence = tauriPersistence,
  narration = proceduralNarration,
  onExit
}: Props) {
  const [session, setSession] = useState<GameplaySession | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [lines, setLines] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  /** Narrate the newest entry, after the authoritative result already exists. */
  const narrateNewest = useCallback(
    (next: GameplaySession) => {
      const newest = next.feed[0];
      if (!newest) return;
      void narrateEntry(narration, next.state, newest).then(text => {
        if (mounted.current) setLines(current => ({ ...current, [newest.id]: text }));
      });
    },
    [narration]
  );

  const commit = useCallback(
    (next: GameplaySession, message: string) => {
      setSession(next);
      setStatus({ kind: "ok", message });
      narrateNewest(next);
    },
    [narrateNewest]
  );

  const startNew = useCallback(() => {
    const next = newSystemicGame();
    setSession(next);
    setLines({});
    setStatus({ kind: "ok", message: "Nuova campagna sistemica." });
  }, []);

  const choose = useCallback(
    (choiceId: string) => {
      if (!session) return;
      try {
        commit(playChoice(session, choiceId), "Scelta risolta.");
      } catch (error) {
        setStatus({ kind: "error", message: (error as Error).message });
      }
    },
    [session, commit]
  );

  const tick = useCallback(() => {
    if (!session) return;
    commit(playWorldTick(session), "World Tick eseguito.");
  }, [session, commit]);

  const save = useCallback(async () => {
    if (!session) return;
    setStatus({ kind: "busy", message: "Salvataggio…" });
    const outcome = await saveGame(session.state, persistence);
    if (!mounted.current) return;
    setStatus(
      outcome.ok
        ? { kind: "ok", message: `Salvato: ${outcome.campaignId} (${outcome.bytes} byte).` }
        : { kind: "error", message: outcome.message }
    );
  }, [session, persistence]);

  const load = useCallback(async () => {
    // One default slot for this slice. The id is the scenario's own campaign
    // id, which is also what the save derives, so the two cannot drift.
    const campaignId = (session?.state.campaignId ?? newSystemicGame().state.campaignId);
    setStatus({ kind: "busy", message: "Caricamento…" });
    const outcome = await loadGame(campaignId, persistence);
    if (!mounted.current) return;

    if (!outcome.ok) {
      // A corrupted save never becomes a new campaign: the world on screen is
      // left exactly as it was, and the player is told what happened.
      setStatus({ kind: "error", message: outcome.message });
      return;
    }
    setSession(outcome.session);
    setLines({});
    setStatus({ kind: "ok", message: `Campagna ${campaignId} caricata.` });
  }, [session, persistence]);

  if (!session) {
    return (
      <main className="play play--empty">
        <h1>CHRONOSAGA</h1>
        <p className="play__subtitle">Helios Reach · simulazione sistemica</p>
        <div className="play__actions">
          <button className="play__button play__button--primary" onClick={startNew}>
            NUOVA CAMPAGNA
          </button>
          <button className="play__button" onClick={() => void load()}>
            CARICA
          </button>
          {onExit ? (
            <button className="play__button play__button--ghost" onClick={onExit}>
              DIAGNOSTICA P0
            </button>
          ) : null}
        </div>
        <StatusLine status={status} />
      </main>
    );
  }

  return (
    <main className="play">
      <TopBar session={session} onExit={onExit} />

      <div className="play__grid">
        <SettlementPanel state={session.state} />
        <EventPanel session={session} onChoose={choose} />
        <CharactersPanel state={session.state} />
        <FactionsPanel state={session.state} />
        <FeedPanel feed={session.feed} lines={lines} />
      </div>

      <footer className="play__bar">
        <button className="play__button play__button--primary" onClick={tick}>
          ESEGUI WORLD TICK
        </button>
        <button className="play__button" onClick={() => void save()}>
          SALVA
        </button>
        <button className="play__button" onClick={() => void load()}>
          CARICA
        </button>
        <button className="play__button play__button--ghost" onClick={startNew}>
          NUOVA
        </button>
        <StatusLine status={status} />
      </footer>
    </main>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return <span className="play__status" />;
  return <span className={`play__status play__status--${status.kind}`}>{status.message}</span>;
}

function TopBar({ session, onExit }: { session: GameplaySession; onExit?: () => void }) {
  const { state } = session;
  return (
    <header className="play__top">
      <div className="play__identity">
        <strong>CHRONOSAGA</strong>
        <span className="play__campaign">{state.campaignId}</span>
      </div>
      <dl className="play__clocks">
        <div><dt>TURNO GIOCATORE</dt><dd>{state.turn}</dd></div>
        <div><dt>GIORNO</dt><dd>{state.day}</dd></div>
        <div><dt>WORLD TICK</dt><dd>{state.simulation?.tick ?? 0}</dd></div>
        <div><dt>PRESSIONE</dt><dd>{state.worldPressure}</dd></div>
      </dl>
      {onExit ? (
        <button className="play__button play__button--ghost" onClick={onExit}>
          DIAGNOSTICA
        </button>
      ) : null}
    </header>
  );
}

/** Settlement resources come from the authoritative stock, never the flat map. */
function SettlementPanel({ state }: { state: WorldState }) {
  const settlement = state.simulation?.settlements[0];
  if (!settlement) return null;
  const critical = ["water", "energy", "food", "medicine"] as const;

  return (
    <section className="panel panel--settlement">
      <h2>{settlement.name}</h2>
      <div className="panel__meta">
        <span>POPOLAZIONE {settlement.population}</span>
        <span>STABILITÀ {(settlement.stability * 100).toFixed(0)}%</span>
        <span>SODDISFAZIONE {(settlement.satisfaction * 100).toFixed(0)}%</span>
      </div>
      <ul className="resources">
        {critical.map(key => {
          const value = settlement.resourceStock[key] ?? 0;
          const level = value < 8 ? "danger" : value < 20 ? "warn" : "ok";
          return (
            <li key={key} className={`resource resource--${level}`}>
              <span className="resource__name">{key.toUpperCase()}</span>
              <b className="resource__value">{value.toFixed(1)}</b>
            </li>
          );
        })}
      </ul>
      <ActiveFlags state={state} />
    </section>
  );
}

function ActiveFlags({ state }: { state: WorldState }) {
  const active = Object.entries(state.flags)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  if (active.length === 0) return null;
  return (
    <ul className="flags">
      {active.slice(0, 6).map(flag => (
        <li key={flag} className="flags__item">{flag}</li>
      ))}
    </ul>
  );
}

function EventPanel({
  session,
  onChoose
}: {
  session: GameplaySession;
  onChoose: (choiceId: string) => void;
}) {
  const { state, event } = session;
  return (
    <section className="panel panel--event">
      <span className="panel__tag">{event.category.toUpperCase()}</span>
      <h2>{event.title}</h2>
      <p className="event__body">{event.body}</p>
      <div className="choices">
        {event.choices.map(choice => {
          // Availability comes from the core's own requirement check, against
          // the same authority the effects will write.
          const available = choiceAvailable(state, event, choice.id);
          return (
            <button
              key={choice.id}
              className="choice"
              disabled={!available}
              title={available ? undefined : "Requisiti non soddisfatti"}
              onClick={() => onChoose(choice.id)}
            >
              <b>{choice.label}</b>
              {choice.description ? <small>{choice.description}</small> : null}
              {!available ? <em className="choice__blocked">requisiti non soddisfatti</em> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CharactersPanel({ state }: { state: WorldState }) {
  return (
    <section className="panel panel--characters">
      <h2>EQUIPAGGIO</h2>
      <ul className="crew">
        {state.party.map(character => (
          <li key={character.id} className="crew__member">
            <div className="crew__head">
              <strong>{character.name}</strong>
              <small>{character.role}</small>
            </div>
            <div className="crew__bars">
              <Bar label="HP" value={character.health} tone="ok" />
              <Bar label="STR" value={character.stress} tone="danger" />
              <Bar label="MOR" value={character.morale} tone="warn" />
            </div>
            <div className="crew__tags">
              {character.traits.slice(0, 2).map(trait => (
                <span key={trait} className="tag">{trait}</span>
              ))}
              {(character.memories?.length ?? 0) > 0 ? (
                <span className="tag tag--memory" title="memorie strutturate">
                  ◆ {character.memories!.length}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bar">
      <span className="bar__label">{label}</span>
      <span className="bar__track">
        <span className={`bar__fill bar__fill--${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="bar__value">{Math.round(value)}</span>
    </div>
  );
}

function FactionsPanel({ state }: { state: WorldState }) {
  const factions = state.simulation?.factions ?? [];
  return (
    <section className="panel panel--factions">
      <h2>FAZIONI</h2>
      <ul className="factions">
        {factions.map(faction => (
          <li key={faction.id} className="faction">
            <strong>{faction.name}</strong>
            <div className="faction__meta">
              <span>INFLUENZA {faction.influence.toFixed(0)}</span>
              <span>REPUTAZIONE {faction.reputation.toFixed(0)}</span>
            </div>
            {faction.memoryTags.length > 0 ? (
              <div className="faction__tags">
                {faction.memoryTags.slice(0, 3).map(tag => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The consequence feed: only what the core reported, never invented. */
function FeedPanel({
  feed,
  lines
}: {
  feed: readonly FeedEntry[];
  lines: Record<string, string>;
}) {
  const shown = useMemo(() => feed.slice(0, 8), [feed]);
  return (
    <section className="panel panel--feed">
      <h2>CONSEGUENZE</h2>
      {shown.length === 0 ? (
        <p className="feed__empty">Nessuna azione ancora registrata.</p>
      ) : (
        <ol className="feed">
          {shown.map(item => (
            <li key={item.id} className={`feed__item feed__item--${item.kind}`}>
              <div className="feed__head">
                <span className="feed__kind">{item.kind.replace("_", " ")}</span>
                <strong>{item.label}</strong>
              </div>
              {lines[item.id] ? <p className="feed__narration">{lines[item.id]}</p> : null}
              <ul className="feed__changes">
                {item.delta.changes.slice(0, 5).map((change, index) => (
                  <li key={`${item.id}_${index}`}>
                    <span>{String(change.key)}</span>
                    <b>
                      {String(change.before)} → {String(change.after)}
                    </b>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
