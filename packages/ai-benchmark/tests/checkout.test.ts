import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rustRun from './fixtures/rust-run.json' with { type: 'json' };
import { checkoutBindingProblems, type ReportCheckoutIdentity } from '../src/checkout.js';
import { readLocalCheckout } from '../src/adapters/local-checkout.js';
import { buildComparison, suiteContentDigest } from '../src/report.js';
import { lockedArtifact } from '../src/model-lock.js';
import { caseSubjectIds } from '../src/contract.js';
import { lockedRuntime } from '../src/runtime-lock.js';
import type { BenchmarkGeneration, BenchmarkRun } from '../src/result.js';
import { loadSuite } from '../src/suite.js';

/**
 * The last link in the provenance chain: this checkout is the run's checkout.
 *
 * The suite digest, the model lock and the runtime lock are each compared
 * against the working tree, so they prove the tree describes the same suite,
 * bytes and runtime. None of them proves it is the same *code*, and a changed
 * evaluator with unchanged locks published one commit's numbers under another's
 * judgement.
 */
const suite = loadSuite();
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);

/** A complete official run at `commit`, from the real locks. */
function officialRun(commit: string): BenchmarkRun {
  const template = structuredClone(rustRun) as unknown as BenchmarkRun;
  const generations: BenchmarkGeneration[] = [];
  for (const entry of suite.cases) {
    for (const profile of ['lite', 'standard'] as const) {
      const locked = lockedArtifact(profile)!;
      generations.push({
        ...structuredClone(template.generations[0]!),
        id: `run:${entry.id}:${profile}:1`,
        caseId: entry.id,
        task: entry.task,
        profile,
        servedModel: profile,
        artifact: { ...locked, profileId: profile, source: 'user model library' },
        inputFingerprint: 'c'.repeat(64),
        rawOutputPath: `raw/${entry.id}.${profile}.1.txt`,
        normalizedOutput: {
          narration: 'Nulla di rilevante.',
          dialogue: (entry.constraints.requiredSpeakerIds ?? []).map(speakerId => ({
            speakerId,
            text: 'Ok.',
          })),
          toneTags: [],
          // The eight cases that demand a suggestion get a grounded one; the
          // rest get nothing, because permission is not obligation.
          eventProposals: entry.constraints.requireEventProposal
            ? [{ subjectId: caseSubjectIds(entry)[0]!, topic: 'conseguenza', rationale: 'motivo' }]
            : [],
          memorySuggestions: entry.constraints.requireMemorySuggestion
            ? [{ characterId: entry.characters[0]!.id, summary: 'cosa ricorda' }]
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

const clean = (commit: string): ReportCheckoutIdentity => ({ gitCommit: commit, gitDirty: false });

describe('a report is bound to the checkout that produced the run', () => {
  it('A: the run\'s own commit, on a clean tree, passes this gate', () => {
    const run = officialRun(COMMIT_A);
    expect(checkoutBindingProblems(run, clean(COMMIT_A))).toEqual([]);
    expect(() => buildComparison(suite, run, ['lite', 'standard'], null, null, clean(COMMIT_A)))
      .not.toThrow();
  });

  it('B and C: a different checkout is refused, locks notwithstanding', () => {
    // The exact gap: same suite digest, same model lock, same runtime lock —
    // and a different evaluator.
    const run = officialRun(COMMIT_A);
    expect(run.metadata.suiteContentSha256).toBe(suiteContentDigest(suite));
    expect(run.metadata.runtimeExecutableSha256).toBe(lockedRuntime().executableSha256);
    expect(run.generations[0]!.artifact.sha256).toBe(lockedArtifact('lite')!.sha256);

    const problems = checkoutBindingProblems(run, clean(COMMIT_B));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(COMMIT_A);
    expect(problems[0]).toContain(COMMIT_B);
    expect(problems[0]).toMatch(/the locks may still match while the evaluator does not/);
    expect(() => buildComparison(suite, run, ['lite', 'standard'], null, null, clean(COMMIT_B)))
      .toThrow(/refusing to report from a checkout that is not the run's/);
  });

  it('D: a dirty reporting checkout is refused', () => {
    const run = officialRun(COMMIT_A);
    const problems = checkoutBindingProblems(run, { gitCommit: COMMIT_A, gitDirty: true });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/uncommitted changes/);
    expect(() =>
      buildComparison(suite, run, ['lite', 'standard'], null, null, {
        gitCommit: COMMIT_A,
        gitDirty: true,
      }),
    ).toThrow(/uncommitted changes/);
  });

  it('E: no trusted identity at all is refused, and that is the default', () => {
    const run = officialRun(COMMIT_A);
    expect(checkoutBindingProblems(run, null)[0]).toMatch(/no trusted checkout identity/);
    // Omitting the argument entirely must not quietly succeed.
    expect(() => buildComparison(suite, run)).toThrow(/no trusted checkout identity/);
  });

  it('F: an undeterminable commit is refused, and distinguishably', () => {
    const run = officialRun(COMMIT_A);
    for (const gitCommit of ['', 'HEAD', 'not-a-sha', COMMIT_A.slice(0, 7)]) {
      const problems = checkoutBindingProblems(run, { gitCommit, gitDirty: false });
      expect(problems, gitCommit).toHaveLength(1);
      expect(problems[0], gitCommit).toMatch(/could not be determined/);
    }
  });

  it('an unestablished cleanliness flag is refused, not read as clean', () => {
    // Found by attacking this boundary rather than by reading it: truthiness
    // made an absent, 0 or null flag mean "clean", so a report could be produced
    // from a dirty tree by an identity that simply never said.
    const run = officialRun(COMMIT_A);
    for (const gitDirty of [undefined, 0, 1, null, 'false', 'true', {}, []]) {
      const identity = { gitCommit: COMMIT_A, gitDirty } as unknown as ReportCheckoutIdentity;
      const problems = checkoutBindingProblems(run, identity);
      expect(problems.length, JSON.stringify(gitDirty) ?? 'undefined').toBeGreaterThan(0);
      expect(() =>
        buildComparison(suite, run, ['lite', 'standard'], null, null, identity),
      ).toThrow(/refusing to report from a checkout that is not the run's/);
    }
    // And a real boolean still works both ways.
    expect(checkoutBindingProblems(run, { gitCommit: COMMIT_A, gitDirty: false })).toEqual([]);
    expect(checkoutBindingProblems(run, { gitCommit: COMMIT_A, gitDirty: true })).toHaveLength(1);
  });

  it('a commit that is not even a string is refused before the regex', () => {
    const run = officialRun(COMMIT_A);
    for (const gitCommit of [undefined, null, 42, {}, [COMMIT_A]]) {
      const identity = { gitCommit, gitDirty: false } as unknown as ReportCheckoutIdentity;
      expect(() => checkoutBindingProblems(run, identity), String(gitCommit)).not.toThrow();
      expect(checkoutBindingProblems(run, identity)[0]).toMatch(/could not be determined/);
    }
  });

  it('the four refusals say different things, because they mean different things', () => {
    const run = officialRun(COMMIT_A);
    const messages = [
      checkoutBindingProblems(run, null)[0],
      checkoutBindingProblems(run, { gitCommit: 'nope', gitDirty: false })[0],
      checkoutBindingProblems(run, { gitCommit: COMMIT_A, gitDirty: true })[0],
      checkoutBindingProblems(run, clean(COMMIT_B))[0],
    ];
    expect(new Set(messages).size).toBe(4);
  });

  it('G and L: evidence cannot supply or override the trusted identity', () => {
    // Editing the run's own commit changes which checkout may report on it, and
    // cannot make a foreign checkout acceptable.
    const run = officialRun(COMMIT_A);
    run.metadata.gitCommit = COMMIT_B;
    expect(checkoutBindingProblems(run, clean(COMMIT_B))).toEqual([]);
    expect(checkoutBindingProblems(run, clean(COMMIT_A))).toHaveLength(1);

    // And nothing inside the run can stand in for the checkout: the only path
    // to a passing report is an argument the caller obtained elsewhere.
    expect(() => buildComparison(suite, run)).toThrow(/no trusted checkout identity/);
    expect(
      buildComparison(suite, run, ['lite', 'standard'], null, null, clean(COMMIT_B)).profiles,
    ).toHaveLength(2);
  });

  it('H, I, J and K: the other bindings are unchanged', () => {
    const run = officialRun(COMMIT_A);
    const checkout = clean(COMMIT_A);

    const wrongSuite = structuredClone(run);
    wrongSuite.metadata.suiteContentSha256 = 'd'.repeat(64);
    expect(() =>
      buildComparison(suite, wrongSuite, ['lite', 'standard'], null, null, checkout),
    ).toThrow(/different suite/);

    const wrongRuntime = structuredClone(run);
    wrongRuntime.metadata.runtimeReleaseTag = 'b99999';
    expect(() =>
      buildComparison(suite, wrongRuntime, ['lite', 'standard'], null, null, checkout),
    ).toThrow(/runtime_provenance/);

    const wrongModel = structuredClone(run);
    wrongModel.generations[0]!.artifact.sha256 = 'e'.repeat(64);
    expect(() =>
      buildComparison(suite, wrongModel, ['lite', 'standard'], null, null, checkout),
    ).toThrow(/unlocked artifacts/);

    const malformed = structuredClone(run) as unknown as Record<string, unknown>;
    (malformed.generations as BenchmarkGeneration[])[0]!.latencyMs = '100' as never;
    expect(() =>
      buildComparison(suite, malformed as unknown as BenchmarkRun, ['lite', 'standard'], null, null, checkout),
    ).toThrow(/structurally invalid run/);
  });
});

describe('the trusted adapter', () => {
  it('M: reads the real repository, without a network', () => {
    // `fileURLToPath`, not `pathname.slice(1)`: on Windows a file URL's pathname
    // is `/D:/...` and dropping the slash is right, on Linux it is `/home/...`
    // and dropping it yields a relative path that does not exist. The first
    // version of this test passed here and failed in CI for exactly that.
    const checkout = readLocalCheckout(fileURLToPath(new URL('../../../', import.meta.url)));
    expect(checkout).not.toBeNull();
    expect(checkout!.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof checkout!.gitDirty).toBe('boolean');
  });

  it('returns null where there is no repository, rather than guessing', () => {
    // Not knowing must never read as a clean checkout at some commit.
    expect(readLocalCheckout('/definitely-not-a-repository-9f3a')).toBeNull();
  });

  it('N: the pure library holds no Git, process or filesystem concern', () => {
    // The trust boundary as a property of the tree: everything under src/ except
    // the adapters directory is free of host concerns, and the package entry
    // point does not re-export the adapter.
    const root = fileURLToPath(new URL('../src/', import.meta.url));
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
        const source = readFileSync(next, 'utf8');
        if (/from '(node:|child_process|fs|path)/.test(source)) offenders.push(label);
      }
    };
    walk(root, '');
    expect(offenders).toEqual([]);

    const index = readFileSync(join(root, 'index.ts'), 'utf8');
    expect(index).not.toContain('adapters');
  });
});
