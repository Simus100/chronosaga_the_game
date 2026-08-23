import { describe, expect, it } from 'vitest';
import type { BenchmarkCase } from '../src/case.js';
import type { BenchmarkGeneration, NormalizedOutput } from '../src/result.js';
import { characterCount, evaluateObjectively } from '../src/objective.js';
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
    inputFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    attempt: 1,
    accepted: true,
    validatorErrors: [],
    retryUsed: false,
    servedModel: 'lite',
    fallbackUsed: false,
    fallbackProfile: null,
    latencyMs: 8000,
    tokensGenerated: 120,
    tokensPerSecond: 15,
    rawOutputPath: 'raw/fixture_001.lite.1.txt',
    // Shape only: these fixtures have no files on disk, and the bytes are
    // the run-directory adapter's business. Two rows may legitimately share
    // a digest — two models can emit the same raw text.
    rawOutputSha256: '0'.repeat(64),
    rawFormat: { bareJson: true, codeFencePresent: false, wrapperTextPresent: false },
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
    // A heuristic raises a review signal; it never disqualifies on its own.
    expect(evaluation.hardFails).toEqual([]);
    expect(evaluation.reviewSignals.map(signal => signal.candidateCategory)).toContain(
      'contradicts_state_delta',
    );
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
      generation({ normalizedOutput: output({ eventProposals: [{ subjectId: 'settlement_helios', topic: 't', rationale: 'r' }] }) }),
    );
    expect(check(evaluation, 'event_proposals_within_contract').passed).toBe(false);
  });

  it('A: a permitted but not required proposal may be declined', () => {
    // The prompt says "puoi". Marking the model down for taking the option it
    // was offered would penalise obedience.
    const testCase = caseFixture();
    testCase.constraints.allowEventProposals = true;
    const evaluation = evaluateObjectively(testCase, generation());

    expect(evaluation.checks.find(entry => entry.id === 'event_proposal_present')).toBeUndefined();
    expect(check(evaluation, 'event_proposals_within_contract').passed).toBe(true);
    expect(evaluation.deterministicFailures).toBe(0);
  });

  it('B: a required proposal that is absent is a deterministic failure', () => {
    const testCase = caseFixture();
    testCase.constraints.allowEventProposals = true;
    testCase.constraints.requireEventProposal = true;
    const evaluation = evaluateObjectively(testCase, generation());

    expect(check(evaluation, 'event_proposal_present').passed).toBe(false);
    expect(check(evaluation, 'event_proposal_present').detail).toContain('required a proposal');
  });

  it('C: a required proposal that is present passes', () => {
    const testCase = caseFixture();
    testCase.constraints.allowEventProposals = true;
    testCase.constraints.requireEventProposal = true;
    const evaluation = evaluateObjectively(
      testCase,
      generation({
        normalizedOutput: output({
          eventProposals: [{ subjectId: 'mara_001', topic: 'razionamento', rationale: 'r' }],
        }),
      }),
    );

    expect(check(evaluation, 'event_proposal_present').passed).toBe(true);
    expect(evaluation.deterministicFailures).toBe(0);
  });

  it('G: the memory path behaves symmetrically', () => {
    const permitted = caseFixture();
    permitted.constraints.allowMemorySuggestions = true;
    const optional = evaluateObjectively(permitted, generation());
    expect(optional.checks.find(entry => entry.id === 'memory_suggestion_present')).toBeUndefined();

    const required = caseFixture();
    required.constraints.allowMemorySuggestions = true;
    required.constraints.requireMemorySuggestion = true;

    const absent = evaluateObjectively(required, generation());
    expect(check(absent, 'memory_suggestion_present').passed).toBe(false);

    const present = evaluateObjectively(
      required,
      generation({
        normalizedOutput: output({
          memorySuggestions: [{ characterId: 'mara_001', summary: 'ricorda' }],
        }),
      }),
    );
    expect(check(present, 'memory_suggestion_present').passed).toBe(true);
  });

  it('H: permission false still rejects a non-empty array', () => {
    // Requiring nothing is not permitting everything: the production default is
    // untouched.
    const testCase = caseFixture();
    expect(testCase.constraints.allowEventProposals).toBeUndefined();
    const evaluation = evaluateObjectively(
      testCase,
      generation({
        normalizedOutput: output({
          eventProposals: [{ subjectId: 'mara_001', topic: 't', rationale: 'r' }],
        }),
      }),
    );
    expect(check(evaluation, 'event_proposals_within_contract').passed).toBe(false);
  });

  it('A: a permitted speaker may stay silent', () => {
    // The prompt says these ids *may* speak. Penalising a silent bystander
    // measures the case's wording, not the model.
    const testCase = caseFixture();
    testCase.constraints.knownSpeakerIds = ['mara_001', 'brann_001'];
    testCase.characters.push({
      id: 'brann_001', name: 'Brann Vale', role: 'Security Lead',
      stress: 24, morale: 81, traits: ['loyal'],
    });
    testCase.constraints.requiredSpeakerIds = ['mara_001'];

    const evaluation = evaluateObjectively(testCase, generation());
    expect(check(evaluation, 'required_speakers_spoke').passed).toBe(true);
    expect(evaluation.deterministicFailures).toBe(0);
  });

  it('B: a required speaker who stays silent is a deterministic failure', () => {
    const testCase = caseFixture();
    testCase.constraints.knownSpeakerIds = ['mara_001', 'brann_001'];
    testCase.characters.push({
      id: 'brann_001', name: 'Brann Vale', role: 'Security Lead',
      stress: 24, morale: 81, traits: ['loyal'],
    });
    testCase.constraints.requiredSpeakerIds = ['mara_001', 'brann_001'];

    const evaluation = evaluateObjectively(testCase, generation());
    expect(check(evaluation, 'required_speakers_spoke').passed).toBe(false);
    expect(check(evaluation, 'required_speakers_spoke').detail).toContain('brann_001');
  });

  it('C: a scene requiring nobody accepts empty dialogue', () => {
    const testCase = caseFixture();
    testCase.constraints.knownSpeakerIds = [];
    testCase.constraints.requiredSpeakerIds = [];

    const evaluation = evaluateObjectively(
      testCase,
      generation({ normalizedOutput: output({ dialogue: [] }) }),
    );
    expect(evaluation.checks.find(entry => entry.id === 'required_speakers_spoke')).toBeUndefined();
    expect(evaluation.deterministicFailures).toBe(0);
  });

  it('D: an unknown speaker is still a deterministic failure', () => {
    // Grounding is untouched: permission was relaxed, not abolished.
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ dialogue: [{ speakerId: 'sela_001', text: 'ciao' }] }) }),
    );
    expect(check(evaluation, 'speakers_known').passed).toBe(false);
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
    expect(evaluation.hardFails).toEqual([]);
    expect(evaluation.reviewSignals.map(signal => signal.candidateCategory)).toContain(
      'systematically_unusable',
    );
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

  it('never lets a heuristic create a hard fail on its own', () => {
    // The invariant, checked across the whole committed suite rather than on one
    // hand-picked example: for every generation whose only failing checks are
    // heuristic, there must be no machine hard fail at all.
    const loop = "La riserva d'acqua continua a scendere senza sosta.";
    const shapes = [
      output({ narration: "L'acqua resta a 17 unita'." }),
      output({ narration: [loop, loop, loop, loop].join(' ') }),
      output({ narration: "L'acqua resta a 17. " + [loop, loop, loop].join(' ') }),
    ];

    let exercised = 0;
    for (const shape of shapes) {
      const evaluation = evaluateObjectively(caseFixture(), generation({ normalizedOutput: shape }));
      const failed = evaluation.checks.filter(entry => !entry.passed);
      // Only meaningful when something failed and everything that failed was
      // heuristic; an all-green generation proves nothing about the invariant.
      if (failed.length === 0) continue;
      if (!failed.every(entry => entry.confidence === 'heuristic')) continue;
      exercised += 1;

      expect(
        evaluation.hardFails,
        `heuristic-only failures produced hard fails: ${JSON.stringify(failed)}`,
      ).toEqual([]);
      expect(evaluation.reviewSignals.length).toBeGreaterThan(0);
      for (const fail of evaluation.hardFails) {
        expect(fail.determinedBy).toBe('machine');
      }
    }
    expect(exercised, 'no heuristic-only shape was actually exercised').toBeGreaterThan(0);
  });

  it('still hard-fails on deterministically established conditions', () => {
    // The other half of the invariant: deterministic conditions must still
    // disqualify, or the rule would just be "nothing ever fails".
    const memory = evaluateObjectively(
      caseFixture(),
      generation({ normalizedOutput: output({ narration: 'Ricorda mem_mara_convoy.' }) }),
    );
    expect(memory.hardFails.map(fail => fail.category)).toContain('incompatible_memory_attribution');
    expect(memory.hardFails.every(fail => fail.determinedBy === 'machine')).toBe(true);

    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const structure = evaluateObjectively(
      testCase,
      generation({
        accepted: false,
        normalizedOutput: null,
        validatorErrors: ['malformed JSON'],
        attempt: 2,
        retryUsed: true,
      }),
    );
    expect(structure.hardFails.map(fail => fail.category)).toContain('unrecoverable_structured_output');
  });

  it('separates heuristic warnings from deterministic failures', () => {
    const evaluation = evaluateObjectively(caseFixture(), generation());
    for (const entry of evaluation.checks) {
      expect(['deterministic', 'heuristic']).toContain(entry.confidence);
    }
  });

  it('A: a strict case answered with bare JSON passes the raw-format check', () => {
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const evaluation = evaluateObjectively(testCase, generation());
    expect(check(evaluation, 'raw_output_is_bare_json').passed).toBe(true);
  });

  it('B: a fenced answer is accepted by the validator and still fails the strict check', () => {
    // The whole point. The application validator unwraps ```json on purpose, so
    // the generation is `accepted`; the benchmark asked for bare JSON and must
    // still record that it did not get it.
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const evaluation = evaluateObjectively(
      testCase,
      generation({
        accepted: true,
        rawFormat: { bareJson: false, codeFencePresent: true, wrapperTextPresent: true },
      }),
    );
    expect(evaluation.checks.find(c => c.id === 'schema_valid')!.passed).toBe(true);
    const strict = check(evaluation, 'raw_output_is_bare_json');
    expect(strict.passed).toBe(false);
    expect(strict.confidence).toBe('deterministic');
    expect(strict.detail).toContain('code fence');
  });

  it('C: prose around the object fails the strict check', () => {
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const evaluation = evaluateObjectively(
      testCase,
      generation({
        rawFormat: { bareJson: false, codeFencePresent: false, wrapperTextPresent: true },
      }),
    );
    expect(check(evaluation, 'raw_output_is_bare_json').passed).toBe(false);
    expect(check(evaluation, 'raw_output_is_bare_json').detail).toContain('text around');
  });

  it('D: a non-strict case is not disqualified for a code fence', () => {
    // Ordinary cases never asked for bare JSON, so the check must not exist.
    const evaluation = evaluateObjectively(
      caseFixture(),
      generation({
        rawFormat: { bareJson: false, codeFencePresent: true, wrapperTextPresent: true },
      }),
    );
    expect(evaluation.checks.some(entry => entry.id === 'raw_output_is_bare_json')).toBe(false);
    expect(evaluation.deterministicFailures).toBe(0);
  });

  it('G: missing raw-format evidence fails closed for a strict case', () => {
    // Absent evidence is not evidence of compliance.
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const record = generation();
    delete (record as unknown as Record<string, unknown>).rawFormat;

    const evaluation = evaluateObjectively(testCase, record);
    const strict = check(evaluation, 'raw_output_is_bare_json');
    expect(strict.passed).toBe(false);
    expect(strict.detail).toContain('unknown');
  });

  it('F: the report actually runs the strict raw-format check', () => {
    // It was silently skipped in every report before, because buildComparison
    // never passed raw text. Now the evidence travels with the row.
    const testCase = caseFixture();
    testCase.constraints.strictJsonOnly = true;
    const evaluation = evaluateObjectively(testCase, generation());
    expect(evaluation.checks.map(entry => entry.id)).toContain('raw_output_is_bare_json');
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
            eventProposals: testCase.constraints.allowEventProposals
        ? [{ subjectId: testCase.characters[0]?.id ?? 'settlement_helios', topic: 't', rationale: 'r' }]
        : [],
            memorySuggestions: testCase.constraints.allowMemorySuggestions
        ? [{ characterId: testCase.characters[0]?.id ?? 'mara_001', summary: 's' }]
        : [],
          },
        }),
      );
      expect(evaluation.caseId).toBe(testCase.id);
    }
  });
});

