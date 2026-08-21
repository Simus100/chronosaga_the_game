import { describe, expect, it } from 'vitest';
import { buildComparison, inputParityProblems, taskMismatches } from '../src/report.js';
import { asHardFails, validateHumanReview, type HumanReview } from '../src/human-review.js';
import type { BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';
import type { ScoreSheet } from '../src/scoring.js';

const suite = loadSuite();
const SHA = {
  lite: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
  standard: '8334b850b7bd46238c16b0c550df2138f0889bf433809008cc17a8b05761863e',
};
const FINGERPRINT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function generationFor(
  caseId: string,
  profile: BenchmarkProfile,
  over: Partial<BenchmarkGeneration> = {},
): BenchmarkGeneration {
  const testCase = suite.cases.find(entry => entry.id === caseId)!;
  return {
    id: `run:${caseId}:${profile}:1`,
    runId: 'run',
    caseId,
    task: testCase.task,
    profile,
    artifact: {
      profileId: profile,
      family: profile === 'lite' ? 'Qwen3-1.7B' : 'SmolLM3-3B',
      quantization: 'Q4_K_M',
      artifactFilename: profile === 'lite' ? 'Qwen3-1.7B-Q4_K_M.gguf' : 'SmolLM3-Q4_K_M.gguf',
      sizeBytes: profile === 'lite' ? 1282439264 : 1915305312,
      sha256: SHA[profile],
      source: 'user model library',
      releaseApproved: false,
    },
    context: {
      contextSize: 4096,
      maxOutputTokens: 400,
      temperature: 0.3,
      topP: 0.9,
      seed: 7419,
      reasoning: 'off',
    },
    inputFingerprint: FINGERPRINT,
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 8000,
    tokensGenerated: 120,
    tokensPerSecond: 15,
    rawOutputPath: `raw/${caseId}.${profile}.1.txt`,
    normalizedOutput: {
      narration: 'Nulla di rilevante.',
      dialogue: testCase.constraints.knownSpeakerIds.map(speakerId => ({ speakerId, text: 'Ok.' })),
      toneTags: [testCase.constraints.allowedToneTags[0]!],
      eventProposals: testCase.constraints.allowEventProposals ? [{ templateId: 't' }] : [],
      memorySuggestions: testCase.constraints.allowMemorySuggestions ? ['m'] : [],
    },
    ...over,
  };
}

const caseIds = suite.cases.slice(0, 3).map(entry => entry.id);

function fairRun(): BenchmarkRun {
  return {
    metadata: {
      runId: 'run',
      startedAt: '2026-08-21T00:00:00.000Z',
      gitCommit: '9599f38',
      gitDirty: false,
      suiteVersion: suite.suiteVersion,
      suiteSchemaVersion: 1,
      runnerVersion: '0.1.0',
      runtimeReleaseTag: 'b10343',
      runtimeExecutableSha256: null,
      host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7', logicalCores: 24, totalRamMb: 65536 },
    },
    generations: caseIds.flatMap(caseId => [
      generationFor(caseId, 'lite'),
      generationFor(caseId, 'standard'),
    ]),
  };
}

describe('comparison fairness', () => {
  it('accepts a run where everything was actually held equal', () => {
    expect(inputParityProblems(fairRun(), ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, fairRun())).not.toThrow();
  });

  it('refuses a run where one case was asked differently of each profile', () => {
    // The same case id proves nothing if the prompt changed underneath it.
    const run = fairRun();
    run.generations[1]!.inputFingerprint = 'f'.repeat(64);

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('asked differently'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow(/identical case inputs/);
  });

  it('refuses a profile that swapped artifacts halfway through', () => {
    const run = fairRun();
    run.generations[2]!.artifact = { ...run.generations[2]!.artifact, sha256: 'a'.repeat(64) };

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('mixed 2 artifact identities'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('refuses profiles run with different controlled settings', () => {
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.profile === 'standard') generation.context.temperature = 0.9;
    }

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('different controlled generation settings'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('treats context size as controlled, so a later matrix must be explicit', () => {
    // P0.5-C may vary context deliberately; when it does, it has to be a
    // separate dimension rather than quietly mixed into one comparison.
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.profile === 'standard') generation.context.contextSize = 8192;
    }
    expect(inputParityProblems(run, ['lite', 'standard']).length).toBeGreaterThan(0);
  });

  it('refuses a run whose rows mislabel their own task', () => {
    const run = fairRun();
    run.generations[0]!.task = 'warfare_report';

    expect(taskMismatches(suite, run).length).toBe(1);
    expect(() => buildComparison(suite, run)).toThrow(/mislabels/);
  });

  it('refuses a row naming a case the suite does not contain', () => {
    const run = fairRun();
    run.generations[0]!.caseId = 'ai_case_999';
    expect(taskMismatches(suite, run).some(problem => problem.includes('does not contain'))).toBe(true);
  });
});

describe('retries and fairness', () => {
  const RETRY = 'b'.repeat(64);
  const first = caseIds[0]!;

  function retryRow(profile: BenchmarkProfile, fingerprint = RETRY): BenchmarkGeneration {
    return generationFor(first, profile, {
      id: `run:${first}:${profile}:2`,
      attempt: 2,
      retryUsed: true,
      inputFingerprint: fingerprint,
      rawOutputPath: `raw/${first}.${profile}.2.txt`,
    });
  }

  it('A: first attempts that match are fair', () => {
    expect(inputParityProblems(fairRun(), ['lite', 'standard'])).toEqual([]);
  });

  it('B: a retry only one profile needed is valid evidence, not a defect', () => {
    // Lite failing and being retried while Standard succeeded first time is
    // precisely the kind of thing the benchmark exists to observe.
    const run = fairRun();
    run.generations.push(retryRow('lite'));
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('C: both profiles retried with the same wording is fair', () => {
    const run = fairRun();
    run.generations.push(retryRow('lite'), retryRow('standard'));
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('D: both profiles retried with different wording is refused', () => {
    const run = fairRun();
    run.generations.push(retryRow('lite'), retryRow('standard', 'c'.repeat(64)));

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('attempt 2 was asked differently'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow(/identical case inputs/);
  });

  it('E: a retry may legitimately differ from attempt 1', () => {
    // The retry prompt is supposed to say something new. Comparing across
    // attempt numbers would flag every retry in the suite.
    const run = fairRun();
    run.generations.push(retryRow('lite'), retryRow('standard'));

    const attemptOne = run.generations.find(
      generation => generation.caseId === first && generation.attempt === 1,
    )!;
    expect(attemptOne.inputFingerprint).not.toBe(RETRY);
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('F: a duplicated case/profile/attempt is refused', () => {
    const run = fairRun();
    run.generations.push({ ...run.generations[0]!, id: 'run:copy' });

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('duplicate attempt recorded'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });
});

describe('attempt histories must be coherent', () => {
  const RETRY = 'b'.repeat(64);
  const first = caseIds[0]!;

  /** One row for a case at a given attempt number. */
  function rowAt(
    profile: BenchmarkProfile,
    attempt: number,
    fingerprint = RETRY,
  ): BenchmarkGeneration {
    return generationFor(first, profile, {
      id: `run:${first}:${profile}:${attempt}`,
      attempt,
      retryUsed: attempt > 1,
      inputFingerprint: attempt === 1 ? FINGERPRINT : fingerprint,
      rawOutputPath: `raw/${first}.${profile}.${attempt}.txt`,
    });
  }

  /** A run holding exactly the given attempts for the first case. */
  function historyRun(lite: number[], standard: number[]): BenchmarkRun {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.caseId !== first);
    for (const attempt of lite) run.generations.push(rowAt('lite', attempt));
    for (const attempt of standard) run.generations.push(rowAt('standard', attempt));
    return run;
  }

  it('A: attempt 1 on both profiles passes', () => {
    expect(inputParityProblems(historyRun([1], [1]), ['lite', 'standard'])).toEqual([]);
  });

  it('B: a retry only Lite needed passes', () => {
    // The shape the benchmark exists to observe: one model got it first time,
    // the other did not.
    expect(inputParityProblems(historyRun([1, 2], [1]), ['lite', 'standard'])).toEqual([]);
  });

  it('C: Standard with only attempt 2 is refused', () => {
    // Comparing one model's first try against another's second measures
    // neither, and reading it as "Standard needed a retry" inverts the truth:
    // there is no record of the try it supposedly retried.
    const problems = inputParityProblems(historyRun([1], [2]), ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no attempt 1 for standard'))).toBe(true);
    expect(() => buildComparison(suite, historyRun([1], [2]))).toThrow();
  });

  it('D: Lite with only attempt 2 is refused', () => {
    const problems = inputParityProblems(historyRun([2], [1]), ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no attempt 1 for lite'))).toBe(true);
    expect(() => buildComparison(suite, historyRun([2], [1]))).toThrow();
  });

  it('E: attempt 3 without attempt 2 is refused', () => {
    // A gap means a row was lost, not that a model skipped a try.
    const problems = inputParityProblems(historyRun([1, 3], [1]), ['lite', 'standard']);
    expect(
      problems.some(problem => problem.includes('attempt 3 without attempt 2')),
      JSON.stringify(problems),
    ).toBe(true);
    expect(() => buildComparison(suite, historyRun([1, 3], [1]))).toThrow();
  });

  it('F: a retry both profiles made with the same wording passes', () => {
    expect(inputParityProblems(historyRun([1, 2], [1, 2]), ['lite', 'standard'])).toEqual([]);
  });

  it('G: a retry both profiles made with different wording is refused', () => {
    const run = historyRun([1, 2], [1]);
    run.generations.push(rowAt('standard', 2, 'c'.repeat(64)));

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('attempt 2 was asked differently'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow(/identical case inputs/);
  });

  it('holds for a single profile too, before anything is compared', () => {
    // A malformed history is malformed on its own; it does not need a second
    // profile to become wrong.
    const problems = inputParityProblems(historyRun([2], []), ['lite']);
    expect(problems.some(problem => problem.includes('no attempt 1 for lite'))).toBe(true);
  });
});

describe('judgement is bound to the run it judges', () => {
  const sheet = (over: Partial<ScoreSheet> = {}): ScoreSheet => ({
    runId: 'run',
    suiteVersion: suite.suiteVersion,
    scores: [
      {
        generationId: `run:${caseIds[0]}:lite:1`,
        scoredBy: 'simone',
        scoredAt: '2026-08-21T00:00:00.000Z',
        scores: {
          italian_fluency: 4, grounding: 4, character_consistency: 4, memory_use: 4,
          instruction_adherence: 4, schema_compliance: 4, non_contradiction: 4,
          narrative_usefulness: 4, repetition_resistance: 4, latency_acceptability: 4,
        },
      },
    ],
    ...over,
  });

  it('accepts a score sheet written for this run', () => {
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], sheet())).not.toThrow();
  });

  it('refuses a score sheet from another run, even with a copied generation id', () => {
    expect(() =>
      buildComparison(suite, fairRun(), ['lite', 'standard'], sheet({ runId: 'other_run' })),
    ).toThrow(/belongs to another run/);
  });

  it('refuses a score sheet written against another suite version', () => {
    expect(() =>
      buildComparison(suite, fairRun(), ['lite', 'standard'], sheet({ suiteVersion: 'p0.4-old' })),
    ).toThrow(/suite/);
  });
});

describe('human hard failures', () => {
  const known = new Set(fairRun().generations.map(generation => generation.id));

  function review(over: Partial<HumanReview> = {}): HumanReview {
    return {
      runId: 'run',
      suiteVersion: suite.suiteVersion,
      hardFails: [
        {
          generationId: `run:${caseIds[0]}:lite:1`,
          category: 'contradicts_state_delta',
          detail: 'Says the shortage ended; the delta says water fell.',
          reviewedBy: 'simone',
          reviewedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
      ...over,
    };
  }

  it('accepts a well-formed review', () => {
    expect(validateHumanReview(review(), known)).toEqual([]);
  });

  it('refuses a category outside the five locked ones', () => {
    const broken = review();
    (broken.hardFails[0] as unknown as Record<string, unknown>).category = 'bad_vibes';
    expect(validateHumanReview(broken, known).some(problem => problem.field === 'category')).toBe(true);
  });

  it('refuses a disqualification of a generation that is not in the run', () => {
    const broken = review();
    broken.hardFails[0]!.generationId = 'run:ghost:lite:1';
    expect(validateHumanReview(broken, known).some(problem => problem.field === 'generationId')).toBe(true);
  });

  it('requires a reason and an author', () => {
    const broken = review();
    broken.hardFails[0]!.detail = '   ';
    broken.hardFails[0]!.reviewedBy = '';
    const fields = validateHumanReview(broken, known).map(problem => problem.field);
    expect(fields).toContain('detail');
    expect(fields).toContain('reviewedBy');
  });

  it('marks its findings as human, never machine', () => {
    const fails = asHardFails(review(), `run:${caseIds[0]}:lite:1`);
    expect(fails).toHaveLength(1);
    expect(fails[0]!.determinedBy).toBe('human');
  });

  it('is reported alongside machine hard fails, not merged into them', () => {
    const report = buildComparison(suite, fairRun(), ['lite', 'standard'], null, review());
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    const standard = report.profiles.find(profile => profile.profile === 'standard')!;

    expect(lite.humanHardFailedCases).toBe(1);
    expect(lite.machineHardFailedCases).toBe(0);
    expect(lite.hardFailedCases).toBe(1);
    expect(lite.humanHardFailsByCategory.contradicts_state_delta).toBe(1);
    expect(lite.hardFailsByCategory.contradicts_state_delta).toBe(0);

    // The other profile is untouched by a review of the first.
    expect(standard.hardFailedCases).toBe(0);
  });

  it('is refused when it was written for another run', () => {
    // Generation ids are stable and typeable, so an id alone proves nothing.
    const foreign = review({ runId: 'some_other_run' });
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], null, foreign)).toThrow(
      /belongs to another run/,
    );
  });

  it('is refused when it scored a different suite version', () => {
    const stale = review({ suiteVersion: 'p0.4-old' });
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], null, stale)).toThrow(
      /suite/,
    );
  });

  it('cannot be erased by a good prose score', () => {
    // A disqualification lives outside the 0-5 axes entirely, so no amount of
    // scoring can average it away.
    const sheet: ScoreSheet = {
      runId: 'run',
      suiteVersion: suite.suiteVersion,
      scores: [
        {
          generationId: `run:${caseIds[0]}:lite:1`,
          scoredBy: 'simone',
          scoredAt: '2026-08-21T00:00:00.000Z',
          scores: {
            italian_fluency: 5, grounding: 5, character_consistency: 5, memory_use: 5,
            instruction_adherence: 5, schema_compliance: 5, non_contradiction: 5,
            narrative_usefulness: 5, repetition_resistance: 5, latency_acceptability: 5,
          },
        },
      ],
    };

    const report = buildComparison(suite, fairRun(), ['lite', 'standard'], sheet, review());
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    expect(lite.humanMeanByAxis?.grounding).toBe(5);
    expect(lite.hardFailedCases).toBe(1);
  });
});
