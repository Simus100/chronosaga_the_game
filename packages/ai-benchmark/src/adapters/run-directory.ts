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
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { rawOutputPathProblems, type BenchmarkRun } from '../result.js';

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

/**
 * What is wrong with the raw evidence a run points at.
 *
 * `validateRun` proves a row *claims* a digest of the right shape. This proves
 * the file is there and still holds those bytes. Without it a run could be
 * copied with one raw file deleted, truncated, or swapped for another
 * generation's, and every row would still point somewhere plausible — the row
 * count would be right, the coverage gates would pass, and the report would
 * describe text nobody can produce any more.
 *
 * This lives in an adapter because it is the only check that needs the
 * directory: the pure library is handed a parsed run and cannot open a file.
 *
 * The threat model is loss and accident, not forgery. Somebody who edits both
 * `generations.jsonl` and the raw file can make them agree again, and no digest
 * stored beside the thing it describes can prevent that — it would take signing
 * and a key this project does not have. What this does guarantee is that the
 * two sides cannot disagree silently.
 */
export function rawEvidenceProblems(directory: string, run: BenchmarkRun): string[] {
  const problems: string[] = [];
  // Resolved once. Every path below is compared against this, so a row cannot
  // widen the boundary by being read relative to somewhere else.
  const root = resolve(directory);

  for (const generation of run.generations) {
    const at = (message: string) => problems.push(`${generation.id}: ${message}`);

    // The string first, and the filesystem only if the string survives. A path
    // out of a run directory is data, and opening it before checking it would
    // make it an instruction.
    const malformed = rawOutputPathProblems(generation.rawOutputPath);
    if (malformed.length > 0) {
      at(malformed.join('; '));
      continue;
    }

    // Belt and braces: the string check already refuses traversal, absolute
    // paths and separator tricks, but the value that gets opened is this one,
    // so this one is what is proven to be inside the run.
    const path = resolve(root, generation.rawOutputPath);
    if (path !== root && !path.startsWith(root + sep)) {
      at(`'${generation.rawOutputPath}' resolves outside the run directory`);
      continue;
    }

    let bytes: Buffer;
    try {
      const entry = statSync(path);
      if (!entry.isFile()) {
        at(`'${generation.rawOutputPath}' is not a regular file`);
        continue;
      }
      bytes = readFileSync(path);
    } catch (error) {
      at(`'${generation.rawOutputPath}' cannot be read: ${(error as Error).message}`);
      continue;
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== generation.rawOutputSha256) {
      at(
        `'${generation.rawOutputPath}' holds ${bytes.length} bytes hashing to ${digest}, ` +
          `but the row records ${generation.rawOutputSha256}`,
      );
    }
  }

  return problems;
}
