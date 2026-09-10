// @vitest-environment jsdom
import { StrictMode, act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { SystemicPlayScreen } from "../src/components/SystemicPlayScreen";
import type { SystemicPersistence } from "../src/platform/persistence";
import type { NarrationSource } from "../src/gameplay/narration";

/**
 * Mount tests for the desktop shell and the play screen.
 *
 * These exist because three defects found by external audit were all lifecycle
 * behaviour — a component unmounted, an effect re-run, a click that replaced a
 * run — and none of them is visible from the module surface. The rest of this
 * suite tests the controller, which is where the authority lives; nothing was
 * testing whether the screen keeps hold of what the controller returns.
 *
 * React is driven directly rather than through a testing library: mounting,
 * clicking and reading text is all these need, and one dev dependency is a
 * smaller thing to justify than three.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // `isChronosagaDesktop()` reads this flag, and the desktop shell is the
  // surface under test. Without it `App` renders the legacy web screen, which
  // fetches over HTTP and would make these assertions meaningless.
  (globalThis as { isTauri?: boolean }).isTauri = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as { isTauri?: boolean }).isTauri;
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

/** The button whose label contains `text`, or a failure that names it. */
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(element =>
    (element.textContent ?? "").toUpperCase().includes(text.toUpperCase())
  );
  if (!found) {
    const available = [...container.querySelectorAll("button")].map(b => b.textContent);
    throw new Error(`no button matching "${text}". Present: ${JSON.stringify(available)}`);
  }
  return found as HTMLButtonElement;
}

/** "NUOVA CAMPAGNA" while empty, "NUOVA" once a run is on screen. */
const NEW_RUN = "NUOVA";

