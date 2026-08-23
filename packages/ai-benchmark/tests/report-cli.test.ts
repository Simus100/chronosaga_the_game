import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import {
  REPORT_CLI_USAGE,
  reportOnRunDirectory,
  runDirectoryArgument,
} from '../src/adapters/report-cli.js';

/**
 * The operator path from evidence on disk to a report.
 *
 * The gates themselves are tested where they live; what is tested here is that
 * the command reaches them in order, refuses rather than repairs, and takes its
 * checkout authority from nobody.
 */
const temporary: string[] = [];
afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function runDirectory(rows: string[], metadata = JSON.stringify(rustRun.metadata)): string {
  const root = mkdtempSync(join(tmpdir(), 'chronosaga-cli-'));
  temporary.push(root);
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'metadata.json'), metadata);
  writeFileSync(join(root, 'generations.jsonl'), rows.join('\n') + '\n');
  return root;
}

const rows = () => rustRun.generations.map(generation => JSON.stringify(generation));

/** The refusal, or a failure saying what was published instead. */
function refusalFor(directory: string): string {
  const outcome = reportOnRunDirectory(directory);
  if (outcome.published) {
    throw new Error(`expected a refusal, got a report for ${outcome.report.runId}`);
  }
  return outcome.refusal;
}

describe('the arguments the report command accepts', () => {
  it('takes exactly one run directory', () => {
    expect(runDirectoryArgument(['D:/runs/official_1'])).toBe('D:/runs/official_1');
  });

  it('13: refuses to be pointed at a second thing', () => {
    // A command that quietly ignored the extra arguments would let
    // `report-cli run-a --repository ../other-checkout` look like it had been
    // honoured. There is no repository argument, so saying so is the whole job.
    expect(() => runDirectoryArgument(['run-a', '--repository', '../other'])).toThrow(
      /expected one run directory, got 3/,
    );
    expect(() => runDirectoryArgument(['run-a', '../other'])).toThrow(/got 2/);
    expect(() => runDirectoryArgument(['--repository=../other'])).toThrow(/takes no options/);
    expect(() => runDirectoryArgument([])).toThrow(/no run directory given/);
  });

  it('says how to call it, in the same words the documentation uses', () => {
    expect(REPORT_CLI_USAGE).toContain('dist/adapters/report-cli.js');
    for (const argv of [[], ['a', 'b'], ['-x']]) {
      expect(() => runDirectoryArgument(argv)).toThrow(/dist\/adapters\/report-cli\.js/);
    }
  });
});

describe('what the report command refuses', () => {
  it('an absent run is the absence of evidence', () => {
    expect(refusalFor(join(tmpdir(), 'chronosaga-no-such-run-4a1f'))).toMatch(/no run metadata at/);
  });

  it('8: malformed metadata never becomes a report', () => {
    const refusal = refusalFor(runDirectory(rows(), '{ not json'));
    expect(refusal).toMatch(/^not a benchmark run:/);
    expect(refusal).toContain('metadata');
  });

  it('9: a malformed row is named, and stops the run reaching aggregation', () => {
    // Not dropped and not repaired: dropping it would silently shrink the run,
    // and a report over a shrunken run is a report over evidence nobody has.
    const broken = rows();
    broken.splice(1, 0, '{"caseId": "ai_case_002", trun');
    const refusal = refusalFor(runDirectory(broken));
    expect(refusal).toMatch(/^not a benchmark run:/);
    expect(refusal).toContain('generations[1]');
  });

  it('9: and a row that parses but lies about its types is refused too', () => {
    const hostile = rows();
    hostile[0] = JSON.stringify({ ...rustRun.generations[0], latencyMs: '100', accepted: 'false' });
    const refusal = refusalFor(runDirectory(hostile));
    expect(refusal).toMatch(/^not a benchmark run:/);
    expect(refusal).toContain('latencyMs');
  });

  it('10: a partial run is evidence of an interruption, not a comparison', () => {
    const refusal = refusalFor(runDirectory(rows().slice(0, 1)));
    // Past the structural and semantic boundaries — a partial run is
    // well-formed — and stopped by coverage, which is the correct division.
    expect(refusal).not.toMatch(/^not a benchmark run:/);
    expect(refusal).not.toMatch(/^invalid run:/);
    expect(refusal).toMatch(/no comparable evidence|official comparison/);
  });

  it('11: a run from another commit cannot be authenticated here', () => {
    // The checkout binding is the point: this repository is dirty or at another
    // commit while the fixture names its own, so the report is refused rather
    // than published under the wrong judgement.
    const refusal = refusalFor(runDirectory(rows()));
    expect(refusal).toMatch(/checkout|suite|artifact|runtime|official comparison/);
  });
});

describe('where the report command gets its authority', () => {
  const cliSource = fileURLToPath(new URL('../src/adapters/report-cli.ts', import.meta.url));

  it('12 and 13: nothing about the checkout comes from the caller', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(cliSource, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // No repository path, no commit, no dirty override, and no environment.
    for (const forbidden of [
      'repositoryRoot',
      'checkoutRoot',
      'gitCommit',
      'gitDirty',
      'process.env',
      'process.cwd',
      'buildComparisonWithTrustedCheckout',
      'buildOfficialComparisonFromRepository',
    ]) {
      expect(source, `report-cli reads ${forbidden}`).not.toContain(forbidden);
    }

    // It goes through the one entry point that derives the checkout from its
    // own location.
    expect(source).toContain('buildLocalOfficialComparison');
  });

  it('12: the same directory gets the same answer from any working directory', () => {
    // `process.cwd()` is never consulted, so where the command was launched
    // from cannot change what it decides. Run in-process rather than as a
    // subprocess: CI runs the tests before the build, so a test that needed
    // `dist/` would be red on a clean clone and green only here.
    const directory = runDirectory(rows().slice(0, 1));
    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const original = process.cwd();

    // Compared as outcomes rather than as refusals: what matters is that the
    // two answers are the same, not which answer it is.
    try {
      process.chdir(repositoryRoot);
      const fromRepository = JSON.stringify(reportOnRunDirectory(directory));
      process.chdir(tmpdir());
      const fromElsewhere = JSON.stringify(reportOnRunDirectory(directory));
      expect(fromElsewhere).toBe(fromRepository);
    } finally {
      process.chdir(original);
    }
  });

  it('12: and the compiled entry point is the one the documentation names', () => {
    // Only when a build is present — CI tests before it builds.
    const compiled = fileURLToPath(new URL('../dist/adapters/report-cli.js', import.meta.url));
    if (!existsSync(compiled)) return;

    const attempt = (cwd: string) => {
      try {
        execFileSync(process.execPath, [compiled, '--repository', '../elsewhere'], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, stderr: '' };
      } catch (error) {
        const failure = error as { status: number; stderr: string };
        return { code: failure.status, stderr: failure.stderr };
      }
    };

    const refused = attempt(dirname(compiled));
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('expected one run directory');
  });
});
