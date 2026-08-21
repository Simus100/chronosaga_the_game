/**
 * The part of benchmark scoring a machine can actually settle.
 *
 * The line this module refuses to cross: it checks *structure, identity and
 * arithmetic*, never prose quality. Whether a scene is well written, in
 * character, or dramatically useful is a human judgement and is scored
 * separately in `scoring.ts`. Pretending otherwise would produce a number that
 * looks objective and is not.
 *
 * `expectedFacts` and `forbiddenClaims` are written in plain language on
 * purpose, so a human can read a case and understand it. They are therefore not
 * evaluated by string matching here; what *is* evaluated is derived from the
 * structured half of the case — the delta, the character ids, the memory ids and
 * the tone vocabulary — where the answer is not a matter of opinion.
 */

import type { BenchmarkCase } from './case.js';
import type { BenchmarkGeneration, NormalizedOutput } from './result.js';
import type { HardFail } from './hard-fail.js';

/**
 * How much weight a check carries.
 *
 * `deterministic` means the check cannot be wrong: the id is in the set or it is
 * not. `heuristic` means the check is a useful signal that can misfire, and must
 * never on its own condemn a generation.
 */
export type CheckConfidence = 'deterministic' | 'heuristic';

export interface ObjectiveCheck {
  id: string;
  passed: boolean;
  confidence: CheckConfidence;
  detail: string;
}

export interface ObjectiveEvaluation {
  generationId: string;
  caseId: string;
  checks: ObjectiveCheck[];
  /** Machine-established disqualifications only. Humans may add more later. */
  hardFails: HardFail[];
  deterministicFailures: number;
  heuristicWarnings: number;
}

/** Entity ids in this project look like `mara_001`, `settlement_helios`. */
const ENTITY_ID = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

function collectText(output: NormalizedOutput): string {
  return [output.narration, ...output.dialogue.map(line => line.text)].join('\n');
}

/** Every entity id the case legitimately puts on the table. */
function knownEntityIds(testCase: BenchmarkCase): Set<string> {
  const known = new Set<string>();
  for (const character of testCase.characters) {
    known.add(character.id);
    if (character.factionId) known.add(character.factionId);
    if (character.locationId) known.add(character.locationId);
  }
  for (const memory of testCase.relevantMemories) known.add(memory.id);
  for (const change of testCase.recentDelta.changes) {
    // Keys are often entity ids, sometimes dotted paths into one.
    for (const part of change.key.split('.')) known.add(part);
  }
  for (const consequence of testCase.constraints.pendingConsequences ?? []) {
    known.add(consequence.id);
  }
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value)) known.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(key)) known.add(key);
        walk(nested);
      }
    }
  };
  walk(testCase.worldStateSlice);
  return known;
}

/** Numbers as they would plausibly be written in prose. */
function mentionsNumber(text: string, value: number): boolean {
  const forms = new Set<string>();
  forms.add(String(value));
  if (!Number.isInteger(value)) {
    forms.add(value.toFixed(2));
    forms.add(String(value).replace('.', ','));
    forms.add(value.toFixed(2).replace('.', ','));
  }
  return [...forms].some(form => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The trailing guard rejects 14.5 and 145 but not "14." at the end of a
    // sentence, which is ordinary prose rather than a truncated decimal.
    return new RegExp(`(?<![\\d.,])${escaped}(?![.,]?\\d)`).test(text);
  });
}

/** Longest run of repeated consecutive sentences, as a crude staleness signal. */
function repeatedSentenceRatio(text: string): number {
  const sentences = text
    .split(/[.!?\n]+/)
    .map(sentence => sentence.trim().toLowerCase())
    .filter(sentence => sentence.length > 12);
  if (sentences.length < 3) return 0;
  const unique = new Set(sentences);
  return 1 - unique.size / sentences.length;
}

/**
 * Score one generation on everything decidable without judgement.
 *
 * A rejected generation is still evaluated: the reason it was rejected is
 * itself evidence, and an unrecoverable structured output is a hard fail rather
 * than a low score.
 */