function click(text: string) {
  const target = button(text);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const body = () => container.textContent ?? "";

/** A persistence adapter that records calls and can be held open. */
function stubPersistence(): SystemicPersistence & {
  saves: { campaignId: string; payload: string }[];
  release: () => void;
  holdOpen: () => void;
} {
  const saves: { campaignId: string; payload: string }[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;

  return {
    saves,
    holdOpen() {
      gate = new Promise<void>(resolve => {
        open = resolve;
      });
    },
    release() {
      open?.();
      gate = null;
      open = null;
    },
    async save(campaignId: string, payload: string) {
      if (gate) await gate;
      saves.push({ campaignId, payload });
      return { campaignId, payloadBytes: payload.length };
    },
    async load(campaignId: string) {
      if (gate) await gate;
      const found = [...saves].reverse().find(entry => entry.campaignId === campaignId);
      return found ? { found: true as const, save: { payload: found.payload } } : { found: false as const };
    }
  };
}

/** Narration is not under test; keep it synchronous and silent. */
const quietNarration: NarrationSource = {
  async narrate() {
    return { narration: "" };
  }
};

describe("A03: the run survives a trip to diagnostics", () => {
  /**
   * The shell used to swap `SystemicPlayScreen` out for `DesktopP0Screen`. The
   * session lives in that component's `useState`, so the swap destroyed it and
   * coming back produced a fresh screen with no run and no explanation.
   */
  it("keeps the session, its turn and its campaign across the surface switch", () => {
    render(createElement(App));

    // The desktop shell only renders outside a browser-only build when the
    // platform check says so; if this build renders the web screen instead,
    // the test would be meaningless rather than failing quietly.
    if (!body().includes("CHRONOSAGA")) throw new Error("shell did not render");

    click(NEW_RUN);
    expect(body()).toContain("cmp_7419");
    const turnBefore = body().match(/TURNO GIOCATORE\s*(\d+)/)?.[1];

    click("WORLD TICK");
    const afterTick = body();

    click("DIAGNOSTICA");
    // Diagnostics really is on screen, so this is a genuine switch.
    expect(body()).toContain("TORNA AL GIOCO");

    click("TORNA AL GIOCO");

    // The same run, not a new one: same campaign, same clocks, same feed.
    expect(body()).toContain("cmp_7419");
    expect(body().match(/TURNO GIOCATORE\s*(\d+)/)?.[1]).toBe(turnBefore);
    expect(body().match(/WORLD TICK\s*(\d+)/)?.[1]).toBe(
      afterTick.match(/WORLD TICK\s*(\d+)/)?.[1]
    );
    // And it is not the empty state.
    expect(body()).not.toContain("Helios Reach · simulazione sistemica");
  });

  it("refuses to leave while a write is in flight", async () => {
    const persistence = stubPersistence();
    render(
      createElement(SystemicPlayScreen, {
        persistence,
        narration: quietNarration,
        onExit: () => undefined
      })
    );

    click(NEW_RUN);
    persistence.holdOpen();
    click("SALVA");

    // The lock is held: the exit is refused for the same reason a second save
    // would be.
    expect(button("DIAGNOSTICA").disabled).toBe(true);

    await act(async () => {
      persistence.release();
      await Promise.resolve();
    });
    expect(button("DIAGNOSTICA").disabled).toBe(false);
  });
});

describe("A04: the mount guard survives StrictMode", () => {
  /**
   * `useEffect(() => () => { mounted.current = false })` set the flag false in
   * cleanup and never back to true in setup. StrictMode runs setup, cleanup,
   * setup on every development mount, so after the first render the flag was
   * false for the life of the screen and every callback guarded by it was
   * discarded: save and load results, narration, the busy indicator.
   */
  it("still applies a save result after a StrictMode double mount", async () => {
    const persistence = stubPersistence();
    render(
      createElement(
        StrictMode,
        null,
        createElement(SystemicPlayScreen, { persistence, narration: quietNarration })
      )
    );

    click(NEW_RUN);
    await act(async () => {
      click("SALVA");
      await Promise.resolve();
    });

    // The receipt is rendered, which only happens if the guard let it through.
    expect(persistence.saves).toHaveLength(1);
    expect(body()).toContain("Salvato: cmp_7419");
  });

  it("still clears the busy indicator after a StrictMode double mount", async () => {
    const persistence = stubPersistence();
    render(
      createElement(
        StrictMode,
        null,
        createElement(SystemicPlayScreen, { persistence, narration: quietNarration })
      )
    );

    click(NEW_RUN);
    persistence.holdOpen();
    click("SALVA");
    expect(button("SALVA").disabled).toBe(true);

    await act(async () => {
      persistence.release();
      await Promise.resolve();
    });
    // Stuck-busy is exactly what the broken guard produced.
    expect(button("SALVA").disabled).toBe(false);
  });
});

describe("A05: replacing a run is a decision, not a click", () => {
  /**
   * There is one save slot and its key is the campaign id, derived from the
   * seed, so every run is `cmp_7419` and saving one overwrites the last. That
   * is a declared M1 simplification; what was wrong is that the screen replaced
   * a run in progress silently.
   */
  it("names the run it is about to abandon and requires a second click", () => {
    render(createElement(SystemicPlayScreen, { persistence: stubPersistence(), narration: quietNarration }));

    click(NEW_RUN);
    click("WORLD TICK");
    const tickBefore = body().match(/WORLD TICK\s*(\d+)/)?.[1];
    expect(tickBefore).not.toBe("0");

    // First click warns and changes nothing.
    click(NEW_RUN);
    expect(body()).toContain("verrà abbandonata");
    expect(body()).toContain("cmp_7419");
    expect(body().match(/WORLD TICK\s*(\d+)/)?.[1]).toBe(tickBefore);

    // Second click goes through.
    click(NEW_RUN);
    expect(body().match(/WORLD TICK\s*(\d+)/)?.[1]).toBe("0");
    expect(body()).toContain("Nuova campagna sistemica");
  });

  it("disarms when the player does something else instead", () => {
    render(createElement(SystemicPlayScreen, { persistence: stubPersistence(), narration: quietNarration }));

    click(NEW_RUN);
    click("WORLD TICK");
    click(NEW_RUN);
    expect(body()).toContain("verrà abbandonata");

    // Carrying on with the run cancels the pending discard, so a later click
    // on NUOVA CAMPAGNA warns again rather than firing immediately.
    click("WORLD TICK");
    const tick = body().match(/WORLD TICK\s*(\d+)/)?.[1];

    click(NEW_RUN);
    expect(body()).toContain("verrà abbandonata");
    expect(body().match(/WORLD TICK\s*(\d+)/)?.[1]).toBe(tick);
  });

  it("starts immediately when there is no run to lose", () => {
    render(createElement(SystemicPlayScreen, { persistence: stubPersistence(), narration: quietNarration }));

    click(NEW_RUN);
    expect(body()).toContain("Nuova campagna sistemica");
    expect(body()).not.toContain("verrà abbandonata");
  });
});