describe('grounding reaches inside structured suggestions', () => {
  /** The case fixture, with proposals and memory suggestions permitted. */
  function invitingCase(): BenchmarkCase {
    const testCase = caseFixture();
    testCase.constraints.allowEventProposals = true;
    testCase.constraints.allowMemorySuggestions = true;
    return testCase;
  }

  function evaluate(over: Partial<NormalizedOutput>) {
    return evaluateObjectively(
      invitingCase(),
      generation({ normalizedOutput: output(over) }),
    );
  }

  const check = (result: ReturnType<typeof evaluate>, id: string) =>
    result.checks.find(entry => entry.id === id)!;

  it('A: a rationale built from the case passes', () => {
    const result = evaluate({
      eventProposals: [
        {
          subjectId: 'settlement_helios',
          topic: 'razionamento',
          rationale: "settlement_helios ha perso acqua e mara_001 ha firmato il razionamento.",
        },
      ],
    });
    expect(check(result, 'entity_references_exist').passed).toBe(true);
  });

  it('B: an invented settlement hidden in a rationale is found', () => {
    // The gap exactly: subjectId is impeccable, the prose is not, and every
    // deterministic check passed before.
    const result = evaluate({
      eventProposals: [
        {
          subjectId: 'settlement_helios',
          topic: 'razionamento',
          rationale: 'settlement_fake ha perso le riserve.',
        },
      ],
    });
    const entities = check(result, 'entity_references_exist');
    expect(entities.passed).toBe(false);
    expect(entities.detail).toMatch(/settlement_fake/);
    expect(entities.confidence).toBe('deterministic');
  });

  it('C: an invented faction hidden in a topic is found', () => {
    const result = evaluate({
      eventProposals: [
        { subjectId: 'mara_001', topic: 'faction_fake', rationale: 'Serve una decisione.' },
      ],
    });
    expect(check(result, 'entity_references_exist').detail).toMatch(/faction_fake/);
  });

  it('D: a memory summary built from the case passes', () => {
    const result = evaluate({
      memorySuggestions: [
        { characterId: 'mara_001', summary: 'mara_001 ricorda mem_mara_ration.' },
      ],
    });
    expect(check(result, 'entity_references_exist').passed).toBe(true);
    expect(check(result, 'memory_attribution_valid').passed).toBe(true);
  });

  it('E: an unknown entity in a summary is found', () => {
    const result = evaluate({
      memorySuggestions: [
        { characterId: 'mara_001', summary: 'Ha parlato con brann_999 al deposito.' },
      ],
    });
    expect(check(result, 'entity_references_exist').detail).toMatch(/brann_999/);
  });

  it('F: a memory the case never granted, named in a summary, is a hard fail', () => {
    const result = evaluate({
      memorySuggestions: [
        { characterId: 'mara_001', summary: 'Ricorda mem_secret_999 dal turno scorso.' },
      ],
    });
    const memories = check(result, 'memory_attribution_valid');
    expect(memories.passed).toBe(false);
    expect(memories.detail).toMatch(/mem_secret_999/);
    expect(result.hardFails.map(fail => fail.category)).toContain(
      'incompatible_memory_attribution',
    );
    expect(result.hardFails.every(fail => fail.determinedBy === 'machine')).toBe(true);
  });

  it('G: typed subjectId and characterId validation is untouched', () => {
    // Still the application validator's job, and still checked there. This
    // corpus reads prose; it does not restate the typed rules.
    const result = evaluate({
      eventProposals: [
        { subjectId: 'settlement_helios', topic: 'acqua', rationale: 'La riserva scende.' },
      ],
      memorySuggestions: [{ characterId: 'mara_001', summary: 'Ha firmato.' }],
    });
    expect(result.deterministicFailures).toBe(0);
  });

  it('H: ordinary prose with no identifier-like tokens is unaffected', () => {
    const plain = evaluate({
      eventProposals: [
        {
          subjectId: 'mara_001',
          topic: 'razionamento',
          rationale: "L'acqua non basta e la gente ha paura di quello che verra'.",
        },
      ],
      memorySuggestions: [
        { characterId: 'mara_001', summary: 'Ha deciso di ridurre le porzioni.' },
      ],
    });
    const bare = evaluateObjectively(invitingCase(), generation({ normalizedOutput: output() }));
    expect(plain.deterministicFailures).toBe(bare.deterministicFailures);
    expect(check(plain, 'entity_references_exist').passed).toBe(true);
  });

  it('I: no check changed confidence in the process', () => {
    // Widening the corpus must not turn a heuristic into a disqualification.
    const result = evaluate({
      memorySuggestions: [{ characterId: 'mara_001', summary: 'Ha visto brann_001 al molo.' }],
    });
    expect(check(result, 'no_absent_character_claims').confidence).toBe('heuristic');
    expect(result.hardFails.map(fail => fail.category)).not.toContain('invented_entity');
    expect(result.reviewSignals.every(signal => signal.checkId !== 'entity_references_exist')).toBe(
      true,
    );
  });

  it('an empty suggestion list changes nothing', () => {
    const withNone = evaluateObjectively(
      invitingCase(),
      generation({ normalizedOutput: output() }),
    );
    expect(withNone.checks.map(entry => entry.id)).toContain('entity_references_exist');
    expect(check(withNone, 'entity_references_exist').passed).toBe(true);
  });
});

