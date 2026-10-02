// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PlayRoot } from "../src/components/PlayRoot";
import type { SystemicPersistence } from "../src/platform/persistence";
import { memorySink } from "../src/playtest/telemetry";
import { QUESTIONS } from "../src/playtest/questionnaire";

/**
 * The proof through the real screen: the menu, the EVENT and QUIET beats, save
 * and load, the playtest overlay and the founder flow -- driven by clicks.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function store(rows: Record<string, string> = {}): SystemicPersistence & { rows: Record<string, string> } {
  return {
    rows,
    async save(campaignId, payload) {
      rows[campaignId] = payload;
      return { campaignId, envelopeVersion: 1, payloadBytes: payload.length };
    },
    async load(campaignId) {
      return rows[campaignId] === undefined ? { status: "notFound" } : { status: "found", save: { campaignId, envelopeVersion: 1, payload: rows[campaignId]! } };
    }
  };
}

const body = () => container.textContent ?? "";
const buttons = () => [...container.querySelectorAll("button")] as HTMLButtonElement[];

function find(text: string): HTMLButtonElement {
  const found = buttons().find(element => (element.textContent ?? "").toUpperCase().includes(text.toUpperCase()));
  if (!found) throw new Error(`no button "${text}"; present: ${JSON.stringify(buttons().map(b => b.textContent))}`);
  return found;
}

function click(target: string | HTMLButtonElement) {
  const element = typeof target === "string" ? find(target) : target;
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function type(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const clock = (name: string) => Number(body().match(new RegExp(`${name}\\s*(\\d+)`))?.[1]);

function mount(rows: Record<string, string> = {}) {
  const persistence = store(rows);
  const sink = memorySink();
  act(() => root.render(createElement(PlayRoot, { persistence, sink })));
  return { persistence, sink };
}

async function startProof(rows: Record<string, string> = {}) {
  const mounted = mount(rows);
  click("GAMEPLAY QUALITY PROOF");
  click("INIZIA IL PROOF");
  await settle();
  return mounted;
}

/** Play one beat by the screen's own buttons; answer a prediction prompt if one appears. */
async function playBeat() {
  if (body().includes("PRIMA DI CONTINUARE")) {
    const [prediction, reason] = [...container.querySelectorAll(".proof-focus--prompt textarea")] as HTMLTextAreaElement[];
    type(prediction!, "Si arrabbierà");
    type(reason!, "Perché l'avevo ignorato");
    click("REGISTRA E MOSTRA");
  }
  const pass = buttons().find(button => button.textContent === "LASCIA PASSARE IL TEMPO");
  if (pass) click(pass);
  else click(buttons().find(button => button.textContent === "SCEGLI" && !button.disabled)!);
  await settle();
}

describe("the menu keeps the two Helios Reach explicit", () => {
  it("starts the Gameplay Quality Proof as itself, with telemetry created", async () => {
    const { sink } = mount();
    expect(body()).toContain("Gameplay Quality Proof");
    expect(body()).toContain("Baseline M1");
    click("GAMEPLAY QUALITY PROOF");
    expect(body()).toContain("Gameplay Quality Proof di Helios Reach");
    click("INIZIA IL PROOF");
    await settle();
    expect(body()).toContain("gqp_7419");
    expect(clock("TURNO GIOCATORE")).toBe(1);
    const sessions = Object.keys(sink.lines);
    expect(sessions).toHaveLength(1);
    expect(JSON.parse(sink.lines[sessions[0]!]![0]!)).toMatchObject({ type: "session_start", mode: "gameplay_quality_proof", seed: 7419 });
  });

  it("starts Baseline M1 as the accepted M1 screen", () => {
    mount();
    click("BASELINE M1");
    expect(body()).toContain("Helios Reach · simulazione sistemica");
    click("NUOVA CAMPAGNA");
    expect(body()).toContain("cmp_7419");
    expect(body()).not.toContain("GAMEPLAY QUALITY PROOF");
  });
});

