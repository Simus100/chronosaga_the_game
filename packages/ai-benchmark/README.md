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

`CHRONOSAGA_BENCHMARK_PROFILE` must name a locked profile — `lite` or
`standard`, read from `KNOWN_PROFILE_IDS` rather than a list kept here. A typo
like `standardd` fails immediately, names the value and says what is valid;
before, it resolved to nothing, was reported as a skip, and produced a green
command with no evidence at all. Ids are canonical and matched exactly, because a
benchmark that silently normalises its inputs cannot be trusted to record what
was asked. A *valid* profile whose payload is simply absent from this machine
still skips, and says so in words that cannot be mistaken for a typo.

`CHRONOSAGA_BENCHMARK_CASE_IDS` selects explicit cases, and **every requested id
must resolve**. A typo used to be dropped silently, so a request naming only
unknown ids produced zero cases, zero generations and a green command with no
evidence at all. The selection is now resolved before the runtime is verified or
the sidecar starts, so a mistake costs nothing and leaves nothing behind.
Repeated ids are deduplicated in first-request order: asking for a case twice is
a slip, and running it twice would produce two attempt-1 rows for one pair, which
the fairness rules reject anyway.

## Where results go

Runs write **outside the repository**, under the development workspace:

```
D:\Chronosaga\benchmarks\p0.5\<runId>\
  metadata.json          commit, suite version, runner, runtime, host facts
  generations.jsonl      one JSON row per attempt
  raw\<case>.<profile>.<attempt>.txt   the unedited model text
```

`metadata.json` is written before the first generation, so a crashed run still
says what it was. Runtime provenance is **measured, not copied**: before the
sidecar starts, all 51 files of the locked distribution are read and matched
against `config/local-ai-runtime.lock.json` for presence, exact size and exact
SHA-256, streaming. Only that verification can produce a
`VerifiedRuntimeIdentity`, and only that type feeds the run metadata — the lock
says what the runtime should be, and nothing else can claim it was.

Verifying the whole distribution rather than the executable matters:
`llama-server.exe` is a shim, and the runtime that answers lives in the adjacent
DLLs. A swapped `ggml-cpu-*.dll` would otherwise have produced the measurements
while the evidence named the locked release. The benchmark refuses to start if
verification fails; the lock remains the only source of expected hashes, shared
with `pnpm verify:local-ai-runtime`.

`official_run_verdict` decides whether a run may be published as comparable
evidence, and it asks two questions rather than one. **Could this be
reproduced** — clean checkout, full 40-character commit, release tag,
64-character runtime digest, real host facts? And **does it answer the
question** — was it declared `official_comparison`, and did it actually cover
every required case for every compared profile?

The second question is why `runKind` exists. A spotless single-profile smoke over
three cases satisfies every reproducibility field there is and still cannot
support a Lite-versus-Standard decision. Completeness of metadata is not evidence
of completeness of work, so purpose is **declared, never inferred**, and it
travels with the evidence: a smoke run written to disk and read back is still a
smoke run, and metadata with no declared purpose does not parse at all.

Coverage is the **product** of profiles and cases, not two independent sets.
`lite/A` plus `standard/B` gives profiles `{lite, standard}` and cases `{A, B}`,
which satisfies both set checks while neither model answered what the other did;
`RunCoverage` therefore records `(profile, case)` pairs and the verdict reports
what is missing grouped by profile. The full comparison is 65 cases across two
profiles: **130 pairs**, and nothing less counts. A case that took three retries
establishes its pair once.

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

Judgement arrives as external JSON, so `buildComparison` validates it before
aggregating anything. Attribution and well-formedness are separate invariants and
both are required: a sheet can belong to this run and still be nonsense. A
duplicate entry would skew a mean, an unknown generation id would vanish without
trace, and an invalid hard-fail category would index a tally never initialised
for it and turn a disqualification into `NaN`. Invalid judgement is refused, not
silently filtered.

