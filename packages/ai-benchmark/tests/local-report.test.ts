import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import { buildLocalOfficialComparison } from '../src/adapters/local-report.js';
import { suiteContentDigest } from '../src/report.js';
import { lockedArtifact } from '../src/model-lock.js';
import { lockedRuntime } from '../src/runtime-lock.js';
import { caseSubjectIds } from '../src/contract.js';
import type { BenchmarkGeneration, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';
import * as packageRoot from '../src/index.js';

/**
 * The trusted publication path.
 *
 * The binding itself was already right; what was wrong was which API a caller
 * reaches. `buildComparisonWithTrustedCheckout` takes the identity as an
 * argument, so a caller could hand it the run's own commit and satisfy the
 * binding without Git being consulted at all. These tests drive the *public*
 * entry point, which has no such argument, against real repositories on disk.
 */
const suite = loadSuite();
const temporary: string[] = [];

/**
 * A real Git repository with one commit, and its actual HEAD.
 *
 * `content` distinguishes repositories: a commit hash covers the tree, the
 * author and the timestamp, so two identical commits made within the same second
 * genuinely produce the same SHA. The first version of this helper did, and the
 * test that needs two different commits caught it.
 */
function repositoryWithOneCommit(content = 'export const version = 1;\n'): {
  root: string;
  head: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'chronosaga-report-'));
  temporary.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'evaluator.ts'), content);
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
  return { root, head: git('rev-parse', 'HEAD').trim() };
}

/** A directory that is not a repository at all. */
function plainDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'chronosaga-plain-'));
  temporary.push(root);
  return root;
}

afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true });
});

/** A complete official run recorded at `commit`. */
function officialRun(commit: string): BenchmarkRun {
  const template = structuredClone(rustRun) as unknown as BenchmarkRun;
  const generations: BenchmarkGeneration[] = [];
  for (const entry of suite.cases) {
    for (const profile of ['lite', 'standard'] as const) {
      generations.push({
        ...structuredClone(template.generations[0]!),
        id: `run:${entry.id}:${profile}:1`,
        caseId: entry.id,
        task: entry.task,
        profile,
        servedModel: profile,
        artifact: { ...lockedArtifact(profile)!, profileId: profile, source: 'user model library' },
        inputFingerprint: 'c'.repeat(64),
        rawOutputPath: `raw/${entry.id}.${profile}.1.txt`,
        normalizedOutput: {
          narration: 'Nulla di rilevante.',
          dialogue: (entry.constraints.requiredSpeakerIds ?? []).map(speakerId => ({
            speakerId,
            text: 'Ok.',
          })),
          toneTags: [],
          eventProposals: entry.constraints.requireEventProposal
            ? [{ subjectId: caseSubjectIds(entry)[0]!, topic: 't', rationale: 'r' }]
            : [],
          memorySuggestions: entry.constraints.requireMemorySuggestion
            ? [{ characterId: entry.characters[0]!.id, summary: 's' }]
            : [],
        },
      });
    }
  }
  return {
    metadata: {
      ...template.metadata,
      runKind: 'official_comparison',
      gitCommit: commit,
      gitDirty: false,
      suiteVersion: suite.suiteVersion,
      suiteSchemaVersion: suite.schemaVersion,
      suiteContentSha256: suiteContentDigest(suite),
      runtimeReleaseTag: lockedRuntime().releaseTag,
      runtimeExecutableSha256: lockedRuntime().executableSha256,
    },
    generations,
  };
}

