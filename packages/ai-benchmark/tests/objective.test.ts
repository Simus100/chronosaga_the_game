import { describe, expect, it } from 'vitest';
import type { BenchmarkCase } from '../src/case.js';
import type { BenchmarkGeneration, NormalizedOutput } from '../src/result.js';
import { evaluateObjectively } from '../src/objective.js';
import { loadSuite } from '../src/suite.js';

const suite = loadSuite();

/** A case with one speaker and one numeric change, for focused assertions. */
function caseFixture(): BenchmarkCase {
  return {
    id: 'fixture_001',
    task: 'single_npc_dialogue',
    notes: 'fixture',
    worldStateSlice: { settlement: { id: 'settlement_helios', name: 'Helios Reach' } },
    characters: [
      {
        id: 'mara_001',
        name: 'Mara Senn',
        role: 'Quartermaster',
        stress: 31,
        morale: 69,
        traits: ['pragmatic'],
        factionId: 'faction_compact',
        locationId: 'settlement_helios',
      },
    ],
    relevantMemories: [
      { id: 'mem_mara_ration', summary: 'Ha firmato il razionamento.', tags: ['water'], turn: 2 },
    ],
    recentDelta: {
      turn: 3,
      source: 'world_tick',
      changes: [{ type: 'RESOURCE_DELTA', key: 'water', before: 17, after: 14 }],
    },
    constraints: {
      language: 'it',
      knownSpeakerIds: ['mara_001'],
      allowedToneTags: ['tense', 'grim'],
      maxNarrationChars: 300,
      structuredOutput: true,
      authoritativeNumbersReadOnly: true,
    },
    expectedFacts: ['water is 14'],
    forbiddenClaims: ['water is 17'],
  };
}

function output(over: Partial<NormalizedOutput> = {}): NormalizedOutput {
  return {
    narration: "La riserva d'acqua scende a 14 unita'.",
    dialogue: [{ speakerId: 'mara_001', text: 'Dobbiamo razionare.' }],
    toneTags: ['tense'],
    eventProposals: [],
    memorySuggestions: [],
    ...over,
  };
}

function generation(over: Partial<BenchmarkGeneration> = {}): BenchmarkGeneration {
  return {
    id: 'run:fixture_001:lite:1',
    runId: 'run',
    caseId: 'fixture_001',
    task: 'single_npc_dialogue',
    profile: 'lite',
    artifact: {
      profileId: 'lite',
      family: 'Qwen3-1.7B',
      quantization: 'Q4_K_M',
      artifactFilename: 'Qwen3-1.7B-Q4_K_M.gguf',
      sizeBytes: 1282439264,
      sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
      source: 'user model library',
      releaseApproved: false,
    },
    context: {
      contextSize: 4096,
      maxOutputTokens: 512,
      temperature: 0.7,
      topP: 0.95,
      seed: null,
      reasoning: 'off',
    },
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 8000,
    tokensGenerated: 120,
    tokensPerSecond: 15,
    rawOutputPath: 'raw/fixture_001.lite.1.txt',
    normalizedOutput: output(),
    ...over,
  };
}

function check(evaluation: ReturnType<typeof evaluateObjectively>, id: string) {
  const found = evaluation.checks.find(entry => entry.id === id);
  expect(found, `missing check ${id}`).toBeDefined();
  return found!;
}

