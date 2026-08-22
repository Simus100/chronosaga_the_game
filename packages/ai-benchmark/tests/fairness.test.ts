import { describe, expect, it } from 'vitest';
import {
  attemptHistoryProblems,
  buildComparison,
  comparableEvidenceProblems,
  inputParityProblems,
  judgementProblems,
  officialEvidenceProblems,
  officialProfileSetProblem,
  OFFICIAL_EVIDENCE_REQUIREMENTS,
  suiteBindingProblems,
  taskMismatches,
} from '../src/report.js';
import { asHardFails, validateHumanReview, type HumanReview } from '../src/human-review.js';
import type { BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';
import type { ScoreSheet } from '../src/scoring.js';
import {
  MAX_ATTEMPTS,
  MAX_RETRIES,
  OFFICIAL_COMPARISON_PROFILES,
  validateRun,
} from '../src/result.js';

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
    servedModel: profile,
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

// The whole suite, because an official comparison is the whole suite. A
// three-case fixture is a smoke pass, and the report boundary now says so.
const caseIds = suite.cases.map(entry => entry.id);

function fairRun(): BenchmarkRun {
  return {
    metadata: {
      runId: 'run',
      runKind: 'official_comparison',
      startedAt: '2026-08-21T00:00:00.000Z',
      gitCommit: '9599f38d846f29907286e53200f51a703af4f53c',
      gitDirty: false,
      suiteVersion: suite.suiteVersion,
      suiteSchemaVersion: 1,
      runnerVersion: '0.1.0',
      runtimeReleaseTag: 'b10343',
      runtimeExecutableSha256: '3e8c1a6b5d4f2907c8b1e6a4d7f0b3c5928e1d4a7b0c3f6e9d2a5b8c1e4f7a0d',
      host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7', logicalCores: 24, totalRamMb: 65536 },
    },
    generations: caseIds.flatMap(caseId => [
      generationFor(caseId, 'lite'),
      generationFor(caseId, 'standard'),
    ]),
  };
}

describe('an official comparison is exactly Lite versus Standard', () => {
  it('A: lite and standard is the comparison', () => {
    expect(officialProfileSetProblem(['lite', 'standard'])).toBeNull();
    expect(() => buildComparison(suite, fairRun(), ['lite', 'standard'])).not.toThrow();
  });

  it('B: the order the caller passes does not matter', () => {
    expect(officialProfileSetProblem(['standard', 'lite'])).toBeNull();
    expect(() => buildComparison(suite, fairRun(), ['standard', 'lite'])).not.toThrow();
  });

  it('J: and the report is always Lite then Standard', () => {
    // Same evidence, two call orders, one reading.
    const asked = buildComparison(suite, fairRun(), ['standard', 'lite']);
    expect(asked.profiles.map(entry => entry.profile)).toEqual(['lite', 'standard']);
    expect(asked).toEqual(buildComparison(suite, fairRun(), ['lite', 'standard']));
  });

  it('C and D: one profile alone is not a comparison', () => {
    for (const only of [['lite'], ['standard']] as const) {
      const problem = officialProfileSetProblem([...only]);
      expect(problem, only[0]).toMatch(/is absent, so nothing is being compared/);
      expect(() => buildComparison(suite, fairRun(), [...only])).toThrow(
        /refusing to build an official comparison/,
      );
    }
  });

  it('I: a complete 65-case Lite-only run can never become an official comparison', () => {
    // The defect in full. Every coverage rule is satisfied — for Lite — and the
    // run answers nothing the benchmark was built to ask.
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'lite');
    expect(validateRun(run)).toEqual([]);
    expect(officialEvidenceProblems(suite, run, ['lite'])).toEqual([]);
    expect(() => buildComparison(suite, run, ['lite'])).toThrow(
      /refusing to build an official comparison/,
    );
  });

  it('E: an empty profile list is refused', () => {
    expect(officialProfileSetProblem([])).toMatch(/no profiles were given/);
    expect(() => buildComparison(suite, fairRun(), [])).toThrow(/no profiles were given/);
  });

  it('F and G: a profile compared with itself is not a comparison', () => {
    expect(officialProfileSetProblem(['lite', 'lite'])).toMatch(/appears more than once/);
    expect(officialProfileSetProblem(['lite', 'standard', 'lite'])).toMatch(
      /appears more than once/,
    );
    expect(() => buildComparison(suite, fairRun(), ['lite', 'lite'])).toThrow(
      /comparing a profile with itself/,
    );
  });

  it('H: an unknown profile is refused and named', () => {
    const problem = officialProfileSetProblem(['lite', 'turbo' as BenchmarkProfile]);
    expect(problem).toMatch(/'turbo' is not a benchmark profile/);
  });

  it('takes the profile ids from the contract, not from a list written here', () => {
    expect([...OFFICIAL_COMPARISON_PROFILES]).toEqual(['lite', 'standard']);
    expect(officialProfileSetProblem([...OFFICIAL_COMPARISON_PROFILES])).toBeNull();
  });

  it('refuses the profile set before any other gate reads it', () => {
    // Everything downstream takes the list as given, so a wrong list does not
    // produce a wrong answer — it produces a confident answer to another
    // question. This run is empty as well, and the profile set is what it says.
    const run = fairRun();
    run.generations = [];
    expect(() => buildComparison(suite, run, ['lite'])).toThrow(
      /refusing to build an official comparison/,
    );
  });
});

