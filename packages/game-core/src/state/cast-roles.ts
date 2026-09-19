import type { WorldState } from "@paa/game-types";

/**
 * Which job each member of the M1 cast holds, as a stable id.
 *
 * The World Tick used to answer this by comparing `role === "Quartermaster"`,
 * so the simulation depended on a string written for a human to read:
 * translating the cast, or fixing a typo in it, produced a different world from
 * the same seed. `AGENTS.md` section 9 forbids exactly that.
 *
 * ## Why this is a map in code and not a field in the save
 *
 * The obvious repair is to persist a `roleId` beside `role`. It was tried and
 * it is worse, because it makes the answer depend on which build wrote the
 * file:
 *
 * - a save written before the field lacks it, so a new build reading an old
 *   save reaches a different world than the build that wrote it;
 * - a save written after it carries it, so an *older* build reading a new save
 *   ignores a field it does not know and reaches a different world again.
 *
 * That second direction is the one that matters. It is the precise failure the
 * GQP specification's section 24.1 bumps the schema version to prevent — old
 * code silently opening a world containing authoritative state it cannot see —
 * and it would have been introduced inside schema v1, where no version number
 * changes to warn anyone. A P3 hygiene fix does not get to do that.
 *
 * Deriving the mapping from the cast's **ids** avoids the whole question. Ids
 * are already stable, already validated and already in every save that has ever
 * been written, back to the first M1 build. Nothing is added to the schema,
 * nothing is written to disk, and any two builds carrying this table read the
 * same world out of the same bytes.
 *
 * The trade is real and worth naming: a job is not reassignable at runtime,
 * because it is not state. That is exactly true of the M1 cast today — nothing
 * in the game moves a character from one job to another. On the day something
 * does, the job becomes state and earns a schema version of its own, which is
 * the conversation this fix deliberately does not pre-empt.
 */
export const CAST_ROLES = [
  "cartographer",
  "security_lead",
  "quartermaster",
  "field_technician",
  "mediator"
] as const;

export type CastRole = (typeof CAST_ROLES)[number];

/**
 * Cast identity to job. Content, not state.
 *
 * A character id absent from this table simply holds no job a rule knows about,
 * which is the same answer the game already gives for a settlement with no
 * quartermaster.
 */
const ROLE_BY_CHARACTER_ID: Readonly<Record<string, CastRole>> = {
  ira_001: "cartographer",
  brann_001: "security_lead",
  mara_001: "quartermaster",
  tarek_001: "field_technician",
  sela_001: "mediator"
};

/** The job this character holds, or nothing if no rule knows of one. */
export function castRoleOf(characterId: string): CastRole | undefined {
  return ROLE_BY_CHARACTER_ID[characterId];
}

/**
 * The character holding `role` at `settlementId`, if there is one.
 *
 * Location still comes from the world, because a character's whereabouts *is*
 * state and does change. Only the job is derived.
 */
export function findCastMember(
  state: WorldState,
  settlementId: string,
  role: CastRole
): WorldState["party"][number] | undefined {
  return state.party.find(
    character => character.locationId === settlementId && castRoleOf(character.id) === role
  );
}
