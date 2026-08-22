/**
 * The application contract, as the report boundary must be able to check it.
 *
 * `validateRun` proves a row is well formed and that its values are ones the
 * application validator could have produced *in principle*. It cannot ask
 * whether this row's output was acceptable **for its own case**, because it
 * never sees the suite. So an externally loaded row could claim `accepted: true`
 * while carrying a speaker the scene does not contain, a tone tag outside the
 * vocabulary, a proposal in a case that forbids proposals, or a narration over
 * the case's limit — every one of which `inference::validate` rejects.
 *
 * That row is not a bad model answer. It is an accepted status the real
 * validator would never have recorded, and a report built on it is describing a
 * run that could not have happened. The distinction that matters:
 *
 * - the application validator would have **rejected** it → impossible evidence,
 *   refuse the run;
 * - the application validator would have **accepted** it and the evaluator or a
 *   human then judged it poor → a benchmark result, keep it and score it.
 *
 * Everything here mirrors `apps/desktop/src-tauri/src/inference.rs::validate`
 * applied to `case_contract(case)`. Nothing here is a benchmark quality rule.
 */
import type { BenchmarkCase, BenchmarkSuite } from './case.js';
import type { BenchmarkRun, NormalizedOutput } from './result.js';
import { characterCount } from './objective.js';

/** Entity ids in this project: `mara_001`, `settlement_helios`, `faction_compact`. */
const ENTITY_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/**
 * Every id a proposal in this case may legitimately be about.
 *
 * The mirror of Rust `case_subject_ids`: the characters and what they belong to,
 * the authoritative delta's keys, and every id-shaped string or key visible
 * anywhere in the world-state slice. Deliberately narrower than the evaluator's
 * `knownEntityIds`, which also admits memory ids and pending-consequence ids —
 * those are grounded for their own checks and are not proposal subjects.
 */
export function caseSubjectIds(testCase: BenchmarkCase): string[] {
  const ids: string[] = [];
  const push = (value: string) => {
    if (value !== '' && !ids.includes(value)) ids.push(value);
  };

  for (const character of testCase.characters) {
    push(character.id);
    if (character.factionId) push(character.factionId);
    if (character.locationId) push(character.locationId);
  }
  for (const change of testCase.recentDelta.changes) {
    for (const part of change.key.split('.')) push(part);
  }

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (ENTITY_ID.test(value)) push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      // Keys in sorted order, matching the Rust map this mirrors. The set would
      // be the same either way, but the *order* is compared across languages,
      // and an order that depends on how a file happened to be written is not
      // something either side should be asserting about the other.
      for (const key of Object.keys(value).sort()) {
        if (ENTITY_ID.test(key)) push(key);
        walk((value as Record<string, unknown>)[key]);
      }
    }
  };
  walk(testCase.worldStateSlice);

  return ids;
}

/**
 * Why the application validator could not have accepted this output for this
 * case, or an empty list if it could have.
 *
 * Order and wording follow the Rust validator, so a reader comparing the two can
 * see they ask the same questions.
 */
export function caseContractProblems(
  testCase: BenchmarkCase,
  output: NormalizedOutput,
): string[] {
  const constraints = testCase.constraints;
  const problems: string[] = [];

  // Narration length, counted in Unicode scalar values because that is what the
  // Rust validator counts.
  const length = characterCount(output.narration);
  if (length > constraints.maxNarrationChars) {
    problems.push(
      `narration is ${length} characters, the contract allows ${constraints.maxNarrationChars}`,
    );
  }

  // A scene with nobody in it that produced dialogue has invented people; a
  // permitted speaker may stay silent, and a required one may not.
  for (const line of output.dialogue) {
    if (!constraints.knownSpeakerIds.includes(line.speakerId)) {
      problems.push(`unknown speaker: ${line.speakerId}`);
    }
  }
  for (const required of constraints.requiredSpeakerIds ?? []) {
    if (!output.dialogue.some(line => line.speakerId === required)) {
      problems.push(`required field missing or empty: dialogue from ${required}`);
    }
  }

  for (const tag of output.toneTags) {
    if (!constraints.allowedToneTags.includes(tag)) {
      problems.push(`unknown tone tag: ${tag}`);
    }
  }

  // Proposals: permission, then obligation, then grounding.
  if (!constraints.allowEventProposals && output.eventProposals.length > 0) {
    problems.push('event_proposals are not accepted by this contract');
  } else {
    const subjects = caseSubjectIds(testCase);
    for (const proposal of output.eventProposals) {
      if (subjects.length > 0 && !subjects.includes(proposal.subjectId)) {
        problems.push(
          `event proposal is about '${proposal.subjectId}', which the scene does not contain`,
        );
      }
    }
    if (constraints.requireEventProposal && output.eventProposals.length === 0) {
      problems.push('required field missing or empty: event_proposals');
    }
  }

  if (!constraints.allowMemorySuggestions && output.memorySuggestions.length > 0) {
    problems.push('memory_suggestions are not accepted by this contract');
  } else {
    const characters = testCase.characters.map(character => character.id);
    for (const suggestion of output.memorySuggestions) {
      if (!characters.includes(suggestion.characterId)) {
        problems.push(`unknown speaker: ${suggestion.characterId}`);
      }
    }
    if (constraints.requireMemorySuggestion && output.memorySuggestions.length === 0) {
      problems.push('required field missing or empty: memory_suggestions');
    }
  }

  return problems;
}

/**
 * Every accepted row in a run that its own case's contract could not have
 * accepted.
 *
 * Only accepted rows: a rejected one carries `normalizedOutput: null` and its
 * validator errors, and re-running the payload it never had would prove nothing.
 * One impossible row invalidates the run — it is not dropped, relabelled or
 * silently converted to a rejection, because a benchmark that edits its own
 * evidence to make it consistent is no longer evidence.
 */
export function acceptedOutputContractProblems(
  suite: BenchmarkSuite,
  run: BenchmarkRun,
): string[] {
  const cases = new Map(suite.cases.map(entry => [entry.id, entry]));
  const problems: string[] = [];

  for (const generation of run.generations) {
    if (!generation.accepted) continue;
    const testCase = cases.get(generation.caseId);
    if (testCase === undefined) continue; // taskMismatches owns a suite/run mismatch
    if (generation.normalizedOutput === null) continue; // validateRun owns this

    for (const problem of caseContractProblems(testCase, generation.normalizedOutput)) {
      problems.push(`${generation.id} is recorded as accepted but ${problem}`);
    }
  }

  return problems;
}
