/**
 * Internal: the comparison, given a repository to ask about.
 *
 * Not exported from the package under any subpath. It exists so temporary Git
 * repositories can be driven deterministically in tests, which needs a path
 * parameter, and a path parameter is precisely what the public API must not
 * have — choosing which repository Git is asked about is the same "trust me"
 * as supplying the commit outright, one level of indirection along.
 *
 * `buildLocalOfficialComparison` is the public path, and it derives the
 * repository from the location of this code rather than accepting one.
 */
import type { BenchmarkSuite } from '../case.js';
import type { BenchmarkProfile, BenchmarkRun } from '../result.js';
import type { HumanReview } from '../human-review.js';
import type { ScoreSheet } from '../scoring.js';
import { buildComparisonWithTrustedCheckout, type ComparisonReport } from '../report.js';
import { readLocalCheckout } from './local-checkout.js';

export function buildOfficialComparisonFromRepository(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles: BenchmarkProfile[] | undefined,
  sheet: ScoreSheet | null | undefined,
  review: HumanReview | null | undefined,
  repositoryRoot: string,
): ComparisonReport {
  // Read first, unconditionally. `null` — no repository, no Git, an unreadable
  // status — travels straight through to the binding, which refuses it, because
  // not knowing which code is reporting must never read as knowing.
  const checkout = readLocalCheckout(repositoryRoot);
  return buildComparisonWithTrustedCheckout(suite, run, profiles, sheet, review, checkout);
}
