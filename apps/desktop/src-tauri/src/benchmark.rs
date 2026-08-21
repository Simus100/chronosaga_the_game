//! P0.5 benchmark runner.
//!
//! Executes the versioned case suite against a real profile through the
//! application's own AI boundary: the same launch contract, the same loopback
//! provider and the same validator the game uses. A benchmark that went around
//! any of those would be measuring something the player never experiences.
//!
//! Opt-in, like [`crate::runtime_e2e`]: without the environment variables every
//! test here reports that it skipped, so the normal suite stays independent of
//! the model payload. The pure parts — prompt construction, contract derivation,
//! result identity, artifact layout — are unit tested unconditionally, because
//! those are what make a run reproducible.
//!
//! ```text
//! CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga CHRONOSAGA_BENCHMARK=1 \
//!   cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml \
//!   benchmark -- --nocapture --test-threads=1
//! ```
//!
//! Scope is P0.5-A: infrastructure and a smoke run. The full Lite-versus-Standard
//! comparison is P0.5-B and is deliberately not performed here.
//!
//! **This module never touches WorldState.** It reads a committed JSON slice of a
//! deterministic fixture and writes result files outside the repository. There is
//! no path from a benchmark run to the authoritative simulation.

#![cfg(test)]

use crate::inference::OutputContract;
use serde::Deserialize;
use std::{env, fs, path::PathBuf};

const BENCHMARK_ENV: &str = "CHRONOSAGA_BENCHMARK";
const WORKSPACE_ENV: &str = "CHRONOSAGA_WORKSPACE_ROOT";

/// Repository-relative location of the versioned suite.
///
/// The same file `@paa/ai-benchmark` reads. One copy, two readers.
pub const SUITE_RELATIVE_PATH: &str = "packages/ai-benchmark/suite/cases.v1.json";

/// Version of this runner, recorded with every run.
pub const RUNNER_VERSION: &str = "0.1.0";

