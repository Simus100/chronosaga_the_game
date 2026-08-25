import { describe, expect, it, vi } from "vitest";
import type { WorldState } from "@paa/game-types";
import { createSystemicScenario, runWorldTick } from "@paa/game-core";
import {
  choiceAvailable,
  currentEvent,
  loadGame,
  newSystemicGame,
  playChoice,
  playWorldTick,
  saveGame,
  PLAYABLE_EVENTS,
  type GameplaySession
} from "../src/gameplay/controller";
import {
  localAiNarration,
  proceduralNarration,
  narrateEntry
} from "../src/gameplay/narration";
import type { SystemicPersistence, SystemicStored } from "../src/platform/persistence";
import { createPersistenceLock } from "../src/gameplay/persistence-lock";

/**
 * The playable loop, tested through the actions the screen dispatches.
 *
 * Nothing here mocks the simulation: every assertion runs the real game-core.
 * The only thing replaced is the store, because SQLite lives in Rust and this
 * is where the contract between the two is checked.
 */

/** A store that keeps payloads in memory, and can be told to misbehave. */
function fakeStore(initial: Record<string, string> = {}): SystemicPersistence & {
  rows: Record<string, string>;
  envelopeVersion: number;
  failOnSave: boolean;
} {
  const store = {
    rows: { ...initial },
    envelopeVersion: 1,
    failOnSave: false,
    async save(campaignId: string, payload: string) {
      if (store.failOnSave) throw new Error("disk is full");
      store.rows[campaignId] = payload;
      return { campaignId, envelopeVersion: 1, payloadBytes: payload.length };
    },
    async load(campaignId: string): Promise<SystemicStored> {
      const payload = store.rows[campaignId];
      if (payload === undefined) return { status: "notFound" };
      if (store.envelopeVersion !== 1) {
        return {
          status: "incompatibleEnvelope",
          storedVersion: store.envelopeVersion,
          supportedVersion: 1
        };
      }
      return { status: "found", save: { campaignId, envelopeVersion: 1, payload } };
    }
  };
  return store;
}

/** The first choice this session can actually take. */
function firstAvailable(session: GameplaySession): string {
  const choice = session.event.choices.find(candidate =>
    choiceAvailable(session.state, session.event, candidate.id)
  );
  if (!choice) throw new Error("no available choice");
  return choice.id;
}

describe("1: a new systemic game comes from the core", () => {
  it("is the scenario the core builds, not something assembled here", () => {
    const session = newSystemicGame();
    expect(session.state).toEqual(createSystemicScenario(7419));
    expect(session.state.simulation!.settlements).toHaveLength(1);
    expect(session.state.party.length).toBeGreaterThanOrEqual(5);
    expect(session.state.simulation!.factions).toHaveLength(2);
    expect(session.feed).toEqual([]);
    expect(session.event).toBeDefined();
  });
});

describe("2, 6: a choice goes through resolveChoice and its delta is visible", () => {
  it("changes the authoritative stock and reports what changed", () => {
    const session = newSystemicGame();
    const water = session.state.simulation!.settlements[0]!.resourceStock.water!;

    const next = playChoice(session, "release_reserve");

    expect(next.state.simulation!.settlements[0]!.resourceStock.water).toBe(water - 4);
    // The presentation layer receives the delta rather than computing one.
    const entry = next.feed.find(item => item.kind === "choice")!;
    expect(entry).toBeDefined();
    expect(entry.delta.changes.some(change => String(change.key).includes("resourceStock.water"))).toBe(true);
  });

  it("a Player Turn advances exactly once", () => {
    const session = newSystemicGame();
    const next = playChoice(session, "hold_reserve");
    expect(next.state.turn).toBe(session.state.turn + 1);
    expect(next.state.simulation!.tick).toBe(session.state.simulation!.tick);
  });

  it("a choice whose requirements fail is refused, not silently applied", () => {
    const session = newSystemicGame();
    const starved = structuredClone(session.state);
    starved.simulation!.settlements[0]!.resourceStock.water = 1;
    const poor: GameplaySession = { ...session, state: starved };

    expect(choiceAvailable(poor.state, poor.event, "release_reserve")).toBe(false);
    expect(() => playChoice(poor, "release_reserve")).toThrow(/requirements/);
  });
});

