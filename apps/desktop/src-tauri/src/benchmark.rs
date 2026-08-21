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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BenchmarkCharacter {
    pub id: String,
    pub name: String,
    pub role: String,
    pub stress: i64,
    pub morale: i64,
    pub traits: Vec<String>,
    /// Present in the suite and in the TypeScript type. Without these the model
    /// is told who someone is but not whose side they are on or where they
    /// stand, which is half the grounding a political case depends on.
    #[serde(default)]
    pub faction_id: Option<String>,
    #[serde(default)]
    pub location_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BenchmarkMemory {
    pub id: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub turn: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BenchmarkDelta {
    pub turn: i64,
    pub source: String,
    pub changes: Vec<BenchmarkChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BenchmarkChange {
    #[serde(rename = "type")]
    pub change_type: String,
    pub key: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
        // Derived from the case, never assumed: a case that does not invite a
        // proposal gets exactly the production rejection.
        allow_event_proposals: case.constraints.allow_event_proposals,
        allow_memory_suggestions: case.constraints.allow_memory_suggestions,
        // Grounding for suggestions, from the case's own slice. A proposal about
        // an invented settlement is refused rather than counted.
        allowed_subject_ids: case_subject_ids(case),
        known_character_ids: case.characters.iter().map(|c| c.id.clone()).collect(),
    }
}

/// Every entity a proposal may legitimately be about.
///
/// The same notion of "in this scene" the evaluator uses: the characters, what
/// they belong to and where they are, and whatever the authoritative delta
/// touched.
fn case_subject_ids(case: &BenchmarkCase) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut push = |value: &str| {
        if !value.is_empty() && !ids.iter().any(|existing| existing == value) {
            ids.push(value.to_string());
        }
    };
    for character in &case.characters {
        push(&character.id);
        if let Some(faction) = &character.faction_id {
            push(faction);
        }
        if let Some(location) = &character.location_id {
            push(location);
        }
    }
    for change in &case.recent_delta.changes {
        for part in change.key.split('.') {
            push(part);
        }
    }
    if let Some(settlement) = case.world_state_slice.get("settlement") {
        if let Some(id) = settlement.get("id").and_then(|value| value.as_str()) {
            push(id);
        }
    }
    ids
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
    // The model is told the exact permitted item shape. Asking for "an object"
    // and then rejecting whatever arrives would measure the prompt, not the
    // model.
    let proposals = if case.constraints.allow_event_proposals {
        "event_proposals puo' contenere oggetti di questa forma esatta e di nessun'altra:          {\"subjectId\": \"<id presente nella scena>\", \"topic\": \"<poche parole>\",          \"rationale\": \"<perche'>\"}. Sono suggerimenti per il motore, mai effetti          applicati: niente numeri, niente cambi di stato"
    } else {
        "event_proposals deve essere un array vuoto"
    };
    let memories = if case.constraints.allow_memory_suggestions {
        "memory_suggestions puo' contenere oggetti di questa forma esatta e di nessun'altra:          {\"characterId\": \"<id di un personaggio presente>\", \"summary\": \"<cosa ricorda>\"}"
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
                let mut line = format!(
                    "- {} ({}), ruolo {}, stress {}, morale {}, tratti: {}",
                    character.id,
                    character.name,
                    character.role,
                    character.stress,
                    character.morale,
                    character.traits.join(", ")
                );
                if let Some(faction) = &character.faction_id {
                    line.push_str(&format!(", fazione {faction}"));
                }
                if let Some(location) = &character.location_id {
                    line.push_str(&format!(", si trova a {location}"));
                }
                line
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

/// The one generation configuration a benchmark run uses.
///
/// This is the source of truth in both directions: it builds the request that
/// reaches `llama-server`, and it builds the `context` block recorded with every
/// generation. There is deliberately no second place where a temperature or a
/// token budget is written down, because the moment there is, the evidence stops
/// describing the run.
///
/// `top_p` and `seed` are configured explicitly rather than left to the server.
/// A comparison between two models is only worth reading if the sampling was the
/// same for both, and "whatever the runtime happened to default to" is not a
/// value anyone can reproduce next month.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextConfiguration {
    pub context_size: u32,
    pub max_output_tokens: u32,
    pub temperature: f64,
    pub top_p: Option<f64>,
    pub seed: Option<i64>,
    pub reasoning: String,
}

/// Sampling the P0.5 suite runs at.
pub const BENCHMARK_TEMPERATURE: f64 = 0.3;
pub const BENCHMARK_MAX_OUTPUT_TOKENS: u32 = 400;
pub const BENCHMARK_TOP_P: f64 = 0.9;
pub const BENCHMARK_SEED: i64 = 7419;
/// Matches `--reasoning off` on the launch contract.
pub const BENCHMARK_REASONING: &str = "off";

/// The recorded configuration for a run at a given context size.
///
/// Context size is not a constant here: it comes from the verified model's
/// locked `contextTarget`, which is also what the launch contract passes as
/// `--ctx-size`. Writing it twice is exactly the drift this function prevents.
pub fn benchmark_context(context_size: u32) -> ContextConfiguration {
    ContextConfiguration {
        context_size,
        max_output_tokens: BENCHMARK_MAX_OUTPUT_TOKENS,
        temperature: BENCHMARK_TEMPERATURE,
        top_p: Some(BENCHMARK_TOP_P),
        seed: Some(BENCHMARK_SEED),
        reasoning: BENCHMARK_REASONING.to_string(),
    }
}

/// The same configuration as request parameters.
///
/// Derived, never re-typed: if the two ever disagree the recorded evidence is
/// wrong, and a test asserts they cannot.
pub fn request_parameters(context: &ContextConfiguration) -> crate::inference::GenerationParameters {
    crate::inference::GenerationParameters {
        temperature: context.temperature,
        max_output_tokens: context.max_output_tokens,
        top_p: context.top_p,
        seed: context.seed,
    }
}

/// Exactly which artifact answered, taken from the verified model.
///
/// Every field comes from the authoritative lock by way of `VerifiedModel`, so
/// nothing here is inferred from a path or a profile name. A record that cannot
/// name the bytes it measured is not evidence.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactIdentity {
    pub profile_id: String,
    pub family: String,
    pub quantization: String,
    pub artifact_filename: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub source: String,
    pub release_approved: bool,
}

pub fn artifact_identity(verified: &crate::model_lock::VerifiedModel) -> ArtifactIdentity {
    let model = verified.model();
    ArtifactIdentity {
        profile_id: model.profile_id().to_string(),
        family: model.family().to_string(),
        quantization: model.quantization().to_string(),
        artifact_filename: model.artifact_filename().to_string(),
        size_bytes: model.size_bytes(),
        sha256: model.expected_sha256().to_string(),
        source: model.source().label().to_string(),
        release_approved: model.release_approved(),
    }
}

/// What a run was for.
///
/// Completeness of metadata says a run *could* be reproduced; it says nothing
/// about whether the run answers the question the benchmark exists to answer. A
/// spotless three-case single-profile smoke on a clean checkout satisfies every
/// reproducibility field and still cannot support a Lite-versus-Standard
/// decision, so the purpose is declared rather than inferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    /// Plumbing evidence. One profile and a subset of cases are fine; it may
    /// never be treated as comparable evidence, however clean it is.
    Smoke,
    /// A run that intends to decide something. Held to full coverage.
    OfficialComparison,
}

impl RunKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Smoke => "smoke",
            Self::OfficialComparison => "official comparison",
        }
    }
}

/// What an official comparison has to have covered.
///
/// Passed in rather than hard-coded so P0.5-B states its own requirement and
/// this module does not quietly become the owner of that decision.
#[derive(Debug, Clone)]
pub struct CoverageRequirement {
    /// Every case the comparison must contain.
    pub required_case_ids: Vec<String>,
    /// Every profile that must have answered them.
    pub required_profiles: Vec<String>,
}