**Hard failures** (`src/hard-fail.ts`) are separate from both. A well-written
paragraph that mutates a Game Core number is not "a 2 out of 5"; it is
disqualifying, and averaging it into a score would let good prose pay for a
broken invariant. Reviewers record their own in `src/human-review.ts`, validated
against the five locked categories and the generations the run actually
contains; the comparison reports machine and human disqualifications separately
and never merges either into a score.

Coverage means a **finished** history, not an observed row. The retry policy has
exactly three completed shapes — accepted first try; rejected then accepted;
rejected twice, which is exhausted and is still an answer. A rejected first
attempt with no second is none of them: it is a run that stopped before the model
finished being asked, and the one retry the policy owes it was never taken.
Counting it as a completed failure counts an interruption as evidence about the
model, and a whole suite of them would read as 130 complete pairs in which both
models failed everything. `terminalGeneration` names the attempt that ended a
history or refuses to name one; `MAX_ATTEMPTS` remains the only authority for the
ceiling, and a test reads the TypeScript declaration from the Rust side so
neither language can raise its own budget.

An official run never falls back. `STANDARD → LITE` is right for the product,
where the player wants the game to keep going, and wrong for a measurement: a row
where Standard asked and Lite answered stays grouped under `profile: 'standard'`,
so its output, acceptance, latency, retries and scores would all be reported as
Standard evidence for work Lite did — not a worse Standard result, a result about
another model wearing Standard's name. Such a row is refused rather than
reattributed, since moving it to Lite would mean rewriting its artifact identity,
its coverage pair and its provenance, and inventing a Lite generation nobody
asked for. It establishes no coverage either, so the profile is also short a
case, which is the truth: Standard did not answer it.

`validateRun` keeps understanding fallback rows structurally — smoke passes and
telemetry may legitimately represent one — and only the official boundary refuses
them. Product AUTO behaviour is untouched.

The output object is checked at runtime, not only in the type checker. `accepted`
implying a non-null `normalizedOutput` was the whole test, and the annotation on
that field is a compile-time claim about a value parsed from a file. A run
carrying `normalizedOutput: {}` satisfied every rule there was, and
`evaluateObjectively` then reached for `.dialogue.map(...)` on `undefined`. A
malformed nested item is worse, because it does not crash: `dialogue: [{ text:
'ok' }]` scores a speaker of `undefined` against the scene and produces a number.
`normalizedOutputProblems` checks fields, primitive types and array item shapes —
shape only; whether a speaker belongs to the scene stays with the application
validator and the evaluator. Unknown keys are refused because the producing Rust
types are `deny_unknown_fields`, and nothing is repaired: creating a missing
array, coercing a value or dropping a malformed item would each turn evidence of
a broken run into a plausible number.

Failing the schema twice disqualifies any case that required a schema. The rule
used to key on `strictJsonOnly`, which is five of the sixty-five cases, so a
dialogue, memory, warfare or proposal case could fail the contract, exhaust its
retry, finish with nothing usable, and record no machine hard fail merely because
it was not one of the JSON-repair cases. It keys on `structuredOutput` now — the
constraint that states the requirement — never on the task name. A first attempt
is not terminal, an accepted retry is recovered, and `strictJsonOnly` keeps its
additional bare-JSON requirement on top.

Human scores are averaged over one population or not at all. `validateScoreSheet`
asks whether each score is well formed; it never asked whether the set meant
anything as a mean, so one hand-picked excellent Lite generation and a handful of
mediocre Standard ones produced two numbers that looked directly comparable and
came from different samples — a difference in sampling reported as a difference
in models, and the kind of number that decides which model ships. The population
is the terminal generation of every `(profile, case)`: exactly one observation
each, so a profile that needed its retry is not weighted twice for having
struggled. An exhausted, rejected terminal attempt stays in the sample — its
prose can still be judged and its disqualification is recorded separately, rather
than by quietly removing it. A run with no sheet keeps its human means null.

