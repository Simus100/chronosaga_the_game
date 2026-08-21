/**
 * The versioned P0.5 benchmark case suite.
 *
 * Cases live in `suite/cases.v1.json` rather than in TypeScript so that the
 * TypeScript evaluator and the Rust runner read the *same* bytes. Two copies of
 * 65 scenarios would drift within a week.
 *
 * Every case is grounded in the deterministic M1 fixture
 * (`createSystemicScenario`, seed 7419). The slices below are excerpts of that
 * WorldState; this package deliberately defines no second gameplay schema.
 */

import type { StateChange, StateDelta } from '@paa/game-types';

/** The kinds of generation the suite exercises. */
export type BenchmarkTask =
  | 'single_npc_dialogue'
  | 'two_character_conflict'
  | 'state_delta_narration'
  | 'memory_grounded_reaction'
  | 'faction_political_consequence'
  | 'resource_economic_consequence'
  | 'warfare_report'
  | 'location_description'
  | 'structured_event_proposal'
  | 'memory_suggestion'
  | 'constrained_json_repair'
  | 'delayed_consequence_grounding'
  | 'contradictory_but_resolvable';

export const BENCHMARK_TASKS: readonly BenchmarkTask[] = [
  'single_npc_dialogue',
  'two_character_conflict',
  'state_delta_narration',
  'memory_grounded_reaction',
  'faction_political_consequence',
  'resource_economic_consequence',
  'warfare_report',
  'location_description',
  'structured_event_proposal',
  'memory_suggestion',
  'constrained_json_repair',
  'delayed_consequence_grounding',
  'contradictory_but_resolvable',
] as const;

/** One character as the case presents them to the model. */
export interface BenchmarkCharacter {
  id: string;
  name: string;
  role: string;
  stress: number;
  morale: number;
  traits: string[];
  factionId?: string;
  locationId?: string;
}

/** A memory the case explicitly grants the scene. Anything else is invented. */
export interface BenchmarkMemory {
  id: string;
  summary: string;
  tags: string[];
  turn: number;
}

/**
 * One authoritative change, in the Game Core's own shape.
 *
 * Aliased rather than redefined: the benchmark must describe the same deltas the
 * simulation produces, or it is measuring a different game.
 */
export type BenchmarkChange = StateChange;

/** A turn's authoritative changes, in the Game Core's own shape. */
export type BenchmarkDelta = StateDelta;

/** What the generation is allowed to do. */
export interface BenchmarkConstraints {
  language: string;
  /**
   * Speakers the scene contains: who *may* speak.
   *
   * Any other speaker id is a contract failure. Being listed here is permission,
   * not obligation — a character can legitimately stay silent, and the prompt
   * only ever says the dialogue may use these ids.
   */
  knownSpeakerIds: string[];
  /**
   * Speakers whose dialogue the task actually needs: who *must* appear.
   *
   * A subset of {@link knownSpeakerIds}. Only these produce a deterministic
   * failure when absent. Treating every listed character as required penalised
   * answers that obeyed the prompt they were given, which is the same conflation
   * that {@link requireEventProposal} exists to undo.
   */
  requiredSpeakerIds?: string[];
  allowedToneTags: string[];
  maxNarrationChars: number;
  structuredOutput: boolean;
  /** Game Core numbers are read-only for the model, always. */
  authoritativeNumbersReadOnly: boolean;
  allowEventProposals?: boolean;
  /**
   * Whether the case *demands* a proposal rather than tolerating one.
   *
   * Permission and requirement are separate: the prompt tells the model "puoi"
   * for one and "devi" for the other, and only a requirement makes an empty
   * array a failure. Conflating them penalised models for obeying the
   * instruction they were actually given.
   */
  requireEventProposal?: boolean;
  allowMemorySuggestions?: boolean;
  /** Symmetric with {@link requireEventProposal}. */
  requireMemorySuggestion?: boolean;
  strictJsonOnly?: boolean;
  /** For repair cases: the malformed output the model must correct. */
  priorInvalidOutput?: string;
  /** Consequences that exist but may not have fired yet. */
  pendingConsequences?: Array<{
    id: string;
    triggerTurn: number;
    visibility: 'visible' | 'hidden';
    scope?: string;
    status?: string;
  }>;
}

export interface BenchmarkCase {
  id: string;
  task: BenchmarkTask;
  /** Why this case exists, in one line. Read by humans, not by the evaluator. */
  notes: string;
  worldStateSlice: Record<string, unknown>;
  characters: BenchmarkCharacter[];
  relevantMemories: BenchmarkMemory[];
  recentDelta: BenchmarkDelta;
  constraints: BenchmarkConstraints;
  /** Things a correct generation should reflect, in plain language. */
  expectedFacts: string[];
  /** Things a correct generation must never claim. */
  forbiddenClaims: string[];
}

