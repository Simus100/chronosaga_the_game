/**
 * What a benchmark run records, and what it must record to be reproducible.
 *
 * The rule that shapes everything here: a run is *evidence*, so it is written
 * once and never edited. Human scores arrive later in a separate file keyed by
 * generation id, so scoring can never quietly alter what the model actually
 * produced.
 */

import type { BenchmarkTask } from './case.js';

/** Which profile produced a generation. */
export type BenchmarkProfile = 'lite' | 'standard';

/**
 * The exact artifact a generation came from.
 *
 * Copied from the model lock at run time. Without this a result is an opinion
 * about "Lite" rather than a measurement of a specific file.
 */
export interface ArtifactIdentity {
  profileId: BenchmarkProfile;
  family: string;
  quantization: string;
  artifactFilename: string;
  sizeBytes: number;
  sha256: string;
  /** Where the resolver actually found it: packaged, user library, workspace. */
  source: string;
  releaseApproved: boolean;
}

/** How the runtime was configured for the generation. */
export interface ContextConfiguration {
  contextSize: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  seed: number | null;
  /** `--reasoning off` in P0; recorded because it changes output shape. */
  reasoning: string;
}

/** Enough to reproduce a run on another machine, without shipping weights. */
export interface RunMetadata {
  runId: string;
  startedAt: string;
  gitCommit: string;
  /** Dirty checkouts produce results nobody can reproduce; recorded, not blocked. */
  gitDirty: boolean;
  suiteVersion: string;
  suiteSchemaVersion: number;
  runnerVersion: string;
  runtimeReleaseTag: string;
  runtimeExecutableSha256: string | null;
  host: {
    os: string;
    arch: string;
    cpu: string;
    logicalCores: number;
    totalRamMb: number;
  };
}

/** One attempt at one case. Attempts are kept, not overwritten by retries. */
export interface BenchmarkGeneration {
  /** Stable within a run: `${runId}:${caseId}:${profile}:${attempt}`. */
  id: string;
  runId: string;
  caseId: string;
  task: BenchmarkTask;
  profile: BenchmarkProfile;
  artifact: ArtifactIdentity;
  context: ContextConfiguration;
  /** 1 for the first try; a retry is a second row, never a mutation. */
  attempt: number;
  accepted: boolean;
  /** Validator errors in the application's own words, if it rejected. */
  validatorErrors: string[];
  retryUsed: boolean;
  fallbackUsed: boolean;
  fallbackProfile: BenchmarkProfile | null;
  latencyMs: number;
  tokensGenerated: number | null;
  tokensPerSecond: number | null;
  /**
   * Path to the raw output, relative to the run directory.
   *
   * Raw text lives on disk, not in this record and not in Git: 65 cases times
   * two profiles times retries is a lot of prose nobody will diff.
   */
  rawOutputPath: string;
  /** The validated object, when the validator accepted it. */
  normalizedOutput: NormalizedOutput | null;
}

/** The application's structured contract, as the validator returns it. */
export interface NormalizedOutput {
  narration: string;
  dialogue: Array<{ speakerId: string; text: string }>;
  toneTags: string[];
  eventProposals: unknown[];
  memorySuggestions: unknown[];
}

export interface BenchmarkRun {
  metadata: RunMetadata;
  generations: BenchmarkGeneration[];
}

export interface ResultProblem {
  generationId?: string;
  field: string;
  message: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Validate a recorded run.
 *
 * Deliberately strict about identity and metadata, because a run that cannot be
 * attributed to an exact artifact and commit is not evidence of anything.
 */
export function validateRun(run: BenchmarkRun): ResultProblem[] {
  const problems: ResultProblem[] = [];
  const metadata = run.metadata;

  if (!metadata.runId) problems.push({ field: 'metadata.runId', message: 'a run id is required' });
  if (!metadata.gitCommit) {
    problems.push({ field: 'metadata.gitCommit', message: 'results must be attributable to a commit' });
  }
  if (!metadata.suiteVersion) {
    problems.push({ field: 'metadata.suiteVersion', message: 'results must name the suite version' });
  }
  if (!metadata.runtimeReleaseTag) {
    problems.push({ field: 'metadata.runtimeReleaseTag', message: 'the runtime release must be recorded' });
  }

  const seen = new Set<string>();
  for (const generation of run.generations) {
    const at = (field: string, message: string) =>
      problems.push({ generationId: generation.id, field, message });

    if (!generation.id) at('id', 'a generation needs an id');
    if (seen.has(generation.id)) at('id', 'duplicate generation id');
    seen.add(generation.id);

    if (generation.runId !== metadata.runId) at('runId', 'generation belongs to another run');
    if (generation.attempt < 1) at('attempt', 'attempts are numbered from 1');
    if (generation.latencyMs < 0) at('latencyMs', 'latency cannot be negative');

    if (!SHA256.test(generation.artifact.sha256)) {
      at('artifact.sha256', 'an artifact must be identified by a full SHA-256');
    }
    if (generation.artifact.profileId !== generation.profile) {
      at('artifact.profileId', 'the artifact must belong to the profile that produced the generation');
    }

    if (!generation.rawOutputPath) at('rawOutputPath', 'raw evidence must be referenced');

    if (generation.accepted) {
      if (generation.normalizedOutput === null) {
        at('normalizedOutput', 'an accepted generation must carry its validated output');
      }
      if (generation.validatorErrors.length > 0) {
        at('validatorErrors', 'an accepted generation cannot also carry validator errors');
      }
    } else {
      if (generation.normalizedOutput !== null) {
        at('normalizedOutput', 'a rejected generation has no validated output');
      }
      if (generation.validatorErrors.length === 0) {
        at('validatorErrors', 'a rejection must say why');
      }
    }

    if (generation.fallbackUsed && generation.fallbackProfile === null) {
      at('fallbackProfile', 'a fallback must name the profile it fell back to');
    }
    if (!generation.fallbackUsed && generation.fallbackProfile !== null) {
      at('fallbackProfile', 'no fallback happened, so none may be recorded');
    }
  }

  return problems;
}

/** Every generation for one profile, in case order. */
export function generationsFor(run: BenchmarkRun, profile: BenchmarkProfile): BenchmarkGeneration[] {
  return run.generations.filter(generation => generation.profile === profile);
}