describe('an exhausted schema failure disqualifies any structured case', () => {
  /** A rejected generation at `attempt`, for `caseId`. */
  function rejected(caseId: string, attempt: number) {
    return generation({
      id: `run:${caseId}:lite:${attempt}`,
      caseId,
      attempt,
      retryUsed: attempt > 1,
      accepted: false,
      validatorErrors: ['output is not a valid contract payload: expected value'],
      normalizedOutput: null,
    });
  }

  const caseFor = (id: string) => suite.cases.find(entry => entry.id === id)!;
  const firstOf = (task: string) => suite.cases.find(entry => entry.task === task)!;
  const categories = (caseId: string, attempt: number) =>
    evaluateObjectively(caseFor(caseId), rejected(caseId, attempt)).hardFails.map(
      fail => fail.category,
    );

  it('the suite declares structured output on every case, which is why this matters', () => {
    // Derived, not remembered: the rule keys on this constraint, so the shape of
    // the suite is part of the evidence for the rule.
    expect(suite.cases.every(entry => entry.constraints.structuredOutput)).toBe(true);
    const strict = suite.cases.filter(entry => entry.constraints.strictJsonOnly);
    expect(strict.length).toBeGreaterThan(0);
    expect(strict.length).toBeLessThan(suite.cases.length);
  });

  it('A: a non-strict dialogue case that failed twice is disqualified', () => {
    const entry = firstOf('single_npc_dialogue');
    expect(entry.constraints.strictJsonOnly).toBeFalsy();
    expect(categories(entry.id, 2)).toContain('unrecoverable_structured_output');
  });

  it('B: a memory case that failed twice is disqualified', () => {
    const entry = firstOf('memory_grounded_reaction');
    expect(categories(entry.id, 2)).toContain('unrecoverable_structured_output');
  });

  it('C: political, resource and warfare cases that failed twice are disqualified', () => {
    for (const task of [
      'faction_political_consequence',
      'resource_economic_consequence',
      'warfare_report',
    ]) {
      const entry = firstOf(task);
      expect(categories(entry.id, 2), task).toContain('unrecoverable_structured_output');
    }
  });

  it('D: a proposal case that failed twice is disqualified', () => {
    const entry = suite.cases.find(candidate => candidate.constraints.allowEventProposals)!;
    expect(categories(entry.id, 2)).toContain('unrecoverable_structured_output');
  });

  it('E: a strict JSON repair case is disqualified as before', () => {
    const entry = suite.cases.find(candidate => candidate.constraints.strictJsonOnly)!;
    expect(categories(entry.id, 2)).toContain('unrecoverable_structured_output');
  });

  it('the rule keys on the constraint, not on the task name', () => {
    // H: a case that did not require structured output would not be
    // disqualified for failing to produce it. None of the 65 is such a case, so
    // the case is constructed rather than found.
    const unstructured = structuredClone(caseFor(suite.cases[0]!.id));
    unstructured.constraints.structuredOutput = false;
    const result = evaluateObjectively(unstructured, rejected(unstructured.id, 2));
    expect(result.hardFails.map(fail => fail.category)).not.toContain(
      'unrecoverable_structured_output',
    );
  });

  it('a rejected first attempt is not terminal; the retry is still owed', () => {
    const entry = firstOf('single_npc_dialogue');
    expect(categories(entry.id, 1)).not.toContain('unrecoverable_structured_output');
  });

  it('F: a retry that recovered is not disqualified', () => {
    const entry = firstOf('single_npc_dialogue');
    const recovered = generation({
      id: `run:${entry.id}:lite:2`,
      caseId: entry.id,
      attempt: 2,
      retryUsed: true,
      accepted: true,
      normalizedOutput: output(),
    });
    const result = evaluateObjectively(entry, recovered);
    expect(result.hardFails.map(fail => fail.category)).not.toContain(
      'unrecoverable_structured_output',
    );
  });

  it('G: an accepted first attempt is not disqualified', () => {
    const entry = firstOf('single_npc_dialogue');
    const accepted = generation({ caseId: entry.id, normalizedOutput: output() });
    expect(evaluateObjectively(entry, accepted).hardFails).toEqual([]);
  });

  it('I: the disqualification stays machine-determined', () => {
    const entry = firstOf('single_npc_dialogue');
    const fails = evaluateObjectively(caseFor(entry.id), rejected(entry.id, 2)).hardFails;
    const structured = fails.find(fail => fail.category === 'unrecoverable_structured_output')!;
    expect(structured.determinedBy).toBe('machine');
    expect(structured.detail).toMatch(/still invalid after the one permitted retry/);
  });

  it('J: it counts once per case, not once per rejected attempt', () => {
    const entry = firstOf('single_npc_dialogue');
    // Both attempts were rejected; only the terminal one carries the verdict.
    expect(categories(entry.id, 1)).toHaveLength(0);
    const terminal = categories(entry.id, 2).filter(
      category => category === 'unrecoverable_structured_output',
    );
    expect(terminal).toHaveLength(1);
  });
});

