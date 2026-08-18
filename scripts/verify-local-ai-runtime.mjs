#!/usr/bin/env node
/**
 * Verify that the local AI runtime payload on THIS machine matches the
 * provenance lock committed to the repository.
 *
 * The lock records which llama.cpp release Chronosaga is pinned to; this script
 * is what proves the bytes on disk are still that release. `"verified": true`
 * inside the lock is historical evidence from the manual P0.3-B0 check, not a
 * gate: packaging must gate on this script exiting 0.
 *
 * Reads only. Never downloads, never repairs, never touches the payload.
 *
 * Usage:
 *   CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga node scripts/verify-local-ai-runtime.mjs
 *
 * Exit codes:
 *   0  every check passed
 *   1  at least one check failed
 *   2  the verifier could not run at all (no lock, unreadable lock)
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKSPACE_ENV = 'CHRONOSAGA_WORKSPACE_ROOT';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'config', 'local-ai-runtime.lock.json');

const failures = [];
let checked = 0;

const fail = (message) => failures.push(message);
const ok = (message) => console.log(`  ok    ${message}`);
const bad = (message) => {
  console.log(`  FAIL  ${message}`);
  fail(message);
};

/** Stream a file through SHA-256 so a 45 MB payload is not held in memory. */
async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Check one file exists and matches its expected digest, and optionally size.
 * Returns true when the file is intact.
 */
async function checkFile(label, filePath, expectedSha256, expectedSize) {
  checked += 1;
  const size = await fileSize(filePath);
  if (size === null) {
    bad(`${label}: missing at ${filePath}`);
    return false;
  }
  if (typeof expectedSize === 'number' && size !== expectedSize) {
    bad(`${label}: size ${size} does not match the locked ${expectedSize}`);
    return false;
  }
  const actual = await sha256(filePath);
  if (actual !== expectedSha256) {
    bad(`${label}: SHA-256 ${actual} does not match the locked ${expectedSha256}`);
    return false;
  }
  ok(`${label}`);
  return true;
}

async function main() {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read the provenance lock at ${lockPath}: ${error.message}`);
    process.exit(2);
  }

  console.log(`Local AI runtime verification`);
  console.log(`  provider   ${lock.provider} ${lock.releaseTag} (${lock.platform}/${lock.variant})`);
  console.log(`  upstream   ${lock.upstreamCommit}`);
  console.log(`  lock       ${path.relative(repoRoot, lockPath)}`);
  console.log('');

  const workspaceRoot = process.env[WORKSPACE_ENV];
  if (!workspaceRoot || workspaceRoot.trim() === '') {
    console.log(`  FAIL  ${WORKSPACE_ENV} is not set, so the external payload cannot be located`);
    console.log('');
    console.log(`Set it to the development workspace root, for example:`);
    console.log(`  ${WORKSPACE_ENV}=D:\Chronosaga`);
    process.exit(1);
  }
  const workspaceSize = await fileSize(workspaceRoot);
  if (workspaceSize !== null) {
    console.log(`  FAIL  ${WORKSPACE_ENV} points at a file, not a directory: ${workspaceRoot}`);
    process.exit(1);
  }
  ok(`${WORKSPACE_ENV} = ${workspaceRoot}`);

  const resolve = (relative) => path.resolve(workspaceRoot, relative);
  const runtimeDir = resolve(lock.externalPathRelativeToWorkspaceRoot);

  console.log('');
  console.log('Archive');
  await checkFile(
    lock.assetName,
    resolve(lock.archivePathRelativeToWorkspaceRoot),
    lock.archiveSha256,
    lock.archiveSizeBytes,
  );

  console.log('');
  console.log('License');
  await checkFile(
    `${lock.license} license`,
    resolve(lock.licenseCopyRelativeToWorkspaceRoot),
    lock.licenseSha256,
  );

  console.log('');
  console.log('Executable');
  const executable = path.join(runtimeDir, lock.expectedExecutableName);
  await checkFile(lock.expectedExecutableName, executable, lock.executableSha256);

  console.log('');
  console.log(`Distribution manifest (${lock.distributionFiles.length} files)`);
  let intact = 0;
  const damaged = [];
  for (const entry of lock.distributionFiles) {
    checked += 1;
    const filePath = path.join(runtimeDir, entry.path);
    const size = await fileSize(filePath);
    if (size === null) {
      damaged.push(`${entry.path} (missing)`);
      continue;
    }
    if (size !== entry.sizeBytes) {
      damaged.push(`${entry.path} (size ${size}, locked ${entry.sizeBytes})`);
      continue;
    }
    if ((await sha256(filePath)) !== entry.sha256) {
      damaged.push(`${entry.path} (SHA-256 mismatch)`);
      continue;
    }
    intact += 1;
  }
  if (damaged.length === 0) {
    ok(`all ${intact} files match the manifest`);
  } else {
    for (const item of damaged) bad(`distribution: ${item}`);
  }

  console.log('');
  console.log(`Packaging set (${lock.packaging.requiredFileCount} files, ${lock.packaging.requiredDllCount} DLLs)`);
  const missingRequired = [];
  let dllsPresent = 0;
  for (const required of lock.packaging.requiredFiles) {
    checked += 1;
    const filePath = path.join(runtimeDir, required);
    if ((await fileSize(filePath)) === null) {
      missingRequired.push(required);
      continue;
    }
    if (required.toLowerCase().endsWith('.dll')) dllsPresent += 1;
  }
  if (missingRequired.length > 0) {
    for (const item of missingRequired) bad(`packaging: required file missing: ${item}`);
  } else if (dllsPresent !== lock.packaging.requiredDllCount) {
    bad(`packaging: found ${dllsPresent} DLLs, the lock requires ${lock.packaging.requiredDllCount}`);
  } else {
    ok(`every required file is present (${dllsPresent} DLLs + ${lock.packaging.expectedExecutableName})`);
  }

  console.log('');
  if (failures.length > 0) {
    console.log(`FAILED: ${failures.length} problem(s) across ${checked} checks.`);
    console.log('The runtime payload does not match the lock. Do not package it.');
    console.log('Re-download the locked release rather than repairing files by hand.');
    process.exit(1);
  }

  console.log(`PASSED: ${checked} checks, ${lock.distributionFiles.length} files intact.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`Verifier crashed: ${error.stack ?? error.message}`);
  process.exit(2);
});
