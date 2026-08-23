/**
 * Lite against Standard, on the same question.
 *
 * The comparison only means anything if both profiles saw exactly the same
 * cases, so that is checked rather than assumed: a report over mismatched case
 * sets refuses to be built.
 *
 * "The same question" is attempt 1, exactly. A retry repairs a model's own
 * rejected output and names that model's own validator errors, so attempt 2
 * differs between profiles that failed differently — deliberately, and by a
 * policy that is itself identical for both.
 */

import type { BenchmarkCase, BenchmarkSuite, BenchmarkTask } from './case.js';
import { sha256Hex } from './digest.js';
import { acceptedOutputContractProblems } from './contract.js';
import { lockedArtifactProblems } from './model-lock.js';
import { runtimeProvenanceMismatches } from './runtime-lock.js';
import { checkoutBindingProblems, type ReportCheckoutIdentity } from './checkout.js';
import {
  MAX_ATTEMPTS,
  OFFICIAL_COMPARISON_PROFILES,
  canonicalJson,
  validateRun,
  type BenchmarkGeneration,
  type BenchmarkProfile,
  type BenchmarkRun,
} from './result.js';
import { evaluateObjectively } from './objective.js';
import { HARD_FAIL_CATEGORIES, type HardFailCategory } from './hard-fail.js';
import {
  meanByAxis,
  scoresForProfile,
  validateScoreSheet,
  type ScoreAxis,
  type ScoreSheet,
} from './scoring.js';
import { asHardFails, validateHumanReview, type HumanReview } from './human-review.js';

export interface ProfileSummary {
  profile: BenchmarkProfile;
  artifactFilename: string;
  sha256: string;
  casesAttempted: number;
  /** A case counts as accepted if any attempt for it was accepted. */
  casesAccepted: number;
  acceptanceRate: number;
  firstAttemptAcceptanceRate: number;
  retries: number;
  fallbacks: number;
  medianLatencyMs: number | null;
  meanTokensPerSecond: number | null;
  deterministicFailures: number;
  heuristicWarnings: number;
  /** Cases disqualified by the deterministic evaluator. */
  machineHardFailedCases: number;
  /**
   * Cases a human reviewer disqualified, or `null` when nobody has reviewed.
   *
   * Never inferred from a low score, and never zero by default: an unreviewed
   * population has an unknown human hard-fail count, and reporting `0` for it
   * would be a claim about work that has not happened.
   */
  humanHardFailedCases: number | null;
  /**
   * Either kind, or `null` when the human half is unknown.
   *
   * "How many were unusable?" cannot be answered while half the question is
   * unanswered.
   */
  hardFailedCases: number | null;
  hardFailsByCategory: Record<HardFailCategory, number>;
  /** `null` until a complete review exists, for the same reason. */
  humanHardFailsByCategory: Record<HardFailCategory, number> | null;
  /** Heuristic findings queued for review, which disqualify nothing. */
  reviewSignals: number;
  acceptanceByTask: Record<string, { attempted: number; accepted: number }>;
  humanMeanByAxis: Record<ScoreAxis, number | null> | null;
}

