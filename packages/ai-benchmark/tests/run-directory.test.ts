import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import { loadRunDirectory } from '../src/adapters/run-directory.js';
import { structuralBenchmarkRunProblems, validateRun } from '../src/index.js';
import type { BenchmarkRun } from '../src/result.js';

/**
 * The path from evidence on disk back into the report.
 *
 * Runs are written outside Git as raw prose, so reading one is a file operation
 * and the boundary it feeds is the same one external JSON has always faced.
 */
const temporary: string[] = [];
afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

/** A run directory holding `rows` as JSONL. */
function runDirectory(rows: string[], metadata = JSON.stringify(rustRun.metadata)): string {
  const root = mkdtempSync(join(tmpdir(), 'chronosaga-dir-'));
  temporary.push(root);
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'metadata.json'), metadata);
  writeFileSync(join(root, 'generations.jsonl'), rows.join('\n') + '\n');
  return root;
}

const rows = () => rustRun.generations.map(generation => JSON.stringify(generation));

describe('loading a run from its directory', () => {
  it('reads what the runner wrote, and it passes the boundary', () => {
    const loaded = loadRunDirectory(runDirectory(rows()));
    expect(structuralBenchmarkRunProblems(loaded)).toEqual([]);
    expect(validateRun(loaded as BenchmarkRun)).toEqual([]);
  });

  it('a trailing newline is punctuation, not a missing row', () => {
    const loaded = loadRunDirectory(runDirectory(rows())) as { generations: unknown[] };
    expect(loaded.generations).toHaveLength(rustRun.generations.length);
  });

  it('24: a malformed line is named, never dropped or repaired', () => {
    // Dropping it would silently shrink the run; parsing around it would invent
    // a row nobody wrote. It arrives as the string it was, and the boundary says
    // which row is wrong.
    const broken = rows();
    broken.splice(1, 0, '{"caseId": "ai_case_002", trun');
    const loaded = loadRunDirectory(runDirectory(broken)) as { generations: unknown[] };

    expect(loaded.generations).toHaveLength(broken.length);
    expect(typeof loaded.generations[1]).toBe('string');

    const problems = structuralBenchmarkRunProblems(loaded);
    expect(problems.some(problem => problem.field === 'generations[1]')).toBe(true);
    expect(problems[0]!.message).toContain('must be an object');
  });

  it('malformed metadata is reported rather than thrown on', () => {
    const loaded = loadRunDirectory(runDirectory(rows(), '{ not json'));
    expect(() => structuralBenchmarkRunProblems(loaded)).not.toThrow();
    expect(structuralBenchmarkRunProblems(loaded).some(p => p.field === 'metadata')).toBe(true);
  });

  it('22: a partial run loads, and still cannot be published', () => {
    // Evidence from an interrupted run is worth keeping and reading; it is just
    // not a comparison. The structural boundary accepts it and the coverage
    // gates refuse it, which is the correct division.
    const partial = loadRunDirectory(runDirectory(rows().slice(0, 1)));
    expect(structuralBenchmarkRunProblems(partial)).toEqual([]);
    expect(validateRun(partial as BenchmarkRun)).toEqual([]);
    expect((partial as { generations: unknown[] }).generations).toHaveLength(1);
  });

  it('an absent directory is the absence of evidence, and says so', () => {
    expect(() => loadRunDirectory(join(tmpdir(), 'chronosaga-does-not-exist-8f2a'))).toThrow(
      /no run metadata at/,
    );

    const withoutRows = mkdtempSync(join(tmpdir(), 'chronosaga-dir-'));
    temporary.push(withoutRows);
    writeFileSync(join(withoutRows, 'metadata.json'), '{}');
    expect(() => loadRunDirectory(withoutRows)).toThrow(/no generations at/);
  });

  it('nothing is coerced on the way in', () => {
    // Whatever the file says, the loader hands on unchanged.
    const hostile = rows();
    hostile[0] = JSON.stringify({ ...rustRun.generations[0], latencyMs: '100', accepted: 'false' });
    const loaded = loadRunDirectory(runDirectory(hostile)) as { generations: Array<Record<string, unknown>> };
    expect(loaded.generations[0]!.latencyMs).toBe('100');
    expect(loaded.generations[0]!.accepted).toBe('false');
    expect(structuralBenchmarkRunProblems(loaded).map(problem => problem.field)).toEqual(
      expect.arrayContaining(['latencyMs', 'accepted']),
    );
  });
});