describe('publishing an official comparison', () => {
  it('A and E: reads the actual HEAD, and a run recorded there passes', () => {
    const { root, head } = repositoryWithOneCommit();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const report = buildLocalOfficialComparison(
      suite,
      officialRun(head),
      ['lite', 'standard'],
      null,
      null,
      root,
    );
    expect(report.profiles).toHaveLength(2);
  });

  it('B, C and the forgery: there is no checkout argument to supply', () => {
    // The exact shape this round exists to make impossible. It does not
    // typecheck, and at runtime an extra argument is read as a repository path,
    // never as an identity — so the object cannot become trusted context.
    const { root, head } = repositoryWithOneCommit();
    const run = officialRun('f'.repeat(40));
    const forged = { gitCommit: run.metadata.gitCommit, gitDirty: false };

    // @ts-expect-error the official API accepts no checkout identity
    expect(() => buildLocalOfficialComparison(suite, run, ['lite', 'standard'], null, null, forged))
      .toThrow();

    // And the honest call against the same repository refuses too, because the
    // run was not produced there.
    expect(() =>
      buildLocalOfficialComparison(suite, run, ['lite', 'standard'], null, null, root),
    ).toThrow(/is being produced at/);
    expect(head).not.toBe(run.metadata.gitCommit);
  });

  it('D: evidence carrying a checkout object cannot become trusted context', () => {
    const { root, head } = repositoryWithOneCommit();
    const run = officialRun(head) as unknown as Record<string, unknown>;
    const spoof = { gitCommit: 'a'.repeat(40), gitDirty: false };
    (run.metadata as Record<string, unknown>).checkout = spoof;
    (run.metadata as Record<string, unknown>).trustedCheckout = spoof;
    (run as Record<string, unknown>).checkout = spoof;

    // The planted objects are ignored entirely: the report succeeds because the
    // *real* HEAD matches, not because the run said so.
    expect(
      buildLocalOfficialComparison(
        suite,
        run as unknown as BenchmarkRun,
        ['lite', 'standard'],
        null,
        null,
        root,
      ).profiles,
    ).toHaveLength(2);

    // Change only the recorded commit and it refuses, planted objects and all.
    (run.metadata as Record<string, unknown>).gitCommit = 'a'.repeat(40);
    expect(() =>
      buildLocalOfficialComparison(
        suite,
        run as unknown as BenchmarkRun,
        ['lite', 'standard'],
        null,
        null,
        root,
      ),
    ).toThrow(/is being produced at/);
  });

  it('F: a run from another commit is refused, locks notwithstanding', () => {
    const first = repositoryWithOneCommit('export const version = 1;\n');
    const second = repositoryWithOneCommit('export const version = 2;\n');
    expect(first.head).not.toBe(second.head);

    // Recorded at the first repository's commit, reported from the second.
    expect(() =>
      buildLocalOfficialComparison(
        suite,
        officialRun(first.head),
        ['lite', 'standard'],
        null,
        null,
        second.root,
      ),
    ).toThrow(/the locks may still match while the evaluator does not/);
  });

  it('G: an actually dirty checkout is refused', () => {
    const { root, head } = repositoryWithOneCommit();
    writeFileSync(join(root, 'evaluator.ts'), 'export const version = 2;\n');
    expect(() =>
      buildLocalOfficialComparison(suite, officialRun(head), ['lite', 'standard'], null, null, root),
    ).toThrow(/uncommitted changes/);
  });

  it('H: a directory that is not a repository is refused', () => {
    expect(() =>
      buildLocalOfficialComparison(
        suite,
        officialRun('a'.repeat(40)),
        ['lite', 'standard'],
        null,
        null,
        plainDirectory(),
      ),
    ).toThrow(/no trusted checkout identity/);
  });

  it('M, N, O, P and Q: every other binding still applies through this path', () => {
    const { root, head } = repositoryWithOneCommit();
    const cases: Array<[string, (run: BenchmarkRun) => void, RegExp]> = [
      ['suite', run => void (run.metadata.suiteContentSha256 = 'd'.repeat(64)), /different suite/],
      ['runtime', run => void (run.metadata.runtimeReleaseTag = 'b99999'), /runtime_provenance/],
      ['model', run => void (run.generations[0]!.artifact.sha256 = 'e'.repeat(64)), /unlocked artifacts/],
      [
        'structure',
        run => void ((run.generations[0] as unknown as Record<string, unknown>).latencyMs = '100'),
        /structurally invalid run/,
      ],
      ['profiles', run => void run.generations.splice(1, 1), /full_profile_case_coverage|missing/],
    ];
    for (const [label, breakIt, expected] of cases) {
      const run = officialRun(head);
      breakIt(run);
      expect(
        () => buildLocalOfficialComparison(suite, run, ['lite', 'standard'], null, null, root),
        label,
      ).toThrow(expected);
    }
  });
});

