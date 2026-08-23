import { lockedRuntime } from '../src/runtime-lock.js';
import { describe, expect, it } from 'vitest';
import {
  buildComparisonWithTrustedCheckout,
  inputParityProblems,
  renderComparison,
  suiteContentDigest,
} from '../src/report.js';
import type { BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';

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

function generationFor(
  caseId: string,
  profile: BenchmarkProfile,
  accepted: boolean,
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
      maxOutputTokens: 512,
      temperature: 0.7,
      topP: 0.95,
      seed: null,
      reasoning: 'off',
    },
    inputFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    attempt: 1,
    accepted,
    validatorErrors: accepted ? [] : ['unknown tone tag'],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: profile === 'lite' ? 8000 : 12000,
    tokensGenerated: 120,
    tokensPerSecond: profile === 'lite' ? 18 : 12,
    servedModel: profile,
    rawOutputPath: `raw/${caseId}.${profile}.1.txt`,
    // Shape only: these fixtures have no files on disk, and the bytes are
    // the run-directory adapter's business. Two rows may legitimately share
    // a digest — two models can emit the same raw text.
    rawOutputSha256: '0'.repeat(64),
    rawFormat: { bareJson: true, codeFencePresent: false, wrapperTextPresent: false },
    normalizedOutput: accepted
      ? {
          narration: 'Nulla di rilevante.',
          dialogue: testCase.constraints.knownSpeakerIds.map(speakerId => ({ speakerId, text: 'Ok.' })),
          toneTags: [testCase.constraints.allowedToneTags[0]!],
          eventProposals: testCase.constraints.allowEventProposals
        ? [{ subjectId: testCase.characters[0]?.id ?? 'settlement_helios', topic: 't', rationale: 'r' }]
        : [],
          memorySuggestions: testCase.constraints.allowMemorySuggestions
        ? [{ characterId: testCase.characters[0]?.id ?? 'mara_001', summary: 's' }]
        : [],
        }
      : null,
    ...over,
  };
}

function twoProfileRun(caseIds: string[]): BenchmarkRun {
  const generations: BenchmarkGeneration[] = [];
  for (const caseId of caseIds) {
    // Lite fails these cases, and failing them completely means using the retry
    // the policy owes it. A rejected first attempt with no second is not a Lite
    // result at all; it is a run that stopped early, and the report now says so.
    generations.push(generationFor(caseId, 'lite', false));
    generations.push(
      generationFor(caseId, 'lite', false, {
        id: `run:${caseId}:lite:2`,
        attempt: 2,
        retryUsed: true,
        rawOutputPath: `raw/${caseId}.lite.2.txt`,
      }),
    );
    generations.push(generationFor(caseId, 'standard', true));
  }
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
      runtimeReleaseTag: lockedRuntime().releaseTag,
      runtimeExecutableSha256: lockedRuntime().executableSha256,
      host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7-13700KF', logicalCores: 24, totalRamMb: 65536 },
    },
    generations,
  };
}

// The whole suite, because an official comparison is the whole suite. A
// three-case fixture is a smoke pass, and the report boundary now says so.
const caseIds = suite.cases.map(entry => entry.id);

describe('the Lite vs Standard comparison', () => {
  it('reports both profiles over the same cases', () => {
    const report = reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds));
    expect(report.profiles.map(profile => profile.profile)).toEqual(['lite', 'standard']);
    for (const profile of report.profiles) {
      expect(profile.casesAttempted).toBe(caseIds.length);
    }
  });

  it('refuses to compare profiles that were not asked attempt 1 identically', () => {
    // Same cases for both, different question asked. Coverage is intact, so this
    // reaches the parity check rather than being caught earlier as a hole.
    const run = twoProfileRun(caseIds);
    const lite = run.generations.find(
      generation => generation.profile === 'lite' && generation.caseId === caseIds[0],
    )!;
    lite.inputFingerprint = 'f'.repeat(64);
    expect(inputParityProblems(run, ['lite', 'standard'])).toHaveLength(1);
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/not asked attempt 1 identically/);
  });

  it('catches a missing row as a coverage hole, not as a parity mismatch', () => {
    // Dropping a row breaks parity too, but naming it "the profiles saw
    // different inputs" describes the symptom. The run is simply incomplete, and
    // the earlier, more specific gate says which pair is absent.
    const run = twoProfileRun(caseIds);
    run.generations = run.generations.filter(
      generation => !(generation.profile === 'lite' && generation.caseId === caseIds[0]),
    );
    expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(
      new RegExp(`full_profile_case_coverage.*lite is missing 1 of ${suite.cases.length}`),
    );
  });

  it('names the cases where the profiles disagreed', () => {
    const report = reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds));
    expect(report.divergentCases).toHaveLength(caseIds.length);
    for (const divergent of report.divergentCases) {
      expect(divergent.acceptedBy).toEqual(['standard']);
    }
  });

  it('separates acceptance from hard failures', () => {
    const report = reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds));
    const standard = report.profiles.find(profile => profile.profile === 'standard')!;
    expect(standard.casesAccepted).toBe(caseIds.length);
    expect(standard.machineHardFailedCases).toBe(0);
    // No human review was supplied, so the human half — and therefore the
    // combined total — is unknown rather than zero.
    expect(standard.humanHardFailedCases).toBeNull();
    expect(standard.hardFailedCases).toBeNull();
  });

  it('carries the exact artifact identity into the summary', () => {
    const report = reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds));
    const lite = report.profiles.find(profile => profile.profile === 'lite')!;
    expect(lite.artifactFilename).toBe('Qwen3-1.7B-Q4_K_M.gguf');
    expect(lite.sha256).toBe(SHA.lite);
  });

  it('breaks acceptance down by task', () => {
    const report = reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds));
    const standard = report.profiles.find(profile => profile.profile === 'standard')!;
    const attempted = Object.values(standard.acceptanceByTask).reduce((sum, entry) => sum + entry.attempted, 0);
    expect(attempted).toBe(caseIds.length);
  });

  it('renders a table a human can read', () => {
    const rendered = renderComparison(reportedFromItsOwnCheckout(suite, twoProfileRun(caseIds)));
    expect(rendered).toContain('LITE');
    expect(rendered).toContain('STANDARD');
    expect(rendered).toContain('median latency');
  });

  it('is stable: the same run renders identically twice', () => {
    const run = twoProfileRun(caseIds);
    expect(renderComparison(reportedFromItsOwnCheckout(suite, run))).toBe(
      renderComparison(reportedFromItsOwnCheckout(suite, run)),
    );
  });
});
