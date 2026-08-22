/**
 * The authoritative way to publish an official local comparison.
 *
 * `buildComparisonWithTrustedCheckout` takes the checkout identity as an
 * argument, which is the right shape for a unit test and the wrong shape for a
 * guarantee: a caller can hand it
 * `{ gitCommit: run.metadata.gitCommit, gitDirty: false }` and satisfy the
 * binding without anybody having asked Git anything. The evidence would then be
 * vouching for itself, which is exactly what the binding exists to prevent.
 *
 * So this function has **no checkout parameter**. There is nothing to forge
 * because there is nothing to pass: the identity comes from
 * {@link readLocalCheckout}, which reads the repository on disk. Reproducibility
 * follows from the API a caller can reach rather than from remembering which
 * helper to call.
 *
 * This is not a defence against someone editing the source — nothing in a
 * library is. It is a defence against an ordinary caller, or a CLI written next
 * month, accidentally saying "trust me, this checkout is commit X" when the
 * code is perfectly capable of looking.
 *
 * Reached through `@paa/ai-benchmark/local-report`. The package root stays pure
 * and imports nothing from `node:`.
 */
import type { BenchmarkSuite } from '../case.js';
import type { BenchmarkProfile, BenchmarkRun } from '../result.js';
import type { HumanReview } from '../human-review.js';
import type { ScoreSheet } from '../scoring.js';
import { buildComparisonWithTrustedCheckout, type ComparisonReport } from '../report.js';
import { readLocalCheckout } from './local-checkout.js';

/**
 * Build an official Lite-versus-Standard comparison from this checkout.
 *
 * @param repositoryRoot which repository to ask about; defaults to the process's
 *   own working directory. It selects a repository, and is not an identity: what
 *   the commit *is*, and whether the tree is clean, is read from Git either way.
 */
export function buildLocalOfficialComparison(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles?: BenchmarkProfile[],
  sheet?: ScoreSheet | null,
  review?: HumanReview | null,
  repositoryRoot?: string,
): ComparisonReport {
  // Read first, unconditionally. `null` — no repository, no Git, an unreadable
  // status — travels straight through to the binding, which refuses it, because
  // not knowing which code is reporting must never read as knowing.
  const checkout = readLocalCheckout(repositoryRoot);
  return buildComparisonWithTrustedCheckout(suite, run, profiles, sheet, review, checkout);
}