// ---------------------------------------------------------------------------
// The suite, as the runner reads it
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSuite {
    pub schema_version: u32,
    pub suite_version: String,
    pub cases: Vec<BenchmarkCase>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCase {
    pub id: String,
    pub task: String,
    pub notes: String,
    pub world_state_slice: serde_json::Value,
    pub characters: Vec<BenchmarkCharacter>,
    pub relevant_memories: Vec<BenchmarkMemory>,
    pub recent_delta: BenchmarkDelta,
    pub constraints: BenchmarkConstraints,
    pub expected_facts: Vec<String>,
    pub forbidden_claims: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCharacter {
    pub id: String,
    pub name: String,
    pub role: String,
    pub stress: i64,
    pub morale: i64,
    pub traits: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkMemory {
    pub id: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub turn: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDelta {
    pub turn: i64,
    pub source: String,
    pub changes: Vec<BenchmarkChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkChange {
    #[serde(rename = "type")]
    pub change_type: String,
    pub key: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkConstraints {
    pub language: String,
    pub known_speaker_ids: Vec<String>,
    pub allowed_tone_tags: Vec<String>,
    pub max_narration_chars: usize,
    pub structured_output: bool,
    pub authoritative_numbers_read_only: bool,
    #[serde(default)]
    pub allow_event_proposals: bool,
    #[serde(default)]
    pub allow_memory_suggestions: bool,
    #[serde(default)]
    pub strict_json_only: bool,
    #[serde(default)]
    pub prior_invalid_output: Option<String>,
    #[serde(default)]
    pub pending_consequences: Vec<serde_json::Value>,
}

/// Load the committed suite from the checkout.
///
/// A test-only path into the repository is legitimate here in a way it is not in
/// the shipped application: the benchmark *is* a development tool.
pub fn load_suite() -> Result<BenchmarkSuite, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../")
        .join(SUITE_RELATIVE_PATH);
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("unable to parse {}: {error}", path.display()))
}

// ---------------------------------------------------------------------------
// Case -> application contract
// ---------------------------------------------------------------------------

/// Derive the validator contract from a case.
///
/// The benchmark does not define acceptance; it hands the case's own constraints
/// to the application's validator and records what that validator decides.
pub fn case_contract(case: &BenchmarkCase) -> OutputContract {
    OutputContract {
        known_speaker_ids: case.constraints.known_speaker_ids.clone(),
        allowed_tone_tags: case.constraints.allowed_tone_tags.clone(),
        max_narration_chars: case.constraints.max_narration_chars,
    }
}

/// The system prompt, identical for every profile.
///
/// Built only from the case, with no profile-specific wording anywhere: tuning a
/// prompt so that one candidate wins is the one thing that would make the whole
/// comparison worthless.
pub fn system_prompt(case: &BenchmarkCase) -> String {
    let tags = case.constraints.allowed_tone_tags.join(", ");
    let speakers = if case.constraints.known_speaker_ids.is_empty() {
        "nessuno: non produrre dialogo".to_string()
    } else {
        case.constraints.known_speaker_ids.join(", ")
    };
    let proposals = if case.constraints.allow_event_proposals {
        "puoi proporre eventi in event_proposals; sono suggerimenti, mai effetti applicati"
    } else {
        "event_proposals deve essere un array vuoto"
    };
    let memories = if case.constraints.allow_memory_suggestions {
        "puoi proporre memorie in memory_suggestions, solo per i personaggi presenti"
    } else {
        "memory_suggestions deve essere un array vuoto"
    };

    let structure = if case.constraints.strict_json_only {
        "\n- l'output precedente non era valido: rispondi solo con l'oggetto JSON corretto"
    } else {
        ""
    };
    let numbers = if case.constraints.authoritative_numbers_read_only {
        "- i numeri di stato sono autorevoli e di sola lettura: descrivili, non cambiarli;"
    } else {
        "- riporta i numeri di stato come sono;"
    };
    debug_assert!(
        case.constraints.structured_output,
        "every P0.5 case expects the structured contract"
    );

    format!(
        "Sei il narratore di Chronosaga. Scrivi in {language}.\n\n\
         Regole non negoziabili:\n\
         {numbers}\n\
         - non inventare entita', personaggi o memorie non elencati;\n\
         - parla solo per questi speaker: {speakers};\n\
         - usa solo questi tone tag: {tags};\n\
         - la narrazione non supera {max} caratteri;\n\
         - {proposals};\n\
         - {memories}.{structure}\n\n\
         Rispondi con un solo oggetto JSON, senza testo attorno e senza blocchi di codice:\n\
         {{\"narration\": \"...\", \"dialogue\": [{{\"speakerId\": \"...\", \"text\": \"...\"}}], \
         \"tone_tags\": [\"...\"], \"event_proposals\": [], \"memory_suggestions\": []}}",
        language = case.constraints.language,
        speakers = speakers,
        tags = tags,
        max = case.constraints.max_narration_chars,
        proposals = proposals,
        memories = memories,
        numbers = numbers,
        structure = structure,
    )
}

/// The user prompt: the case's structured context, rendered deterministically.
pub fn user_prompt(case: &BenchmarkCase) -> String {
    let mut sections = Vec::new();
    sections.push(format!("TASK: {}", case.task));
    sections.push(format!(
        "STATO (sola lettura):\n{}",
        serde_json::to_string_pretty(&case.world_state_slice).unwrap_or_default()
    ));

    if case.characters.is_empty() {
        sections.push("PERSONAGGI: nessuno in scena".to_string());
    } else {
        let lines: Vec<String> = case
            .characters
            .iter()
            .map(|character| {
                format!(
                    "- {} ({}), ruolo {}, stress {}, morale {}, tratti: {}",
                    character.id,
                    character.name,
                    character.role,
                    character.stress,
                    character.morale,
                    character.traits.join(", ")
                )
            })
            .collect();
        sections.push(format!("PERSONAGGI:\n{}", lines.join("\n")));
    }

    if case.relevant_memories.is_empty() {
        sections.push(
            "MEMORIE: nessuna. Non attribuire ricordi che non sono elencati qui.".to_string(),
        );
    } else {
        let lines: Vec<String> = case
            .relevant_memories
            .iter()
            .map(|memory| {
                format!(
                    "- {} (turno {}, tag: {}): {}",
                    memory.id,
                    memory.turn,
                    memory.tags.join(", "),
                    memory.summary
                )
            })
            .collect();
        sections.push(format!("MEMORIE DISPONIBILI:\n{}", lines.join("\n")));
    }

    if case.recent_delta.changes.is_empty() {
        sections.push(format!(
            "DELTA AUTOREVOLE (turno {}): nessun cambiamento.",
            case.recent_delta.turn
        ));
    } else {
        let lines: Vec<String> = case
            .recent_delta
            .changes
            .iter()
            .map(|change| {
                format!(
                    "- {} su '{}': da {} a {}",
                    change.change_type, change.key, change.before, change.after
                )
            })
            .collect();
        sections.push(format!(
            "DELTA AUTOREVOLE (turno {}, fonte {}):\n{}\n\
             I valori 'a' sono quelli attuali. I valori 'da' sono superati.",
            case.recent_delta.turn,
            case.recent_delta.source,
            lines.join("\n")
        ));
    }

    if !case.constraints.pending_consequences.is_empty() {
        sections.push(format!(
            "CONSEGUENZE IN SOSPESO (non ancora avvenute, quelle nascoste non vanno rivelate):\n{}",
            serde_json::to_string_pretty(&case.constraints.pending_consequences).unwrap_or_default()
        ));
    }

    if let Some(prior) = &case.constraints.prior_invalid_output {
        sections.push(format!(
            "OUTPUT PRECEDENTE NON VALIDO, da correggere mantenendo il contenuto:\n{prior}"
        ));
    }

    sections.join("\n\n")
}

/// Everything needed to reproduce a run, minus the weights themselves.
///
/// A result without this is an anecdote. With it, another machine can rebuild
/// the same commit, verify the same digests and re-run the same suite.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMetadata {
    pub run_id: String,
    pub started_at: String,
    pub git_commit: String,
    pub git_dirty: bool,
    pub suite_version: String,
    pub suite_schema_version: u32,
    pub runner_version: String,
    pub runtime_release_tag: String,
    pub runtime_executable_sha256: Option<String>,
    pub host: HostFacts,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFacts {
    pub os: String,
    pub arch: String,
    pub cpu: String,
    pub logical_cores: usize,
    pub total_ram_mb: u64,
}

/// Assemble run metadata from the suite and the environment.
///
/// The suite version is taken from the file that was actually loaded rather than
/// from a constant, so a run can never claim to have executed a suite it did not.
pub fn new_run_metadata(
    run_id: &str,
    started_at: &str,
    suite: &BenchmarkSuite,
    git_commit: &str,
    git_dirty: bool,
    runtime_release_tag: &str,
    runtime_executable_sha256: Option<String>,
    host: HostFacts,
) -> RunMetadata {
    RunMetadata {
        run_id: run_id.to_string(),
        started_at: started_at.to_string(),
        git_commit: git_commit.to_string(),
        git_dirty,
        suite_version: suite.suite_version.clone(),
        suite_schema_version: suite.schema_version,
        runner_version: RUNNER_VERSION.to_string(),
        runtime_release_tag: runtime_release_tag.to_string(),
        runtime_executable_sha256,
        host,
    }
}

/// The generation id used in results: stable, sortable, and unique per attempt.
pub fn generation_id(run_id: &str, case_id: &str, profile: &str, attempt: u32) -> String {
    format!("{run_id}:{case_id}:{profile}:{attempt}")
}

/// Where a generation's raw text is stored, relative to the run directory.
///
/// Raw model prose stays on disk and out of Git: sixty-five cases times two
/// profiles times retries is a great deal of text nobody will ever diff.
pub fn raw_output_path(case_id: &str, profile: &str, attempt: u32) -> String {
    format!("raw/{case_id}.{profile}.{attempt}.txt")
}

/// Root of the benchmark results tree, outside the repository.
///
/// Results are evidence, not source. They live beside the other heavy local
/// assets, under the development workspace.
pub fn results_root(workspace_root: &str) -> PathBuf {
    PathBuf::from(workspace_root).join("benchmarks/p0.5")
}

/// Directory for one run.
pub fn run_directory(workspace_root: &str, run_id: &str) -> PathBuf {
    results_root(workspace_root).join(run_id)
}

/// One recorded generation, exactly as `@paa/ai-benchmark` expects to read it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRecord {
    pub id: String,
    pub run_id: String,
    pub case_id: String,
    pub task: String,
    pub profile: String,
    pub attempt: u32,
    pub accepted: bool,
    pub validator_errors: Vec<String>,
    pub retry_used: bool,
    pub fallback_used: bool,
    pub fallback_profile: Option<String>,
    pub latency_ms: u64,
    pub tokens_generated: Option<u64>,
    pub tokens_per_second: Option<f64>,
    pub raw_output_path: String,
    pub normalized_output: Option<NormalizedOutput>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedOutput {
    pub narration: String,
    pub dialogue: Vec<crate::inference::DialogueLine>,
    pub tone_tags: Vec<String>,
    pub event_proposals: Vec<serde_json::Value>,
    pub memory_suggestions: Vec<serde_json::Value>,
}

/// Turn one real inference outcome into a result row.
///
/// Rejections keep their reason and lose their output; acceptances keep their
/// output and carry no error. The asymmetry is deliberate and is what the
/// TypeScript result validator enforces.
pub fn record_generation(
    run_id: &str,
    case: &BenchmarkCase,
    profile: &str,
    attempt: u32,
    outcome: &crate::inference::InferenceOutcome,
) -> GenerationRecord {
    GenerationRecord {
        id: generation_id(run_id, &case.id, profile, attempt),
        run_id: run_id.to_string(),
        case_id: case.id.clone(),
        task: case.task.clone(),
        profile: profile.to_string(),
        attempt,
        accepted: outcome.accepted,
        validator_errors: outcome
            .validation_error
            .iter()
            .map(|error| error.to_string())
            .collect(),
        retry_used: attempt > 1,
        fallback_used: false,
        fallback_profile: None,
        latency_ms: outcome.duration_ms,
        tokens_generated: outcome.completion_tokens,
        tokens_per_second: outcome.tokens_per_second,
        raw_output_path: raw_output_path(&case.id, profile, attempt),
        normalized_output: outcome.accepted.then(|| NormalizedOutput {
            narration: outcome.narration.clone().unwrap_or_default(),
            dialogue: outcome.dialogue.clone(),
            tone_tags: outcome.tone_tags.clone(),
            // P0 keeps both arrays empty by contract; the shape is carried so the
            // reader does not have to special-case a missing key.
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
        }),
    }
}

/// Write one generation's raw text and its result row.
///
/// Raw prose goes to its own file and the row references it. Rows are appended as
/// JSON Lines so a crashed run still leaves usable evidence.
pub fn persist(
    run_directory: &std::path::Path,
    record: &GenerationRecord,
    raw: &str,
) -> Result<(), String> {
    let raw_path = run_directory.join(&record.raw_output_path);
    if let Some(parent) = raw_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("unable to create {}: {error}", parent.display()))?;
    }
    fs::write(&raw_path, raw).map_err(|error| format!("unable to write {}: {error}", raw_path.display()))?;

    let line = serde_json::to_string(record).map_err(|error| format!("unserialisable record: {error}"))?;
    let rows = run_directory.join("generations.jsonl");
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&rows)
        .map_err(|error| format!("unable to open {}: {error}", rows.display()))?;
    writeln!(file, "{line}").map_err(|error| format!("unable to append to {}: {error}", rows.display()))
}

fn enabled() -> bool {
    env::var(BENCHMARK_ENV).ok().as_deref() == Some("1")
        && env::var(WORKSPACE_ENV).is_ok_and(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_suite_parses_with_the_runner_types() {
        // The TypeScript package and this runner read the same bytes; if the two
        // views of the file ever disagree, this is where it shows up first.
        let suite = load_suite().expect("the suite must parse");
        assert_eq!(suite.schema_version, 1);
        assert!(suite.cases.len() >= 50, "got {}", suite.cases.len());
    }

    #[test]
    fn every_case_yields_a_contract_the_validator_understands() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let contract = case_contract(case);
            assert_eq!(contract.known_speaker_ids, case.constraints.known_speaker_ids);
            assert!(!contract.allowed_tone_tags.is_empty(), "{}", case.id);
            assert!(contract.max_narration_chars > 0, "{}", case.id);
        }
    }

    #[test]
    fn prompts_are_identical_whatever_profile_will_answer() {
        // The runner has no profile parameter in prompt construction at all, and
        // this test exists so that adding one is a visible decision rather than a
        // quiet one. Tuning wording per candidate would void the comparison.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        assert_eq!(system_prompt(case), system_prompt(case));
        assert_eq!(user_prompt(case), user_prompt(case));
    }

    #[test]
    fn prompts_carry_the_authoritative_delta_and_call_it_read_only() {
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|case| !case.recent_delta.changes.is_empty())
            .expect("some case must carry a delta");

        let user = user_prompt(case);
        let change = &case.recent_delta.changes[0];
        assert!(user.contains(&change.key), "{user}");
        assert!(user.contains(&change.after.to_string()), "{user}");
        assert!(user.contains("superati"), "{user}");
        assert!(system_prompt(case).contains("sola lettura"), "{case:?}");
    }

    #[test]
    fn a_case_with_no_memories_says_so_rather_than_staying_silent() {
        // Silence invites invention; an explicit "none" is the instruction.
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|case| case.relevant_memories.is_empty())
            .expect("some case grants no memory");
        assert!(user_prompt(case).contains("nessuna"));
    }

    #[test]
    fn prompts_never_leak_the_grading_material() {
        // `notes` and `forbiddenClaims` belong to the evaluator and the human
        // scorer; putting them in the prompt would be marking your own homework.
        //
        // `expectedFacts` is deliberately NOT checked. Those facts are drawn from
        // the input on purpose — "water is 14" is what the delta says — so their
        // presence is the case working, not the answer leaking.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let prompt = format!("{}\n{}", system_prompt(case), user_prompt(case));
            for claim in &case.forbidden_claims {
                assert!(
                    !prompt.contains(claim.as_str()),
                    "{} names a forbidden claim in its own prompt: {claim}",
                    case.id
                );
            }
            assert!(!prompt.contains(&case.notes), "{} leaks its own notes", case.id);
        }
    }

    #[test]
    fn run_metadata_reports_the_suite_that_actually_ran() {
        let suite = load_suite().unwrap();
        let metadata = new_run_metadata(
            "run_001",
            "2026-08-21T00:00:00Z",
            &suite,
            "9599f38",
            false,
            "b10343",
            None,
            HostFacts {
                os: "Windows 11".to_string(),
                arch: "x86_64".to_string(),
                cpu: "i7-13700KF".to_string(),
                logical_cores: 24,
                total_ram_mb: 65536,
            },
        );

        assert_eq!(metadata.suite_version, suite.suite_version);
        assert_eq!(metadata.suite_schema_version, suite.schema_version);
        assert_eq!(metadata.runner_version, RUNNER_VERSION);
        assert!(!metadata.git_commit.is_empty());

        // It has to survive the trip to disk unchanged.
        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("suiteVersion"));
        assert!(json.contains("runtimeReleaseTag"));
        assert!(!json.contains(".gguf"), "metadata carries identity, not payload");
    }

    #[test]
    fn a_strict_json_case_is_told_its_previous_answer_was_invalid() {
        let suite = load_suite().unwrap();
        let repair = suite
            .cases
            .iter()
            .find(|case| case.constraints.strict_json_only)
            .expect("the suite contains repair cases");
        assert!(system_prompt(repair).contains("non era valido"));
        assert!(user_prompt(repair).contains("OUTPUT PRECEDENTE NON VALIDO"));
    }

    #[test]
    fn every_case_states_what_it_expects_and_what_it_forbids() {
        // Mirrors the TypeScript suite check from the runner's side: if the two
        // readers ever disagree about the file, one of these two fails.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            assert!(!case.expected_facts.is_empty(), "{} expects nothing", case.id);
            assert!(!case.forbidden_claims.is_empty(), "{} forbids nothing", case.id);
        }
    }

    #[test]
    fn generation_ids_are_unique_per_case_profile_and_attempt() {
        let mut seen = std::collections::HashSet::new();
        for case_id in ["c1", "c2"] {
            for profile in ["lite", "standard"] {
                for attempt in 1..=2 {
                    assert!(
                        seen.insert(generation_id("run", case_id, profile, attempt)),
                        "collision"
                    );
                }
            }
        }
        assert_eq!(seen.len(), 8);
    }

    #[test]
    fn raw_evidence_is_addressed_per_attempt() {
        assert_ne!(
            raw_output_path("c1", "lite", 1),
            raw_output_path("c1", "lite", 2),
            "a retry must not overwrite the evidence it retried"
        );
        assert_ne!(raw_output_path("c1", "lite", 1), raw_output_path("c1", "standard", 1));
    }

    #[test]
    fn results_live_outside_the_repository() {
        let root = results_root("D:/Chronosaga");
        assert!(root.ends_with("benchmarks/p0.5"));
        assert!(
            !root.to_string_lossy().contains("repo"),
            "benchmark output must not land in the checkout"
        );
        assert_ne!(run_directory("D:/Chronosaga", "a"), run_directory("D:/Chronosaga", "b"));
    }

    #[test]
    fn an_accepted_outcome_becomes_a_row_with_output_and_no_errors() {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: true,
            duration_ms: 8000,
            raw: "{}".to_string(),
            narration: Some("Nulla di rilevante.".to_string()),
            dialogue: Vec::new(),
            tone_tags: vec!["tense".to_string()],
            validation_error: None,
            prompt_tokens: Some(400),
            completion_tokens: Some(120),
            tokens_per_second: Some(15.0),
            model: Some("lite".to_string()),
        };

        let record = record_generation("run_001", case, "lite", 1, &outcome);
        assert!(record.accepted);
        assert!(record.validator_errors.is_empty());
        assert!(record.normalized_output.is_some());
        assert!(!record.retry_used);
        assert_eq!(record.raw_output_path, raw_output_path(&case.id, "lite", 1));
    }

    #[test]
    fn a_rejected_outcome_keeps_its_reason_and_loses_its_output() {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: false,
            duration_ms: 9000,
            raw: "non json".to_string(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            validation_error: Some("unknown tone tag: epico".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };

        let record = record_generation("run_001", case, "standard", 2, &outcome);
        assert!(!record.accepted);
        assert_eq!(record.validator_errors, vec!["unknown tone tag: epico"]);
        assert!(record.normalized_output.is_none());
        assert!(record.retry_used, "attempt 2 is a retry");
    }

    #[test]
    fn rows_and_raw_evidence_land_where_the_reader_expects_them() {
        let directory = std::env::temp_dir().join("chronosaga-benchmark-persist");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();

        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: false,
            duration_ms: 1,
            raw: "raw model text".to_string(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            validation_error: Some("malformed JSON".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let record = record_generation("run_001", case, "lite", 1, &outcome);
        persist(&directory, &record, &outcome.raw).expect("must persist");

        let raw = fs::read_to_string(directory.join(&record.raw_output_path)).unwrap();
        assert_eq!(raw, "raw model text");

        let rows = fs::read_to_string(directory.join("generations.jsonl")).unwrap();
        assert_eq!(rows.lines().count(), 1);
        assert!(rows.contains("\"caseId\""));
        assert!(rows.contains("rawOutputPath"));

        // A second attempt appends rather than replacing the first.
        persist(&directory, &record_generation("run_001", case, "lite", 2, &outcome), "second")
            .unwrap();
        let rows = fs::read_to_string(directory.join("generations.jsonl")).unwrap();
        assert_eq!(rows.lines().count(), 2);
    }

    /// A handful of real cases end to end, to prove the harness works.
    ///
    /// P0.5-A smoke only. The full Lite-versus-Standard comparison is P0.5-B and
    /// is deliberately not run here: this is about the plumbing, not the verdict.
    #[test]
    fn smoke_run_executes_real_cases_through_the_application_boundary() {
        if !enabled() {
            eprintln!(
                "skipped: set {WORKSPACE_ENV} and {BENCHMARK_ENV}=1 to run against the real model"
            );
            return;
        }
        let profile = env::var("CHRONOSAGA_BENCHMARK_PROFILE").unwrap_or_else(|_| "lite".to_string());
        let smoke_size: usize = env::var("CHRONOSAGA_BENCHMARK_CASES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3);

        let workspace = env::var(WORKSPACE_ENV).expect("checked by enabled()");
        let suite = load_suite().expect("the suite must parse");
        let Some(manager) = crate::runtime_e2e::manager_for_profile(&profile) else {
            eprintln!("skipped: {profile} is not resolvable on this machine");
            return;
        };

        let run_id = format!(
            "smoke_{}_{}",
            profile,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_secs())
                .unwrap_or_default()
        );
        let directory = run_directory(&workspace, &run_id);
        fs::create_dir_all(&directory).expect("the run directory must be creatable");

        let mut watcher =
            crate::runtime_watcher::RuntimeWatcher::spawn(manager.clone()).expect("watcher");
        manager.start().expect("the runtime must start");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        while std::time::Instant::now() < deadline
            && manager.snapshot().state != crate::local_ai_runtime::RuntimePhase::Ready
        {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }

        let spec = manager.launch_spec();
        let provider = crate::inference::LocalModelProvider::new(
            spec.base_url(),
            spec.api_key().to_string(),
        )
        .expect("the loopback provider must build");

        let mut accepted = 0usize;
        let mut attempted = 0usize;

        for case in suite.cases.iter().take(smoke_size) {
            let contract = case_contract(case);
            let outcome = tauri::async_runtime::block_on(provider.generate(
                &system_prompt(case),
                &user_prompt(case),
                &contract,
            ))
            .expect("the request must reach the local runtime");

            let record = record_generation(&run_id, case, &profile, 1, &outcome);
            persist(&directory, &record, &outcome.raw).expect("evidence must persist");

            attempted += 1;
            if record.accepted {
                accepted += 1;
            }
            eprintln!(
                "{} [{}] {} in {} ms{}",
                case.id,
                case.task,
                if record.accepted { "ACCEPTED" } else { "REJECTED" },
                record.latency_ms,
                record
                    .validator_errors
                    .first()
                    .map(|error| format!(" ({error})"))
                    .unwrap_or_default()
            );
        }

        watcher.stop();
        let stopped = manager.stop();
        assert!(stopped.pid.is_none(), "the smoke run must leave no process behind");

        eprintln!("smoke run {run_id}: {accepted}/{attempted} accepted, evidence in {}", directory.display());

        // The harness is what is under test, not the model: a run that produced
        // rows and left no orphan has done its job even at 0 acceptance.
        let rows = fs::read_to_string(directory.join("generations.jsonl")).expect("rows");
        assert_eq!(rows.lines().count(), attempted);
    }

    #[test]
    fn the_runner_is_opt_in() {
        // Without both variables the harness does nothing, so the ordinary test
        // suite never depends on a multi-GB payload.
        if env::var(BENCHMARK_ENV).is_err() {
            assert!(!enabled());
        }
    }
}
