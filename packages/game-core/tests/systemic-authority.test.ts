import { describe, expect, it } from "vitest";
import type { EventChoice, WorldState } from "@paa/game-types";
import { createSystemicScenario } from "../src/state/create-systemic-scenario.js";
import { runWorldTick } from "../src/state/run-world-tick.js";
import { canChoose, resolveChoice } from "../src/events/resolve-choice.js";
import {
  applyDueConsequences,
  scheduleDelayedConsequence
} from "../src/state/delayed-consequences.js";
import { validateSystemicWorldState } from "../src/state/validate-systemic-state.js";
import { resolveSettlementTarget } from "../src/state/resource-authority.js";

/**
 * M1-C prerequisite: one authoritative resource state, and a Player Turn that
 * is not consumed by the simulation.
 *
 * Everything here runs without AI and without a runtime. These are the rules the
 * playable loop stands on, so they are proven by executing the reducers rather
 * than by reading them.
 */

const scenario = (): WorldState => createSystemicScenario(7419);
const stock = (state: WorldState, key = "water"): number =>
  state.simulation!.settlements[0]!.resourceStock[key] ?? 0;

const spendWater = (value: number): EventChoice => ({
  id: "choice_ration",
  label: "razionamento",
  effects: [{ type: "RESOURCE_DELTA", key: "water", value }]
});

describe("1: a player resource choice survives the following World Tick", () => {
  it("changes the authoritative stock, not only the projection", () => {
    const initial = scenario();
    const before = stock(initial);

    const { state: chosen, delta } = resolveChoice(initial, spendWater(-5), "player_choice");

    expect(stock(chosen)).toBe(before - 5);
    expect(chosen.resources.water).toBe(before - 5);

    // The primary delta entry describes the systemic stock; the projection
    // follows as a derived mirror, so a reader can tell which was the decision.
    const primary = delta.changes.find(change => change.type === "resource");
    expect(primary?.key).toBe("settlement_helios.resourceStock.water");
    expect(primary?.after).toBe(before - 5);
    expect(delta.changes.some(change => change.type === "resourceMirror")).toBe(true);
  });

  it("and the tick starts from the value the player left behind", () => {
    const initial = scenario();
    const chosen = resolveChoice(initial, spendWater(-5), "player_choice").state;

    const withChoice = runWorldTick(chosen).state;
    const withoutChoice = runWorldTick(initial).state;

    // This is the regression. Before the authority fix both ran to the same
    // number: the mirror rewrote `resources` from a stock the choice never
    // touched, and the player's decision vanished with nothing to show for it.
    expect(stock(withChoice)).not.toBe(stock(withoutChoice));
    expect(stock(withChoice)).toBeCloseTo(stock(withoutChoice) - 5, 6);
    expect(withChoice.resources.water).toBe(stock(withChoice));
  });
});

describe("2: a delayed resource consequence survives the following World Tick", () => {
  it("lands on the authoritative stock", () => {
    const initial = scenario();
    const before = stock(initial);

    const scheduled = scheduleDelayedConsequence(initial, {
      id: "dc_water_debt",
      status: "pending",
      triggerTurn: initial.turn + 1,
      visibility: "visible",
      scope: "settlement",
      reversible: false,
      effects: [{ type: "RESOURCE_DELTA", key: "water", value: -4 }],
      source: { kind: "event", id: "evt_test", tick: initial.turn }
    }).state;

    const applied = applyDueConsequences(scheduled, scheduled.turn + 1);
    expect(applied.appliedIds).toEqual(["dc_water_debt"]);
    expect(stock(applied.state)).toBe(before - 4);

    const ticked = runWorldTick(applied.state).state;
    const untouched = runWorldTick(scheduled).state;
    expect(stock(ticked)).toBeCloseTo(stock(untouched) - 4, 6);
  });
});

