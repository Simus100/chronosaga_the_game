import { describe, expect, it } from "vitest";
import type { WorldState } from "@paa/game-types";
import {
  castRoleOf,
  createSystemicScenario,
  findCastMember,
  runWorldTick,
  serializeSystemicWorldState,
  validateSystemicWorldState
} from "../src";

/**
 * No rule may branch on a label written for a human to read.
 *
 * The World Tick decided who experiences a water shortage by comparing
 * `role === "Quartermaster"`, so the simulation depended on a display string:
 * translating the cast, or fixing a typo in it, changed which memories a run
 * produced from the same seed. Found by external audit, and present in the
 * accepted M1 baseline rather than introduced by any proof slice.
 *
 * The job is derived from the character's id rather than persisted beside the
 * label. That is the whole design, and the second block below is why.
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

describe("A06: the rule reads a derived job, not the label", () => {
  /** The test the audit asked for: behaviour invariant under a label change. */
  it("produces the same world when the role label is translated", () => {
    const original = scenario();

    const translated = scenario();
    const quartermaster = findCastMember(translated, "settlement_helios", "quartermaster")!;
    expect(quartermaster.role).toBe("Quartermaster");
    quartermaster.role = "Quartiermastro";

    expect(validateSystemicWorldState(translated).ok).toBe(true);
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
      const job = castRoleOf(character.id);
      if (job) character.role = italian[job]!;
    }
    // Every label really did change.
    expect(translated.party.map(c => c.role)).not.toEqual(scenario().party.map(c => c.role));

    expect(validateSystemicWorldState(translated).ok).toBe(true);
    expect(play(translated)).toEqual(play(scenario()));
  });

  it("produces the same world when the labels are swapped between characters", () => {
    // The sharpest form. If any rule still read the label, the memory would
    // follow the wrong person; because the job follows the id, nothing moves.
    const swapped = scenario();
    const mara = swapped.party.find(c => c.id === "mara_001")!;
    const tarek = swapped.party.find(c => c.id === "tarek_001")!;
    [mara.role, tarek.role] = [tarek.role, mara.role];

    expect(play(swapped)).toEqual(play(scenario()));
  });

  it("still writes the shortage memory it always wrote, to the same character", () => {
    // Invariance would be trivially satisfied if the rule never fired at all.
    let current: WorldState = scenario();
    for (let i = 0; i < 3; i += 1) current = runWorldTick(current).state;

    const remembered = current.party.filter(c =>
      (c.memories ?? []).some(m => /water_shortage/.test(m.id))
    );
    expect(remembered.map(c => c.id)).toEqual(["mara_001"]);
    expect(remembered[0]!.memoryTags).toContain("water_shortage_experienced");
  });

  it("does not accept a stranger who merely wears the label", () => {
    // The case a fallback would get wrong, and the reason there is no
    // fallback. Take the quartermaster out of the settlement and put in a
    // character the cast table has never heard of, wearing the label.
    //
    // Resolving by job: nobody holds it here, so no memory is written.
    // Resolving by label as a backstop: the stranger is handed a memory the
    // game has no basis to give them, and the prose branch is alive again.
    const state = scenario();
    // Unassigned rather than deleted: she leads a political group, and
    // removing her would make the world invalid for an unrelated reason.
    // `locationId` is optional, and it must name a settlement that exists.
    delete state.party.find(c => c.id === "mara_001")!.locationId;
    state.party.push({
      ...structuredClone(state.party[0]!),
      id: "stranger_001",
      name: "Someone Else",
      role: "Quartermaster",
      memories: [],
      memoryTags: []
    });

    expect(validateSystemicWorldState(state).ok).toBe(true);
    expect(castRoleOf("stranger_001")).toBeUndefined();
    expect(findCastMember(state, "settlement_helios", "quartermaster")).toBeUndefined();

    const played = play(state);
    expect(played.memories.some(id => /water_shortage/.test(id))).toBe(false);
    expect(played.memoryTags).not.toContain("water_shortage_experienced");
  });

  it("resolves a job from an id and refuses to invent one", () => {
    expect(castRoleOf("mara_001")).toBe("quartermaster");
    expect(castRoleOf("tarek_001")).toBe("field_technician");
    expect(castRoleOf("nobody_999")).toBeUndefined();

    // Location is still state: a character elsewhere holds the job but is not
    // at this settlement.
    const away = scenario();
    delete away.party.find(c => c.id === "mara_001")!.locationId;
    expect(validateSystemicWorldState(away).ok).toBe(true);
    expect(findCastMember(away, "settlement_helios", "quartermaster")).toBeUndefined();
  });
});

describe("A06: schema v1 is genuinely untouched", () => {
  /**
   * The first attempt at this fix persisted a `roleId` beside the label, and
   * the follow-up review rejected it for a reason worth writing down.
   *
   * A persisted field makes the answer depend on which build wrote the file. A
   * new build reading an old save sees no field; an **older** build reading a
   * new save ignores a field it does not know. Both reach a different world
   * than the writer did, and the second is precisely the failure GQP section
   * 24.1 bumps the schema version to prevent — introduced inside v1, where no
   * version number changes to warn anybody. A P3 hygiene fix does not get to do
   * that, and it does not get a schema v3 either.
   *
   * Deriving from the cast's ids sidesteps the question entirely: ids are
   * already stable, already validated, and already present in every save ever
   * written.
   */
  it("adds nothing to a serialized world", () => {
    const stored = serializeSystemicWorldState(scenario());
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error("unreachable");

    expect(stored.payload).not.toContain("roleId");
    expect(stored.payload).not.toContain("functionalRole");
    expect(stored.payload).not.toContain("castRole");
    // The label is still stored, because it is still shown.
    expect(stored.payload).toContain('"role":"Quartermaster"');
  });

  it("leaves the character shape exactly as it was", () => {
    // The strongest statement available: this changes no bytes on disk, so a
    // build without the fix and a build with it write the same file.
    const characterFields = new Set(
      scenario().party.flatMap(character => Object.keys(character))
    );
    expect([...characterFields].sort()).toEqual([
      "factionId",
      "health",
      "id",
      "locationId",
      "memories",
      "memoryTags",
      "morale",
      "name",
      "role",
      "stress",
      "traits"
    ]);
  });

  it("reads an identical world out of a save that predates the fix", () => {
    // Any save ever written carries the ids this resolution needs, so a world
    // from an older build ticks to exactly the same place. There is no legacy
    // case to accept and no memory quietly lost.
    const stored = serializeSystemicWorldState(scenario());
    if (!stored.ok) throw new Error("unreachable");

    const fromDisk = JSON.parse(stored.payload) as WorldState;
    expect(validateSystemicWorldState(fromDisk).ok).toBe(true);
    expect(play(fromDisk)).toEqual(play(scenario()));
  });

  it("keeps the job out of the validator, because it is not state", () => {
    // A save cannot claim a job, so there is nothing for a validator to check
    // and nothing a tampered file can assert. Unknown keys are tolerated at
    // this boundary by design, and neither of these reaches a rule.
    const tampered = scenario() as any;
    tampered.party[0].roleId = "quartermaster";
    tampered.party[1].castRole = "anything";

    expect(validateSystemicWorldState(tampered).ok).toBe(true);
    expect(play(tampered)).toEqual(play(scenario()));
  });
});
