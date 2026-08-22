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
 *
 * **The invariant that governs this file:** a heuristic check may raise a review
 * signal, and may never produce a machine hard fail on its own. Hard failures
 * disqualify a generation, and nothing that can misfire is allowed to do that
 * unaided. A model that says "l'acqua scende da 17" without naming 14 might be
 * wrong or might be mid-sentence; a human decides. Only conditions established
 * deterministically — an unrecoverable structured output after its retry, a
 * memory id the case never granted — become machine hard fails.
 */

import type { BenchmarkCase } from './case.js';
import type { BenchmarkGeneration, NormalizedOutput } from './result.js';
import type { HardFail, HardFailCategory } from './hard-fail.js';

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

/** Something a human should look at, raised by a check that can misfire. */
export interface ReviewSignal {
  checkId: string;
  detail: string;
  /** The hard-fail category this would be, if a human confirms it. */
  candidateCategory: HardFailCategory;
}

export interface ObjectiveEvaluation {
  generationId: string;
  caseId: string;
  checks: ObjectiveCheck[];
  /**
   * Machine-established disqualifications only, every one of them from a
   * deterministic check. Human reviewers add their own separately.
   */
  hardFails: HardFail[];
  /**
   * What a heuristic noticed. Never a disqualification: a queue for review.
   */
  reviewSignals: ReviewSignal[];
  deterministicFailures: number;
  heuristicWarnings: number;
}

/** Entity ids in this project look like `mara_001`, `settlement_helios`. */
const ENTITY_ID = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * Every piece of prose the model wrote, as one corpus for identifier checks.
 *
 * Proposals and memory suggestions are typed, and the application validator
 * grounds their typed parts: `subjectId` must be an entity the case put on the
 * table, `characterId` a character in the scene. Their *prose* was ungrounded —
 * a rationale reading "settlement_fake ha perso le riserve", or a summary saying
 * "ricorda mem_secret_999", carried an invented id past every deterministic
 * check while the typed fields stayed impeccable. Free text is where invention
 * hides, so all of it is examined, by the same detector, with nothing widened
 * and no check changing confidence.
 */
function collectText(output: NormalizedOutput): string {
  return [
    output.narration,
    ...output.dialogue.map(line => line.text),
    ...output.eventProposals.flatMap(proposal => [proposal.topic, proposal.rationale]),
    ...output.memorySuggestions.map(suggestion => suggestion.summary),
  ].join('\n');
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
): ObjectiveEvaluation {
  const checks: ObjectiveCheck[] = [];
  const hardFails: HardFail[] = [];
  const reviewSignals: ReviewSignal[] = [];
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
      reviewSignals,
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
      // A signal, not a verdict. Prose can legitimately mention only the old
      // number while describing a fall, and a machine cannot tell the difference
      // reliably. A human confirms this one.
      reviewSignals.push({
        checkId: `authoritative_value_current:${change.key}`,
        detail: `'${change.key}' moved ${before} -> ${after}, but the output names only ${before}`,
        candidateCategory: 'contradicts_state_delta',
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
  // Only a case that *required* a proposal may fail for not having one. A case
  // that merely permits one is telling the model "puoi", and marking it down for
  // declining would penalise obedience to the prompt it was given.
  if (constraints.requireEventProposal) {
    add(
      'event_proposal_present',
      validated.eventProposals.length > 0,
      'deterministic',
      validated.eventProposals.length > 0
        ? 'a proposal was offered, as the case required'
        : 'the case required a proposal and got none',
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
  if (constraints.requireMemorySuggestion) {
    add(
      'memory_suggestion_present',
      validated.memorySuggestions.length > 0,
      'deterministic',
      validated.memorySuggestions.length > 0
        ? 'a memory suggestion was offered, as the case required'
        : 'the case required a memory suggestion and got none',
    );
  }

  add(
    'narration_within_limit',
    validated.narration.length <= constraints.maxNarrationChars,
    'deterministic',
    `${validated.narration.length} of ${constraints.maxNarrationChars} characters`,
  );

  // Only speakers the task actually needs. Being permitted to speak is not an
  // obligation to speak, and marking a compliant answer down for a silent
  // bystander measures the case's wording rather than the model.
  const required = constraints.requiredSpeakerIds ?? [];
  if (required.length > 0) {
    const spoke = new Set(validated.dialogue.map(line => line.speakerId));
    const silent = required.filter(speaker => !spoke.has(speaker));
    add(
      'required_speakers_spoke',
      silent.length === 0,
      'deterministic',
      silent.length === 0
        ? 'every required speaker spoke'
        : `required but silent: ${silent.join(', ')}`,
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
    // Heavy repetition usually means unusable output, but "usually" is not
    // "always": a litany can be deliberate. Raised for review, never enforced.
    reviewSignals.push({
      checkId: 'repetition_within_bounds',
      detail: `${Math.round(repetition * 100)}% of sentences repeat verbatim`,
      candidateCategory: 'systematically_unusable',
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

  // A strict-JSON case asked for a bare object. The application validator
  // unwraps ```json fences by design, so an accepted generation can still have
  // violated the instruction — and would otherwise look perfectly compliant.
  // The check reads the observation recorded with the evidence rather than the
  // prose, so the report layer never touches the filesystem.
  if (constraints.strictJsonOnly) {
    const observed = generation.rawFormat;
    if (observed === undefined || observed === null) {
      // Fail closed. Missing evidence is not evidence of compliance.
      add(
        'raw_output_is_bare_json',
        false,
        'deterministic',
        'no raw-format evidence was recorded, so bare-JSON compliance is unknown',
      );
    } else {
      const detail = observed.bareJson
        ? 'raw output is a bare JSON object'
        : observed.codeFencePresent
          ? 'raw output was wrapped in a markdown code fence'
          : 'raw output carries text around the JSON object';
      add('raw_output_is_bare_json', observed.bareJson, 'deterministic', detail);
    }
  }

  return {
    generationId: generation.id,
    caseId: testCase.id,
    checks,
    hardFails,
    reviewSignals,
    deterministicFailures: checks.filter(check => !check.passed && check.confidence === 'deterministic').length,
    heuristicWarnings: checks.filter(check => !check.passed && check.confidence === 'heuristic').length,
  };
}