describe('bare-JSON compliance is measured only where it was demanded', () => {
  const fenced = { bareJson: false, codeFencePresent: true, wrapperTextPresent: false };
  const bare = { bareJson: true, codeFencePresent: false, wrapperTextPresent: false };

  const evaluateWith = (caseId: string, rawFormat: typeof bare) =>
    evaluateObjectively(
      suite.cases.find(entry => entry.id === caseId)!,
      generation({
        id: `run:${caseId}:lite:1`,
        caseId,
        task: suite.cases.find(entry => entry.id === caseId)!.task,
        rawFormat,
        normalizedOutput: output(),
      }),
    );

  const strictCase = suite.cases.find(entry => entry.constraints.strictJsonOnly)!;
  const ordinaryCase = suite.cases.find(entry => !entry.constraints.strictJsonOnly)!;

  it('B: a strict case that arrived fenced fails deterministically', () => {
    const result = evaluateWith(strictCase.id, fenced);
    const check = result.checks.find(entry => entry.id === 'raw_output_is_bare_json')!;
    expect(check.passed).toBe(false);
    expect(check.confidence).toBe('deterministic');
    expect(check.detail).toMatch(/code fence/);
  });

  it('C: a strict case that arrived bare passes', () => {
    const check = evaluateWith(strictCase.id, bare).checks.find(
      entry => entry.id === 'raw_output_is_bare_json',
    )!;
    expect(check.passed).toBe(true);
  });

  it('E and F: an ordinary fenced response is accepted and not marked down', () => {
    // The validator unwraps the fence on purpose, and the case was never told a
    // fence was forbidden, so there is nothing to fail.
    const result = evaluateWith(ordinaryCase.id, fenced);
    expect(result.checks.some(entry => entry.id === 'raw_output_is_bare_json')).toBe(false);
    expect(result.checks.find(entry => entry.id === 'schema_valid')!.passed).toBe(true);
  });

  it('the raw format is still recorded for every generation, strict or not', () => {
    // Evidence is kept either way; only the judgement is conditional.
    for (const entry of [strictCase, ordinaryCase]) {
      for (const observed of [bare, fenced]) {
        const generationUnderTest = generation({
          caseId: entry.id,
          task: entry.task,
          rawFormat: observed,
          normalizedOutput: output(),
        });
        expect(generationUnderTest.rawFormat).toEqual(observed);
      }
    }
  });

  it('J: exactly the cases declaring strictJsonOnly are judged on bare JSON', () => {
    const judged = suite.cases.filter(entry =>
      evaluateWith(entry.id, bare).checks.some(check => check.id === 'raw_output_is_bare_json'),
    );
    expect(judged.map(entry => entry.id)).toEqual(
      suite.cases.filter(entry => entry.constraints.strictJsonOnly).map(entry => entry.id),
    );
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.length).toBeLessThan(suite.cases.length);
  });
});

