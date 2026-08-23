/**
 * The one place external JSON becomes a `BenchmarkRun`.
 *
 * Runs are loaded from files nobody type-checked. A TypeScript annotation is a
 * claim the caller makes about a parsed value, not a fact about it, and this
 * package learned that one field at a time: `accepted: "false"` read as truthy,
 * `latencyMs: "100"` reaching a median, `rawFormat` half-checked, `attempt` as a
 * string quietly costing a pair its coverage. Each was fixed where it was found.
 * The pattern was the bug.
 *
 * So this validates the whole shape once, before any consumer reads it. What it
 * proves is narrow and total: every field is the runtime type the Rust producer
 * serialises, every object a consumer dereferences is an object, and every array
 * is an array. It answers no semantic question — whether an accepted row carries
 * output, whether a retry followed a rejection, whether a digest matches a lock —
 * those stay with `validateRun` and the gates above it, which may now read the
 * fields without asking what they are.
 *
 * Nothing is coerced, defaulted, wrapped or repaired, and nothing throws:
 * malformed input produces problems, because a boundary that crashes on bad
 * input has not validated it.
 */
import type { ResultProblem } from './result.js';
import { OFFICIAL_COMPARISON_PROFILES } from './result.js';

const RUN_KINDS = ['smoke', 'official_comparison'];

/** A value that is an object and neither null nor an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** How a value should be described in a complaint about its type. */
function describe(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return `${JSON.stringify(value)}, a ${typeof value}`;
}

/** Collects problems without ever throwing on the value it is inspecting. */
class Problems {
  readonly list: ResultProblem[] = [];

  at(generationId: string | undefined, field: string, message: string): void {
    this.list.push(generationId === undefined ? { field, message } : { generationId, field, message });
  }

  /** `value` must be a string. */
  string(id: string | undefined, field: string, value: unknown): boolean {
    if (typeof value === 'string') return true;
    this.at(id, field, `is ${describe(value)}; it must be a string`);
    return false;
  }

  /** `value` must be a boolean — not "true", not 1, not null. */
  boolean(id: string | undefined, field: string, value: unknown): boolean {
    if (typeof value === 'boolean') return true;
    this.at(id, field, `is ${describe(value)}; it must be a boolean`);
    return false;
  }

  /** `value` must be a whole number JavaScript holds exactly, at least `least`. */
  whole(id: string | undefined, field: string, value: unknown, least: number): boolean {
    if (typeof value !== 'number') {
      this.at(id, field, `is ${describe(value)}; it must be a number`);
      return false;
    }
    if (!Number.isFinite(value)) {
      this.at(id, field, `is ${String(value)}, which is not a finite number`);
      return false;
    }
    if (!Number.isInteger(value)) {
      this.at(id, field, `is ${value}, which is not a whole number`);
      return false;
    }
    if (!Number.isSafeInteger(value)) {
      this.at(id, field, `is ${value}, beyond the range JavaScript represents exactly`);
      return false;
    }
    if (value < least) {
      this.at(id, field, least === 0 ? `is ${value}, which is negative` : `is ${value}, below ${least}`);
      return false;
    }
    return true;
  }

  /** `value` must be a finite number, at least `least`. */
  real(id: string | undefined, field: string, value: unknown, least: number): boolean {
    if (typeof value !== 'number') {
      this.at(id, field, `is ${describe(value)}; it must be a number`);
      return false;
    }
    if (!Number.isFinite(value)) {
      this.at(id, field, `is ${String(value)}, which is not a finite number`);
      return false;
    }
    if (value < least) {
      this.at(id, field, least === 0 ? `is ${value}, which is negative` : `is ${value}, below ${least}`);
      return false;
    }
    return true;
  }

  /** `value` must be one of `allowed`. */
  member(id: string | undefined, field: string, value: unknown, allowed: readonly string[]): boolean {
    if (typeof value === 'string' && allowed.includes(value)) return true;
    this.at(id, field, `is ${describe(value)}; it must be one of: ${allowed.join(', ')}`);
    return false;
  }

