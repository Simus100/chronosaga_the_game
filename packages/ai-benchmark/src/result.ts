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
 * The profiles a P0.5 official comparison compares, in canonical order.
 *
 * Lite versus Standard is the question the benchmark exists to answer, so the
 * set is not the caller's to choose: a full-suite Lite-only run satisfies every
 * coverage rule there is and compares nothing. Declared here beside the type
 * rather than as a string list at the report boundary, and the guard below makes
 * a new profile a compile error instead of a silently unmeasured one.
 */
export const OFFICIAL_COMPARISON_PROFILES = ['lite', 'standard'] as const;

type UncomparedProfile = Exclude<BenchmarkProfile, (typeof OFFICIAL_COMPARISON_PROFILES)[number]>;
// If this line stops compiling, a profile was added to BenchmarkProfile without
// deciding whether the official comparison covers it.
const _everyProfileIsCompared: UncomparedProfile[] = [];
void _everyProfileIsCompared;

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
  /**
   * SHA-256 of the canonicalised suite file, as it was when the run executed.
   *
   * `suiteVersion` is assigned by hand: it records what somebody called the
   * suite, not what the suite contained. This records the second, so a stored
   * run cannot be evaluated against an edited suite that kept its version.
   */
  suiteContentSha256: string;
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
   * The model the runtime said produced this response.
   *
   * `null` is the shape the runtime can emit, not a shape this run may keep: a
   * response that does not say who produced it cannot be attributed, and
   * `validateRun` refuses it. The runner's preflight probe proves the right
   * model was loaded before the first prompt and nothing about the rows after
   * it, so every row carries its own answer and every row is checked against it.
   */
  servedModel: string | null;
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

/**
 * Every structural problem in a value claiming to be a {@link NormalizedOutput}.
 *
 * The TypeScript annotation on `normalizedOutput` is a compile-time claim about
 * a value parsed from a file at runtime, which is no protection at all. A run
 * carrying `normalizedOutput: {}` satisfied every rule `validateRun` had — it was
 * not null, and the row said `accepted` — and then `evaluateObjectively` reached
 * for `.dialogue.map(...)` on `undefined`. A malformed nested item is worse,
 * because it does not crash: `dialogue: [{ text: 'ok' }]` evaluates a speaker of
 * `undefined` against the scene and produces a score.
 *
 * Shape and intrinsic value, which is one question: could the application
 * validator have produced this row at all? It rejects a blank narration, a blank
 * dialogue line, a blank proposal field and a blank memory field, so a stored row
 * marked `accepted` that carries any of them did not come from that validator and
 * is not evidence of anything. `dialogue: [{ speakerId: 'mara_001', text: '   ' }]`
 * typechecks perfectly and could never have been accepted.
 *
 * This function checks what can be checked without a suite: shape, and values
 * that are intrinsically impossible whatever the case. Whether a speaker belongs
 * to *this* scene, whether a tone tag is in *this* vocabulary and whether a
 * proposal is grounded in *this* case are equally impossible for an accepted
 * row — `inference::validate` rejects all of them — but answering that needs the
 * case, so it belongs to `acceptedOutputContractProblems` at the report
 * boundary. What stays with the evaluator is quality: an answer the validator
 * would have accepted and a reader would call weak.
 *
 * Unknown keys are refused, because the authoritative cross-language contract
 * refuses them: `StructuredNarration`, `DialogueLine`, `EventProposal` and
 * `MemorySuggestion` are all `deny_unknown_fields` on the Rust side, and a
 * boundary that accepted what the producer would not emit would be describing a
 * different contract.
 *
 * Fails closed and never repairs. Creating a missing array, coercing a value or
 * dropping a malformed item would each turn evidence of a broken run into a
 * plausible-looking number.
 */