export function evaluateObjectively(
  testCase: BenchmarkCase,
  generation: BenchmarkGeneration,
  rawOutput = '',
): ObjectiveEvaluation {
  const checks: ObjectiveCheck[] = [];
  const hardFails: HardFail[] = [];
  const constraints = testCase.constraints;

  const add = (id: string, passed: boolean, confidence: CheckConfidence, detail: string) =>
    checks.push({ id, passed, confidence, detail });

  const output = generation.normalizedOutput;

  // ---------------------------------------------------------------- schema
  add(
    'schema_valid',
    generation.accepted && output !== null,
    'deterministic',
    generation.accepted
      ? 'the application validator accepted this output'
      : `rejected: ${generation.validatorErrors.join('; ') || 'no reason recorded'}`,
  );

  if (!generation.accepted) {
    // A strict-JSON case that never produced usable structure, after its retry,
    // is unusable rather than merely weak.
    if (constraints.strictJsonOnly && generation.retryUsed) {
      hardFails.push({
        category: 'unrecoverable_structured_output',
        detail: `strict-JSON case still invalid after a retry: ${generation.validatorErrors.join('; ')}`,
        determinedBy: 'machine',
      });
    }
    return {
      generationId: generation.id,
      caseId: testCase.id,
      checks,
      hardFails,
      deterministicFailures: checks.filter(c => !c.passed && c.confidence === 'deterministic').length,
      heuristicWarnings: 0,
    };
  }

  const validated = output as NormalizedOutput;
  const text = collectText(validated);

  // ------------------------------------------------------------- identity
  const unknownSpeakers = validated.dialogue
    .map(line => line.speakerId)
    .filter(speaker => !constraints.knownSpeakerIds.includes(speaker));
  add(
    'speakers_known',
    unknownSpeakers.length === 0,
    'deterministic',
    unknownSpeakers.length === 0
      ? 'every speaker is one the scene contains'
      : `speakers not in the scene: ${unknownSpeakers.join(', ')}`,
  );

  const unknownTones = validated.toneTags.filter(tag => !constraints.allowedToneTags.includes(tag));
  add(
    'tone_tags_known',
    unknownTones.length === 0,
    'deterministic',
    unknownTones.length === 0 ? 'tone vocabulary respected' : `tags outside the vocabulary: ${unknownTones.join(', ')}`,
  );

  const known = knownEntityIds(testCase);
  const referenced = [...new Set(text.match(ENTITY_ID) ?? [])];
  const invented = referenced.filter(id => !known.has(id));
  add(
    'entity_references_exist',
    invented.length === 0,
    'deterministic',
    invented.length === 0 ? 'no invented entity ids' : `entity ids not in the case: ${invented.join(', ')}`,
  );

  // Speaking for a character the case did not supply is a memory/identity
  // failure even when the id itself is spelled correctly.
  const presentCharacters = new Set(testCase.characters.map(character => character.id));
  const foreignCharacterIds = referenced.filter(
    id => /_\d+$/.test(id) && !presentCharacters.has(id) && known.has(id),
  );
  add(
    'no_absent_character_claims',
    foreignCharacterIds.length === 0,
    'heuristic',
    foreignCharacterIds.length === 0
      ? 'no claims about characters outside the scene'
      : `mentions characters not present: ${foreignCharacterIds.join(', ')}`,
  );

  // -------------------------------------------------------------- memories
  const grantedMemories = new Set(testCase.relevantMemories.map(memory => memory.id));
  const memoryIdsInText = referenced.filter(id => id.startsWith('mem_'));
  const invalidMemories = memoryIdsInText.filter(id => !grantedMemories.has(id));
  add(
    'memory_attribution_valid',
    invalidMemories.length === 0,
    'deterministic',
    invalidMemories.length === 0
      ? 'no memory referenced that the case did not grant'
      : `memories not granted by the case: ${invalidMemories.join(', ')}`,
  );
  if (invalidMemories.length > 0) {
    hardFails.push({
      category: 'incompatible_memory_attribution',
      detail: `referenced memories absent from the case: ${invalidMemories.join(', ')}`,
      determinedBy: 'machine',
    });
  }

  // ------------------------------------------------- authoritative numbers
  //
  // The model may describe a change; it may not restate the superseded value as
  // if it still held. Stating the pre-delta number while never stating the
  // post-delta number is the detectable shape of that mistake. It is a
  // heuristic — prose can legitimately say "from 17 to 14" — so it warns rather
  // than condemns, and only the both-wrong case is escalated.
  for (const change of testCase.recentDelta.changes) {
    const before = change.before;
    const after = change.after;
    if (typeof before !== 'number' || typeof after !== 'number' || before === after) continue;

    const staleOnly = mentionsNumber(text, before) && !mentionsNumber(text, after);
    add(
      `authoritative_value_current:${change.key}`,
      !staleOnly,
      'heuristic',
      staleOnly
        ? `states the superseded value ${before} for '${change.key}' and never the current ${after}`
        : `no stale claim detected for '${change.key}'`,
    );
    if (staleOnly) {
      hardFails.push({
        category: 'contradicts_state_delta',
        detail: `'${change.key}' moved ${before} -> ${after}, but the output asserts ${before}`,
        determinedBy: 'machine',
      });
    }
  }

  // ------------------------------------------------------- shape contract
  const proposalsAllowed = constraints.allowEventProposals === true;
  add(
    'event_proposals_within_contract',
    proposalsAllowed || validated.eventProposals.length === 0,
    'deterministic',
    proposalsAllowed
      ? `${validated.eventProposals.length} proposal(s), permitted by this case`
      : validated.eventProposals.length === 0
        ? 'no proposals, as required'
        : `${validated.eventProposals.length} proposal(s) where none are permitted`,
  );
  if (proposalsAllowed) {
    add(
      'event_proposal_present',
      validated.eventProposals.length > 0,
      'deterministic',
      validated.eventProposals.length > 0 ? 'a proposal was offered' : 'the case asked for a proposal and got none',
    );
  }

  const memoriesAllowed = constraints.allowMemorySuggestions === true;
  add(
    'memory_suggestions_within_contract',
    memoriesAllowed || validated.memorySuggestions.length === 0,
    'deterministic',
    memoriesAllowed
      ? `${validated.memorySuggestions.length} suggestion(s), permitted by this case`
      : validated.memorySuggestions.length === 0
        ? 'no suggestions, as required'
        : `${validated.memorySuggestions.length} suggestion(s) where none are permitted`,
  );
  if (memoriesAllowed) {
    add(
      'memory_suggestion_present',
      validated.memorySuggestions.length > 0,
      'deterministic',
      validated.memorySuggestions.length > 0
        ? 'a memory suggestion was offered'
        : 'the case asked for a memory suggestion and got none',
    );
  }

  add(
    'narration_within_limit',
    validated.narration.length <= constraints.maxNarrationChars,
    'deterministic',
    `${validated.narration.length} of ${constraints.maxNarrationChars} characters`,
  );

  // A case that names speakers expects them to speak.
  if (constraints.knownSpeakerIds.length > 0) {
    const spoke = new Set(validated.dialogue.map(line => line.speakerId));
    const silent = constraints.knownSpeakerIds.filter(speaker => !spoke.has(speaker));
    add(
      'expected_speakers_spoke',
      silent.length === 0,
      'deterministic',
      silent.length === 0 ? 'every expected speaker spoke' : `silent: ${silent.join(', ')}`,
    );
  }

  // -------------------------------------------------------- repetition
  const repetition = repeatedSentenceRatio(text);
  add(
    'repetition_within_bounds',
    repetition < 0.34,
    'heuristic',
    `${Math.round(repetition * 100)}% of sentences are duplicates`,
  );
  if (repetition >= 0.5) {
    hardFails.push({
      category: 'systematically_unusable',
      detail: `${Math.round(repetition * 100)}% of sentences repeat verbatim`,
      determinedBy: 'machine',
    });
  }

  // ------------------------------------------------- retry / fallback rules
  add(
    'retry_only_after_rejection',
    !generation.retryUsed || generation.attempt > 1,
    'deterministic',
    generation.retryUsed ? `retry recorded on attempt ${generation.attempt}` : 'no retry',
  );
  add(
    'fallback_only_on_failure',
    !generation.fallbackUsed || generation.fallbackProfile !== null,
    'deterministic',
    generation.fallbackUsed ? `fell back to ${generation.fallbackProfile}` : 'no fallback',
  );

  // Raw output is referenced but not required to be loaded; when it is, an
  // accepted generation that wrapped its JSON in prose is still worth knowing.
  if (rawOutput.length > 0 && constraints.strictJsonOnly) {
    const clean = rawOutput.trim().startsWith('{') && rawOutput.trim().endsWith('}');
    add(
      'raw_output_is_bare_json',
      clean,
      'deterministic',
      clean ? 'raw output is a bare JSON object' : 'raw output carries text around the JSON object',
    );
  }

  return {
    generationId: generation.id,
    caseId: testCase.id,
    checks,
    hardFails,
    deterministicFailures: checks.filter(check => !check.passed && check.confidence === 'deterministic').length,
    heuristicWarnings: checks.filter(check => !check.passed && check.confidence === 'heuristic').length,
  };
}