describe('the shape of the public surface', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));

  it('I: the forgeable primitive is not on the package entry point', () => {
    const index = readFileSync(join(root, 'index.ts'), 'utf8');
    expect(index).not.toContain('buildComparisonWithTrustedCheckout');
    expect(index).not.toContain("export * from './report.js'");
    // Nor is the identity type, since constructing one is the thing to prevent.
    expect(index).not.toContain("from './checkout.js'");
    // The renderer and the pure helpers remain available.
    expect(index).toContain('renderComparison');
    expect(index).toContain('officialEvidenceProblems');
  });

  it('J and K: only the adapters touch Git, and the root stays pure', () => {
    const offenders: string[] = [];
    const walk = (directory: string, relative: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const next = join(directory, entry.name);
        const label = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'adapters') walk(next, label);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (/from '(node:|child_process|fs|path)/.test(readFileSync(next, 'utf8'))) {
          offenders.push(label);
        }
      }
    };
    walk(root, '');
    expect(offenders).toEqual([]);

    // And exactly one adapter reaches for a process.
    const adapters = readdirSync(join(root, 'adapters'));
    const withGit = adapters.filter(name =>
      readFileSync(join(root, 'adapters', name), 'utf8').includes('node:child_process'),
    );
    expect(withGit).toEqual(['local-checkout.ts']);
  });

  it('the official entry point is reachable as its own subpath', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(manifest.exports['.']).toBe('./src/index.ts');
    expect(manifest.exports['./local-report']).toBe('./src/adapters/local-report.ts');

    // No wildcard: with an explicit exports map, a consumer cannot deep-import
    // '@paa/ai-benchmark/src/report.js' and reach the forgeable primitive that
    // way. Two doors, and only one of them publishes.
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './local-report']);
    expect(JSON.stringify(manifest.exports)).not.toContain('*');
  });

  it('nothing on the package root can produce a ComparisonReport', () => {
    // Attacked rather than assumed: every exported function called with a forged
    // identity in each argument position, looking for anything report-shaped.
    const forged = { gitCommit: 'a'.repeat(40), gitDirty: false };
    const produced: string[] = [];
    for (const [name, value] of Object.entries(packageRoot)) {
      if (typeof value !== 'function') continue;
      for (let position = 0; position < 7; position += 1) {
        const args = Array.from({ length: 7 }, (_, index) =>
          index === position ? forged : undefined,
        );
        try {
          const result = (value as (...rest: unknown[]) => unknown)(...args);
          if (result !== null && typeof result === 'object' && 'profiles' in result) {
            produced.push(`${name}(arg${position})`);
          }
        } catch {
          // Refusing is the expected outcome.
        }
      }
    }
    expect(produced).toEqual([]);
    expect(Object.keys(packageRoot).filter(name => /^build/i.test(name))).toEqual([]);
  });

  it('L: no network is involved', () => {
    // Imports and call expressions, not bare substrings: the file's own comment
    // says "No network", and a naive search matched its prose rather than its
    // code.
    const source = readFileSync(join(root, 'adapters', 'local-checkout.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]!);
    expect(imports).toEqual(['node:child_process', '../checkout.js']);
    for (const forbidden of [/fetch\s*\(/, /XMLHttpRequest/, /require\s*\(\s*'(net|https?|dns)'/]) {
      expect(forbidden.test(source), String(forbidden)).toBe(false);
    }
    expect(source).toContain("execFileSync('git'");
  });
});