Grounding reads all the prose, not only the narration and dialogue. Proposals and
memory suggestions are typed, and the application validator grounds their typed
parts — `subjectId` must be an entity the case put on the table, `characterId` a
character in the scene. Their prose was ungrounded, so a rationale reading
*settlement_fake ha perso le riserve* or a summary saying *ricorda
mem_secret_999* carried an invented id past every deterministic check while the
typed fields stayed impeccable. Free text is where invention hides, so `topic`,
`rationale` and `summary` join the same corpus, examined by the same detector.
Nothing was widened and no check changed confidence.

## Permission is not requirement

`knownSpeakerIds` says who *may* speak; `requiredSpeakerIds` says who *must*.
Only the second produces a deterministic failure when a character is silent, and
it has to be a subset of the first. Conflating them penalised answers that obeyed
the prompt: the instruction only ever said the dialogue may use these ids.

Across the 65 cases, dialogue is required exactly where the dialogue *is* the
task — `single_npc_dialogue` and `two_character_conflict`, thirteen cases. A
memory-suggestion or location-description case permits speech without demanding
it, and the prompt says which it is: `DEVONO parlare` when a voice is needed,
`nessuno e' obbligato` when it is not. Unknown-speaker grounding is untouched.

The same distinction governs proposals and memory suggestions, and it reaches
the validator too. `case_contract` used to pass only the *allow* flags, so a case
whose whole task is to produce a proposal — `ai_case_046` to `049`, and `050` to
`053` for memories — could return an empty array and be **accepted**: the row
recorded `accepted: true`, spent no retry, inflated `casesAccepted`, and was then
failed by the objective evaluator, with acceptance and semantics disagreeing
about the same row. The contract now carries `require_event_proposal` and
`require_memory_suggestion` beside the permissions, and rejection is what buys
the retry the policy owes. Requiring what is not permitted is a contract defect,
same as for speakers. Production permits neither, so it requires neither.

Formatting strictness belongs to `strictJsonOnly` and to nothing else. Every case
was told *senza blocchi di codice* while only the five strict cases were ever
measured for it, so an ordinary case could break a rule it had been given, have
the product validator unwrap the fence on purpose, and be recorded as fully
compliant — the prompt and the evaluator disagreeing about what had been asked,
with the prompt the one lying. Strict cases keep the bare-JSON demand and the
deterministic `raw_output_is_bare_json` check that measures it. Ordinary cases
still owe the structured contract in full and are simply not told a fence is
forbidden. The validator's tolerant unwrapping is unchanged, and `rawFormat` is
still recorded for every generation — only the judgement is conditional.

The distinction reaches the application validator, not just the evaluator. Before
this, `OutputContract` knew only who *may* speak and rejected empty dialogue
whenever anyone was listed — so a case could tell the model nobody was obliged to
speak and have the silence it invited recorded as a rejection, before the
objective checks ever ran. `case_contract` now carries `requiredSpeakerIds`
through, and a contract that requires a speaker it does not permit is named as a
defect in the contract rather than a failure of the model: silence would fail the
requirement and speech would fail the permission, so no answer could pass.

Two cases needed the obligation they were missing. `ai_case_036` and
`ai_case_041` both state *both characters speak* as an expected fact — they are
consequence scenes written around a reaction from each side — while declaring no
required speakers. The suite-wide invariant is now derived from the cases rather
than from a list of task names: a case whose expected facts demand speech must
declare who owes it. Anchoring on task kind would have missed exactly these two.


`allowEventProposals` says a case tolerates a proposal; `requireEventProposal`
says it demands one, and the memory path is symmetric. Only a requirement makes
an empty array a deterministic failure. Conflating the two penalised models for
obeying the instruction they were given: the prompt said "puoi" while the
evaluator counted absence as a fault.

The prompt now says `DEVE` where a case requires a suggestion and `puoi` where it
merely permits one, and the worked JSON example agrees — a case that demands a
proposal is never shown an empty array, because the example is what a small model
copies. Ordinary narration cases are still told to leave both arrays empty and
shown exactly that. A case cannot require what it does not permit; the suite
validator refuses that combination.

