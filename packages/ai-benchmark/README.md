# @paa/ai-benchmark

P0.5 local AI benchmark harness. **Infrastructure only** — running the full
Lite-versus-Standard comparison is P0.5-B and is deliberately not done here.

## What lives where

| Piece | Location |
| --- | --- |
| The versioned cases | `suite/cases.v1.json` |
| Case / result / score schemas | `src/case.ts`, `src/result.ts`, `src/scoring.ts` |
| Deterministic evaluator | `src/objective.ts` |
| Hard-fail taxonomy | `src/hard-fail.ts` |
| Lite vs Standard report | `src/report.ts` |
| The runner | `apps/desktop/src-tauri/src/benchmark.rs` |

The suite is one JSON file read by two consumers: this package's evaluator and
the Rust runner. Two copies of sixty-five scenarios would drift within a week.

## Grounding

Every case is an excerpt of the deterministic M1 fixture
(`createSystemicScenario`, seed 7419): Helios Reach, the Helios Civic Compact,
the Rimward Front, and the five named characters. The benchmark defines **no
second gameplay schema** — deltas are `StateDelta` from `@paa/game-types`, and
acceptance is decided by the application's own validator, not by a
benchmark-only rule.

## Running a smoke pass

The runner is opt-in and needs the verified payload:

```
CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga CHRONOSAGA_BENCHMARK=1 \
CHRONOSAGA_BENCHMARK_PROFILE=lite CHRONOSAGA_BENCHMARK_CASES=3 \
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml \
  benchmark::tests::smoke -- --nocapture --test-threads=1
```

Without the variables it reports that it skipped and passes, so the ordinary
suite never depends on a multi-GB artifact.

## Where results go

Runs write **outside the repository**, under the development workspace:

```
D:\Chronosaga\benchmarks\p0.5\<runId>\
  generations.jsonl      one JSON row per attempt
  raw\<case>.<profile>.<attempt>.txt   the unedited model text
```

Rows are appended as JSON Lines so a crashed run still leaves usable evidence,
and each attempt gets its own raw file so a retry never overwrites what it
retried. `benchmarks/` and `packages/ai-benchmark/results/` are git-ignored, so a
stray run inside the checkout cannot be committed by accident. Raw prose is
never committed: sixty-five cases times two profiles times retries is a great
deal of text nobody will diff.

## Two kinds of judgement, kept apart

**Objective checks** (`src/objective.ts`) settle structure, identity and
arithmetic: schema validity, speaker and tone vocabulary, invented entity ids,
memory attribution, superseded authoritative values, contract shape, retry and
fallback policy, repetition. Each check is labelled `deterministic` or
`heuristic`; a heuristic never condemns a generation on its own.

**Human scores** (`src/scoring.ts`) cover the ten 0-5 axes the plan fixes. They
live in a separate sheet keyed by generation id, so scoring can never alter the
recorded evidence: a run can be re-scored, scored twice, or left unscored, and
the model output stays byte-identical.

**Hard failures** (`src/hard-fail.ts`) are separate from both. A well-written
paragraph that mutates a Game Core number is not "a 2 out of 5"; it is
disqualifying, and averaging it into a score would let good prose pay for a
broken invariant.

## Fairness

`buildComparison` refuses to report on profiles that did not see identical case
inputs, and the runner builds prompts from the case alone with no profile
parameter anywhere. Tuning wording so one candidate wins is the single thing
that would make the whole exercise worthless.

## Status

The cases, thresholds and guidance here are **provisional P0 material**. Neither
Lite nor Standard is release-approved, and nothing in this package should be read
as a hardware requirement or a quality verdict.
