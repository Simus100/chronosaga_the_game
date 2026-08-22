/**
 * The trusted reporting adapter: the one place that asks the repository who it
 * is.
 *
 * Deliberately outside the pure library and deliberately **not** re-exported
 * from `index.ts`. Everything under `src/` except this directory is free of
 * process, filesystem and Git concerns, and a test asserts that. Importing the
 * package gets you the reporting library; importing this gets you the local
 * environment, and the difference is the trust boundary.
 *
 * It establishes identity and decides nothing. What a commit mismatch *means*
 * belongs to `checkoutBindingProblems`, which is pure and testable without a
 * repository.
 *
 * No network. `git rev-parse` and `git status` read the working tree that is
 * already on disk.
 */
import { execFileSync } from 'node:child_process';
import type { ReportCheckoutIdentity } from '../checkout.js';

/**
 * The commit this checkout is on, and whether it has uncommitted changes, or
 * `null` when neither can be established.
 *
 * `null` rather than a guess: a report that cannot say which code produced it
 * must refuse, and inventing a commit to get past that would defeat the point.
 * The caller passes whatever this returns straight to the library, which treats
 * `null` as a refusal.
 *
 * @param repositoryRoot directory to ask about; defaults to the process's own.
 */
export function readLocalCheckout(repositoryRoot?: string): ReportCheckoutIdentity | null {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // No Git, no repository, or a detached environment: all the same answer.
      return null;
    }
  };

  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return null;

  const gitCommit = git(['rev-parse', 'HEAD']);
  if (gitCommit === null) return null;

  // `--porcelain` is empty exactly when the tree is clean. A failure here is not
  // cleanliness: it is not knowing, which must not read as clean.
  const status = git(['status', '--porcelain']);
  if (status === null) return null;

  return { gitCommit, gitDirty: status !== '' };
}
