import { describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import rustRequirements from './fixtures/official-evidence-requirements.json' with { type: 'json' };
import { OFFICIAL_EVIDENCE_REQUIREMENTS } from '../src/report.js';
import {
  normalizedOutputProblems,
  validateRun,
  type BenchmarkRun,
} from '../src/result.js';
import { loadSuite } from '../src/suite.js';

/**
 * The cross-language contract.
 *
 * `tests/fixtures/rust-run.json` is produced by the Rust serializer in
 * `apps/desktop/src-tauri/src/benchmark.rs` (`what_rust_writes_is_what_typescript_validates`,
 * regenerated with `CHRONOSAGA_UPDATE_FIXTURES=1`) and consumed here. If the Rust
 * shape drifts, the Rust test fails; if this contract drifts, these tests fail.
 * Neither side can move on its own, which is the only way a benchmark written in
 * one language and read in another stays honest.
 */

const run = rustRun as unknown as BenchmarkRun;

describe('the shared definition of official evidence', () => {
  it('asks the same questions on both sides of the language boundary', () => {
    // Rust decides whether a run *is* official evidence as it accumulates;
    // this side decides whether a stored run *may be published* as one. The
    // implementations cannot be shared, so the list of requirements is, and a
    // requirement added or dropped alone fails here.
    expect([...OFFICIAL_EVIDENCE_REQUIREMENTS]).toEqual(rustRequirements);
  });

  it('declares each requirement exactly once', () => {
    expect(new Set(rustRequirements).size).toBe(rustRequirements.length);
  });
});

describe('evidence written by the Rust runner', () => {
  it('satisfies the declared TypeScript result contract', () => {
    expect(validateRun(run)).toEqual([]);
  });

  it('N: every accepted row satisfies the complete output shape', () => {
    // The fixture is what this contract is checked against, so a row the shape
    // validator would refuse would mean the two sides disagree about what the
    // Rust serializer emits.
    const accepted = run.generations.filter(generation => generation.accepted);
    expect(accepted.length).toBeGreaterThan(0);
    for (const generation of accepted) {
      expect(normalizedOutputProblems(generation.normalizedOutput), generation.id).toEqual([]);
    }
    for (const generation of run.generations.filter(entry => !entry.accepted)) {
      expect(generation.normalizedOutput, generation.id).toBeNull();
    }
  });

  it('records no fallback, because an official run never falls back', () => {
    for (const generation of run.generations) {
      expect(generation.fallbackUsed, generation.id).toBe(false);
      expect(generation.fallbackProfile, generation.id).toBeNull();
    }
  });

  it('carries the artifact identity, not a filename guess', () => {
    for (const generation of run.generations) {
      const artifact = generation.artifact;
      expect(artifact.profileId).toBe(generation.profile);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.artifactFilename).toMatch(/\.gguf$/);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(artifact.family.length).toBeGreaterThan(0);
      expect(artifact.quantization.length).toBeGreaterThan(0);
      expect(artifact.source.length).toBeGreaterThan(0);
      expect(artifact.releaseApproved).toBe(false);
    }
  });

  it('carries the generation configuration that was actually requested', () => {
    for (const generation of run.generations) {
      const context = generation.context;
      expect(context.contextSize).toBe(4096);
      expect(context.maxOutputTokens).toBeGreaterThan(0);
      expect(context.temperature).toBeGreaterThanOrEqual(0);
      // Explicitly configured by the benchmark rather than left to the runtime.
      expect(context.topP).not.toBeNull();
      expect(context.seed).not.toBeNull();
      expect(context.reasoning).toBe('off');
    }
  });

  it('carries run metadata sufficient to reproduce it', () => {
    const metadata = run.metadata;
    expect(metadata.gitCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(metadata.gitDirty).toBe(false);
    expect(metadata.suiteVersion).toBe(loadSuite().suiteVersion);
    expect(metadata.suiteSchemaVersion).toBe(1);
    expect(metadata.runnerVersion.length).toBeGreaterThan(0);
    expect(metadata.runtimeReleaseTag).toBe('b10343');
    expect(metadata.host.logicalCores).toBeGreaterThan(0);
    expect(metadata.host.totalRamMb).toBeGreaterThan(0);
  });

  it('fingerprints both profiles of one case identically', () => {
    const byCase = new Map<string, Set<string>>();
    for (const generation of run.generations) {
      const bucket = byCase.get(generation.caseId) ?? new Set<string>();
      bucket.add(generation.inputFingerprint);
      byCase.set(generation.caseId, bucket);
    }
    for (const [caseId, fingerprints] of byCase) {
      expect(fingerprints.size, `${caseId} was asked two different things`).toBe(1);
    }
  });

  it('names a task the committed suite actually declares', () => {
    const cases = new Map(loadSuite().cases.map(entry => [entry.id, entry]));
    for (const generation of run.generations) {
      expect(cases.get(generation.caseId)?.task).toBe(generation.task);
    }
  });

  it('would notice a missing artifact block', () => {
    const broken = structuredClone(run);
    (broken.generations[0] as unknown as Record<string, unknown>).artifact = {
      ...broken.generations[0]!.artifact,
      sha256: '',
    };
    expect(validateRun(broken).some(problem => problem.field === 'artifact.sha256')).toBe(true);
  });

  it('would notice a missing context block', () => {
    const broken = structuredClone(run);
    broken.generations[0]!.context.contextSize = 0;
    broken.generations[0]!.context.reasoning = '';
    const fields = validateRun(broken).map(problem => problem.field);
    expect(fields).toContain('context.contextSize');
    expect(fields).toContain('context.reasoning');
  });

  it('would notice missing run metadata', () => {
    const broken = structuredClone(run);
    broken.metadata.runnerVersion = '';
    broken.metadata.host.logicalCores = 0;
    const fields = validateRun(broken).map(problem => problem.field);
    expect(fields).toContain('metadata.runnerVersion');
    expect(fields).toContain('metadata.host');
  });

  it('carries the raw-format evidence the strict check needs', () => {
    for (const generation of run.generations) {
      expect(typeof generation.rawFormat.bareJson).toBe('boolean');
      expect(typeof generation.rawFormat.codeFencePresent).toBe('boolean');
      expect(typeof generation.rawFormat.wrapperTextPresent).toBe('boolean');
    }
    // The fenced fixture row proves the observation survives the round trip.
    expect(run.generations.some(generation => generation.rawFormat.codeFencePresent)).toBe(true);
  });

  it('would notice missing raw-format evidence', () => {
    const broken = structuredClone(run);
    delete (broken.generations[0] as unknown as Record<string, unknown>).rawFormat;
    expect(validateRun(broken).some(problem => problem.field === 'rawFormat')).toBe(true);
  });

  it('carries typed suggestions rather than arbitrary JSON', () => {
    for (const generation of run.generations) {
      for (const proposal of generation.normalizedOutput?.eventProposals ?? []) {
        expect(typeof proposal.subjectId).toBe('string');
        expect(typeof proposal.topic).toBe('string');
        expect(typeof proposal.rationale).toBe('string');
      }
      for (const suggestion of generation.normalizedOutput?.memorySuggestions ?? []) {
        expect(typeof suggestion.characterId).toBe('string');
        expect(typeof suggestion.summary).toBe('string');
      }
    }
  });

  it('would notice a missing input fingerprint', () => {
    const broken = structuredClone(run);
    broken.generations[0]!.inputFingerprint = '';
    expect(validateRun(broken).some(problem => problem.field === 'inputFingerprint')).toBe(true);
  });
});