export function normalizedOutputProblems(value: unknown): string[] {
  const problems: string[] = [];
  const object = plainObject(value);
  if (object === null) {
    return ['is not an object'];
  }

  if (typeof object.narration !== 'string') {
    problems.push('narration is not a string');
  } else if (object.narration.trim() === '') {
    problems.push('narration is blank');
  }

  problems.push(
    ...arrayProblems(object.dialogue, 'dialogue', (line, at) =>
      fieldProblems(line, at, { speakerId: 'string', text: 'string' }),
    ),
  );

  if (!Array.isArray(object.toneTags)) {
    problems.push('toneTags is not an array');
  } else {
    object.toneTags.forEach((tag, index) => {
      if (typeof tag !== 'string') {
        problems.push(`toneTags[${index}] is not a string`);
      } else if (tag.trim() === '') {
        problems.push(`toneTags[${index}] is blank`);
      }
    });
  }

  problems.push(
    ...arrayProblems(object.eventProposals, 'eventProposals', (proposal, at) =>
      fieldProblems(proposal, at, { subjectId: 'string', topic: 'string', rationale: 'string' }),
    ),
  );

  problems.push(
    ...arrayProblems(object.memorySuggestions, 'memorySuggestions', (suggestion, at) =>
      fieldProblems(suggestion, at, { characterId: 'string', summary: 'string' }),
    ),
  );

  const expected = ['narration', 'dialogue', 'toneTags', 'eventProposals', 'memorySuggestions'];
  for (const key of Object.keys(object)) {
    if (!expected.includes(key)) problems.push(`unexpected field '${key}'`);
  }

  return problems;
}

/** A value that is an object and not an array or null, or `null` if it is not. */
function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Problems in an array field and in each of its items. */
function arrayProblems(
  value: unknown,
  field: string,
  item: (value: unknown, at: string) => string[],
): string[] {
  if (!Array.isArray(value)) return [`${field} is not an array`];
  return value.flatMap((entry, index) => item(entry, `${field}[${index}]`));
}

