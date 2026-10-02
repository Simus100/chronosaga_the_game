// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import { PlayRoot } from "../src/components/PlayRoot";
import type { SystemicPersistence } from "../src/platform/persistence";
import { memorySink } from "../src/playtest/telemetry";

/**
 * The proof is played in Italian (founder playtest feedback, GQP-D). English
 * comes later, as a translation. These checks catch English slipping back in:
 * common English function words, which Italian text does not contain.
 */

const ENGLISH = /\b(the|and|you|your|with|will|is|are|was|were|of|to|it|for|on|from|this|that|what|who|how)\b/i;

const english = (texts: readonly string[]) => texts.filter(text => ENGLISH.test(text));

describe("the proof speaks Italian", () => {
  it("authors every title, body, option, memory, note and open question in Italian", () => {
    const texts = GQP_PROOF_EVENTS.flatMap(event => [
      event.presentation.title,
      event.presentation.body,
      ...event.choices.flatMap(choice => [
        choice.label,
        ...choice.effects.flatMap(effect => (effect.type === "MEMORY_RECORD" ? [effect.summary] : [])),
        ...(choice.schedules ?? []).flatMap(schedule => schedule.effects.flatMap(effect => (effect.type === "MEMORY_RECORD" ? [effect.summary] : []))),
        ...(choice.disclosure.knownNotes ?? []),
        ...choice.disclosure.unknowns
      ])
    ]);
    expect(texts.length).toBeGreaterThan(200);
    expect(english(texts)).toEqual([]);
  });

  it("shows no English on screen across a run: menu, beats, people, factions, world", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const rows: Record<string, string> = {};
    const persistence: SystemicPersistence = {
      async save(campaignId, payload) {
        rows[campaignId] = payload;
        return { campaignId, envelopeVersion: 1, payloadBytes: payload.length };
      },
      async load() {
        return { status: "notFound" };
      }
    };
    act(() => root.render(createElement(PlayRoot, { persistence, sink: memorySink() })));
    const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text) as HTMLButtonElement | undefined;
    const click = (target: HTMLButtonElement) => act(() => void target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const settle = () => act(async () => {
      for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    });

    const seen: string[] = [container.textContent ?? ""];
    click(button("PROVA DI GIOCO")!);
    seen.push(container.textContent ?? "");
    click(button("INIZIA LA PROVA")!);
    await settle();
    for (let beat = 0; beat < 14; beat += 1) {
      seen.push(...[...container.querySelectorAll("main *")].map(element => element.childNodes).flatMap(nodes => [...nodes].filter(node => node.nodeType === 3).map(node => node.textContent ?? "")));
      const skip = button("SALTA");
      if (skip) {
        click(skip);
        await settle();
        continue;
      }
      const pass = button("LASCIA PASSARE IL TEMPO");
      click(pass ?? ([...container.querySelectorAll("button")].find(item => item.textContent === "SCEGLI" && !(item as HTMLButtonElement).disabled) as HTMLButtonElement));
      await settle();
    }
    // Technical codes shown on purpose (defect codes, the parenthesised
    // project name) are not prose.
    const prose = seen.map(text => text.replace(/\(Gameplay Quality Proof\)|[A-Z_]{6,}|gqp_\d+/g, "")).filter(text => text.trim().length > 0);
    expect(english(prose)).toEqual([]);
    act(() => root.unmount());
    container.remove();
  });
});
