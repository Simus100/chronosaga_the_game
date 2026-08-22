/**
 * Binding a report to the checkout that produced the run it reports on.
 *
 * The suite digest, the model lock and the runtime lock are all compared against
 * *this* checkout, and each refuses a mismatch. Between them they establish that
 * the working tree describes the same suite, the same GGUF bytes and the same
 * llama.cpp build the run recorded. What none of them establishes is that the
 * working tree is the same **code**.
 *
 * A run produced at commit A, reported from commit B, with those three locks
 * unchanged and the evaluator's semantics changed, still published an official
 * report naming commit A while every judgement in it came from B. `gitCommit`
 * was checked for being forty hex characters and nothing more, which proves a
 * string is a string.
 *
 * So an official comparison now requires a **trusted** checkout identity: the
 * commit the reporting code was actually built from, read from the repository by
 * something outside this library, and the working tree clean. Evidence cannot
 * supply it — that is the whole point, and taking `metadata.gitCommit` as the
 * answer would be asking the run to vouch for itself.
 *
 * This module is pure. Reading Git is the adapter's job; deciding what the
 * answer means is this one's.
 */
import type { BenchmarkRun } from './result.js';

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/**
 * The checkout the reporting code was built from.
 *
 * Obtained from the repository, never from a run. `gitDirty` matters as much as
 * the commit: uncommitted changes to the evaluator mean the report was produced
 * by code that exists nowhere but one machine.
 */
export interface ReportCheckoutIdentity {
  gitCommit: string;
  gitDirty: boolean;
}

/**
 * Why this checkout may not report on this run, or an empty list if it may.
 *
 * The four refusals are kept distinct because they mean different things to
 * whoever hit them: no identity at all is a wiring mistake, an undeterminable
 * commit is a broken environment, a dirty tree is a discipline problem, and a
 * mismatch is the actual reproducibility failure.
 */
export function checkoutBindingProblems(
  run: BenchmarkRun,
  checkout: ReportCheckoutIdentity | null,
): string[] {
  if (checkout === null) {
    return [
      'no trusted checkout identity was supplied, so there is nothing to prove this report ' +
        'was produced by the code the run was produced by; an official comparison needs one',
    ];
  }

  if (!FULL_COMMIT.test(checkout.gitCommit)) {
    return [
      `the reporting checkout's commit could not be determined (got ` +
        `'${checkout.gitCommit}'); without it the report cannot say which code interpreted ` +
        'the evidence',
    ];
  }

  const problems: string[] = [];
  if (checkout.gitDirty) {
    problems.push(
      'the reporting checkout has uncommitted changes, so the code that produced this report ' +
        'exists nowhere else and nobody can reproduce it',
    );
  }
  if (run.metadata.gitCommit !== checkout.gitCommit) {
    problems.push(
      `the run was produced at ${run.metadata.gitCommit} but this report is being produced at ` +
        `${checkout.gitCommit}; the locks may still match while the evaluator does not`,
    );
  }
  return problems;
}
