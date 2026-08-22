/**
 * Binding a run's runtime provenance to the committed distribution.
 *
 * The official gate checked the *syntax* of `runtimeReleaseTag` and
 * `runtimeExecutableSha256` — non-empty, sixty-four lowercase hex — which any
 * forged row can satisfy. Syntax is not identity: evidence could claim it was
 * produced by a different llama.cpp build entirely and still qualify as
 * official.
 *
 * The authority is `config/local-ai-runtime.lock.json`, imported directly, the
 * same way the model lock is. No tag and no digest is copied into TypeScript.
 *
 * ## What this can and cannot prove
 *
 * It proves the run recorded the runtime **this checkout locks**. It cannot
 * prove anything about the lock as it stood at `metadata.gitCommit`: the report
 * has no Git history and is not going to acquire any — that would mean network
 * access, or reading objects at report time, for a question the evidence should
 * answer itself.
 *
 * So the binding fails closed by construction. Reporting on an old run from a
 * checkout whose lock has since moved is refused, because from the code in hand
 * there is no way to vouch for a runtime it no longer describes. Refusing to
 * publish is the honest outcome; publishing an official comparison whose runtime
 * provenance cannot be checked is not.
 *
 * The Rust runner remains the run-time authority: it verifies all 51
 * distribution files byte for byte before the sidecar starts. This is about
 * stored evidence loaded later, which nobody hashed.
 */
import lockDocument from '../../../config/local-ai-runtime.lock.json' with { type: 'json' };
import type { RunMetadata } from './result.js';

interface LockedRuntime {
  releaseTag: string;
  executableSha256: string;
}

const LOCK = lockDocument as unknown as LockedRuntime;

/** The runtime identity this checkout locks. */
export function lockedRuntime(): LockedRuntime {
  return { releaseTag: LOCK.releaseTag, executableSha256: LOCK.executableSha256 };
}

/**
 * Why a run's recorded runtime is not the locked one.
 *
 * Structural complaints stay with the official-evidence gate, which already
 * refuses an absent tag or a digest that is not a SHA-256; this answers the
 * separate question of whether the well-formed values are the right ones.
 */
export function runtimeProvenanceMismatches(metadata: RunMetadata): string[] {
  const locked = lockedRuntime();
  const problems: string[] = [];

  if (metadata.runtimeReleaseTag !== locked.releaseTag) {
    problems.push(
      `the run records runtime release '${metadata.runtimeReleaseTag}' but the committed lock ` +
        `is '${locked.releaseTag}'`,
    );
  }
  if (metadata.runtimeExecutableSha256 !== locked.executableSha256) {
    problems.push(
      `the run records executable ${metadata.runtimeExecutableSha256 ?? '<absent>'} but the ` +
        `committed lock is ${locked.executableSha256}`,
    );
  }

  return problems;
}
