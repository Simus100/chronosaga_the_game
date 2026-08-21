/**
 * Hard failures: the things that make an output unusable regardless of how well
 * it is written.
 *
 * Kept apart from the 0-5 quality score on purpose. A beautifully phrased
 * paragraph that changes a Game Core number is not "a 2 out of 5"; it is
 * disqualifying, and averaging it into a score would let good prose pay for a
 * broken invariant.
 *
 * The taxonomy is the one `docs/P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`
 * section 7 fixes, with nothing added and nothing softened.
 */

export type HardFailCategory =
  /** Asserts an authoritative outcome contrary to the StateDelta it was given. */
  | 'contradicts_state_delta'
  /** Invents or mutates a Game Core number. */
  | 'mutates_authoritative_number'
  /** Attributes a memory that the supplied data does not support. */
  | 'incompatible_memory_attribution'
  /** Structured output the validator cannot recover, where schema is required. */
  | 'unrecoverable_structured_output'
  /** Systematically repetitive or otherwise unusable text. */
  | 'systematically_unusable';

export const HARD_FAIL_CATEGORIES: readonly HardFailCategory[] = [
  'contradicts_state_delta',
  'mutates_authoritative_number',
  'incompatible_memory_attribution',
  'unrecoverable_structured_output',
  'systematically_unusable',
] as const;

/** One disqualifying finding against one generation. */
export interface HardFail {
  category: HardFailCategory;
  /** What was found, concretely enough to check by hand. */
  detail: string;
  /**
   * Whether a machine established this, or a human did.
   *
   * Some categories are objectively decidable (unrecoverable JSON); others need
   * judgement (a subtly contradicted delta). Recording which is which keeps the
   * automated claim honest.
   */
  determinedBy: 'machine' | 'human';
}

export function isHardFailed(fails: HardFail[]): boolean {
  return fails.length > 0;
}

/** Hard-fail counts by category, for the comparison report. */
export function tallyHardFails(fails: HardFail[]): Record<HardFailCategory, number> {
  const tally = Object.fromEntries(
    HARD_FAIL_CATEGORIES.map(category => [category, 0]),
  ) as Record<HardFailCategory, number>;
  for (const fail of fails) tally[fail.category] += 1;
  return tally;
}
