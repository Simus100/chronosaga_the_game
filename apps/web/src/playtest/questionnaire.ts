import type { BuildInfo } from "./build-info";
import { FOUNDER_GATE_STATUS, type NpcPrediction } from "./telemetry";

/**
 * The founder questionnaire (GQP spec 20), asked at the end of the run.
 *
 * The software asks and stores. It never answers, never scores, never infers
 * an answer from telemetry, and never turns the founder gate into a PASS: the
 * gate stays `PENDING HUMAN PLAYTEST` until a human reads these answers.
 *
 * Order matters. Causal recall and character recall come first and are asked
 * on a screen that shows no history, no recap, no character list and no
 * telemetry, so the answers reflect what the founder remembers from play.
 */

export type QuestionKind = "text" | "yes_no";

export interface Question {
  readonly id: string;
  readonly section: string;
  readonly text: string;
  readonly kind: QuestionKind;
  /** A follow-up shown with the question, answered in words. */
  readonly followUp?: { readonly id: string; readonly text: string };
  /** Critical criteria (spec 20.1–20.2) versus strong positive signals (20.3). */
  readonly weight: "critical" | "signal" | "note";
}

export const QUESTIONS: readonly Question[] = [
  {
    id: "causal_recall",
    section: "Richiamo causale",
    text: "Senza guardare la cronologia, quali situazioni avvenute verso la fine pensi siano state causate da decisioni precedenti? Indicane almeno due e spiega quali decisioni.",
    kind: "text",
    weight: "critical"
  },
  {
    id: "characters_remembered",
    section: "Personaggi",
    text: "Quali personaggi ricordi?",
    kind: "text",
    weight: "critical"
  },
  {
    id: "characters_described",
    section: "Personaggi",
    text: "Descrivili con ciò che ricordi di loro.",
    kind: "text",
    weight: "critical"
  },
  {
    id: "desire_to_continue",
    section: "Desiderio di continuare",
    text: "C'è almeno una situazione per cui vorresti giocare ancora per vedere cosa succede?",
    kind: "yes_no",
    followUp: { id: "desire_to_continue_which", text: "Quale?" },
    weight: "critical"
  },
  {
    id: "strategy_change",
    section: "Cambio di strategia",
    text: "Durante la run hai cambiato intenzionalmente strategia perché il mondo ha reagito a qualcosa che avevi fatto?",
    kind: "yes_no",
    followUp: { id: "strategy_change_example", text: "Se sì: quando e perché? Un esempio concreto." },
    weight: "critical"
  },
  {
    id: "fair_uncertainty",
    section: "Incertezza equa",
    text: "C'è stato un risultato negativo importante che ti è sembrato arrivare senza alcun avvertimento ragionevole?",
    kind: "yes_no",
    followUp: { id: "fair_uncertainty_which", text: "Se sì: quale?" },
    weight: "critical"
  },
  {
    id: "signal_regret",
    section: "Altri segnali (facoltativi)",
    text: "C'è una scelta che rimpiangi? Quale, e perché?",
    kind: "text",
    weight: "signal"
  },
  {
    id: "signal_surprise",
    section: "Altri segnali (facoltativi)",
    text: "Qualcosa ti ha sorpreso ma, ripensandoci, aveva senso? Cosa?",
    kind: "text",
    weight: "signal"
  },
  {
    id: "signal_attachment",
    section: "Altri segnali (facoltativi)",
    text: "C'è un personaggio che non vorresti perdere, o che saresti contento di veder andare via? Chi, e perché?",
    kind: "text",
    weight: "signal"
  },
  {
    id: "signal_story",
    section: "Altri segnali (facoltativi)",
    text: "Racconta con parole tue la storia di questa run.",
    kind: "text",
    weight: "signal"
  },
  {
    id: "signal_replay",
    section: "Altri segnali (facoltativi)",
    text: "Se la rigiocassi, proveresti una strategia diversa? Quale?",
    kind: "text",
    weight: "signal"
  },
  {
    id: "notes",
    section: "Note",
    text: "Altro: problemi, confusione, cose che non hai capito.",
    kind: "text",
    weight: "note"
  }
];

export type Answers = Readonly<Record<string, string>>;

export interface FounderAnswers {
  readonly schema: "chronosaga.playtest.founder-answers/1";
  readonly sessionId: string;
  readonly build: BuildInfo;
  readonly completedAt: string;
  readonly beatsPlayed: number;
  readonly answers: Answers;
  readonly predictions: readonly NpcPrediction[];
  readonly founderGate: typeof FOUNDER_GATE_STATUS;
  readonly note: string;
}

export function founderAnswers(input: {
  readonly sessionId: string;
  readonly build: BuildInfo;
  readonly completedAt: string;
  readonly beatsPlayed: number;
  readonly answers: Answers;
  readonly predictions: readonly NpcPrediction[];
}): FounderAnswers {
  return {
    schema: "chronosaga.playtest.founder-answers/1",
    ...input,
    answers: { ...input.answers },
    predictions: [...input.predictions],
    founderGate: FOUNDER_GATE_STATUS,
    note: "Risposte del founder, non valutate dal software. Il founder gate resta da decidere da una persona."
  };
}

/** The same answers, readable as a document. */
export function answersMarkdown(answers: FounderAnswers): string {
  const lines = [
    "# Founder playtest — risposte",
    "",
    `- Sessione: \`${answers.sessionId}\``,
    `- Build: \`${answers.build.commit}\` (${answers.build.branch}, ${answers.build.builtAt})`,
    `- Completato: ${answers.completedAt}`,
    `- Gameplay Beat giocati: ${answers.beatsPlayed}`,
    `- Founder gate: **${answers.founderGate}**`,
    "",
    `> ${answers.note}`,
    ""
  ];
  let section = "";
  for (const question of QUESTIONS) {
    if (question.section !== section) {
      section = question.section;
      lines.push(`## ${section}`, "");
    }
    lines.push(`**${question.text}**`, "", answers.answers[question.id]?.trim() || "_(nessuna risposta)_", "");
    if (question.followUp) {
      lines.push(`*${question.followUp.text}*`, "", answers.answers[question.followUp.id]?.trim() || "_(nessuna risposta)_", "");
    }
  }
  lines.push("## Previsioni sui personaggi (raccolte durante la run)", "");
  if (answers.predictions.length === 0) lines.push("_(nessuna previsione registrata)_", "");
  for (const [index, prediction] of answers.predictions.entries()) {
    lines.push(
      `### ${index + 1}. ${prediction.characterId}`,
      "",
      `- Previsione: ${prediction.prediction.trim() || "_(vuota)_"}`,
      `- Perché: ${prediction.reason.trim() || "_(vuoto)_"}`,
      `- Reazione effettiva: ${prediction.actual ? `evento \`${prediction.actual.eventId}\` — «${prediction.actual.title}»` : "_(da ricostruire dalla telemetria)_"}`,
      ""
    );
  }
  return lines.join("\n");
}
