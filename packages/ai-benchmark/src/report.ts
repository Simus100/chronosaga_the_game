/**
 * Lite against Standard, on identical inputs.
 *
 * The comparison only means anything if both profiles saw exactly the same
 * cases, so that is checked rather than assumed: a report over mismatched case
 * sets refuses to be built.
 */

import type { BenchmarkCase, BenchmarkSuite, BenchmarkTask } from './case.js';
import type { BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from './result.js';
import { evaluateObjectively } from './objective.js';
import { HARD_FAIL_CATEGORIES, type HardFailCategory } from './hard-fail.js';
import { meanByAxis, scoresForProfile, type ScoreAxis, type ScoreSheet } from './scoring.js';
import { asHardFails, type HumanReview } from './human-review.js';

export interface ProfileSummary {
  profile: BenchmarkProfile;
  artifactFilename: string;
  sha256: string;
  casesAttempted: number;
  /** A case counts as accepted if any attempt for it was accepted. */
  casesAccepted: number;
  acceptanceRate: number;
  firstAttemptAcceptanceRate: number;
  retries: number;
  fallbacks: number;
  medianLatencyMs: number | null;
  meanTokensPerSecond: number | null;
  deterministicFailures: number;
  heuristicWarnings: number;
  /** Cases disqualified by the deterministic evaluator. */
  machineHardFailedCases: number;
  /** Cases a human reviewer disqualified. Never inferred from a low score. */
  humanHardFailedCases: number;
  /** Either kind. What a reader wants when asking "how many were unusable?". */
  hardFailedCases: number;
  hardFailsByCategory: Record<HardFailCategory, number>;
  humanHardFailsByCategory: Record<HardFailCategory, number>;
  /** Heuristic findings queued for review, which disqualify nothing. */
  reviewSignals: number;
  acceptanceByTask: Record<string, { attempted: number; accepted: number }>;
  humanMeanByAxis: Record<ScoreAxis, number | null> | null;
}

export interface ComparisonReport {
  runId: string;
  suiteVersion: string;
  gitCommit: string;
  generatedAt: string;
  caseCount: number;
  profiles: ProfileSummary[];
  /** Cases where the two profiles disagreed on acceptance. */
  divergentCases: Array<{ caseId: string; task: BenchmarkTask; acceptedBy: BenchmarkProfile[] }>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The set of cases a profile was actually run against. */
export function caseIdsFor(run: BenchmarkRun, profile: BenchmarkProfile): Set<string> {
  return new Set(
    run.generations.filter(generation => generation.profile === profile).map(generation => generation.caseId),
  );
}

/**
 * The generation settings a Lite-versus-Standard quality comparison controls.
 *
 * Varying any of these between profiles measures the setting, not the model.
 * Context size is included deliberately: if P0.5-C later varies it on purpose,
 * that belongs in a separate matrix dimension rather than mixed into one
 * comparison, and this is what forces that conversation to happen.
 */
const CONTROLLED_SETTINGS = [
  'contextSize',
  'maxOutputTokens',
  'temperature',
  'topP',
  'seed',
  'reasoning',
] as const;

function controlledSignature(generation: BenchmarkGeneration): string {
  const context = generation.context as unknown as Record<string, unknown>;
  return CONTROLLED_SETTINGS.map(key => `${key}=${JSON.stringify(context[key] ?? null)}`).join(' ');
}

/**
 * Refuse to compare profiles whose runs were not actually comparable.
 *
 * Case ids alone are necessary and nowhere near sufficient. Four things are
 * checked, each of which has silently ruined somebody's benchmark before:
 *
 * 1. **Coverage** — both profiles saw every case.
 * 2. **A coherent attempt history** — every case a profile ran must start at
 *    attempt 1 and number its attempts contiguously. A retry only one profile
 *    needed is valid evidence; a retry with nothing before it is a broken
 *    record, and reading it as "one model needed a second try" would invert what
 *    actually happened.
 * 3. **Identical inputs, per attempt** — the recorded fingerprint matches for
 *    each `(case, attempt)` pair present for more than one profile. Comparing
 *    whole cases would be wrong, because a retry legitimately asks a different
 *    question. What may never differ is what the two profiles were asked *on the
 *    same attempt number*.
 * 4. **One artifact per profile** — a run that swapped models halfway measures
 *    neither of them.
 * 5. **Controlled settings** — the sampling and context were held equal where
 *    the comparison claims to hold them equal.
 *
 * Duplicate `(case, profile, attempt)` rows are rejected outright: two rows
 * claiming to be the same attempt make every count downstream ambiguous.
 *
 * Returns human-readable problems; empty means the comparison is fair.
 */
export function inputParityProblems(run: BenchmarkRun, profiles: BenchmarkProfile[]): string[] {
  const problems: string[] = [];

  // Duplicates first: everything below counts rows, and a duplicated attempt
  // would quietly double one of those counts.
  const attemptKeys = new Set<string>();
  for (const generation of run.generations) {
    const key = `${generation.caseId}|${generation.profile}|${generation.attempt}`;
    if (attemptKeys.has(key)) {
      problems.push(
        `duplicate attempt recorded: ${generation.caseId} / ${generation.profile} / attempt ${generation.attempt}`,
      );
    }
    attemptKeys.add(key);
  }

  // 3 and 4 apply to a single profile too: a run that changed model or settings
  // mid-flight is incoherent even before anything is compared against it.
  for (const profile of profiles) {
    const generations = run.generations.filter(generation => generation.profile === profile);
    if (generations.length === 0) continue;

    const digests = new Set(generations.map(generation => generation.artifact.sha256));
    if (digests.size > 1) {
      problems.push(
        `${profile} mixed ${digests.size} artifact identities in one run: ${[...digests]
          .map(digest => digest.slice(0, 12))
          .sort()
          .join(', ')}`,
      );
    }

    const signatures = new Set(generations.map(controlledSignature));
    if (signatures.size > 1) {
      problems.push(`${profile} varied its controlled generation settings within one run`);
    }

    // Attempt histories, per case. This holds for a single profile too: a case
    // whose only row is attempt 2 is a broken record whatever it is compared
    // against, and a gap means a row was lost rather than never written.
    const attemptsByCase = new Map<string, Set<number>>();
    for (const generation of generations) {
      const bucket = attemptsByCase.get(generation.caseId) ?? new Set<number>();
      bucket.add(generation.attempt);
      attemptsByCase.set(generation.caseId, bucket);
    }
    for (const [caseId, attempts] of attemptsByCase) {
      if (!attempts.has(1)) {
        problems.push(
          `${caseId} has no attempt 1 for ${profile}: a retry cannot be the first thing recorded`,
        );
        continue;
      }
      const highest = Math.max(...attempts);
      const gaps = Array.from({ length: highest }, (_, index) => index + 1).filter(
        attempt => !attempts.has(attempt),
      );
      if (gaps.length > 0) {
        problems.push(
          `${caseId} for ${profile} records attempt ${highest} without attempt ${gaps.join(', ')}`,
        );
      }
    }
  }

  if (profiles.length < 2) return problems.sort();

  const sets = profiles.map(profile => caseIdsFor(run, profile));
  const union = new Set(sets.flatMap(set => [...set]));
  for (const caseId of union) {
    const missing = profiles.filter((_, index) => !sets[index]!.has(caseId));
    if (missing.length > 0) {
      problems.push(`${caseId} missing for ${missing.join(', ')}`);
      continue;
    }

    const rows = run.generations.filter(
      generation => generation.caseId === caseId && profiles.includes(generation.profile),
    );

    // Attempt 1 is the comparison. Every compared profile must have one, or
    // there is no common ground to compare on: one model's first try against
    // another model's second is not a measurement of either.
    const withoutFirst = profiles.filter(
      profile =>
        !rows.some(generation => generation.profile === profile && generation.attempt === 1),
    );
    if (withoutFirst.length > 0) {
      problems.push(`${caseId} has no attempt 1 for ${withoutFirst.join(', ')}`);
      continue;
    }

    // Compare within an attempt number, not across the whole case. Attempt 1
    // must match; a shared retry must match; a retry only one profile made is
    // valid evidence and is left alone.
    const attempts = new Set(rows.map(generation => generation.attempt));
    for (const attempt of [...attempts].sort((a, b) => a - b)) {
      const forAttempt = rows.filter(generation => generation.attempt === attempt);
      const profilesPresent = new Set(forAttempt.map(generation => generation.profile));
      if (profilesPresent.size < 2) continue;

      const fingerprints = new Set(forAttempt.map(generation => generation.inputFingerprint));
      if (fingerprints.size > 1) {
        problems.push(
          `${caseId} attempt ${attempt} was asked differently of each profile: ` +
            `${fingerprints.size} fingerprints`,
        );
      }
    }
  }

  // Across profiles, the controlled settings must also agree.
  const perProfile = profiles
    .map(profile => {
      const first = run.generations.find(generation => generation.profile === profile);
      return first ? controlledSignature(first) : null;
    })
    .filter((signature): signature is string => signature !== null);
  if (new Set(perProfile).size > 1) {
    problems.push('the profiles were run with different controlled generation settings');
  }

  return problems.sort();
}

/**
 * Whether a score sheet or review actually belongs to the run being reported.
 *
 * Both structures already carry `runId` and `suiteVersion`; this makes those
 * fields load-bearing instead of decorative.
 */
export function attributionProblems(
  what: string,
  judgement: { runId: string; suiteVersion: string } | null,
  run: BenchmarkRun,
): string[] {
  if (judgement === null) return [];
  const problems: string[] = [];
  if (judgement.runId !== run.metadata.runId) {
    problems.push(
      `the ${what} was written for run '${judgement.runId}', not '${run.metadata.runId}'`,
    );
  }
  if (judgement.suiteVersion !== run.metadata.suiteVersion) {
    problems.push(
      `the ${what} scored suite '${judgement.suiteVersion}', not '${run.metadata.suiteVersion}'`,
    );
  }
  return problems;
}

/**
 * Every generation whose recorded task disagrees with the suite.
 *
 * A row that mislabels its own task quietly corrupts every per-task breakdown,
 * and nothing else would notice.
 */
export function taskMismatches(suite: BenchmarkSuite, run: BenchmarkRun): string[] {
  const cases = new Map(suite.cases.map(entry => [entry.id, entry]));
  const problems: string[] = [];
  for (const generation of run.generations) {
    const declared = cases.get(generation.caseId);
    if (!declared) {
      problems.push(`${generation.id} names case ${generation.caseId}, which the suite does not contain`);
      continue;
    }
    if (declared.task !== generation.task) {
      problems.push(
        `${generation.id} claims task '${generation.task}' but ${generation.caseId} is '${declared.task}'`,
      );
    }
  }
  return problems.sort();
}

function summarise(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profile: BenchmarkProfile,
  sheet: ScoreSheet | null,
  review: HumanReview | null,
): ProfileSummary {
  const cases = new Map<string, BenchmarkCase>(suite.cases.map(entry => [entry.id, entry]));
  const generations = run.generations.filter(generation => generation.profile === profile);

  const byCase = new Map<string, BenchmarkGeneration[]>();
  for (const generation of generations) {
    const bucket = byCase.get(generation.caseId) ?? [];
    bucket.push(generation);
    byCase.set(generation.caseId, bucket);
  }

  const hardFailsByCategory = Object.fromEntries(
    HARD_FAIL_CATEGORIES.map(category => [category, 0]),
  ) as Record<HardFailCategory, number>;
  const humanHardFailsByCategory = Object.fromEntries(
    HARD_FAIL_CATEGORIES.map(category => [category, 0]),
  ) as Record<HardFailCategory, number>;

  const acceptanceByTask: Record<string, { attempted: number; accepted: number }> = {};
  let deterministicFailures = 0;
  let heuristicWarnings = 0;
  let reviewSignals = 0;
  let machineHardFailedCases = 0;
  let humanHardFailedCases = 0;
  let hardFailedCases = 0;
  let firstAttemptAccepted = 0;

  for (const [caseId, attempts] of byCase) {
    const testCase = cases.get(caseId);
    if (!testCase) continue;

    const accepted = attempts.some(attempt => attempt.accepted);
    const bucket = (acceptanceByTask[testCase.task] ??= { attempted: 0, accepted: 0 });
    bucket.attempted += 1;
    if (accepted) bucket.accepted += 1;
    if (attempts.some(attempt => attempt.attempt === 1 && attempt.accepted)) firstAttemptAccepted += 1;

    let caseMachineHardFailed = false;
    let caseHumanHardFailed = false;
    for (const attempt of attempts) {
      const evaluation = evaluateObjectively(testCase, attempt);
      deterministicFailures += evaluation.deterministicFailures;
      heuristicWarnings += evaluation.heuristicWarnings;
      reviewSignals += evaluation.reviewSignals.length;
      for (const fail of evaluation.hardFails) {
        hardFailsByCategory[fail.category] += 1;
        caseMachineHardFailed = true;
      }
      for (const fail of review ? asHardFails(review, attempt.id) : []) {
        humanHardFailsByCategory[fail.category] += 1;
        caseHumanHardFailed = true;
      }
    }
    if (caseMachineHardFailed) machineHardFailedCases += 1;
    if (caseHumanHardFailed) humanHardFailedCases += 1;
    // A case is unusable if either kind of review disqualified it. Prose scores
    // never enter this count.
    if (caseMachineHardFailed || caseHumanHardFailed) hardFailedCases += 1;
  }

  const casesAttempted = byCase.size;
  const casesAccepted = [...byCase.values()].filter(attempts => attempts.some(a => a.accepted)).length;
  const first = generations.find(generation => generation.artifact.profileId === profile);

  const humanMeanByAxis = sheet
    ? meanByAxis(
        scoresForProfile(
          sheet,
          new Map(run.generations.map(generation => [generation.id, generation.profile])),
          profile,
        ),
      )
    : null;

  return {
    profile,
    artifactFilename: first?.artifact.artifactFilename ?? '',
    sha256: first?.artifact.sha256 ?? '',
    casesAttempted,
    casesAccepted,
    acceptanceRate: casesAttempted === 0 ? 0 : casesAccepted / casesAttempted,
    firstAttemptAcceptanceRate: casesAttempted === 0 ? 0 : firstAttemptAccepted / casesAttempted,
    retries: generations.filter(generation => generation.retryUsed).length,
    fallbacks: generations.filter(generation => generation.fallbackUsed).length,
    medianLatencyMs: median(generations.map(generation => generation.latencyMs)),
    meanTokensPerSecond: mean(
      generations
        .map(generation => generation.tokensPerSecond)
        .filter((value): value is number => value !== null),
    ),
    deterministicFailures,
    heuristicWarnings,
    reviewSignals,
    machineHardFailedCases,
    humanHardFailedCases,
    hardFailedCases,
    hardFailsByCategory,
    humanHardFailsByCategory,
    acceptanceByTask,
    humanMeanByAxis,
  };
}

/**
 * Build the comparison.
 *
 * Throws when the profiles did not see identical inputs, because a report that
 * quietly compares different work is worse than no report.
 */
export function buildComparison(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles: BenchmarkProfile[] = ['lite', 'standard'],
  sheet: ScoreSheet | null = null,
  review: HumanReview | null = null,
): ComparisonReport {
  // Judgement from another run must never leak into this one. Generation ids are
  // stable and human-typeable, so an id alone is not proof of belonging: the run
  // and the suite version have to agree as well.
  const attribution = [
    ...attributionProblems('score sheet', sheet, run),
    ...attributionProblems('human review', review, run),
  ];
  if (attribution.length > 0) {
    throw new Error(`refusing judgement that belongs to another run: ${attribution.join('; ')}`);
  }

  const mismatches = taskMismatches(suite, run);
  if (mismatches.length > 0) {
    throw new Error(
      `the run mislabels the cases it claims to have run: ${mismatches.join('; ')}`,
    );
  }

  const parity = inputParityProblems(run, profiles);
  if (parity.length > 0) {
    throw new Error(
      `profiles did not see identical case inputs, so they cannot be compared: ${parity.join('; ')}`,
    );
  }

  const cases = new Map<string, BenchmarkCase>(suite.cases.map(entry => [entry.id, entry]));
  const divergentCases: ComparisonReport['divergentCases'] = [];
  const allCaseIds = new Set(run.generations.map(generation => generation.caseId));

  for (const caseId of [...allCaseIds].sort()) {
    const acceptedBy = profiles.filter(profile =>
      run.generations.some(
        generation => generation.caseId === caseId && generation.profile === profile && generation.accepted,
      ),
    );
    if (acceptedBy.length > 0 && acceptedBy.length < profiles.length) {
      const testCase = cases.get(caseId);
      if (testCase) divergentCases.push({ caseId, task: testCase.task, acceptedBy });
    }
  }

  return {
    runId: run.metadata.runId,
    suiteVersion: run.metadata.suiteVersion,
    gitCommit: run.metadata.gitCommit,
    generatedAt: new Date(0).toISOString(),
    caseCount: allCaseIds.size,
    profiles: profiles.map(profile => summarise(suite, run, profile, sheet, review)),
    divergentCases,
  };
}

/** A compact text table, for pasting into a report or an issue. */
export function renderComparison(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(`run ${report.runId} | suite ${report.suiteVersion} | commit ${report.gitCommit}`);
  lines.push(`${report.caseCount} case(s)`);
  lines.push('');
  for (const profile of report.profiles) {
    lines.push(`${profile.profile.toUpperCase()}  ${profile.artifactFilename}`);
    lines.push(`  sha256                 ${profile.sha256.slice(0, 16)}...`);
    lines.push(`  accepted               ${profile.casesAccepted}/${profile.casesAttempted}`);
    lines.push(`  first-attempt accepted ${(profile.firstAttemptAcceptanceRate * 100).toFixed(0)}%`);
    lines.push(`  retries / fallbacks    ${profile.retries} / ${profile.fallbacks}`);
    lines.push(`  median latency         ${profile.medianLatencyMs ?? '—'} ms`);
    lines.push(`  mean tokens/s          ${profile.meanTokensPerSecond?.toFixed(1) ?? '—'}`);
    lines.push(
      `  hard-failed cases      ${profile.hardFailedCases} ` +
        `(machine ${profile.machineHardFailedCases}, human ${profile.humanHardFailedCases})`,
    );
    lines.push(`  review signals         ${profile.reviewSignals}`);
    lines.push('');
  }
  if (report.divergentCases.length > 0) {
    lines.push('cases where the profiles disagreed:');
    for (const divergent of report.divergentCases) {
      lines.push(`  ${divergent.caseId} (${divergent.task}) accepted by ${divergent.acceptedBy.join(', ')}`);
    }
  }
  return lines.join('\n');
}
