import { describe, expect, it } from "vitest";
import type { ProofEvent, SystemicSimulationStateV2, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  RECAP_CHAINS,
  agendaConditionHolds,
  applyDueConsequences,
  beginProofBeat,
  completeProofBeat,
  createGqpScenario,
  explainProofFocus,
  isProofChoiceAvailable,
  readPressures,
  resolveProofChoice,
  runWorldTick,
  selectProofFocus
} from "../src";

/**
 * The Normal explanation contract (spec 16): the data a player-facing surface
 * needs to answer "why now, because of what, who remembers, what is at stake"
 * -- derived from the Core's own selection and state, never from prose, and
 * never contradicting the authority it describes.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const start = () => createGqpScenario(7419);
const sim = (world: WorldState) => world.simulation as SystemicSimulationStateV2;

function decide(state: WorldState, eventId: string, choiceId: string): WorldState {
  return applyDueConsequences(resolveProofChoice(state, CATALOGUE, eventId, choiceId).state).state;
}

describe("an EVENT explains itself from the selection that chose it", () => {
  // Tarek comes back unasked: he was overruled at turn 1, and the wear he
  // warned about is about to land.
  const world = () => {
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const later = decide(runWorldTick(runWorldTick(patched).state).state, "evt_f1_clinic_request", "treat_now");
    later.simulation!.tick += 1;
    return later;
  };
  const only = CATALOGUE.filter(event => event.id === "evt_f2_tarek_second_warning");

  it("answers why now with the three terms and the rule, exactly as selected", () => {
    const focus = selectProofFocus(world(), only);
    if (focus.kind !== "event") throw new Error("expected an event");
    const explanation = explainProofFocus(world(), focus);
    if (explanation.kind !== "event") throw new Error("expected an event explanation");
    expect(explanation.whyNow).toEqual({
      rule: focus.selection.rule,
      ticksSinceLastResolvedDecision: 1,
      priority: focus.selection.chosen.priority,
      urgency: focus.selection.chosen.urgency.reasons,
      relevance: focus.selection.chosen.relevance.reasons,
      repetition: focus.selection.chosen.repetition,
      tieBreak: false
    });
  });

  it("names the decision it is a consequence of, who remembers it, and one chain for it", () => {
    const state = world();
    const focus = selectProofFocus(state, only);
    const explanation = explainProofFocus(state, focus);
    if (explanation.kind !== "event") throw new Error("expected an event explanation");
    const patch = { familyId: "maintenance", eventId: "evt_f2_recycler_warning", choiceId: "patch_and_defer", playerTurn: 1 };
    expect(explanation.causedBy).toEqual(patch);
    expect(explanation.whoRemembers).toEqual([
      { characterId: "tarek_001", memoryId: "fact_f2_warning_ignored", origin: "direct", salience: 0.8, decision: patch }
    ]);
    // The memory and the pending wear both trace to the same decision: one chain, not two.
    expect(explanation.recap).toEqual([
      { decision: patch, via: { kind: "memory", characterId: "tarek_001", memoryId: "fact_f2_warning_ignored" }, eventId: "evt_f2_tarek_second_warning" }
    ]);
  });
});

describe("agenda and patterns are named with their sources", () => {
  it("shows the League's open desire and the detected dependency behind its ledger", () => {
    // Two League debts: the quiet line (Mara) and the convoy (Brann).
    let world = decide(start(), "evt_f3_conduit_offer", "tap_quietly");
    for (let i = 0; i < 3; i += 1) world = runWorldTick(world).state;
    world = decide(world, "evt_f5_water_convoy", "league_convoy");
    world.simulation!.tick += 1;
    const ledger = CATALOGUE.filter(event => event.id === "evt_f5_league_calls_in");
    const focus = selectProofFocus(world, ledger);
    const explanation = explainProofFocus(world, focus);
    if (explanation.kind !== "event") throw new Error("expected an event explanation");
    expect(explanation.agenda).toEqual([
      {
        agendaId: "agenda_fcl_access",
        factionId: "faction_front",
        kind: "desire",
        subject: "informal_access",
        holds: false,
        condition: { predicate: "flag_equals", key: "front_access_granted", value: true }
      }
    ]);
    expect(explanation.patterns).toEqual([
      {
        pattern: "FACTION_DEPENDENCY_GROWING",
        subject: "faction_front",
        decisions: [
          { familyId: "unregistered_conduit", eventId: "evt_f3_conduit_offer", choiceId: "tap_quietly", playerTurn: 1 },
          { familyId: "external_rescue", eventId: "evt_f5_water_convoy", choiceId: "league_convoy", playerTurn: 2 }
        ]
      }
    ]);
    expect(explanation.recap[0]!.via).toEqual({ kind: "pattern", pattern: "FACTION_DEPENDENCY_GROWING", subject: "faction_front" });
  });

  it("leads with the callback's chain and adds a second from another decision, at most two", () => {
    // The League calls in its line: Mara's memory of the splice (turn 1) is the
    // callback; the dependency the convoy (turn 2) completed is a second chain.
    let world = decide(start(), "evt_f3_conduit_offer", "tap_quietly");
    for (let i = 0; i < 3; i += 1) world = runWorldTick(world).state;
    world = decide(world, "evt_f5_water_convoy", "league_convoy");
    world.simulation!.tick += 1;
    const debtCall = CATALOGUE.filter(event => event.id === "evt_f3_debt_called");
    const focus = selectProofFocus(world, debtCall);
    const explanation = explainProofFocus(world, focus);
    if (explanation.kind !== "event") throw new Error("expected an event explanation");
    const tap = { familyId: "unregistered_conduit", eventId: "evt_f3_conduit_offer", choiceId: "tap_quietly", playerTurn: 1 };
    const convoy = { familyId: "external_rescue", eventId: "evt_f5_water_convoy", choiceId: "league_convoy", playerTurn: 2 };
    expect(explanation.causedBy).toEqual(tap);
    expect(explanation.recap.map(chain => chain.decision)).toEqual([tap, convoy]);
  });
});

describe("a QUIET beat explains what the tick will change, and why it is worth showing", () => {
  it("gives every development a typed reason, and says the window is spent after it", () => {
    const focus = selectProofFocus(start(), CATALOGUE);
    const explanation = explainProofFocus(start(), focus);
    if (explanation.kind !== "quiet") throw new Error("expected a quiet explanation");
    expect(explanation.whatChanged.length).toBeGreaterThan(0);
    expect(new Set(explanation.whatChanged.map(item => item.reason))).toEqual(
      new Set(["PRESSURE_CHANGED", "CHARACTER_REACTION", "FACTION_REACTION", "RESOURCE_CRISIS_CHANGED", "POLITICAL_SHIFT"])
    );
    expect(explanation.boundAfter).toBe(true);
  });
});

describe("the explanation never contradicts the authority, beat after beat", () => {
  it("names only memories that exist, agenda as it holds, pressures as stored, at most two chains", () => {
    let state = start();
    let events = 0;
    for (let beat = 0; beat < 13; beat += 1) {
      const opened = beginProofBeat(state, CATALOGUE);
      const explanation = explainProofFocus(state, opened.focus);
      expect(explanation.pressures).toEqual(readPressures(state));
      expect(sim(state).epidemic.value).toBe(explanation.pressures.epidemic.value);
      if (explanation.kind === "event") {
        events += 1;
        for (const mention of explanation.whoRemembers) {
          expect(state.party.find(c => c.id === mention.characterId)!.memories!.some(m => m.id === mention.memoryId)).toBe(true);
        }
        for (const item of explanation.agenda) {
          const stored = sim(state).factionAgenda.find(entry => entry.id === item.agendaId)!;
          expect(item.holds).toBe(agendaConditionHolds(stored.condition, state));
        }
        expect(explanation.recap.length).toBeLessThanOrEqual(RECAP_CHAINS);
        for (const chain of explanation.recap) {
          expect(sim(state).resolvedHistory.some(e => e.eventId === chain.decision.eventId && e.choiceId === chain.decision.choiceId)).toBe(true);
        }
      }
      if (opened.focus.kind === "quiet") state = completeProofBeat(opened, CATALOGUE).state;
      else {
        const first = opened.focus.event.choices.find(choice => isProofChoiceAvailable(choice, state))!;
        state = completeProofBeat(opened, CATALOGUE, first.id).state;
      }
    }
    expect(events).toBeGreaterThanOrEqual(6);
  });

  it("carries no prose: no title, body, label or memory summary reaches it", () => {
    const patched = decide(start(), "evt_f2_recycler_warning", "patch_and_defer");
    const state = runWorldTick(patched).state;
    const text = JSON.stringify(explainProofFocus(state, selectProofFocus(state, CATALOGUE)));
    const prose = CATALOGUE.flatMap((event: ProofEvent) => [event.presentation.title, event.presentation.body, ...event.choices.map(c => c.label)]);
    const summaries = state.party.flatMap(c => (c.memories ?? []).map(m => m.summary));
    for (const phrase of [...prose, ...summaries]) expect(text.includes(phrase)).toBe(false);
  });
});