describe("3, 7: a World Tick goes through runWorldTick and its result is visible", () => {
  it("advances the tick and not the Player Turn", () => {
    const session = newSystemicGame();
    const next = playWorldTick(session);

    expect(next.state.simulation!.tick).toBe(1);
    expect(next.state.turn).toBe(session.state.turn);
    expect(next.state).toEqual(runWorldTick(session.state).state);
  });

  it("the consequence reaches the feed", () => {
    const next = playWorldTick(newSystemicGame());
    const entry = next.feed.find(item => item.kind === "world_tick")!;
    expect(entry.label).toContain("World Tick 1");
    expect(entry.delta.changes.length).toBeGreaterThan(0);
  });
});

describe("4: React has no path to mutate the world", () => {
  it("the screen imports no core mutator and writes no state field", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../src/components/SystemicPlayScreen.tsx", import.meta.url)),
      "utf8"
    );

    // The component may read the world — it has to, in order to draw it — and
    // dispatch actions. What it may not do is assign into the world, or reach
    // past the controller for a mutator.
    for (const forbidden of [
      "runWorldTick(",
      "resolveChoice(",
      "applyDueConsequences(",
      "createSystemicScenario("
    ]) {
      expect(source, `the screen calls ${forbidden}`).not.toContain(forbidden);
    }

    // No assignment into any authoritative field. Reads like
    // `settlement.resourceStock[key]` are how the panel renders and are fine;
    // an assignment is what would create a second truth. Checked line by line
    // so the rule reads as what it forbids rather than as a regex.
    const writes = source
      .split("\n")
      .map(line => line.trim())
      .filter(line => {
        const assignment = line.indexOf("=");
        if (assignment < 0) return false;
        // Skip comparisons, arrows, JSX props and const/let declarations.
        if (["=", ">", "<", "!"].includes(line[assignment + 1] ?? "")) return false;
        if (line.startsWith("const ") || line.startsWith("let ")) return false;
        const target = line.slice(0, assignment);
        return (
          target.includes("resourceStock") ||
          target.includes("state.") ||
          target.includes(".turn") ||
          target.includes(".tick") ||
          target.includes(".resources")
        );
      });
    expect(writes, `the screen assigns into the world: ${writes.join(" | ")}`).toEqual([]);
  });

  it("the controller is the only thing that calls the core mutators", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const controller = readFileSync(
      fileURLToPath(new URL("../src/gameplay/controller.ts", import.meta.url)),
      "utf8"
    );
    for (const required of ["resolveChoice", "runWorldTick", "applyDueConsequences", "selectEvent", "canChoose"]) {
      expect(controller).toContain(required);
    }
    // And it computes nothing itself: no arithmetic on a resource.
    expect(controller).not.toContain("resourceStock[");
  });
});

describe("5: eligibility is re-evaluated after every authoritative action", () => {
  it("the event is derived from the state, never remembered", () => {
    const session = newSystemicGame();
    const afterChoice = playChoice(session, "hold_reserve");
    expect(afterChoice.event).toEqual(currentEvent(afterChoice.state));

    const afterTick = playWorldTick(afterChoice);
    expect(afterTick.event).toEqual(currentEvent(afterTick.state));
  });

  it("a flag set by a choice changes which events are eligible", () => {
    // `evt_recycler_maintenance` requires `recycler_serviced` to be unset.
    const session = newSystemicGame();
    const before = PLAYABLE_EVENTS.filter(event =>
      event.requirements?.flagsNone?.includes("recycler_serviced")
    );
    expect(before.length).toBeGreaterThan(0);

    const serviced = structuredClone(session.state);
    serviced.flags.recycler_serviced = true;
    expect(currentEvent(serviced).id).not.toBe("evt_recycler_maintenance");
  });
});

