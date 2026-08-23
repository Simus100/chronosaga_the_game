import { lockedRuntime, runtimeProvenanceMismatches } from '../src/runtime-lock.js';
import rootRuntimeLock from '../../../config/local-ai-runtime.lock.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import {
  attemptHistoryProblems,
  buildComparisonWithTrustedCheckout,
  comparableEvidenceProblems,
  inputParityProblems,
  judgementProblems,
  officialEvidenceProblems,
  renderComparison,
  officialProfileSetProblem,
  reviewPopulationProblems,
  scorePopulationProblems,
  terminalGenerations,
  OFFICIAL_EVIDENCE_REQUIREMENTS,
  suiteBindingProblems,
  suiteContentDigest,
  taskMismatches,
} from '../src/report.js';
import { asHardFails, validateHumanReview, type HumanReview } from '../src/human-review.js';
import { acceptedOutputContractProblems, caseSubjectIds } from '../src/contract.js';
import { lockedArtifact, lockedArtifactProblems } from '../src/model-lock.js';
import rootModelLock from '../../../config/local-ai-models.lock.json' with { type: 'json' };
import type { BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';
import type { ScoreSheet } from '../src/scoring.js';
import {
  MAX_ATTEMPTS,
  MAX_RETRIES,
  MAX_ATTEMPTS as CONTRACT_MAX_ATTEMPTS,
  OFFICIAL_COMPARISON_PROFILES,
  validateRun,
} from '../src/result.js';

/**
 * `buildComparisonWithTrustedCheckout` with a checkout that matches the run being reported.
 *
 * Every existing test describes a report produced from the run's own commit,
 * which is the ordinary case. Deriving it from the run here simulates that
 * situation; it is not the production path, where the commit is read from the
 * repository. The tests that matter for this boundary build mismatches
 * explicitly.
 */
function reportedFromItsOwnCheckout(
  suiteUnderTest: Parameters<typeof buildComparisonWithTrustedCheckout>[0],
  run: Parameters<typeof buildComparisonWithTrustedCheckout>[1],
  profiles?: Parameters<typeof buildComparisonWithTrustedCheckout>[2],
  sheet?: Parameters<typeof buildComparisonWithTrustedCheckout>[3],
  review?: Parameters<typeof buildComparisonWithTrustedCheckout>[4],
) {
  return buildComparisonWithTrustedCheckout(suiteUnderTest, run, profiles, sheet, review, {
    gitCommit: run.metadata.gitCommit,
    gitDirty: false,
  });
}


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

const AXES = {
  italian_fluency: 4, grounding: 4, character_consistency: 4, memory_use: 4,
  instruction_adherence: 4, schema_compliance: 4, non_contradiction: 4,
  narrative_usefulness: 4, repetition_resistance: 4, latency_acceptability: 4,
} as const;

/**
 * A score sheet covering every terminal generation of a run.
 *
 * What an official human pass actually produces: one observation per case per
 * profile. A sheet with a handful of scores is what the report used to average
 * and call a comparison.
 */
function fullSheet(run: BenchmarkRun, over: Partial<ScoreSheet> = {}): ScoreSheet {
  return {
    runId: 'run',
    suiteVersion: suite.suiteVersion,
    scores: terminalGenerations(run, ['lite', 'standard']).map(generation => ({
      generationId: generation.id,
      scoredBy: 'simone',
      scoredAt: '2026-08-21T00:00:00.000Z',
      scores: { ...AXES },
    })),
    ...over,
  };
}

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
      suiteContentSha256: suiteContentDigest(suite),
      runnerVersion: '0.1.0',
      // The runtime this checkout locks, not an invented digest.
      runtimeReleaseTag: lockedRuntime().releaseTag,
      runtimeExecutableSha256: lockedRuntime().executableSha256,
      host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7', logicalCores: 24, totalRamMb: 65536 },
    },
    generations: caseIds.flatMap(caseId => [
      generationFor(caseId, 'lite'),
      generationFor(caseId, 'standard'),
    ]),
  };
}

describe('accepted evidence must satisfy its own case contract', () => {
  const first = caseIds[0]!;
  const testCase = () => suite.cases.find(entry => entry.id === first)!;

  /** `fairRun` with the first Lite row's accepted output edited. */
  function withOutput(edit: (output: NonNullable<BenchmarkGeneration['normalizedOutput']>) => void) {
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    edit(row.normalizedOutput!);
    return run;
  }

  it('A: a fully case-compliant accepted row passes', () => {
    expect(acceptedOutputContractProblems(suite, fairRun())).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  it('B: an unknown speaker marked accepted is impossible evidence', () => {
    // Corrects an assumption I stated earlier: the Rust validator rejects this,
    // so it is not a bad answer to score — it is an acceptance that could never
    // have been recorded.
    const run = withOutput(output => {
      output.dialogue = [{ speakerId: 'ghost_999', text: 'Non esisto.' }];
    });
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(/unknown speaker: ghost_999/);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/could not have accepted/);
  });

  it('C: a missing required speaker marked accepted is refused', () => {
    expect(testCase().constraints.requiredSpeakerIds?.length).toBeGreaterThan(0);
    const run = withOutput(output => void (output.dialogue = []));
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(/dialogue from/);
  });

  it('D: a tone tag outside the vocabulary is refused', () => {
    const run = withOutput(output => void (output.toneTags = ['epico']));
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(/unknown tone tag: epico/);
  });

  it('E: narration over the case limit is refused', () => {
    const limit = testCase().constraints.maxNarrationChars;
    const run = withOutput(output => void (output.narration = 'a'.repeat(limit + 1)));
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(
      new RegExp(`narration is ${limit + 1} characters`),
    );
  });

  it('F: narration length uses the same scalar count as Rust', () => {
    const limit = testCase().constraints.maxNarrationChars;
    const atLimit = withOutput(output => void (output.narration = '🌍'.repeat(limit)));
    // 2 * limit UTF-16 code units, and Rust accepts it, so this must too.
    expect(acceptedOutputContractProblems(suite, atLimit)).toEqual([]);
    const over = withOutput(output => void (output.narration = '🌍'.repeat(limit + 1)));
    expect(acceptedOutputContractProblems(suite, over)).toHaveLength(1);
  });

  it('G: a proposal where proposals are forbidden is refused', () => {
    expect(testCase().constraints.allowEventProposals ?? false).toBe(false);
    const run = withOutput(output => {
      output.eventProposals = [{ subjectId: 'settlement_helios', topic: 't', rationale: 'r' }];
    });
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(/event_proposals are not accepted/);
  });

  it('H and I: a required proposal must be present and grounded', () => {
    const inviting = suite.cases.find(entry => entry.constraints.requireEventProposal)!;
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === inviting.id,
    )!;

    row.normalizedOutput!.eventProposals = [];
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(
      /required field missing or empty: event_proposals/,
    );

    row.normalizedOutput!.eventProposals = [
      { subjectId: 'settlement_fake', topic: 't', rationale: 'r' },
    ];
    expect(caseSubjectIds(inviting)).not.toContain('settlement_fake');
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(
      /event proposal is about 'settlement_fake', which the scene does not contain/,
    );
  });

  it('J: a memory suggestion where they are forbidden is refused', () => {
    const run = withOutput(output => {
      output.memorySuggestions = [{ characterId: 'mara_001', summary: 's' }];
    });
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(
      /memory_suggestions are not accepted/,
    );
  });

  it('K and L: a required memory must be present and about a real character', () => {
    const inviting = suite.cases.find(entry => entry.constraints.requireMemorySuggestion)!;
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === inviting.id,
    )!;

    row.normalizedOutput!.memorySuggestions = [];
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(
      /required field missing or empty: memory_suggestions/,
    );

    row.normalizedOutput!.memorySuggestions = [{ characterId: 'ghost_999', summary: 's' }];
    expect(acceptedOutputContractProblems(suite, run)[0]).toMatch(/unknown speaker: ghost_999/);
  });

  it('M: rejected rows are left alone', () => {
    // A rejection carries normalizedOutput: null and its validator errors. There
    // is no payload to re-check, and inventing one would prove nothing.
    const run = fairRun();
    const row = run.generations[0]!;
    row.accepted = false;
    row.validatorErrors = ['unknown tone tag: epico'];
    row.normalizedOutput = null;
    expect(acceptedOutputContractProblems(suite, run)).toEqual([]);
  });

  it('N and O: one impossible row refuses the whole report', () => {
    const run = withOutput(output => void (output.toneTags = ['epico']));
    expect(run.generations.length).toBe(suite.cases.length * 2);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/could not have accepted/);
  });

  it('leaves genuine quality failures to the evaluator', () => {
    // A grounded, in-vocabulary, in-limit answer that is simply weak stays in
    // the run and gets scored. Refusing it here would refuse to report the
    // failures the benchmark exists to measure.
    const run = withOutput(output => void (output.narration = 'Non succede nulla di utile.'));
    expect(acceptedOutputContractProblems(suite, run)).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });
});