/// What a finished run actually covered.
#[derive(Debug, Clone, Default)]
pub struct RunCoverage {
    pub case_ids: Vec<String>,
    pub profiles: Vec<String>,
}

impl RunCoverage {
    /// Derive coverage from the rows a run produced.
    pub fn from_records(records: &[GenerationRecord]) -> Self {
        let mut coverage = Self::default();
        for record in records {
            if !coverage.case_ids.iter().any(|id| id == &record.case_id) {
                coverage.case_ids.push(record.case_id.clone());
            }
            if !coverage.profiles.iter().any(|id| id == &record.profile) {
                coverage.profiles.push(record.profile.clone());
            }
        }
        coverage
    }
}

/// Everything needed to reproduce a run, minus the weights themselves.
///
/// A result without this is an anecdote. With it, another machine can rebuild
/// the same commit, verify the same digests and re-run the same suite.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunMetadata {
    pub run_id: String,
    /// Declared purpose. A run cannot become official by accident.
    pub run_kind: RunKind,
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    run_kind: RunKind,
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
        run_kind,
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
    pub artifact: ArtifactIdentity,
    pub context: ContextConfiguration,
    /// SHA-256 over the exact prompts and case identity, so "the same inputs"
    /// is evidence rather than an assumption.
    pub input_fingerprint: String,
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
    /// Deterministic observation of the bytes at `raw_output_path`.
    pub raw_format: RawFormat,
    pub normalized_output: Option<NormalizedOutput>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedOutput {
    pub narration: String,
    pub dialogue: Vec<crate::inference::DialogueLine>,
    pub tone_tags: Vec<String>,
    pub event_proposals: Vec<crate::inference::EventProposal>,
    pub memory_suggestions: Vec<crate::inference::MemorySuggestion>,
}

/// What the raw response looked like, before the validator normalised it.
///
/// The application validator deliberately unwraps ```json fences, which is right
/// for the product and wrong for a benchmark case that asked for bare JSON: a
/// fenced answer would be accepted and the report would record full compliance.
///
/// A small deterministic observation is recorded here instead of the prose
/// itself. The text stays in `raw/<case>.<profile>.<attempt>.txt`; duplicating
/// it into every row would bloat the evidence for no gain, and making the
/// TypeScript report layer read files to find it out would put filesystem I/O
/// somewhere it does not belong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFormat {
    /// The response is exactly one JSON object and nothing else.
    pub bare_json: bool,
    /// A markdown code fence was present anywhere in the response.
    pub code_fence_present: bool,
    /// Text appeared outside the JSON object.
    pub wrapper_text_present: bool,
}

/// Observe the shape of a raw model response.
///
/// Structural only, and deliberately blunt: it answers "was this bare JSON?"
/// and, when it was not, which of the two usual reasons applied.
pub fn observe_raw_format(raw: &str) -> RawFormat {
    let trimmed = raw.trim();
    let code_fence_present = trimmed.contains("```");
    let bare_json = !code_fence_present && trimmed.starts_with('{') && trimmed.ends_with('}');
    RawFormat {
        bare_json,
        code_fence_present,
        wrapper_text_present: !bare_json && !trimmed.is_empty(),
    }
}

/// Turn one real inference outcome into a result row.
///
/// `input_fingerprint` is a parameter rather than something recomputed here, so
/// a retry cannot be recorded as if it had asked the original question.
///
/// Rejections keep their reason and lose their output; acceptances keep their
/// output and carry no error. The asymmetry is deliberate and is what the
/// TypeScript result validator enforces.
pub fn record_generation(
    run_id: &str,
    case: &BenchmarkCase,
    profile: &str,
    attempt: u32,
    artifact: ArtifactIdentity,
    context: ContextConfiguration,
    input_fingerprint: String,
    outcome: &crate::inference::InferenceOutcome,
) -> GenerationRecord {
    GenerationRecord {
        id: generation_id(run_id, &case.id, profile, attempt),
        run_id: run_id.to_string(),
        case_id: case.id.clone(),
        task: case.task.clone(),
        profile: profile.to_string(),
        artifact,
        context,
        input_fingerprint,
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
        // Derived from the same string that is about to be written to disk, so
        // the observation and the file can never describe different bytes.
        raw_format: observe_raw_format(&outcome.raw),
        normalized_output: outcome.accepted.then(|| NormalizedOutput {
            narration: outcome.narration.clone().unwrap_or_default(),
            dialogue: outcome.dialogue.clone(),
            tone_tags: outcome.tone_tags.clone(),
            event_proposals: outcome.event_proposals.clone(),
            memory_suggestions: outcome.memory_suggestions.clone(),
        }),
    }
}

/// SHA-256 over the exact inputs one attempt presents to a model.
///
/// Covers the suite identity, the case id and the two prompts **verbatim as
/// sent**. The prompts are parameters rather than something this function
/// regenerates, and that is the whole point: P0.5-B introduces retry prompts,
/// and a fingerprint that quietly recomputed the original wording would claim
/// two attempts were identical when they were not.
///
/// Two profiles answering the same case on the same attempt number must carry
/// the same fingerprint. A retry is allowed to differ from attempt 1 — that is
/// what makes it a retry — but if both profiles retried, they must have been
/// retried with the same words.
pub fn input_fingerprint(case: &BenchmarkCase, system: &str, user: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(SUITE_RELATIVE_PATH.as_bytes());
    hasher.update([0]);
    hasher.update(case.id.as_bytes());
    hasher.update([0]);
    hasher.update(case.task.as_bytes());
    hasher.update([0]);
    hasher.update(system.as_bytes());
    hasher.update([0]);
    hasher.update(user.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The fingerprint of a case's first attempt, which uses the suite's own prompts.
pub fn first_attempt_fingerprint(case: &BenchmarkCase) -> String {
    input_fingerprint(case, &system_prompt(case), &user_prompt(case))
}

/// Write the run metadata beside the rows it describes.
///
/// A run directory without this is unattributable, so it is written before the
/// first generation rather than at the end: a crashed run still says what it was.
pub fn persist_metadata(
    run_directory: &std::path::Path,
    metadata: &RunMetadata,
) -> Result<(), String> {
    fs::create_dir_all(run_directory)
        .map_err(|error| format!("unable to create {}: {error}", run_directory.display()))?;
    let path = run_directory.join("metadata.json");
    let body = serde_json::to_string_pretty(metadata)
        .map_err(|error| format!("unserialisable metadata: {error}"))?;
    fs::write(&path, body).map_err(|error| format!("unable to write {}: {error}", path.display()))
}

/// Whether a run may be published as comparable evidence.
///
/// Two questions, and both have to be answered yes. **Could** this be
/// reproduced — clean checkout, full commit, verified runtime, real host? And
/// **does it answer the question** — was it declared official, and did it
/// actually cover the cases and profiles the comparison needs?
///
/// The second question is why `run_kind` exists. A smoke pass on a clean
/// checkout satisfies every reproducibility field there is and still cannot
/// support a Lite-versus-Standard decision: it ran three cases against one
/// model. Completeness of metadata is not evidence of completeness of work, and
/// inferring official status from tidy metadata is exactly the mistake this
/// refuses to make.
pub fn official_run_verdict(
    metadata: &RunMetadata,
    coverage: &RunCoverage,
    required: &CoverageRequirement,
) -> Result<(), String> {
    let mut missing = Vec::new();

    // Declared purpose first: a smoke run is refused before anything else is
    // even examined, because no amount of rigour makes it the right run.
    if metadata.run_kind != RunKind::OfficialComparison {
        return Err(format!(
            "run {} was recorded as a {} run, which is plumbing evidence and never \
             comparable evidence, however complete its metadata is",
            metadata.run_id,
            metadata.run_kind.label()
        ));
    }

    if metadata.git_dirty {
        missing.push("the checkout was dirty, so nobody else can reproduce it".to_string());
    }
    if metadata.git_commit.len() != 40
        || !metadata.git_commit.chars().all(|c| c.is_ascii_hexdigit())
    {
        missing.push(format!(
            "the commit '{}' is not a full 40-character SHA",
            metadata.git_commit
        ));
    }
    if metadata.runtime_release_tag.trim().is_empty() {
        missing.push("the runtime release tag is absent".to_string());
    }
    match metadata.runtime_executable_sha256.as_deref() {
        Some(digest) if digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()) => {}
        Some(digest) => missing.push(format!("the runtime digest '{digest}' is not a SHA-256")),
        None => missing.push("the runtime executable digest is absent".to_string()),
    }
    if metadata.host.cpu.trim().is_empty()
        || metadata.host.logical_cores == 0
        || metadata.host.total_ram_mb == 0
    {
        missing.push("the host facts are incomplete".to_string());
    }
    if metadata.suite_version.trim().is_empty() || metadata.suite_schema_version == 0 {
        missing.push("the suite identity is incomplete".to_string());
    }

    // Coverage: what the run actually did, not what it meant to do.
    let absent_profiles: Vec<&str> = required
        .required_profiles
        .iter()
        .filter(|wanted| !coverage.profiles.iter().any(|had| &had == wanted))
        .map(String::as_str)
        .collect();
    if !absent_profiles.is_empty() {
        missing.push(format!(
            "no generations for {}, so there is nothing to compare",
            absent_profiles.join(", ")
        ));
    }

    let absent_cases: Vec<&str> = required
        .required_case_ids
        .iter()
        .filter(|wanted| !coverage.case_ids.iter().any(|had| &had == wanted))
        .map(String::as_str)
        .collect();
    if !absent_cases.is_empty() {
        let shown: Vec<&str> = absent_cases.iter().take(5).copied().collect();
        missing.push(format!(
            "{} of {} required cases were never run ({}{})",
            absent_cases.len(),
            required.required_case_ids.len(),
            shown.join(", "),
            if absent_cases.len() > shown.len() { ", ..." } else { "" }
        ));
    }

    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "refusing to record run {} as comparable evidence: {}.",
        metadata.run_id,
        missing.join("; ")
    ))
}