describe("8, 9: persistence uses the safe boundary in both directions", () => {
  it("the save derives its campaign id from the validated state", async () => {
    const store = fakeStore();
    const session = newSystemicGame();

    const outcome = await saveGame(session.state, store);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.campaignId).toBe(session.state.campaignId);
    expect(store.rows[session.state.campaignId]).toBeDefined();
    // What was stored is the world, byte for byte.
    expect(JSON.parse(store.rows[session.state.campaignId]!)).toEqual(session.state);
  });

  it("an invalid world is refused before it reaches the store", async () => {
    const store = fakeStore();
    const broken = structuredClone(newSystemicGame().state) as unknown as Record<string, any>;
    broken.simulation.settlements[0].resourceStock.water = "10";

    const outcome = await saveGame(broken as WorldState, store);
    expect(outcome.ok).toBe(false);
    expect(Object.keys(store.rows)).toHaveLength(0);
  });

  it("a store failure keeps the in-memory world and reports the problem", async () => {
    const store = fakeStore();
    store.failOnSave = true;
    const session = newSystemicGame();

    const outcome = await saveGame(session.state, store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("disk is full");
    expect(session.state).toEqual(createSystemicScenario(7419));
  });

  it("a successful load validates under the requested campaign id", async () => {
    const store = fakeStore();
    const played = playWorldTick(playChoice(newSystemicGame(), "hold_reserve"));
    await saveGame(played.state, store);

    const outcome = await loadGame(played.state.campaignId, store);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.state).toEqual(played.state);
  });

  it("a row filed under one campaign cannot return another's world", async () => {
    const store = fakeStore();
    const session = newSystemicGame();
    await saveGame(session.state, store);
    // File the same bytes under a different key, as a corrupted store might.
    store.rows.someone_else = store.rows[session.state.campaignId]!;

    const outcome = await loadGame("someone_else", store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("corrupted");
  });
});

describe("10, 11, 12: every load failure is its own situation", () => {
  it("nothing saved is not corruption", async () => {
    const outcome = await loadGame("cmp_7419", fakeStore());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not_found");
  });

  it("a corrupted save never becomes a fresh campaign", async () => {
    for (const payload of ["{", "{}", '{"campaignId":"cmp_7419"}']) {
      const store = fakeStore({ cmp_7419: payload });
      const outcome = await loadGame("cmp_7419", store);
      expect(outcome.ok, `accepted ${payload}`).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe("corrupted");
        // There is no state on a failure, so nothing can be mistaken for one.
        expect(outcome).not.toHaveProperty("session");
      }
      // And the damaged bytes are still there, not overwritten.
      expect(store.rows.cmp_7419).toBe(payload);
    }
  });

  it("an unsupported envelope is told apart from a broken world", async () => {
    const store = fakeStore();
    const session = newSystemicGame();
    await saveGame(session.state, store);
    store.envelopeVersion = 99;

    const outcome = await loadGame(session.state.campaignId, store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("incompatible_envelope");
      expect(outcome.message).toContain("99");
    }
  });

  it("a transport failure is neither of the above", async () => {
    const broken: SystemicPersistence = {
      async save() { throw new Error("no"); },
      async load() { throw new Error("database is locked"); }
    };
    const outcome = await loadGame("cmp_7419", broken);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("transport_error");
      expect(outcome.message).toContain("database is locked");
    }
  });
});

describe("13: narration is presentation and cannot enter the world", () => {
  it("the narrator is given no way to return state", async () => {
    const session = playChoice(newSystemicGame(), "hold_reserve");
    const before = structuredClone(session.state);

    const text = await narrateEntry(proceduralNarration, session.state, session.feed[0]!);

    expect(typeof text).toBe("string");
    expect(session.state).toEqual(before);
  });

  it("narration never reaches the save payload", async () => {
    const store = fakeStore();
    const session = playChoice(newSystemicGame(), "release_reserve");
    const narrated = await narrateEntry(proceduralNarration, session.state, session.feed[0]!);
    expect(narrated.length).toBeGreaterThan(0);

    await saveGame(session.state, store);
    const stored = store.rows[session.state.campaignId]!;
    expect(stored).not.toContain(narrated);
    expect(stored).not.toContain("narration");
    // Nor does the feed, which is presentation and lives outside the world.
    expect(stored).not.toContain("feed_");
  });

  it("the AI profile preference is not part of the world", () => {
    const state = newSystemicGame().state as unknown as Record<string, unknown>;
    for (const key of Object.keys(state)) {
      expect(/aiProfile|preferredProfile|localAi|narration/i.test(key)).toBe(false);
    }
  });
});

