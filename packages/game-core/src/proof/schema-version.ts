import type { SystemicSimulationState, SystemicSimulationStateV2 } from "@paa/game-types";

/**
 * The simulation schema versions this build can correctly interpret.
 *
 * Declared once, as a closed set, because two authorities disagreeing about
 * which versions are readable is the same class of defect GQP-0 removed from
 * the effect applicators: a boundary that accepts a version nobody can apply.
 *
 * Fail-closed is the whole point. A build that meets a version outside this
 * set must refuse the world rather than open it and ignore the fields it does
 * not recognise — GQP spec 24.1 rule 5. Silently dropping authoritative state
 * is worse than refusing to load, because the player keeps playing and the
 * next save writes the loss back to disk.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/**
 * The version the Gameplay Quality Proof is created at.
 *
 * The proof scenario is built directly as v2 (spec 24.1 rule 3). A v1 world
 * never becomes a proof world by being opened: there is no automatic
 * migration, by rule 4.
 */
export const PROOF_SCHEMA_VERSION = 2 satisfies SupportedSchemaVersion;

/** The version M1 saves carry, and keep carrying. */
export const BASELINE_SCHEMA_VERSION = 1 satisfies SupportedSchemaVersion;

/**
 * Whether this build can interpret the declared version.
 *
 * Deliberately strict about the *type* as well as the value: a save is
 * untrusted input, and `"2"` is not `2`. A loose comparison here would let a
 * string version through to code that then compares it against a number and
 * takes the wrong branch.
 */
export function isSupportedSchemaVersion(value: unknown): value is SupportedSchemaVersion {
  return (
    typeof value === "number" &&
    (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(value)
  );
}

/**
 * Narrow a simulation to the proof schema, or say it is not one.
 *
 * The union in `@paa/game-types` already forces a caller to narrow before
 * reading proof state. This is the runtime half of the same rule, for callers
 * holding a state whose version they have not yet inspected.
 */
export function isProofSimulation(
  simulation: SystemicSimulationState
): simulation is SystemicSimulationStateV2 {
  return simulation.schemaVersion === PROOF_SCHEMA_VERSION;
}
