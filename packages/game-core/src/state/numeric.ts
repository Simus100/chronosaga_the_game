/**
 * Numeric primitives shared by every authoritative writer.
 *
 * `rounded` lived inside `run-world-tick.ts`. GQP-B adds two more writers of
 * bounded authoritative numbers — the epidemic and node condition — and a
 * second copy of the rounding rule would be the same defect GQP-0 removed from
 * the effect applicators: two implementations of one contract, waiting to
 * disagree. So the rule moves here, unchanged, and both paths import it.
 */

/**
 * Round to four decimals, without inventing an infinity on the way.
 *
 * Rounding means scaling by `10 ** digits`, rounding, and scaling back, and the
 * scaling step overflows for any input above `Number.MAX_VALUE / factor`,
 * about `1.8e304`. Returning `value` unchanged there is the correct result,
 * not a workaround: a double of that magnitude has no fractional part left to
 * round, so rounding is the identity. A non-finite *input* still comes back
 * non-finite — this corrects arithmetic, it does not launder a broken value.
 */
export function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  const scaled = Math.round((value + Number.EPSILON) * factor);
  if (!Number.isFinite(scaled)) return value;
  return scaled / factor;
}

/** Refuse a non-finite result before anything is written with it. */
export function requireFiniteResult(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} produced a non-finite value: ${String(value)}`);
  }
  return value;
}

/**
 * Keep a value inside a range the contract already defines.
 *
 * This is saturation at a *normative* bound, which is a different act from the
 * caps GQP-0 and #34 refused to invent. A resource stock has no ceiling in any
 * document, so clamping one would have created a rule. Node condition and the
 * epidemic are validated to `0..1` by the persistence boundary itself; keeping
 * them there preserves a rule that already exists. The `StateChange` records
 * what actually happened, so a shift that saturated is visible as such.
 */
export function withinUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}