export interface ComparisonReport {
  runId: string;
  suiteVersion: string;
  gitCommit: string;
  generatedAt: string;
  caseCount: number;
  profiles: ProfileSummary[];
  /** Cases where the two profiles disagreed on acceptance. */
  divergentCases: Array<{ caseId: string; task: BenchmarkTask; acceptedBy: BenchmarkProfile[] }>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The set of cases a profile was actually run against. */
export function caseIdsFor(run: BenchmarkRun, profile: BenchmarkProfile): Set<string> {
  return new Set(
    run.generations.filter(generation => generation.profile === profile).map(generation => generation.caseId),
  );
}

/**
 * The generation settings a Lite-versus-Standard quality comparison controls.
 *
 * Varying any of these between profiles measures the setting, not the model.
 * Context size is included deliberately: if P0.5-C later varies it on purpose,
 * that belongs in a separate matrix dimension rather than mixed into one
 * comparison, and this is what forces that conversation to happen.
 */
const CONTROLLED_SETTINGS = [
  'contextSize',
  'maxOutputTokens',
  'temperature',
  'topP',
  'seed',
  'reasoning',
] as const;

function controlledSignature(generation: BenchmarkGeneration): string {
  const context = generation.context as unknown as Record<string, unknown>;
  return CONTROLLED_SETTINGS.map(key => `${key}=${JSON.stringify(context[key] ?? null)}`).join(' ');
}

/**
 * Refuse to compare profiles whose runs were not actually comparable.
 *
 * Case ids alone are necessary and nowhere near sufficient. Four things are
 * checked, each of which has silently ruined somebody's benchmark before:
 *
 * 1. **Coverage** — both profiles saw every case.
 * 2. **A coherent attempt history** — every case a profile ran must start at
 *    attempt 1 and number its attempts contiguously. A retry only one profile
 *    needed is valid evidence; a retry with nothing before it is a broken
 *    record, and reading it as "one model needed a second try" would invert what
 *    actually happened.
 * 3. **Identical inputs, per attempt** — the recorded fingerprint matches for
 *    each `(case, attempt)` pair present for more than one profile. Comparing
 *    whole cases would be wrong, because a retry legitimately asks a different
 *    question. What may never differ is what the two profiles were asked *on the
 *    same attempt number*.
 * 4. **One artifact per profile** — a run that swapped models halfway measures
 *    neither of them.
 * 5. **Controlled settings** — the sampling and context were held equal where
 *    the comparison claims to hold them equal.
 *
 * Duplicate `(case, profile, attempt)` rows are rejected outright: two rows
 * claiming to be the same attempt make every count downstream ambiguous.
 *
 * Returns human-readable problems; empty means the comparison is fair.
 */
export function inputParityProblems(run: BenchmarkRun, profiles: BenchmarkProfile[]): string[] {
  const problems: string[] = [];

  // A retry is a second try at something that failed. An attempt after an
  // accepted one is not a retry, it is a second bite at an answer that already
  // worked — and counting both skews latency, quality means and retry totals
  // with generations the policy never permitted.
  problems.push(...attemptHistoryProblems(run, profiles));

  // Duplicates first: everything below counts rows, and a duplicated attempt
  // would quietly double one of those counts.
  const attemptKeys = new Set<string>();
  for (const generation of run.generations) {
    const key = `${generation.caseId}|${generation.profile}|${generation.attempt}`;
    if (attemptKeys.has(key)) {
      problems.push(
        `duplicate attempt recorded: ${generation.caseId} / ${generation.profile} / attempt ${generation.attempt}`,
      );
    }
    attemptKeys.add(key);
  }

  // 3 and 4 apply to a single profile too: a run that changed model or settings
  // mid-flight is incoherent even before anything is compared against it.
  for (const profile of profiles) {
    const generations = run.generations.filter(generation => generation.profile === profile);
    if (generations.length === 0) continue;

    const digests = new Set(generations.map(generation => generation.artifact.sha256));
    if (digests.size > 1) {
      problems.push(
        `${profile} mixed ${digests.size} artifact identities in one run: ${[...digests]
          .map(digest => digest.slice(0, 12))
          .sort()
          .join(', ')}`,
      );
    }

    const signatures = new Set(generations.map(controlledSignature));
    if (signatures.size > 1) {
      problems.push(`${profile} varied its controlled generation settings within one run`);
    }

    // Attempt histories, per case. This holds for a single profile too: a case
    // whose only row is attempt 2 is a broken record whatever it is compared
    // against, and a gap means a row was lost rather than never written.
    const attemptsByCase = new Map<string, Set<number>>();
    for (const generation of generations) {
      const bucket = attemptsByCase.get(generation.caseId) ?? new Set<number>();
      bucket.add(generation.attempt);
      attemptsByCase.set(generation.caseId, bucket);
    }
    for (const [caseId, attempts] of attemptsByCase) {
      if (!attempts.has(1)) {
        problems.push(
          `${caseId} has no attempt 1 for ${profile}: a retry cannot be the first thing recorded`,
        );
        continue;
      }
      const highest = Math.max(...attempts);
      const gaps = Array.from({ length: highest }, (_, index) => index + 1).filter(
        attempt => !attempts.has(attempt),
      );
      if (gaps.length > 0) {
        problems.push(
          `${caseId} for ${profile} records attempt ${highest} without attempt ${gaps.join(', ')}`,
        );
      }
    }
  }

  if (profiles.length < 2) return problems.sort();

  const sets = profiles.map(profile => caseIdsFor(run, profile));
  const union = new Set(sets.flatMap(set => [...set]));
  for (const caseId of union) {
    const missing = profiles.filter((_, index) => !sets[index]!.has(caseId));
    if (missing.length > 0) {
      problems.push(`${caseId} missing for ${missing.join(', ')}`);
      continue;
    }

    const rows = run.generations.filter(
      generation => generation.caseId === caseId && profiles.includes(generation.profile),
    );

    // Attempt 1 is the comparison. Every compared profile must have one, or
    // there is no common ground to compare on: one model's first try against
    // another model's second is not a measurement of either.
    const withoutFirst = profiles.filter(
      profile =>
        !rows.some(generation => generation.profile === profile && generation.attempt === 1),
    );
    if (withoutFirst.length > 0) {
      problems.push(`${caseId} has no attempt 1 for ${withoutFirst.join(', ')}`);
      continue;
    }

    // Attempt 1 is the comparison, and it must be the same question asked of
    // both. Attempt 2 is not: it repairs a model's *own* rejected output, so its
    // prompt names that model's own validator errors. Requiring identical retry
    // text across profiles would mean telling Lite to fix a mistake Standard
    // made, which is neither fair nor informative — and it is the retry policy,
    // not the retry wording, that has to be identical.
    //
    // Everything else about a retry stays checked: it may only follow a
    // rejection, it may not follow an acceptance, there is no attempt 3, and the
    // controlled generation settings still have to agree.
    const firstAttempts = rows.filter(generation => generation.attempt === 1);
    if (new Set(firstAttempts.map(generation => generation.profile)).size >= 2) {
      const fingerprints = new Set(firstAttempts.map(generation => generation.inputFingerprint));
      if (fingerprints.size > 1) {
        problems.push(
          `${caseId} attempt 1 was asked differently of each profile: ` +
            `${fingerprints.size} fingerprints`,
        );
      }
    }
  }

  // Across profiles, the controlled settings must also agree.
  const perProfile = profiles
    .map(profile => {
      const first = run.generations.find(generation => generation.profile === profile);
      return first ? controlledSignature(first) : null;
    })
    .filter((signature): signature is string => signature !== null);
  if (new Set(perProfile).size > 1) {
    problems.push('the profiles were run with different controlled generation settings');
  }

  return problems.sort();
}

/**
 * Whether a run contains anything a comparison could be built from.
 *
 * A structurally valid run with metadata and no rows passes every other check by
 * vacuous truth: both compared sets are empty, so nothing is missing, nothing
 * disagrees, and the report renders `caseCount: 0` with empty summaries. That is
 * not evidence of anything, and an interrupted or half-copied evidence directory
 * produces exactly that shape.
 *
 * Checked here rather than left to the Rust verdict: this is the boundary where
 * external JSON enters, and a boundary that trusts its input is not a boundary.
 * Full-suite coverage remains a separate question for official runs.
 */
export function comparableEvidenceProblems(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): string[] {
  if (run.generations.length === 0) {
    return [`run ${run.metadata.runId} contains no generations at all`];
  }

  const problems: string[] = [];
  for (const profile of profiles) {
    if (!run.generations.some(generation => generation.profile === profile)) {
      problems.push(`run ${run.metadata.runId} contains no generations for ${profile}`);
    }
  }
  if (problems.length > 0) return problems;

  // At least one case both profiles actually answered, or there is nothing to
  // set side by side however many rows exist.
  const shared = [...new Set(run.generations.map(generation => generation.caseId))].filter(caseId =>
    profiles.every(profile =>
      run.generations.some(
        generation => generation.caseId === caseId && generation.profile === profile,
      ),
    ),
  );
  if (shared.length === 0 && profiles.length > 1) {
    problems.push(
      `run ${run.metadata.runId} has no case answered by all of ${profiles.join(', ')}`,
    );
  }
  return problems;
}

/**
 * Whether these are the profiles an official comparison compares.
 *
 * The profile list was the caller's to choose, and every gate downstream took it
 * as given: `buildComparison(suite, run, ['lite'])` measured coverage against
 * Lite alone, found it complete, and published a full-suite Lite-only run as an
 * `official_comparison` that compared nothing. Duplicates were worse than
 * useless — `['lite', 'lite']` compares a profile with itself and renders two
 * identical columns as though they were evidence of a difference.
 *
 * Exactly one Lite and one Standard, from
 * {@link OFFICIAL_COMPARISON_PROFILES} rather than a list written out here.
 * Order is not the caller's concern either: the report is always Lite then
 * Standard, so two runs of the same evidence read the same way.
 */
export function officialProfileSetProblem(profiles: BenchmarkProfile[]): string | null {
  const expected = [...OFFICIAL_COMPARISON_PROFILES];
  if (profiles.length === 0) {
    return `an official comparison compares ${expected.join(' and ')}; no profiles were given`;
  }

  const counts = new Map<string, number>();
  for (const profile of profiles) {
    counts.set(profile, (counts.get(profile) ?? 0) + 1);
  }

  const unknown = [...counts.keys()].filter(
    profile => !expected.includes(profile as BenchmarkProfile),
  );
  if (unknown.length > 0) {
    return `'${unknown.join("', '")}' is not a benchmark profile; an official comparison compares ${expected.join(' and ')}`;
  }

  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicated.length > 0) {
    return `'${duplicated.join("', '")}' appears more than once; comparing a profile with itself is not a comparison`;
  }