describe('each profile carries the artifact the project locked', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];

  /** `fairRun` with every row of `profile` carrying `artifact` overrides. */
  function withArtifact(profile: BenchmarkProfile, over: Record<string, unknown>) {
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.profile !== profile) continue;
      generation.artifact = { ...generation.artifact, ...over } as typeof generation.artifact;
    }
    return run;
  }

  it('A and B: the locked identities pass', () => {
    expect(lockedArtifactProblems(fairRun(), both)).toEqual([]);
    for (const profile of both) {
      const locked = lockedArtifact(profile)!;
      const row = fairRun().generations.find(entry => entry.profile === profile)!;
      expect(row.artifact.sha256).toBe(locked.sha256);
      expect(row.artifact.artifactFilename).toBe(locked.artifactFilename);
    }
  });

  it('C and D: a profile carrying the other one\'s digest is refused', () => {
    for (const [profile, other] of [
      ['lite', 'standard'],
      ['standard', 'lite'],
    ] as const) {
      const run = withArtifact(profile, { sha256: lockedArtifact(other)!.sha256 });
      expect(lockedArtifactProblems(run, both)[0], profile).toMatch(/sha256 is/);
      expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/unlocked artifacts/);
    }
  });

  it('E: both profiles carrying the Lite artifact is refused', () => {
    // One model against itself under two names, which is the whole hazard.
    const lite = lockedArtifact('lite')!;
    const run = withArtifact('standard', { ...lite, profileId: 'standard' });
    expect(lockedArtifactProblems(run, both).length).toBeGreaterThan(0);
  });

  it('F and G: an arbitrary but internally consistent artifact is refused', () => {
    const forged = {
      family: 'MysteryModel-9B',
      quantization: 'Q8_0',
      artifactFilename: 'mystery.gguf',
      sizeBytes: 123,
      sha256: 'f'.repeat(64),
    };
    for (const profile of both) {
      const run = withArtifact(profile, forged);
      expect(lockedArtifactProblems(run, both).length, profile).toBeGreaterThan(0);
    }
    // And the same forged artifact on both profiles is refused too.
    let run = withArtifact('lite', forged);
    for (const generation of run.generations) {
      if (generation.profile === 'standard') {
        generation.artifact = { ...generation.artifact, ...forged } as typeof generation.artifact;
      }
    }
    expect(lockedArtifactProblems(run, both).length).toBeGreaterThan(0);
  });

  it('H through L: every locked identity field is checked', () => {
    const drift: Array<[string, unknown]> = [
      ['artifactFilename', 'renamed.gguf'],
      ['sizeBytes', 999],
      ['family', 'SomethingElse'],
      ['quantization', 'Q8_0'],
      ['releaseApproved', true],
    ];
    for (const [field, value] of drift) {
      const run = withArtifact('lite', { [field]: value });
      const problems = lockedArtifactProblems(run, both);
      expect(problems, field).toHaveLength(1);
      expect(problems[0], field).toContain(field);
    }
  });

  it('M: where the resolver found the bytes does not change their identity', () => {
    // `source` is runtime provenance, not something the lock defines.
    for (const source of ['packaged payload', 'user model library', 'development workspace']) {
      expect(lockedArtifactProblems(withArtifact('lite', { source }), both), source).toEqual([]);
    }
  });

  it('N: the lock is the only authority, checked against the root file itself', () => {
    // Not a claim about the import statement: the values the gate compares
    // against are read out of config/local-ai-models.lock.json here and matched
    // field for field. Editing the root lock without the gate following would
    // fail this test, which is what "no second authority" has to mean.
    const authoritative = (rootModelLock as unknown as {
      profiles: Record<string, Record<string, unknown>>;
    }).profiles;
    expect(Object.keys(authoritative).sort()).toEqual([...both].sort());
    for (const profile of both) {
      const locked = lockedArtifact(profile)! as unknown as Record<string, unknown>;
      for (const field of Object.keys(locked)) {
        expect(locked[field], `${profile}.${field}`).toEqual(authoritative[profile]![field]);
      }
    }
  });

  it('O: the two locked candidates are distinct artifacts', () => {
    const lite = lockedArtifact('lite')!;
    const standard = lockedArtifact('standard')!;
    expect(lite.sha256).not.toBe(standard.sha256);
    expect(lite.artifactFilename).not.toBe(standard.artifactFilename);
    expect(lite.family).not.toBe(standard.family);
  });

  it('one mismatched row invalidates the whole official report', () => {
    const run = fairRun();
    run.generations.at(-1)!.artifact = {
      ...run.generations.at(-1)!.artifact,
      sha256: 'a'.repeat(64),
    };
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/unlocked artifacts/);
  });
});

describe('official evidence names the runtime this checkout locks', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];

  const withRuntime = (over: Partial<{ tag: string; digest: string | null }>) => {
    const run = fairRun();
    if (over.tag !== undefined) run.metadata.runtimeReleaseTag = over.tag;
    if (over.digest !== undefined) run.metadata.runtimeExecutableSha256 = over.digest;
    return run;
  };

  it('A: the locked release and digest pass', () => {
    expect(runtimeProvenanceMismatches(fairRun().metadata)).toEqual([]);
    expect(officialEvidenceProblems(suite, fairRun(), both)).toEqual([]);
  });

  it('B: a syntactically valid but different release tag is refused', () => {
    // Format was the only thing checked before, and any non-empty string has a
    // valid format.
    const run = withRuntime({ tag: 'b99999' });
    const problems = runtimeProvenanceMismatches(run.metadata);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'b99999'");
    expect(problems[0]).toContain(lockedRuntime().releaseTag);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/runtime_provenance/);
  });

  it('C: an arbitrary well-formed digest is refused', () => {
    const run = withRuntime({ digest: 'a'.repeat(64) });
    expect(runtimeProvenanceMismatches(run.metadata)).toHaveLength(1);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/runtime_provenance/);
  });

  it('D and E: either half alone is enough to refuse', () => {
    expect(runtimeProvenanceMismatches(withRuntime({ tag: 'b00001' }).metadata)).toHaveLength(1);
    expect(runtimeProvenanceMismatches(withRuntime({ digest: 'b'.repeat(64) }).metadata)).toHaveLength(
      1,
    );
  });

  it('F: absent or malformed values keep their structural refusal', () => {
    for (const run of [withRuntime({ digest: null }), withRuntime({ digest: 'abc123' })]) {
      const requirements = officialEvidenceProblems(suite, run, both).map(
        problem => problem.requirement,
      );
      expect(requirements).toContain('runtime_provenance');
    }
    const untagged = withRuntime({ tag: '   ' });
    expect(
      officialEvidenceProblems(suite, untagged, both).map(problem => problem.requirement),
    ).toContain('runtime_provenance');
  });

  it('G: the expected values come from the committed lock, not from literals', () => {
    const authoritative = rootRuntimeLock as unknown as {
      releaseTag: string;
      executableSha256: string;
    };
    expect(lockedRuntime().releaseTag).toBe(authoritative.releaseTag);
    expect(lockedRuntime().executableSha256).toBe(authoritative.executableSha256);
    expect(lockedRuntime().executableSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('H: one mismatch prevents every official aggregate', () => {
    const run = withRuntime({ tag: 'b99999' });
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/refusing to publish/);
    expect(() => reportedFromItsOwnCheckout(suite, run, both, fullSheet(run))).toThrow(/refusing to publish/);
  });

  it('J: nothing is mutated or repaired', () => {
    const run = withRuntime({ tag: 'b99999' });
    const before = structuredClone(run.metadata);
    runtimeProvenanceMismatches(run.metadata);
    expect(run.metadata).toEqual(before);
    expect(run.metadata.runtimeReleaseTag).toBe('b99999');
  });
});