## Fairness

`buildComparison` first asks whether there is anything to compare at all. A
structurally valid run with metadata and no rows passes every other check by
vacuous truth — both compared sets are empty, so nothing is missing and nothing
disagrees — and renders `caseCount: 0` with empty summaries. An interrupted or
half-copied evidence directory looks exactly like that. Every compared profile
must have rows, and at least one case must have been answered by all of them.

Which profiles are compared is not the caller's to choose. Every gate below
takes the list as given, so `buildComparison(suite, run, ['lite'])` measured
coverage against Lite alone, found it complete, and published a full-suite
Lite-only run as an official comparison that compared nothing — a wrong list does
not produce a wrong answer, it produces a confident answer to a different
question. An official comparison is exactly one Lite and one Standard, taken from
`OFFICIAL_COMPARISON_PROFILES` beside the type rather than a string list at the
boundary, and a new profile added to `BenchmarkProfile` without a decision is a
compile error. Duplicates are refused too: comparing a profile with itself
renders two identical columns as though they were evidence of a difference.
Order is normalised, so the same evidence always reads Lite then Standard.

Having something to compare is not the same as having the right thing. A smoke
pass over ten cases on a dirty checkout is structurally impeccable and supports
no Lite-versus-Standard decision at all, and the danger is not that such a report
fails — it is that it succeeds and looks exactly like the official one: same
headings, same table, same verdict line, numbers drawn from a fraction of the
suite. `buildComparison` is the official entry point, so it fails closed. The run
must be declared official, built on a clean checkout at a full commit, carry
runtime provenance and host facts, and cover **every** `(profile, case)` pair the
supplied suite defines. Coverage is derived from that suite, so a suite that
grows raises the bar by itself; attempts collapse into pairs, so a retry adds a
row and no coverage.

Rust and TypeScript answer that question at different moments — the runner as
coverage accumulates, the report boundary against finished JSON — and cannot
share an implementation across the language boundary. What they share is the list
of questions: `OFFICIAL_EVIDENCE_REQUIREMENTS` is exported to
`tests/fixtures/official-evidence-requirements.json` and asserted on both sides,
and each side has a test proving every requirement it declares is one something
can actually fail. Neither can add or drop one alone.

Then it runs the authoritative `validateRun`, before parity,
evaluation or any aggregate. These runs arrive as external JSON and `validateRun`
already owns every cross-field invariant — an accepted attempt 1 claiming
`retryUsed`, an attempt 2 denying it, an accepted generation with a null output
that would crash the evaluator outright. Re-stating those rules in the report
would give the project two definitions of a valid run and, eventually, two
different answers; the report simply refuses.

Then it refuses to build a report at all unless five more things hold:

1. both profiles saw every case;
2. every case a profile ran starts at **attempt 1**, numbers its attempts
   contiguously, stays within the **one-shot retry policy** — `MAX_RETRIES = 1`,
   so at most two attempts, declared once in `result.ts` and consumed by both the
   structural validator and the history check — and every attempt after the first
   **follows a rejection**. A rejected second attempt is an exhausted retry, not
   permission for a third: a case that needed three tries was not asked the same
   question as one that needed two, and comparing them measures the retry budget
   rather than the models. An
   acceptance ends the history: `accepted 1 -> attempt 2` reads as a retry and is
   not one, and counting both would skew latency, quality means and retry
   totals with a generation the policy never permitted. A retry only one profile
   needed is valid evidence; a retry with nothing before it is a broken record.
   `retryUsed` must agree with the attempt number, and duplicate
   `(case, profile, attempt)` rows are refused outright;
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
with every generation, so the evidence describes the run that happened.

Readiness proves a server is listening on the port; it does not prove *which*
server. If a `llama-server` from an earlier session still holds 8081, `/health`
answers and the manager reaches Ready. Before the first prompt and before any row
is written, the runner therefore asks the endpoint which model it actually holds
and refuses unless it matches the selected profile, so that