/** Problems in one object with a fixed set of required string fields. */
function fieldProblems(value: unknown, at: string, shape: Record<string, 'string'>): string[] {
  const object = plainObject(value);
  if (object === null) return [`${at} is not an object`];

  const problems: string[] = [];
  for (const [field, kind] of Object.entries(shape)) {
    const value = object[field];
    if (typeof value !== kind) {
      problems.push(`${at}.${field} is not a ${kind}`);
    } else if (typeof value === 'string' && value.trim() === '') {
      problems.push(`${at}.${field} is blank`);
    }
  }
  for (const key of Object.keys(object)) {
    if (!(key in shape)) problems.push(`${at} has an unexpected field '${key}'`);
  }
  return problems;
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
 * Serialise a value with object keys sorted, recursively.
 *
 * The canonical form both languages hash. Arrays keep their order, because order
 * is meaning in a case list; object keys do not, so two files differing only in
 * key order describe the same suite and must not read as tampering.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
}

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
  if (!SHA256.test(metadata.suiteContentSha256 ?? '')) {
    problems.push({
      field: 'metadata.suiteContentSha256',
      message:
        'a run must record the exact content of the suite it answered, as a SHA-256; ' +
        'the version alone is a label somebody chose',
    });
  }
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
    // All three flags, and their one real relationship.
    //
    // Only `bareJson` was checked, so evidence could carry
    // `{ bareJson: true, codeFencePresent: true }` — a response recorded as both
    // bare and fenced — and the strict evaluator would read the first flag as
    // compliance. The observation contradicts itself, and a contradiction is not
    // a measurement.
    //
    // The invariant is exactly the producer's: `observe_raw_format` sets
    // `bareJson` only when no fence is present and the text is a lone object, so
    // a bare answer is neither fenced nor wrapped. Nothing stronger is implied —
    // an empty response legitimately records all three false, and a fenced one
    // records fence and wrapper together — so `bareJson === false` is not taken
    // to mean one of the others must be true.
    //
    // Refused, never repaired: no missing flag defaults to false, no "false"
    // becomes false, and the recorded observation is left as it was found.
    const rawFormat = generation.rawFormat as unknown;
    if (typeof rawFormat !== 'object' || rawFormat === null || Array.isArray(rawFormat)) {
      at('rawFormat', 'the shape of the raw response must be recorded as an object');
    } else {
      const observed = rawFormat as Record<string, unknown>;
      const flags = ['bareJson', 'codeFencePresent', 'wrapperTextPresent'] as const;
      const malformed = flags.filter(flag => typeof observed[flag] !== 'boolean');
      for (const flag of malformed) {
        at(
          `rawFormat.${flag}`,
          observed[flag] === undefined
            ? 'is absent; every raw-format flag must be recorded as a boolean'
            : `is ${JSON.stringify(observed[flag])}, a ${typeof observed[flag]}; it must be a boolean`,
        );
      }
      if (malformed.length === 0 && observed.bareJson === true) {
        for (const flag of ['codeFencePresent', 'wrapperTextPresent'] as const) {
          if (observed[flag] === true) {
            at(
              `rawFormat.${flag}`,
              `is true while bareJson is true; a bare JSON object cannot also be ${
                flag === 'codeFencePresent' ? 'fenced' : 'wrapped in text'
              }`,
            );
          }
        }
      }
    }
    if (!SHA256.test(generation.inputFingerprint)) {
      at('inputFingerprint', 'a generation must record what it was asked');
    }
    if (generation.context.contextSize <= 0) at('context.contextSize', 'must be positive');
    if (generation.context.maxOutputTokens <= 0) at('context.maxOutputTokens', 'must be positive');
    if (!generation.context.reasoning) at('context.reasoning', 'the reasoning mode must be recorded');

    // Before any branch on what acceptance *means*, whether it is an acceptance
    // at all. The field is declared `boolean`, and that annotation says nothing
    // about a value parsed from a file: `accepted: "false"` is a string, and in
    // JavaScript a non-empty string is truthy. It would have taken the accepted
    // branch here, then been read as a successful terminal attempt, counted
    // toward official coverage, and incremented `casesAccepted` — a rejection
    // reported as a success by the word "false".
    //
    // Refused, never coerced. `Boolean(value)` or `!!value` would decide what the
    // row meant on the row's behalf, and a benchmark that guesses at its own
    // evidence is not measuring anything. The stored value is left exactly as it
    // was found, and neither acceptance branch runs — asking whether a rejection
    // said why, when the row does not say whether it is one, would be inventing
    // an answer to report a problem about.
    if (typeof generation.accepted !== 'boolean') {
      at(
        'accepted',
        `acceptance is ${JSON.stringify(generation.accepted) ?? 'undefined'}, which is ` +
          `${generation.accepted === undefined ? 'absent' : `a ${typeof generation.accepted}`}; ` +
          'it must be a boolean, because everything downstream branches on it',
      );
    } else if (generation.accepted) {
      if (generation.normalizedOutput === null) {
        at('normalizedOutput', 'an accepted generation must carry its validated output');
      } else {
        // Not-null was the whole test before, and the annotation did the rest of
        // the work in the type checker, where the file being read is not.
        for (const problem of normalizedOutputProblems(generation.normalizedOutput)) {
          at('normalizedOutput', problem);
        }
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

    // Attribution, per row. The alias the runtime reports is the alias the
    // runtime was launched under, which is the profile id, so a row whose
    // answering model is anything else was produced by a model this row does not
    // name. A fallback answers under the profile it fell back to; anything else
    // is a swap the run did not intend.
    const expectedModel = generation.fallbackProfile ?? generation.profile;
    if (generation.servedModel === null) {
      at(
        'servedModel',
        'the runtime did not say which model produced this response, so it cannot be ' +
          'attributed to any artifact',
      );
    } else if (generation.servedModel !== expectedModel) {
      at(
        'servedModel',
        `answered by '${generation.servedModel}' but recorded under '${expectedModel}'; ` +
          'the run cannot be reported as evidence about either',
      );
    }
  }

  return problems;
}

/** Every generation for one profile, in case order. */
export function generationsFor(run: BenchmarkRun, profile: BenchmarkProfile): BenchmarkGeneration[] {
  return run.generations.filter(generation => generation.profile === profile);
}