  const absent = expected.filter(profile => !counts.has(profile));
  if (absent.length > 0) {
    return `an official comparison needs ${expected.join(' and ')}; '${absent.join("', '")}' ${absent.length === 1 ? 'is' : 'are'} absent, so nothing is being compared`;
  }

  return null;
}

/**
 * The requirements an official comparison must satisfy, by name.
 *
 * Mirrors `OFFICIAL_EVIDENCE_REQUIREMENTS` in the Rust runner and is asserted
 * equal to it by `tests/interop.test.ts`. The two sides cannot share an
 * implementation across the language boundary, so what they share is the list of
 * questions: neither can add or drop a requirement without failing a test on the
 * other. Each implements the check against the data it actually holds — Rust
 * against live coverage as it accumulates, this against the finished JSON.
 */
export const OFFICIAL_EVIDENCE_REQUIREMENTS = [
  'declared_official',
  'clean_checkout',
  'full_commit',
  'runtime_provenance',
  'host_facts',
  'suite_identity',
  'full_profile_case_coverage',
  'no_fallback_evidence',
  'complete_retry_history',
] as const;

export type OfficialEvidenceRequirement = (typeof OFFICIAL_EVIDENCE_REQUIREMENTS)[number];

export interface OfficialEvidenceProblem {
  requirement: OfficialEvidenceRequirement;
  message: string;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/**
 * Why this run may not be published as an official Lite-versus-Standard report.
 *
 * `comparableEvidenceProblems` asks whether there is anything here at all;
 * this asks whether it is the right thing. They are different questions, and a
 * dataset can pass the first while failing every part of the second: a smoke
 * pass over ten cases on a dirty checkout is structurally impeccable and
 * supports no decision whatsoever.
 *
 * The dangerous case is not a report that fails — it is a report that succeeds
 * and looks exactly like the official one. Rendering a partial run through the
 * same builder produces the same headings, the same table and the same verdict
 * line, with numbers drawn from a fraction of the suite. So this fails closed:
 * `buildComparison` is the official entry point, and a run that does not qualify
 * gets no report rather than a quieter one.
 */
export function officialEvidenceProblems(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): OfficialEvidenceProblem[] {
  const metadata = run.metadata;
  const problems: OfficialEvidenceProblem[] = [];
  const at = (requirement: OfficialEvidenceRequirement, message: string) =>
    problems.push({ requirement, message });

  // Declared purpose first, and alone: no amount of rigour turns a smoke pass
  // into the run that answers the question, so listing its other shortcomings
  // would only obscure the one that matters.
  if (metadata.runKind !== 'official_comparison') {
    return [
      {
        requirement: 'declared_official',
        message:
          `run ${metadata.runId} was recorded as a ${metadata.runKind} run, which is ` +
          'plumbing evidence and never comparable evidence, however complete its metadata is',
      },
    ];
  }

  if (metadata.gitDirty) {
    at('clean_checkout', 'the checkout was dirty, so nobody else can reproduce it');
  }
  if (!FULL_COMMIT.test(metadata.gitCommit)) {
    at('full_commit', `the commit '${metadata.gitCommit}' is not a full 40-character SHA`);
  }
  if (metadata.runtimeReleaseTag.trim() === '') {
    at('runtime_provenance', 'the runtime release tag is absent');
  }
  if (metadata.runtimeExecutableSha256 === null) {
    at('runtime_provenance', 'the runtime executable digest is absent');
  } else if (!/^[0-9a-f]{64}$/.test(metadata.runtimeExecutableSha256)) {
    at(
      'runtime_provenance',
      `the runtime digest '${metadata.runtimeExecutableSha256}' is not a SHA-256`,
    );
  }

  // Well-formed is not the same as right. A forged row can satisfy every format
  // rule above and still claim a runtime nobody in this repository locked, so
  // the values are compared against the committed distribution itself.
  for (const mismatch of runtimeProvenanceMismatches(metadata)) {
    at('runtime_provenance', mismatch);
  }
  if (
    metadata.host.cpu.trim() === '' ||
    metadata.host.logicalCores === 0 ||
    metadata.host.totalRamMb === 0
  ) {
    at('host_facts', 'the host facts are incomplete');
  }
  if (metadata.suiteVersion.trim() === '' || metadata.suiteSchemaVersion === 0) {
    at('suite_identity', 'the suite identity is incomplete');
  }

  // Coverage is every (profile, case) pair the supplied suite defines, derived
  // from the suite rather than from a count written down here: a suite that
  // grows raises the bar by itself, which a hardcoded 65 would not.
  //
  // Attempts collapse into pairs, so a retry adds a row and no coverage. A run
  // that answered ten cases twice each has still answered ten cases.
  //
  // A fallback row establishes nothing: if Standard fell back on a case, Standard
  // has no answer for that case, and letting the row count would let a profile
  // show full coverage built from another model's work.
  //
  // Nor does an unfinished history. A rejected first attempt is owed exactly one
  // retry, and until that retry exists the pair is an interrupted run, not a
  // model result — a whole suite of them would otherwise read as 130 complete
  // pairs in which both models failed everything.
  const answered = new Set(
    terminalGenerations(run, profiles).map(
      generation => `${generation.profile} ${generation.caseId}`,
    ),
  );
  for (const profile of profiles) {
    const absent = suite.cases
      .map(entry => entry.id)
      .filter(caseId => !answered.has(`${profile} ${caseId}`));
    if (absent.length === 0) continue;
    if (absent.length === suite.cases.length) {
      at(
        'full_profile_case_coverage',
        `no generations at all for ${profile}, so there is nothing to compare`,
      );
      continue;
    }
    const shown = absent.slice(0, 5);
    at(
      'full_profile_case_coverage',
      `${profile} is missing ${absent.length} of ${suite.cases.length} suite cases ` +
        `(${shown.join(', ')}${absent.length > shown.length ? ', ...' : ''})`,
    );
  }

  // Fallback is a product virtue and a measurement defect. A row where Standard
  // asked and Lite answered is still grouped under `profile: 'standard'`, so its
  // output, acceptance, latency, retries and scores would all be reported as
  // Standard evidence for work Lite did — which is not a worse Standard result,
  // it is a result about another model wearing Standard's name.
  //
  // Refused rather than reattributed: moving the row to Lite would mean rewriting
  // its artifact identity, its coverage pair and its provenance, and inventing a
  // Lite generation that was never requested.
  for (const generation of run.generations) {
    if (!generation.fallbackUsed && generation.fallbackProfile === null) continue;
    at(
      'no_fallback_evidence',
      `${generation.id} fell back from ${generation.profile} to ` +
        `${generation.fallbackProfile ?? 'an unnamed profile'}, so it is evidence about ` +
        `${generation.fallbackProfile ?? 'another model'} recorded under ${generation.profile}`,
    );
  }

  // Said separately from coverage, because they are different facts: coverage
  // says this profile has no answer for that case, and this says why — the
  // model was asked, refused, and never got the retry the policy owes it.
  for (const history of unfinishedHistories(run, profiles)) {
    at(
      'complete_retry_history',
      `${history.caseId} for ${history.profile}: attempt 1 was rejected and no attempt 2 ` +
        'was recorded, so the retry evidence is missing and the history never finished',
    );
  }

  return problems;
}

/**
 * Every well-formedness problem in the judgement supplied for a run.
 *
 * Delegates to the validators that already own these rules rather than
 * restating them; this function's job is to run them against the run's real
 * generation ids and to render the results as readable lines. Invalid judgement
 * is refused, never quietly filtered: silently dropping a malformed score would
 * change a mean without telling anyone.
 */
export function judgementProblems(
  run: BenchmarkRun,
  sheet: ScoreSheet | null,
  review: HumanReview | null,
): string[] {
  const known = new Set(run.generations.map(generation => generation.id));
  const problems: string[] = [];

  const render = (what: string, entries: Array<{ generationId?: string; field: string; message: string }>) =>
    entries.map(entry =>
      entry.generationId
        ? `${what} ${entry.generationId} ${entry.field}: ${entry.message}`
        : `${what} ${entry.field}: ${entry.message}`,
    );

  if (sheet) problems.push(...render('score sheet', validateScoreSheet(sheet, known)));
  if (review) problems.push(...render('human review', validateHumanReview(review, known)));

  // The review schema gives a reviewer one verdict per generation and category;
  // the same person filing it twice would double a tally that is meant to count
  // disqualified cases.
  if (review) {
    const seen = new Set<string>();
    for (const fail of review.hardFails) {
      const key = `${fail.generationId}|${fail.category}|${fail.reviewedBy}`;
      if (seen.has(key)) {
        problems.push(
          `human review ${fail.generationId} category: '${fail.category}' recorded twice by ${fail.reviewedBy}`,
        );
      }
      seen.add(key);
    }
  }

  return problems;
}

/**
 * The exact content of a suite, as a digest.
 *
 * Canonicalised so that key order cannot change the answer, then hashed. Must
 * agree byte for byte with the Rust `suite_content_digest`, which is asserted by
 * a fixture rather than assumed: the two implementations are separate, so only a
 * shared expected value proves they compute the same thing.
 */
export function suiteContentDigest(suite: BenchmarkSuite): string {
  return sha256Hex(canonicalJson(suite));
}

/**
 * Whether the supplied suite is the suite the run was executed against.
 *
 * `taskMismatches` compares ids and task names, which stay stable across an
 * edit that changes what a case actually says. A stored run evaluated against a
 * revised `cases.v1.json` would then be scored on constraints and expected facts
 * it never saw, while the report still advertised the recorded suite version.
 *
 * The version and the schema are what the run wrote down; they have to match.
 */
export function suiteBindingProblems(suite: BenchmarkSuite, run: BenchmarkRun): string[] {
  const problems: string[] = [];
  if (suite.suiteVersion !== run.metadata.suiteVersion) {
    problems.push(
      `the run recorded suite version '${run.metadata.suiteVersion}' but the supplied suite is ` +
        `'${suite.suiteVersion}'`,
    );
  }
  if (suite.schemaVersion !== run.metadata.suiteSchemaVersion) {
    problems.push(
      `the run recorded suite schema ${run.metadata.suiteSchemaVersion} but the supplied suite is ` +
        `schema ${suite.schemaVersion}`,
    );
  }

  // The version and schema are labels somebody assigned; this is the file. An
  // expected fact, a constraint or a whole case can change while the version
  // stays put, and the run would then be scored against a suite it never saw
  // with the report still naming the version it recorded.
  const actual = suiteContentDigest(suite);
  if (run.metadata.suiteContentSha256 !== actual) {
    problems.push(
      `the run answered suite content ${run.metadata.suiteContentSha256 || '<absent>'} but the ` +
        `supplied suite hashes to ${actual}; same version, different contents`,
    );
  }
  return problems;
}

/**
 * Whether a supplied score sheet covers a population the profiles can be
 * compared across.
 *
 * `validateScoreSheet` asks whether each score is well formed; this asks whether
 * the set of scores means anything as a mean. It did not before: the report
 * averaged whatever subset a scorer happened to submit, so one hand-picked
 * excellent Lite generation and a handful of mediocre Standard ones produced two
 * numbers that looked directly comparable and were drawn from different
 * populations. That is a difference in sampling reported as a difference in
 * models, and it is the kind of number that decides which model ships.
 *
 * The population is one observation per `(profile, case)`: the **terminal**
 * generation, the one that carries the profile's answer after the fixed retry
 * policy. Scoring every row instead would weight a profile more heavily for
 * having needed its retry, which measures the retry budget rather than the
 * writing. An exhausted, rejected terminal attempt stays in the population — its
 * prose can still be judged, and its disqualification is recorded separately as
 * a hard fail rather than by removing it from the sample.
 *
 * Derived from the run's own histories, so a suite of any size is covered by the
 * same rule and nothing here counts to 65.
 *
 * A run with no score sheet keeps its optional behaviour: human means stay null,
 * and nothing is demanded of a scorer who has not started.
 */
export function scorePopulationProblems(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
  sheet: ScoreSheet | null,
): string[] {
  if (sheet === null) return [];

  const population = terminalGenerations(run, profiles);
  const expected = new Map(population.map(generation => [generation.id, generation]));
  const scored = new Set(sheet.scores.map(score => score.generationId));
  const problems: string[] = [];

  // Scores for rows outside the population, named for what they are rather than
  // as unknown ids: a superseded first attempt is a real generation, and
  // averaging it beside a terminal one mixes an abandoned answer with a final.
  const byId = new Map(run.generations.map(generation => [generation.id, generation]));
  for (const score of sheet.scores) {
    if (expected.has(score.generationId)) continue;
    const generation = byId.get(score.generationId);
    if (generation === undefined) continue; // validateScoreSheet owns unknown ids
    if (!profiles.includes(generation.profile)) {
      problems.push(`${score.generationId} is not part of this comparison`);
      continue;
    }
    problems.push(
      `${score.generationId} is attempt ${generation.attempt} of ${generation.caseId} for ` +
        `${generation.profile}, which is not the attempt that ended that history`,
    );
  }

  // Missing scores, grouped by profile so the gap is legible: "standard is
  // missing four" is actionable, "four generations are unscored" is not.
  for (const profile of profiles) {
    const absent = population
      .filter(generation => generation.profile === profile && !scored.has(generation.id))
      .map(generation => generation.caseId);
    if (absent.length === 0) continue;
    const shown = absent.slice(0, 5);
    problems.push(
      `${profile} has ${absent.length} of ${population.filter(g => g.profile === profile).length} ` +
        `terminal generations unscored (${shown.join(', ')}` +
        `${absent.length > shown.length ? ', ...' : ''})`,
    );
  }

  return problems;
}

/**
 * Whether a supplied human review covers a population its counts can describe.
 *
 * The mirror of {@link scorePopulationProblems}, for the other kind of human
 * judgement, and independent of it: scores complete with no review is a run with
 * human means and unknown hard-fail counts; a review complete with no scores is
 * the reverse. Neither implies the other, and both are legitimate.
 *
 * The population is the same one — the terminal generation of every
 * `(profile, case)` — taken from the same helper, so there is no second
 * retry-selection rule to drift. A partial review is refused rather than read as
 * "no findings" in the gaps: silence about a generation nobody opened is not
 * evidence that it was clean.
 */
export function reviewPopulationProblems(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
  review: HumanReview | null,
): string[] {
  if (review === null) return [];

  const population = terminalGenerations(run, profiles);
  const expected = new Set(population.map(generation => generation.id));
  const declared = new Set(review.reviewedGenerationIds ?? []);
  const byId = new Map(run.generations.map(generation => [generation.id, generation]));
  const problems: string[] = [];

  for (const id of declared) {
    if (expected.has(id)) continue;
    const generation = byId.get(id);
    if (generation === undefined) continue; // validateHumanReview owns unknown ids
    if (!profiles.includes(generation.profile)) {
      problems.push(`${id} is not part of this comparison`);
      continue;
    }
    problems.push(
      `${id} is attempt ${generation.attempt} of ${generation.caseId} for ` +
        `${generation.profile}, which is not the attempt that ended that history`,
    );
  }

  for (const profile of profiles) {
    const absent = population
      .filter(generation => generation.profile === profile && !declared.has(generation.id))
      .map(generation => generation.caseId);
    if (absent.length === 0) continue;
    const shown = absent.slice(0, 5);
    problems.push(
      `${profile} has ${absent.length} of ` +
        `${population.filter(entry => entry.profile === profile).length} terminal generations ` +
        `unreviewed (${shown.join(', ')}${absent.length > shown.length ? ', ...' : ''})`,
    );
  }

  return problems;
}

/**
 * Whether a score sheet or review actually belongs to the run being reported.
 *
 * Both structures already carry `runId` and `suiteVersion`; this makes those
 * fields load-bearing instead of decorative.
 */
export function attributionProblems(
  what: string,
  judgement: { runId: string; suiteVersion: string } | null,
  run: BenchmarkRun,
): string[] {
  if (judgement === null) return [];
  const problems: string[] = [];
  if (judgement.runId !== run.metadata.runId) {
    problems.push(
      `the ${what} was written for run '${judgement.runId}', not '${run.metadata.runId}'`,
    );
  }
  if (judgement.suiteVersion !== run.metadata.suiteVersion) {
    problems.push(
      `the ${what} scored suite '${judgement.suiteVersion}', not '${run.metadata.suiteVersion}'`,
    );
  }
  return problems;
}

/**
 * Whether each `(case, profile)` attempt history is a history a retry policy
 * could actually have produced.
 *
 * Contiguity and "attempt 1 exists" are necessary and not sufficient. The rule
 * that was missing: **attempt N > 1 requires attempt N-1 to have been
 * rejected**, and once an attempt is accepted the history for that case and
 * profile is over. `accepted 1 -> attempt 2` reads as a retry and is not one;
 * whatever produced it, the run is not describing what happened.
 *
 * Unilateral retries stay valid: this looks at one profile's history at a time
 * and never compares the two.
 */
/** Every attempt at one case by one profile, in attempt order. */
export interface AttemptHistory {
  caseId: string;
  profile: BenchmarkProfile;
  attempts: BenchmarkGeneration[];
}

/**
 * Group a run's rows into one history per `(profile, case)` pair.
 *
 * Fallback rows are left out: they were answered by another model, so they are
 * not attempts by this profile at this case in any sense that could complete.
 */
export function attemptHistories(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): AttemptHistory[] {
  const histories = new Map<string, AttemptHistory>();
  for (const generation of run.generations) {
    if (!profiles.includes(generation.profile)) continue;
    if (generation.fallbackUsed || generation.fallbackProfile !== null) continue;
    const key = `${generation.profile} ${generation.caseId}`;
    const history = histories.get(key) ?? {
      caseId: generation.caseId,
      profile: generation.profile,
      attempts: [],
    };
    history.attempts.push(generation);
    histories.set(key, history);
  }
  for (const history of histories.values()) {
    history.attempts.sort((a, b) => a.attempt - b.attempt);
  }
  return [...histories.values()];
}

/**
 * The attempt that ends a history, or `null` when the history has not ended.
 *
 * The retry policy is fixed and has exactly three finished shapes:
 *
 * ```text
 * attempt 1 accepted                    -> attempt 1 is terminal
 * attempt 1 rejected, attempt 2 accepted -> attempt 2 is terminal
 * attempt 1 rejected, attempt 2 rejected -> attempt 2 is terminal (exhausted)
 * ```
 *
 * A rejected first attempt with no second is none of them. It is not a model
 * result at all — it is a run that stopped before the model was finished being
 * asked, and the one retry the policy owes it was never taken. Reading it as a
 * completed failure counts an interruption as evidence about the model.
 *
 * `MAX_ATTEMPTS` is the single authority for the ceiling; nothing here restates
 * a retry count of its own.
 */
export function terminalGeneration(history: AttemptHistory): BenchmarkGeneration | null {
  const attempts = history.attempts;
  if (attempts.length === 0) return null;

  // Shapes that are invalid for other reasons are also not terminal: a history
  // that starts at attempt 2, skips one, repeats one or runs past the ceiling
  // has no trustworthy last attempt. Those get their own messages from
  // `attemptHistoryProblems`; this simply refuses to name a winner.
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.attempt !== index + 1) return null;
  }
  if (attempts.length > MAX_ATTEMPTS) return null;

  // A retry may only follow a rejection, so every attempt before the last must
  // have been rejected. An accepted attempt ends the history; anything after it
  // is a row the policy never permitted, and the pair has no honest answer.
  if (attempts.slice(0, -1).some(attempt => attempt.accepted)) return null;

  const last = attempts[attempts.length - 1]!;
  if (last.accepted) return last;
  // Rejected and the retry is spent: exhausted, and exhausted is an answer.
  if (attempts.length === MAX_ATTEMPTS) return last;
  // Rejected with the retry still owed: unfinished.
  return null;
}

