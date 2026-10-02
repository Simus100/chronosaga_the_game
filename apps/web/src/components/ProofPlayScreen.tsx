import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { factionDebtCount, readPressures, readProofWorld, type EventExplanation } from "@paa/game-core";
import type { ProofEvent, WorldState } from "@paa/game-types";
import {
  PROOF_CATALOGUE,
  PROOF_SEED,
  advanceQuietBeat,
  describeOptions,
  loadProofGame,
  newProofGame,
  playProofChoice,
  proofPayload,
  saveProofGame,
  type ProofSession
} from "../gameplay/proof-controller";
import {
  CAUSE_LABEL,
  FAMILY_LABEL,
  RISK_LABEL,
  STAGE_LABEL,
  VALUE_LABEL,
  agendaLabel,
  agendaStatus,
  callbackSentence,
  capitalize,
  chainVia,
  decisionLabel,
  developmentSentence,
  factionLabel,
  firstName,
  knownSentence,
  memorySummary,
  obligations,
  percent,
  rankDevelopments,
  resourceLabel,
  stepLines
} from "../gameplay/proof-presentation";
import { createPersistenceLock, type PersistenceLock } from "../gameplay/persistence-lock";
import type { SystemicPersistence } from "../platform/persistence";
import { BUILD_INFO } from "../playtest/build-info";
import {
  FOUNDER_GATE_STATUS,
  SAMPLE_TARGET,
  createTelemetry,
  type NpcPrediction,
  type Telemetry,
  type TelemetrySink
} from "../playtest/telemetry";
import { FounderQuestionnaire } from "./FounderQuestionnaire";

/**
 * The Gameplay Quality Proof, playable (GQP-D).
 *
 * Everything on screen is read from the session the proof controller returned,
 * and every button dispatches one controller command. The screen decides no
 * event, simulates no quiet beat, applies no effect, moves no clock and
 * computes no score: those are `beginProofBeat` / `completeProofBeat` in the
 * Core. What this component owns is presentation -- which panel is open, the
 * decision timer, the prediction prompt -- and the playtest telemetry, which
 * observes sessions after the Core produced them and is never read back.
 */