describe("3: requirements and effects read the same source", () => {
  it("a requirement is judged against the stock the effect will change", () => {
    const initial = scenario();
    const available = stock(initial);

    const affordable: EventChoice = {
      id: "affordable",
      label: "ok",
      requirements: { resources: { water: available } },
      effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }]
    };
    expect(canChoose(affordable, initial)).toBe(true);

    const tooExpensive: EventChoice = {
      ...affordable,
      id: "too_expensive",
      requirements: { resources: { water: available + 1 } }
    };
    expect(canChoose(tooExpensive, initial)).toBe(false);
  });

  it("a stale projection cannot authorise a choice the stock cannot pay for", () => {
    // The failure this prevents: someone writes an optimistic number into the
    // flat map, and the requirement check believes it.
    const initial = scenario();
    const lying = structuredClone(initial);
    lying.resources.water = 9_999;

    const expensive: EventChoice = {
      id: "expensive",
      label: "x",
      requirements: { resources: { water: 9_000 } },
      effects: [{ type: "RESOURCE_DELTA", key: "water", value: -1 }]
    };
    expect(canChoose(expensive, lying)).toBe(false);
  });
});

describe("settlement targeting is explicit and fails closed", () => {
  it("resolves the single settlement of an M1-C world", () => {
    const target = resolveSettlementTarget(scenario());
    expect(target.kind).toBe("settlement");
  });

  it("refuses to guess when there is no settlement or more than one", () => {
    // `settlements[0]` would have quietly worked here, and would have kept
    // working until the day a second settlement made it wrong.
    const none = structuredClone(scenario());
    none.simulation!.settlements = [];
    expect(resolveSettlementTarget(none).kind).toBe("ambiguous");
    expect(() => resolveChoice(none, spendWater(-1), "player_choice")).toThrow(
      /no settlement/
    );

    const two = structuredClone(scenario());
    two.simulation!.settlements = [
      two.simulation!.settlements[0]!,
      { ...structuredClone(two.simulation!.settlements[0]!), id: "settlement_other" }
    ];
    expect(resolveSettlementTarget(two).kind).toBe("ambiguous");
    expect(() => resolveChoice(two, spendWater(-1), "player_choice")).toThrow(
      /2 settlements/
    );
  });

  it("a legacy campaign without a simulation keeps its flat resources", () => {
    const legacy: WorldState = {
      campaignId: "legacy",
      seed: 1,
      turn: 1,
      day: 1,
      worldPressure: 0,
      resources: { credits: 10 },
      flags: {},
      party: [],
      profile: "AUTO"
    } as unknown as WorldState;

    expect(resolveSettlementTarget(legacy).kind).toBe("legacy");
    const { state, delta } = resolveChoice(
      legacy,
      { id: "c", label: "x", effects: [{ type: "RESOURCE_DELTA", key: "credits", value: -3 }] },
      "player_choice"
    );
    expect(state.resources.credits).toBe(7);
    expect(delta.changes[0]!.key).toBe("credits");
  });
});

describe("a settlement is authoritative only for what it stocks", () => {
  it("a campaign resource the settlement does not hold stays on the flat map", () => {
    // Found by attacking this change: the scenario's own `con_relay_debt_01`
    // spends 3 credits, and the settlement stocks water, energy, food and
    // medicine — no credits. Routing every key through the stock wrote
    // `resourceStock.credits = -3` into a settlement that has none, then
    // mirrored that over a balance of 27.
    const initial = scenario();
    expect("credits" in initial.simulation!.settlements[0]!.resourceStock).toBe(false);
    const before = initial.resources.credits;
    expect(before).toBeGreaterThan(0);

    const spend: EventChoice = {
      id: "spend_credits",
      label: "paga",
      effects: [{ type: "RESOURCE_DELTA", key: "credits", value: -3 }]
    };
    const { state, delta } = resolveChoice(initial, spend, "player_choice");

    expect(state.resources.credits).toBe(before - 3);
    expect(state.simulation!.settlements[0]!.resourceStock.credits).toBeUndefined();
    expect(delta.changes[0]!.key).toBe("credits");
  });

  it("the scenario's own delayed credit debt applies correctly", () => {
    const initial = scenario();
    const before = initial.resources.credits;
    const advanced = structuredClone(initial);
    advanced.turn = 4;

    const applied = applyDueConsequences(advanced, 4);
    expect(applied.appliedIds).toContain("con_relay_debt_01");
    expect(applied.state.resources.credits).toBe(before - 3);
    expect(applied.state.simulation!.settlements[0]!.resourceStock.credits).toBeUndefined();
  });

  it("and a requirement on such a resource reads the flat map", () => {
    const initial = scenario();
    const affordable: EventChoice = {
      id: "c",
      label: "x",
      requirements: { resources: { credits: initial.resources.credits! } },
      effects: [{ type: "RESOURCE_DELTA", key: "credits", value: -1 }]
    };
    expect(canChoose(affordable, initial)).toBe(true);
    expect(
      canChoose({ ...affordable, requirements: { resources: { credits: 9_999 } } }, initial)
    ).toBe(false);
  });
});