  /** `value` must be an object a consumer can dereference. */
  object(id: string | undefined, field: string, value: unknown): value is Record<string, unknown> {
    if (isPlainObject(value)) return true;
    this.at(id, field, `is ${describe(value)}; it must be an object`);
    return false;
  }
}

/** Every structural problem in a value claiming to be a {@link BenchmarkRun}. */
export function structuralBenchmarkRunProblems(value: unknown): ResultProblem[] {
  const problems = new Problems();

  if (!problems.object(undefined, 'run', value)) return problems.list;
  const run = value;

  if (problems.object(undefined, 'metadata', run.metadata)) {
    checkMetadata(problems, run.metadata as Record<string, unknown>);
  }

  if (!Array.isArray(run.generations)) {
    problems.at(undefined, 'generations', `is ${describe(run.generations)}; it must be an array`);
    return problems.list;
  }

  for (const [index, entry] of run.generations.entries()) {
    if (!isPlainObject(entry)) {
      problems.at(undefined, `generations[${index}]`, `is ${describe(entry)}; it must be an object`);
      continue;
    }
    checkGeneration(problems, entry, index);
  }

  return problems.list;
}

function checkMetadata(problems: Problems, metadata: Record<string, unknown>): void {
  for (const field of [
    'runId',
    'startedAt',
    'gitCommit',
    'suiteVersion',
    'suiteContentSha256',
    'runnerVersion',
    'runtimeReleaseTag',
  ]) {
    problems.string(undefined, `metadata.${field}`, metadata[field]);
  }
  problems.member(undefined, 'metadata.runKind', metadata.runKind, RUN_KINDS);
  problems.boolean(undefined, 'metadata.gitDirty', metadata.gitDirty);
  problems.whole(undefined, 'metadata.suiteSchemaVersion', metadata.suiteSchemaVersion, 0);

  // `Option<String>`: null is a real answer, anything else must be the string it
  // claims to be — the official gate matches it against a digest with a regex.
  if (metadata.runtimeExecutableSha256 !== null) {
    problems.string(undefined, 'metadata.runtimeExecutableSha256', metadata.runtimeExecutableSha256);
  }

  if (problems.object(undefined, 'metadata.host', metadata.host)) {
    const host = metadata.host as Record<string, unknown>;
    for (const field of ['os', 'arch', 'cpu']) {
      problems.string(undefined, `metadata.host.${field}`, host[field]);
    }
    problems.whole(undefined, 'metadata.host.logicalCores', host.logicalCores, 0);
    problems.whole(undefined, 'metadata.host.totalRamMb', host.totalRamMb, 0);
  }
}

