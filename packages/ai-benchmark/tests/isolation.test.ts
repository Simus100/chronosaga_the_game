import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json' with { type: 'json' };
import { buildComparisonWithTrustedCheckout } from '../src/report.js';
import { evaluateObjectively } from '../src/objective.js';
import { loadSuite } from '../src/suite.js';
import type { BenchmarkGeneration, BenchmarkRun } from '../src/result.js';
import { suiteContentDigest } from '../src/report.js';
import { lockedRuntime } from '../src/runtime-lock.js';
import { lockedArtifact } from '../src/model-lock.js';

/**
 * `buildComparisonWithTrustedCheckout` with a checkout that matches the run being reported.
 *
 * Every existing test describes a report produced from the run's own commit,
 * which is the ordinary case. Deriving it from the run here simulates that
 * situation; it is not the production path, where the commit is read from the
 * repository. The tests that matter for this boundary build mismatches
 * explicitly.
 */
function reportedFromItsOwnCheckout(
  suiteUnderTest: Parameters<typeof buildComparisonWithTrustedCheckout>[0],
  run: Parameters<typeof buildComparisonWithTrustedCheckout>[1],
  profiles?: Parameters<typeof buildComparisonWithTrustedCheckout>[2],
  sheet?: Parameters<typeof buildComparisonWithTrustedCheckout>[3],
  review?: Parameters<typeof buildComparisonWithTrustedCheckout>[4],
) {
  return buildComparisonWithTrustedCheckout(suiteUnderTest, run, profiles, sheet, review, {
    gitCommit: run.metadata.gitCommit,
    gitDirty: false,
  });
}


/**
 * The benchmark reads the world; it never writes it.
 *
 * The strongest available proof at this boundary is twofold: the package cannot
 * reach a mutating module, and its functions do not modify the objects handed to
 * them. Both are checked, because either alone would be easy to defeat.
 */

/** Every `.ts` file under `root`, recursively. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Source with comments removed, so prose about a rule is not read as a breach. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The named imports a module takes from `module`. */
function importedFrom(text: string, module: string): string[] {
  const found = new RegExp(`import \{([^}]*)\} from '${module}'`).exec(text);
  return (found?.[1] ?? '').split(',').map(name => name.trim()).filter(Boolean);
}

const suite = loadSuite();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function generation(caseId: string): BenchmarkGeneration {
  const testCase = suite.cases.find(entry => entry.id === caseId)!;
  return {
    id: `run:${caseId}:lite:1`,
    runId: 'run',
    caseId,
    task: testCase.task,
    profile: 'lite',
    artifact: {
      profileId: 'lite',
      family: 'Qwen3-1.7B',
      quantization: 'Q4_K_M',
      artifactFilename: 'Qwen3-1.7B-Q4_K_M.gguf',
      sizeBytes: 1282439264,
      sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
      source: 'user model library',
      releaseApproved: false,
    },
    context: {
      contextSize: 4096,
      maxOutputTokens: 512,
      temperature: 0.7,
      topP: 0.95,
      seed: null,
      reasoning: 'off',
    },
    inputFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 1000,
    tokensGenerated: 100,
    tokensPerSecond: 12,
    servedModel: 'lite',
    rawOutputPath: `raw/${caseId}.lite.1.txt`,
    // Shape only: these fixtures have no files on disk, and the bytes are
    // the run-directory adapter's business. Two rows may legitimately share
    // a digest — two models can emit the same raw text.
    rawOutputSha256: '0'.repeat(64),
    rawFormat: { bareJson: true, codeFencePresent: false, wrapperTextPresent: false },
    normalizedOutput: {
      narration: 'Nulla di rilevante.',
      dialogue: testCase.constraints.knownSpeakerIds.map(speakerId => ({ speakerId, text: 'Ok.' })),
      toneTags: [testCase.constraints.allowedToneTags[0]!],
      eventProposals: testCase.constraints.allowEventProposals
        ? [{ subjectId: testCase.characters[0]?.id ?? 'settlement_helios', topic: 't', rationale: 'r' }]
        : [],
      memorySuggestions: testCase.constraints.allowMemorySuggestions
        ? [{ characterId: testCase.characters[0]?.id ?? 'mara_001', summary: 's' }]
        : [],
    },
  };
}

