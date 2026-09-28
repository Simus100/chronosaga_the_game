import type {
  CausalSource,
  EpidemicCause,
  EpidemicPressureState,
  StateChange
} from "@paa/game-types";
import { requireFiniteResult, rounded } from "../state/numeric.js";

/**
 * The single writer of the epidemic.
 *
 * GQP-A stored the epidemic as a value plus a list of contributors, and the two
 * agreed in the bootstrap scenario only because the numbers were written that
 * way. Nothing kept them agreeing. Once choices and the World Tick both move the
 * pressure, a value that could drift from its causes would let the game show a
 * CRITICAL epidemic whose listed causes add up to STRAINED — and then there is
 * no honest answer to "why is it this bad".
 *
 * So the value is not written directly by anyone. A caller sets one cause's
 * magnitude, and this function recomputes the value as the sum of all causes.
 * The persistence boundary checks the same identity on every v2 save.
 *
 * One contributor per cause. Its `source` is the most recent authoritative
 * decision or rule that moved it; the full sequence of moves is in the
 * StateDelta stream and the resolved-decision history, which is where a
 * complete record belongs. Keeping a list of every past source per cause would
 * be the "algebra of contributors" the proof does not need.
 */

/** Total epidemic pressure is bounded by the persistence contract, 0..1. */
const MAXIMUM = 1;

function magnitudeOf(epidemic: EpidemicPressureState, cause: EpidemicCause): number {
  return epidemic.contributors.find(item => item.cause === cause)?.magnitude ?? 0;
}

function othersThan(epidemic: EpidemicPressureState, cause: EpidemicCause): number {
  return epidemic.contributors
    .filter(item => item.cause !== cause)
    .reduce((sum, item) => sum + item.magnitude, 0);
}

/** Code units, never locale: the order has to replay identically everywhere. */
function byCause(a: { cause: string }, b: { cause: string }): number {
  return a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0;
}

/**
 * Set one cause to `desired`, keep the value equal to the sum, and write
 * nothing unless the whole result is valid.
 *
 * Saturation, not refusal, at the edges — and deliberately so. A mitigation
 * cannot take a cause below nothing, and no cause can push the total past the
 * `0..1` range the persistence boundary already enforces. Both bounds are
 * normative; neither is a new rule. The recorded `StateChange` shows the value
 * that was actually written, so a shift that saturated is visible as one.
 */
export function writeEpidemicContributor(
  epidemic: EpidemicPressureState,
  cause: EpidemicCause,
  desired: number,
  source: CausalSource,
  changes: StateChange[]
): void {
  requireFiniteResult(desired, `epidemic contributor ${cause}`);

  const others = requireFiniteResult(othersThan(epidemic, cause), "epidemic contributors");
  const ceiling = Math.max(0, MAXIMUM - others);
  const before = magnitudeOf(epidemic, cause);
  const after = rounded(Math.min(ceiling, Math.max(0, desired)));
  const valueBefore = epidemic.value;
  const valueAfter = rounded(others + after);

  requireFiniteResult(after, `epidemic contributor ${cause}`);
  requireFiniteResult(valueAfter, "epidemic value");
  if (valueAfter < 0 || valueAfter > MAXIMUM) {
    throw new Error(`Epidemic value ${valueAfter} would leave its 0..1 range`);
  }

  // Nothing moved: no write, no StateChange, and the contributor keeps the
  // source that last changed it rather than being re-stamped for a no-op.
  if (after === before && valueAfter === valueBefore) return;

  // Everything is computed and checked. Only now does anything change.
  const existing = epidemic.contributors.find(item => item.cause === cause);
  if (existing) {
    existing.magnitude = after;
    existing.source = structuredClone(source);
  } else {
    epidemic.contributors.push({ cause, magnitude: after, source: structuredClone(source) });
  }
  epidemic.contributors.sort(byCause);
  epidemic.value = valueAfter;

  changes.push({
    type: "epidemicContributor",
    key: `epidemic.contributors.${cause}`,
    before,
    after
  });
  changes.push({ type: "epidemic", key: "epidemic.value", before: valueBefore, after: valueAfter });
}

/** Move one cause by `delta` — the form an authored effect takes. */
export function shiftEpidemicContributor(
  epidemic: EpidemicPressureState,
  cause: EpidemicCause,
  delta: number,
  source: CausalSource,
  changes: StateChange[]
): void {
  writeEpidemicContributor(epidemic, cause, magnitudeOf(epidemic, cause) + delta, source, changes);
}

/** The value the epidemic's causes add up to, rounded as the writer rounds it. */
export function epidemicSumOfCauses(epidemic: EpidemicPressureState): number {
  return rounded(epidemic.contributors.reduce((sum, item) => sum + item.magnitude, 0));
}