describe('a report is bound to the exact contents of its suite', () => {
  it('A: the unchanged suite passes', () => {
    expect(suiteBindingProblems(suite, fairRun())).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  const mutated = (edit: (copy: typeof suite) => void) => {
    const copy = structuredClone(suite);
    edit(copy);
    expect(copy.suiteVersion, 'the version must stay put').toBe(suite.suiteVersion);
    return copy;
  };

  it('B: a changed expected fact is refused, version untouched', () => {
    const copy = mutated(entry => void (entry.cases[0]!.expectedFacts[0] = 'something else'));
    expect(suiteBindingProblems(copy, fairRun())[0]).toMatch(/same version, different contents/);
    expect(() => reportedFromItsOwnCheckout(copy, fairRun())).toThrow(/different suite/);
  });

  it('C: a changed constraint is refused', () => {
    const copy = mutated(entry => void (entry.cases[0]!.constraints.maxNarrationChars = 1));
    expect(suiteBindingProblems(copy, fairRun())).toHaveLength(1);
  });

  it('D: a changed worldStateSlice is refused', () => {
    const copy = mutated(entry => {
      (entry.cases[0]!.worldStateSlice as Record<string, never>).injected = 1 as never;
    });
    expect(suiteBindingProblems(copy, fairRun())).toHaveLength(1);
  });

  it('E: a changed forbidden claim is refused', () => {
    const copy = mutated(entry => void (entry.cases[0]!.forbiddenClaims[0] = 'anything'));
    expect(suiteBindingProblems(copy, fairRun())).toHaveLength(1);
  });

  it('F: a case added or removed is refused', () => {
    const removed = mutated(entry => void entry.cases.pop());
    expect(suiteBindingProblems(removed, fairRun())).toHaveLength(1);
    const added = mutated(entry => void entry.cases.push(structuredClone(entry.cases[0]!)));
    expect(suiteBindingProblems(added, fairRun())).toHaveLength(1);
  });

  it('G: reordering object keys changes nothing', () => {
    // Key order is not meaning; array order is.
    // A genuine deep re-key: same data, every object's keys emitted in reverse
    // order. A replacer array would filter keys instead of reordering them.
    const rekey = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rekey);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort().reverse()) {
          out[key] = rekey((value as Record<string, unknown>)[key]);
        }
        return out;
      }
      return value;
    };
    const reordered = rekey(structuredClone(suite)) as typeof suite;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(suite));
    expect(suiteContentDigest(reordered)).toBe(suiteContentDigest(suite));

    const swapped = structuredClone(suite);
    swapped.cases = [swapped.cases[1]!, swapped.cases[0]!, ...swapped.cases.slice(2)];
    expect(suiteContentDigest(swapped)).not.toBe(suiteContentDigest(suite));
  });

  it('H and I: an absent or malformed digest is refused as evidence', () => {
    for (const value of ['', 'not-a-digest', 'C7E61A89'.repeat(8)]) {
      const run = fairRun();
      (run.metadata as { suiteContentSha256: string }).suiteContentSha256 = value;
      const problems = validateRun(run);
      expect(problems.map(problem => problem.field), value).toContain(
        'metadata.suiteContentSha256',
      );
      expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
    }
  });

  it('refuses before any evaluation happens', () => {
    const copy = mutated(entry => void (entry.cases[0]!.expectedFacts[0] = 'edited'));
    try {
      reportedFromItsOwnCheckout(copy, fairRun());
      throw new Error('should have refused');
    } catch (error) {
      expect((error as Error).message).toMatch(/refusing to evaluate a run against a different suite/);
    }
  });
});