describe("4: one decision is one Player Turn", () => {
  it("a choice followed by a tick advances the player exactly once", () => {
    const initial = scenario();
    expect(initial.turn).toBe(1);
    expect(initial.simulation!.tick).toBe(0);

    const chosen = resolveChoice(initial, spendWater(-1), "player_choice").state;
    expect(chosen.turn).toBe(2);
    expect(chosen.simulation!.tick).toBe(0);

    const ticked = runWorldTick(chosen).state;
    // Before the fix this reached 3: the simulation spent a Player Turn that
    // the player never took.
    expect(ticked.turn).toBe(2);
    expect(ticked.simulation!.tick).toBe(1);
  });

  it("0..N ticks may follow one decision, as the schema allows", () => {
    let state = resolveChoice(scenario(), spendWater(-1), "player_choice").state;
    for (let i = 0; i < 3; i += 1) state = runWorldTick(state).state;

    expect(state.turn).toBe(2);
    expect(state.simulation!.tick).toBe(3);
    expect(state.day).toBe(4);
  });

  it("the tick delta reports the Player Turn it happened during", () => {
    const chosen = resolveChoice(scenario(), spendWater(-1), "player_choice").state;
    const { delta } = runWorldTick(chosen);
    expect(delta.turn).toBe(2);
    expect(delta.source).toBe("world_tick:1");
  });
});

describe("the trace names its two clocks correctly", () => {
  it("reports the tick it ran and the Player Turn it ran during", () => {
    const chosen = resolveChoice(scenario(), spendWater(-1), "player_choice").state;
    const { trace } = runWorldTick(chosen);

    expect(trace.tick).toBe(1);
    expect(trace.playerTurn).toBe(2);
    // A field called `turn` holding a tick is how the two got confused in the
    // first place; the contract no longer has one.
    expect("turn" in trace).toBe(false);
  });

  it("the two diverge as ticks accumulate inside one Player Turn", () => {
    let state = resolveChoice(scenario(), spendWater(-1), "player_choice").state;
    const seen: Array<{ tick: number; playerTurn: number }> = [];
    for (let i = 0; i < 3; i += 1) {
      const result = runWorldTick(state);
      seen.push({ tick: result.trace.tick, playerTurn: result.trace.playerTurn });
      state = result.state;
    }
    expect(seen).toEqual([
      { tick: 1, playerTurn: 2 },
      { tick: 2, playerTurn: 2 },
      { tick: 3, playerTurn: 2 }
    ]);
  });
});

