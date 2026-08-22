/**
 * P0.5 local AI benchmark harness.
 *
 * Infrastructure only: the versioned case suite, the result and score schemas,
 * the deterministic evaluator and the Lite/Standard comparison. Running the real
 * 50-case benchmark is P0.5-B and is not performed here.
 *
 * Nothing in this package touches WorldState. It reads a deterministic fixture
 * slice and evaluates text; there is no code path from a benchmark run to the
 * authoritative simulation.
 */
export * from './case.js';
export * from './result.js';
export * from './structure.js';

export * from './objective.js';
export * from './scoring.js';
export * from './hard-fail.js';
export * from './human-review.js';
// Explicit rather than `export *`, so that the pure comparison primitive stays
// off the public surface. It accepts a caller-constructed checkout identity;
// publishing an official comparison goes through `@paa/ai-benchmark/local-report`,
// which reads the repository instead of being told about it.
export {
  caseIdsFor,
  inputParityProblems,
  comparableEvidenceProblems,
  officialProfileSetProblem,
  OFFICIAL_EVIDENCE_REQUIREMENTS,
  officialEvidenceProblems,
  judgementProblems,
  suiteContentDigest,
  suiteBindingProblems,
  scorePopulationProblems,
  reviewPopulationProblems,
  attributionProblems,
  attemptHistories,
  terminalGeneration,
  terminalGenerations,
  unfinishedHistories,
  attemptHistoryProblems,
  taskMismatches,
  renderComparison,
  type ProfileSummary,
  type ComparisonReport,
  type OfficialEvidenceRequirement,
  type OfficialEvidenceProblem,
  type AttemptHistory,
} from './report.js';
export * from './suite.js';