/**
 * The one generation per `(profile, case)` that carries the profile's answer.
 *
 * Exactly one per completed pair, whatever it cost to get there. A profile that
 * needed its retry produced two rows and still gave one answer, and counting
 * both would weight it twice for having struggled.
 */
export function terminalGenerations(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): BenchmarkGeneration[] {
  return attemptHistories(run, profiles)
    .map(terminalGeneration)
    .filter((generation): generation is BenchmarkGeneration => generation !== null);
}

/** The `(profile, case)` pairs whose history stopped before the policy ended it. */
export function unfinishedHistories(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): AttemptHistory[] {
  return attemptHistories(run, profiles).filter(
    history =>
      terminalGeneration(history) === null &&
      // Only histories that are unfinished *as such*. A malformed one is
      // reported by the checks that own malformedness, and saying both would
      // blame an interruption for a defect.
      history.attempts.length === 1 &&
      history.attempts[0]!.attempt === 1 &&
      !history.attempts[0]!.accepted,
  );
}

export function attemptHistoryProblems(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): string[] {
  const problems: string[] = [];
  const histories = new Map<string, BenchmarkGeneration[]>();

  for (const generation of run.generations) {
    if (!profiles.includes(generation.profile)) continue;
    const key = `${generation.caseId}|${generation.profile}`;
    const bucket = histories.get(key) ?? [];
    bucket.push(generation);
    histories.set(key, bucket);
  }

  for (const [key, rows] of histories) {
    const [caseId, profile] = key.split('|');
    const ordered = [...rows].sort((a, b) => a.attempt - b.attempt);

    // The policy ceiling, read from the one place that owns it. A rejected
    // second attempt is an exhausted retry, not permission for a third: a case
    // that needed three tries was not asked the same question as one that
    // needed two, and comparing them measures the retry budget rather than the
    // models.
    const beyondPolicy = ordered.filter(generation => generation.attempt > MAX_ATTEMPTS);
    for (const generation of beyondPolicy) {
      problems.push(
        `${caseId} for ${profile}: attempt ${generation.attempt} exceeds the one-shot retry ` +
          `policy of at most ${MAX_ATTEMPTS} attempts`,
      );
    }

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (previous.attempt === current.attempt) continue; // duplicates reported elsewhere

      if (previous.accepted) {
        problems.push(
          `${caseId} for ${profile}: attempt ${current.attempt} follows an accepted ` +
            `attempt ${previous.attempt}; a retry must follow a rejection`,
        );
      }
    }

    // Belt and braces: nothing may come after the first acceptance, even if the
    // rows arrived out of order or with a gap already reported above.
    const accepted = ordered.find(generation => generation.accepted);
    if (accepted) {
      const later = ordered.filter(generation => generation.attempt > accepted.attempt);
      for (const generation of later) {
        const already = `attempt ${generation.attempt} follows an accepted attempt ${accepted.attempt}`;
        if (!problems.some(problem => problem.includes(already))) {
          problems.push(
            `${caseId} for ${profile}: ${already}; an accepted generation ends the history`,
          );
        }
      }
    }
  }

  return problems.sort();
}