describe('narration length is counted as Rust counts it', () => {
  const limit = () => caseFixture().constraints.maxNarrationChars;

  const check = (narration: string) => {
    const entry = caseFixture();
    const result = evaluateObjectively(
      entry,
      generation({ normalizedOutput: output({ narration }) }),
    );
    return result.checks.find(item => item.id === 'narration_within_limit')!;
  };

  it('A: ASCII agrees with both counts', () => {
    const text = 'a'.repeat(limit());
    expect(characterCount(text)).toBe(text.length);
    expect(check(text).passed).toBe(true);
  });

  it('B: accented Italian is one character each', () => {
    const text = 'perché è così';
    expect(characterCount(text)).toBe(text.length);
    expect(characterCount(text)).toBe(13);
  });

  it('C: a non-BMP character at the exact limit passes', () => {
    // The emoji is one Unicode scalar and two UTF-16 code units. Rust accepts
    // this narration, so the report must not call it over-length.
    const text = '🌍'.repeat(limit());
    expect(characterCount(text)).toBe(limit());
    expect(text.length).toBe(limit() * 2);
    expect(check(text).passed).toBe(true);
  });

  it('D: one scalar over the limit fails', () => {
    const text = '🌍'.repeat(limit() + 1);
    expect(characterCount(text)).toBe(limit() + 1);
    expect(check(text).passed).toBe(false);
  });

  it('E: a mixed string counts scalars, not code units', () => {
    const text = 'Helios 🌍 è qui';
    expect(characterCount(text)).toBe(14);
    expect(text.length).toBe(15);
  });

  it('F: the diagnostic reports the number the verdict used', () => {
    const text = '🌍'.repeat(limit() + 5);
    const result = check(text);
    expect(result.detail).toBe(`${limit() + 5} of ${limit()} characters`);
    expect(result.detail).not.toContain(String(text.length));
  });
});
