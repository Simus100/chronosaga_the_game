/**
 * What a human reviewer contributes, kept apart from what they score.
 *
 * The 0-5 axes in `scoring.ts` answer "how good was this?". A hard failure
 * answers "may this be used at all?", and those are different questions with
 * different consequences. Keeping them in separate structures means a strong
 * prose score can never quietly average away a broken invariant, and a
 * disqualification never has to be expressed as a low number.
 *
 * Like scores, reviews live beside the evidence rather than inside it. A run
 * directory is written once; review files accumulate next to it.
 */

import { HARD_FAIL_CATEGORIES, type HardFail, type HardFailCategory } from './hard-fail.js';

/** One disqualification a person established by reading the output. */
export interface HumanHardFail {
  generationId: string;
  category: HardFailCategory;
  /** What was found, concretely enough for someone else to check. */
  detail: string;
  reviewedBy: string;
  reviewedAt: string;
}

/**
 * A reviewer's findings for one run.
 *
 * Separate from the score sheet on purpose: a reviewer may disqualify without
 * scoring, or score without disqualifying, and neither implies the other.
 */
export interface HumanReview {
  runId: string;
  suiteVersion: string;
  hardFails: HumanHardFail[];
}

export interface ReviewProblem {
  generationId?: string;
  field: string;
  message: string;
}

/**
 * Validate a review against the run it claims to review.
 *
 * `knownGenerationIds` is passed in rather than read from disk, so this stays a
 * pure function and review can never reach the evidence it is judging.
 */
export function validateHumanReview(
  review: HumanReview,
  knownGenerationIds: Set<string>,
): ReviewProblem[] {
  const problems: ReviewProblem[] = [];
  if (!review.runId) problems.push({ field: 'runId', message: 'a review must name its run' });

  for (const fail of review.hardFails) {
    const at = (field: string, message: string) =>
      problems.push({ generationId: fail.generationId, field, message });

    if (!knownGenerationIds.has(fail.generationId)) {
      at('generationId', 'disqualifies a generation that is not in the run');
    }
    if (!HARD_FAIL_CATEGORIES.includes(fail.category)) {
      at('category', `'${String(fail.category)}' is not one of the five locked categories`);
    }
    if (!fail.detail?.trim()) {
      at('detail', 'a disqualification must say what was found');
    }
    if (!fail.reviewedBy?.trim()) {
      at('reviewedBy', 'a disqualification needs an author');
    }
  }

  return problems;
}

/** A reviewer's findings in the same shape the evaluator produces. */
export function asHardFails(review: HumanReview, generationId: string): HardFail[] {
  return review.hardFails
    .filter(fail => fail.generationId === generationId)
    .map(fail => ({
      category: fail.category,
      detail: fail.detail,
      determinedBy: 'human' as const,
    }));
}

/** Every generation this review disqualified. */
export function disqualifiedGenerations(review: HumanReview): Set<string> {
  return new Set(review.hardFails.map(fail => fail.generationId));
}
