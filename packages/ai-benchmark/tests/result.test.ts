import { describe, expect, it } from 'vitest';
import { validateRun, type BenchmarkGeneration, type BenchmarkRun } from '../src/result.js';
import { SCORE_AXES, validateScoreSheet, type ScoreSheet } from '../src/scoring.js';
import { HARD_FAIL_CATEGORIES, tallyHardFails } from '../src/hard-fail.js';

const SHA = 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5';

function generation(over: Partial<BenchmarkGeneration> = {}): BenchmarkGeneration {
  return {
    id: 'run:c1:lite:1',
    runId: 'run',
    caseId: 'c1',
    task: 'single_npc_dialogue',
    profile: 'lite',
    artifact: {
      profileId: 'lite',
      family: 'Qwen3-1.7B',
      quantization: 'Q4_K_M',
      artifactFilename: 'Qwen3-1.7B-Q4_K_M.gguf',
      sizeBytes: 1282439264,
      sha256: SHA,
      source: 'user model library',
      releaseApproved: false,
    },
    context: {
      contextSize: 4096,
      maxOutputTokens: 512,
      temperature: 0.7,
      topP: 0.95,
      seed: null,
      reasoning: 'off',
    },
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 1000,
    tokensGenerated: 100,
    tokensPerSecond: 12,
    rawOutputPath: 'raw/c1.lite.1.txt',
    normalizedOutput: {
      narration: 'ok',
      dialogue: [],
      toneTags: [],
      eventProposals: [],
      memorySuggestions: [],
    },
    ...over,
  };
}

function run(generations: BenchmarkGeneration[]): BenchmarkRun {
  return {
    metadata: {
      runId: 'run',
      startedAt: '2026-08-21T00:00:00.000Z',
      gitCommit: '9599f38',
      gitDirty: false,
      suiteVersion: 'p0.5-a.1',
      suiteSchemaVersion: 1,
      runnerVersion: '0.1.0',
      runtimeReleaseTag: 'b10343',
      runtimeExecutableSha256: null,
      host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7-13700KF', logicalCores: 24, totalRamMb: 65536 },
    },
    generations,
  };
}

describe('the benchmark result schema', () => {
  it('accepts a well-formed run', () => {
    expect(validateRun(run([generation()]))).toEqual([]);
  });

  it('requires a commit, because an unattributable result proves nothing', () => {
    const broken = run([generation()]);
    broken.metadata.gitCommit = '';
    expect(validateRun(broken).some(problem => problem.field === 'metadata.gitCommit')).toBe(true);
  });

  it('requires a full artifact digest', () => {
    const broken = run([generation({ artifact: { ...generation().artifact, sha256: 'abc' } })]);
    expect(validateRun(broken).some(problem => problem.field === 'artifact.sha256')).toBe(true);
  });

  it('refuses an artifact that belongs to another profile', () => {
    const broken = run([
      generation({ profile: 'standard', artifact: { ...generation().artifact, profileId: 'lite' } }),
    ]);
    expect(validateRun(broken).some(problem => problem.field === 'artifact.profileId')).toBe(true);
  });

  it('refuses an accepted generation with no validated output', () => {
    const broken = run([generation({ normalizedOutput: null })]);
    expect(validateRun(broken).some(problem => problem.field === 'normalizedOutput')).toBe(true);
  });

  it('refuses a rejection that does not say why', () => {
    const broken = run([generation({ accepted: false, normalizedOutput: null, validatorErrors: [] })]);
    expect(validateRun(broken).some(problem => problem.field === 'validatorErrors')).toBe(true);
  });

  it('keeps a retry as a separate attempt rather than a mutation', () => {
    const first = generation({ id: 'run:c1:lite:1', accepted: false, normalizedOutput: null, validatorErrors: ['bad'] });
    const second = generation({ id: 'run:c1:lite:2', attempt: 2, retryUsed: true });
    expect(validateRun(run([first, second]))).toEqual([]);
  });

  it('requires a fallback to name where it fell back to', () => {
    const broken = run([generation({ fallbackUsed: true, fallbackProfile: null })]);
    expect(validateRun(broken).some(problem => problem.field === 'fallbackProfile')).toBe(true);
  });

  it('always references raw evidence on disk', () => {
    const broken = run([generation({ rawOutputPath: '' })]);
    expect(validateRun(broken).some(problem => problem.field === 'rawOutputPath')).toBe(true);
  });
});

describe('the human score sheet', () => {
  const known = new Set(['run:c1:lite:1']);

  function sheet(over: Partial<ScoreSheet> = {}): ScoreSheet {
    return {
      runId: 'run',
      suiteVersion: 'p0.5-a.1',
      scores: [
        {
          generationId: 'run:c1:lite:1',
          scoredBy: 'simone',
          scoredAt: '2026-08-21T00:00:00.000Z',
          scores: Object.fromEntries(SCORE_AXES.map(axis => [axis, 3])) as never,
        },
      ],
      ...over,
    };
  }

  it('accepts a complete sheet', () => {
    expect(validateScoreSheet(sheet(), known)).toEqual([]);
  });

  it('covers exactly the ten axes the plan fixes', () => {
    expect(SCORE_AXES).toHaveLength(10);
    expect(SCORE_AXES).toContain('italian_fluency');
    expect(SCORE_AXES).toContain('latency_acceptability');
  });

  it('rejects a score outside 0-5', () => {
    const broken = sheet();
    (broken.scores[0]!.scores as Record<string, number>).grounding = 7;
    expect(validateScoreSheet(broken, known).some(problem => problem.field === 'scores.grounding')).toBe(true);
  });

  it('rejects a score for a generation the run does not contain', () => {
    const broken = sheet();
    broken.scores[0]!.generationId = 'run:ghost:lite:1';
    expect(validateScoreSheet(broken, known).some(problem => problem.field === 'generationId')).toBe(true);
  });

  it('rejects an unknown axis', () => {
    const broken = sheet();
    (broken.scores[0]!.scores as Record<string, number>).vibes = 5;
    expect(validateScoreSheet(broken, known).some(problem => problem.field === 'scores.vibes')).toBe(true);
  });
});

describe('the hard-fail taxonomy', () => {
  it('is exactly the five categories the plan lists', () => {
    expect(HARD_FAIL_CATEGORIES).toHaveLength(5);
    expect(HARD_FAIL_CATEGORIES).toContain('contradicts_state_delta');
    expect(HARD_FAIL_CATEGORIES).toContain('mutates_authoritative_number');
    expect(HARD_FAIL_CATEGORIES).toContain('incompatible_memory_attribution');
    expect(HARD_FAIL_CATEGORIES).toContain('unrecoverable_structured_output');
    expect(HARD_FAIL_CATEGORIES).toContain('systematically_unusable');
  });

  it('tallies by category and starts every category at zero', () => {
    const tally = tallyHardFails([
      { category: 'contradicts_state_delta', detail: 'x', determinedBy: 'machine' },
      { category: 'contradicts_state_delta', detail: 'y', determinedBy: 'human' },
    ]);
    expect(tally.contradicts_state_delta).toBe(2);
    expect(tally.systematically_unusable).toBe(0);
  });
});