describe("14: AI and Safe mode produce the same authoritative world", () => {
  /** Play the same script, with whichever narrator. */
  async function script(narration: { narrate: (r: any) => Promise<string> }): Promise<WorldState> {
    let session = newSystemicGame();
    const steps = [
      () => { session = playChoice(session, firstAvailable(session)); },
      () => { session = playWorldTick(session); },
      () => { session = playWorldTick(session); },
      () => { session = playChoice(session, firstAvailable(session)); },
      () => { session = playWorldTick(session); }
    ];
    for (const step of steps) {
      step();
      // Narration runs after the authoritative result, exactly as the screen
      // does it, and its answer is thrown away here.
      await narration.narrate({ state: session.state, delta: session.feed[0]!.delta, label: "x" });
    }
    return session.state;
  }

  it("identical actions give an identical world, whatever narrated them", async () => {
    // The AI adapter is mocked at the narration boundary only. The simulation
    // is the real one in both runs.
    const model = localAiNarration(async () => "Una voce descrive la scena in modo diverso.");
    const withAi = await script(model);
    const safe = await script(proceduralNarration);

    expect(withAi).toEqual(safe);
  });

  it("a model that fails, stalls or refuses never blocks the loop", async () => {
    vi.useFakeTimers();
    try {
      const failing = localAiNarration(async () => { throw new Error("runtime down"); });
      const refusing = localAiNarration(async () => null);

      const session = playChoice(newSystemicGame(), "hold_reserve");
      const request = { state: session.state, delta: session.feed[0]!.delta, label: "Scelta" };

      // Both answer immediately with the deterministic line.
      await expect(failing.narrate(request)).resolves.toContain("Scelta");
      await expect(refusing.narrate(request)).resolves.toContain("Scelta");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a model that never answers is bounded by a timeout, not by the player", async () => {
    vi.useFakeTimers();
    try {
      const hanging = localAiNarration(() => new Promise<string>(() => {}), 1_000);
      const session = playChoice(newSystemicGame(), "hold_reserve");
      const pending = hanging.narrate({
        state: session.state,
        delta: session.feed[0]!.delta,
        label: "Scelta"
      });
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(pending).resolves.toContain("Scelta");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("15, 16: Safe mode plays the whole loop, and a loaded world continues", () => {
  it("the entire sequence runs with no AI anywhere", async () => {
    const store = fakeStore();
    let session = newSystemicGame();

    session = playChoice(session, firstAvailable(session));
    session = playWorldTick(session);
    const saved = await saveGame(session.state, store);
    expect(saved.ok).toBe(true);

    const reloaded = await loadGame(session.state.campaignId, store);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    // And play continues from the loaded world.
    let continued = playChoice(reloaded.session, firstAvailable(reloaded.session));
    continued = playWorldTick(continued);

    expect(continued.state.turn).toBe(session.state.turn + 1);
    expect(continued.state.simulation!.tick).toBe(session.state.simulation!.tick + 1);
  });

  it("a loaded world continues identically to one that was never stored", async () => {
    const store = fakeStore();
    const original = playWorldTick(playChoice(newSystemicGame(), "hold_reserve"));
    await saveGame(original.state, store);

    const reloaded = await loadGame(original.state.campaignId, store);
    if (!reloaded.ok) throw new Error("load failed");

    const advance = (from: GameplaySession): WorldState => {
      let session = playChoice(from, firstAvailable(from));
      session = playWorldTick(session);
      return session.state;
    };

    expect(advance(reloaded.session)).toEqual(advance(original));
  });
});

describe("the causal chain a player is meant to see", () => {
  it("choice, then tick, then a world that reacted to the choice", async () => {
    // The whole point of the slice: spending the settlement's water has to
    // change what the simulation does next, or the player is pressing buttons.
    const spent = playChoice(newSystemicGame(), "release_reserve");
    const untouched = playChoice(newSystemicGame(), "hold_reserve");

    const afterSpent = playWorldTick(spent);
    const afterUntouched = playWorldTick(untouched);

    const water = (session: GameplaySession) =>
      session.state.simulation!.settlements[0]!.resourceStock.water!;
    expect(water(afterSpent)).toBeLessThan(water(afterUntouched));

    // And the world answered, not just the number.
    const reactions = afterSpent.feed[0]!.delta.changes.map(change => change.type);
    expect(reactions).toContain("populationConsumption");
    expect(reactions.some(type => type === "cohortSatisfaction" || type === "settlementSatisfaction")).toBe(true);
  });
});

describe("17, 18: P0 keeps working beside the new surface", () => {
  /** Reads a repository file relative to this test. */
  async function readSource(relative: string): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  }

  it("17: the diagnostics screen is still mounted and still reachable", async () => {
    const shell = await readSource("../src/App.tsx");
    // The P0 screen proved the runtime, the database and local AI. It is not
    // replaced by the playable surface; it moves behind a switch.
    expect(shell).toContain("DesktopP0Screen");
    expect(shell).toContain("SystemicPlayScreen");
    expect(shell).toContain('"diagnostics"');
    // And the switch works in both directions, or one surface becomes a trap.
    expect(shell).toContain('setSurface("play")');
    expect(shell).toContain('setSurface("diagnostics")');

    const p0 = await readSource("../src/components/DesktopP0Screen.tsx");
    expect(p0.length).toBeGreaterThan(0);
  });

  it("18: the P0 smoke save path is untouched by systemic persistence", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const rust = readFileSync(
      fileURLToPath(new URL("../../desktop/src-tauri/src/main.rs", import.meta.url)),
      "utf8"
    );

    // Both command pairs stay registered: the new save must not have taken the
    // old one's place, because an existing P0 campaign still has to load.
    for (const command of [
      "save_smoke_campaign",
      "load_smoke_campaign",
      concat_save(),
      "load_systemic_campaign"
    ]) {
      expect(rust, `${command} is not registered`).toContain(command);
    }

    // Separate tables, separate schema versions: one migration cannot silently
    // reinterpret the other's rows.
    expect(rust).toContain("campaign_systemic");
    expect(rust).toContain("SMOKE_SAVE_SCHEMA_VERSION");
    expect(rust).toContain("SYSTEMIC_ENVELOPE_VERSION");
  });
});

/** Built at runtime so this file does not match its own source scan. */
function concat_save(): string {
  return "save_" + "systemic_campaign";
}

describe("P2: persistence and gameplay cannot overlap", () => {
  /**
   * The race this closes is not hypothetical. Without the lock:
   *
   *   save reads S1 -> player takes a turn producing S2 -> the write of S1
   *   completes -> the screen says "saved" while the disk holds S1
   *
   * and the mirror case, where a load in flight replaces a session that has
   * moved on since. Both are prevented the same way: the action cannot run.
   */

  /** A promise the test decides when to settle. */
  function deferred<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>(resolve => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it("1: while a save is pending, another save cannot start", async () => {
    const lock = createPersistenceLock();
    const first = deferred<string>();
    let secondRan = false;

    const running = lock.exclusive(() => first.promise);
    expect(lock.busy).toBe(true);

    const refused = await lock.exclusive(async () => {
      secondRan = true;
      return "second";
    });

    expect(refused.ran).toBe(false);
    expect(secondRan).toBe(false);

    first.settle("first");
    await running;
    expect(lock.busy).toBe(false);
  });

  it("2: while a save is pending, choice/tick/new/load cannot alter the session", async () => {
    const lock = createPersistenceLock();
    const pending = deferred<void>();
    const session = newSystemicGame();
    let current = session;

    const saving = lock.exclusive(() => pending.promise);

    // Every authoritative action offered during the write is refused outright,
    // so `current` is still the world the save was handed.
    for (const action of [
      () => playChoice(current, "hold_reserve"),
      () => playWorldTick(current),
      () => newSystemicGame()
    ]) {
      const attempt = lock.protect(() => {
        current = action();
        return current;
      });
      expect(attempt.ran).toBe(false);
    }
    expect(await lock.exclusive(async () => "load")).toEqual({ ran: false });

    expect(current).toBe(session);
    expect(current.state.turn).toBe(session.state.turn);
    expect(current.state.simulation!.tick).toBe(session.state.simulation!.tick);

    pending.settle();
    await saving;
  });

  it("3: while a load is pending, choice/tick/new/save cannot alter the session", async () => {
    const lock = createPersistenceLock();
    const pending = deferred<void>();
    const onScreen = playWorldTick(newSystemicGame());
    let current = onScreen;

    const loading = lock.exclusive(() => pending.promise);

    expect(lock.protect(() => { current = playWorldTick(current); }).ran).toBe(false);
    expect(lock.protect(() => { current = playChoice(current, "hold_reserve"); }).ran).toBe(false);
    expect(lock.protect(() => { current = newSystemicGame(); }).ran).toBe(false);
    expect(await lock.exclusive(async () => "save")).toEqual({ ran: false });

    expect(current).toBe(onScreen);

    pending.settle();
    await loading;
    // Only now can the loaded world take its place, and it replaces a session
    // that provably has not moved.
    expect(lock.protect(() => playWorldTick(current)).ran).toBe(true);
  });

  it("4, 5: a failed save and a failed load both release the lock", async () => {
    const lock = createPersistenceLock();

    // A rejected persistence promise must not leave the game unplayable.
    await expect(
      lock.exclusive(async () => {
        throw new Error("disk is full");
      })
    ).rejects.toThrow("disk is full");
    expect(lock.busy).toBe(false);
    expect(lock.protect(() => "playable").ran).toBe(true);

    // A reported failure - corrupted, not found, transport - is an ordinary
    // return value and releases just the same.
    const store = fakeStore({});
    const failed = await lock.exclusive(() => loadGame("cmp_missing", store));
    expect(failed.ran).toBe(true);
    expect(failed.ran && failed.result.ok).toBe(false);
    expect(lock.busy).toBe(false);
  });

  it("6, 7: a successful save and a successful load release the lock", async () => {
    const lock = createPersistenceLock();
    const store = fakeStore();
    const session = newSystemicGame();

    const saved = await lock.exclusive(() => saveGame(session.state, store));
    expect(saved.ran && saved.result.ok).toBe(true);
    expect(lock.busy).toBe(false);

    const loaded = await lock.exclusive(() => loadGame(session.state.campaignId, store));
    expect(loaded.ran && loaded.result.ok).toBe(true);
    expect(lock.busy).toBe(false);
    expect(lock.protect(() => playWorldTick(session)).ran).toBe(true);
  });

  it("8: a stale load cannot overwrite a later action, because there is none", async () => {
    const lock = createPersistenceLock();
    const store = fakeStore();
    const start = newSystemicGame();
    await saveGame(start.state, store);

    // A slow load: the payload is already known, the transport is not.
    const gate = deferred<void>();
    const slow: SystemicPersistence = {
      save: store.save,
      async load(campaignId) {
        await gate.promise;
        return store.load(campaignId);
      }
    };

    let onScreen = playWorldTick(start);
    const ticked = onScreen.state.simulation!.tick;

    const loading = lock.exclusive(() => loadGame(start.state.campaignId, slow));

    // The player tries to take another turn while the read is outstanding.
    const blocked = lock.protect(() => {
      onScreen = playWorldTick(onScreen);
      return onScreen;
    });
    expect(blocked.ran).toBe(false);
    expect(onScreen.state.simulation!.tick).toBe(ticked);

    gate.settle();
    const outcome = await loading;
    expect(outcome.ran && outcome.result.ok).toBe(true);

    // The loaded world discards nothing: the only turn it could have discarded
    // was never allowed to happen.
    if (outcome.ran && outcome.result.ok) {
      expect(outcome.result.session.state.simulation!.tick).toBe(0);
    }
  });

  it("9: the screen routes every action through the lock and disables its buttons", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../src/components/SystemicPlayScreen.tsx", import.meta.url)),
      "utf8"
    );

    // The guard is logic, not styling: every action passes through the lock.
    expect(source).toContain("createPersistenceLock");
    expect(source).toContain("io.exclusive(");
    expect(source).toContain("io.protect(");
    // Save and load are the exclusive pair; the three synchronous actions are
    // the protected ones.
    expect(source.match(/io\.exclusive\(/g) ?? []).toHaveLength(2);
    expect((source.match(/io\.protect\(/g) ?? []).length).toBeGreaterThanOrEqual(3);

    // And the player is told, rather than clicking a button that silently
    // does nothing.
    expect((source.match(/disabled=\{ioBusy\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("disabled={!available || locked}");

    // The lock is never represented inside the world.
    expect(source).not.toContain("state.ioBusy");
    expect(source).not.toContain("simulation.busy");
  });
});
