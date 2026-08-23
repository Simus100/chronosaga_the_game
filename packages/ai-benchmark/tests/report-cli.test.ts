import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
import { rawEvidenceProblems } from '../src/adapters/run-directory.js';

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

type Row = Record<string, unknown> | string;

/**
 * A run directory whose raw files exist and match the digests in its rows.
 *
 * The fixture records a digest of raw text it does not carry, so the bytes are
 * invented here and the digest recomputed to match. That is the *intact* case;
 * every tampering test below starts from this and breaks one thing, which is
 * the only way to be sure the refusal comes from the tampering.
 *
 * A row given as a string is written through untouched — that is how the
 * malformed-line tests put something in the file that is not a row at all.
 */
function runDirectory(rows: Row[], metadata = JSON.stringify(rustRun.metadata)): string {
  const root = mkdtempSync(join(tmpdir(), 'chronosaga-cli-'));
  temporary.push(root);
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'metadata.json'), metadata);

  const lines = rows.map(row => {
    if (typeof row === 'string') return row;
    const path = row.rawOutputPath;
    if (typeof path !== 'string' || !path.startsWith('raw/')) return JSON.stringify(row);
    const bytes = Buffer.from(`raw model text for ${row.id}\n`, 'utf8');
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return JSON.stringify({
      ...row,
      rawOutputSha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  writeFileSync(join(root, 'generations.jsonl'), lines.join('\n') + '\n');
  return root;
}

const rows = (): Row[] => rustRun.generations.map(generation => ({ ...generation }));

/** The row objects a directory was built from, re-read from its JSONL. */
function rowsOf(directory: string): Array<Record<string, unknown>> {
  return readFileSync(join(directory, 'generations.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

/** Rewrite a run's rows after changing one of them. */
function rewriteRows(directory: string, rows: Array<Record<string, unknown>>): void {
  writeFileSync(
    join(directory, 'generations.jsonl'),
    rows.map(row => JSON.stringify(row)).join('\n') + '\n',
  );
}

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
    hostile[0] = { ...rustRun.generations[0], latencyMs: '100', accepted: 'false' };
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

describe('raw evidence must still be the evidence', () => {
  // A path is a promise about a file. These are the ways that promise can be
  // broken between the run finishing and somebody reading it: the file is gone,
  // the directory is gone, a byte moved, or another generation's answer is
  // sitting where this one's should be. Every case must refuse, and refuse
  // loudly enough to name the row.
  const rawPathOf = (directory: string, index = 0) =>
    join(directory, rowsOf(directory)[index]!.rawOutputPath as string);

  it('A: an intact run passes the raw gate', () => {
    // The reference point. It is refused later, for coverage — but not here,
    // and every test below differs from this one by exactly one broken thing.
    const refusal = refusalFor(runDirectory(rows()));
    expect(refusal).not.toMatch(/raw evidence/);
  });

  it('B: a deleted raw file refuses', () => {
    const directory = runDirectory(rows());
    unlinkSync(rawPathOf(directory));
    const refusal = refusalFor(directory);
    expect(refusal).toMatch(/^raw evidence does not match/);
    expect(refusal).toMatch(/cannot be read/);
  });

  it('C: a deleted raw directory refuses', () => {
    const directory = runDirectory(rows());
    rmSync(join(directory, 'raw'), { recursive: true, force: true });
    expect(refusalFor(directory)).toMatch(/^raw evidence does not match/);
  });

  it('D: one changed byte refuses', () => {
    const directory = runDirectory(rows());
    const path = rawPathOf(directory);
    const bytes = readFileSync(path);
    bytes[0] = bytes[0]! ^ 0x01;
    writeFileSync(path, bytes);

    const refusal = refusalFor(directory);
    expect(refusal).toMatch(/^raw evidence does not match/);
    expect(refusal).toMatch(/hashing to [0-9a-f]{64}, but the row records [0-9a-f]{64}/);
  });

  it('D: an added newline refuses, and so does a removed one', () => {
    // Whitespace at the end of a file is the change most likely to happen by
    // accident — an editor, a copy through a text tool — and the least likely
    // to be noticed by eye.
    for (const change of [(text: string) => text + '\n', (text: string) => text.trimEnd()]) {
      const directory = runDirectory(rows());
      const path = rawPathOf(directory);
      writeFileSync(path, change(readFileSync(path, 'utf8')));
      expect(refusalFor(directory)).toMatch(/^raw evidence does not match/);
    }
  });

  it('D: a truncated and an extended file both refuse', () => {
    for (const change of [(bytes: Buffer) => bytes.subarray(0, 4), (bytes: Buffer) => Buffer.concat([bytes, Buffer.from('x')])]) {
      const directory = runDirectory(rows());
      const path = rawPathOf(directory);
      writeFileSync(path, change(readFileSync(path)));
      expect(refusalFor(directory)).toMatch(/^raw evidence does not match/);
    }
  });

  it('E: one generation\'s raw bytes standing in for another refuses', () => {
    // The most plausible tampering, and the one a row count cannot see: both
    // files exist, both are readable, and the run looks complete.
    const directory = runDirectory(rows());
    const first = rawPathOf(directory, 0);
    const second = rawPathOf(directory, 1);
    expect(readFileSync(first)).not.toEqual(readFileSync(second));
    writeFileSync(first, readFileSync(second));

    const refusal = refusalFor(directory);
    expect(refusal).toMatch(/^raw evidence does not match/);
    expect(refusal).toContain(rowsOf(directory)[0]!.id as string);
  });

  it('F: a digest changed in the JSONL refuses', () => {
    const directory = runDirectory(rows());
    const rowsNow = rowsOf(directory);
    rowsNow[0]!.rawOutputSha256 = 'f'.repeat(64);
    rewriteRows(directory, rowsNow);
    expect(refusalFor(directory)).toMatch(/^raw evidence does not match/);
  });

  it('G: a missing digest is a structural refusal', () => {
    const directory = runDirectory(rows());
    const rowsNow = rowsOf(directory);
    delete rowsNow[0]!.rawOutputSha256;
    rewriteRows(directory, rowsNow);
    const refusal = refusalFor(directory);
    expect(refusal).toMatch(/^not a benchmark run:/);
    expect(refusal).toContain('rawOutputSha256');
  });

  it('H: a malformed digest refuses before any file is opened', () => {
    for (const digest of [
      '',
      ' ',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      'sha256:' + 'a'.repeat(64),
      'z'.repeat(64),
      'a'.repeat(32) + ' ' + 'a'.repeat(31),
      'not a digest',
    ]) {
      const directory = runDirectory(rows());
      const rowsNow = rowsOf(directory);
      rowsNow[0]!.rawOutputSha256 = digest;
      rewriteRows(directory, rowsNow);
      const refusal = refusalFor(directory);
      expect(refusal, `accepted ${JSON.stringify(digest)}`).toMatch(/^invalid run:/);
      expect(refusal).toContain('rawOutputSha256');
    }

    // And a digest of the wrong type is caught one boundary earlier.
    for (const digest of [null, 42, true, [], {}]) {
      const directory = runDirectory(rows());
      const rowsNow = rowsOf(directory);
      rowsNow[0]!.rawOutputSha256 = digest;
      rewriteRows(directory, rowsNow);
      expect(refusalFor(directory), `accepted ${JSON.stringify(digest)}`).toMatch(
        /^not a benchmark run:/,
      );
    }
  });

  it('I and J: a hostile raw path never becomes a file the reporter opens', () => {
    // Refused twice over: `validateRun` rejects the string, and the adapter
    // rejects it again before it touches the filesystem. Both are checked,
    // because a gate that only works because another gate ran first is not a
    // gate.
    const hostile = [
      'raw/../../outside.txt',
      '../../../etc/passwd',
      '/etc/passwd',
      'C:/Windows/System32/config',
      'D:\\Chronosaga\\elsewhere.txt',
      '\\\\server\\share\\evidence.txt',
      'raw' + String.fromCharCode(92) + 'ai_case_001.lite.1.txt',
      'raw/ai_case_001.lite.1.txt' + String.fromCharCode(0),
    ];

    for (const rawOutputPath of hostile) {
      const directory = runDirectory(rows());
      const rowsNow = rowsOf(directory);
      rowsNow[0]!.rawOutputPath = rawOutputPath;
      rewriteRows(directory, rowsNow);
      expect(refusalFor(directory), `accepted ${JSON.stringify(rawOutputPath)}`).toMatch(
        /^invalid run:/,
      );

      // The adapter's own answer, with the earlier gate skipped entirely.
      const run = { metadata: rustRun.metadata, generations: rowsNow } as unknown as Parameters<
        typeof rawEvidenceProblems
      >[1];
      const direct = rawEvidenceProblems(directory, run);
      expect(direct.length, `adapter accepted ${JSON.stringify(rawOutputPath)}`).toBeGreaterThan(0);
    }
  });

  it('I: a path that would escape by resolution is refused by the adapter itself', () => {
    // Belt and braces. The string rules already refuse this shape; what is
    // proven here is that the value actually opened is the one shown to be
    // inside the run, so a future change to the string rules cannot silently
    // widen what gets read.
    const directory = runDirectory(rows());
    const outside = join(dirname(directory), 'outside.txt');
    writeFileSync(outside, 'not evidence');
    temporary.push(outside);

    const rowsNow = rowsOf(directory);
    rowsNow[0]!.rawOutputPath = 'raw/../../outside.txt';
    const run = { metadata: rustRun.metadata, generations: rowsNow } as unknown as Parameters<
      typeof rawEvidenceProblems
    >[1];
    const problems = rawEvidenceProblems(directory, run);
    expect(problems.length).toBeGreaterThan(0);
    // Refused for what it is, not for what happened when it was opened.
    expect(problems[0]).not.toMatch(/cannot be read/);
  });

  it('a directory standing where a raw file should be refuses', () => {
    const directory = runDirectory(rows());
    const path = rawPathOf(directory);
    unlinkSync(path);
    mkdirSync(path);
    expect(refusalFor(directory)).toMatch(/is not a regular file|cannot be read/);
  });

  it('K: a complete run travels with its directory, whatever the cwd', () => {
    // Evidence is run-directory-relative, not cwd-relative. A run handed over
    // on a memory stick must read the same as the one that produced it.
    const original = runDirectory(rows());
    const copy = mkdtempSync(join(tmpdir(), 'chronosaga-copy-'));
    temporary.push(copy);
    cpSync(original, copy, { recursive: true });

    const here = process.cwd();
    try {
      const fromRepository = JSON.stringify(reportOnRunDirectory(copy));
      process.chdir(tmpdir());
      const fromElsewhere = JSON.stringify(reportOnRunDirectory(copy));
      expect(fromElsewhere).toBe(fromRepository);
      // And the copy is judged exactly as the original was.
      expect(fromRepository.replace(copy, '<dir>')).toBe(
        JSON.stringify(reportOnRunDirectory(original)).replace(original, '<dir>'),
      );
    } finally {
      process.chdir(here);
    }

    // The raw gate is satisfied by the copy on its own merits.
    expect(refusalFor(copy)).not.toMatch(/raw evidence/);
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