/**
 * Every generation whose recorded task disagrees with the suite.
 *
 * A row that mislabels its own task quietly corrupts every per-task breakdown,
 * and nothing else would notice.
 */
export function taskMismatches(suite: BenchmarkSuite, run: BenchmarkRun): string[] {
  const cases = new Map(suite.cases.map(entry => [entry.id, entry]));
  const problems: string[] = [];
  for (const generation of run.generations) {
    const declared = cases.get(generation.caseId);
    if (!declared) {
      problems.push(`${generation.id} names case ${generation.caseId}, which the suite does not contain`);
      continue;
    }
    if (declared.task !== generation.task) {
      problems.push(
        `${generation.id} claims task '${generation.task}' but ${generation.caseId} is '${declared.task}'`,
      );
    }
  }
  return problems.sort();
}

function summarise(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profile: BenchmarkProfile,
  sheet: ScoreSheet | null,
  review: HumanReview | null,
): ProfileSummary {
  const cases = new Map<string, BenchmarkCase>(suite.cases.map(entry => [entry.id, entry]));
  const generations = run.generations.filter(generation => generation.profile === profile);

  const byCase = new Map<string, BenchmarkGeneration[]>();
  for (const generation of generations) {
    const bucket = byCase.get(generation.caseId) ?? [];
    bucket.push(generation);
    byCase.set(generation.caseId, bucket);
  }

  const hardFailsByCategory = Object.fromEntries(
    HARD_FAIL_CATEGORIES.map(category => [category, 0]),
  ) as Record<HardFailCategory, number>;
  const humanHardFailsByCategory = Object.fromEntries(
    HARD_FAIL_CATEGORIES.map(category => [category, 0]),
  ) as Record<HardFailCategory, number>;

  const acceptanceByTask: Record<string, { attempted: number; accepted: number }> = {};
  let deterministicFailures = 0;
  let heuristicWarnings = 0;
  let reviewSignals = 0;
  let machineHardFailedCases = 0;
  let humanHardFailedCases = 0;
  let hardFailedCases = 0;
  let firstAttemptAccepted = 0;

  for (const [caseId, attempts] of byCase) {
    const testCase = cases.get(caseId);
    if (!testCase) continue;

    const accepted = attempts.some(attempt => attempt.accepted);
    const bucket = (acceptanceByTask[testCase.task] ??= { attempted: 0, accepted: 0 });
    bucket.attempted += 1;
    if (accepted) bucket.accepted += 1;
    if (attempts.some(attempt => attempt.attempt === 1 && attempt.accepted)) firstAttemptAccepted += 1;

    let caseMachineHardFailed = false;
    let caseHumanHardFailed = false;
    for (const attempt of attempts) {
      const evaluation = evaluateObjectively(testCase, attempt);
      deterministicFailures += evaluation.deterministicFailures;
      heuristicWarnings += evaluation.heuristicWarnings;
      reviewSignals += evaluation.reviewSignals.length;
      for (const fail of evaluation.hardFails) {
        hardFailsByCategory[fail.category] += 1;
        caseMachineHardFailed = true;
      }
      for (const fail of review ? asHardFails(review, attempt.id) : []) {
        humanHardFailsByCategory[fail.category] += 1;
        caseHumanHardFailed = true;
      }
    }
    if (caseMachineHardFailed) machineHardFailedCases += 1;
    if (caseHumanHardFailed) humanHardFailedCases += 1;
    // A case is unusable if either kind of review disqualified it. Prose scores
    // never enter this count.
    if (caseMachineHardFailed || caseHumanHardFailed) hardFailedCases += 1;
  }

  // Machine evaluation always happens; human review may not have. Without it the
  // human counts are unknown rather than zero, and so is the combined total.
  const humanReviewed = review !== null;

  const casesAttempted = byCase.size;
  const casesAccepted = [...byCase.values()].filter(attempts => attempts.some(a => a.accepted)).length;
  const first = generations.find(generation => generation.artifact.profileId === profile);

  const humanMeanByAxis = sheet
    ? meanByAxis(
        scoresForProfile(
          sheet,
          new Map(run.generations.map(generation => [generation.id, generation.profile])),
          profile,
        ),
      )
    : null;

  return {
    profile,
    artifactFilename: first?.artifact.artifactFilename ?? '',
    sha256: first?.artifact.sha256 ?? '',
    casesAttempted,
    casesAccepted,
    acceptanceRate: casesAttempted === 0 ? 0 : casesAccepted / casesAttempted,
    firstAttemptAcceptanceRate: casesAttempted === 0 ? 0 : firstAttemptAccepted / casesAttempted,
    retries: generations.filter(generation => generation.retryUsed).length,
    fallbacks: generations.filter(generation => generation.fallbackUsed).length,
    medianLatencyMs: median(generations.map(generation => generation.latencyMs)),
    meanTokensPerSecond: mean(
      generations
        .map(generation => generation.tokensPerSecond)
        .filter((value): value is number => value !== null),
    ),
    deterministicFailures,
    heuristicWarnings,
    reviewSignals,
    machineHardFailedCases,
    humanHardFailedCases: humanReviewed ? humanHardFailedCases : null,
    hardFailedCases: humanReviewed ? hardFailedCases : null,
    hardFailsByCategory,
    humanHardFailsByCategory: humanReviewed ? humanHardFailsByCategory : null,
    acceptanceByTask,
    humanMeanByAxis,
  };
}