```
recorded artifact identity == verified selected model == actual serving model
```

That is a snapshot, and it closes exactly one hole. A runtime that swaps models
afterwards keeps answering, keeps reporting the other alias, and every row after
the swap would be filed under an artifact that did not produce it. So each
response is checked as well, between the request and the row: the runner refuses
before `record_generation`, and `servedModel` is part of the TypeScript contract
where `validateRun` requires it to be present and to match the profile the row is
recorded under — the profile it fell back to, when it fell back.

Refusal is total. A single mismatched response ends the run rather than being
dropped, because a benchmark that discards inconvenient rows is measuring its own
filter: the coverage would silently shrink and the remaining numbers would come
from an unknown mixture of two models. `validateRun` runs first in
`buildComparison`, so a mismatched row never reaches scoring, latency or any
aggregate. `top_p`
and `seed` are configured explicitly rather than left to the server, because
"whatever the runtime defaulted to" is not reproducible. The product smoke keeps
its own parameters and records `null` for the two it does not set, rather than
inventing values.

The fingerprint is computed from the strings actually handed to the provider and
passed into `record_generation`, which never rebuilds prompts of its own. P0.5-B
introduces retry wording, and a fingerprint that quietly recomputed the original
would claim two different questions were the same one.

Each row also carries a `rawFormat` observation — `bareJson`,
`codeFencePresent`, `wrapperTextPresent` — derived at recording time from the
same string that is written to `raw/`. The application validator unwraps
markdown JSON fences on purpose, which is right for the product and wrong for a
case that demanded bare JSON: a fenced answer would be accepted and the report
would show full compliance. The evaluator reads the recorded observation, so the
report layer never touches the filesystem, and a strict case with no such
evidence **fails closed** rather than counting as a pass.

`tests/fixtures/rust-run.json` is produced by the Rust serializer and consumed by
the TypeScript `validateRun`. Neither side can change shape alone.

## Suggestions are typed, and still inert

`event_proposals` and `memory_suggestions` were `Vec<serde_json::Value>`, so
`[null]`, `[42]` and `[{}]` all counted as accepted structured proposals — which
made the phrase meaningless. They are now
`EventProposal { subjectId, topic, rationale }` and
`MemorySuggestion { characterId, summary }`, with `deny_unknown_fields`,
non-empty required strings, and grounding: a proposal must be about an entity
the scene contains, and a memory must belong to a character who is in it. The
benchmark prompt states the exact permitted shape rather than asking for an
unspecified object.

Deliberately the smallest useful shape, and deliberately **not** a second
gameplay schema: no effects, no deltas, no numbers of any kind. Production
defaults stay fail-closed (`allow_event_proposals` and
`allow_memory_suggestions` are `false`), and passing the validator gives a
suggestion no power whatsoever — no code path in this crate writes WorldState
from a generation, and a test asserts the inference boundary imports nothing
that could.

## A run is bound to its suite, and its sidecar to its guard

`buildComparison` refuses before evaluating anything if `suite.suiteVersion` or
`suite.schemaVersion` disagrees with what the run recorded. Case ids and task
names survive a revision that changes constraints and expected facts underneath
them, so without this a stored run could be quietly re-scored against rules it
never saw while the report still advertised the recorded version.

The sidecar is owned by an RAII guard for the whole benchmark. A request that
times out, loses its connection or returns an HTTP error panics through any
shutdown code written at the bottom of a function; a guard cannot be skipped by
an early return or a panic.

The guard marks itself done **only after the child is confirmed gone**. A kill
can fail transiently, and the manager deliberately keeps the pid so another
attempt is possible; setting the flag on the way in would turn the later `Drop`
into a no-op that leaves the orphan holding the port. `Drop` is therefore a real
retry, not a formality. It never panics — unwinding while already unwinding
aborts and destroys the diagnosis of the original failure — and once a stop is
confirmed, every further call does nothing.

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