describe("a memory knows when it happened and what caused it", () => {
  /** Drive the settlement into water shortage so the quartermaster remembers it. */
  const starving = (): WorldState => {
    const state = structuredClone(scenario());
    state.simulation!.settlements[0]!.resourceStock.water = 0;
    return state;
  };

  it("carries the Player Turn, and blames the World Tick", () => {
    const chosen = resolveChoice(starving(), spendWater(0), "player_choice").state;
    expect(chosen.turn).toBe(2);

    const after = runWorldTick(chosen).state;
    const quartermaster = after.party.find(character => character.role === "Quartermaster")!;
    const memory = quartermaster.memories!.find(entry => entry.tags.includes("shortage"))!;

    expect(memory).toBeDefined();
    // The character lived through Player Turn 2 ...
    expect(memory.turn).toBe(2);
    // ... and it was World Tick 1 that did it to them.
    expect(memory.source.tick).toBe(1);
    expect(memory.source.id).toBe("world_tick_1");
    expect(memory.source.kind).toBe("world_tick");
  });

  it("repeated shortages in one Player Turn stay distinct", () => {
    // A memory is written when the settlement *enters* shortage, which is M1-B
    // behaviour and unchanged here. The collision risk is a settlement that
    // recovers and falls again inside one Player Turn: keyed by Player Turn
    // those memories would share an id and the second would be dropped.
    let state = resolveChoice(starving(), spendWater(0), "player_choice").state;
    const plenty = 500;

    state.simulation!.settlements[0]!.resourceStock.water = 0;
    state = runWorldTick(state).state; // tick 1: enters shortage
    state.simulation!.settlements[0]!.resourceStock.water = plenty;
    state = runWorldTick(state).state; // tick 2: recovers
    state.simulation!.settlements[0]!.resourceStock.water = 0;
    state = runWorldTick(state).state; // tick 3: falls again

    const quartermaster = state.party.find(character => character.role === "Quartermaster")!;
    const shortages = quartermaster.memories!.filter(entry => entry.tags.includes("shortage"));

    expect(shortages).toHaveLength(2);
    expect(shortages.map(entry => entry.id)).toEqual([
      "mem_world_tick_1_water_shortage",
      "mem_world_tick_3_water_shortage"
    ]);
    expect(new Set(shortages.map(entry => entry.id)).size).toBe(2);

    // Both happened during the same Player Turn ...
    expect(shortages.map(entry => entry.turn)).toEqual([2, 2]);
    // ... and each blames the tick that caused it.
    expect(shortages.map(entry => entry.source.tick)).toEqual([1, 3]);
    expect(shortages.map(entry => entry.source.id)).toEqual(["world_tick_1", "world_tick_3"]);

    expect(state.turn).toBe(2);
    expect(state.simulation!.tick).toBe(3);
  });

  it("causal source ids stay deterministic across identical runs", () => {
    const run = (): string[] => {
      let state = resolveChoice(starving(), spendWater(0), "player_choice").state;
      for (let i = 0; i < 2; i += 1) {
        state.simulation!.settlements[0]!.resourceStock.water = 0;
        state = runWorldTick(state).state;
      }
      return state.party
        .flatMap(character => character.memories ?? [])
        .map(memory => `${memory.id}|${memory.turn}|${memory.source.id}|${memory.source.tick}`);
    };
    expect(run()).toEqual(run());
  });
});

describe("5 and 6: determinism and replay", () => {
  it("repeated ticks from one state are identical", () => {
    const start = scenario();
    expect(runWorldTick(start).state).toEqual(runWorldTick(start).state);
  });

  it("the same initial state and the same actions produce the same final state", () => {
    const run = (): WorldState => {
      let state = scenario();
      state = resolveChoice(state, spendWater(-3), "player_choice").state;
      state = runWorldTick(state).state;
      state = resolveChoice(state, spendWater(-2), "player_choice").state;
      state = runWorldTick(state).state;
      return state;
    };
    expect(run()).toEqual(run());
  });

  it("a tick never mutates the state it was given", () => {
    const start = scenario();
    const untouched = structuredClone(start);
    runWorldTick(start);
    expect(start).toEqual(untouched);
  });
});

describe("the tick counter is part of the validated contract", () => {
  it("a fresh scenario validates", () => {
    expect(validateSystemicWorldState(scenario())).toEqual({ ok: true, errors: [] });
  });

  it("untrusted input without a usable tick is refused", () => {
    for (const bad of [undefined, null, "1", 1.5, -1, Number.NaN]) {
      const broken = structuredClone(scenario()) as unknown as Record<string, unknown>;
      (broken.simulation as Record<string, unknown>).tick = bad;
      expect(
        validateSystemicWorldState(broken).errors.some(error => error.includes("simulation.tick")),
        `accepted tick=${String(bad)}`
      ).toBe(true);
    }
  });
});
