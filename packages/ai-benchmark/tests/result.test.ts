import { describe, expect, it } from 'vitest';
import { normalizedOutputProblems, validateRun, type BenchmarkGeneration, type BenchmarkRun } from '../src/result.js';
import { SCORE_AXES, validateScoreSheet, type ScoreSheet } from '../src/scoring.js';
import { HARD_FAIL_CATEGORIES, tallyHardFails } from '../src/hard-fail.js';
import { suiteContentDigest } from '../src/report.js';
import { loadSuite } from '../src/suite.js';

const suite = loadSuite();

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
    inputFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 1000,
    tokensGenerated: 100,
    tokensPerSecond: 12,
    servedModel: 'lite',
    rawOutputPath: 'raw/c1.lite.1.txt',
    rawFormat: { bareJson: true, codeFencePresent: false, wrapperTextPresent: false },
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
      runKind: 'official_comparison',
      startedAt: '2026-08-21T00:00:00.000Z',
      gitCommit: '9599f38',
      gitDirty: false,
      suiteVersion: 'p0.5-a.1',
      suiteSchemaVersion: 1,
      suiteContentSha256: suiteContentDigest(suite),
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

describe('acceptance must actually be a boolean', () => {
  /** A run whose single row carries `accepted` exactly as external JSON would. */
  const runWithAccepted = (accepted: unknown) =>
    run([
      {
        ...generation({ accepted: true }),
        accepted,
      } as unknown as BenchmarkGeneration,
    ]);

  const acceptedProblems = (accepted: unknown) =>
    validateRun(runWithAccepted(accepted)).filter(problem => problem.field === 'accepted');

  it('A: a genuine acceptance passes', () => {
    expect(validateRun(runWithAccepted(true))).toEqual([]);
  });

  it('B: a genuine rejection passes', () => {
    const rejected = run([
      generation({ accepted: false, normalizedOutput: null, validatorErrors: ['unknown tone tag'] }),
    ]);
    expect(validateRun(rejected)).toEqual([]);
  });

  it('C: the string "false" is refused, not read as truthy', () => {
    // The exact scenario: a non-empty string is truthy, so this row would have
    // taken the accepted branch and been counted as a success by the word
    // "false".
    const problems = acceptedProblems('false');
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/must be a boolean/);
  });

  it('D: the string "true" is refused too', () => {
    expect(acceptedProblems('true')).toHaveLength(1);
  });

  it('E: 1 and 0 are refused', () => {
    for (const value of [1, 0, -1, NaN]) {
      expect(acceptedProblems(value), String(value)).toHaveLength(1);
    }
  });

  it('F: null, objects and arrays are refused', () => {
    for (const value of [null, {}, [], [true], { accepted: true }]) {
      expect(acceptedProblems(value), JSON.stringify(value)).toHaveLength(1);
    }
  });

  it('G: an absent acceptance is refused', () => {
    const row = { ...generation({ accepted: true }) } as Record<string, unknown>;
    delete row.accepted;
    const problems = validateRun(run([row as unknown as BenchmarkGeneration])).filter(
      problem => problem.field === 'accepted',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('absent');
  });

  it('K: the problem names the generation, the field and the requirement', () => {
    const problems = acceptedProblems('false');
    expect(problems[0]!.generationId).toBe('run:c1:lite:1');
    expect(problems[0]!.field).toBe('accepted');
    expect(problems[0]!.message).toContain('"false"');
    expect(problems[0]!.message).toContain('a string');
    expect(problems[0]!.message).toMatch(/must be a boolean/);
  });

  it('coerces nothing and leaves the evidence untouched', () => {
    const row = { ...generation({ accepted: true }), accepted: 'false' } as unknown as
      BenchmarkGeneration;
    const before = structuredClone(row);
    validateRun(run([row]));
    expect(row).toEqual(before);
    expect(row.accepted as unknown).toBe('false');
  });

  it('neither acceptance branch runs on a malformed flag', () => {
    // Reporting "a rejection must say why" about a row that does not say whether
    // it is one would be inventing the answer in order to complain about it.
    const problems = validateRun(runWithAccepted('false'));
    expect(problems.map(problem => problem.field)).toEqual(['accepted']);
  });

  it('L: the run this suite calls valid still validates', () => {
    expect(validateRun(run([generation()]))).toEqual([]);
  });
});