function checkGeneration(
  problems: Problems,
  generation: Record<string, unknown>,
  index: number,
): void {
  // The id names the row in every later complaint, so it is read first and only
  // used when it is genuinely a string.
  const named = typeof generation.id === 'string' ? generation.id : undefined;
  const where = named ?? `generations[${index}]`;
  if (named === undefined) {
    problems.at(undefined, `generations[${index}].id`, `is ${describe(generation.id)}; it must be a string`);
  }

  for (const field of [
    'runId',
    'caseId',
    'task',
    'inputFingerprint',
    'rawOutputPath',
    // Structural only — that it is a string at all. `validateRun` owns
    // whether it is a SHA-256, and the adapter owns whether it is the
    // right one. Reading a missing digest as "nothing to check" is how a
    // deleted raw file would go unnoticed.
    'rawOutputSha256',
  ]) {
    problems.string(where, field, generation[field]);
  }
  problems.member(where, 'profile', generation.profile, OFFICIAL_COMPARISON_PROFILES);

  for (const field of ['accepted', 'retryUsed', 'fallbackUsed']) {
    problems.boolean(where, field, generation[field]);
  }

  problems.whole(where, 'attempt', generation.attempt, 1);
  problems.whole(where, 'latencyMs', generation.latencyMs, 0);
  if (generation.tokensGenerated !== null) {
    problems.whole(where, 'tokensGenerated', generation.tokensGenerated, 0);
  }
  if (generation.tokensPerSecond !== null) {
    problems.real(where, 'tokensPerSecond', generation.tokensPerSecond, 0);
  }
  if (generation.fallbackProfile !== null) {
    problems.member(where, 'fallbackProfile', generation.fallbackProfile, OFFICIAL_COMPARISON_PROFILES);
  }
  if (generation.servedModel !== null) {
    problems.string(where, 'servedModel', generation.servedModel);
  }

  // `.length` and `.join()` downstream: an array of strings, or nothing. A
  // `{ length: 0 }` would satisfy a length test and break every other use.
  if (!Array.isArray(generation.validatorErrors)) {
    problems.at(
      where,
      'validatorErrors',
      `is ${describe(generation.validatorErrors)}; it must be an array of strings`,
    );
  } else {
    for (const [at, entry] of generation.validatorErrors.entries()) {
      problems.string(where, `validatorErrors[${at}]`, entry);
    }
  }

  if (problems.object(where, 'artifact', generation.artifact)) {
    const artifact = generation.artifact as Record<string, unknown>;
    for (const field of ['family', 'quantization', 'artifactFilename', 'sha256', 'source']) {
      problems.string(where, `artifact.${field}`, artifact[field]);
    }
    problems.member(where, 'artifact.profileId', artifact.profileId, OFFICIAL_COMPARISON_PROFILES);
    problems.whole(where, 'artifact.sizeBytes', artifact.sizeBytes, 0);
    problems.boolean(where, 'artifact.releaseApproved', artifact.releaseApproved);
  }

  if (problems.object(where, 'context', generation.context)) {
    const context = generation.context as Record<string, unknown>;
    // Structural bounds only: that these must be *positive* is a policy
    // `validateRun` states separately.
    problems.whole(where, 'context.contextSize', context.contextSize, 0);
    problems.whole(where, 'context.maxOutputTokens', context.maxOutputTokens, 0);
    problems.real(where, 'context.temperature', context.temperature, 0);
    if (context.topP !== null) problems.real(where, 'context.topP', context.topP, 0);
    // `Option<i64>`: signed, so no lower bound beyond what JavaScript can hold.
    if (context.seed !== null) {
      problems.whole(where, 'context.seed', context.seed, Number.MIN_SAFE_INTEGER);
    }
    problems.string(where, 'context.reasoning', context.reasoning);
  }

  if (problems.object(where, 'rawFormat', generation.rawFormat)) {
    checkRawFormat(problems, where, generation.rawFormat as Record<string, unknown>);
  }

  // Its contents belong to `normalizedOutputProblems`; this only proves a
  // consumer can look inside without crashing.
  if (generation.normalizedOutput !== null && !isPlainObject(generation.normalizedOutput)) {
    problems.at(
      where,
      'normalizedOutput',
      `is ${describe(generation.normalizedOutput)}; it must be an object or null`,
    );
  }
}

function checkRawFormat(problems: Problems, where: string, observed: Record<string, unknown>): void {
  const flags = ['bareJson', 'codeFencePresent', 'wrapperTextPresent'] as const;
  const wellFormed = flags.filter(flag => problems.boolean(where, `rawFormat.${flag}`, observed[flag]));
  if (wellFormed.length !== flags.length) return;

  // The producer's own invariant: `observe_raw_format` sets `bareJson` only when
  // no fence is present and the text is a lone object. Nothing stronger — an
  // empty response legitimately records all three false, and a fenced one
  // records fence and wrapper together.
  if (observed.bareJson !== true) return;
  for (const flag of ['codeFencePresent', 'wrapperTextPresent'] as const) {
    if (observed[flag] === true) {
      problems.at(
        where,
        `rawFormat.${flag}`,
        `is true while bareJson is true; a bare JSON object cannot also be ${
          flag === 'codeFencePresent' ? 'fenced' : 'wrapped in text'
        }`,
      );
    }
  }
}
