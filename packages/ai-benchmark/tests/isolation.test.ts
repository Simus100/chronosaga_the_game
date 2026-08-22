import { describe, expect, it } from 'vitest';
import manifest from '../package.json' with { type: 'json' };
import { buildComparison } from '../src/report.js';
import { evaluateObjectively } from '../src/objective.js';
import { loadSuite } from '../src/suite.js';
import type { BenchmarkGeneration, BenchmarkRun } from '../src/result.js';
import { suiteContentDigest } from '../src/report.js';
import { lockedRuntime } from '../src/runtime-lock.js';
import { lockedArtifact } from '../src/model-lock.js';

/**
 * The benchmark reads the world; it never writes it.
 *
 * The strongest available proof at this boundary is twofold: the package cannot
 * reach a mutating module, and its functions do not modify the objects handed to
 * them. Both are checked, because either alone would be easy to defeat.
 */

const suite = loadSuite();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function generation(caseId: string): BenchmarkGeneration {
  const testCase = suite.cases.find(entry => entry.id === caseId)!;
  return {
    id: `run:${caseId}:lite:1`,
    runId: 'run',
    caseId,
    task: testCase.task,
    profile: 'lite',
    artifact: {
      profileId: 'lite',
      family: 'Qwen3-1.7B',
      quantization: 'Q4_K_M',
      artifactFilename: 'Qwen3-1.7B-Q4_K_M.gguf',
      sizeBytes: 1282439264,
      sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
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
    rawOutputPath: `raw/${caseId}.lite.1.txt`,
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
  };
}

describe('benchmark isolation from authoritative state', () => {
  it('declares no dependency that can write game state', () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});

    // @paa/game-core owns createCampaign, runWorldTick and resolveChoice: the
    // functions that advance authoritative state. The benchmark must not be able
    // to call them even by accident.
    expect(dependencies).not.toContain('@paa/game-core');
    expect(dependencies).not.toContain('@paa/persistence-contracts');
    for (const dependency of dependencies) {
      expect(dependency.startsWith('@paa/')).toBe(true);
    }
  });

  it('never mutates the case it evaluates', () => {
    const testCase = deepFreeze(structuredClone(suite.cases[0]!));
    const record = deepFreeze(generation(testCase.id));
    expect(() => evaluateObjectively(testCase, record)).not.toThrow();
  });

  it('never mutates the suite while building a comparison', () => {
    const frozenSuite = deepFreeze(structuredClone(suite));
    const caseIds = frozenSuite.cases.map(entry => entry.id);
    const run: BenchmarkRun = deepFreeze({
      metadata: {
        runId: 'run',
        runKind: 'official_comparison',
        startedAt: '2026-08-21T00:00:00.000Z',
        gitCommit: '9599f38d846f29907286e53200f51a703af4f53c',
        gitDirty: false,
        suiteVersion: frozenSuite.suiteVersion,
        suiteSchemaVersion: 1,
        suiteContentSha256: suiteContentDigest(suite),
        runnerVersion: '0.1.0',
        runtimeReleaseTag: lockedRuntime().releaseTag,
        runtimeExecutableSha256: lockedRuntime().executableSha256,
        host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7', logicalCores: 24, totalRamMb: 65536 },
      },
      generations: caseIds.flatMap(caseId => [
        generation(caseId),
        { ...generation(caseId), id: `run:${caseId}:standard:1`, profile: 'standard' as const,
          servedModel: 'standard',
          // The Standard row carries Standard's locked artifact. It used to
          // carry Lite's with only profileId changed, which is precisely the
          // forged shape the locked-artifact gate exists to refuse.
          artifact: {
            ...generation(caseId).artifact,
            ...lockedArtifact('standard')!,
            profileId: 'standard' as const,
          } },
      ]),
    });

    expect(() => buildComparison(frozenSuite, run)).not.toThrow();
  });

  it('produces the same evaluation whatever order cases are visited in', () => {
    const forwards = suite.cases.slice(0, 5).map(entry => evaluateObjectively(entry, generation(entry.id)));
    const backwards = suite.cases
      .slice(0, 5)
      .reverse()
      .map(entry => evaluateObjectively(entry, generation(entry.id)))
      .reverse();
    expect(backwards).toEqual(forwards);
  });
});