describe("EVENT and QUIET on screen", () => {
  it("QUIET -> tick -> next: the world moves, the Player Turn does not, and there is nothing to choose", async () => {
    await startProof();
    expect(body()).toContain("Il mondo si muove");
    expect(buttons().some(button => button.textContent === "SCEGLI")).toBe(false);
    expect(container.querySelectorAll(".proof-developments li").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".proof-focus--quiet > .proof-developments li").length).toBeLessThanOrEqual(3);
    const [turn, tick] = [clock("TURNO GIOCATORE"), clock("WORLD TICK")];
    click("LASCIA PASSARE IL TEMPO");
    await settle();
    expect(clock("TURNO GIOCATORE")).toBe(turn);
    expect(clock("WORLD TICK")).toBe(tick + 1);
    expect(body()).toContain("Il tempo è passato");
  });

  it("EVENT -> choice -> next: KNOWN / RISK / UNKNOWN per option, then one Player Turn", async () => {
    await startProof();
    click("LASCIA PASSARE IL TEMPO");
    await settle();
    expect(buttons().some(button => button.textContent === "LASCIA PASSARE IL TEMPO")).toBe(false);
    for (const heading of ["Cosa sai", "Rischi", "Cosa non sai"]) expect(body()).toContain(heading);
    expect(body()).not.toMatch(/\{"|":/); // no JSON on screen
    const turn = clock("TURNO GIOCATORE");
    click(buttons().find(button => button.textContent === "SCEGLI")!);
    await settle();
    expect(clock("TURNO GIOCATORE")).toBe(turn + 1);
    expect(body()).toContain("Hai scelto");
  });

  it("never lets an unavailable option dispatch", async () => {
    await startProof();
    for (let beat = 0; beat < 14 && !buttons().some(button => button.textContent === "NON DISPONIBILE"); beat += 1) await playBeat();
    const blocked = buttons().find(button => button.textContent === "NON DISPONIBILE");
    if (!blocked) throw new Error("no unavailable option reached");
    expect(blocked.disabled).toBe(true);
    const turn = clock("TURNO GIOCATORE");
    click(blocked);
    await settle();
    expect(clock("TURNO GIOCATORE")).toBe(turn);
  });
});

describe("save, load, and a load that fails", () => {
  it("saves, plays on, and loads back the saved world", async () => {
    const { persistence } = await startProof();
    await playBeat();
    await playBeat();
    click("SALVA");
    await settle();
    expect(persistence.rows.gqp_7419).toBeDefined();
    const [turn, tick] = [clock("TURNO GIOCATORE"), clock("WORLD TICK")];
    await playBeat();
    click("CARICA");
    await settle();
    expect([clock("TURNO GIOCATORE"), clock("WORLD TICK")]).toEqual([turn, tick]);
    expect(body()).toContain("Proof caricato");
  });

  it("says a corrupted save is corrupted, and starts nothing", async () => {
    mount({ gqp_7419: "{ broken" });
    click("GAMEPLAY QUALITY PROOF");
    click("CARICA IL PROOF");
    await settle();
    expect(body()).toContain("Salvataggio non valido");
    expect(body()).toContain("INIZIA IL PROOF");
    expect(body()).not.toContain("TURNO GIOCATORE");
  });
});

