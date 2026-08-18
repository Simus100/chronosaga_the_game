#!/usr/bin/env node
/**
 * Stage the verified local AI runtime for Windows packaging.
 *
 * Copies exactly the files the provenance lock declares as the packaging set —
 * `llama-server.exe` plus its DLLs — into a git-ignored staging directory that
 * Tauri bundles as a resource. The lock is the source of truth: the file list is
 * never written out by hand here.
 *
 * Refuses to stage anything unless `verify-local-ai-runtime.mjs` passes first,
 * so a corrupted or substituted payload can never reach an installer.
 *
 * Usage:
 *   CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga node scripts/stage-local-ai-runtime.mjs
 *
 * Exit codes:
 *   0  staging complete
 *   1  verification failed, or a required file could not be staged
 *   2  the script could not run at all
 */

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKSPACE_ENV = 'CHRONOSAGA_WORKSPACE_ROOT';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'config', 'local-ai-runtime.lock.json');
const verifierPath = path.join(repoRoot, 'scripts', 'verify-local-ai-runtime.mjs');
const stageRoot = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', '.runtime-stage');
const runtimeStage = path.join(stageRoot, 'local-ai-runtime');
const configStage = path.join(stageRoot, 'config');

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile()) total += (await stat(path.join(directory, entry.name))).size;
  }
  return total;
}

async function main() {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read the provenance lock at ${lockPath}: ${error.message}`);
    process.exit(2);
  }

  console.log('Staging the local AI runtime for packaging');
  console.log(`  runtime    ${lock.provider} ${lock.releaseTag} (${lock.platform}/${lock.variant})`);
  console.log('');

  // The gate. Nothing is copied unless the payload is provably the locked one.
  console.log('Running the integrity verifier first…');
  const verification = spawnSync(process.execPath, [verifierPath], {
    stdio: 'inherit',
    env: process.env,
  });
  if (verification.status !== 0) {
    console.error('');
    console.error('Verification failed, so nothing was staged and no installer can be built.');
    console.error('Fix the runtime payload and try again; do not stage by hand.');
    process.exit(1);
  }

  const workspaceRoot = process.env[WORKSPACE_ENV];
  if (!workspaceRoot) {
    console.error(`${WORKSPACE_ENV} is not set.`);
    process.exit(1);
  }
  const sourceDir = path.resolve(workspaceRoot, lock.externalPathRelativeToWorkspaceRoot);

  // Replace the previous staging wholesale, so a file dropped from the lock
  // cannot survive into the next installer.
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(runtimeStage, { recursive: true });
  await mkdir(configStage, { recursive: true });

  console.log('');
  console.log(`Copying the packaging set (${lock.packaging.requiredFileCount} files)`);
  let copied = 0;
  let dlls = 0;
  for (const required of lock.packaging.requiredFiles) {
    const from = path.join(sourceDir, required);
    const to = path.join(runtimeStage, required);
    try {
      await copyFile(from, to);
    } catch (error) {
      console.error(`  FAIL  ${required}: ${error.message}`);
      process.exit(1);
    }
    copied += 1;
    if (required.toLowerCase().endsWith('.dll')) dlls += 1;
  }
  console.log(`  ok    ${copied} files (${dlls} DLLs + ${lock.packaging.expectedExecutableName})`);

  // The lock travels with the product: the installed app reads it to find the
  // runtime, and it is the record of what was shipped.
  await copyFile(lockPath, path.join(configStage, 'local-ai-runtime.lock.json'));
  console.log('  ok    config/local-ai-runtime.lock.json');

  // MIT requires the licence to ship with the binaries.
  const licenseSource = path.resolve(workspaceRoot, lock.licenseCopyRelativeToWorkspaceRoot);
  const licenseName = path.basename(lock.licenseCopyRelativeToWorkspaceRoot);
  try {
    await copyFile(licenseSource, path.join(runtimeStage, licenseName));
  } catch (error) {
    console.error(`  FAIL  ${licenseName}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ok    ${licenseName} (${lock.license}, required for redistribution)`);

  const bytes = await directorySize(runtimeStage);
  console.log('');
  console.log(`Staged ${(bytes / 1024 / 1024).toFixed(1)} MB into ${path.relative(repoRoot, stageRoot)}`);
  console.log('Ready for: pnpm --dir apps/desktop tauri build --bundles nsis');
  process.exit(0);
}

main().catch((error) => {
  console.error(`Staging crashed: ${error.stack ?? error.message}`);
  process.exit(2);
});
