/**
 * The operator path from a run directory on disk to an official comparison.
 *
 * ```text
 * <run directory>
 *   -> loadRunDirectory        parse, repair nothing, return `unknown`
 *   -> structuralBenchmarkRunProblems   is it even a run?
 *   -> validateRun             every cross-field rule
 *   -> buildLocalOfficialComparison     suite, artifacts, runtime, coverage,
 *                                       checkout, judgement, parity
 *   -> the report, or a refusal and a non-zero exit
 * ```
 *
 * **The only thing a caller may name is the run directory.** Not a repository
 * root, not a commit to trust, not a "the tree is clean, honestly" flag, not an
 * alternative suite or lock file. Every one of those would hand the caller the
 * authority the P0.5-A boundary exists to keep: the checkout identity comes from
 * `buildLocalOfficialComparison`, which derives it from the location of the
 * evaluating code itself, so the invariant stays *the code evaluates itself*.
 *
 * That is also why this file is short. It parses one argument, reads one
 * directory and prints one of two things; every judgement it appears to make is
 * really made by the library underneath, which is where the rules can be tested
 * without a process.
 *
 * Nothing is coerced, repaired or dropped. A malformed row is reported as the
 * row it is, and the command exits non-zero.
 */
import { loadRunDirectory } from './run-directory.js';
import { loadSuite } from '../suite.js';
import { structuralBenchmarkRunProblems } from '../structure.js';
import { validateRun, type BenchmarkRun } from '../result.js';
import { buildLocalOfficialComparison } from './local-report.js';
import { renderComparison, type ComparisonReport } from '../report.js';

/** What the command produced. */
export type ReportOutcome =
  | { readonly published: true; readonly report: ComparisonReport }
  | { readonly published: false; readonly refusal: string };

/**
 * The exact usage, in one place, so the error and the documentation agree.
 */
export const REPORT_CLI_USAGE =
  'usage: node packages/ai-benchmark/dist/adapters/report-cli.js <run-directory>';

/**
 * Read `directory` and either build the official comparison or say why not.
 *
 * Returns rather than throws, so the refusal is a value a test can read. The
 * process wrapper below is what turns it into an exit code.
 */
export function reportOnRunDirectory(directory: string): ReportOutcome {
  const refuse = (refusal: string): ReportOutcome => ({ published: false, refusal });

  // Loading is separate from judging: a directory that holds no run at all is
  // the absence of evidence, and no amount of validation makes a file appear.
  let loaded: unknown;
  try {
    loaded = loadRunDirectory(directory);
  } catch (error) {
    return refuse((error as Error).message);
  }

  // The structural boundary first. `loadRunDirectory` returns `unknown` because
  // that is the only honest type for a file nobody validated, and this is the
  // only thing that may turn it into a `BenchmarkRun`.
  const structural = structuralBenchmarkRunProblems(loaded);
  if (structural.length > 0) {
    return refuse(
      `not a benchmark run: ${describe(structural.map(problem => `${problem.field}: ${problem.message}`))}`,
    );
  }

  const run = loaded as BenchmarkRun;
  const semantic = validateRun(run);
  if (semantic.length > 0) {
    return refuse(
      `invalid run: ${describe(
        semantic.map(problem =>
          problem.generationId
            ? `${problem.generationId} ${problem.field}: ${problem.message}`
            : `${problem.field}: ${problem.message}`,
        ),
      )}`,
    );
  }

  // Everything else — the suite binding, the locked artifacts, the runtime
  // provenance, official coverage, the executing-checkout binding, judgement
  // attribution and input parity — belongs to the library, which refuses by
  // throwing. No score sheet or human review is passed: this reads what the
  // runner wrote, and human judgement arrives later by its own route.
  try {
    return { published: true, report: buildLocalOfficialComparison(loadSuite(), run) };
  } catch (error) {
    return refuse((error as Error).message);
  }
}

/** At most five problems, and an honest count of the rest. */
function describe(problems: string[]): string {
  const shown = problems.slice(0, 5);
  const remainder = problems.length - shown.length;
  return shown.join('; ') + (remainder > 0 ? `; and ${remainder} more` : '');
}

/**
 * The argument, or why the arguments are wrong.
 *
 * Exactly one, and never a flag. A command that quietly ignored a second
 * argument would let `report-cli run-a --repository ../other-checkout` look like
 * it had been honoured.
 */
export function runDirectoryArgument(argv: readonly string[]): string {
  if (argv.length === 0) {
    throw new Error(`no run directory given\n${REPORT_CLI_USAGE}`);
  }
  if (argv.length > 1) {
    throw new Error(
      `expected one run directory, got ${argv.length}: ${argv.join(' ')}\n` +
        'There are no other arguments. The repository, the commit and the suite are read ' +
        `from the checkout this code is running out of, never from the caller.\n${REPORT_CLI_USAGE}`,
    );
  }
  const [directory] = argv;
  if (directory!.startsWith('-')) {
    throw new Error(
      `'${directory}' is not a run directory. This command takes no options.\n${REPORT_CLI_USAGE}`,
    );
  }
  return directory!;
}

/**
 * Entry point. Prints the report to stdout, or the refusal to stderr and exits 1.
 */
function main(): void {
  let directory: string;
  try {
    directory = runDirectoryArgument(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  const outcome = reportOnRunDirectory(directory);
  if (!outcome.published) {
    process.stderr.write(`REFUSED: ${outcome.refusal}\n`);
    process.exitCode = 1;
    return;
  }

  // The human-readable summary on stderr and the machine-readable report on
  // stdout, so `> report.json` produces a file that is only ever JSON.
  process.stderr.write(`${renderComparison(outcome.report)}\n`);
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
}

// Only when run as a program. Importing this module — which the tests do — must
// not read `process.argv` or set an exit code.
if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  main();
}

/** The final path segment, without needing `node:path` for one call. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
