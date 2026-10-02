/**
 * The identity of the build being played, stamped at build time.
 *
 * The commit SHA is the technical identity; the timestamp is metadata. Both
 * come from `vite.config.ts` (`GITHUB_SHA` / `GITHUB_REF_NAME` in CI, `git` on
 * a developer machine) and are presentation and telemetry only.
 */
export interface BuildInfo {
  readonly commit: string;
  readonly branch: string;
  readonly builtAt: string;
}

declare const __CHRONOSAGA_BUILD__: BuildInfo | undefined;

export const BUILD_INFO: BuildInfo =
  typeof __CHRONOSAGA_BUILD__ !== "undefined" ? __CHRONOSAGA_BUILD__ : { commit: "unknown", branch: "unknown", builtAt: "unknown" };