/**
 * Build the comparison, given a checkout identity somebody else established.
 *
 * **Not the way to publish an official comparison.** This is the pure core: it
 * takes the checkout as an argument, which means a caller can hand it
 * `{ gitCommit: run.metadata.gitCommit, gitDirty: false }` and satisfy the
 * binding without anybody having asked Git anything. That is fine for a unit
 * test, which needs to drive both sides of the boundary deterministically, and
 * useless as a guarantee.
 *
 * The guarantee lives in `adapters/local-report.ts`, whose
 * `buildLocalOfficialComparison` has no checkout parameter at all and reads the
 * real repository itself. This function is deliberately absent from the package
 * entry point so that the forgeable path is not the public one — reproducibility
 * should follow from the API a caller can reach, not from remembering which
 * helper to call.
 *
 * Throws when the profiles were not asked attempt 1 identically, because a
 * report that quietly compares different work is worse than no report.
 */
export function buildComparisonWithTrustedCheckout(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
  profiles: BenchmarkProfile[] = ['lite', 'standard'],
  sheet: ScoreSheet | null = null,
  review: HumanReview | null = null,
  /**
   * The checkout this report is being produced from, read from the repository.
   *
   * Defaults to `null`, which refuses: an official comparison that cannot say
   * which code interpreted the evidence is not reproducible, and the safe
   * default for a trust boundary is to have none until somebody supplies it.
   */
  checkout: ReportCheckoutIdentity | null = null,
): ComparisonReport {
  // Before anything at all: which profiles are being compared. Every gate below
  // takes this list as given — coverage, parity, evidence — so a wrong list does
  // not produce a wrong answer, it produces a confident answer to a different
  // question.
  const profileProblem = officialProfileSetProblem(profiles);
  if (profileProblem !== null) {
    throw new Error(`refusing to build an official comparison: ${profileProblem}`);
  }
  // Canonical order from here down, so the same evidence always reads the same
  // way whichever order the caller happened to pass.
  const compared: BenchmarkProfile[] = [...OFFICIAL_COMPARISON_PROFILES];

  // The authoritative structural check comes first, before parity, evaluation or
  // any aggregate. These runs are loaded from external JSON and `validateRun`
  // already owns every cross-field invariant: an accepted attempt 1 claiming
  // `retryUsed`, an attempt 2 denying it, an accepted generation with a null
  // output that would crash the evaluator outright. Re-stating those rules here
  // would give the project two definitions of a valid run and eventually two
  // different answers, so they stay where they live and this simply refuses.
  const structural = validateRun(run);
  if (structural.length > 0) {
    const shown = structural
      .slice(0, 5)
      .map(problem =>
        problem.generationId
          ? `${problem.generationId} ${problem.field}: ${problem.message}`
          : `${problem.field}: ${problem.message}`,
      );
    throw new Error(
      `refusing to report on a structurally invalid run: ${shown.join('; ')}` +
        (structural.length > shown.length ? `; and ${structural.length - shown.length} more` : ''),
    );
  }

  // Something to compare, before asking whether the comparison is fair.
  const evidence = comparableEvidenceProblems(run, compared);
  if (evidence.length > 0) {
    throw new Error(`no comparable evidence: ${evidence.join('; ')}`);
  }

  // Before anything is evaluated, summarised or aggregated: the suite in hand
  // must be the suite that was run. Everything below reads case constraints and
  // expected facts, and reading the wrong ones silently produces a report that
  // looks right.
  const binding = suiteBindingProblems(suite, run);
  if (binding.length > 0) {
    throw new Error(
      `refusing to evaluate a run against a different suite: ${binding.join('; ')}`,
    );
  }

  // The suite, the models and the runtime are all compared against *this*
  // checkout, so this checkout has to be the run's. Otherwise unchanged locks
  // and a changed evaluator publish commit A's numbers under commit B's
  // judgement.
  const provenance = checkoutBindingProblems(run, checkout);
  if (provenance.length > 0) {
    throw new Error(
      `refusing to report from a checkout that is not the run's: ${provenance.join('; ')}`,
    );
  }

  // With the exact suite established, every row claiming acceptance can be held
  // against its own case's contract. A row the application validator would have
  // rejected is not a bad answer to score; it is an accepted status that could
  // never have been recorded, and everything below would aggregate it as fact.
  const impossible = acceptedOutputContractProblems(suite, run);
  if (impossible.length > 0) {
    const shown = impossible.slice(0, 5);
    throw new Error(
      `refusing evidence the application validator could not have accepted: ${shown.join('; ')}` +
        (impossible.length > shown.length ? `; and ${impossible.length - shown.length} more` : ''),
    );
  }

  // And the profiles must be the artifacts the project locked. Parity proves a
  // profile used one artifact throughout; this proves it is the right one, so a
  // comparison cannot be one model against itself under two names.
  const artifacts = lockedArtifactProblems(run, compared);
  if (artifacts.length > 0) {
    throw new Error(`refusing evidence from unlocked artifacts: ${artifacts.join('; ')}`);
  }

  // Only now, with the suite proven to be the one that was run, can coverage be
  // measured against it. This is the gate that separates an official
  // Lite-versus-Standard report from a smoke pass rendered in the same shape.
  const official = officialEvidenceProblems(suite, run, compared);
  if (official.length > 0) {
    throw new Error(
      `refusing to publish run ${run.metadata.runId} as an official comparison: ` +
        official.map(problem => `${problem.requirement}: ${problem.message}`).join('; '),
    );
  }

  // Judgement from another run must never leak into this one. Generation ids are
  // stable and human-typeable, so an id alone is not proof of belonging: the run
  // and the suite version have to agree as well.
  const attribution = [
    ...attributionProblems('score sheet', sheet, run),
    ...attributionProblems('human review', review, run),
  ];
  if (attribution.length > 0) {
    throw new Error(`refusing judgement that belongs to another run: ${attribution.join('; ')}`);
  }

  // Attribution and well-formedness are separate invariants, and both are
  // required. A sheet can belong to this run and still be nonsense: a duplicate
  // entry skews a mean, an unknown generation id vanishes without trace, and an
  // invalid hard-fail category indexes a tally that was never initialised for
  // it, turning a disqualification into NaN. These structures arrive as external
  // JSON, so they are validated rather than trusted.
  const malformed = judgementProblems(run, sheet, review);
  if (malformed.length > 0) {
    throw new Error(`refusing malformed judgement: ${malformed.join('; ')}`);
  }

  // Well-formed scores can still be an incomparable sample. This is the last
  // judgement gate before any mean is taken.
  const population = scorePopulationProblems(run, compared, sheet);
  if (population.length > 0) {
    throw new Error(
      `refusing to average human scores over an incomparable population: ${population.join('; ')}`,
    );
  }

  // Independently: a review that covers part of the population cannot support a
  // hard-fail count, and the gaps must not be read as "nothing found".
  const reviewed = reviewPopulationProblems(run, compared, review);
  if (reviewed.length > 0) {
    throw new Error(
      `refusing to count human hard failures over an incomplete review: ${reviewed.join('; ')}`,
    );
  }

  const mismatches = taskMismatches(suite, run);
  if (mismatches.length > 0) {
    throw new Error(
      `the run mislabels the cases it claims to have run: ${mismatches.join('; ')}`,
    );
  }

  const parity = inputParityProblems(run, compared);
  if (parity.length > 0) {
    throw new Error(
      'profiles were not asked attempt 1 identically, so they cannot be compared: ' +
        parity.join('; '),
    );
  }

  const cases = new Map<string, BenchmarkCase>(suite.cases.map(entry => [entry.id, entry]));
  const divergentCases: ComparisonReport['divergentCases'] = [];
  const allCaseIds = new Set(run.generations.map(generation => generation.caseId));

  for (const caseId of [...allCaseIds].sort()) {
    const acceptedBy = compared.filter(profile =>
      run.generations.some(
        generation => generation.caseId === caseId && generation.profile === profile && generation.accepted,
      ),
    );
    if (acceptedBy.length > 0 && acceptedBy.length < compared.length) {
      const testCase = cases.get(caseId);
      if (testCase) divergentCases.push({ caseId, task: testCase.task, acceptedBy });
    }
  }

  return {
    runId: run.metadata.runId,
    suiteVersion: run.metadata.suiteVersion,
    gitCommit: run.metadata.gitCommit,
    generatedAt: new Date(0).toISOString(),
    caseCount: allCaseIds.size,
    profiles: compared.map(profile => summarise(suite, run, profile, sheet, review)),
    divergentCases,
  };
}

