/**
 * Loading the versioned suite.
 *
 * The JSON is the single copy: the Rust runner reads the same file. Imported
 * rather than read through `fs` so this package stays runtime-agnostic and needs
 * no Node type definitions.
 */
import suiteData from '../suite/cases.v1.json' with { type: 'json' };
import type { BenchmarkSuite } from './case.js';

/** Repository-relative path of the versioned suite, for the Rust runner too. */
export const SUITE_RELATIVE_PATH = 'packages/ai-benchmark/suite/cases.v1.json';

/** The committed suite. */
export function loadSuite(): BenchmarkSuite {
  return suiteData as unknown as BenchmarkSuite;
}