export interface BenchmarkSuite {
  schemaVersion: 1;
  /** Bumped whenever cases change, so results stay attributable. */
  suiteVersion: string;
  status: string;
  scenario: {
    fixture: string;
    package: string;
    seed: number;
    note: string;
  };
  outputContract: {
    shape: string;
    owner: string;
    requiredFields: string[];
    note: string;
  };
  cases: BenchmarkCase[];
}

/** One thing wrong with a suite file. */
export interface SuiteProblem {
  caseId?: string;
  field: string;
  message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a suite file structurally.
 *
 * Returns every problem rather than throwing on the first, because a suite with
 * eight mistakes should be fixable in one pass.
 */
export function validateSuite(suite: BenchmarkSuite): SuiteProblem[] {
  const problems: SuiteProblem[] = [];

  if (suite.schemaVersion !== 1) {
    problems.push({ field: 'schemaVersion', message: 'only schema version 1 is understood' });
  }
  if (!isNonEmptyString(suite.suiteVersion)) {
    problems.push({ field: 'suiteVersion', message: 'a suite version is required to attribute results' });
  }

  const seen = new Set<string>();
  for (const testCase of suite.cases) {
    const at = (field: string, message: string) => problems.push({ caseId: testCase.id, field, message });

    if (!isNonEmptyString(testCase.id)) at('id', 'a case needs an id');
    if (seen.has(testCase.id)) at('id', 'duplicate case id');
    seen.add(testCase.id);

    if (!BENCHMARK_TASKS.includes(testCase.task)) at('task', `unknown task '${testCase.task}'`);
    if (!isNonEmptyString(testCase.notes)) at('notes', 'a case must say why it exists');

    if (testCase.expectedFacts.length === 0) at('expectedFacts', 'a case with nothing expected proves nothing');
    if (testCase.forbiddenClaims.length === 0) at('forbiddenClaims', 'a case with nothing forbidden proves nothing');

    const constraints = testCase.constraints;
    if (!isNonEmptyString(constraints.language)) at('constraints.language', 'language is required');
    if (constraints.maxNarrationChars <= 0) at('constraints.maxNarrationChars', 'must be positive');
    if (constraints.allowedToneTags.length === 0) at('constraints.allowedToneTags', 'the tone vocabulary cannot be empty');
    if (!constraints.authoritativeNumbersReadOnly) {
      at('constraints.authoritativeNumbersReadOnly', 'the model may never write Game Core numbers');
    }
    for (const speaker of constraints.requiredSpeakerIds ?? []) {
      if (!constraints.knownSpeakerIds.includes(speaker)) {
        at(
          'constraints.requiredSpeakerIds',
          `speaker '${speaker}' is required but not permitted to speak`,
        );
      }
    }
    if (constraints.requireEventProposal && !constraints.allowEventProposals) {
      at('constraints.requireEventProposal', 'a case cannot require what it does not permit');
    }
    if (constraints.requireMemorySuggestion && !constraints.allowMemorySuggestions) {
      at('constraints.requireMemorySuggestion', 'a case cannot require what it does not permit');
    }

    // Every character the case presents must be addressable, and every allowed
    // speaker must be present. A speaker the scene does not contain is exactly
    // the failure the application validator rejects.
    const present = new Set(testCase.characters.map(character => character.id));
    for (const speaker of constraints.knownSpeakerIds) {
      if (!present.has(speaker)) {
        at('constraints.knownSpeakerIds', `speaker '${speaker}' is not among the case characters`);
      }
    }

    const memoryIds = new Set<string>();
    for (const memory of testCase.relevantMemories) {
      if (memoryIds.has(memory.id)) at('relevantMemories', `duplicate memory id '${memory.id}'`);
      memoryIds.add(memory.id);
    }

    if (typeof testCase.recentDelta.turn !== 'number') at('recentDelta.turn', 'a turn is required');
  }

  return problems;
}

/** Cases grouped by task, for coverage checks and reporting. */
export function casesByTask(suite: BenchmarkSuite): Map<BenchmarkTask, BenchmarkCase[]> {
  const grouped = new Map<BenchmarkTask, BenchmarkCase[]>();
  for (const testCase of suite.cases) {
    const bucket = grouped.get(testCase.task) ?? [];
    bucket.push(testCase);
    grouped.set(testCase.task, bucket);
  }
  return grouped;
}