describe('the deterministic evaluator', () => {
  it('passes a clean generation', () => {
    const evaluation = evaluateObjectively(caseFixture(), generation());
    expect(evaluation.deterministicFailures).toBe(0);
    expect(evaluation.hardFails).toEqual([]);
  });

  it('is deterministic: the same input scores identically every time', () => {
    const first = evaluateObjectively(caseFixture(), generation());
    const second = evaluateObjectively(caseFixture(), generation());
    expect(second).toEqual(first);
  });

  it('catches a speaker the scene does not contain', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ dialogue: [{ speakerId: 'brann_001', text: 'ciao' }] }) }),
    );
    expect(check(evaluation, 'speakers_known').passed).toBe(false);
  });

  it('catches a tone tag outside the vocabulary', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ toneTags: ['epico'] }) }),
    );
    expect(check(evaluation, 'tone_tags_known').passed).toBe(false);
  });

  it('catches an invented entity id', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({
        normalizedOutput: output({ narration: 'Il settlement_borealis invia aiuti, acqua a 14.' }),
      }),
    );
    expect(check(evaluation, 'entity_references_exist').passed).toBe(false);
  });

  it('treats a memory the case never granted as a hard failure', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({
        normalizedOutput: output({ narration: 'Ricorda mem_mara_convoy: acqua a 14.' }),
      }),
    );
    expect(check(evaluation, 'memory_attribution_valid').passed).toBe(false);
    expect(evaluation.hardFails.map(fail => fail.category)).toContain('incompatible_memory_attribution');
  });

  it('flags a superseded authoritative value asserted as current', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ narration: "L'acqua resta a 17 unita'." }) }),
    );
    expect(check(evaluation, 'authoritative_value_current:water').passed).toBe(false);
    expect(evaluation.hardFails.map(fail => fail.category)).toContain('contradicts_state_delta');
  });

  it('accepts prose that names both the old and the new value', () => {
    // "from 17 to 14" is correct writing, not a stale claim.
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ narration: "L'acqua scende da 17 a 14." }) }),
    );
    expect(check(evaluation, 'authoritative_value_current:water').passed).toBe(true);
    expect(evaluation.hardFails).toEqual([]);
  });

  it('rejects proposals in a case that does not permit them', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ eventProposals: [{ templateId: 'x' }] }) }),
    );
    expect(check(evaluation, 'event_proposals_within_contract').passed).toBe(false);
  });

  it('requires a proposal in a case that asks for one', () => {
    const testCase = caseFixture();
    testCase.constraints.allowEventProposals = true;
    const evaluation = evaluateObjectively(testCase, generation());
    expect(check(evaluation, 'event_proposal_present').passed).toBe(false);
  });

  it('notices a named speaker who never speaks', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ dialogue: [] }) }),
    );
    expect(check(evaluation, 'expected_speakers_spoke').passed).toBe(false);
  });

  it('notices narration past the character limit', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ narration: 'x'.repeat(400) }) }),
    );
    expect(check(evaluation, 'narration_within_limit').passed).toBe(false);
  });

  it('treats heavily repeated sentences as unusable', () => {
    const line = "La riserva d'acqua scende a 14 unita'.";
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ narration: [line, line, line, line].join(' ') }) }),
    );
    expect(check(evaluation, 'repetition_within_bounds').passed).toBe(false);
    expect(evaluation.hardFails.map(fail => fail.category)).toContain('systematically_unusable');
  });

  it('still evaluates a rejected generation, and says why', () => {
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({
        accepted: false,
        normalizedOutput: null,
        validatorErrors: ['malformed JSON'],
      }),
    );
    expect(check(evaluation, 'schema_valid').passed).toBe(false);
    expect(check(evaluation, 'schema_valid').detail).toContain('malformed JSON');
  });

  it('escalates a strict-JSON case that is still invalid after its retry', () => {
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const evaluation = evaluateObjectively(
      testCase,
      generation({
        accepted: false,
        normalizedOutput: null,
        validatorErrors: ['malformed JSON'],
        attempt: 2,
        retryUsed: true,
      }),
    );
    expect(evaluation.hardFails.map(fail => fail.category)).toContain('unrecoverable_structured_output');
  });

  it('separates heuristic warnings from deterministic failures', () => {
    const evaluation = evaluateObjectively(caseFixture(), generation());
    for (const entry of evaluation.checks) {
      expect(['deterministic', 'heuristic']).toContain(entry.confidence);
    }
  });

  it('runs against every committed case without throwing', () => {
    for (const testCase of suite.cases) {
      const evaluation = evaluateObjectively(
        testCase,
        generation({
          caseId: testCase.id,
          task: testCase.task,
          normalizedOutput: {
            narration: 'Nulla di rilevante.',
            dialogue: testCase.constraints.knownSpeakerIds.map(speakerId => ({ speakerId, text: 'Ok.' })),
            toneTags: [testCase.constraints.allowedToneTags[0]!],
            eventProposals: testCase.constraints.allowEventProposals ? [{ templateId: 't' }] : [],
            memorySuggestions: testCase.constraints.allowMemorySuggestions ? ['m'] : [],
          },
        }),
      );
      expect(evaluation.caseId).toBe(testCase.id);
    }
  });
});
