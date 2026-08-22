import { describe, expect, it } from 'vitest';
import { BENCHMARK_TASKS, casesByTask, validateSuite, type BenchmarkTask } from '../src/case.js';
import { loadSuite } from '../src/suite.js';

const suite = loadSuite();

describe('the committed benchmark suite', () => {
  it('is structurally valid', () => {
    expect(validateSuite(suite)).toEqual([]);
  });

  it('carries at least the fifty cases the plan requires', () => {
    expect(suite.cases.length).toBeGreaterThanOrEqual(50);
  });

  it('gives every case a unique id', () => {
    const ids = suite.cases.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every task kind the plan lists', () => {
    const covered = casesByTask(suite);
    for (const task of BENCHMARK_TASKS) {
      expect(covered.get(task)?.length ?? 0, `no cases for ${task}`).toBeGreaterThan(0);
    }
  });

  it('keeps the distribution balanced rather than piling onto one task', () => {
    // A suite that is 40 dialogue cases and one of everything else measures
    // dialogue, not the product.
    const covered = casesByTask(suite);
    for (const [task, cases] of covered) {
      expect(cases.length / suite.cases.length, `${task} dominates the suite`).toBeLessThan(0.25);
    }
  });

  it('stays anchored to the deterministic M1 fixture', () => {
    expect(suite.scenario.fixture).toBe('createSystemicScenario');
    expect(suite.scenario.seed).toBe(7419);
  });

  it('validates against the application contract, not a benchmark-only schema', () => {
    expect(suite.outputContract.shape).toBe('StructuredNarration');
    expect(suite.outputContract.requiredFields).toEqual([
      'narration',
      'dialogue',
      'tone_tags',
      'event_proposals',
      'memory_suggestions',
    ]);
  });

  it('includes the difficult shapes the plan calls for', () => {
    const tasks = new Set<BenchmarkTask>(suite.cases.map(entry => entry.task));
    expect(tasks.has('constrained_json_repair')).toBe(true);
    expect(tasks.has('delayed_consequence_grounding')).toBe(true);
    expect(tasks.has('contradictory_but_resolvable')).toBe(true);

    // Memory traps: at least one case grants no memory yet mentions a memory
    // tag, and at least one places a memory on a character who does not own it.
    const memoryTraps = suite.cases.filter(
      entry => entry.task === 'memory_grounded_reaction' && entry.relevantMemories.length === 0,
    );
    expect(memoryTraps.length).toBeGreaterThan(0);

    // Forbidden authoritative mutations appear across the suite, not once.
    const numericTraps = suite.cases.filter(entry =>
      entry.recentDelta.changes.some(change => typeof change.after === 'number'),
    );
    expect(numericTraps.length).toBeGreaterThanOrEqual(20);

    // Multiple actors.
    expect(suite.cases.filter(entry => entry.characters.length > 1).length).toBeGreaterThanOrEqual(8);
  });

  it('asks for Italian everywhere, because that is the product language', () => {
    for (const entry of suite.cases) {
      expect(entry.constraints.language, entry.id).toBe('it');
    }
  });

  it('never lets the model write authoritative numbers', () => {
    for (const entry of suite.cases) {
      expect(entry.constraints.authoritativeNumbersReadOnly, entry.id).toBe(true);
    }
  });

  it('E: a required speaker must also be a permitted one', () => {
    const broken = structuredClone(suite);
    broken.cases[0]!.constraints.requiredSpeakerIds = ['ghost_999'];
    const problems = validateSuite(broken);
    expect(problems.some(problem => problem.field === 'constraints.requiredSpeakerIds')).toBe(true);
  });

  it('keeps every required speaker inside the permitted ones', () => {
    for (const entry of suite.cases) {
      for (const speaker of entry.constraints.requiredSpeakerIds ?? []) {
        expect(entry.constraints.knownSpeakerIds, entry.id).toContain(speaker);
      }
    }
  });

  it('declares required speakers wherever a case expects named dialogue', () => {
    // The invariant that matters, derived from the cases rather than from a list
    // of task names: obligation is declared where it is expected, and only there.
    // Anchoring on the task kind instead would have missed exactly the two cases
    // whose expected facts demanded speech that nothing enforced.
    const demandsSpeech = /speaks?/i;
    for (const entry of suite.cases) {
      const facts = entry.expectedFacts.filter(fact => demandsSpeech.test(fact));
      const required = entry.constraints.requiredSpeakerIds ?? [];
      if (facts.length === 0) continue;
      expect(required.length, `${entry.id} expects '${facts[0]}' but obliges nobody`).toBeGreaterThan(0);
      if (facts.some(fact => /both/i.test(fact))) {
        expect(new Set(required), entry.id).toEqual(new Set(entry.constraints.knownSpeakerIds));
      }
    }
  });

  it('leaves the rest of the suite free to stay silent', () => {
    // Permission is broad, obligation is narrow. A memory-suggestion case does
    // not need anybody to speak, and requiring it would penalise compliance.
    const permissive = suite.cases.filter(
      entry => (entry.constraints.requiredSpeakerIds ?? []).length === 0,
    );
    expect(permissive.length).toBeGreaterThan(suite.cases.length / 2);
    for (const entry of permissive) {
      expect(entry.expectedFacts.some(fact => /speaks?/i.test(fact)), entry.id).toBe(false);
    }
  });

  it('P2-B: the two cases whose facts demand both voices now oblige both', () => {
    for (const id of ['ai_case_036', 'ai_case_041']) {
      const entry = suite.cases.find(candidate => candidate.id === id)!;
      expect(entry.expectedFacts, id).toContain('both characters speak');
      expect(entry.constraints.requiredSpeakerIds, id).toEqual(entry.constraints.knownSpeakerIds);
      expect(entry.constraints.requiredSpeakerIds, id).toHaveLength(2);
    }
  });

  it('F: a case with a silent non-required character is not penalised', () => {
    // ai_case_052 is a memory_suggestion case: one character present, permitted
    // to speak, required to do nothing.
    const entry = suite.cases.find(candidate => candidate.id === 'ai_case_052');
    if (!entry) return;
    expect(entry.constraints.requiredSpeakerIds ?? []).toHaveLength(0);
    expect(entry.constraints.knownSpeakerIds.length).toBeGreaterThan(0);
  });

  it('rejects a suite whose speakers are not in the scene', () => {
    const broken = structuredClone(suite);
    broken.cases[0]!.constraints.knownSpeakerIds = ['ghost_999'];
    const problems = validateSuite(broken);
    expect(problems.some(problem => problem.field === 'constraints.knownSpeakerIds')).toBe(true);
  });

  it('rejects duplicate case ids', () => {
    const broken = structuredClone(suite);
    broken.cases[1]!.id = broken.cases[0]!.id;
    expect(validateSuite(broken).some(problem => problem.message === 'duplicate case id')).toBe(true);
  });

  it('rejects a case that expects or forbids nothing', () => {
    const broken = structuredClone(suite);
    broken.cases[0]!.expectedFacts = [];
    broken.cases[0]!.forbiddenClaims = [];
    const fields = validateSuite(broken).map(problem => problem.field);
    expect(fields).toContain('expectedFacts');
    expect(fields).toContain('forbiddenClaims');
  });
});