describe("the founder flow: run, 12 beats, questionnaire, answers, export", () => {
  it("records the run, reaches the sample target, asks without showing the game, and stores only what was written", async () => {
    const { sink } = await startProof();
    for (let beat = 0; beat < 12; beat += 1) await playBeat();
    const sessionId = Object.keys(sink.lines)[0]!;
    const records = sink.lines[sessionId]!.map(line => JSON.parse(line) as { type: string });
    expect(records.filter(record => record.type === "beat")).toHaveLength(12);
    expect(records.some(record => record.type === "sample_target_reached")).toBe(true);
    expect(body()).toContain("Obiettivo del campione raggiunto");
    // Play is not blocked at the target.
    expect(buttons().some(button => button.textContent === "SCEGLI" || button.textContent === "LASCIA PASSARE IL TEMPO" || body().includes("PRIMA DI CONTINUARE"))).toBe(true);

    click(find("PLAYTEST ·"));
    click("TERMINA E QUESTIONARIO");
    await settle();

    // The questionnaire hides the game: no recap, no history, no names, no event.
    expect(body()).toContain(QUESTIONS[0]!.text);
    for (const hidden of ["Hai scelto", "Cosa sai", "Tarek", "Sela", "Mara", "Brann", "Ira ", "TURNO GIOCATORE", "Il mondo si muove"]) {
      expect(body()).not.toContain(hidden);
    }
    expect(QUESTIONS.slice(0, 3).map(question => question.id)).toEqual(["causal_recall", "characters_remembered", "characters_described"]);

    const fields = [...container.querySelectorAll(".questionnaire textarea")] as HTMLTextAreaElement[];
    type(fields[0]!, "La Lega ha riscosso il debito perché avevo preso la sua acqua.");
    click("SALVA LE RISPOSTE");
    await settle();
    expect(body()).toContain("Risposte salvate");

    const answers = JSON.parse(sink.files[`${sessionId}/founder_answers.json`]!);
    expect(answers.answers.causal_recall).toBe("La Lega ha riscosso il debito perché avevo preso la sua acqua.");
    expect(answers.founderGate).toBe("PENDING HUMAN PLAYTEST");
    expect(JSON.stringify(answers)).not.toMatch(/"(score|pass|passed|verdict)"/i);
    expect(sink.files[`${sessionId}/founder_answers.md`]).toContain("La Lega ha riscosso il debito");

    click("ESPORTA BUNDLE");
    await settle();
    for (const file of ["final_save.json", "summary.json", "build.json", "founder_answers.json", "founder_answers.md"]) {
      expect(sink.files[`${sessionId}/${file}`], file).toBeDefined();
    }
    expect(JSON.parse(sink.files[`${sessionId}/summary.json`]!)).toMatchObject({ questionnaireCompleted: true, founderGate: "PENDING HUMAN PLAYTEST", sampleTarget: { reached: true } });
  });
});

describe("an export that loses a write says so", () => {
  it("never reports a bundle as exported when one of its files failed to write", async () => {
    const persistence = store();
    const sink = memorySink();
    const write = sink.write.bind(sink);
    sink.write = async (sessionId, file, content) => {
      if (file === "final_save.json") throw new Error("disco pieno");
      return write(sessionId, file, content);
    };
    act(() => root.render(createElement(PlayRoot, { persistence, sink })));
    click("GAMEPLAY QUALITY PROOF");
    click("INIZIA IL PROOF");
    await settle();
    await playBeat();
    click(find("PLAYTEST ·"));
    click("TERMINA E QUESTIONARIO"); // fewer than 12 beats: armed
    click("TERMINA E QUESTIONARIO"); // confirmed
    await settle();
    click("SALVA LE RISPOSTE");
    await settle();
    expect(body()).toContain("Risposte salvate");
    click("ESPORTA BUNDLE");
    await settle();
    expect(body()).toContain("Export incompleto");
    expect(body()).toContain("disco pieno");
    expect(body()).not.toContain("Bundle esportato");
  });
});

describe("React renders and dispatches; it never plays the game itself", () => {
  it("the proof screen and its presentation call no Core mutator and write no world field", () => {
    for (const file of ["../src/components/ProofPlayScreen.tsx", "../src/gameplay/proof-presentation.ts", "../src/components/PlayRoot.tsx", "../src/components/FounderQuestionnaire.tsx"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      for (const forbidden of ["beginProofBeat(", "completeProofBeat(", "selectProofFocus(", "resolveProofChoice(", "runWorldTick(", "applyDueConsequences(", "createGqpScenario(", "applyEventEffect(", "resolveChoice("]) {
        expect(source, `${file} calls ${forbidden}`).not.toContain(forbidden);
      }
      const writes = source
        .split("\n")
        .map(line => line.trim())
        .filter(line => /\b(state|simulation)\.[A-Za-z.]+(\[[^\]]+\])?\s*=[^=>]/.test(line) && !line.startsWith("//") && !line.startsWith("*"));
      expect(writes, `${file} assigns into the world`).toEqual([]);
    }
  });
});
