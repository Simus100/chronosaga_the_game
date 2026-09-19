import { describe, expect, it } from "vitest";
import type { ProofEvent, WorldState } from "@paa/game-types";
import { GQP_PROOF_EVENTS } from "@paa/game-data";
import {
  applyDueConsequences,
  createGqpScenario,
  createSystemicScenario,
  deterministicIndex,
  eligibleProofEvents,
  inspectProofStep,
  isProofChoiceAvailable,
  readProofWorld,
  resolveProofChoice,
  runWorldTick,
  validateSystemicWorldState
} from "../src";
import { saveAndLoad } from "./support/proof-trajectory";

/**
 * Property and stress matrix over the whole network.
 *
 * Seeds x deterministic choice policies x save points. Every run takes
 * whatever the network offers -- including the combinations no scripted
 * trajectory names -- and after every step the proof's invariants are checked
 * against the authoritative state. The policies are seeded, so every failure
 * this suite can report is a replayable one.
 */

const CATALOGUE = GQP_PROOF_EVENTS;
const SEEDS = [1, 7, 7419, 424242, 20260919];
const POLICIES = [0, 1, 2, 3, 4, 5, 6, 7];
const MAX_DECISIONS = 10;

interface Run {
  readonly final: WorldState;
  readonly decisions: number;
}

function secretHoldersOk(state: WorldState): string[] {
  const problems: string[] = [];
  const copies = new Map<string, { characterId: string; origin?: string; exposure?: string }[]>();
  for (const character of state.party) {
    const ids = new Set<string>();
    for (const memory of character.memories ?? []) {
      if (ids.has(memory.id)) problems.push(`${character.id} holds '${memory.id}' twice`);
      ids.add(memory.id);
      const list = copies.get(memory.id) ?? [];
      list.push({ characterId: character.id, origin: memory.origin, exposure: memory.exposure });
      copies.set(memory.id, list);
      if (memory.origin !== undefined && memory.origin !== "direct" && memory.behaviorHook !== undefined) {
        problems.push(`${character.id} carries a behaviour hook on second-hand '${memory.id}'`);
      }
    }
  }
  for (const [id, list] of copies) {
    const secret = list.some(copy => copy.exposure === "secret");
    if (secret && list.length > 1) problems.push(`secret '${id}' is held by ${list.map(c => c.characterId).join(",")}`);
    const faction = state.simulation!.factions.some(f => f.memoryTags.includes(`aware:${id}`));
    if (secret && faction) problems.push(`a faction is aware of secret '${id}'`);
  }
  return problems;
}

function invariants(before: WorldState, after: WorldState, decided: boolean): string[] {
  const problems: string[] = [];
  const verdict = validateSystemicWorldState(after);
  if (!verdict.ok) problems.push(...verdict.errors);
  if (JSON.stringify(saveAndLoad(after)) !== JSON.stringify(after)) problems.push("save/load round trip changed the world");

  const a = readProofWorld(before, CATALOGUE);
  const b = readProofWorld(after, CATALOGUE);
  const added = b.history.length - a.history.length;
  if (added !== (decided ? 1 : 0)) problems.push(`history grew by ${added}`);
  if (decided) {
    const entry = b.history[b.history.length - 1]!;
    if (entry.playerTurn !== a.playerTurn) problems.push("history turn is not the pre-increment turn");
    if (entry.worldTick !== a.worldTick) problems.push("history tick is not the tick of the decision");
    if (b.playerTurn !== a.playerTurn + 1) problems.push("a decision did not advance the turn exactly once");
  } else if (b.playerTurn !== a.playerTurn) {
    problems.push("a quiet step advanced the Player Turn");
  }

  const epidemic = (after.simulation as unknown as { epidemic: { value: number; contributors: { magnitude: number }[] } }).epidemic;
  const sum = epidemic.contributors.reduce((total, c) => total + c.magnitude, 0);
  if (Math.abs(epidemic.value - Math.round(sum * 10000) / 10000) > 1e-9) problems.push("epidemic value is not its causes");
  if (!(epidemic.value >= 0 && epidemic.value <= 1)) problems.push("epidemic outside 0..1");
  for (const [id, condition] of Object.entries(b.nodeCondition)) {
    if (!(condition >= 0 && condition <= 1)) problems.push(`${id} condition outside 0..1`);
  }
  problems.push(...secretHoldersOk(after));
  return problems;
}