/// The coverage a full P0.5-B comparison requires: every case, both profiles.
pub fn full_comparison_requirement(suite: &BenchmarkSuite) -> CoverageRequirement {
    CoverageRequirement {
        required_case_ids: suite.cases.iter().map(|case| case.id.clone()).collect(),
        required_profiles: vec!["lite".to_string(), "standard".to_string()],
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

/// Owns a started sidecar for the duration of a benchmark, and ends it.
///
/// The previous shape relied on reaching the bottom of the function: a request
/// that timed out, lost its connection or came back as an HTTP error panicked
/// through the two shutdown calls and left `llama-server` holding port 8081.
/// A guard cannot be skipped by an early return or a panic, which is exactly the
/// property that was missing.
///
/// `Drop` never panics — a cleanup failure is reported on stderr rather than
/// unwinding, because panicking while already unwinding aborts the process and
/// destroys the diagnosis of whatever actually went wrong.
struct BenchmarkRuntimeGuard {
    manager: std::sync::Arc<crate::local_ai_runtime::LocalAiRuntimeManager>,
    watcher: Option<crate::runtime_watcher::RuntimeWatcher>,
    stopped: bool,
}

impl BenchmarkRuntimeGuard {
    /// Start the runtime and take ownership of stopping it.
    fn start(
        manager: std::sync::Arc<crate::local_ai_runtime::LocalAiRuntimeManager>,
    ) -> Result<Self, String> {
        let watcher = crate::runtime_watcher::RuntimeWatcher::spawn(manager.clone())?;
        let guard = Self {
            manager,
            watcher: Some(watcher),
            stopped: false,
        };
        if let Err(error) = guard.manager.start() {
            // The guard already exists, so this failure is cleaned up by Drop
            // rather than leaking a half-started runtime.
            return Err(error);
        }
        Ok(guard_started(guard))
    }

    fn manager(&self) -> &crate::local_ai_runtime::LocalAiRuntimeManager {
        &self.manager
    }

    /// Wait for the model to be serving, or give up.
    fn wait_until_ready(&self, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if self.manager.snapshot().state == crate::local_ai_runtime::RuntimePhase::Ready {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        false
    }

    /// Stop the watcher and reap the child.
    ///
    /// The flag is set **after** the child is confirmed gone, never before. A
    /// kill can fail transiently — the manager deliberately keeps the pid in
    /// that case so another attempt is possible — and marking cleanup complete
    /// on the way in would turn the later `Drop` into a no-op that leaves the
    /// orphan holding the port. Recording the intent is not the same as having
    /// done the thing.
    ///
    /// Idempotent only once it has actually succeeded: after a confirmed stop
    /// every further call returns `Ok` without touching anything.
    fn shutdown(&mut self) -> Result<(), String> {
        if self.stopped {
            return Ok(());
        }

        // The watcher can go on the first attempt: it only polls, and stopping
        // it twice is harmless. The child is the part worth retrying.
        if let Some(mut watcher) = self.watcher.take() {
            watcher.stop();
        }

        let snapshot = self.manager.stop();
        if let Some(pid) = snapshot.pid {
            // Ownership is retained on purpose. `stopped` stays false so Drop
            // will try again.
            return Err(format!(
                "benchmark runtime process {pid} survived shutdown: {}",
                snapshot.last_error.unwrap_or_else(|| "no detail".to_string())
            ));
        }

        self.stopped = true;
        Ok(())
    }
}

/// Marker for readability at the construction site.
fn guard_started(guard: BenchmarkRuntimeGuard) -> BenchmarkRuntimeGuard {
    guard
}

impl Drop for BenchmarkRuntimeGuard {
    fn drop(&mut self) {
        // A best-effort second attempt. If the explicit shutdown already
        // succeeded this is a no-op; if it failed because a kill did not take,
        // this is the retry that clears the orphan.
        if let Err(error) = self.shutdown() {
            // Never panic here: this may run while already unwinding, and an
            // abort would bury the original failure. The message is the record.
            eprintln!("benchmark cleanup failed after retry: {error}");
        }
    }
}

/// Which cases a smoke pass runs.
///
/// Named ids when asked for, otherwise the first `count`. P0.5-A needs to reach
/// specific shapes — a zero-speaker description, a proposal, a suggestion — and
/// taking the first three would only ever exercise dialogue.
fn cases_to_run(suite: &BenchmarkSuite, count: usize) -> Vec<&BenchmarkCase> {
    match env::var("CHRONOSAGA_BENCHMARK_CASE_IDS") {
        Ok(ids) if !ids.trim().is_empty() => ids
            .split(',')
            .map(str::trim)
            .filter_map(|id| suite.cases.iter().find(|case| case.id == id))
            .collect(),
        _ => suite.cases.iter().take(count).collect(),
    }
}

/// When a run started, as a timestamp a human can read.
///
/// Recorded as UTC seconds since the epoch rendered in RFC 3339 shape. A bare
/// integer is technically a timestamp and practically useless in a report.
fn started_at() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default();
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    // Civil-from-days, Howard Hinnant's algorithm. No date crate for one field.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!(
        "{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

/// The commit a run was made from, or nothing when git cannot be asked.
fn git_commit() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../"))
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Whether the checkout had uncommitted changes when the run started.
fn git_dirty() -> bool {
    std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../"))
        .output()
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(true)
}

/// Real facts about the machine that produced a run.
fn host_facts() -> HostFacts {
    use sysinfo::System;
    let mut system = System::new_all();
    system.refresh_all();
    HostFacts {
        os: System::long_os_version().unwrap_or_else(|| "unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        cpu: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        logical_cores: system.cpus().len(),
        total_ram_mb: system.total_memory() / 1024 / 1024,
    }
}

fn enabled() -> bool {
    env::var(BENCHMARK_ENV).ok().as_deref() == Some("1")
        && env::var(WORKSPACE_ENV).is_ok_and(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The locked identity of a profile, for tests that need a real-shaped one.
    fn test_artifact(profile: &str) -> ArtifactIdentity {
        let (family, filename, size, sha) = if profile == "lite" {
            (
                "Qwen3-1.7B",
                "Qwen3-1.7B-Q4_K_M.gguf",
                1_282_439_264u64,
                "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5",
            )
        } else {
            (
                "SmolLM3-3B",
                "SmolLM3-Q4_K_M.gguf",
                1_915_305_312u64,
                "8334b850b7bd46238c16b0c550df2138f0889bf433809008cc17a8b05761863e",
            )
        };
        ArtifactIdentity {
            profile_id: profile.to_string(),
            family: family.to_string(),
            quantization: "Q4_K_M".to_string(),
            artifact_filename: filename.to_string(),
            size_bytes: size,
            sha256: sha.to_string(),
            source: "user model library".to_string(),
            release_approved: false,
        }
    }

    fn test_metadata(dirty: bool) -> RunMetadata {
        official_metadata(dirty, RunKind::OfficialComparison)
    }

    fn official_metadata(dirty: bool, kind: RunKind) -> RunMetadata {
        let suite = load_suite().unwrap();
        let lock = crate::runtime_e2e::checkout_runtime_lock().expect("the lock must parse");
        new_run_metadata(
            "run_001",
            kind,
            "2026-08-21T00:00:00Z",
            &suite,
            "9599f38d846f29907286e53200f51a703af4f53c",
            dirty,
            &lock.release_tag,
            Some(lock.executable_sha256.clone()),
            HostFacts {
                os: "Windows 11".to_string(),
                arch: "x86_64".to_string(),
                cpu: "i7-13700KF".to_string(),
                logical_cores: 24,
                total_ram_mb: 65536,
            },
        )
    }

    #[test]
    fn the_recorded_configuration_is_the_configuration_that_was_requested() {
        // The whole point of P1-A: one source, two consumers. If these ever
        // disagree, the evidence describes a run that did not happen.
        let context = benchmark_context(4096);
        let parameters = request_parameters(&context);

        assert_eq!(parameters.temperature, context.temperature);
        assert_eq!(parameters.max_output_tokens, context.max_output_tokens);
        assert_eq!(parameters.top_p, context.top_p);
        assert_eq!(parameters.seed, context.seed);

        // Explicitly configured rather than left to the runtime, so another
        // machine can reproduce the sampling.
        assert_eq!(context.top_p, Some(BENCHMARK_TOP_P));
        assert_eq!(context.seed, Some(BENCHMARK_SEED));
        assert_eq!(context.reasoning, BENCHMARK_REASONING);
    }

    #[test]
    fn the_context_size_comes_from_the_model_not_from_a_constant() {
        assert_eq!(benchmark_context(4096).context_size, 4096);
        assert_eq!(benchmark_context(8192).context_size, 8192);
    }

    #[test]
    fn the_product_smoke_keeps_its_own_parameters_and_says_so() {
        // The smoke deliberately leaves top_p and seed to the runtime. That is a
        // legitimate choice; recording an invented value for them would not be.
        let smoke = crate::inference::GenerationParameters::smoke();
        assert_eq!(smoke.temperature, 0.3);
        assert_eq!(smoke.max_output_tokens, 400);
        assert_eq!(smoke.top_p, None);
        assert_eq!(smoke.seed, None);
    }

    #[test]
    fn runtime_identity_is_read_from_the_authoritative_lock() {
        // Not a literal anywhere in the runner: the same file the launcher and
        // `pnpm verify:local-ai-runtime` agree on.
        let lock = crate::runtime_e2e::checkout_runtime_lock().expect("the lock must parse");
        assert_eq!(lock.release_tag, "b10343");
        assert_eq!(lock.executable_sha256.len(), 64);

        let metadata = test_metadata(false);
        assert_eq!(metadata.runtime_release_tag, lock.release_tag);
        assert_eq!(
            metadata.runtime_executable_sha256.as_deref(),
            Some(lock.executable_sha256.as_str())
        );
    }

    /// A requirement small enough to state in a test.
    fn requirement() -> CoverageRequirement {
        CoverageRequirement {
            required_case_ids: vec!["ai_case_001".to_string(), "ai_case_002".to_string()],
            required_profiles: vec!["lite".to_string(), "standard".to_string()],
        }
    }

    /// Coverage that satisfies [`requirement`].
    fn full_coverage() -> RunCoverage {
        RunCoverage {
            case_ids: vec!["ai_case_001".to_string(), "ai_case_002".to_string()],
            profiles: vec!["lite".to_string(), "standard".to_string()],
        }
    }

    /// What a default smoke actually covers: a few cases, one model.
    fn smoke_coverage() -> RunCoverage {
        RunCoverage {
            case_ids: vec!["ai_case_001".to_string()],
            profiles: vec!["lite".to_string()],
        }
    }

    #[test]
    fn a_spotless_smoke_is_still_not_comparable_evidence() {
        // The finding, exactly: clean checkout, full commit, verified runtime,
        // real host — and it ran one model over a handful of cases. Nothing
        // about that supports a Lite-versus-Standard decision.
        let metadata = official_metadata(false, RunKind::Smoke);
        let refused = official_run_verdict(&metadata, &full_coverage(), &requirement())
            .expect_err("a smoke run is never official");

        assert!(refused.contains("smoke"), "{refused}");
        assert!(refused.contains("plumbing evidence"), "{refused}");
        assert!(
            refused.contains("however complete its metadata is"),
            "the refusal must say why tidy metadata does not help: {refused}"
        );
    }

    #[test]
    fn a_dirty_smoke_is_refused_for_being_a_smoke_first() {
        // Purpose is checked before anything else: the answer is the same and
        // the reason is the honest one.
        let metadata = official_metadata(true, RunKind::Smoke);
        let refused = official_run_verdict(&metadata, &smoke_coverage(), &requirement())
            .expect_err("still not official");
        assert!(refused.contains("smoke"), "{refused}");
    }

    #[test]
    fn an_official_run_missing_a_profile_is_refused() {
        let coverage = RunCoverage {
            case_ids: full_coverage().case_ids,
            profiles: vec!["lite".to_string()],
        };
        let refused = official_run_verdict(&test_metadata(false), &coverage, &requirement())
            .expect_err("one model is not a comparison");
        assert!(refused.contains("no generations for standard"), "{refused}");
        assert!(refused.contains("nothing to compare"), "{refused}");
    }

    #[test]
    fn an_official_run_missing_cases_is_refused_and_names_them() {
        let coverage = RunCoverage {
            case_ids: vec!["ai_case_001".to_string()],
            profiles: full_coverage().profiles,
        };
        let refused = official_run_verdict(&test_metadata(false), &coverage, &requirement())
            .expect_err("a subset is not the suite");
        assert!(refused.contains("1 of 2 required cases"), "{refused}");
        assert!(refused.contains("ai_case_002"), "{refused}");
    }

    #[test]
    fn a_complete_official_run_is_accepted() {
        official_run_verdict(&test_metadata(false), &full_coverage(), &requirement())
            .expect("declared official, reproducible, and fully covered");
    }

    #[test]
    fn a_smoke_cannot_masquerade_as_official_through_serialisation() {
        // The kind travels with the evidence. A smoke run written to disk and
        // read back is still a smoke run: there is no field a later reader can
        // mistake for officialdom, and an absent kind is not silently permissive.
        let metadata = official_metadata(false, RunKind::Smoke);
        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"runKind\":\"smoke\""), "{json}");

        let round_tripped: RunMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(round_tripped.run_kind, RunKind::Smoke);
        assert!(official_run_verdict(&round_tripped, &full_coverage(), &requirement()).is_err());

        // And a payload with the field removed does not deserialise into an
        // accidentally-official run.
        let stripped = json.replace("\"runKind\":\"smoke\",", "");
        assert!(
            serde_json::from_str::<RunMetadata>(&stripped).is_err(),
            "a run with no declared purpose must not parse"
        );
    }

    #[test]
    fn an_official_run_needs_a_runtime_digest_even_when_everything_else_is_clean() {
        // The case the earlier verdict let through: a spotless run that cannot
        // say which llama-server binary produced it.
        let mut metadata = test_metadata(false);
        metadata.runtime_executable_sha256 = None;
        let refused = official_run_verdict(&metadata, &full_coverage(), &requirement())
            .expect_err("no digest, no evidence");
        assert!(refused.contains("runtime executable digest is absent"), "{refused}");

        metadata.runtime_executable_sha256 = Some("not-a-digest".to_string());
        let refused = official_run_verdict(&metadata, &full_coverage(), &requirement())
            .expect_err("a stub is not a digest");
        assert!(refused.contains("not a SHA-256"), "{refused}");
    }

    #[test]
    fn an_official_run_needs_a_full_commit_and_real_host_facts() {
        let mut metadata = test_metadata(false);
        metadata.git_commit = "9599f38".to_string();
        let refused = official_run_verdict(&metadata, &full_coverage(), &requirement())
            .expect_err("a short sha is not attribution");
        assert!(refused.contains("40-character"), "{refused}");

        let mut metadata = test_metadata(false);
        metadata.runtime_release_tag = String::new();
        assert!(official_run_verdict(&metadata, &full_coverage(), &requirement()).is_err());

        let mut metadata = test_metadata(false);
        metadata.host.logical_cores = 0;
        let refused = official_run_verdict(&metadata, &full_coverage(), &requirement())
            .expect_err("host facts are required");
        assert!(refused.contains("host facts"), "{refused}");
    }

    #[test]
    fn an_official_run_refuses_a_dirty_checkout() {
        let refused = official_run_verdict(&test_metadata(true), &full_coverage(), &requirement())
            .expect_err("a dirty checkout cannot be official");
        assert!(refused.contains("dirty"), "{refused}");
        assert!(refused.contains("reproduce"), "{refused}");

        official_run_verdict(&test_metadata(false), &full_coverage(), &requirement())
            .expect("a clean checkout is fine");
    }

    #[test]
    fn the_full_comparison_requirement_is_the_whole_suite_and_both_profiles() {
        let suite = load_suite().unwrap();
        let required = full_comparison_requirement(&suite);
        assert_eq!(required.required_case_ids.len(), suite.cases.len());
        assert_eq!(required.required_profiles, vec!["lite", "standard"]);
    }

    #[test]
    fn coverage_is_derived_from_the_rows_a_run_actually_produced() {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: true,
            duration_ms: 1,
            raw: "{}".to_string(),
            narration: Some("ok".to_string()),
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: None,
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let rows = vec![
            record_generation("r", case, "lite", 1, test_artifact("lite"),
                benchmark_context(4096), first_attempt_fingerprint(case), &outcome),
            record_generation("r", case, "standard", 1, test_artifact("standard"),
                benchmark_context(4096), first_attempt_fingerprint(case), &outcome),
        ];
        let coverage = RunCoverage::from_records(&rows);
        assert_eq!(coverage.case_ids, vec![case.id.clone()]);
        assert_eq!(coverage.profiles, vec!["lite".to_string(), "standard".to_string()]);
    }

    #[test]
    fn metadata_lands_beside_the_rows_it_describes() {
        let directory = std::env::temp_dir().join("chronosaga-benchmark-metadata");
        let _ = fs::remove_dir_all(&directory);
        persist_metadata(&directory, &test_metadata(false)).expect("must persist");

        let written = fs::read_to_string(directory.join("metadata.json")).unwrap();
        for required in [
            "gitCommit",
            "gitDirty",
            "suiteVersion",
            "suiteSchemaVersion",
            "runnerVersion",
            "runtimeReleaseTag",
            "runtimeExecutableSha256",
            "host",
        ] {
            assert!(written.contains(required), "metadata.json lacks {required}");
        }
        assert!(!written.contains(".gguf"), "metadata carries identity, not payload");
    }

    #[test]
    fn the_same_case_fingerprints_identically_for_every_profile() {
        // "Same inputs" becomes evidence: the fingerprint covers the suite, the
        // case and both prompts verbatim, and no profile is part of it.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let first = first_attempt_fingerprint(case);
        assert_eq!(first, first_attempt_fingerprint(case));
        assert_eq!(first.len(), 64);

        let other = first_attempt_fingerprint(&suite.cases[1]);
        assert_ne!(first, other, "different cases must fingerprint differently");
    }

    #[test]
    fn a_changed_prompt_changes_the_fingerprint() {
        let suite = load_suite().unwrap();
        let mut case = suite.cases[0].clone();
        let before = first_attempt_fingerprint(&case);
        case.constraints.max_narration_chars += 1;
        assert_ne!(before, first_attempt_fingerprint(&case));
    }

    #[test]
    fn a_retry_prompt_fingerprints_differently_from_the_first_attempt() {
        // The reason the prompts are parameters. When P0.5-B retries a case with
        // corrective wording, the record must say it asked something else.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let system = system_prompt(case);
        let user = user_prompt(case);

        let first = input_fingerprint(case, &system, &user);
        let retry = input_fingerprint(
            case,
            &system,
            &format!("{user}\n\nIl tuo output precedente non era valido. Riprova."),
        );

        assert_ne!(first, retry, "a retry that asked more must not look identical");
        assert_eq!(first, first_attempt_fingerprint(case));
    }

    #[test]
    fn the_fingerprint_cannot_be_regenerated_behind_the_callers_back() {
        // record_generation takes the fingerprint; it does not rebuild prompts.
        // If it ever did, this record would silently disagree with what was sent.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: false,
            duration_ms: 1,
            raw: String::new(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: Some("bad".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };

        let retry_fingerprint = input_fingerprint(case, "system", "retry user prompt");
        let record = record_generation(
            "run_001",
            case,
            "lite",
            2,
            test_artifact("lite"),
            benchmark_context(4096),
            retry_fingerprint.clone(),
            &outcome,
        );

        assert_eq!(record.input_fingerprint, retry_fingerprint);
        assert_ne!(record.input_fingerprint, first_attempt_fingerprint(case));
        assert!(record.retry_used);
    }

    #[test]
    fn a_record_names_the_exact_artifact_and_configuration() {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = crate::inference::InferenceOutcome {
            accepted: true,
            duration_ms: 1,
            raw: "{}".to_string(),
            narration: Some("ok".to_string()),
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: None,
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let record = record_generation(
            "run_001",
            case,
            "lite",
            1,
            test_artifact("lite"),
            benchmark_context(4096),
            first_attempt_fingerprint(case),
            &outcome,
        );

        assert_eq!(record.artifact.profile_id, "lite");
        assert_eq!(record.artifact.sha256.len(), 64);
        assert!(!record.artifact.release_approved);
        assert_eq!(record.context.context_size, 4096);
        assert_eq!(record.input_fingerprint, first_attempt_fingerprint(case));
    }

    #[test]
    fn artifact_identity_comes_from_the_verified_model() {
        // Not from the path, not from the profile name: from the lock, by way of
        // the model that actually passed its digest.
        let directory = std::env::temp_dir().join("chronosaga-benchmark-identity");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let bytes = b"pretend weights".to_vec();
        let path = directory.join("Qwen3-1.7B-Q4_K_M.gguf");
        fs::write(&path, &bytes).unwrap();

        use sha2::{Digest, Sha256};
        let digest: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let resolved = crate::model_lock::ResolvedModel::for_test_with(
            "lite",
            path,
            4096,
            bytes.len() as u64,
            &digest,
        );
        let verified = resolved.verify_integrity().expect("must verify");
        let identity = artifact_identity(&verified);

        assert_eq!(identity.profile_id, "lite");
        assert_eq!(identity.family, "Qwen3-1.7B");
        assert_eq!(identity.quantization, "Q4_K_M");
        assert_eq!(identity.artifact_filename, "Qwen3-1.7B-Q4_K_M.gguf");
        assert_eq!(identity.sha256, digest);
        assert_eq!(identity.size_bytes, bytes.len() as u64);
        assert!(!identity.release_approved);
    }

    /// The exact bytes a run writes, as one object the TypeScript side can read.
    fn interop_fixture() -> serde_json::Value {
        let suite = load_suite().unwrap();
        let case = suite.cases.iter().find(|case| case.id == "ai_case_001").unwrap();
        let accepted = crate::inference::InferenceOutcome {
            accepted: true,
            duration_ms: 8916,
            raw: "{}".to_string(),
            narration: Some("La riserva d'acqua scende.".to_string()),
            dialogue: vec![crate::inference::DialogueLine {
                speaker_id: "mara_001".to_string(),
                text: "Dobbiamo razionare.".to_string(),
            }],
            tone_tags: vec!["tense".to_string()],
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: None,
            prompt_tokens: Some(512),
            completion_tokens: Some(161),
            tokens_per_second: Some(18.1),
            model: Some("lite".to_string()),
        };
        let rejected = crate::inference::InferenceOutcome {
            accepted: false,
            duration_ms: 26326,
            // Fenced on purpose: the fixture has to carry a row whose raw shape
            // differs from bare JSON, or the strict-JSON evidence would never be
            // exercised across the language boundary.
            raw: "```json
{\"narration\": \"...\"}
```".to_string(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: Some("unknown tone tag: epico".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };

        serde_json::json!({
            "metadata": test_metadata(false),
            "generations": [
                record_generation("run_001", case, "lite", 1,
                    test_artifact("lite"), benchmark_context(4096),
                    first_attempt_fingerprint(case), &accepted),
                record_generation("run_001", case, "standard", 1,
                    test_artifact("standard"), benchmark_context(4096),
                    first_attempt_fingerprint(case), &rejected),
            ],
        })
    }

    #[test]
    fn what_rust_writes_is_what_typescript_validates() {
        // A contract test in the literal sense: the fixture under
        // packages/ai-benchmark/tests/fixtures is produced by this serializer and
        // consumed by the TypeScript validateRun. If the Rust shape drifts, this
        // fails here; if the TypeScript contract drifts, it fails there. Neither
        // side can move alone.
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/ai-benchmark/tests/fixtures/rust-run.json");
        let produced = serde_json::to_string_pretty(&interop_fixture()).unwrap() + "\n";

        if env::var("CHRONOSAGA_UPDATE_FIXTURES").ok().as_deref() == Some("1") {
            fs::create_dir_all(fixture_path.parent().unwrap()).unwrap();
            fs::write(&fixture_path, &produced).unwrap();
            return;
        }

        let committed = fs::read_to_string(&fixture_path).unwrap_or_else(|error| {
            panic!(
                "missing {}: {error}. Regenerate with CHRONOSAGA_UPDATE_FIXTURES=1",
                fixture_path.display()
            )
        });
        assert_eq!(
            committed.replace("\r\n", "\n"),
            produced,
            "the Rust result shape changed; regenerate the fixture and check the \
             TypeScript contract still accepts it"
        );
    }

    #[test]
    fn bare_json_is_recognised_as_bare() {
        let observed = observe_raw_format("{\"narration\": \"ok\"}");
        assert!(observed.bare_json);
        assert!(!observed.code_fence_present);
        assert!(!observed.wrapper_text_present);
    }

    #[test]
    fn a_code_fence_is_recorded_even_though_the_validator_unwraps_it() {
        // The exact gap: the product validator accepts this, and the benchmark
        // case that demanded bare JSON must still be able to see the fence.
        let observed = observe_raw_format("```json\n{\"narration\": \"ok\"}\n```");
        assert!(!observed.bare_json);
        assert!(observed.code_fence_present);
    }

    #[test]
    fn prose_around_the_object_is_recorded_as_wrapper_text() {
        let observed = observe_raw_format("Ecco la scena:\n{\"narration\": \"ok\"}\nSpero vada bene.");
        assert!(!observed.bare_json);
        assert!(!observed.code_fence_present);
        assert!(observed.wrapper_text_present);
    }

    #[test]
    fn the_raw_format_describes_the_bytes_that_were_written() {
        // Row and file must agree: both come from the same string.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let fenced = "```json\n{\"narration\": \"ok\"}\n```";
        let outcome = crate::inference::InferenceOutcome {
            accepted: true,
            duration_ms: 1,
            raw: fenced.to_string(),
            narration: Some("ok".to_string()),
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: None,
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let record = record_generation(
            "run_001", case, "lite", 1, test_artifact("lite"), benchmark_context(4096),
            first_attempt_fingerprint(case), &outcome,
        );

        assert_eq!(record.raw_format, observe_raw_format(fenced));
        assert!(record.raw_format.code_fence_present);
        assert!(!record.raw_format.bare_json);
    }

    #[test]
    fn a_record_carries_every_field_the_typescript_contract_requires() {
        let value = interop_fixture();
        let generation = &value["generations"][0];
        for required in [
            "id", "runId", "caseId", "task", "profile", "artifact", "context",
            "inputFingerprint", "attempt", "accepted", "validatorErrors", "retryUsed",
            "fallbackUsed", "fallbackProfile", "latencyMs", "tokensGenerated",
            "tokensPerSecond", "rawOutputPath", "normalizedOutput",
        ] {
            assert!(!generation[required].is_null() || required == "fallbackProfile",
                "generation lacks {required}");
        }
        for required in [
            "profileId", "family", "quantization", "artifactFilename", "sizeBytes",
            "sha256", "source", "releaseApproved",
        ] {
            assert!(!generation["artifact"][required].is_null(), "artifact lacks {required}");
        }
        for required in ["contextSize", "maxOutputTokens", "temperature", "reasoning"] {
            assert!(!generation["context"][required].is_null(), "context lacks {required}");
        }
    }

    // ---------------------------------------------------------------------
    // Sidecar lifecycle
    // ---------------------------------------------------------------------

    /// A process that can be started, observed and killed, without an OS.
    struct FakeProcess {
        alive: std::sync::Mutex<Option<u32>>,
        kills: std::sync::atomic::AtomicUsize,
        /// How many kill attempts must fail before one is allowed to work.
        ///
        /// A transient kill failure is exactly the case the guard has to survive:
        /// the manager keeps the pid so another attempt is possible, and Drop is
        /// that attempt.
        failing_kills: std::sync::atomic::AtomicUsize,
        path: PathBuf,
    }

    impl FakeProcess {
        fn new() -> std::sync::Arc<Self> {
            Self::refusing(0)
        }

        /// A process whose first `attempts` kills fail.
        fn refusing(attempts: usize) -> std::sync::Arc<Self> {
            std::sync::Arc::new(Self {
                alive: std::sync::Mutex::new(None),
                kills: std::sync::atomic::AtomicUsize::new(0),
                failing_kills: std::sync::atomic::AtomicUsize::new(attempts),
                path: PathBuf::from("llama-server.exe"),
            })
        }
        fn is_alive(&self) -> bool {
            self.alive.lock().unwrap().is_some()
        }
        fn kill_count(&self) -> usize {
            self.kills.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    struct SharedProcess(std::sync::Arc<FakeProcess>);

    impl crate::local_ai_runtime::ProcessBackend for SharedProcess {
        fn binary_present(&self) -> bool {
            true
        }
        fn binary_path(&self) -> &std::path::Path {
            &self.0.path
        }
        fn spawn(&self, _spec: &crate::local_ai_runtime::LaunchSpec) -> Result<u32, String> {
            *self.0.alive.lock().unwrap() = Some(4321);
            Ok(4321)
        }
        fn observe(&self, _pid: u32) -> crate::local_ai_runtime::ProcessObservation {
            if self.0.is_alive() {
                crate::local_ai_runtime::ProcessObservation::Running
            } else {
                crate::local_ai_runtime::ProcessObservation::Exited
            }
        }
        fn kill(&self, pid: u32) -> Result<(), String> {
            self.0.kills.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let remaining = self.0.failing_kills.load(std::sync::atomic::Ordering::SeqCst);
            if remaining > 0 {
                self.0
                    .failing_kills
                    .store(remaining - 1, std::sync::atomic::Ordering::SeqCst);
                // The process is still alive: the manager must keep the pid.
                return Err(format!("access denied terminating {pid}"));
            }
            *self.0.alive.lock().unwrap() = None;
            Ok(())
        }
    }

    struct AlwaysReady;
    impl crate::local_ai_runtime::HealthProbe for AlwaysReady {
        fn poll(&self, _endpoint: &str) -> crate::local_ai_runtime::HealthOutcome {
            crate::local_ai_runtime::HealthOutcome::Ready
        }
    }

    struct FrozenClock;
    impl crate::local_ai_runtime::Clock for FrozenClock {
        fn now_ms(&self) -> u64 {
            0
        }
    }

    fn fake_manager(
        process: std::sync::Arc<FakeProcess>,
    ) -> std::sync::Arc<crate::local_ai_runtime::LocalAiRuntimeManager> {
        std::sync::Arc::new(crate::local_ai_runtime::LocalAiRuntimeManager::new(
            crate::local_ai_runtime::RuntimeConfig::loopback(),
            Box::new(SharedProcess(process)),
            Box::new(AlwaysReady),
            Box::new(FrozenClock),
        ))
    }

    #[test]
    fn the_guard_reaps_the_sidecar_on_the_normal_path() {
        let process = FakeProcess::new();
        {
            let mut guard = BenchmarkRuntimeGuard::start(fake_manager(process.clone()))
                .expect("must start");
            assert!(process.is_alive(), "the sidecar is running during the benchmark");
            guard.shutdown().expect("clean shutdown");
        }
        assert!(!process.is_alive(), "zero orphan after a normal run");
        assert_eq!(process.kill_count(), 1);
    }

    #[test]
    fn the_guard_reaps_the_sidecar_when_the_body_returns_an_error() {
        // The shape that used to leak: work after start fails, and the two
        // shutdown calls at the bottom of the function are never reached.
        let process = FakeProcess::new();

        let outcome: Result<(), String> = (|| {
            let _guard =
                BenchmarkRuntimeGuard::start(fake_manager(process.clone())).map_err(|e| e)?;
            assert!(process.is_alive());
            Err("the inference request failed".to_string())
        })();

        assert!(outcome.is_err());
        assert!(!process.is_alive(), "an early return must still reap the sidecar");
        assert_eq!(process.kill_count(), 1);
    }

    #[test]
    fn the_guard_reaps_the_sidecar_when_the_body_panics() {
        // `provider.generate(...).expect(...)` is a panic, not an Err, so the
        // guard has to survive unwinding as well.
        let process = FakeProcess::new();
        let manager = fake_manager(process.clone());
        let during = process.clone();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = BenchmarkRuntimeGuard::start(manager).expect("must start");
            assert!(during.is_alive());
            panic!("the local model did not answer within 120s");
        }));

        assert!(result.is_err(), "the failure must still be reported");
        assert!(!process.is_alive(), "a panic must still reap the sidecar");
        assert_eq!(process.kill_count(), 1);
    }

    #[test]
    fn shutting_the_guard_down_twice_is_harmless() {
        // Explicit shutdown on the success path, then Drop: the second must not
        // kill anything again, and must not fail.
        let process = FakeProcess::new();
        {
            let mut guard = BenchmarkRuntimeGuard::start(fake_manager(process.clone())).unwrap();
            guard.shutdown().expect("first");
            guard.shutdown().expect("second is a no-op");
            assert_eq!(process.kill_count(), 1);
        }
        assert_eq!(process.kill_count(), 1, "Drop after an explicit stop changes nothing");
        assert!(!process.is_alive());
    }

    #[test]
    fn the_guard_releases_process_ownership_after_a_failure() {
        // Ownership, not just liveness: a manager that still tracks a pid would
        // refuse to start the next profile.
        let process = FakeProcess::new();
        let manager = fake_manager(process.clone());

        {
            let _guard = BenchmarkRuntimeGuard::start(manager.clone()).unwrap();
            // ... something fails here ...
        }

        let snapshot = manager.snapshot();
        assert!(snapshot.pid.is_none(), "the pid must be released");
        assert!(!snapshot.inference_ready);
        assert!(!process.is_alive());
    }

    #[test]
    fn a_stop_that_fails_leaves_the_guard_willing_to_try_again() {
        // The defect this exists for: the flag used to be set on the way in, so
        // a kill that did not take made Drop a no-op and left the orphan.
        let process = FakeProcess::refusing(1);
        let manager = fake_manager(process.clone());

        let mut guard = BenchmarkRuntimeGuard::start(manager.clone()).expect("must start");
        let error = guard.shutdown().expect_err("the first kill refuses");
        assert!(error.contains("survived shutdown"), "{error}");

        // Still alive, still owned, and the guard has not marked itself done.
        assert!(process.is_alive());
        assert!(manager.snapshot().pid.is_some(), "the pid must be retained for a retry");
        assert_eq!(process.kill_count(), 1);
    }

    #[test]
    fn drop_retries_a_failed_stop_and_clears_the_orphan() {
        let process = FakeProcess::refusing(1);
        let manager = fake_manager(process.clone());

        {
            let mut guard = BenchmarkRuntimeGuard::start(manager.clone()).expect("must start");
            assert!(guard.shutdown().is_err(), "the first attempt fails");
            assert!(process.is_alive(), "and leaves the sidecar running");
        } // Drop runs here.

        assert!(!process.is_alive(), "Drop must have tried again and succeeded");
        assert_eq!(process.kill_count(), 2, "exactly one retry");
        assert!(manager.snapshot().pid.is_none(), "ownership released");
    }

    #[test]
    fn drop_never_panics_even_when_every_attempt_fails() {
        // A guard that cannot clean up must still not take the process down with
        // it: panicking in Drop while unwinding aborts and destroys the
        // diagnosis of the original failure.
        let process = FakeProcess::refusing(usize::MAX);
        let manager = fake_manager(process.clone());

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut guard = BenchmarkRuntimeGuard::start(manager.clone()).expect("must start");
            assert!(guard.shutdown().is_err());
        }));

        assert!(result.is_ok(), "Drop must not panic when cleanup is impossible");
        // The orphan is real and the state says so, which is the honest outcome.
        assert!(process.is_alive());
        assert!(manager.snapshot().pid.is_some(), "a surviving pid stays tracked");
        assert!(process.kill_count() >= 2, "it did try again");
    }

    #[test]
    fn a_confirmed_stop_is_not_repeated_by_drop() {
        // The other half: once the child is genuinely gone, further calls do
        // nothing at all.
        let process = FakeProcess::new();
        let manager = fake_manager(process.clone());
        {
            let mut guard = BenchmarkRuntimeGuard::start(manager.clone()).expect("must start");
            guard.shutdown().expect("clean stop");
            guard.shutdown().expect("second call is a no-op");
            assert_eq!(process.kill_count(), 1);
        }
        assert_eq!(process.kill_count(), 1, "Drop after a confirmed stop changes nothing");
        assert!(manager.snapshot().pid.is_none());
    }

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
    fn a_characters_faction_and_location_survive_json_to_prompt() {
        // serde was silently discarding both, so the model was told who someone
        // was but not whose side they were on. A political case cannot be
        // grounded without that.
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|case| case.characters.iter().any(|c| c.faction_id.is_some()))
            .expect("the committed suite gives characters a faction");

        let character = case
            .characters
            .iter()
            .find(|c| c.faction_id.is_some())
            .unwrap();
        let faction = character.faction_id.as_deref().unwrap();
        let location = character
            .location_id
            .as_deref()
            .expect("the same characters carry a location");

        assert_eq!(faction, "faction_compact");
        assert_eq!(location, "settlement_helios");

        let prompt = user_prompt(case);
        assert!(prompt.contains(faction), "the prompt drops the faction: {prompt}");
        assert!(prompt.contains(location), "the prompt drops the location: {prompt}");
    }

    #[test]
    fn an_unknown_field_in_a_case_fails_loudly() {
        // Cross-language drift must not be silent. If TypeScript grows a field
        // the runner does not know about, parsing stops rather than quietly
        // sending the model less context than the case describes.
        let broken = r#"{
            "schemaVersion": 1,
            "suiteVersion": "test",
            "cases": [{
                "id": "x", "task": "single_npc_dialogue", "notes": "n",
                "worldStateSlice": {}, "characters": [], "relevantMemories": [],
                "recentDelta": {"turn": 1, "source": "s", "changes": []},
                "constraints": {
                    "language": "it", "knownSpeakerIds": [], "allowedToneTags": ["t"],
                    "maxNarrationChars": 100, "structuredOutput": true,
                    "authoritativeNumbersReadOnly": true
                },
                "expectedFacts": ["a"], "forbiddenClaims": ["b"],
                "somethingNew": 1
            }]
        }"#;
        let error = serde_json::from_str::<BenchmarkSuite>(broken)
            .expect_err("an unknown case field must be refused");
        assert!(error.to_string().contains("somethingNew"), "{error}");
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
            RunKind::OfficialComparison,
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
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: None,
            prompt_tokens: Some(400),
            completion_tokens: Some(120),
            tokens_per_second: Some(15.0),
            model: Some("lite".to_string()),
        };

        let record = record_generation("run_001", case, "lite", 1, test_artifact("lite"), benchmark_context(4096), first_attempt_fingerprint(case), &outcome);
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
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: Some("unknown tone tag: epico".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };

        let record = record_generation("run_001", case, "standard", 2, test_artifact("standard"), benchmark_context(4096), first_attempt_fingerprint(case), &outcome);
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
            event_proposals: Vec::new(),
            memory_suggestions: Vec::new(),
            validation_error: Some("malformed JSON".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let record = record_generation("run_001", case, "lite", 1, test_artifact("lite"), benchmark_context(4096), first_attempt_fingerprint(case), &outcome);
        persist(&directory, &record, &outcome.raw).expect("must persist");

        let raw = fs::read_to_string(directory.join(&record.raw_output_path)).unwrap();
        assert_eq!(raw, "raw model text");

        let rows = fs::read_to_string(directory.join("generations.jsonl")).unwrap();
        assert_eq!(rows.lines().count(), 1);
        assert!(rows.contains("\"caseId\""));
        assert!(rows.contains("rawOutputPath"));

        // A second attempt appends rather than replacing the first.
        persist(&directory, &record_generation("run_001", case, "lite", 2, test_artifact("lite"), benchmark_context(4096), first_attempt_fingerprint(case), &outcome), "second")
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

        // Verify the bytes that are about to run, before anything is started.
        // Recording the lock's expected digest would describe a runtime that may
        // not be the one on this disk.
        let runtime_lock = crate::runtime_e2e::checkout_runtime_lock()
            .expect("the runtime resolved, so its lock must parse");
        let runtime_directory = crate::runtime_e2e::resolved_runtime_directory()
            .expect("the runtime resolved, so it has a directory");
        let verified_runtime =
            crate::runtime_lock::verify_runtime_distribution(&runtime_lock, &runtime_directory)
                .unwrap_or_else(|error| {
                    panic!(
                        "refusing to benchmark an unverified runtime: {} (after {} files)",
                        error.message, error.checked
                    )
                });
        eprintln!(
            "runtime verified: {} files, {} ms, {} @ {}",
            verified_runtime.files_verified(),
            verified_runtime.elapsed_ms(),
            verified_runtime.release_tag(),
            &verified_runtime.executable_sha256()[..16]
        );

        let run_id = format!(
            "smoke_{}_{}",
            profile,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_secs())
                .unwrap_or_default()
        );
        let directory = run_directory(&workspace, &run_id);

        // Identity comes from the model that actually passed its digest, so the
        // rows can name the exact bytes that answered.
        let verified = crate::runtime_e2e::verified_model_for_profile(&profile)
            .expect("the profile resolved, so it must verify");
        let artifact = artifact_identity(&verified);
        let context = benchmark_context(verified.model().context_target());

        // Provenance comes from the verification that just happened, not from
        // the lock. The lock says what the runtime should be; only this says
        // what it was.
        let metadata = new_run_metadata(
            &run_id,
            // Declared, not inferred. This is plumbing evidence and says so.
            RunKind::Smoke,
            &started_at(),
            &suite,
            &git_commit().unwrap_or_default(),
            git_dirty(),
            verified_runtime.release_tag(),
            Some(verified_runtime.executable_sha256().to_string()),
            host_facts(),
        );
        persist_metadata(&directory, &metadata).expect("metadata must persist");

        // From here on the sidecar is owned by a guard: every path out of this
        // function, including a panic inside a request, stops and reaps it.
        let mut guard = BenchmarkRuntimeGuard::start(manager).expect("the runtime must start");
        assert!(
            guard.wait_until_ready(std::time::Duration::from_secs(180)),
            "the runtime never became ready"
        );

        let spec = guard.manager().launch_spec();
        // Development-only drill: a deliberately wrong key makes the runtime
        // answer 401, so `generate` returns Err and the `.expect` below panics
        // exactly as a timeout or a lost connection would. It exercises the real
        // request path failing rather than a synthetic panic, and proves the
        // guard reaps the sidecar when it does.
        let api_key = if env::var("CHRONOSAGA_BENCHMARK_FORCE_REQUEST_FAILURE").ok().as_deref()
            == Some("1")
        {
            eprintln!("drill: forcing the request path to fail after the runtime is up");
            "deliberately-wrong-key".to_string()
        } else {
            spec.api_key().to_string()
        };
        let provider = crate::inference::LocalModelProvider::new(spec.base_url(), api_key)
            .expect("the loopback provider must build");

        let mut accepted = 0usize;
        let mut attempted = 0usize;

        for case in cases_to_run(&suite, smoke_size) {
            let contract = case_contract(case);
            // Built once, sent once, fingerprinted once. The three must be the
            // same strings or the evidence describes a different question.
            let system = system_prompt(case);
            let user = user_prompt(case);
            let fingerprint = input_fingerprint(case, &system, &user);

            let outcome = tauri::async_runtime::block_on(provider.generate(
                &system,
                &user,
                &contract,
                request_parameters(&context),
            ))
            .expect("the request must reach the local runtime");

            let record = record_generation(
                &run_id,
                case,
                &profile,
                1,
                artifact.clone(),
                context.clone(),
                fingerprint,
                &outcome,
            );
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

        // Explicit shutdown so a cleanup failure is a visible error rather than
        // a line on stderr from Drop. Drop still runs, and is a no-op.
        guard.shutdown().expect("the smoke run must leave no process behind");

        eprintln!("smoke run {run_id}: {accepted}/{attempted} accepted, evidence in {}", directory.display());

        // The harness is what is under test, not the model: a run that produced
        // rows and left no orphan has done its job even at 0 acceptance.
        let rows = fs::read_to_string(directory.join("generations.jsonl")).expect("rows");
        assert_eq!(rows.lines().count(), attempted);
    }

    #[test]
    fn a_run_records_a_timestamp_a_human_can_read() {
        let stamp = started_at();
        assert!(
            regex_like_rfc3339(&stamp),
            "expected an RFC 3339 timestamp, got {stamp}"
        );
        assert!(stamp.starts_with("20"), "{stamp}");
    }

    fn regex_like_rfc3339(value: &str) -> bool {
        let bytes = value.as_bytes();
        value.len() == 20
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes[10] == b'T'
            && bytes[13] == b':'
            && bytes[16] == b':'
            && bytes[19] == b'Z'
            && value
                .chars()
                .filter(|c| c.is_ascii_digit())
                .count()
                == 14
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
