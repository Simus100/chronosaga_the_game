/**
 * Reading a run directory off disk.
 *
 * Evidence lives outside Git, under the development workspace, because it is
 * raw model prose and there is a lot of it. Getting it back into the report is
 * therefore a file read, which is a host concern and belongs here rather than in
 * the pure library.
 *
 * This adapter reads and parses. It validates nothing: the value it returns is
 * `unknown`, and the only way to make it a `BenchmarkRun` is
 * `structuralBenchmarkRunProblems` followed by `validateRun`. Typing it as
 * anything else would be the same annotation-as-fact mistake the structural
 * boundary exists to stop.
 *
 * Nothing is repaired. A line that is not JSON is handed on **as the string it
 * was**, so the boundary reports `generations[3] is "…", a string; it must be an
 * object` — the row named and the file left alone. Dropping it would silently
 * shrink the run; parsing around it would invent a row nobody wrote.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The run recorded in `directory`, unvalidated.
 *
 * Throws only when the directory does not hold a run at all — a missing
 * `metadata.json` or `generations.jsonl` is not malformed evidence, it is the
 * absence of evidence, and no amount of validation makes a file appear.
 */
export function loadRunDirectory(directory: string): unknown {
  const metadataPath = join(directory, 'metadata.json');
  const rowsPath = join(directory, 'generations.jsonl');

  let metadataText: string;
  let rowsText: string;
  try {
    metadataText = readFileSync(metadataPath, 'utf8');
  } catch (error) {
    throw new Error(`no run metadata at ${metadataPath}: ${(error as Error).message}`);
  }
  try {
    rowsText = readFileSync(rowsPath, 'utf8');
  } catch (error) {
    throw new Error(`no generations at ${rowsPath}: ${(error as Error).message}`);
  }

  return {
    metadata: parseOrKeep(metadataText),
    // Blank lines are file formatting, not rows: a trailing newline is how text
    // files end, and reading one as a missing generation would be a complaint
    // about punctuation.
    generations: rowsText
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(parseOrKeep),
  };
}

/**
 * The parsed value, or the raw text when it does not parse.
 *
 * The boundary downstream describes what it received; a thrown parse error here
 * would describe only that something, somewhere, was wrong.
 */
function parseOrKeep(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