describe('benchmark isolation from authoritative state', () => {
  it('declares no dependency that can write game state', () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});

    // @paa/game-core owns createCampaign, runWorldTick and resolveChoice: the
    // functions that advance authoritative state. The benchmark must not be able
    // to call them even by accident.
    expect(dependencies).not.toContain('@paa/game-core');
    expect(dependencies).not.toContain('@paa/persistence-contracts');
    for (const dependency of dependencies) {
      expect(dependency.startsWith('@paa/')).toBe(true);
    }
  });

  it('never mutates the case it evaluates', () => {
    const testCase = deepFreeze(structuredClone(suite.cases[0]!));
    const record = deepFreeze(generation(testCase.id));
    expect(() => evaluateObjectively(testCase, record)).not.toThrow();
  });

  it('never mutates the suite while building a comparison', () => {
    const frozenSuite = deepFreeze(structuredClone(suite));
    const caseIds = frozenSuite.cases.map(entry => entry.id);
    const run: BenchmarkRun = deepFreeze({
      metadata: {
        runId: 'run',
        runKind: 'official_comparison',
        startedAt: '2026-08-21T00:00:00.000Z',
        gitCommit: '9599f38d846f29907286e53200f51a703af4f53c',
        gitDirty: false,
        suiteVersion: frozenSuite.suiteVersion,
        suiteSchemaVersion: 1,
        suiteContentSha256: suiteContentDigest(suite),
        runnerVersion: '0.1.0',
        runtimeReleaseTag: lockedRuntime().releaseTag,
        runtimeExecutableSha256: lockedRuntime().executableSha256,
        host: { os: 'Windows 11', arch: 'x86_64', cpu: 'i7', logicalCores: 24, totalRamMb: 65536 },
      },
      generations: caseIds.flatMap(caseId => [
        generation(caseId),
        { ...generation(caseId), id: `run:${caseId}:standard:1`, profile: 'standard' as const,
          servedModel: 'standard',
          // The Standard row carries Standard's locked artifact. It used to
          // carry Lite's with only profileId changed, which is precisely the
          // forged shape the locked-artifact gate exists to refuse.
          artifact: {
            ...generation(caseId).artifact,
            ...lockedArtifact('standard')!,
            profileId: 'standard' as const,
          } },
      ]),
    });

    expect(() => reportedFromItsOwnCheckout(frozenSuite, run)).not.toThrow();
  });

  it('32: the package reads the world and never writes anything', () => {
    // P0.5-B1 gave this package its first file access, so the claim needs
    // enforcing rather than asserting: `loadRunDirectory` reads a run
    // directory, and nothing here may create, modify or delete a file. A
    // benchmark that can write is a benchmark that can edit its own evidence.
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const writers = [
      'writeFile',
      'appendFile',
      'mkdir',
      'rmSync',
      'rmdir',
      'unlink',
      'createWriteStream',
      'copyFile',
      'renameSync',
      'ftruncate',
      'chmod',
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      // Comments explain the boundary and may name what is forbidden; only code
      // can breach it. Scanning the prose would flag the sentence that says a
      // number is not truncated.
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const writer of writers) {
        if (code.includes(writer)) offenders.push(`${basename(file)}: ${writer}`);
      }
    }
    expect(offenders).toEqual([]);

    // The one module that touches the filesystem imports exactly the reads it
    // needs, and nothing that could change a byte.
    const adapter = readFileSync(join(root, 'adapters/run-directory.ts'), 'utf8');
    expect(importedFrom(adapter, 'node:fs')).toEqual(['readFileSync', 'statSync']);
  });

  it('32: the only process it starts is a read-only git query', () => {
    // `local-checkout.ts` asks Git where it is and whether it is dirty, which
    // is how a report binds itself to the checkout that produced it. That is a
    // spawned process, so it is named here rather than left to a general rule:
    // one module, one binary, and only subcommands that report.
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const spawners = sourceFiles(root).filter(file =>
      stripComments(readFileSync(file, 'utf8')).includes('node:child_process'),
    );
    // `.map(basename)` would hand the array index to basename's `suffix`
    // parameter, which throws. Named explicitly.
    expect(spawners.map(file => basename(file))).toEqual(['local-checkout.ts']);

    const adapter = readFileSync(join(root, 'adapters/local-checkout.ts'), 'utf8');
    expect(importedFrom(adapter, 'node:child_process')).toEqual(['execFileSync']);

    const code = stripComments(adapter);
    // One binary, and it is never a shell.
    const invocations = [...code.matchAll(/execFileSync\(\s*'([^']+)'/g)].map(match => match[1]);
    expect(invocations).toEqual(['git']);
    expect(code).toContain("stdio: ['ignore', 'pipe', 'ignore']");
    expect(code).not.toContain('shell');
    expect(code).not.toContain('execSync');

    // And only subcommands that report. `checkout`, `reset`, `clean` and `push`
    // would each change the very thing the report is trying to describe.
    const subcommands = [...code.matchAll(/git\(\[\s*'([^']+)'/g)].map(match => match[1]);
    expect(subcommands.length).toBeGreaterThan(0);
    expect([...new Set(subcommands)].sort()).toEqual(['rev-parse', 'status']);
  });

  it('33: authoritative state is not reachable from here, by name or by type', () => {
    // The engine owns WorldState. This package has no import of it, no
    // reference to it, and no dependency that exports it — so benchmark code
    // cannot mutate a campaign even by mistake.
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const forbidden = ['WorldState', 'runWorldTick', 'resolveChoice', 'createCampaign', 'applyEvent'];

    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      // Comments may discuss the engine; code may not reach it.
      const code = stripComments(text);
      for (const name of forbidden) {
        if (code.includes(name)) offenders.push(`${basename(file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('produces the same evaluation whatever order cases are visited in', () => {
    const forwards = suite.cases.slice(0, 5).map(entry => evaluateObjectively(entry, generation(entry.id)));
    const backwards = suite.cases
      .slice(0, 5)
      .reverse()
      .map(entry => evaluateObjectively(entry, generation(entry.id)))
      .reverse();
    expect(backwards).toEqual(forwards);
  });
});
