/**
 * The human half of the benchmark.
 *
 * Ten axes, 0-5 each, exactly the list in
 * `docs/P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md` section 7. Scores live in
 * their own file keyed by generation id, so scoring never touches the recorded
 * evidence: a run can be re-scored, scored by two people, or left unscored, and
 * the model output is byte-identical throughout.
 *
 * Hard failures are not represented here. A disqualified generation still gets
 * whatever prose score it deserves, and the report shows both, because "well
 * written but broke an invariant" is information worth keeping.
 */

import type { BenchmarkProfile } from './result.js';

export type ScoreAxis =
  | 'italian_fluency'
  | 'grounding'
  | 'character_consistency'
  | 'memory_use'
  | 'instruction_adherence'
  | 'schema_compliance'
  | 'non_contradiction'
  | 'narrative_usefulness'
  | 'repetition_resistance'
  | 'latency_acceptability';

export const SCORE_AXES: readonly ScoreAxis[] = [
  'italian_fluency',
  'grounding',
  'character_consistency',
  'memory_use',
  'instruction_adherence',
  'schema_compliance',
  'non_contradiction',
  'narrative_usefulness',
  'repetition_resistance',
  'latency_acceptability',
] as const;

/** What each end of the 0-5 range means, so two scorers agree on the middle. */
export const SCORE_GUIDE: Record<ScoreAxis, { zero: string; five: string }> = {
  italian_fluency: {
    zero: 'not Italian, or unreadable',
    five: 'natural Italian a native speaker would not rewrite',
  },
  grounding: {
    zero: 'asserts things the case never supplied',
    five: 'every claim traces to the slice, the delta or the memories',
  },
  character_consistency: {
    zero: 'acts against the stated role and traits',
    five: 'unmistakably this character, given role, traits and stress',
  },
  memory_use: {
    zero: 'invents or misattributes memories',
    five: 'uses exactly the granted memories, and only where they help',
  },
  instruction_adherence: {
    zero: 'ignores the constraints it was given',
    five: 'follows every constraint without being told twice',
  },
  schema_compliance: {
    zero: 'unusable structure',
    five: 'exact contract shape on the first attempt',
  },
  non_contradiction: {
    zero: 'contradicts the delta or itself',
    five: 'internally consistent and consistent with authoritative state',
  },
  narrative_usefulness: {
    zero: 'says nothing a player could act on or care about',
    five: 'advances the scene and gives the player something to weigh',
  },
  repetition_resistance: {
    zero: 'loops, or reaches for the same stock phrases every time',
    five: 'fresh phrasing across the suite, no template smell',
  },
  latency_acceptability: {
    zero: 'unusable in an interactive turn',
    five: 'fast enough that the player never waits on it',
  },
};

export type Score = 0 | 1 | 2 | 3 | 4 | 5;

/** One human's scores for one generation. */
export interface HumanScore {
  generationId: string;
  scoredBy: string;
  scoredAt: string;
  scores: Record<ScoreAxis, Score>;
  /** Free text. The only place a scorer may add reasoning. */
  comment?: string;
}

export interface ScoreSheet {
  runId: string;
  suiteVersion: string;
  scores: HumanScore[];
}

export interface ScoreProblem {
  generationId?: string;
  field: string;
  message: string;
}

/**
 * Validate a score sheet against the run it claims to score.
 *
 * `knownGenerationIds` is passed in rather than read from disk so this stays a
 * pure function: scoring must never be able to reach the evidence.
 */
export function validateScoreSheet(sheet: ScoreSheet, knownGenerationIds: Set<string>): ScoreProblem[] {
  const problems: ScoreProblem[] = [];
  if (!sheet.runId) problems.push({ field: 'runId', message: 'a score sheet must name its run' });

  const seen = new Set<string>();
  for (const score of sheet.scores) {
    const at = (field: string, message: string) =>
      problems.push({ generationId: score.generationId, field, message });

    if (!knownGenerationIds.has(score.generationId)) {
      at('generationId', 'scores a generation that is not in the run');
    }
    if (seen.has(score.generationId)) at('generationId', 'scored twice by the same sheet');
    seen.add(score.generationId);

    if (!score.scoredBy) at('scoredBy', 'a score needs an author');

    for (const axis of SCORE_AXES) {
      const value = score.scores[axis];
      if (value === undefined) {
        at(`scores.${axis}`, 'missing axis');
        continue;
      }
      if (!Number.isInteger(value) || value < 0 || value > 5) {
        at(`scores.${axis}`, `must be an integer 0-5, got ${String(value)}`);
      }
    }
    for (const axis of Object.keys(score.scores)) {
      if (!SCORE_AXES.includes(axis as ScoreAxis)) {
        at(`scores.${axis}`, 'unknown axis');
      }
    }
  }
  return problems;
}

/** Mean per axis across a set of scores, or null where nothing was scored. */
export function meanByAxis(scores: HumanScore[]): Record<ScoreAxis, number | null> {
  const means = {} as Record<ScoreAxis, number | null>;
  for (const axis of SCORE_AXES) {
    const values = scores.map(score => score.scores[axis]).filter(value => value !== undefined);
    means[axis] = values.length === 0 ? null : values.reduce<number>((sum, value) => sum + value, 0) / values.length;
  }
  return means;
}

/** Scores belonging to the generations of one profile. */
export function scoresForProfile(
  sheet: ScoreSheet,
  generationProfiles: Map<string, BenchmarkProfile>,
  profile: BenchmarkProfile,
): HumanScore[] {
  return sheet.scores.filter(score => generationProfiles.get(score.generationId) === profile);
}
