import { describe, expect, it } from "vitest";
import type { WorldState } from "@paa/game-types";
import { createGqpScenario, createSystemicScenario, loadSystemicWorldState, serializeSystemicWorldState } from "../src";
import { TRAJECTORY_B, runTrajectory } from "./support/proof-trajectory";

/**
 * The persisted boundary after the GQP-B fixes, attacked through the real load
 * path: raw text in, a world or a named refusal out.
 *
 * Every case is a save a player could hand the game -- tampered, truncated,
 * written by another build. Each must be refused fail-closed: `ok: false`, the
 * reason and the offending field named, the validator itself never throwing,
 * and no partially interpreted world returned.
 */

type Json = any; // hostile saves are untyped by definition

/** A valid mid-network proof world (B after three decisions): memories, history, pending consequences. */
function midNetwork(): WorldState {
  return runTrajectory("B-mid", TRAJECTORY_B.slice(0, 3)).final;
}

function load(world: Json) {
  const raw = JSON.stringify(world);
  return loadSystemicWorldState(raw, world.campaignId ?? "campaign");
}

function refused(world: Json, pattern: RegExp) {
  let result: ReturnType<typeof loadSystemicWorldState> | undefined;
  expect(() => (result = load(world))).not.toThrow();
  expect(result!.ok).toBe(false);
  const errors = (result as { errors: string[] }).errors.join("; ");
  expect(errors).toMatch(pattern);
  expect((result as { state?: unknown }).state).toBeUndefined();
}

const clone = (w: WorldState): Json => structuredClone(w);
const memoriesOf = (w: Json, id: string) => w.party.find((c: Json) => c.id === id).memories;

