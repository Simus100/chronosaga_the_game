import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  inputParityProblems,
  judgementProblems,
  suiteBindingProblems,
  taskMismatches,
} from '../src/report.js';
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
    rawFormat: { bareJson: true, codeFencePresent: false, wrapperTextPresent: false },
    normalizedOutput: {
      narration: 'Nulla di rilevante.',
      dialogue: testCase.constraints.knownSpeakerIds.map(speakerId => ({ speakerId, text: 'Ok.' })),
      toneTags: [testCase.constraints.allowedToneTags[0]!],
      eventProposals: testCase.constraints.allowEventProposals
        ? [{ subjectId: testCase.characters[0]?.id ?? 'settlement_helios', topic: 't', rationale: 'r' }]
        : [],
      memorySuggestions: testCase.constraints.allowMemorySuggestions
        ? [{ characterId: testCase.characters[0]?.id ?? 'mara_001', summary: 's' }]
        : [],
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

describe('a run is bound to the suite it was executed against', () => {
  it('A: the recorded version and schema matching passes', () => {
    expect(suiteBindingProblems(suite, fairRun())).toEqual([]);
    expect(() => buildComparison(suite, fairRun())).not.toThrow();
  });

  it('B: the same cases under a different suite version is refused', () => {
    // The dangerous edit: ids and task names survive a revision, so
    // taskMismatches sees nothing wrong while every constraint and expected
    // fact underneath may have changed.
    const revised = { ...suite, suiteVersion: 'p0.5-a.2' };
    const problems = suiteBindingProblems(revised, fairRun());

    expect(problems.some(problem => problem.includes("recorded suite version 'p0.5-a.1'"))).toBe(true);
    expect(problems.some(problem => problem.includes("'p0.5-a.2'"))).toBe(true);
    expect(() => buildComparison(revised, fairRun())).toThrow(/different suite/);
  });

  it('C: the same version under a different schema is refused', () => {
    const migrated = { ...suite, schemaVersion: 2 as unknown as 1 };
    const problems = suiteBindingProblems(migrated, fairRun());

    expect(problems.some(problem => problem.includes('schema 1'))).toBe(true);
    expect(problems.some(problem => problem.includes('schema 2'))).toBe(true);
    expect(() => buildComparison(migrated, fairRun())).toThrow(/different suite/);
  });

  it('D: an old run cannot be silently evaluated with a newer suite', () => {
    // Same case ids, same tasks, changed facts: exactly the situation where
    // nothing else would notice.
    const newer = structuredClone(suite);
    newer.suiteVersion = 'p0.5-a.9';
    newer.cases[0]!.expectedFacts = ['something the run never saw'];
    newer.cases[0]!.constraints.maxNarrationChars = 9999;

    expect(taskMismatches(newer, fairRun())).toEqual([]);
    expect(() => buildComparison(newer, fairRun())).toThrow(/different suite/);
  });

  it('refuses before any evaluation happens, not after', () => {
    // A mismatched suite must not reach the objective evaluator at all: a report
    // built on the wrong constraints is worse than no report.
    const revised = { ...suite, suiteVersion: 'p0.5-a.2' };
    let message = '';
    try {
      buildComparison(revised, fairRun());
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/refusing to evaluate a run against a different suite/);
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

describe('judgement must be well formed before it is aggregated', () => {
  const first = caseIds[0]!;
  const validId = `run:${first}:lite:1`;

  const axes = {
    italian_fluency: 4, grounding: 4, character_consistency: 4, memory_use: 4,
    instruction_adherence: 4, schema_compliance: 4, non_contradiction: 4,
    narrative_usefulness: 4, repetition_resistance: 4, latency_acceptability: 4,
  } as const;

  const sheetWith = (scores: ScoreSheet['scores']): ScoreSheet => ({
    runId: 'run',
    suiteVersion: suite.suiteVersion,
    scores,
  });

  const score = (over: Partial<ScoreSheet['scores'][number]> = {}) => ({
    generationId: validId,
    scoredBy: 'simone',
    scoredAt: '2026-08-21T00:00:00.000Z',
    scores: { ...axes },
    ...over,
  });

  const reviewWith = (hardFails: HumanReview['hardFails']): HumanReview => ({
    runId: 'run',
    suiteVersion: suite.suiteVersion,
    hardFails,
  });

  const fail = (over: Partial<HumanReview['hardFails'][number]> = {}) => ({
    generationId: validId,
    category: 'contradicts_state_delta' as const,
    detail: 'Says the shortage ended; the delta says water fell.',
    reviewedBy: 'simone',
    reviewedAt: '2026-08-21T00:00:00.000Z',
    ...over,
  });

  it('A: valid judgement passes', () => {
    expect(judgementProblems(fairRun(), sheetWith([score()]), reviewWith([fail()]))).toEqual([]);
    expect(() =>
      buildComparison(suite, fairRun(), ['lite', 'standard'], sheetWith([score()]), reviewWith([fail()])),
    ).not.toThrow();
  });

  it('B: a score for a generation the run does not contain is refused', () => {
    // Previously it disappeared silently, which is worse than a wrong number.
    const sheet = sheetWith([score({ generationId: 'run:ghost:lite:1' })]);
    expect(judgementProblems(fairRun(), sheet, null).some(p => p.includes('run:ghost:lite:1'))).toBe(true);
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], sheet)).toThrow(/malformed judgement/);
  });

  it('C: the same generation scored twice is refused', () => {
    const sheet = sheetWith([score(), score()]);
    expect(judgementProblems(fairRun(), sheet, null).some(p => p.includes('scored twice'))).toBe(true);
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], sheet)).toThrow();
  });

  it('D: an out-of-range or unknown axis is refused', () => {
    const outOfRange = sheetWith([score()]);
    (outOfRange.scores[0]!.scores as Record<string, number>).grounding = 9;
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], outOfRange)).toThrow(/grounding/);

    const unknownAxis = sheetWith([score()]);
    (unknownAxis.scores[0]!.scores as Record<string, number>).vibes = 5;
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], unknownAxis)).toThrow(/vibes/);
  });

  it('E: a hard fail against an unknown generation is refused', () => {
    const review = reviewWith([fail({ generationId: 'run:ghost:lite:1' })]);
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow(
      /malformed judgement/,
    );
  });

  it('F: a hard-fail category outside the five locked ones is refused', () => {
    const review = reviewWith([fail()]);
    (review.hardFails[0] as unknown as Record<string, unknown>).category = 'bad_vibes';
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow(
      /bad_vibes/,
    );
  });

  it('G: malformed judgement can no longer produce NaN in the report', () => {
    // The concrete failure: an invalid category indexed a tally that was never
    // initialised for it, so the count became NaN and travelled into the report.
    const review = reviewWith([fail()]);
    (review.hardFails[0] as unknown as Record<string, unknown>).category = 'bad_vibes';
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow();

    // And a report built from valid judgement contains no NaN anywhere.
    const report = buildComparison(
      suite, fairRun(), ['lite', 'standard'], sheetWith([score()]), reviewWith([fail()]),
    );
    const numbers: number[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'number') numbers.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(report);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it('H: attribution still fails independently of well-formedness', () => {
    // A perfectly valid sheet from another run must still be refused, and for
    // the attribution reason rather than a validation one.
    const foreign = { ...sheetWith([score()]), runId: 'other_run' };
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'], foreign)).toThrow(
      /belongs to another run/,
    );
  });

  it('refuses the same verdict filed twice by the same reviewer', () => {
    const review = reviewWith([fail(), fail()]);
    expect(judgementProblems(fairRun(), null, review).some(p => p.includes('recorded twice'))).toBe(true);
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
