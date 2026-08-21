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
 * How many times the benchmark may ask one model one case.
 *
 * The plan fixes a first attempt plus **at most one** retry. A model that needed
 * three tries did not answer the same question the others did, so its numbers
 * are not comparable with a compliant run — which is the whole reason the limit
 * is a policy rather than a preference.
 *
 * Declared once here and consumed by the report's history validation, so the
 * evaluator and the structural validator cannot end up disagreeing about what
 * the policy is.
 */
export const MAX_RETRIES = 1;
export const MAX_ATTEMPTS = MAX_RETRIES + 1;

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
  /**
   * Null when the runtime default was used rather than an explicit value.
   *
   * The benchmark configures both explicitly, because "whatever the server
   * happened to default to" is not something anyone can reproduce. The product
   * smoke leaves them alone, and says so here rather than inventing a number.
   */
  topP: number | null;
  seed: number | null;
  /** `--reasoning off` in P0; recorded because it changes output shape. */
  reasoning: string;
}

/**
 * What a run was for.
 *
 * Declared, never inferred. A spotless single-profile smoke satisfies every
 * reproducibility field there is and still cannot decide anything, so purpose is
 * recorded alongside provenance rather than guessed from it.
 */
export type RunKind = 'smoke' | 'official_comparison';

/** Enough to reproduce a run on another machine, without shipping weights. */
export interface RunMetadata {
  runId: string;
  runKind: RunKind;
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
  /**
   * SHA-256 over the suite identity, the case and both prompts verbatim.
   *
   * Two profiles that answered the same case must carry the same fingerprint.
   * That turns "they saw identical inputs" from an assumption into evidence.
   */
  inputFingerprint: string;
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
  /**
   * What the raw response looked like before the validator normalised it.
   *
   * The application validator unwraps ```json fences on purpose, which is right
   * for the product and wrong for a case that demanded bare JSON. Recording the
   * structural observation at evidence time lets the evaluator check that
   * without the report layer reading files.
   */
  rawFormat: RawFormat;
  /** The validated object, when the validator accepted it. */
  normalizedOutput: NormalizedOutput | null;
}

/** Deterministic observation of one raw response's shape. */
export interface RawFormat {
  bareJson: boolean;
  codeFencePresent: boolean;
  wrapperTextPresent: boolean;
}

/**
 * A non-authoritative suggestion that the Core might raise an event.
 *
 * The smallest useful shape and deliberately not a second gameplay schema: no
 * effects, no deltas, no numbers. `unknown[]` used to sit here, which meant
 * `[null]` and `[42]` counted as accepted structured proposals.
 */
export interface EventProposalSuggestion {
  subjectId: string;
  topic: string;
  rationale: string;
}

/** A non-authoritative suggestion that a character might remember something. */
export interface MemorySuggestionItem {
  characterId: string;
  summary: string;
}

/** The application's structured contract, as the validator returns it. */
export interface NormalizedOutput {
  narration: string;
  dialogue: Array<{ speakerId: string; text: string }>;
  toneTags: string[];
  eventProposals: EventProposalSuggestion[];
  memorySuggestions: MemorySuggestionItem[];
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
  if (!metadata.runnerVersion) {
    problems.push({ field: 'metadata.runnerVersion', message: 'the runner version must be recorded' });
  }
  if (metadata.runKind !== 'smoke' && metadata.runKind !== 'official_comparison') {
    problems.push({ field: 'metadata.runKind', message: 'a run must declare what it was for' });
  }
  if (!metadata.host?.cpu || metadata.host.logicalCores <= 0) {
    problems.push({ field: 'metadata.host', message: 'real host facts are required' });
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
    if (typeof generation.rawFormat?.bareJson !== 'boolean') {
      at('rawFormat', 'the shape of the raw response must be recorded');
    }
    if (!SHA256.test(generation.inputFingerprint)) {
      at('inputFingerprint', 'a generation must record what it was asked');
    }
    if (generation.context.contextSize <= 0) at('context.contextSize', 'must be positive');
    if (generation.context.maxOutputTokens <= 0) at('context.maxOutputTokens', 'must be positive');
    if (!generation.context.reasoning) at('context.reasoning', 'the reasoning mode must be recorded');

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

    if (generation.attempt > MAX_ATTEMPTS) {
      at(
        'attempt',
        `attempt ${generation.attempt} exceeds the one-shot retry policy of at most ${MAX_ATTEMPTS} attempts`,
      );
    }
    if (generation.attempt === 1 && generation.retryUsed) {
      at('retryUsed', 'a first attempt cannot be a retry');
    }
    if (generation.attempt > 1 && !generation.retryUsed) {
      at('retryUsed', `attempt ${generation.attempt} must identify itself as a retry`);
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