interface Props {
  readonly persistence: SystemicPersistence;
  readonly sink: TelemetrySink;
  readonly onMenu: () => void;
  readonly onExit?: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

type Screen = "play" | "questionnaire";

/** How an export ended: where the bundle is, and the first write it lost, if any. */
export interface ExportResult {
  readonly where: string | null;
  readonly error: string | null;
}

/** Spec 20: a prediction before at least one important NPC reaction. Asked at most this often. */
const PREDICTION_PROMPTS = 2;

const beatKey = (session: ProofSession) =>
  session.beat ? `${session.state.turn}:${session.state.simulation?.tick ?? 0}:${session.beat.focus.kind === "event" ? session.beat.focus.event.id : "quiet"}` : "none";

export function ProofPlayScreen({ persistence, sink, onMenu, onExit }: Props) {
  const [session, setSession] = useState<ProofSession | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [screen, setScreen] = useState<Screen>("play");
  const [telemetryOn, setTelemetryOn] = useState(true);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [beats, setBeats] = useState(0);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<NpcPrediction[]>([]);
  const [prompt, setPrompt] = useState<{ key: string; characterId: string } | null>(null);
  const [confirm, setConfirm] = useState<"new" | "menu" | "finish" | null>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const mounted = useRef(true);
  const askedFor = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const lock = useRef<PersistenceLock | null>(null);
  if (lock.current === null) lock.current = createPersistenceLock(busy => mounted.current && setIoBusy(busy));
  const io = lock.current;

  // ------------------------------------------------------------- decision timer
  // UI telemetry only: options on screen -> click, monotonic. Hidden time is
  // measured alongside and not subtracted (see playtest/telemetry.ts).
  const timer = useRef<{ start: number; hiddenSince: number | null; hidden: number } | null>(null);
  const shownKey = session && session.beat?.focus.kind === "event" && !prompt ? beatKey(session) : null;
  useEffect(() => {
    if (shownKey === null) {
      timer.current = null;
      return;
    }
    timer.current = { start: performance.now(), hiddenSince: document.hidden ? performance.now() : null, hidden: 0 };
  }, [shownKey]);
  useEffect(() => {
    const onVisibility = () => {
      const current = timer.current;
      if (!current) return;
      if (document.hidden) current.hiddenSince = performance.now();
      else if (current.hiddenSince !== null) {
        current.hidden += performance.now() - current.hiddenSince;
        current.hiddenSince = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const readTimer = () => {
    const current = timer.current;
    if (!current) return null;
    const now = performance.now();
    const hidden = current.hidden + (current.hiddenSince !== null ? now - current.hiddenSince : 0);
    return { decisionTimeMs: now - current.start, hiddenMs: hidden };
  };

  // ------------------------------------------------------------- telemetry
  const startTelemetry = useCallback(
    (next: ProofSession) => {
      if (!telemetryOn) {
        setTelemetry(null);
        return null;
      }
      const created = createTelemetry({ sink, build: BUILD_INFO, onError: message => mounted.current && setTelemetryError(message) });
      setTelemetry(created);
      setBeats(0);
      setPredictions([]);
      askedFor.current = new Set();
      void created.start(next, PROOF_SEED);
      void created.location().then(path => mounted.current && setLocation(path)).catch(() => mounted.current && setLocation(null));
      return created;
    },
    [sink, telemetryOn]
  );

  const record = useCallback(
    (presented: ProofSession, next: ProofSession) => {
      if (!telemetry) return;
      const callback = presented.beat?.focus.kind === "event" ? presented.beat.focus.selection.callback : null;
      const text = callback ? callbackSentence(presented.state, PROOF_CATALOGUE, callback) : null;
      void telemetry.beat(presented, next, presented.beat?.focus.kind === "event" ? readTimer() : null, text).then(() => mounted.current && setBeats(telemetry.beatIndex));
      if (next.defect) void telemetry.defect(next.state, next.defect.reason, next.defect.message);
    },
    [telemetry]
  );

  // ------------------------------------------------------------- prediction prompt
  // Before an event whose Core callback is a character's memory -- the moment a
  // character is about to react to something the player did -- ask the founder
  // what they expect. Only with telemetry on, at most PREDICTION_PROMPTS times.
  useEffect(() => {
    if (!session || !telemetry || session.beat?.focus.kind !== "event") return;
    const callback = session.beat.focus.selection.callback;
    const key = beatKey(session);
    if (callback?.kind !== "memory" || askedFor.current.has(key) || askedFor.current.size >= PREDICTION_PROMPTS) return;
    askedFor.current.add(key);
    setPrompt({ key, characterId: callback.characterId });
  }, [session, telemetry]);

  // ------------------------------------------------------------- commands
  const start = useCallback(() => {
    if (session && confirm !== "new") {
      setConfirm("new");
      setStatus({ kind: "error", message: `La run in corso (turno ${session.state.turn}) verrà abbandonata e il salvataggio del proof la sostituirà. Premi di nuovo per confermare.` });
      return;
    }
    io.protect(() => {
      const next = newProofGame();
      setConfirm(null);
      setPrompt(null);
      setSession(next);
      startTelemetry(next);
      setStatus({ kind: "ok", message: "Gameplay Quality Proof avviato (seed 7419)." });
    });
  }, [session, confirm, io, startTelemetry]);

  const choose = useCallback(
    (choiceId: string) => {
      if (!session) return;
      setConfirm(null);
      io.protect(() => {
        try {
          const next = playProofChoice(session, choiceId);
          record(session, next);
          setSession(next);
          setStatus({ kind: "idle" });
        } catch (error) {
          setStatus({ kind: "error", message: (error as Error).message });
        }
      });
    },
    [session, io, record]
  );

  const pass = useCallback(() => {
    if (!session) return;
    setConfirm(null);
    io.protect(() => {
      try {
        const next = advanceQuietBeat(session);
        record(session, next);
        setSession(next);
        setStatus({ kind: "idle" });
      } catch (error) {
        setStatus({ kind: "error", message: (error as Error).message });
      }
    });
  }, [session, io, record]);

  const save = useCallback(async () => {
    if (!session) return;
    setConfirm(null);
    await io.exclusive(async () => {
      setStatus({ kind: "busy", message: "Salvataggio…" });
      const outcome = await saveProofGame(session, persistence);
      if (telemetry) void telemetry.save(session.state, outcome.ok ? { ok: true, bytes: outcome.bytes } : { ok: false, message: outcome.message }, outcome.ok ? proofPayload(session.state) : null);
      if (!mounted.current) return;
      setStatus(outcome.ok ? { kind: "ok", message: `Salvato: ${outcome.campaignId} (turno ${session.state.turn}, tick ${session.state.simulation?.tick ?? 0}).` } : { kind: "error", message: outcome.message });
    });
  }, [session, persistence, io, telemetry]);

  const load = useCallback(async () => {
    setConfirm(null);
    await io.exclusive(async () => {
      setStatus({ kind: "busy", message: "Caricamento…" });
      const outcome = await loadProofGame(persistence);
      if (!mounted.current) return;
      if (!outcome.ok) {
        // Never a new game: the screen stays as it was, and says why.
        if (telemetry) void telemetry.load({ ok: false, reason: outcome.reason, message: outcome.message }, null, null);
        setStatus({ kind: "error", message: outcome.message });
        return;
      }
      setPrompt(null);
      setSession(outcome.session);
      const active = telemetry ?? startTelemetry(outcome.session);
      if (active) void active.load({ ok: true }, outcome.session.state, proofPayload(outcome.session.state));
      setStatus({ kind: "ok", message: `Proof caricato: turno ${outcome.session.state.turn}, tick ${outcome.session.state.simulation?.tick ?? 0}.` });
    });
  }, [persistence, io, telemetry, startTelemetry]);

  const toMenu = useCallback(() => {
    if (session && confirm !== "menu") {
      setConfirm("menu");
      setStatus({ kind: "error", message: "Tornando al menu la run non salvata va persa. Premi di nuovo per confermare." });
      return;
    }
    onMenu();
  }, [session, confirm, onMenu]);

  const finish = useCallback(() => {
    if (beats < SAMPLE_TARGET.min && confirm !== "finish") {
      setConfirm("finish");
      setStatus({ kind: "error", message: `Hai giocato ${beats} Gameplay Beat su ${SAMPLE_TARGET.min}–${SAMPLE_TARGET.max}. Premi di nuovo per passare comunque al questionario.` });
      return;
    }
    setConfirm(null);
    setStatus({ kind: "idle" });
    setScreen("questionnaire");
  }, [beats, confirm]);

  /**
   * Write the evidence bundle. The result says whether *this* export wrote
   * everything: only failures raised during it count, and a failed write is
   * never reported as an export.
   */
  const exportBundle = useCallback(async (): Promise<ExportResult | null> => {
    if (!telemetry || !session) return null;
    const before = telemetry.errors.length;
    const payload = proofPayload(session.state);
    if (payload) await telemetry.writeFile("final_save.json", payload);
    await telemetry.writeFile("build.json", JSON.stringify(BUILD_INFO, null, 2));
    await telemetry.writeFile("summary.json", JSON.stringify(telemetry.summary(), null, 2));
    await telemetry.flush();
    const failed = telemetry.errors.slice(before);
    const where = await telemetry.location().catch(() => null);
    const result: ExportResult = { where, error: payload ? (failed.at(-1) ?? null) : "il mondo non ha superato il confine di salvataggio" };
    if (mounted.current) {
      setLocation(where);
      setStatus(
        result.error
          ? { kind: "error", message: `Bundle incompleto: ${result.error}` }
          : { kind: "ok", message: where ? `Bundle esportato in ${where}` : "Bundle esportato (nessuna cartella disponibile in questa build)." }
      );
    }
    return result;
  }, [telemetry, session]);

  const submitPrediction = useCallback(
    (prediction: string, reason: string) => {
      if (!session || !prompt || !telemetry || session.beat?.focus.kind !== "event") return;
      const event = session.beat.focus.event;
      const entry: NpcPrediction = {
        characterId: prompt.characterId,
        prediction,
        reason,
        trigger: "before_reaction",
        actual: { eventId: event.id, title: event.presentation.title, callback: session.beat.focus.selection.callback }
      };
      setPredictions(current => [...current, entry]);
      void telemetry.prediction(entry, session.state);
      setPrompt(null);
    },
    [session, prompt, telemetry]
  );

  const manualPrediction = useCallback(
    (characterId: string, prediction: string, reason: string) => {
      if (!session || !telemetry) return;
      const entry: NpcPrediction = { characterId, prediction, reason, trigger: "manual", actual: null };
      setPredictions(current => [...current, entry]);
      void telemetry.prediction(entry, session.state);
    },
    [session, telemetry]
  );

  // ------------------------------------------------------------- render
  if (screen === "questionnaire" && session) {
    return (
      <FounderQuestionnaire
        sessionId={telemetry?.sessionId ?? null}
        beatsPlayed={beats}
        predictions={predictions}
        telemetry={telemetry}
        onExport={exportBundle}
        onBack={() => setScreen("play")}
      />
    );
  }

  if (!session) {
    return (
      <main className="play play--empty proof-landing">
        <h1>CHRONOSAGA</h1>
        <p className="play__subtitle">GAMEPLAY QUALITY PROOF · HELIOS REACH</p>
        <section className="proof-landing__card">
          <p>
            Stai per iniziare il <strong>Gameplay Quality Proof di Helios Reach</strong>: una sessione guidata di {SAMPLE_TARGET.min}–
            {SAMPLE_TARGET.max} momenti di gioco (Gameplay Beat), seed {PROOF_SEED}. Alcuni momenti chiedono una decisione; altri sono
            momenti di quiete in cui il mondo si muove senza di te.
          </p>
          <label className="proof-landing__toggle">
            <input type="checkbox" checked={telemetryOn} onChange={event => setTelemetryOn(event.target.checked)} />
            Registra la telemetria del playtest (resta su questo computer, nessun invio in rete)
          </label>
        </section>
        <div className="play__actions">
          <button className="play__button play__button--primary" onClick={start} disabled={ioBusy}>
            INIZIA IL PROOF
          </button>
          <button className="play__button" onClick={() => void load()} disabled={ioBusy}>
            CARICA IL PROOF
          </button>
          <button className="play__button play__button--ghost" onClick={onMenu} disabled={ioBusy}>
            MENU
          </button>
        </div>
        <StatusLine status={status} />
      </main>
    );
  }

  return (
    <main className="play proof">
      <header className="play__top">
        <div className="play__identity">
          <strong>GAMEPLAY QUALITY PROOF</strong>
          <span className="play__campaign">Helios Reach · {session.state.campaignId}</span>
        </div>
        <dl className="play__clocks">
          <div>
            <dt>TURNO GIOCATORE</dt>
            <dd>{session.state.turn}</dd>
          </div>
          <div>
            <dt>GIORNO</dt>
            <dd>{session.state.day}</dd>
          </div>
          <div>
            <dt>WORLD TICK</dt>
            <dd>{session.state.simulation?.tick ?? 0}</dd>
          </div>
        </dl>
        {onExit ? (
          <button className="play__button play__button--ghost" onClick={onExit} disabled={ioBusy}>
            DIAGNOSTICA
          </button>
        ) : null}
      </header>

      <div className="proof__grid">
        <WorldPanel state={session.state} />
        <section className="proof__center">
          <LastStep session={session} />
          {prompt ? (
            <PredictionPrompt name={firstName(session.state, prompt.characterId)} onSubmit={submitPrediction} onSkip={() => setPrompt(null)} />
          ) : (
            <FocusPanel session={session} locked={ioBusy} onChoose={choose} onPass={pass} />
          )}
        </section>
        <aside className="proof__side">
          <CharactersPanel state={session.state} />
          <FactionsPanel state={session.state} />
        </aside>
      </div>

      <footer className="play__bar">
        <button className="play__button" onClick={() => void save()} disabled={ioBusy}>
          SALVA
        </button>
        <button className="play__button" onClick={() => void load()} disabled={ioBusy}>
          CARICA
        </button>
        <button className="play__button play__button--ghost" onClick={start} disabled={ioBusy}>
          NUOVA
        </button>
        <button className="play__button play__button--ghost" onClick={toMenu} disabled={ioBusy}>
          MENU
        </button>
        <StatusLine status={status} />
      </footer>

      <PlaytestOverlay
        session={session}
        telemetry={telemetry}
        beats={beats}
        location={location}
        error={telemetryError}
        onFinish={finish}
        onExport={() => void exportBundle()}
        onPredict={manualPrediction}
      />
    </main>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return <span className="play__status" role="status" />;
  return (
    <span className={`play__status play__status--${status.kind}`} role="status">
      {status.message}
    </span>
  );
}

// ---------------------------------------------------------------- focus

function FocusPanel({
  session,
  locked,
  onChoose,
  onPass
}: {
  session: ProofSession;
  locked: boolean;
  onChoose: (choiceId: string) => void;
  onPass: () => void;
}) {
  if (session.defect) {
    return (
      <section className="panel proof-focus proof-focus--defect" aria-live="polite">
        <span className="panel__tag">IL PROOF SI FERMA QUI</span>
        <h2>Nessuna decisione disponibile</h2>
        <p className="event__body">
          Il Core segnala che a questo punto non c'è nessun evento disponibile e il mondo non ha più nulla da mostrare. È un limite
          del contenuto del proof, non una fine della partita: salva, rispondi al questionario ed esporta le prove.
        </p>
        <p className="proof-focus__technical">Codice: {session.defect.reason}</p>
      </section>
    );
  }
  const beat = session.beat!;
  if (beat.focus.kind === "quiet") {
    const developments = rankDevelopments(beat.focus.quiet.developments);
    const shown = developments.slice(0, 3);
    const rest = developments.slice(3);
    const boundAfter = session.explanation?.kind === "quiet" ? session.explanation.boundAfter : false;
    return (
      <section className="panel proof-focus proof-focus--quiet" aria-live="polite">
        <span className="panel__tag">QUIETE · NESSUNA DECISIONE</span>
        <h2>Il mondo si muove</h2>
        <p className="event__body">Nessuno ti chiede nulla in questo momento. Il turno giocatore resta fermo; il tempo, no.</p>
        <ul className="proof-developments">
          {shown.map((development, index) => (
            <li key={index}>{developmentSentence(session.state, PROOF_CATALOGUE, development)}</li>
          ))}
        </ul>
        {rest.length > 0 ? (
          <details className="proof-developments__more">
            <summary>Altri {rest.length} sviluppi</summary>
            <ul className="proof-developments">
              {rest.map((development, index) => (
                <li key={index}>{developmentSentence(session.state, PROOF_CATALOGUE, development)}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {boundAfter ? <p className="proof-focus__note">Dopo questo momento servirà una tua decisione.</p> : null}
        <button className="play__button play__button--primary proof-focus__pass" onClick={onPass} disabled={locked}>
          LASCIA PASSARE IL TEMPO
        </button>
      </section>
    );
  }

  const event = beat.focus.event;
  const explanation = session.explanation?.kind === "event" ? session.explanation : null;
  const options = describeOptions(session);
  return (
    <section className="panel proof-focus proof-focus--event" aria-live="polite">
      <span className="panel__tag">{FAMILY_LABEL[event.familyId].toUpperCase()}</span>
      <h2>{event.presentation.title}</h2>
      <WhyNow state={session.state} explanation={explanation} />
      <p className="event__body">{event.presentation.body}</p>
      <div className="proof-options">
        {options.map(({ choice, disclosure }) => (
          <article key={choice.id} className={`proof-option${disclosure.available ? "" : " proof-option--blocked"}`}>
            <h3>{choice.label}</h3>
            {disclosure.available ? (
              <>
                <OptionList title="Cosa sai" items={[...(disclosure.known ?? []).map(item => knownSentence(session.state, item)), ...disclosure.knownNotes, ...obligations(session.state, choice)]} />
                <div className="proof-option__risks">
                  <span className="proof-option__heading">Rischi</span>
                  {disclosure.risks.length ? (
                    <ul>
                      {disclosure.risks.map(risk => (
                        <li key={risk} className={`risk risk--${risk}`}>
                          {RISK_LABEL[risk]}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="proof-option__none">nessuno dichiarato</span>
                  )}
                </div>
                <OptionList title="Cosa non sai" items={disclosure.unknowns} />
              </>
            ) : (
              <p className="proof-option__none">Non disponibile ora.</p>
            )}
            <button className="choice proof-option__choose" disabled={!disclosure.available || locked} onClick={() => onChoose(choice.id)}>
              {disclosure.available ? "SCEGLI" : "NON DISPONIBILE"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function OptionList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="proof-option__list">
      <span className="proof-option__heading">{title}</span>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <span className="proof-option__none">niente di certo</span>
      )}
    </div>
  );
}

/** "Perché ora" and "come ci sei arrivato": the Core's callback and recap, in words. */
function WhyNow({ state, explanation }: { state: WorldState; explanation: EventExplanation | null }) {
  if (!explanation) return null;
  const urgent = explanation.whyNow.urgency.map(reason => {
    switch (reason.kind) {
      case "pressure":
        return `${reason.pressure === "epidemic" ? "L'epidemia" : "L'infrastruttura"} è ${STAGE_LABEL[reason.stage]}.`;
      case "supply_exhausted":
        return `${resourceLabel(reason.key)}: scorte esaurite.`;
      case "consequence_due":
        return "Una conseguenza annunciata sta per arrivare.";
    }
  });
  const lines = [
    ...(explanation.callback ? [callbackSentence(state, PROOF_CATALOGUE, explanation.callback)] : []),
    ...(explanation.whyNow.rule === "mandatory" ? ["Non può aspettare."] : []),
    ...urgent
  ];
  return (
    <div className="proof-why">
      {lines.length ? (
        <ul className="proof-why__lines">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      {explanation.recap.length ? (
        <ol className="proof-why__recap" aria-label="Come ci sei arrivato">
          {explanation.recap.map((chain, index) => (
            <li key={index}>
              Hai scelto {decisionLabel(PROOF_CATALOGUE, chain.decision)} → {chainVia(state, chain)} → questa situazione.
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** What the last beat did, in at most a few lines. */
function LastStep({ session }: { session: ProofSession }) {
  const last = session.last;
  const lines = useMemo(() => {
    if (!last) return [];
    if (last.kind === "quiet") {
      return rankDevelopments(last.outcome.developments)
        .slice(0, 2)
        .map(development => developmentSentence(session.state, PROOF_CATALOGUE, development));
    }
    return stepLines(last.before, session.state, PROOF_CATALOGUE, last.outcome.consequences.appliedIds).slice(0, 4);
  }, [last, session.state]);
  if (!last) return null;
  const title =
    last.kind === "event"
      ? `Hai scelto: «${(PROOF_CATALOGUE.find(event => event.id === last.eventId) as ProofEvent).choices.find(choice => choice.id === last.choiceId)?.label ?? last.choiceId}»`
      : "Il tempo è passato";
  return (
    <section className="proof-last" aria-label="Ultimo momento">
      <strong>{title}</strong>
      {lines.length ? (
        <ul>
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PredictionPrompt({ name, onSubmit, onSkip }: { name: string; onSubmit: (prediction: string, reason: string) => void; onSkip: () => void }) {
  const [prediction, setPrediction] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className="panel proof-focus proof-focus--prompt" aria-live="polite">
      <span className="panel__tag">PRIMA DI CONTINUARE</span>
      <h2>{name} sta per reagire a qualcosa che è già successo.</h2>
      <label className="proof-field">
        Come pensi che reagirà {name}?
        <textarea value={prediction} onChange={event => setPrediction(event.target.value)} rows={3} />
      </label>
      <label className="proof-field">
        Perché?
        <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} />
      </label>
      <div className="play__actions">
        <button className="play__button play__button--primary" onClick={() => onSubmit(prediction, reason)}>
          REGISTRA E MOSTRA
        </button>
        <button className="play__button play__button--ghost" onClick={onSkip}>
          SALTA
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- world

function WorldPanel({ state }: { state: WorldState }) {
  const settlement = state.simulation?.settlements[0];
  const pressures = readPressures(state);
  const infrastructure = pressures.infrastructure[0];
  const pending = (state.simulation?.delayedConsequences ?? []).filter(item => item.status === "pending" && item.visibility === "visible");
  return (
    <section className="panel proof-world">
      <h2>{settlement?.name ?? "Helios Reach"}</h2>
      <ul className="resources">
        {(["water", "energy", "food", "medicine"] as const).map(key => {
          const value = settlement?.resourceStock[key] ?? 0;
          const level = value <= 0 ? "danger" : value < 8 ? "warn" : "ok";
          return (
            <li key={key} className={`resource resource--${level}`}>
              <span className="resource__name">{resourceLabel(key)}</span>
              <b className="resource__value">{value.toFixed(1)}</b>
              {level !== "ok" ? <span className="resource__flag">{level === "danger" ? "esaurita" : "scarsa"}</span> : null}
            </li>
          );
        })}
        <li className="resource resource--ok">
          <span className="resource__name">{resourceLabel("credits")}</span>
          <b className="resource__value">{(state.resources.credits ?? 0).toFixed(0)}</b>
        </li>
      </ul>
      <h3 className="proof-world__heading">Pressioni</h3>
      <div className={`pressure pressure--${pressures.epidemic.stage.toLowerCase()}`}>
        <span className="pressure__name">Epidemia</span>
        <b className="pressure__stage">{STAGE_LABEL[pressures.epidemic.stage]}</b>
        {pressures.epidemic.contributors.length ? (
          <ul className="pressure__causes">
            {pressures.epidemic.contributors.slice(0, 3).map(contributor => (
              <li key={contributor.cause}>
                {capitalize(CAUSE_LABEL[contributor.cause])}
                {contributor.decision ? ` — dopo ${decisionLabel(PROOF_CATALOGUE, contributor.decision)}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {infrastructure ? (
        <div className={`pressure pressure--${infrastructure.stage.toLowerCase()}`}>
          <span className="pressure__name">Infrastruttura</span>
          <b className="pressure__stage">{STAGE_LABEL[infrastructure.stage]}</b>
          <ul className="pressure__causes">
            {(state.simulation?.productionNodes ?? []).map(node => (
              <li key={node.id}>
                {node.id === "prod_recycler_01" ? "Riciclatore" : node.id}: {percent(node.condition)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pending.length ? (
        <>
          <h3 className="proof-world__heading">In arrivo</h3>
          <ul className="proof-pending">
            {pending.map(item => {
              const [eventId = "", choiceId = ""] = item.source.id.split(":");
              const choice = PROOF_CATALOGUE.find(event => event.id === eventId)?.choices.find(candidate => candidate.id === choiceId);
              return (
                <li key={item.id}>
                  Turno {item.triggerTurn}: conseguenza di «{choice?.label ?? item.source.id}»
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function CharactersPanel({ state }: { state: WorldState }) {
  return (
    <section className="panel proof-crew">
      <h2>Le persone</h2>
      <ul className="crew">
        {state.party.map(character => {
          // Their own experience first (a first-hand memory), the newest; what
          // they only heard about otherwise. Read from the world, nothing scored.
          const firstHand = (memory: { origin?: string }) => (memory.origin === "direct" ? 1 : 0);
          const remembered = [...(character.memories ?? [])]
            .filter(memory => memory.origin !== undefined)
            .sort((a, b) => firstHand(b) - firstHand(a) || b.turn - a.turn || (b.salience ?? 0) - (a.salience ?? 0))[0];
          return (
            <li key={character.id} className="crew__member">
              <div className="crew__head">
                <strong>{character.name}</strong>
                <small>{character.role}</small>
              </div>
              {character.coreValue ? <p className="crew__value">{capitalize(VALUE_LABEL[character.coreValue])}.</p> : null}
              <div className="crew__bars">
                <div className="bar">
                  <span className="bar__label">STRESS</span>
                  <span className="bar__track">
                    <span className={`bar__fill bar__fill--${character.stress >= 60 ? "danger" : "warn"}`} style={{ width: `${Math.min(100, character.stress)}%` }} />
                  </span>
                  <span className="bar__value">{Math.round(character.stress)}</span>
                </div>
              </div>
              {remembered ? <p className="crew__memory">Ricorda: «{memorySummary(state, remembered.id) ?? remembered.summary}»</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FactionsPanel({ state }: { state: WorldState }) {
  const reading = readProofWorld(state, PROOF_CATALOGUE);
  const agenda = (state.simulation && "factionAgenda" in state.simulation ? state.simulation.factionAgenda : []) as readonly {
    id: string;
    factionId: string;
    kind: "desire" | "grievance";
    subject: string;
  }[];
  return (
    <section className="panel proof-factions">
      <h2>Fazioni</h2>
      <ul className="factions">
        {(state.simulation?.factions ?? []).map(faction => {
          const debts = factionDebtCount(state, faction.id);
          return (
            <li key={faction.id} className="faction">
              <strong>{factionLabel(state, faction.id)}</strong>
              <ul className="faction__agenda">
                {agenda
                  .filter(item => item.factionId === faction.id)
                  .map(item => (
                    <li key={item.id} className={reading.agenda[item.id] ? "agenda--settled" : "agenda--open"}>
                      {capitalize(agendaLabel(item as never))} — {agendaStatus(item, reading.agenda[item.id] ?? false)}
                    </li>
                  ))}
              </ul>
              {debts > 0 ? <p className="faction__debt">Debiti di Helios verso di loro: {debts}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- overlay

function PlaytestOverlay({
  session,
  telemetry,
  beats,
  location,
  error,
  onFinish,
  onExport,
  onPredict
}: {
  session: ProofSession;
  telemetry: Telemetry | null;
  beats: number;
  location: string | null;
  error: string | null;
  onFinish: () => void;
  onExport: () => void;
  onPredict: (characterId: string, prediction: string, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [who, setWho] = useState(session.state.party[0]?.id ?? "");
  const [prediction, setPrediction] = useState("");
  const [reason, setReason] = useState("");
  const reached = beats >= SAMPLE_TARGET.min;
  return (
    <aside className={`playtest${open ? " playtest--open" : ""}`} aria-label="Playtest">
      <button className="playtest__chip" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        PLAYTEST · beat {beats} · T{session.state.turn} · W{session.state.simulation?.tick ?? 0} · telemetria {telemetry ? (error ? "ERRORE" : "ON") : "OFF"}
      </button>
      {reached ? <p className="playtest__target">Obiettivo del campione raggiunto ({SAMPLE_TARGET.min} beat). Puoi fermarti qui o continuare fino a {SAMPLE_TARGET.max}.</p> : null}
      {open ? (
        <div className="playtest__panel">
          <dl>
            <dt>Sessione</dt>
            <dd>{telemetry?.sessionId ?? "telemetria disattivata"}</dd>
            <dt>Cartella</dt>
            <dd>{location ?? "—"}</dd>
            <dt>Build</dt>
            <dd>
              {BUILD_INFO.commit.slice(0, 12)} · {BUILD_INFO.branch}
            </dd>
            <dt>Founder gate</dt>
            <dd>{FOUNDER_GATE_STATUS}</dd>
          </dl>
          {error ? <p className="playtest__error">Telemetria: {error}</p> : null}
          <div className="playtest__actions">
            <button className="play__button" onClick={onFinish}>
              TERMINA E QUESTIONARIO
            </button>
            <button className="play__button" onClick={onExport} disabled={!telemetry}>
              ESPORTA BUNDLE
            </button>
            <button className="play__button play__button--ghost" onClick={() => setPredicting(value => !value)} disabled={!telemetry}>
              REGISTRA UNA PREVISIONE
            </button>
          </div>
          {predicting ? (
            <div className="playtest__predict">
              <label className="proof-field">
                Personaggio
                <select value={who} onChange={event => setWho(event.target.value)}>
                  {session.state.party.map(character => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="proof-field">
                Come pensi che reagirà?
                <textarea rows={2} value={prediction} onChange={event => setPrediction(event.target.value)} />
              </label>
              <label className="proof-field">
                Perché?
                <textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} />
              </label>
              <button
                className="play__button play__button--primary"
                onClick={() => {
                  onPredict(who, prediction, reason);
                  setPrediction("");
                  setReason("");
                  setPredicting(false);
                }}
              >
                REGISTRA
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