describe('every row is attributed to the model that answered it', () => {
  it('A and B: a row answered by its own profile is valid', () => {
    expect(validateRun(fairRun())).toEqual([]);
  });

  it('C and D: a row answered by the other model is refused', () => {
    for (const [profile, served] of [
      ['lite', 'standard'],
      ['standard', 'lite'],
    ] as const) {
      const run = fairRun();
      const row = run.generations.find(generation => generation.profile === profile)!;
      row.servedModel = served;
      const problems = validateRun(run);
      expect(problems.map(problem => problem.field)).toContain('servedModel');
      expect(problems[0]!.message).toMatch(
        new RegExp(`answered by '${served}' but recorded under '${profile}'`),
      );
    }
  });

  it('E: a row that names no model at all is refused', () => {
    const run = fairRun();
    run.generations[0]!.servedModel = null;
    const problems = validateRun(run);
    expect(problems[0]!.field).toBe('servedModel');
    expect(problems[0]!.message).toMatch(/did not say which model produced this response/);
  });

  it('F and G: a mismatched row never reaches evaluation or any aggregate', () => {
    // validateRun runs first in buildComparison, so nothing downstream — scoring,
    // latency, retry counts, acceptance rates — ever sees the row.
    const run = fairRun();
    run.generations.find(generation => generation.profile === 'lite')!.servedModel = 'standard';
    expect(() => buildComparison(suite, run)).toThrow(/structurally invalid run/);
  });

  it('J: one wrong row invalidates the run, however many are right', () => {
    const run = fairRun();
    expect(validateRun(run)).toEqual([]);
    run.generations.at(-1)!.servedModel = 'lite';
    expect(validateRun(run)).not.toEqual([]);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('I: a swap partway through a run is caught at the row where it happened', () => {
    // The shape of a real mid-run swap: the preflight probe passed, the first
    // rows are honest, and everything after the swap names the other model.
    const run = fairRun();
    const half = Math.floor(run.generations.length / 2);
    for (const generation of run.generations.slice(half)) {
      generation.servedModel = generation.profile === 'lite' ? 'standard' : 'lite';
    }
    const problems = validateRun(run);
    expect(problems.length).toBe(run.generations.length - half);
    expect(problems.every(problem => problem.field === 'servedModel')).toBe(true);
    expect(problems[0]!.generationId).toBe(run.generations[half]!.id);
  });

  it('a fallback row is attributed to the profile it fell back to', () => {
    const run = fairRun();
    const row = run.generations.find(generation => generation.profile === 'standard')!;
    row.fallbackUsed = true;
    row.fallbackProfile = 'lite';
    row.servedModel = 'lite';
    expect(validateRun(run).filter(problem => problem.field === 'servedModel')).toEqual([]);

    row.servedModel = 'standard';
    expect(validateRun(run).map(problem => problem.field)).toContain('servedModel');
  });
});

describe('official comparison evidence', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];

  it('G: a full suite for both profiles on a clean checkout qualifies', () => {
    expect(officialEvidenceProblems(suite, fairRun(), both)).toEqual([]);
    expect(() => buildComparison(suite, fairRun())).not.toThrow();
  });

  it('A: a smoke run with impeccable rows is refused, and refused for that alone', () => {
    // The trap this closes: everything else about this run is perfect. Listing
    // its other shortcomings would obscure the one that disqualifies it.
    const run = fairRun();
    run.metadata.runKind = 'smoke';
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.map(problem => problem.requirement)).toEqual(['declared_official']);
    expect(problems[0]!.message).toMatch(/plumbing evidence/);
    expect(() => buildComparison(suite, run)).toThrow(/declared_official/);
  });

  it('B: a dirty checkout is refused', () => {
    const run = fairRun();
    run.metadata.gitDirty = true;
    expect(officialEvidenceProblems(suite, run, both).map(p => p.requirement)).toContain(
      'clean_checkout',
    );
    expect(() => buildComparison(suite, run)).toThrow(/nobody else can reproduce it/);
  });

  it('C: a short or non-hex commit is refused', () => {
    for (const commit of ['9599f38', '', 'zzzz9f38d846f29907286e53200f51a703af4f53c']) {
      const run = fairRun();
      run.metadata.gitCommit = commit;
      expect(officialEvidenceProblems(suite, run, both).map(p => p.requirement)).toContain(
        'full_commit',
      );
    }
  });

  it('D: absent or malformed runtime provenance is refused', () => {
    const missing = fairRun();
    missing.metadata.runtimeExecutableSha256 = null;
    expect(officialEvidenceProblems(suite, missing, both).map(p => p.requirement)).toContain(
      'runtime_provenance',
    );

    const truncated = fairRun();
    truncated.metadata.runtimeExecutableSha256 = 'abc123';
    expect(officialEvidenceProblems(suite, truncated, both)[0]!.message).toMatch(/not a SHA-256/);

    const untagged = fairRun();
    untagged.metadata.runtimeReleaseTag = '   ';
    expect(officialEvidenceProblems(suite, untagged, both).map(p => p.requirement)).toContain(
      'runtime_provenance',
    );
  });

  it('E: both profiles sharing only a subset of the suite is refused', () => {
    // Structurally impeccable and perfectly fair: same ten cases, same inputs,
    // both models. It supports no Lite-versus-Standard decision at all.
    const keep = new Set(suite.cases.slice(0, 10).map(entry => entry.id));
    const run = fairRun();
    run.generations = run.generations.filter(generation => keep.has(generation.caseId));

    expect(comparableEvidenceProblems(run, both)).toEqual([]);
    expect(inputParityProblems(run, both)).toEqual([]);
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.map(problem => problem.requirement)).toEqual([
      'full_profile_case_coverage',
      'full_profile_case_coverage',
    ]);
    expect(() => buildComparison(suite, run)).toThrow(/full_profile_case_coverage/);
  });

  it('F: one profile short by a single case is refused and the pair is named', () => {
    const absent = suite.cases.at(-1)!.id;
    const run = fairRun();
    run.generations = run.generations.filter(
      generation => !(generation.profile === 'standard' && generation.caseId === absent),
    );
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe(
      `standard is missing 1 of ${suite.cases.length} suite cases (${absent})`,
    );
  });

  it('names the profile that has nothing rather than listing every case', () => {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'lite');
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems[0]!.message).toMatch(/no generations at all for standard/);
  });

  it('H: retries add rows and no coverage', () => {
    // A run that answered ten cases twice each has still answered ten cases.
    const keep = new Set(suite.cases.slice(0, 10).map(entry => entry.id));
    const run = fairRun();
    run.generations = run.generations.filter(generation => keep.has(generation.caseId));
    const retried = run.generations.map(generation => ({
      ...generation,
      id: `${generation.id.slice(0, -1)}2`,
      attempt: 2,
      retryUsed: true,
    }));
    const before = officialEvidenceProblems(suite, run, both);
    run.generations = [...run.generations, ...retried];
    expect(officialEvidenceProblems(suite, run, both)).toEqual(before);
  });

  it('I: an empty run is still refused by the earlier, clearer gate', () => {
    const run = fairRun();
    run.generations = [];
    expect(() => buildComparison(suite, run)).toThrow(/no comparable evidence/);
  });

  it('J: a suite-version mismatch is still refused before coverage is measured', () => {
    // Order matters: coverage counted against the wrong suite would be a number
    // computed from a question the run never answered.
    const revised = structuredClone(suite);
    revised.suiteVersion = 'p0.5-a.99';
    expect(() => buildComparison(revised, fairRun())).toThrow(/different suite/);
  });

  it('measures coverage against the supplied suite, never a written-down count', () => {
    // A suite that grows raises the bar by itself.
    const grown = structuredClone(suite);
    grown.cases.push({ ...structuredClone(suite.cases[0]!), id: 'ai_case_999' });
    const problems = officialEvidenceProblems(grown, fairRun(), both);
    expect(problems.map(problem => problem.message)).toEqual([
      `lite is missing 1 of ${grown.cases.length} suite cases (ai_case_999)`,
      `standard is missing 1 of ${grown.cases.length} suite cases (ai_case_999)`,
    ]);
    // The same rows qualified a moment ago against the smaller suite.
    expect(officialEvidenceProblems(suite, fairRun(), both)).toEqual([]);
  });

  it('incomplete host facts are refused', () => {
    const run = fairRun();
    run.metadata.host.logicalCores = 0;
    expect(officialEvidenceProblems(suite, run, both).map(p => p.requirement)).toContain(
      'host_facts',
    );
  });

  it('checks every requirement it declares', () => {
    // The exported list is a promise to the Rust runner. An entry nothing can
    // trip is a promise this side does not keep.
    const reached = new Set<string>();
    const trip = (mutate: (run: BenchmarkRun) => void) => {
      const run = fairRun();
      mutate(run);
      for (const problem of officialEvidenceProblems(suite, run, both)) {
        reached.add(problem.requirement);
      }
    };
    trip(run => void (run.metadata.runKind = 'smoke'));
    trip(run => void (run.metadata.gitDirty = true));
    trip(run => void (run.metadata.gitCommit = 'short'));
    trip(run => void (run.metadata.runtimeExecutableSha256 = null));
    trip(run => void (run.metadata.host.totalRamMb = 0));
    trip(run => void (run.metadata.suiteVersion = ''));
    trip(run => void (run.generations = run.generations.slice(0, 2)));

    expect([...reached].sort()).toEqual([...OFFICIAL_EVIDENCE_REQUIREMENTS].sort());
  });
});

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
      servedModel: profile,
      rawOutputPath: `raw/${first}.${profile}.2.txt`,
    });
  }

  /**
   * A run where the given profiles' first attempt on the first case was
   * rejected, which is the only history in which a retry is legitimate.
   */
  function runWithRejectedFirst(...profiles: BenchmarkProfile[]): BenchmarkRun {
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.caseId === first && profiles.includes(generation.profile)) {
        generation.accepted = false;
        generation.normalizedOutput = null;
        generation.validatorErrors = ['unknown tone tag'];
      }
    }
    return run;
  }

  it('A: first attempts that match are fair', () => {
    expect(inputParityProblems(fairRun(), ['lite', 'standard'])).toEqual([]);
  });

  it('B: a retry only one profile needed is valid evidence, not a defect', () => {
    // Lite failing and being retried while Standard succeeded first time is
    // precisely the kind of thing the benchmark exists to observe.
    const run = runWithRejectedFirst('lite');
    run.generations.push(retryRow('lite'));
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('C: both profiles retried with the same wording is fair', () => {
    const run = runWithRejectedFirst('lite', 'standard');
    run.generations.push(retryRow('lite'), retryRow('standard'));
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('D: both profiles retried with different wording is refused', () => {
    const run = runWithRejectedFirst('lite', 'standard');
    run.generations.push(retryRow('lite'), retryRow('standard', 'c'.repeat(64)));

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('attempt 2 was asked differently'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow(/identical case inputs/);
  });

  it('E: a retry may legitimately differ from attempt 1', () => {
    // The retry prompt is supposed to say something new. Comparing across
    // attempt numbers would flag every retry in the suite.
    const run = runWithRejectedFirst('lite', 'standard');
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
    accepted: boolean,
    fingerprint = RETRY,
  ): BenchmarkGeneration {
    return generationFor(first, profile, {
      id: `run:${first}:${profile}:${attempt}`,
      attempt,
      retryUsed: attempt > 1,
      accepted,
      validatorErrors: accepted ? [] : ['unknown tone tag'],
      normalizedOutput: accepted ? generationFor(first, profile).normalizedOutput : null,
      inputFingerprint: attempt === 1 ? FINGERPRINT : fingerprint,
      servedModel: profile,
      rawOutputPath: `raw/${first}.${profile}.${attempt}.txt`,
    });
  }

  /**
   * A run holding exactly the given attempts for the first case.
   *
   * Every attempt but the last is rejected, because that is the only shape a
   * retry policy can produce: a retry follows a rejection, and an acceptance
   * ends the history.
   */
  function historyRun(lite: number[], standard: number[]): BenchmarkRun {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.caseId !== first);
    for (const [index, attempt] of lite.entries()) {
      run.generations.push(rowAt('lite', attempt, index === lite.length - 1));
    }
    for (const [index, attempt] of standard.entries()) {
      run.generations.push(rowAt('standard', attempt, index === standard.length - 1));
    }
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
    run.generations.push(rowAt('standard', 2, true, 'c'.repeat(64)));

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
    const revised = { ...suite, suiteVersion: `${suite.suiteVersion}-revised` };
    const problems = suiteBindingProblems(revised, fairRun());

    expect(problems.some(problem => problem.includes(`recorded suite version '${suite.suiteVersion}'`))).toBe(true);
    expect(problems.some(problem => problem.includes(`'${suite.suiteVersion}-revised'`))).toBe(true);
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
    const revised = { ...suite, suiteVersion: `${suite.suiteVersion}-revised` };
    let message = '';
    try {
      buildComparison(revised, fairRun());
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/refusing to evaluate a run against a different suite/);
  });
});

describe('a retry must follow a rejection', () => {
  const first = caseIds[0]!;

  /** One row, with its acceptance stated rather than defaulted. */
  function row(
    profile: BenchmarkProfile,
    attempt: number,
    accepted: boolean,
  ): BenchmarkGeneration {
    return generationFor(first, profile, {
      id: `run:${first}:${profile}:${attempt}`,
      attempt,
      retryUsed: attempt > 1,
      accepted,
      validatorErrors: accepted ? [] : ['unknown tone tag'],
      normalizedOutput: accepted ? generationFor(first, profile).normalizedOutput : null,
      servedModel: profile,
      rawOutputPath: `raw/${first}.${profile}.${attempt}.txt`,
      inputFingerprint: attempt === 1 ? FINGERPRINT : 'b'.repeat(64),
    });
  }

  /** A run whose first case has exactly the given history per profile. */
  function withHistory(
    lite: Array<[number, boolean]>,
    standard: Array<[number, boolean]>,
  ): BenchmarkRun {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.caseId !== first);
    for (const [attempt, accepted] of lite) run.generations.push(row('lite', attempt, accepted));
    for (const [attempt, accepted] of standard) run.generations.push(row('standard', attempt, accepted));
    return run;
  }

  it('A: rejected 1 then accepted 2 is a real retry', () => {
    const run = withHistory([[1, false], [2, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('B: rejected 1 then rejected 2 is a valid history', () => {
    // Two failures in a row is a finding, not a malformed record.
    const run = withHistory([[1, false], [2, false]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('C: accepted 1 followed by attempt 2 is refused', () => {
    // The defect: this used to pass because 2 > 1. Retrying an answer that
    // already worked is not a retry, and counting both skews every average.
    const run = withHistory([[1, true], [2, true]], [[1, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);

    expect(problems.some(problem => problem.includes('follows an accepted attempt 1'))).toBe(true);
    expect(problems.some(problem => problem.includes('a retry must follow a rejection'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('D: accepted 2 followed by attempt 3 is refused', () => {
    const run = withHistory([[1, false], [2, true], [3, false]], [[1, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('follows an accepted attempt 2'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('E: attempt 2 with no attempt 1 is refused', () => {
    const run = withHistory([[2, true]], [[1, true]]);
    expect(() => buildComparison(suite, run)).toThrow();
    expect(
      inputParityProblems(run, ['lite', 'standard']).some(problem =>
        problem.includes('no attempt 1 for lite'),
      ),
    ).toBe(true);
  });

  it('F: retryUsed that disagrees with the history is refused', () => {
    // A first attempt claiming to be a retry, and a retry claiming not to be.
    const claiming = fairRun();
    claiming.generations[0]!.retryUsed = true;
    expect(validateRun(claiming).some(problem => problem.field === 'retryUsed')).toBe(true);

    const denying = withHistory([[1, false], [2, true]], [[1, true]]);
    const second = denying.generations.find(
      generation => generation.profile === 'lite' && generation.attempt === 2,
    )!;
    second.retryUsed = false;
    expect(validateRun(denying).some(problem => problem.field === 'retryUsed')).toBe(true);
  });

  it('G: a unilateral retry stays valid across profiles', () => {
    // Lite needed a second try, Standard did not. That asymmetry is the
    // observation, not a defect.
    const run = withHistory([[1, false], [2, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('keeps an invalid history out of every aggregate', () => {
    // The consequence the finding named: latency, quality means and retry
    // totals must never be computed from a history the policy forbids.
    const run = withHistory([[1, true], [2, true]], [[1, true]]);
    expect(() => buildComparison(suite, run)).toThrow();
  });
});

describe('a comparison needs something to compare', () => {
  it('A: a run with no generations at all is refused', () => {
    // An interrupted or half-copied evidence directory looks exactly like this,
    // and every other check passes it by vacuous truth.
    const run = fairRun();
    run.generations = [];

    expect(comparableEvidenceProblems(run, ['lite', 'standard'])).toHaveLength(1);
    expect(() => buildComparison(suite, run)).toThrow(/no comparable evidence/);
  });

  it('B: Lite rows only, comparing Lite and Standard, is refused', () => {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'lite');

    const problems = comparableEvidenceProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no generations for standard'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow(/no comparable evidence/);
  });

  it('C: Standard rows only is refused symmetrically', () => {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'standard');

    const problems = comparableEvidenceProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no generations for lite'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('D: at least one case answered by both passes this gate', () => {
    expect(comparableEvidenceProblems(fairRun(), ['lite', 'standard'])).toEqual([]);
  });

  it('refuses rows that share no case between the profiles', () => {
    // Both profiles present, nothing in common: still nothing to set side by
    // side. Coverage would catch it too, but this gate is about evidence
    // existing at all.
    const run = fairRun();
    run.generations = [
      run.generations.find(g => g.profile === 'lite' && g.caseId === caseIds[0])!,
      run.generations.find(g => g.profile === 'standard' && g.caseId === caseIds[1])!,
    ];
    const problems = comparableEvidenceProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no case answered by all of'))).toBe(true);
  });

  it('E: an empty run reaches no caseCount, summary or latency aggregate', () => {
    const run = fairRun();
    run.generations = [];
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('F: the message says plainly there is nothing to compare', () => {
    const run = fairRun();
    run.generations = [];
    let message = '';
    try {
      buildComparison(suite, run);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/no comparable evidence/);
    expect(message).toMatch(/no generations at all/);
  });
});

describe('a structurally invalid run never reaches an aggregate', () => {
  const first = caseIds[0]!;

  it('A: a structurally valid run builds', () => {
    expect(validateRun(fairRun())).toEqual([]);
    expect(() => buildComparison(suite, fairRun())).not.toThrow();
  });

  it('B: attempt 1 claiming retryUsed is refused', () => {
    // Would overcount retries in the summary.
    const run = fairRun();
    run.generations[0]!.retryUsed = true;
    expect(() => buildComparison(suite, run)).toThrow(/structurally invalid run/);
  });

  it('C: attempt 2 denying retryUsed is refused', () => {
    // Would undercount them.
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.caseId === first) {
        generation.accepted = false;
        generation.normalizedOutput = null;
        generation.validatorErrors = ['unknown tone tag'];
      }
    }
    run.generations.push(
      generationFor(first, 'lite', {
        id: `run:${first}:lite:2`,
        attempt: 2,
        retryUsed: false,
        servedModel: 'lite',
        rawOutputPath: `raw/${first}.lite.2.txt`,
      }),
    );
    expect(() => buildComparison(suite, run)).toThrow(/structurally invalid run/);
  });

  it('D: accepted with a null output is refused rather than crashing evaluation', () => {
    // This one used to reach `evaluateObjectively` and fall over there.
    const run = fairRun();
    run.generations[0]!.normalizedOutput = null;
    expect(() => buildComparison(suite, run)).toThrow(/structurally invalid run/);
  });

  it('E: the structural check runs before evaluation, not after', () => {
    // A run that is both structurally invalid and unfair must report the
    // structural problem: it is the one that makes everything else meaningless.
    const run = fairRun();
    run.generations[0]!.normalizedOutput = null;
    run.generations[1]!.inputFingerprint = 'f'.repeat(64);

    let message = '';
    try {
      buildComparison(suite, run);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/structurally invalid run/);
    expect(message).not.toMatch(/identical case inputs/);
  });

  it('F: a malformed run cannot influence any aggregate', () => {
    const run = fairRun();
    run.generations[0]!.retryUsed = true;
    run.generations[0]!.latencyMs = 999_999;
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('G: validateRun stays the single owner of these rules', () => {
    // The report refuses; it does not re-implement. Every problem it reports
    // here came from validateRun itself.
    const run = fairRun();
    run.generations[0]!.retryUsed = true;
    const problems = validateRun(run);
    expect(problems.some(problem => problem.field === 'retryUsed')).toBe(true);
  });
});

describe('one retry, and only one', () => {
  const first = caseIds[0]!;

  function row(profile: BenchmarkProfile, attempt: number, accepted: boolean): BenchmarkGeneration {
    return generationFor(first, profile, {
      id: `run:${first}:${profile}:${attempt}`,
      attempt,
      retryUsed: attempt > 1,
      accepted,
      validatorErrors: accepted ? [] : ['unknown tone tag'],
      normalizedOutput: accepted ? generationFor(first, profile).normalizedOutput : null,
      servedModel: profile,
      rawOutputPath: `raw/${first}.${profile}.${attempt}.txt`,
      inputFingerprint: attempt === 1 ? FINGERPRINT : 'b'.repeat(64),
    });
  }

  function withHistory(
    lite: Array<[number, boolean]>,
    standard: Array<[number, boolean]>,
  ): BenchmarkRun {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.caseId !== first);
    for (const [attempt, accepted] of lite) run.generations.push(row('lite', attempt, accepted));
    for (const [attempt, accepted] of standard) run.generations.push(row('standard', attempt, accepted));
    return run;
  }

  it('states the policy in one place', () => {
    expect(MAX_RETRIES).toBe(1);
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it('A: accepted on the first attempt is valid', () => {
    const run = withHistory([[1, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('B: rejected 1 then accepted 2 is valid', () => {
    const run = withHistory([[1, false], [2, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('C: rejected 1 then rejected 2 is valid, and the retry is exhausted', () => {
    // Two failures is a finding. What it is not is permission for a third try.
    const run = withHistory([[1, false], [2, false]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('D: rejected, rejected, then accepted on attempt 3 is refused', () => {
    // The gap the previous rule left: contiguous, each retry following a
    // rejection, and still outside the policy.
    const run = withHistory([[1, false], [2, false], [3, true]], [[1, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);

    expect(problems.some(problem => problem.includes('attempt 3 exceeds the one-shot retry'))).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('E: a third rejected attempt is refused too', () => {
    const run = withHistory([[1, false], [2, false], [3, false]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard']).length).toBeGreaterThan(0);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('F: accepted 1 followed by attempt 2 is still refused', () => {
    const run = withHistory([[1, true], [2, true]], [[1, true]]);
    expect(
      attemptHistoryProblems(run, ['lite', 'standard']).some(problem =>
        problem.includes('a retry must follow a rejection'),
      ),
    ).toBe(true);
  });

  it('G: attempt 2 with no attempt 1 is still refused', () => {
    const run = withHistory([[2, true]], [[1, true]]);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('H: a unilateral retry stays valid', () => {
    // Lite needed its one retry, Standard did not. Still comparable.
    const run = withHistory([[1, false], [2, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => buildComparison(suite, run)).not.toThrow();
  });

  it('I: a third attempt can never enter latency, quality or retry totals', () => {
    // Both gates catch it: the structural one and the history one. Neither
    // report is ever built.
    const run = withHistory([[1, false], [2, false], [3, true]], [[1, true]]);
    expect(validateRun(run).some(problem => problem.field === 'attempt')).toBe(true);
    expect(() => buildComparison(suite, run)).toThrow();
  });

  it('applies per profile independently', () => {
    // Standard overrunning the budget is Standard's problem, and it is named.
    const run = withHistory([[1, true]], [[1, false], [2, false], [3, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('for standard: attempt 3'))).toBe(true);
    expect(problems.some(problem => problem.includes('for lite'))).toBe(false);
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
