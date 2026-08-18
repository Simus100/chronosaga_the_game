#!/usr/bin/env node
/**
 * Verify that the local AI model payloads on THIS machine match the provenance
 * lock committed to the repository.
 *
 * Sibling of `verify-local-ai-runtime.mjs`, same contract: the lock says which
 * model Chronosaga is pinned to, and this script proves the bytes on disk are
 * still that model. `"verified": true` inside the lock records the manual check
 * done when the candidate was chosen; only a passing run here proves the local
 * copy is intact.
 *
 * Reads only. Never downloads, never repairs, never touches the payload.
 *
 * Usage:
 *   CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga node scripts/verify-local-ai-models.mjs
 *   … --profile lite     verify a single profile
 *
 * Exit codes:
 *   0  every checked profile matches the lock
 *   1  at least one check failed, or the requested profile is unknown
 *   2  the verifier could not run at all (no lock, unreadable lock)
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKSPACE_ENV = 'CHRONOSAGA_WORKSPACE_ROOT';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'config', 'local-ai-models.lock.json');

/** Stream a file through SHA-256: a 1.28 GB model must not be held in memory. */
export async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether one profile's payload matches its lock entry.
 *
 * Pure apart from the injected `inspect`, so the decision table is unit-testable
 * without a 1.28 GB file on disk.
 *
 * `inspect(path)` resolves to `{ size, digest }`, or `null` when absent.
 */
export async function checkProfile(profile, workspaceRoot, inspect) {
  const problems = [];
  const directory = path.resolve(workspaceRoot, profile.externalPathRelativeToWorkspaceRoot);
  const artifact = path.join(directory, profile.artifactFilename);

  const found = await inspect(artifact);
  if (found === null) {
    problems.push(`${profile.artifactFilename} is missing at ${artifact}`);
    return { artifact, problems };
  }
  // Size first: it is free, and it fails fast on a truncated download.
  if (found.size !== profile.sizeBytes) {
    problems.push(
      `${profile.artifactFilename}: size ${found.size} does not match the locked ${profile.sizeBytes}`,
    );
  }
  if (found.digest !== profile.sha256) {
    problems.push(
      `${profile.artifactFilename}: SHA-256 ${found.digest} does not match the locked ${profile.sha256}`,
    );
  }
  return { artifact, problems };
}

/** Validate the shape of a lock entry before trusting any of its values. */
export function checkProfileShape(id, profile) {
  const problems = [];
  if (!profile) return [`profile '${id}' is not present in the lock`];
  if (profile.profileId !== id) {
    problems.push(`profile '${id}' declares profileId '${profile.profileId}'`);
  }
  for (const field of [
    'artifactFilename',
    'artifactRepository',
    'artifactRevision',
    'sha256',
    'license',
    'externalPathRelativeToWorkspaceRoot',
  ]) {
    if (!profile[field]) problems.push(`profile '${id}' is missing '${field}'`);
  }
  if (typeof profile.sizeBytes !== 'number' || profile.sizeBytes <= 0) {
    problems.push(`profile '${id}' has no usable sizeBytes`);
  }
  if (!/^[0-9a-f]{64}$/.test(profile.sha256 ?? '')) {
    problems.push(`profile '${id}' does not carry a full SHA-256 digest`);
  }
  return problems;
}

async function main() {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read the model lock at ${lockPath}: ${error.message}`);
    process.exit(2);
  }

  const requested = process.argv.includes('--profile')
    ? process.argv[process.argv.indexOf('--profile') + 1]
    : null;
  const ids = requested ? [requested] : Object.keys(lock.profiles ?? {});

  console.log('Local AI model verification');
  console.log(`  lock       ${path.relative(repoRoot, lockPath)}`);
  console.log(`  profiles   ${ids.join(', ') || '(none)'}`);
  console.log('');

  if (ids.length === 0) {
    console.error('The lock declares no profiles.');
    process.exit(1);
  }

  const workspaceRoot = process.env[WORKSPACE_ENV];
  if (!workspaceRoot || workspaceRoot.trim() === '') {
    console.log(`  FAIL  ${WORKSPACE_ENV} is not set, so the model payload cannot be located`);
    console.log('');
    console.log(`Set it to the development workspace root, for example:`);
    console.log(`  ${WORKSPACE_ENV}=D:\\Chronosaga`);
    process.exit(1);
  }
  console.log(`  ok    ${WORKSPACE_ENV} = ${workspaceRoot}`);

  const inspect = async (filePath) => {
    const size = await fileSize(filePath);
    if (size === null) return null;
    return { size, digest: await sha256(filePath) };
  };

  const failures = [];
  for (const id of ids) {
    const profile = lock.profiles?.[id];
    console.log('');
    console.log(`Profile ${id}`);

    const shape = checkProfileShape(id, profile);
    if (shape.length > 0) {
      for (const problem of shape) console.log(`  FAIL  ${problem}`);
      failures.push(...shape);
      continue;
    }

    console.log(
      `  ok    lock entry: ${profile.family} ${profile.quantization} (${profile.license}, ${profile.status})`,
    );
    if (profile.releaseApproved) {
      console.log('  note  this profile is marked release approved');
    } else {
      console.log('  note  benchmark candidate, not approved for release');
    }

    const { artifact, problems } = await checkProfile(profile, workspaceRoot, inspect);
    if (problems.length === 0) {
      console.log(`  ok    ${path.basename(artifact)} matches size and digest`);
    } else {
      for (const problem of problems) console.log(`  FAIL  ${problem}`);
      failures.push(...problems);
    }

    // The licence must travel with the weights.
    const licenseCopy = path.resolve(workspaceRoot, profile.licenseCopyRelativeToWorkspaceRoot ?? '');
    const licenseSize = profile.licenseCopyRelativeToWorkspaceRoot
      ? await fileSize(licenseCopy)
      : null;
    if (licenseSize === null) {
      const problem = `${profile.license} licence copy is missing at ${licenseCopy}`;
      console.log(`  FAIL  ${problem}`);
      failures.push(problem);
    } else if (profile.licenseSha256 && (await sha256(licenseCopy)) !== profile.licenseSha256) {
      const problem = `${profile.license} licence copy does not match the locked digest`;
      console.log(`  FAIL  ${problem}`);
      failures.push(problem);
    } else {
      console.log(`  ok    ${profile.license} licence copy present`);
    }
  }

  console.log('');
  if (failures.length > 0) {
    console.log(`FAILED: ${failures.length} problem(s).`);
    console.log('The model payload does not match the lock. Do not use or package it.');
    console.log('Re-download the locked artifact from its pinned revision; never substitute another file.');
    process.exit(1);
  }

  console.log(`PASSED: ${ids.length} profile(s) match the lock.`);
  process.exit(0);
}

// Only run when invoked directly, so the helpers above stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Verifier crashed: ${error.stack ?? error.message}`);
    process.exit(2);
  });
}