/** A compact text table, for pasting into a report or an issue. */
export function renderComparison(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(`run ${report.runId} | suite ${report.suiteVersion} | commit ${report.gitCommit}`);
  lines.push(`${report.caseCount} case(s)`);
  lines.push('');
  for (const profile of report.profiles) {
    lines.push(`${profile.profile.toUpperCase()}  ${profile.artifactFilename}`);
    lines.push(`  sha256                 ${profile.sha256.slice(0, 16)}...`);
    lines.push(`  accepted               ${profile.casesAccepted}/${profile.casesAttempted}`);
    lines.push(`  first-attempt accepted ${(profile.firstAttemptAcceptanceRate * 100).toFixed(0)}%`);
    lines.push(`  retries / fallbacks    ${profile.retries} / ${profile.fallbacks}`);
    lines.push(`  median latency         ${profile.medianLatencyMs ?? '—'} ms`);
    lines.push(`  mean tokens/s          ${profile.meanTokensPerSecond?.toFixed(1) ?? '—'}`);
    lines.push(
      `  hard-failed cases      ${profile.hardFailedCases ?? '—'} ` +
        `(machine ${profile.machineHardFailedCases}, human ` +
        `${profile.humanHardFailedCases ?? '— not reviewed'})`,
    );
    lines.push(`  review signals         ${profile.reviewSignals}`);
    lines.push('');
  }
  if (report.divergentCases.length > 0) {
    lines.push('cases where the profiles disagreed:');
    for (const divergent of report.divergentCases) {
      lines.push(`  ${divergent.caseId} (${divergent.task}) accepted by ${divergent.acceptedBy.join(', ')}`);
    }
  }
  return lines.join('\n');
}