describe('the normalized output shape is checked at runtime', () => {
  const valid = () => ({
    narration: 'La riserva scende.',
    dialogue: [{ speakerId: 'mara_001', text: 'Dobbiamo razionare.' }],
    toneTags: ['tense'],
    eventProposals: [{ subjectId: 'settlement_helios', topic: 'acqua', rationale: 'Scende.' }],
    memorySuggestions: [{ characterId: 'mara_001', summary: 'Ha firmato.' }],
  });

  /** A run whose one accepted row carries `output`. */
  const runWith = (output: unknown) =>
    run([generation({ accepted: true, normalizedOutput: output as never })]);

  it('A: a complete output passes', () => {
    expect(normalizedOutputProblems(valid())).toEqual([]);
    expect(validateRun(runWith(valid()))).toEqual([]);
  });

  it('B: an empty object is refused', () => {
    // The exact shape that passed before: not null, and nothing else true.
    const problems = normalizedOutputProblems({});
    expect(problems).toContain('narration is not a string');
    expect(problems).toContain('dialogue is not an array');
    expect(validateRun(runWith({})).map(problem => problem.field)).toContain('normalizedOutput');
  });

  it('B: a non-object is refused', () => {
    for (const value of [null, 42, 'text', [], true]) {
      expect(normalizedOutputProblems(value), String(value)).toContain('is not an object');
    }
  });

  it('C: a missing field is refused', () => {
    const output = valid() as Record<string, unknown>;
    delete output.dialogue;
    expect(normalizedOutputProblems(output)).toEqual(['dialogue is not an array']);
  });

  it('D: a dialogue that is not an array is refused', () => {
    expect(normalizedOutputProblems({ ...valid(), dialogue: {} })).toEqual([
      'dialogue is not an array',
    ]);
  });

  it('E: a dialogue item missing speakerId is refused', () => {
    expect(normalizedOutputProblems({ ...valid(), dialogue: [{ text: 'ok' }] })).toEqual([
      'dialogue[0].speakerId is not a string',
    ]);
  });

  it('F: a dialogue item whose text is not a string is refused', () => {
    expect(
      normalizedOutputProblems({ ...valid(), dialogue: [{ speakerId: 'mara_001', text: 42 }] }),
    ).toEqual(['dialogue[0].text is not a string']);
  });

  it('E: a dialogue item that is not an object at all is refused', () => {
    expect(normalizedOutputProblems({ ...valid(), dialogue: [null] })).toEqual([
      'dialogue[0] is not an object',
    ]);
  });

  it('G: a non-string tone tag is refused', () => {
    expect(normalizedOutputProblems({ ...valid(), toneTags: ['tense', 7] })).toEqual([
      'toneTags[1] is not a string',
    ]);
  });

  it('H: a malformed event proposal is refused', () => {
    expect(
      normalizedOutputProblems({
        ...valid(),
        eventProposals: [{ subjectId: 'settlement_helios', topic: 'acqua' }],
      }),
    ).toEqual(['eventProposals[0].rationale is not a string']);
  });

  it('I: a malformed memory suggestion is refused', () => {
    expect(
      normalizedOutputProblems({ ...valid(), memorySuggestions: [{ summary: 'Ha firmato.' }] }),
    ).toEqual(['memorySuggestions[0].characterId is not a string']);
  });

  it('refuses unknown fields, because the producing contract refuses them', () => {
    expect(normalizedOutputProblems({ ...valid(), mood: 'epic' })).toEqual([
      "unexpected field 'mood'",
    ]);
    expect(
      normalizedOutputProblems({
        ...valid(),
        dialogue: [{ speakerId: 'mara_001', text: 'ok', volume: 3 }],
      }),
    ).toEqual(["dialogue[0] has an unexpected field 'volume'"]);
  });

  it('repairs nothing', () => {
    // No missing array is created, no value coerced, no malformed item dropped.
    const broken = { ...valid(), toneTags: ['tense', 7] } as Record<string, unknown>;
    const before = structuredClone(broken);
    normalizedOutputProblems(broken);
    expect(broken).toEqual(before);

    const missing = { ...valid() } as Record<string, unknown>;
    delete missing.memorySuggestions;
    normalizedOutputProblems(missing);
    expect('memorySuggestions' in missing).toBe(false);
  });

  it('reports every problem rather than stopping at the first', () => {
    const problems = normalizedOutputProblems({
      narration: 1,
      dialogue: [{ speakerId: 2 }],
      toneTags: 'tense',
      eventProposals: [{}],
      memorySuggestions: [7],
    });
    expect(problems.length).toBeGreaterThanOrEqual(6);
  });

  it('A and B: an empty or whitespace narration is refused', () => {
    // The application validator rejects a blank narration, so a stored row
    // marked accepted that carries one did not come from it.
    expect(normalizedOutputProblems({ ...valid(), narration: '' })).toEqual(['narration is blank']);
    expect(normalizedOutputProblems({ ...valid(), narration: '   \n\t' })).toEqual([
      'narration is blank',
    ]);
  });

  it('C and D: a blank dialogue line is refused', () => {
    expect(
      normalizedOutputProblems({
        ...valid(),
        dialogue: [{ speakerId: 'mara_001', text: '   ' }],
      }),
    ).toEqual(['dialogue[0].text is blank']);
    expect(
      normalizedOutputProblems({ ...valid(), dialogue: [{ speakerId: ' ', text: 'Ciao.' }] }),
    ).toEqual(['dialogue[0].speakerId is blank']);
  });

  it('E: a blank proposal field is refused', () => {
    for (const field of ['subjectId', 'topic', 'rationale'] as const) {
      const proposal = { subjectId: 's_h', topic: 't', rationale: 'r', [field]: '  ' };
      expect(
        normalizedOutputProblems({ ...valid(), eventProposals: [proposal] }),
        field,
      ).toEqual([`eventProposals[0].${field} is blank`]);
    }
  });

  it('F: a blank memory field is refused', () => {
    for (const field of ['characterId', 'summary'] as const) {
      const suggestion = { characterId: 'mara_001', summary: 's', [field]: '' };
      expect(
        normalizedOutputProblems({ ...valid(), memorySuggestions: [suggestion] }),
        field,
      ).toEqual([`memorySuggestions[0].${field} is blank`]);
    }
  });

  it('a blank tone tag is refused', () => {
    expect(normalizedOutputProblems({ ...valid(), toneTags: ['tense', ' '] })).toEqual([
      'toneTags[1] is blank',
    ]);
  });

  it('G: ordinary non-empty values pass', () => {
    expect(normalizedOutputProblems(valid())).toEqual([]);
  });

  it('checks shape and intrinsic value, and leaves case semantics alone', () => {
    // These pass *this* function, and that is correct — an unknown speaker, a
    // tag outside the vocabulary and an ungrounded proposal are all
    // well-shaped values, and this boundary has no suite to judge them against.
    //
    // An earlier comment here claimed they were outputs the application
    // validator could legitimately have accepted. That was wrong: Rust
    // `inference::validate` rejects all three. They are impossible accepted
    // evidence, and `acceptedOutputContractProblems` refuses them at the report
    // boundary, where the case is in hand.
    expect(
      normalizedOutputProblems({
        ...valid(),
        dialogue: [{ speakerId: 'ghost_999', text: 'Non esisto.' }],
        toneTags: ['epico'],
        eventProposals: [{ subjectId: 'settlement_fake', topic: 't', rationale: 'r' }],
      }),
    ).toEqual([]);
  });

  it('I: a blank-valued accepted row reaches no aggregate', () => {
    const broken = runWith({ ...valid(), narration: '  ' });
    expect(validateRun(broken).map(problem => problem.field)).toContain('normalizedOutput');
  });

  it('J: the input object is not trimmed or repaired', () => {
    const output = { ...valid(), narration: '   ' };
    const before = structuredClone(output);
    normalizedOutputProblems(output);
    expect(output).toEqual(before);
    expect(output.narration).toBe('   ');
  });

  it('L: a rejected generation with a null output stays valid', () => {
    const rejected = run([
      generation({ accepted: false, normalizedOutput: null, validatorErrors: ['unknown tone tag'] }),
    ]);
    expect(validateRun(rejected)).toEqual([]);
  });

  it('M: a rejected generation carrying an output is still invalid', () => {
    const rejected = run([
      generation({
        accepted: false,
        normalizedOutput: valid() as never,
        validatorErrors: ['unknown tone tag'],
      }),
    ]);
    expect(validateRun(rejected).map(problem => problem.field)).toContain('normalizedOutput');
  });
});