describe('an official comparison is exactly Lite versus Standard', () => {
  it('A: lite and standard is the comparison', () => {
    expect(officialProfileSetProblem(['lite', 'standard'])).toBeNull();
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'])).not.toThrow();
  });

  it('B: the order the caller passes does not matter', () => {
    expect(officialProfileSetProblem(['standard', 'lite'])).toBeNull();
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['standard', 'lite'])).not.toThrow();
  });

  it('J: and the report is always Lite then Standard', () => {
    // Same evidence, two call orders, one reading.
    const asked = reportedFromItsOwnCheckout(suite, fairRun(), ['standard', 'lite']);
    expect(asked.profiles.map(entry => entry.profile)).toEqual(['lite', 'standard']);
    expect(asked).toEqual(reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard']));
  });

  it('C and D: one profile alone is not a comparison', () => {
    for (const only of [['lite'], ['standard']] as const) {
      const problem = officialProfileSetProblem([...only]);
      expect(problem, only[0]).toMatch(/is absent, so nothing is being compared/);
      expect(() => reportedFromItsOwnCheckout(suite, fairRun(), [...only])).toThrow(
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
    expect(() => reportedFromItsOwnCheckout(suite, run, ['lite'])).toThrow(
      /refusing to build an official comparison/,
    );
  });

  it('E: an empty profile list is refused', () => {
    expect(officialProfileSetProblem([])).toMatch(/no profiles were given/);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), [])).toThrow(/no profiles were given/);
  });

  it('F and G: a profile compared with itself is not a comparison', () => {
    expect(officialProfileSetProblem(['lite', 'lite'])).toMatch(/appears more than once/);
    expect(officialProfileSetProblem(['lite', 'standard', 'lite'])).toMatch(
      /appears more than once/,
    );
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'lite'])).toThrow(
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
    expect(() => reportedFromItsOwnCheckout(suite, run, ['lite'])).toThrow(
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
    // validateRun runs first in buildComparisonWithTrustedCheckout, so nothing downstream — scoring,
    // latency, retry counts, acceptance rates — ever sees the row.
    const run = fairRun();
    run.generations.find(generation => generation.profile === 'lite')!.servedModel = 'standard';
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('J: one wrong row invalidates the run, however many are right', () => {
    const run = fairRun();
    expect(validateRun(run)).toEqual([]);
    run.generations.at(-1)!.servedModel = 'lite';
    expect(validateRun(run)).not.toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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

describe('a rejected first attempt is owed its retry', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];
  const first = caseIds[0]!;

  /** `fairRun` with one pair rewritten to the given `(attempt, accepted)` history. */
  function withHistory(profile: BenchmarkProfile, history: Array<[number, boolean]>) {
    const run = fairRun();
    const template = run.generations.find(
      generation => generation.profile === profile && generation.caseId === first,
    )!;
    run.generations = run.generations.filter(
      generation => !(generation.profile === profile && generation.caseId === first),
    );
    for (const [attempt, accepted] of history) {
      run.generations.push({
        ...structuredClone(template),
        id: `run:${first}:${profile}:${attempt}`,
        attempt,
        retryUsed: attempt > 1,
        accepted,
        validatorErrors: accepted ? [] : ['unknown tone tag'],
        normalizedOutput: accepted ? template.normalizedOutput : null,
        rawOutputPath: `raw/${first}.${profile}.${attempt}.txt`,
      });
    }
    return run;
  }

  it('A, B and C: the three finished shapes are complete evidence', () => {
    for (const history of [
      [[1, true]],
      [[1, false], [2, true]],
      [[1, false], [2, false]],
    ] as Array<Array<[number, boolean]>>) {
      const run = withHistory('lite', history);
      expect(officialEvidenceProblems(suite, run, both), JSON.stringify(history)).toEqual([]);
      expect(terminalGenerations(run, both)).toHaveLength(suite.cases.length * 2);
    }
  });

  it('D and G: a rejected attempt 1 alone establishes nothing', () => {
    const run = withHistory('lite', [[1, false]]);
    expect(validateRun(run)).toEqual([]);
    expect(
      terminalGenerations(run, both).some(
        generation => generation.profile === 'lite' && generation.caseId === first,
      ),
    ).toBe(false);
  });

  it('H: the refusal names the case, the profile, and the missing retry', () => {
    const problems = officialEvidenceProblems(suite, withHistory('lite', [[1, false]]), both);
    const incomplete = problems.find(
      problem => problem.requirement === 'complete_retry_history',
    )!;
    expect(incomplete.message).toContain(first);
    expect(incomplete.message).toContain('lite');
    expect(incomplete.message).toMatch(/retry evidence is missing/);
  });

  it('F: one interrupted pair among otherwise complete ones refuses the run', () => {
    const run = withHistory('standard', [[1, false]]);
    expect(run.generations.length).toBe(suite.cases.length * 2);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/complete_retry_history/);
  });

  it('E: a full 65x2 coverage made entirely of rejected first attempts is refused', () => {
    // The shape that used to read as a completed run in which both models failed
    // everything. It is 130 interruptions.
    const run = fairRun();
    for (const generation of run.generations) {
      generation.accepted = false;
      generation.validatorErrors = ['unknown tone tag'];
      generation.normalizedOutput = null;
    }
    expect(validateRun(run)).toEqual([]);
    expect(terminalGenerations(run, both)).toHaveLength(0);
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.filter(p => p.requirement === 'complete_retry_history')).toHaveLength(
      suite.cases.length * 2,
    );
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('I and J: a retry after acceptance and a third attempt are still refused', () => {
    for (const history of [
      [[1, true], [2, false]],
      [[1, false], [2, false], [3, false]],
    ] as Array<Array<[number, boolean]>>) {
      const run = withHistory('lite', history);
      expect(() => reportedFromItsOwnCheckout(suite, run), JSON.stringify(history)).toThrow();
    }
  });

  it('K: one profile may use its retry while the other does not', () => {
    // The shape the benchmark exists to observe, and it must stay valid.
    const run = withHistory('standard', [[1, false], [2, true]]);
    expect(officialEvidenceProblems(suite, run, both)).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('takes the retry ceiling from the contract, not from a number written here', () => {
    expect(MAX_ATTEMPTS).toBe(MAX_RETRIES + 1);
    const atCeiling = withHistory('lite', [[1, false], [2, false]]);
    expect(officialEvidenceProblems(suite, atCeiling, both)).toEqual([]);
  });
});

describe('malformed metrics cannot corrupt an aggregate', () => {
  it('O and P: neither the median nor the mean can see one', () => {
    for (const [field, value] of [
      ['latencyMs', '100'],
      ['tokensPerSecond', '18.4'],
      ['tokensGenerated', '120'],
    ] as const) {
      const run = fairRun();
      (run.generations[0] as unknown as Record<string, unknown>)[field] = value;
      expect(validateRun(run).some(problem => problem.field === field), field).toBe(true);
      expect(() => reportedFromItsOwnCheckout(suite, run), field).toThrow(/structurally invalid run/);
    }
  });

  it('Q: the concrete "100" + "200" corruption is unreachable', () => {
    // Two string latencies would have made the median read "100200".
    const run = fairRun();
    const lite = run.generations.filter(generation => generation.profile === 'lite');
    (lite[0] as unknown as Record<string, unknown>).latencyMs = '100';
    (lite[1] as unknown as Record<string, unknown>).latencyMs = '200';

    // The arithmetic that would have happened, shown for what it is.
    expect(('100' as unknown as number) + ('200' as unknown as number)).toBe('100200');

    // And the run never reaches it.
    expect(validateRun(run).filter(problem => problem.field === 'latencyMs')).toHaveLength(2);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('legitimate metrics still aggregate', () => {
    const report = reportedFromItsOwnCheckout(suite, fairRun());
    for (const profile of report.profiles) {
      expect(typeof profile.medianLatencyMs).toBe('number');
      expect(typeof profile.meanTokensPerSecond).toBe('number');
    }
  });
});

describe('contradictory raw evidence cannot become compliance', () => {
  const first = caseIds[0]!;

  it('K and L: it never reaches the evaluator, so it never scores as bare', () => {
    // Read at face value, `bareJson: true` beside `codeFencePresent: true` would
    // pass the strict check on a response that was fenced. The run is refused
    // before evaluateObjectively is ever called.
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    row.rawFormat = { bareJson: true, codeFencePresent: true, wrapperTextPresent: false };

    const problems = validateRun(run);
    expect(problems.map(problem => problem.field)).toContain('rawFormat.codeFencePresent');
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('a malformed flag type is refused before any aggregate too', () => {
    for (const rawFormat of [
      { bareJson: 'true', codeFencePresent: false, wrapperTextPresent: false },
      { bareJson: true, codeFencePresent: false },
      'bare',
    ]) {
      const run = fairRun();
      run.generations[0]!.rawFormat = rawFormat as never;
      expect(() => reportedFromItsOwnCheckout(suite, run), JSON.stringify(rawFormat)).toThrow(
        /structurally invalid run/,
      );
    }
  });
});

describe('a truthy acceptance flag cannot become a successful result', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];
  const first = caseIds[0]!;

  /** `fairRun` with one Lite row's `accepted` replaced by external-shaped JSON. */
  function withFlag(accepted: unknown) {
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    (row as unknown as Record<string, unknown>).accepted = accepted;
    return run;
  }

  it('H: it cannot establish a terminal successful generation', () => {
    // A rejected first attempt owes a retry. Read as truthy, this row would have
    // ended the history as a success and the missing retry would go unnoticed.
    const run = withFlag('false');
    expect(validateRun(run).some(problem => problem.field === 'accepted')).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('I: it cannot contribute to official profile-case coverage', () => {
    const run = withFlag('false');

    // The hazard, made visible: read as truthy, the row *does* look like a
    // finished successful history to the coverage helper, which is exactly why
    // the type has to be checked before anything reaches it.
    expect(
      terminalGenerations(run, both).some(
        generation => generation.id === `run:${first}:lite:1`,
      ),
    ).toBe(true);

    // And it never gets there: validateRun is the first gate in buildComparisonWithTrustedCheckout,
    // so the refusal is the structural one, not a coverage complaint.
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow(/coverage/);
  });

  it('J: it cannot increment casesAccepted or reach any aggregate', () => {
    for (const value of ['false', 'true', 1, 0, null, {}]) {
      const run = withFlag(value);
      expect(() => reportedFromItsOwnCheckout(suite, run), JSON.stringify(value)).toThrow(
        /structurally invalid run/,
      );
    }
  });

  it('L: every legitimate run in this suite still validates', () => {
    expect(validateRun(fairRun())).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });
});

describe('an unreviewed case is not a case with no findings', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];
  const first = caseIds[0]!;

  /** A review declaring the whole terminal population, with the given findings. */
  function fullReview(run: BenchmarkRun, hardFails: HumanReview['hardFails'] = []): HumanReview {
    return {
      runId: 'run',
      suiteVersion: suite.suiteVersion,
      reviewedGenerationIds: terminalGenerations(run, both).map(generation => generation.id),
      hardFails,
    };
  }

  const finding = (generationId: string) => ({
    generationId,
    category: 'contradicts_state_delta' as const,
    detail: 'Says the shortage ended; the delta says water fell.',
    reviewedBy: 'simone',
    reviewedAt: '2026-08-21T00:00:00.000Z',
  });

  it('A and B: with no review, the human and combined counts are unknown', () => {
    // The defect: this rendered `human 0`, which claims a review that never
    // happened found nothing.
    const report = reportedFromItsOwnCheckout(suite, fairRun(), both, null, null);
    for (const profile of report.profiles) {
      expect(profile.humanHardFailedCases).toBeNull();
      expect(profile.humanHardFailsByCategory).toBeNull();
      expect(profile.hardFailedCases).toBeNull();
      // Machine evaluation always happened, so its count is a number.
      expect(typeof profile.machineHardFailedCases).toBe('number');
    }
  });

  it('C: a complete review with no findings is the only valid zero', () => {
    const run = fairRun();
    const report = reportedFromItsOwnCheckout(suite, run, both, null, fullReview(run));
    for (const profile of report.profiles) {
      expect(profile.humanHardFailedCases).toBe(0);
      expect(profile.humanHardFailsByCategory).not.toBeNull();
    }
  });

  it('D: a complete review with one finding counts it', () => {
    const run = fairRun();
    const report = reportedFromItsOwnCheckout(
      suite, run, both, null, fullReview(run, [finding(`run:${first}:lite:1`)]),
    );
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    expect(lite.humanHardFailedCases).toBe(1);
    expect(lite.humanHardFailsByCategory!.contradicts_state_delta).toBe(1);
    expect(lite.hardFailedCases).toBe(1);
  });

  it('E, F and G: a review short of the population is refused', () => {
    for (const short of both) {
      const run = fairRun();
      const review = fullReview(run);
      review.reviewedGenerationIds = review.reviewedGenerationIds.filter(
        id => id !== `run:${first}:${short}:1`,
      );
      const problems = reviewPopulationProblems(run, both, review);
      expect(problems, short).toHaveLength(1);
      expect(problems[0], short).toMatch(new RegExp(`^${short} has 1 of ${suite.cases.length}`));
      expect(problems[0], short).toContain(first);
      expect(() => reportedFromItsOwnCheckout(suite, run, both, null, review)).toThrow(/incomplete review/);
    }
  });

  it('H: equal counts over different cases is still incomplete', () => {
    const run = fairRun();
    const all = terminalGenerations(run, both);
    const review = fullReview(run);
    review.reviewedGenerationIds = [
      ...all.filter(entry => entry.profile === 'lite').slice(0, 10),
      ...all.filter(entry => entry.profile === 'standard').slice(-10),
    ].map(entry => entry.id);
    const problems = reviewPopulationProblems(run, both, review);
    expect(problems.some(problem => problem.startsWith('lite has'))).toBe(true);
    expect(problems.some(problem => problem.startsWith('standard has'))).toBe(true);
  });

  it('I: a generation listed as reviewed twice is refused', () => {
    const run = fairRun();
    const review = fullReview(run);
    review.reviewedGenerationIds.push(review.reviewedGenerationIds[0]!);
    const problems = validateHumanReview(review, new Set(run.generations.map(g => g.id)));
    expect(problems.map(problem => problem.message)).toContain('listed as reviewed twice');
    expect(() => reportedFromItsOwnCheckout(suite, run, both, null, review)).toThrow(/malformed judgement/);
  });

  it('J: a reviewed generation the run does not contain is refused', () => {
    const run = fairRun();
    const review = fullReview(run);
    review.reviewedGenerationIds.push('run:ghost:lite:1');
    const problems = validateHumanReview(review, new Set(run.generations.map(g => g.id)));
    expect(problems[0]!.message).toMatch(/not in the run/);
  });

  it('K: a finding on a generation nobody declared reviewing is refused', () => {
    // The sheet would be saying it did not look there and reporting what it saw.
    const run = fairRun();
    const review = fullReview(run, [finding(`run:${first}:lite:1`)]);
    review.reviewedGenerationIds = review.reviewedGenerationIds.filter(
      id => id !== `run:${first}:lite:1`,
    );
    const problems = validateHumanReview(review, new Set(run.generations.map(g => g.id)));
    expect(problems.some(problem => problem.message.includes('does not declare reviewing'))).toBe(
      true,
    );
  });

  it('L, M and N: the review target is the attempt that ended the history', () => {
    // A retried case: attempt 2 is the answer, attempt 1 a superseded draft.
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    const recovered = structuredClone(row);
    row.accepted = false;
    row.validatorErrors = ['unknown tone tag'];
    row.normalizedOutput = null;
    run.generations.push({
      ...recovered,
      id: `run:${first}:lite:2`,
      attempt: 2,
      retryUsed: true,
      rawOutputPath: `raw/${first}.lite.2.txt`,
    });

    const targets = terminalGenerations(run, both).map(generation => generation.id);
    expect(targets).toContain(`run:${first}:lite:2`);
    expect(targets).not.toContain(`run:${first}:lite:1`);
    expect(reviewPopulationProblems(run, both, fullReview(run))).toEqual([]);

    // N: reviewing the superseded attempt instead is refused, and named.
    const wrong = fullReview(run);
    wrong.reviewedGenerationIds = wrong.reviewedGenerationIds.map(id =>
      id === `run:${first}:lite:2` ? `run:${first}:lite:1` : id,
    );
    const problems = reviewPopulationProblems(run, both, wrong);
    expect(problems.some(p => p.includes('not the attempt that ended that history'))).toBe(true);

    // M: an exhausted retry is still the review target, disqualified or not.
    const exhausted = fairRun();
    const target = exhausted.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    const second = structuredClone(target);
    target.accepted = false;
    target.validatorErrors = ['unknown tone tag'];
    target.normalizedOutput = null;
    exhausted.generations.push({
      ...second,
      id: `run:${first}:lite:2`,
      attempt: 2,
      retryUsed: true,
      accepted: false,
      validatorErrors: ['unknown tone tag'],
      normalizedOutput: null,
      rawOutputPath: `raw/${first}.lite.2.txt`,
    });
    expect(terminalGenerations(exhausted, both).map(g => g.id)).toContain(`run:${first}:lite:2`);
    expect(reviewPopulationProblems(exhausted, both, fullReview(exhausted))).toEqual([]);
  });

  it('O: the expected population derives from the run, never a literal 65', () => {
    const run = fairRun();
    expect(terminalGenerations(run, both)).toHaveLength(suite.cases.length * 2);
    const keep = new Set(suite.cases.slice(0, 10).map(entry => entry.id));
    run.generations = run.generations.filter(generation => keep.has(generation.caseId));
    expect(terminalGenerations(run, both)).toHaveLength(20);
    expect(reviewPopulationProblems(run, both, fullReview(run))).toEqual([]);
  });

  it('P: complete scores with no review stays valid', () => {
    const run = fairRun();
    const report = reportedFromItsOwnCheckout(suite, run, both, fullSheet(run), null);
    for (const profile of report.profiles) {
      expect(profile.humanMeanByAxis?.grounding).toBe(4);
      expect(profile.humanHardFailedCases).toBeNull();
    }
  });

  it('Q: a complete review with no scores stays valid', () => {
    const run = fairRun();
    const report = reportedFromItsOwnCheckout(suite, run, both, null, fullReview(run));
    for (const profile of report.profiles) {
      expect(profile.humanMeanByAxis).toBeNull();
      expect(profile.humanHardFailedCases).toBe(0);
    }
  });

  it('R: the rendering shows unknown differently from zero', () => {
    const run = fairRun();
    const unknown = renderComparison(reportedFromItsOwnCheckout(suite, run, both, null, null));
    const zero = renderComparison(reportedFromItsOwnCheckout(suite, run, both, null, fullReview(run)));

    expect(unknown).toContain('not reviewed');
    expect(unknown).not.toMatch(/human 0/);
    expect(zero).toMatch(/human 0/);
    expect(zero).not.toContain('not reviewed');
  });
});

describe('human scores are averaged over a comparable population', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];
  const first = caseIds[0]!;

  it('A: no score sheet leaves the human means alone', () => {
    const report = reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null);
    for (const profile of report.profiles) {
      expect(profile.humanMeanByAxis).toBeNull();
    }
    expect(scorePopulationProblems(fairRun(), both, null)).toEqual([]);
  });

  it('B and J: complete terminal coverage passes and produces means', () => {
    const run = fairRun();
    const sheet = fullSheet(run);
    expect(sheet.scores).toHaveLength(suite.cases.length * 2);
    expect(scorePopulationProblems(run, both, sheet)).toEqual([]);
    const report = reportedFromItsOwnCheckout(suite, run, ['lite', 'standard'], sheet);
    for (const profile of report.profiles) {
      expect(profile.humanMeanByAxis?.grounding).toBe(4);
    }
  });

  it('C: one Lite score alone is refused', () => {
    // The defect exactly: one hand-picked generation averaged against a
    // different population and rendered as a comparable profile mean.
    const run = fairRun();
    const sheet = { ...fullSheet(run), scores: fullSheet(run).scores.slice(0, 1) };
    expect(() => reportedFromItsOwnCheckout(suite, run, ['lite', 'standard'], sheet)).toThrow(
      /incomparable population/,
    );
  });

  it('D: equal score counts over different cases is refused', () => {
    const run = fairRun();
    const all = fullSheet(run).scores;
    const lite = all.filter(score => score.generationId.includes(':lite:')).slice(0, 10);
    const standard = all.filter(score => score.generationId.includes(':standard:')).slice(-10);
    const sheet = { ...fullSheet(run), scores: [...lite, ...standard] };
    const problems = scorePopulationProblems(run, both, sheet);
    expect(problems.some(problem => problem.startsWith('lite has'))).toBe(true);
    expect(problems.some(problem => problem.startsWith('standard has'))).toBe(true);
  });

  it('E and F: either profile missing one score is refused', () => {
    for (const short of both) {
      const run = fairRun();
      const sheet = {
        ...fullSheet(run),
        scores: fullSheet(run).scores.filter(
          score => score.generationId !== `run:${first}:${short}:1`,
        ),
      };
      const problems = scorePopulationProblems(run, both, sheet);
      expect(problems, short).toHaveLength(1);
      expect(problems[0]).toMatch(new RegExp(`^${short} has 1 of ${suite.cases.length}`));
      expect(problems[0]).toContain(first);
    }
  });

  it('G and I: only the attempt that ended the history is scoreable', () => {
    // Lite needed its retry on the first case: attempt 2 is the answer, and
    // attempt 1 is an abandoned draft that must not be averaged beside finals.
    const run = fairRun();
    const template = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    template.accepted = false;
    template.validatorErrors = ['unknown tone tag'];
    template.normalizedOutput = null;
    run.generations.push({
      ...structuredClone(template),
      id: `run:${first}:lite:2`,
      attempt: 2,
      retryUsed: true,
      accepted: true,
      validatorErrors: [],
      normalizedOutput: fairRun().generations[0]!.normalizedOutput,
      rawOutputPath: `raw/${first}.lite.2.txt`,
    });

    const population = terminalGenerations(run, both);
    expect(population.some(generation => generation.id === `run:${first}:lite:2`)).toBe(true);
    expect(population.some(generation => generation.id === `run:${first}:lite:1`)).toBe(false);

    // I: scoring the superseded attempt instead is refused, and named for what
    // it is rather than as an unknown id.
    const sheet = {
      ...fullSheet(run),
      scores: fullSheet(run).scores.map(score =>
        score.generationId === `run:${first}:lite:2`
          ? { ...score, generationId: `run:${first}:lite:1` }
          : score,
      ),
    };
    const problems = scorePopulationProblems(run, both, sheet);
    expect(problems.some(problem => problem.includes('not the attempt that ended that history'))).toBe(
      true,
    );
  });

  it('H and K: an exhausted, disqualified terminal attempt is still scoreable', () => {
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === first,
    )!;
    row.accepted = false;
    row.validatorErrors = ['unknown tone tag'];
    row.normalizedOutput = null;
    run.generations.push({
      ...structuredClone(row),
      id: `run:${first}:lite:2`,
      attempt: 2,
      retryUsed: true,
      rawOutputPath: `raw/${first}.lite.2.txt`,
    });

    // Rejected twice, and still the attempt that ended the history: its prose may
    // be judged, and its disqualification is recorded separately.
    expect(
      terminalGenerations(run, both).some(generation => generation.id === `run:${first}:lite:2`),
    ).toBe(true);
    expect(scorePopulationProblems(run, both, fullSheet(run))).toEqual([]);
  });

  it('L: the population is derived from the run, never counted to 65', () => {
    const run = fairRun();
    expect(terminalGenerations(run, both)).toHaveLength(suite.cases.length * 2);
    // Half the suite, and the requirement halves with it.
    const keep = new Set(suite.cases.slice(0, 10).map(entry => entry.id));
    run.generations = run.generations.filter(generation => keep.has(generation.caseId));
    expect(terminalGenerations(run, both)).toHaveLength(20);
    expect(scorePopulationProblems(run, both, fullSheet(run))).toEqual([]);
  });

  it('a retrying profile is not weighted more heavily for having struggled', () => {
    // Two rows, one answer. The alternative would score a profile twice for
    // needing its retry, which measures the retry budget rather than the prose.
    const run = fairRun();
    const row = run.generations.find(
      generation => generation.profile === 'standard' && generation.caseId === first,
    )!;
    row.accepted = false;
    row.validatorErrors = ['unknown tone tag'];
    row.normalizedOutput = null;
    run.generations.push({
      ...structuredClone(row),
      id: `run:${first}:standard:2`,
      attempt: 2,
      retryUsed: true,
      accepted: true,
      validatorErrors: [],
      normalizedOutput: fairRun().generations[1]!.normalizedOutput,
      rawOutputPath: `raw/${first}.standard.2.txt`,
    });

    const standard = terminalGenerations(run, both).filter(
      generation => generation.profile === 'standard',
    );
    expect(standard).toHaveLength(suite.cases.length);
    expect(standard.filter(generation => generation.caseId === first)).toHaveLength(1);
  });
});

describe('official evidence is never produced by a fallback', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];

  /** A run where `profile` asked and the other model answered. */
  function fellBack(profile: BenchmarkProfile, to: BenchmarkProfile) {
    const run = fairRun();
    const row = run.generations.find(generation => generation.profile === profile)!;
    row.fallbackUsed = true;
    row.fallbackProfile = to;
    row.servedModel = to;
    return { run, row };
  }

  it('A and B: rows each model answered itself are evidence', () => {
    const run = fairRun();
    for (const generation of run.generations) {
      expect(generation.fallbackUsed).toBe(false);
      expect(generation.fallbackProfile).toBeNull();
      expect(generation.servedModel).toBe(generation.profile);
      expect(generation.artifact.profileId).toBe(generation.profile);
    }
    expect(officialEvidenceProblems(suite, run, both)).toEqual([]);
  });

  it('C: a Standard row Lite answered is refused', () => {
    const { run } = fellBack('standard', 'lite');
    // Structurally coherent: the row is a valid fallback record, and validateRun
    // keeps understanding it. It is simply not evidence about Standard.
    expect(validateRun(run)).toEqual([]);
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.map(problem => problem.requirement)).toContain('no_fallback_evidence');
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/no_fallback_evidence/);
  });

  it('D: a Lite row Standard answered is refused', () => {
    const { run } = fellBack('lite', 'standard');
    expect(officialEvidenceProblems(suite, run, both).map(p => p.requirement)).toContain(
      'no_fallback_evidence',
    );
  });

  it('H: the refusal names the generation and both profiles', () => {
    const { run, row } = fellBack('standard', 'lite');
    const problem = officialEvidenceProblems(suite, run, both).find(
      entry => entry.requirement === 'no_fallback_evidence',
    )!;
    expect(problem.message).toContain(row.id);
    expect(problem.message).toContain('from standard to lite');
    expect(problem.message).toMatch(/evidence about lite recorded under standard/);
  });

  it('E: one fallback row among 130 clean ones refuses the whole run', () => {
    const { run } = fellBack('standard', 'lite');
    expect(run.generations.length).toBe(suite.cases.length * 2);
    expect(run.generations.filter(generation => generation.fallbackUsed)).toHaveLength(1);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/refusing to publish/);
  });

  it('F and G: a fallback row reaches no latency, acceptance or retry aggregate', () => {
    // It cannot, because the report never gets built. Proven by the absence of a
    // report rather than by inspecting one that should not exist.
    const { run } = fellBack('standard', 'lite');
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
    expect(() => reportedFromItsOwnCheckout(suite, run, ['lite', 'standard'], null, null)).toThrow();
  });

  it('a fallback row covers nothing, so the profile is also short a case', () => {
    // Two different statements about the same row, and both are true: Standard
    // did not answer that case, and the row that stands where its answer would
    // be belongs to another model.
    const { run, row } = fellBack('standard', 'lite');
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.map(problem => problem.requirement)).toEqual([
      'full_profile_case_coverage',
      'no_fallback_evidence',
    ]);
    expect(problems[0]!.message).toMatch(
      new RegExp(`standard is missing 1 of ${suite.cases.length} suite cases \\(${row.caseId}\\)`),
    );
  });

  it('J and K: a malformed accepted output never reaches evaluation or an aggregate', () => {
    // evaluateObjectively would reach for .dialogue.map on undefined; worse, a
    // malformed *item* does not crash — it scores a speaker of undefined against
    // the scene. Neither happens, because the run is refused first.
    for (const broken of [{}, { ...fairRun().generations[0]!.normalizedOutput, dialogue: [{}] }]) {
      const run = fairRun();
      run.generations[0]!.normalizedOutput = broken as never;
      expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
    }
  });

  it('I: validateRun still understands a fallback row structurally', () => {
    // The separation the fix depends on: smoke and telemetry may represent
    // fallback, and only the official boundary refuses it.
    const { run } = fellBack('standard', 'lite');
    expect(validateRun(run)).toEqual([]);

    const incoherent = fairRun();
    const row = incoherent.generations[0]!;
    row.fallbackUsed = true;
    row.fallbackProfile = null;
    expect(validateRun(incoherent).map(problem => problem.field)).toContain('fallbackProfile');
  });
});

