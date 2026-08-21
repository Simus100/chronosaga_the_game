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
  hardFailedCases: number;
  hardFailsByCategory: Record<HardFailCategory, number>;
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
 * Refuse to compare profiles that did not see the same cases.
 *
 * Returns the offending case ids; empty means the comparison is fair.
 */
export function inputParityProblems(run: BenchmarkRun, profiles: BenchmarkProfile[]): string[] {
  if (profiles.length < 2) return [];
  const sets = profiles.map(profile => caseIdsFor(run, profile));
  const union = new Set(sets.flatMap(set => [...set]));
  const problems: string[] = [];
  for (const caseId of union) {
    const missing = profiles.filter((_, index) => !sets[index]!.has(caseId));
    if (missing.length > 0) problems.push(`${caseId} missing for ${missing.join(', ')}`);
  }
  return problems.sort();
}

function summarise(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profile: BenchmarkProfile,
  sheet: ScoreSheet | null,
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

  const acceptanceByTask: Record<string, { attempted: number; accepted: number }> = {};
  let deterministicFailures = 0;
  let heuristicWarnings = 0;
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

    let caseHardFailed = false;
    for (const attempt of attempts) {
      const evaluation = evaluateObjectively(testCase, attempt);
      deterministicFailures += evaluation.deterministicFailures;
      heuristicWarnings += evaluation.heuristicWarnings;
      for (const fail of evaluation.hardFails) {
        hardFailsByCategory[fail.category] += 1;
        caseHardFailed = true;
      }
    }
    if (caseHardFailed) hardFailedCases += 1;
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
    hardFailedCases,
    hardFailsByCategory,
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
): ComparisonReport {
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
    profiles: profiles.map(profile => summarise(suite, run, profile, sheet)),
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
    lines.push(`  hard-failed cases      ${profile.hardFailedCases}`);
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