describe("the hostile-save pass on the persisted boundary", () => {
  it("accepts the valid mid-network world it starts from", () => {
    const world = midNetwork();
    const saved = serializeSystemicWorldState(world);
    expect(saved.ok).toBe(true);
    const back = load(world);
    expect(back.ok).toBe(true);
  });

  it("refuses one fact id held first-hand by two characters", () => {
    const w = clone(midNetwork());
    const secret = memoriesOf(w, "mara_001").find((m: Json) => m.id === "fact_f3_secret_tap");
    memoriesOf(w, "tarek_001").push({ ...secret, summary: "a different fact" });
    refused(w, /fact 'fact_f3_secret_tap' is held first-hand by more than one character/);
  });

  it("refuses a propagated copy that is not the fact it copies", () => {
    const w = clone(midNetwork());
    const copy = memoriesOf(w, "mara_001").find((m: Json) => m.id === "fact_f2_warning_ignored");
    expect(copy.origin).toBe("reflected");
    copy.valence = "positive";
    refused(w, /fact 'fact_f2_warning_ignored' held by mara_001 differs from the fact it copies/);
  });

  it.each([
    ["an unknown valence", { valence: "furious" }, /valence must be one of/],
    ["salience out of range", { salience: 7 }, /salience/],
    ["a non-finite salience (as JSON null)", { salience: null }, /salience must be a finite number, got null/],
    ["an unknown origin", { origin: "rumour" }, /origin/],
    ["an unknown hook", { behaviorHook: "sulk" }, /behaviorHook/],
    ["a subject that does not exist", { subjectId: "ghost_999" }, /subjectId 'ghost_999' matches no character or faction/]
  ])("refuses a proof memory with %s", (_label, patch, pattern) => {
    const w = clone(midNetwork());
    Object.assign(memoriesOf(w, "tarek_001").find((m: Json) => m.id === "fact_f2_warning_ignored"), patch);
    refused(w, pattern);
  });

  it("refuses a pending publication its holder could not make", () => {
    const w = clone(midNetwork());
    w.simulation.delayedConsequences.push({
      id: "con_orphan_publication",
      triggerTurn: 9,
      visibility: "hidden",
      scope: "faction",
      effects: [{ type: "MEMORY_PUBLISH", characterId: "tarek_001", memoryId: "fact_f3_secret_tap" }],
      reversible: false,
      status: "pending",
      source: { kind: "choice", id: "evt_x:y" }
    });
    refused(w, /Cannot publish 'fact_f3_secret_tap': 'tarek_001' does not hold that fact/);
  });

  it("refuses a proof effect in a baseline v1 save, by name", () => {
    const w = clone(createSystemicScenario(7419));
    w.simulation.delayedConsequences.push({
      id: "con_v1_proof",
      triggerTurn: 3,
      visibility: "hidden",
      scope: "settlement",
      effects: [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.1 }],
      reversible: false,
      status: "pending",
      source: { kind: "system", id: "tamper" }
    });
    refused(w, /is the proof effect NODE_CONDITION_SHIFT and cannot appear at schema v1/);
  });

  it.each([
    ["a malformed delayed effect", [{ type: "EPIDEMIC_SHIFT", cause: "crowding", delta: "much" }], /delta/],
    ["an impossible node", [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: -0.1 }], /prod_ghost/],
    ["an impossible character", [{ type: "CHARACTER_STRESS", targetId: "ghost_999", value: 5 }], /unknown character 'ghost_999'/],
    ["a derived cause authored", [{ type: "EPIDEMIC_SHIFT", cause: "water_shortage", delta: 0.1 }], /water_shortage/]
  ])("refuses a pending consequence with %s", (_label, effects, pattern) => {
    const w = clone(midNetwork());
    w.simulation.delayedConsequences.push({
      id: "con_hostile", triggerTurn: 9, visibility: "hidden", scope: "settlement",
      effects, reversible: false, status: "pending", source: { kind: "system", id: "tamper" }
    });
    refused(w, pattern);
  });

  it.each([
    ["no kind", { id: "x" }, /source\.kind must be one of/],
    ["an unknown kind", { kind: "oracle", id: "x" }, /source\.kind must be one of/],
    ["an empty id", { kind: "choice", id: " " }, /source\.id must not be empty/]
  ])("refuses a consequence cause with %s", (_label, source, pattern) => {
    const w = clone(midNetwork());
    w.simulation.delayedConsequences[0].source = source;
    refused(w, pattern);
  });

  it.each([
    ["a decision from the future", (h: Json) => (h.playerTurn = 99), /playerTurn/],
    ["an unknown family", (h: Json) => (h.familyId = "warfare"), /familyId/],
    ["a negative tick", (h: Json) => (h.worldTick = -1), /worldTick must be at least 0/]
  ])("refuses a history entry with %s", (_label, corrupt, pattern) => {
    const w = clone(midNetwork());
    corrupt(w.simulation.resolvedHistory[0]);
    refused(w, pattern);
  });

  it("refuses an epidemic whose value is not its causes", () => {
    const w = clone(midNetwork());
    w.simulation.epidemic.value = 0.99;
    refused(w, /epidemic\.value is 0\.99 but its contributors add up to/);
  });

  it("refuses a schema it does not know, without interpreting anything else", () => {
    const w = clone(midNetwork());
    w.simulation.schemaVersion = 3;
    const result = load(w);
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors).toHaveLength(1);
    expect((result as { errors: string[] }).errors[0]).toMatch(/schema/i);
  });

  it.each([
    ["a proof history", (w: Json) => (w.simulation.resolvedHistory = [])],
    ["an epidemic", (w: Json) => (w.simulation.epidemic = (createGqpScenario(7419).simulation as Json).epidemic)],
    ["a proof memory field", (w: Json) => (w.party[0].memories = [{ id: "m", summary: "s", tags: [], turn: 1, source: { kind: "system", id: "t" }, origin: "direct" }])],
    ["a proof character field", (w: Json) => (w.party[0].coreValue = "duty_of_care")]
  ])("refuses a v1 save contaminated with %s", (_label, contaminate) => {
    const w = clone(createSystemicScenario(7419));
    contaminate(w);
    refused(w, /schema v2|schema v1|must not appear/);
  });

  it.each([
    ["truncated JSON", "{\"campaignId\":\"c\",\"simulation\":{"],
    ["a JSON array", "[]"],
    ["null", "null"],
    ["a string", "\"world\""]
  ])("refuses %s without throwing", (_label, raw) => {
    let result: ReturnType<typeof loadSystemicWorldState> | undefined;
    expect(() => (result = loadSystemicWorldState(raw, "c"))).not.toThrow();
    expect(result!.ok).toBe(false);
  });

  it("refuses non-object memories and a non-array memory list without throwing", () => {
    const a = clone(midNetwork());
    memoriesOf(a, "ira_001").push(null, "fact", 7);
    refused(a, /character ira_001 memory\[\d\] must be an object/);
    const b = clone(midNetwork());
    b.party.find((c: Json) => c.id === "ira_001").memories = { fact: true };
    refused(b, /character ira_001\.memories must be an array/);
  });
});