describe('official comparison evidence', () => {
  const both: BenchmarkProfile[] = ['lite', 'standard'];

  it('G: a full suite for both profiles on a clean checkout qualifies', () => {
    expect(officialEvidenceProblems(suite, fairRun(), both)).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  it('A: a smoke run with impeccable rows is refused, and refused for that alone', () => {
    // The trap this closes: everything else about this run is perfect. Listing
    // its other shortcomings would obscure the one that disqualifies it.
    const run = fairRun();
    run.metadata.runKind = 'smoke';
    const problems = officialEvidenceProblems(suite, run, both);
    expect(problems.map(problem => problem.requirement)).toEqual(['declared_official']);
    expect(problems[0]!.message).toMatch(/plumbing evidence/);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/declared_official/);
  });

  it('B: a dirty checkout is refused', () => {
    const run = fairRun();
    run.metadata.gitDirty = true;
    expect(officialEvidenceProblems(suite, run, both).map(p => p.requirement)).toContain(
      'clean_checkout',
    );
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/nobody else can reproduce it/);
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/full_profile_case_coverage/);
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
    // A legal retry follows a rejection, so the pair is: rejected, then
    // accepted. Two rows, one answer, and the coverage is identical to the same
    // cases answered first try.
    const keep = new Set(suite.cases.slice(0, 10).map(entry => entry.id));
    const firstTry = fairRun();
    firstTry.generations = firstTry.generations.filter(generation => keep.has(generation.caseId));
    const before = officialEvidenceProblems(suite, firstTry, both);

    const retried = fairRun();
    retried.generations = retried.generations
      .filter(generation => keep.has(generation.caseId))
      .flatMap(generation => [
        { ...generation, accepted: false, validatorErrors: ['unknown tone tag'], normalizedOutput: null },
        {
          ...generation,
          id: `${generation.id.slice(0, -1)}2`,
          attempt: 2,
          retryUsed: true,
          rawOutputPath: `${generation.rawOutputPath.slice(0, -5)}2.txt`,
        },
      ]);
    expect(retried.generations.length).toBe(firstTry.generations.length * 2);
    expect(officialEvidenceProblems(suite, retried, both)).toEqual(before);
  });

  it('I: an empty run is still refused by the earlier, clearer gate', () => {
    const run = fairRun();
    run.generations = [];
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/no comparable evidence/);
  });

  it('J: a suite-version mismatch is still refused before coverage is measured', () => {
    // Order matters: coverage counted against the wrong suite would be a number
    // computed from a question the run never answered.
    const revised = structuredClone(suite);
    revised.suiteVersion = 'p0.5-a.99';
    expect(() => reportedFromItsOwnCheckout(revised, fairRun())).toThrow(/different suite/);
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
    trip(run => {
      const row = run.generations.find(generation => generation.profile === 'standard')!;
      row.fallbackUsed = true;
      row.fallbackProfile = 'lite';
      row.servedModel = 'lite';
    });
    trip(run => {
      const row = run.generations.find(generation => generation.profile === 'lite')!;
      row.accepted = false;
      row.validatorErrors = ['unknown tone tag'];
      row.normalizedOutput = null;
    });

    expect([...reached].sort()).toEqual([...OFFICIAL_EVIDENCE_REQUIREMENTS].sort());
  });
});

