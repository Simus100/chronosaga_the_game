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
| Human review (hard fails) | `src/human-review.ts` |
| Cross-language contract fixture | `tests/fixtures/rust-run.json` |
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
  metadata.json          commit, suite version, runner, runtime, host facts
  generations.jsonl      one JSON row per attempt
  raw\<case>.<profile>.<attempt>.txt   the unedited model text
```

`metadata.json` is written before the first generation, so a crashed run still
says what it was. Runtime provenance — release tag and the expected
`llama-server.exe` digest — is read from `config/local-ai-runtime.lock.json`
through the same parser the launcher uses, never written down again in the
runner.

`official_run_verdict` decides whether a run may be published as comparable
evidence. It requires a clean checkout, a full 40-character commit, a release
tag, a 64-character runtime digest, and real host facts. A smoke pass may fail
any of these and still be useful, because it proves plumbing rather than models —
it simply must never masquerade as official evidence.

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
`heuristic`, and the invariant is enforced rather than merely stated: a heuristic
raises a **review signal** and can never produce a machine hard fail on its own.
Only deterministic conditions — an unrecoverable structured output after its
retry, a memory id the case never granted — disqualify automatically.

**Human scores** (`src/scoring.ts`) cover the ten 0-5 axes the plan fixes. They
live in a separate sheet keyed by generation id, so scoring can never alter the
recorded evidence: a run can be re-scored, scored twice, or left unscored, and
the model output stays byte-identical.

**Hard failures** (`src/hard-fail.ts`) are separate from both. A well-written
paragraph that mutates a Game Core number is not "a 2 out of 5"; it is
disqualifying, and averaging it into a score would let good prose pay for a
broken invariant. Reviewers record their own in `src/human-review.ts`, validated
against the five locked categories and the generations the run actually
contains; the comparison reports machine and human disqualifications separately
and never merges either into a score.

## Fairness

`buildComparison` refuses to build a report at all unless five things hold:

1. both profiles saw every case;
2. every case a profile ran starts at **attempt 1** and numbers its attempts
   contiguously. A retry only one profile needed is valid evidence; a retry with
   nothing before it is a broken record, and comparing one model's first try
   against another's second measures neither. Duplicate `(case, profile,
   attempt)` rows are refused outright;
3. the recorded **input fingerprint** — SHA-256 over the suite identity, the case
   and both prompts *verbatim as sent* — matches for each `(case, attempt)` pair
   present for more than one profile, so "same inputs" is evidence rather than an
   assumption. Per attempt, not per case: a retry legitimately asks a different
   question. What may never differ is what the two profiles were asked on the
   same attempt number;
4. each profile used **one** artifact identity for the whole run;
5. the controlled settings — context size, token budget, temperature, top-p,
   seed, reasoning mode — were held equal. Context size is included on purpose:
   if P0.5-C varies it deliberately, that has to become a separate matrix
   dimension rather than being mixed into one comparison.

Rows that mislabel their own task are refused too, because a wrong task quietly
corrupts every per-task breakdown and nothing else would notice.

The runner builds prompts from the case alone, with no profile parameter
anywhere. Tuning wording so one candidate wins is the single thing that would
make the whole exercise worthless.

## One configuration, two consumers

`benchmark_context()` in the Rust runner is the source of truth for sampling. It
builds the request that reaches `llama-server` *and* the `context` block recorded
with every generation, so the evidence describes the run that happened. `top_p`
and `seed` are configured explicitly rather than left to the server, because
"whatever the runtime defaulted to" is not reproducible. The product smoke keeps
its own parameters and records `null` for the two it does not set, rather than
inventing values.

The fingerprint is computed from the strings actually handed to the provider and
passed into `record_generation`, which never rebuilds prompts of its own. P0.5-B
introduces retry wording, and a fingerprint that quietly recomputed the original
would claim two different questions were the same one.

`tests/fixtures/rust-run.json` is produced by the Rust serializer and consumed by
the TypeScript `validateRun`. Neither side can change shape alone.

## Judgement is bound to the run it judges

`ScoreSheet` and `HumanReview` both carry `runId` and `suiteVersion`, and
`buildComparison` refuses any whose values disagree with the run's. Generation
ids are stable and easy to copy by hand, so an id alone is not proof of
belonging: scores or disqualifications from another run can never drift into a
comparison.

## Status

The cases, thresholds and guidance here are **provisional P0 material**. Neither
Lite nor Standard is release-approved, and nothing in this package should be read
as a hardware requirement or a quality verdict.
