import type { WorldState } from "@paa/game-types";
import { resolveSettlementTarget } from "./resource-authority.js";
import { validateSystemicWorldState } from "./validate-systemic-state.js";

/**
 * The boundary between stored bytes and trusted authoritative state.
 *
 * A save is untrusted input. It arrives from SQLite, which means it arrives
 * from a file on someone's disk, and the only thing a `WorldState` annotation
 * would prove about it is that somebody wrote the annotation. So the value
 * enters as `unknown` and leaves as a `WorldState` only by passing every check,
 * or does not leave at all.
 *
 * The result is a discriminated union rather than a throw, because the caller
 * has to tell four different situations apart — no save, unreadable bytes,
 * wrong schema, invalid state — and an exception collapses them into one.
 */
export type SystemicLoadResult =
  | { readonly ok: true; readonly state: WorldState }
  | { readonly ok: false; readonly reason: SystemicLoadFailure; readonly errors: string[] };

export type SystemicLoadFailure =
  | "malformed_json"
  | "invalid_world_state"
  | "inconsistent_projection"
  | "campaign_identity_mismatch";

/** What a save produced, or why it could not be produced. */
export type SystemicSaveResult =
  | { readonly ok: true; readonly campaignId: string; readonly payload: string }
  | { readonly ok: false; readonly errors: string[] };

/**
 * Whether the compatibility projection agrees with the authority it mirrors.
 *
 * M1-C/1 made `settlement.resourceStock` authoritative for the resources a
 * settlement stocks, and `WorldState.resources` their projection. A save where
 * the two disagree is internally incoherent: our own writer cannot produce one,
 * so a divergent save means the bytes were altered or written by something that
 * did not understand the rule.
 *
 * Such a save is **rejected, not repaired**. Silently rebuilding the projection
 * would hide the corruption and hand the player a world that quietly differs
 * from the one they saved — and it would make the two-truths bug M1-C/1 just
 * removed unobservable if it ever returned. A future versioned migration may
 * normalise an *older* schema on purpose; that is a different, explicit act.
 *
 * Campaign resources — those no settlement stocks — are authoritative in the
 * flat map and have nothing to be compared against.
 */
function projectionProblems(state: WorldState): string[] {
  const target = resolveSettlementTarget(state);
  if (target.kind !== "settlement") return [];

  const problems: string[] = [];
  for (const [resource, authoritative] of Object.entries(target.settlement.resourceStock)) {
    const projected = state.resources[resource];
    if (projected === undefined) {
      problems.push(
        `WorldState.resources.${resource} is missing while ` +
          `${target.settlement.id}.resourceStock.${resource} is ${authoritative}`
      );
      continue;
    }
    if (projected !== authoritative) {
      problems.push(
        `WorldState.resources.${resource} is ${projected} but the authoritative ` +
          `${target.settlement.id}.resourceStock.${resource} is ${authoritative}`
      );
    }
  }
  return problems;
}

/**
 * Prepare a world for storage, and derive its key from the world itself.
 *
 * The storage command takes a campaign id and a payload as two independent
 * arguments, which means nothing stops a caller from filing campaign `beta`
 * under the key `alpha` — and SQL key isolation cannot notice, because both
 * values are exactly what it was told to store. The mismatch would only appear
 * later, as a campaign that loads someone else's world.
 *
 * So the id is not asked for. It is read from the state after that state has
 * been proven valid, which makes the two impossible to disagree at the point
 * where they are written.
 *
 * The same invariants as loading are applied here, and for the same reason: a
 * save that would be refused on the way in should never reach the disk on the
 * way out. Failing at save time costs one refused click; failing at load time
 * costs the campaign.
 */
export function serializeSystemicWorldState(input: unknown): SystemicSaveResult {
  const validation = validateSystemicWorldState(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const state = input as WorldState;

  const divergent = projectionProblems(state);
  if (divergent.length > 0) return { ok: false, errors: divergent };

  return {
    ok: true,
    campaignId: state.campaignId,
    payload: JSON.stringify(state)
  };
}

/**
 * Turn stored JSON text into a trusted `WorldState`, or say precisely why not.
 *
 * Takes the raw text rather than a parsed value on purpose: parsing is where
 * malformed bytes announce themselves, and doing it here means the caller
 * cannot accidentally hand on a half-parsed object.
 */
export function loadSystemicWorldState(raw: string, expectedCampaignId?: string): SystemicLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      ok: false,
      reason: "malformed_json",
      errors: [`stored systemic save is not valid JSON: ${(error as Error).message}`]
    };
  }

  const validation = validateSystemicWorldState(parsed);
  if (!validation.ok) {
    return { ok: false, reason: "invalid_world_state", errors: validation.errors };
  }

  // Only now is the annotation earned.
  const state = parsed as WorldState;

  const divergent = projectionProblems(state);
  if (divergent.length > 0) {
    return { ok: false, reason: "inconsistent_projection", errors: divergent };
  }

  // The row was filed under a key. If the world inside names a different
  // campaign, one of the two is wrong and there is no way to tell which — so
  // neither is used. Rust cannot make this check: it never parses the payload,
  // and teaching it to would give the project two opinions about what a world
  // is.
  if (expectedCampaignId !== undefined && state.campaignId !== expectedCampaignId) {
    return {
      ok: false,
      reason: "campaign_identity_mismatch",
      errors: [
        `the save stored under '${expectedCampaignId}' contains campaign ` +
          `'${state.campaignId}'`
      ]
    };
  }

  return { ok: true, state };
}