describe('comparison fairness', () => {
  it('accepts a run where everything was actually held equal', () => {
    expect(inputParityProblems(fairRun(), ['lite', 'standard'])).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  it('refuses a run where one case was asked differently of each profile', () => {
    // The same case id proves nothing if the prompt changed underneath it.
    const run = fairRun();
    run.generations[1]!.inputFingerprint = 'f'.repeat(64);

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('asked differently'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/identical case inputs/);
  });

  it('refuses a profile that swapped artifacts halfway through', () => {
    const run = fairRun();
    run.generations[2]!.artifact = { ...run.generations[2]!.artifact, sha256: 'a'.repeat(64) };

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('mixed 2 artifact identities'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('refuses profiles run with different controlled settings', () => {
    const run = fairRun();
    for (const generation of run.generations) {
      if (generation.profile === 'standard') generation.context.temperature = 0.9;
    }

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('different controlled generation settings'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/mislabels/);
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('C: both profiles retried with the same wording is fair', () => {
    const run = runWithRejectedFirst('lite', 'standard');
    run.generations.push(retryRow('lite'), retryRow('standard'));
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('D: both profiles may retry with their own wording', () => {
    // A retry repairs a model's *own* rejected output, so its prompt names that
    // model's own validator errors. Requiring identical retry text across
    // profiles would mean telling Lite to fix a mistake Standard made — neither
    // fair nor informative. It is the retry *policy* that must be identical, and
    // everything enforcing it still applies: only after a rejection, never after
    // an acceptance, never a third attempt, same controlled settings.
    const run = runWithRejectedFirst('lite', 'standard');
    run.generations.push(retryRow('lite'), retryRow('standard', 'c'.repeat(64)));

    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
  });

  it('D: attempt 1 must still be the same question for both', () => {
    // The comparison itself is unchanged and stays strict.
    const run = runWithRejectedFirst('lite', 'standard');
    run.generations.push(retryRow('lite'), retryRow('standard', 'c'.repeat(64)));
    const liteFirst = run.generations.find(
      generation => generation.profile === 'lite' && generation.attempt === 1,
    )!;
    liteFirst.inputFingerprint = 'd'.repeat(64);

    const problems = inputParityProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('attempt 1 was asked differently'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/identical case inputs/);
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, historyRun([1], [2]))).toThrow();
  });

  it('D: Lite with only attempt 2 is refused', () => {
    const problems = inputParityProblems(historyRun([2], [1]), ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no attempt 1 for lite'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, historyRun([2], [1]))).toThrow();
  });

  it('E: attempt 3 without attempt 2 is refused', () => {
    // A gap means a row was lost, not that a model skipped a try.
    const problems = inputParityProblems(historyRun([1, 3], [1]), ['lite', 'standard']);
    expect(
      problems.some(problem => problem.includes('attempt 3 without attempt 2')),
      JSON.stringify(problems),
    ).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, historyRun([1, 3], [1]))).toThrow();
  });

  it('F: a retry both profiles made with the same wording passes', () => {
    expect(inputParityProblems(historyRun([1, 2], [1, 2]), ['lite', 'standard'])).toEqual([]);
  });

  it('G: a retry both profiles made with their own wording is evidence, not a defect', () => {
    // Both profiles finished their histories and repaired their own failures.
    // That is what a rejection-derived retry looks like, and it is what the
    // official runner produces.
    const run = historyRun([1, 2], [1, 2]);
    const standardRetry = run.generations.find(
      generation => generation.profile === 'standard' && generation.attempt === 2,
    )!;
    standardRetry.inputFingerprint = 'c'.repeat(64);

    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);

    // And the retry rules around it are untouched: a third attempt is still
    // impossible, and a retry still may not follow an acceptance.
    expect(inputParityProblems(historyRun([1, 2, 3], [1]), ['lite', 'standard']).length)
      .toBeGreaterThan(0);
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
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  it('B: the same cases under a different suite version is refused', () => {
    // The dangerous edit: ids and task names survive a revision, so
    // taskMismatches sees nothing wrong while every constraint and expected
    // fact underneath may have changed.
    const revised = { ...suite, suiteVersion: `${suite.suiteVersion}-revised` };
    const problems = suiteBindingProblems(revised, fairRun());

    expect(problems.some(problem => problem.includes(`recorded suite version '${suite.suiteVersion}'`))).toBe(true);
    expect(problems.some(problem => problem.includes(`'${suite.suiteVersion}-revised'`))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(revised, fairRun())).toThrow(/different suite/);
  });

  it('C: the same version under a different schema is refused', () => {
    const migrated = { ...suite, schemaVersion: 2 as unknown as 1 };
    const problems = suiteBindingProblems(migrated, fairRun());

    expect(problems.some(problem => problem.includes('schema 1'))).toBe(true);
    expect(problems.some(problem => problem.includes('schema 2'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(migrated, fairRun())).toThrow(/different suite/);
  });

  it('D: an old run cannot be silently evaluated with a newer suite', () => {
    // Same case ids, same tasks, changed facts: exactly the situation where
    // nothing else would notice.
    const newer = structuredClone(suite);
    newer.suiteVersion = 'p0.5-a.9';
    newer.cases[0]!.expectedFacts = ['something the run never saw'];
    newer.cases[0]!.constraints.maxNarrationChars = 9999;

    expect(taskMismatches(newer, fairRun())).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(newer, fairRun())).toThrow(/different suite/);
  });

  it('refuses before any evaluation happens, not after', () => {
    // A mismatched suite must not reach the objective evaluator at all: a report
    // built on the wrong constraints is worse than no report.
    const revised = { ...suite, suiteVersion: `${suite.suiteVersion}-revised` };
    let message = '';
    try {
      reportedFromItsOwnCheckout(revised, fairRun());
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('D: accepted 2 followed by attempt 3 is refused', () => {
    const run = withHistory([[1, false], [2, true], [3, false]], [[1, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('follows an accepted attempt 2'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('E: attempt 2 with no attempt 1 is refused', () => {
    const run = withHistory([[2, true]], [[1, true]]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('keeps an invalid history out of every aggregate', () => {
    // The consequence the finding named: latency, quality means and retry
    // totals must never be computed from a history the policy forbids.
    const run = withHistory([[1, true], [2, true]], [[1, true]]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });
});

describe('a comparison needs something to compare', () => {
  it('A: a run with no generations at all is refused', () => {
    // An interrupted or half-copied evidence directory looks exactly like this,
    // and every other check passes it by vacuous truth.
    const run = fairRun();
    run.generations = [];

    expect(comparableEvidenceProblems(run, ['lite', 'standard'])).toHaveLength(1);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/no comparable evidence/);
  });

  it('B: Lite rows only, comparing Lite and Standard, is refused', () => {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'lite');

    const problems = comparableEvidenceProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no generations for standard'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/no comparable evidence/);
  });

  it('C: Standard rows only is refused symmetrically', () => {
    const run = fairRun();
    run.generations = run.generations.filter(generation => generation.profile === 'standard');

    const problems = comparableEvidenceProblems(run, ['lite', 'standard']);
    expect(problems.some(problem => problem.includes('no generations for lite'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('F: the message says plainly there is nothing to compare', () => {
    const run = fairRun();
    run.generations = [];
    let message = '';
    try {
      reportedFromItsOwnCheckout(suite, run);
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
    expect(() => reportedFromItsOwnCheckout(suite, fairRun())).not.toThrow();
  });

  it('B: attempt 1 claiming retryUsed is refused', () => {
    // Would overcount retries in the summary.
    const run = fairRun();
    run.generations[0]!.retryUsed = true;
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('D: accepted with a null output is refused rather than crashing evaluation', () => {
    // This one used to reach `evaluateObjectively` and fall over there.
    const run = fairRun();
    run.generations[0]!.normalizedOutput = null;
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
  });

  it('E: the structural check runs before evaluation, not after', () => {
    // A run that is both structurally invalid and unfair must report the
    // structural problem: it is the one that makes everything else meaningless.
    const run = fairRun();
    run.generations[0]!.normalizedOutput = null;
    run.generations[1]!.inputFingerprint = 'f'.repeat(64);

    let message = '';
    try {
      reportedFromItsOwnCheckout(suite, run);
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('C: rejected 1 then rejected 2 is valid, and the retry is exhausted', () => {
    // Two failures is a finding. What it is not is permission for a third try.
    const run = withHistory([[1, false], [2, false]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('D: rejected, rejected, then accepted on attempt 3 is refused', () => {
    // The gap the previous rule left: contiguous, each retry following a
    // rejection, and still outside the policy.
    const run = withHistory([[1, false], [2, false], [3, true]], [[1, true]]);
    const problems = attemptHistoryProblems(run, ['lite', 'standard']);

    expect(problems.some(problem => problem.includes('attempt 3 exceeds the one-shot retry'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('E: a third rejected attempt is refused too', () => {
    const run = withHistory([[1, false], [2, false], [3, false]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard']).length).toBeGreaterThan(0);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
  });

  it('H: a unilateral retry stays valid', () => {
    // Lite needed its one retry, Standard did not. Still comparable.
    const run = withHistory([[1, false], [2, true]], [[1, true]]);
    expect(attemptHistoryProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(inputParityProblems(run, ['lite', 'standard'])).toEqual([]);
    expect(() => reportedFromItsOwnCheckout(suite, run)).not.toThrow();
  });

  it('I: a third attempt can never enter latency, quality or retry totals', () => {
    // Both gates catch it: the structural one and the history one. Neither
    // report is ever built.
    const run = withHistory([[1, false], [2, false], [3, true]], [[1, true]]);
    expect(validateRun(run).some(problem => problem.field === 'attempt')).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow();
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
    expect(() =>
      reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], fullSheet(fairRun())),
    ).not.toThrow();
  });

  it('refuses a score sheet from another run, even with a copied generation id', () => {
    expect(() =>
      reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], sheet({ runId: 'other_run' })),
    ).toThrow(/belongs to another run/);
  });

  it('refuses a score sheet written against another suite version', () => {
    expect(() =>
      reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], sheet({ suiteVersion: 'p0.4-old' })),
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
    // A complete review of the terminal population: the only shape in which a
    // human hard-fail count of any value, zero included, means anything.
    reviewedGenerationIds: terminalGenerations(fairRun(), ['lite', 'standard']).map(
      generation => generation.id,
    ),
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
    // The sheet must also cover the whole population before a mean is taken; a
    // human review names disqualifications and carries no such requirement.
    expect(() =>
      reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], fullSheet(fairRun()), reviewWith([fail()])),
    ).not.toThrow();
  });

  it('B: a score for a generation the run does not contain is refused', () => {
    // Previously it disappeared silently, which is worse than a wrong number.
    const sheet = sheetWith([score({ generationId: 'run:ghost:lite:1' })]);
    expect(judgementProblems(fairRun(), sheet, null).some(p => p.includes('run:ghost:lite:1'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], sheet)).toThrow(/malformed judgement/);
  });

  it('C: the same generation scored twice is refused', () => {
    const sheet = sheetWith([score(), score()]);
    expect(judgementProblems(fairRun(), sheet, null).some(p => p.includes('scored twice'))).toBe(true);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], sheet)).toThrow();
  });

  it('D: an out-of-range or unknown axis is refused', () => {
    const outOfRange = sheetWith([score()]);
    (outOfRange.scores[0]!.scores as Record<string, number>).grounding = 9;
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], outOfRange)).toThrow(/grounding/);

    const unknownAxis = sheetWith([score()]);
    (unknownAxis.scores[0]!.scores as Record<string, number>).vibes = 5;
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], unknownAxis)).toThrow(/vibes/);
  });

  it('E: a hard fail against an unknown generation is refused', () => {
    const review = reviewWith([fail({ generationId: 'run:ghost:lite:1' })]);
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow(
      /malformed judgement/,
    );
  });

  it('F: a hard-fail category outside the five locked ones is refused', () => {
    const review = reviewWith([fail()]);
    (review.hardFails[0] as unknown as Record<string, unknown>).category = 'bad_vibes';
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow(
      /bad_vibes/,
    );
  });

  it('G: malformed judgement can no longer produce NaN in the report', () => {
    // The concrete failure: an invalid category indexed a tally that was never
    // initialised for it, so the count became NaN and travelled into the report.
    const review = reviewWith([fail()]);
    (review.hardFails[0] as unknown as Record<string, unknown>).category = 'bad_vibes';
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, review)).toThrow();

    // And a report built from valid judgement contains no NaN anywhere.
    const report = reportedFromItsOwnCheckout(
      suite, fairRun(), ['lite', 'standard'], fullSheet(fairRun()), reviewWith([fail()]),
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
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], foreign)).toThrow(
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
      reviewedGenerationIds: terminalGenerations(fairRun(), ['lite', 'standard']).map(
        generation => generation.id,
      ),
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
    const report = reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, review());
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    const standard = report.profiles.find(profile => profile.profile === 'standard')!;

    expect(lite.humanHardFailedCases).toBe(1);
    expect(lite.machineHardFailedCases).toBe(0);
    expect(lite.hardFailedCases).toBe(1);
    expect(lite.humanHardFailsByCategory!.contradicts_state_delta).toBe(1);
    expect(lite.hardFailsByCategory.contradicts_state_delta).toBe(0);

    // The other profile is untouched by a review of the first.
    expect(standard.hardFailedCases).toBe(0);
  });

  it('is refused when it was written for another run', () => {
    // Generation ids are stable and typeable, so an id alone proves nothing.
    const foreign = review({ runId: 'some_other_run' });
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, foreign)).toThrow(
      /belongs to another run/,
    );
  });

  it('is refused when it scored a different suite version', () => {
    const stale = review({ suiteVersion: 'p0.4-old' });
    expect(() => reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], null, stale)).toThrow(
      /suite/,
    );
  });

  it('cannot be erased by a good prose score', () => {
    // A disqualification lives outside the 0-5 axes entirely, so no amount of
    // scoring can average it away.
    const sheet: ScoreSheet = {
      ...fullSheet(fairRun()),
      // The whole population scored top marks, the disqualified generation
      // included: a perfect prose score across the board must still not erase
      // the hard fail.
      scores: fullSheet(fairRun()).scores.map(entry => ({
        ...entry,
        scores: {
          italian_fluency: 5, grounding: 5, character_consistency: 5, memory_use: 5,
          instruction_adherence: 5, schema_compliance: 5, non_contradiction: 5,
          narrative_usefulness: 5, repetition_resistance: 5, latency_acceptability: 5,
        },
      })),
    };

    const report = reportedFromItsOwnCheckout(suite, fairRun(), ['lite', 'standard'], sheet, review());
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    expect(lite.humanMeanByAxis?.grounding).toBe(5);
    expect(lite.hardFailedCases).toBe(1);
  });
});
