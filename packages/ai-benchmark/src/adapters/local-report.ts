/**
 * The authoritative way to publish an official local comparison.
 *
 * `buildComparisonWithTrustedCheckout` takes the checkout identity as an
 * argument, which is the right shape for a unit test and the wrong shape for a
 * guarantee: a caller can hand it
 * `{ gitCommit: run.metadata.gitCommit, gitDirty: false }` and satisfy the
 * binding without anybody having asked Git anything.
 *
 * Removing that argument was not enough on its own. An earlier version of this
 * function still took a `repositoryRoot`, which is the same "trust me" a level
 * along: the identity Git returns is real, but it belongs to whichever checkout
 * the caller pointed at. Evaluator code from checkout B could authenticate a run
 * from commit A simply by naming a clean copy of A elsewhere on disk.
 *
 * So there is no path parameter either. The repository is derived from the
 * location of **this file** — the code that is actually doing the evaluating —
 * so the invariant is *the code evaluates itself*, not *the caller tells the code
 * which repository to evaluate*.
 *
 * `process.cwd()` is deliberately not consulted: a process can be launched from
 * anywhere, which would hand the choice straight back to the caller. Nor is any
 * environment variable, nor anything in the run's own metadata.
 *
 * Reached through `@paa/ai-benchmark/local-report`. The package root stays pure
 * and imports nothing from `node:`.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkSuite } from '../case.js';
import type { BenchmarkProfile, BenchmarkRun } from '../result.js';
import type { HumanReview } from '../human-review.js';
import type { ScoreSheet } from '../scoring.js';
import type { ComparisonReport } from '../report.js';
import { buildOfficialComparisonFromRepository } from './repository-report.js';

/**
 * The directory holding this module, whatever it was loaded from.
 *
 * Git walks upwards from a working directory to find its worktree, so pointing
 * it here finds the checkout containing the evaluator — from `src/` under a test
 * runner, from `dist/` after a build, and from either on Windows or Linux, since
 * `fileURLToPath` is what turns a file URL into a path both places.
 */
function executingCheckoutDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Build an official Lite-versus-Standard comparison from the checkout this code
 * is running out of.
 */
export function buildLocalOfficialComparison(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles?: BenchmarkProfile[],
  sheet?: ScoreSheet | null,
  review?: HumanReview | null,
): ComparisonReport {
  return buildOfficialComparisonFromRepository(
    suite,
    run,
    profiles,
    sheet,
    review,
    executingCheckoutDirectory(),
  );
}
