import { useState } from "react";
import { BUILD_INFO } from "../playtest/build-info";
import { QUESTIONS, answersMarkdown, founderAnswers, type Answers } from "../playtest/questionnaire";
import { FOUNDER_GATE_STATUS, type NpcPrediction, type Telemetry } from "../playtest/telemetry";
import type { ExportResult } from "./ProofPlayScreen";

/**
 * The end-of-run questionnaire (GQP spec 20).
 *
 * This screen replaces the game entirely: no recap, no history, no character
 * list, no telemetry is on it, so causal recall and character recall are
 * answered from memory. It stores what the founder writes and nothing else --
 * no score, no inference, no PASS. The founder gate stays PENDING HUMAN.
 */
export function FounderQuestionnaire({
  sessionId,
  beatsPlayed,
  predictions,
  telemetry,
  onExport,
  onBack
}: {
  sessionId: string | null;
  beatsPlayed: number;
  predictions: readonly NpcPrediction[];
  telemetry: Telemetry | null;
  onExport: () => Promise<ExportResult | null>;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const set = (id: string, value: string) => setAnswers(current => ({ ...current, [id]: value }));

  const store = async () => {
    if (!telemetry || !sessionId) {
      setSaved({ ok: false, message: "La telemetria è disattivata: le risposte non possono essere salvate su disco in questa sessione." });
      return;
    }
    setBusy(true);
    // Only a failure of these writes means the answers were not stored.
    const before = telemetry.errors.length;
    const record = founderAnswers({ sessionId, build: BUILD_INFO, completedAt: new Date().toISOString(), beatsPlayed, answers, predictions });
    await telemetry.writeFile("founder_answers.json", JSON.stringify(record, null, 2));
    await telemetry.writeFile("founder_answers.md", answersMarkdown(record));
    await telemetry.questionnaire(true);
    await telemetry.flush();
    setBusy(false);
    const failed = telemetry.errors.slice(before);
    setSaved(
      failed.length
        ? { ok: false, message: `Salvataggio delle risposte non riuscito: ${failed.at(-1)}` }
        : { ok: true, message: "Risposte salvate." }
    );
  };

  const exportBundle = async () => {
    setBusy(true);
    const result = await onExport();
    setBusy(false);
    if (!result) {
      setSaved({ ok: false, message: "Nessuna sessione di telemetria: niente da esportare." });
      return;
    }
    setSaved(
      result.error
        ? { ok: true, message: `Export incompleto: ${result.error}. Le risposte restano salvate; riprova.` }
        : { ok: true, message: result.where ? `Bundle esportato in ${result.where}` : "Bundle esportato." }
    );
    setExportFailed(result.error !== null);
  };

  let section = "";
  return (
    <main className="play questionnaire">
      <header className="questionnaire__head">
        <h1>Fine della sessione</h1>
        <p>
          Rispondi senza guardare il gioco: la partita è nascosta apposta. Scrivi con parole tue, anche frasi brevi. Non ci sono
          risposte giuste.
        </p>
      </header>
      <form className="questionnaire__form" onSubmit={event => event.preventDefault()}>
        {QUESTIONS.map(question => {
          const heading = question.section !== section ? question.section : null;
          section = question.section;
          return (
            <fieldset key={question.id} className="questionnaire__question">
              {heading ? <legend>{heading}</legend> : null}
              <label className="proof-field">
                {question.text}
                {question.kind === "yes_no" ? (
                  <select value={answers[question.id] ?? ""} onChange={event => set(question.id, event.target.value)}>
                    <option value="">—</option>
                    <option value="sì">Sì</option>
                    <option value="no">No</option>
                    <option value="non so">Non so</option>
                  </select>
                ) : (
                  <textarea rows={4} value={answers[question.id] ?? ""} onChange={event => set(question.id, event.target.value)} />
                )}
              </label>
              {question.followUp ? (
                <label className="proof-field">
                  {question.followUp.text}
                  <textarea rows={3} value={answers[question.followUp.id] ?? ""} onChange={event => set(question.followUp!.id, event.target.value)} />
                </label>
              ) : null}
            </fieldset>
          );
        })}
      </form>
      <footer className="play__bar">
        <button className="play__button play__button--primary" onClick={() => void store()} disabled={busy}>
          SALVA LE RISPOSTE
        </button>
        <button className="play__button" onClick={() => void exportBundle()} disabled={busy || !saved?.ok}>
          ESPORTA BUNDLE
        </button>
        <button className="play__button play__button--ghost" onClick={onBack} disabled={busy}>
          TORNA AL GIOCO
        </button>
        <span className="play__status">Founder gate: {FOUNDER_GATE_STATUS}</span>
        {saved ? (
          <span className={`play__status play__status--${saved.ok && !exportFailed ? "ok" : "error"}`} role="status">
            {saved.message}
          </span>
        ) : null}
      </footer>
    </main>
  );
}
