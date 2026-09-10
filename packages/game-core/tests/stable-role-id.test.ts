import { describe, expect, it } from "vitest";
import type { WorldState } from "@paa/game-types";
import { createSystemicScenario, runWorldTick, validateSystemicWorldState } from "../src";

/**
 * No rule may branch on a label written for a human to read.
 *
 * The World Tick decided who experiences a water shortage by comparing
 * `role === "Quartermaster"`, so the simulation depended on a display string:
 * translating the cast, or fixing a typo in it, changed which memories a run
 * produced from the same seed. Found by external audit, and present in the
 * accepted M1 baseline rather than introduced by any proof slice.
 */

function scenario(): WorldState {
  return createSystemicScenario(4201);
}

/** Three ticks, and everything the tick writes that a player can see. */
function play(state: WorldState) {
  let current = state;
  for (let i = 0; i < 3; i += 1) current = runWorldTick(current).state;
  const simulation = current.simulation!;
  return {
    memories: current.party.flatMap(character => (character.memories ?? []).map(m => m.id)),
    memoryTags: current.party.flatMap(character => character.memoryTags),
    resources: simulation.settlements[0]!.resourceStock,
    projection: current.resources,
    satisfaction: simulation.settlements[0]!.satisfaction,
    stability: simulation.settlements[0]!.stability,
    approvals: simulation.politicalGroups.map(group => group.approval),
    cohorts: simulation.populationCohorts.map(c => [c.satisfaction, c.loyalty]),
    flags: current.flags,
    tick: simulation.tick,
    turn: current.turn,
    day: current.day
  };
}

describe("A06: the rule reads a stable id, not the label", () => {
  /** The test the audit asked for: behaviour invariant under a label change. */
  it("produces the same world when the role label is translated", () => {
    const original = scenario();

    const translated = scenario();
    const quartermaster = translated.party.find(c => c.roleId === "quartermaster")!;
    expect(quartermaster.role).toBe("Quartermaster");
    quartermaster.role = "Quartiermastro";

    // The translated world is still a legal world.
    expect(validateSystemicWorldState(translated).ok).toBe(true);

    // And it plays out identically, memories included.
    expect(play(translated)).toEqual(play(original));
  });

  it("produces the same world when every label is translated", () => {
    const translated = scenario();
    const italian: Record<string, string> = {
      cartographer: "Cartografa",
      security_lead: "Capo della Sicurezza",
      quartermaster: "Quartiermastro",
      field_technician: "Tecnico di Campo",
      mediator: "Mediatrice"
    };
    for (const character of translated.party) {
      character.role = italian[character.roleId!] ?? character.role;
    }

    expect(validateSystemicWorldState(translated).ok).toBe(true);
    expect(play(translated)).toEqual(play(scenario()));
  });

  it("still writes the shortage memory it always wrote", () => {
    // Invariance would be trivially satisfied if the rule never fired at all.
    const played = play(scenario());
    expect(played.memories.some(id => /water_shortage/.test(id))).toBe(true);
    expect(played.memoryTags).toContain("water_shortage_experienced");
  });

  it("follows the id when the id moves to another character", () => {
    // The strongest form: the label stays put and the id moves. If any rule
    // still read the label, the memory would follow the wrong person.
    const state = scenario();
    const mara = state.party.find(c => c.roleId === "quartermaster")!;
    const tarek = state.party.find(c => c.roleId === "field_technician")!;
    mara.roleId = "field_technician";
    tarek.roleId = "quartermaster";

    const played = play(state);
    const owner = state.party.find(c => (c.memories ?? []).some(m => /water_shortage/.test(m.id)));
    void owner;
    expect(played.memories.some(id => /water_shortage/.test(id))).toBe(true);

    let current: WorldState = state;
    for (let i = 0; i < 3; i += 1) current = runWorldTick(current).state;
    const remembered = current.party.find(c =>
      (c.memories ?? []).some(m => /water_shortage/.test(m.id))
    );
    expect(remembered?.id).toBe(tarek.id);
  });
});

describe("A06: roleId is validated, and its absence is bounded", () => {
  it("refuses a roleId outside the closed set", () => {
    const state = scenario() as any;
    state.party[0].roleId = "quartiermastro";
    const result = validateSystemicWorldState(state);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => /roleId must be one of/.test(e))).toBe(true);
  });

  it("refuses a roleId that is not a string", () => {
    const state = scenario() as any;
    state.party[0].roleId = 3;
    expect(validateSystemicWorldState(state).errors.some(e => /roleId must be one of/.test(e))).toBe(true);
  });

  /**
   * A save written before `roleId` existed still loads and still plays. The one
   * consequence is measured here rather than asserted: no character matches the
   * supply role, so the flavour memory is not written. Everything the player
   * can act on is identical.
   *
   * The alternative — falling back to the label when the id is missing — was
   * rejected. It would have left the prose branch alive and reachable, which is
   * the entire defect.
   */
  it("keeps a legacy party loading and ticking, differing only in that memory", () => {
    const legacy = scenario();
    for (const character of legacy.party) delete character.roleId;

    expect(validateSystemicWorldState(legacy).ok).toBe(true);

    const before = play(scenario());
    const after = play(legacy);

    // Everything authoritative is untouched.
    expect(after.resources).toEqual(before.resources);
    expect(after.projection).toEqual(before.projection);
    expect(after.satisfaction).toBe(before.satisfaction);
    expect(after.stability).toBe(before.stability);
    expect(after.approvals).toEqual(before.approvals);
    expect(after.cohorts).toEqual(before.cohorts);
    expect(after.flags).toEqual(before.flags);
    expect(after.tick).toBe(before.tick);
    expect(after.turn).toBe(before.turn);
    expect(after.day).toBe(before.day);

    // And the difference is exactly the one documented.
    expect(before.memories.some(id => /water_shortage/.test(id))).toBe(true);
    expect(after.memories.some(id => /water_shortage/.test(id))).toBe(false);
    expect(after.memoryTags).not.toContain("water_shortage_experienced");
  });

  it("carries a stable id for every character the scenario ships", () => {
    for (const character of scenario().party) {
      expect(character.roleId).toBeDefined();
      // The label is still there, and still only a label.
      expect(character.role.length).toBeGreaterThan(0);
    }
    const ids = scenario().party.map(c => c.roleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * There is deliberately no test here scanning the Core's own source for
   * another `role ===`. It would need Node's types inside `game-core`, which is
   * kept free of them on purpose, and the mutation run showed it would add no
   * coverage: reintroducing the label comparison, or even adding it back as a
   * fallback beside the id, already fails the behavioural tests above.
   *
   * The rule itself is written down in `AGENTS.md` section 9.
   */
});