function policyRun(seed: number, policy: number, catalogue: readonly ProofEvent[], savePoint: number): Run {
  let state = createGqpScenario(seed);
  let decisions = 0;
  let quiet = 0;
  for (let step = 0; decisions < MAX_DECISIONS && quiet <= 4; step += 1) {
    const offers = eligibleProofEvents(state, catalogue).flatMap(event =>
      event.choices.filter(choice => isProofChoiceAvailable(choice, state)).map(choice => [event.id, choice.id] as const)
    );
    const before = state;
    if (offers.length === 0) {
      state = runWorldTick(state).state;
      quiet += 1;
      const problems = invariants(before, state, false);
      if (problems.length) throw new Error(`seed ${seed} policy ${policy} quiet step ${step}: ${problems.join("; ")}`);
      continue;
    }
    quiet = 0;
    const [eventId, choiceId] = offers[deterministicIndex(seed * 7919 + policy * 104729 + step, offers.length)]!;
    const resolved = resolveProofChoice(state, catalogue, eventId, choiceId).state;
    state = runWorldTick(applyDueConsequences(resolved).state).state;
    decisions += 1;
    const problems = invariants(before, state, true);
    if (problems.length) throw new Error(`seed ${seed} policy ${policy} ${eventId}:${choiceId}: ${problems.join("; ")}`);
    if (decisions === savePoint) state = saveAndLoad(state);
  }
  return { final: state, decisions };
}

describe("GQP-B stress matrix: seeds x policies x save points", () => {
  it.each(SEEDS)("holds every invariant after every step, and replays exactly (seed %i)", seed => {
    const signatures = new Set<string>();
    for (const policy of POLICIES) {
      const savePoint = 1 + (policy % 4);
      const run = policyRun(seed, policy, CATALOGUE, savePoint);
      expect(run.decisions).toBeGreaterThanOrEqual(3);
      const final = JSON.stringify(run.final);
      // Same seed, same policy: the same world, with or without the save.
      expect(JSON.stringify(policyRun(seed, policy, CATALOGUE, -1).final)).toBe(final);
      // Order of the catalogue carries no meaning.
      expect(JSON.stringify(policyRun(seed, policy, [...CATALOGUE].reverse(), savePoint).final)).toBe(final);
      signatures.add(JSON.stringify(readProofWorld(run.final, CATALOGUE).history.map(e => `${e.eventId}:${e.choiceId}`)));
    }
    // The policies explore the network rather than all walking one path.
    expect(signatures.size).toBeGreaterThanOrEqual(5);
  });
});

describe("Inspection is read-only", () => {
  it("never writes to either world, and answers the same twice", () => {
    const before = createGqpScenario(7419);
    const after = runWorldTick(resolveProofChoice(before, CATALOGUE, "evt_f3_conduit_offer", "tap_quietly").state).state;
    const snapshots = [structuredClone(before), structuredClone(after)];
    const first = inspectProofStep(before, after, CATALOGUE);
    const second = inspectProofStep(before, after, CATALOGUE);
    expect(second).toEqual(first);
    expect([before, after]).toEqual(snapshots);
    expect(first.consequencesScheduled).toEqual(["con.evt_f3_conduit_offer.tap_quietly.strain"]);
    expect(first.newMemories.map(m => `${m.characterId}:${m.memoryId}:${m.exposure}`)).toContain("mara_001:fact_f3_secret_tap:secret");
  });

  it("refuses a baseline world", () => {
    expect(() => readProofWorld(createSystemicScenario(7419), CATALOGUE)).toThrow(/schema-v2/);
  });
});
