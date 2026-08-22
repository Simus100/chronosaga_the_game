import { describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import { structuralBenchmarkRunProblems, validateRun, type BenchmarkRun } from '../src/index.js';
import {
  acceptedOutputContractProblems,
} from '../src/contract.js';
import {
  buildComparison,
  comparableEvidenceProblems,
  officialEvidenceProblems,
  renderComparison,
  reviewPopulationProblems,
  scorePopulationProblems,
  terminalGenerations,
} from '../src/report.js';
import { evaluateObjectively } from '../src/objective.js';
import { loadSuite } from '../src/suite.js';

/**
 * `buildComparison` with a checkout that matches the run being reported.
 *
 * Every existing test describes a report produced from the run's own commit,
 * which is the ordinary case. Deriving it from the run here simulates that
 * situation; it is not the production path, where the commit is read from the
 * repository. The tests that matter for this boundary build mismatches
 * explicitly.
 */
function reportedFromItsOwnCheckout(
  suiteUnderTest: Parameters<typeof buildComparison>[0],
  run: Parameters<typeof buildComparison>[1],
  profiles?: Parameters<typeof buildComparison>[2],
  sheet?: Parameters<typeof buildComparison>[3],
  review?: Parameters<typeof buildComparison>[4],
) {
  return buildComparison(suiteUnderTest, run, profiles, sheet, review, {
    gitCommit: run.metadata.gitCommit,
    gitDirty: false,
  });
}


/**
 * The external evidence boundary.
 *
 * Runs arrive as JSON nobody type-checked. Every consumer below this line —
 * retry histories, coverage, the official gates, the evaluator, the human
 * populations, the aggregates, the renderer — reads fields without asking what
 * they are, and may do so only because this boundary proved it first.
 */
const suite = loadSuite();
const valid = () => structuredClone(rustRun) as unknown as BenchmarkRun;

/** The run with one field replaced by whatever external JSON might carry. */
function broken(path: string, value: unknown): BenchmarkRun {
  const run = valid() as unknown as Record<string, unknown>;
  const parts = path.split('.');
  let cursor: Record<string, unknown> = run;
  for (const part of parts.slice(0, -1)) {
    const index = Number(part);
    cursor = (Number.isInteger(index) ? (cursor as never as unknown[])[index] : cursor[part]) as Record<
      string,
      unknown
    >;
  }
  const last = parts[parts.length - 1]!;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
  return run as unknown as BenchmarkRun;
}

const fields = (run: BenchmarkRun) => validateRun(run).map(problem => problem.field);

describe('the external evidence boundary', () => {
  it('A: the Rust fixture passes unchanged', () => {
    expect(structuralBenchmarkRunProblems(valid())).toEqual([]);
    expect(validateRun(valid())).toEqual([]);
  });

  it('B, C, D, E and F: a broken root is refused, never thrown on', () => {
    for (const value of [null, undefined, [], 'run', 42, true]) {
      expect(() => structuralBenchmarkRunProblems(value), String(value)).not.toThrow();
      expect(structuralBenchmarkRunProblems(value).length, String(value)).toBeGreaterThan(0);
    }
    expect(fields(broken('metadata', null))).toContain('metadata');
    expect(fields(broken('metadata', []))).toContain('metadata');
    expect(fields(broken('generations', undefined))).toContain('generations');
    expect(fields(broken('generations', {}))).toContain('generations');
    expect(fields(broken('generations.0', null))).toContain('generations[0]');
    expect(fields(broken('generations.0', 'row'))).toContain('generations[0]');
  });

  describe('validatorErrors', () => {
    it('G, H, I and J: only a real array of strings is accepted', () => {
      for (const value of ['schema failed', 42, null, {}, { length: 0 }, ['ok', 4], [null], [{}]]) {
        const problems = fields(broken('generations.0.validatorErrors', value));
        expect(problems.some(field => field.startsWith('validatorErrors')), JSON.stringify(value)).toBe(
          true,
        );
      }
      // The accepted row in the fixture carries [], which is valid.
      expect(validateRun(valid())).toEqual([]);
    });

    it('K: a rejected row with a message stays valid', () => {
      const run = valid();
      const rejected = run.generations.find(generation => !generation.accepted)!;
      expect(rejected.validatorErrors.length).toBeGreaterThan(0);
      expect(validateRun(run)).toEqual([]);
    });

    it('L: the accepted/rejected policy is unchanged', () => {
      const rejected = valid();
      rejected.generations.find(generation => !generation.accepted)!.validatorErrors = [];
      expect(fields(rejected)).toContain('validatorErrors');

      const accepted = valid();
      accepted.generations.find(generation => generation.accepted)!.validatorErrors = ['late'];
      expect(fields(accepted)).toContain('validatorErrors');
    });

    it('N: a fake array never reaches .join() or iteration', () => {
      // { length: 0 } passes a length test and breaks everything else.
      const run = broken('generations.0.validatorErrors', { length: 0 });
      expect(fields(run)).toContain('validatorErrors');
      expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
    });
  });

  describe('booleans', () => {
    it('M through Q: every material boolean must be one', () => {
      const cases: Array<[string, string]> = [
        ['metadata.gitDirty', 'metadata.gitDirty'],
        ['generations.0.accepted', 'accepted'],
        ['generations.0.retryUsed', 'retryUsed'],
        ['generations.0.fallbackUsed', 'fallbackUsed'],
        ['generations.0.artifact.releaseApproved', 'artifact.releaseApproved'],
        ['generations.0.rawFormat.bareJson', 'rawFormat.bareJson'],
        ['generations.0.rawFormat.codeFencePresent', 'rawFormat.codeFencePresent'],
        ['generations.0.rawFormat.wrapperTextPresent', 'rawFormat.wrapperTextPresent'],
      ];
      for (const [path, field] of cases) {
        for (const value of ['true', 'false', 0, 1, null, {}, []]) {
          expect(fields(broken(path, value)), `${path}=${JSON.stringify(value)}`).toContain(field);
        }
      }
    });

    it('the rawFormat coherence rule survives the move', () => {
      const run = valid();
      run.generations[0]!.rawFormat = {
        bareJson: true,
        codeFencePresent: true,
        wrapperTextPresent: false,
      };
      expect(fields(run)).toContain('rawFormat.codeFencePresent');

      // And all-false stays legitimate: an empty raw response records it.
      const empty = valid();
      empty.generations[0]!.rawFormat = {
        bareJson: false,
        codeFencePresent: false,
        wrapperTextPresent: false,
      };
      expect(validateRun(empty)).toEqual([]);
    });
  });

  describe('numbers', () => {
    it('R through Z: no numeric string is admitted anywhere', () => {
      const cases: Array<[string, unknown, string]> = [
        ['generations.0.context.contextSize', '4096', 'context.contextSize'],
        ['generations.0.context.maxOutputTokens', '512', 'context.maxOutputTokens'],
        ['generations.0.context.temperature', '0.2', 'context.temperature'],
        ['generations.0.context.topP', '0.95', 'context.topP'],
        ['generations.0.context.seed', '7419', 'context.seed'],
        ['metadata.host.logicalCores', '24', 'metadata.host.logicalCores'],
        ['metadata.host.totalRamMb', '65536', 'metadata.host.totalRamMb'],
        ['generations.0.artifact.sizeBytes', '1282439264', 'artifact.sizeBytes'],
        ['generations.0.latencyMs', '100', 'latencyMs'],
        ['generations.0.attempt', '1', 'attempt'],
        ['metadata.suiteSchemaVersion', '1', 'metadata.suiteSchemaVersion'],
      ];
      for (const [path, value, field] of cases) {
        expect(fields(broken(path, value)), path).toContain(field);
      }
    });

    it('U: non-finite numbers are refused wherever a number is expected', () => {
      for (const path of [
        'generations.0.context.temperature',
        'generations.0.context.topP',
        'generations.0.latencyMs',
        'generations.0.tokensPerSecond',
        'metadata.host.totalRamMb',
      ]) {
        for (const value of [NaN, Infinity, -Infinity]) {
          expect(fields(broken(path, value)).length, `${path}=${String(value)}`).toBeGreaterThan(0);
        }
      }
    });

    it('AA: the values Rust actually writes pass', () => {
      expect(validateRun(valid())).toEqual([]);
      // Optional numerics may legitimately be null.
      const optional = valid();
      optional.generations[0]!.tokensGenerated = null;
      optional.generations[0]!.tokensPerSecond = null;
      optional.generations[0]!.context.topP = null;
      optional.generations[0]!.context.seed = null;
      expect(validateRun(optional)).toEqual([]);
      // And a seed is signed, as Rust's i64 is.
      const negative = valid();
      negative.generations[0]!.context.seed = -7419;
      expect(validateRun(negative)).toEqual([]);
    });
  });

  describe('strings and unions', () => {
    it('AB through AG: a non-string never reaches a regex or .trim()', () => {
      const cases: Array<[string, string]> = [
        ['metadata.runKind', 'metadata.runKind'],
        ['metadata.runId', 'metadata.runId'],
        ['metadata.gitCommit', 'metadata.gitCommit'],
        ['metadata.suiteContentSha256', 'metadata.suiteContentSha256'],
        ['metadata.runtimeReleaseTag', 'metadata.runtimeReleaseTag'],
        ['metadata.runtimeExecutableSha256', 'metadata.runtimeExecutableSha256'],
        ['metadata.host.cpu', 'metadata.host.cpu'],
        ['generations.0.profile', 'profile'],
        ['generations.0.caseId', 'caseId'],
        ['generations.0.task', 'task'],
        ['generations.0.inputFingerprint', 'inputFingerprint'],
        ['generations.0.rawOutputPath', 'rawOutputPath'],
        ['generations.0.servedModel', 'servedModel'],
        ['generations.0.artifact.sha256', 'artifact.sha256'],
        ['generations.0.artifact.profileId', 'artifact.profileId'],
        ['generations.0.context.reasoning', 'context.reasoning'],
      ];
      for (const [path, field] of cases) {
        for (const value of [42, {}, [], true]) {
          expect(fields(broken(path, value)), `${path}=${JSON.stringify(value)}`).toContain(field);
        }
      }
    });

    it('unions are checked against the canonical lists, not just for stringness', () => {
      expect(fields(broken('metadata.runKind', 'official'))).toContain('metadata.runKind');
      expect(fields(broken('generations.0.profile', 'turbo'))).toContain('profile');
      expect(fields(broken('generations.0.artifact.profileId', 'turbo'))).toContain(
        'artifact.profileId',
      );
      expect(fields(broken('generations.0.fallbackProfile', 'turbo'))).toContain('fallbackProfile');
    });

    it('nested objects a consumer dereferences must be objects', () => {
      for (const [path, field] of [
        ['generations.0.artifact', 'artifact'],
        ['generations.0.context', 'context'],
        ['generations.0.rawFormat', 'rawFormat'],
        ['metadata.host', 'metadata.host'],
        ['generations.0.normalizedOutput', 'normalizedOutput'],
      ] as Array<[string, string]>) {
        expect(fields(broken(path, 'text')), path).toContain(field);
        expect(fields(broken(path, 42)), path).toContain(field);
      }
    });
  });

  describe('nothing malformed reaches a consumer', () => {
    // One malformed run, driven at every consumer the report pipeline has.
    const malformed = () => broken('generations.0.latencyMs', '100');

    it('AH through AP: every downstream stage refuses rather than reads', () => {
      const run = malformed();
      expect(fields(run)).toContain('latencyMs');

      // The gate that protects them all: validateRun is the first thing
      // buildComparison does, so nothing below it is ever handed this run.
      expect(() => reportedFromItsOwnCheckout(suite, run)).toThrow(/structurally invalid run/);
      expect(() => reportedFromItsOwnCheckout(suite, run, ['lite', 'standard'], null, null)).toThrow(
        /structurally invalid run/,
      );
      expect(() => renderComparison(reportedFromItsOwnCheckout(suite, run))).toThrow(
        /structurally invalid run/,
      );
    });

    it('and the helpers below it are never reached with malformed input', () => {
      // Proven by ordering rather than by defensive checks inside each: this
      // asserts the refusal happens, and that the message is the structural one
      // rather than a complaint from a later stage.
      const run = malformed();
      let message = '';
      try {
        reportedFromItsOwnCheckout(suite, run);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^refusing to report on a structurally invalid run/);
      for (const later of ['coverage', 'comparable evidence', 'official comparison', 'population']) {
        expect(message).not.toContain(later);
      }
    });

    it('the consumers themselves are never given a malformed run in this suite', () => {
      // A legitimate run reaches all of them, which is the other half of the
      // claim: the boundary refuses the broken and admits the sound.
      const run = valid();
      expect(terminalGenerations(run, ['lite', 'standard']).length).toBeGreaterThan(0);
      expect(comparableEvidenceProblems(run, ['lite'])).toEqual([]);
      expect(() => officialEvidenceProblems(suite, run, ['lite'])).not.toThrow();
      expect(() => acceptedOutputContractProblems(suite, run)).not.toThrow();
      expect(scorePopulationProblems(run, ['lite'], null)).toEqual([]);
      expect(reviewPopulationProblems(run, ['lite'], null)).toEqual([]);
      const testCase = suite.cases.find(entry => entry.id === run.generations[0]!.caseId)!;
      expect(() => evaluateObjectively(testCase, run.generations[0]!)).not.toThrow();
    });
  });

  it('AQ: validation never mutates or repairs the evidence', () => {
    for (const [path, value] of [
      ['generations.0.latencyMs', '100'],
      ['generations.0.validatorErrors', { length: 0 }],
      ['generations.0.accepted', 'false'],
      ['metadata.host', null],
    ] as Array<[string, unknown]>) {
      const run = broken(path, value);
      const before = structuredClone(run);
      structuralBenchmarkRunProblems(run);
      validateRun(run);
      expect(run, path).toEqual(before);
    }
  });
});
