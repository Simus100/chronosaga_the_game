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

/// How long a benchmark run allows a model to become ready.
///
/// One number, used by both the lifecycle manager and the loop that waits on it.
/// The benchmark previously polled for 180 seconds over a manager configured for
/// 30, so the manager gave up first and the watcher stopped polling a model that
/// might still have been loading: the advertised allowance was fiction.
///
/// Longer than the product default on purpose. A player should never wait three
/// minutes, and a benchmark measuring a 3B model from a cold page cache should
/// not record a startup failure that says more about disk than about the model.
/// [`crate::local_ai_runtime::DEFAULT_STARTUP_TIMEOUT_MS`] is unchanged.
pub const BENCHMARK_STARTUP_TIMEOUT_MS: u64 = 180_000;

const BENCHMARK_ENV: &str = "CHRONOSAGA_BENCHMARK";

/// Opt-in for the official comparison, separate from the smoke opt-in.
///
/// Two variables rather than one so that the command that produces publishable
/// evidence cannot be typed by accident while reaching for a three-case smoke.
const OFFICIAL_ENV: &str = "CHRONOSAGA_BENCHMARK_OFFICIAL";
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
    /// The digest of the file this was parsed from.
    ///
    /// Not a field of the suite document: it is computed over the complete JSON
    /// at load time and carried here, so anything holding a suite also holds
    /// proof of which suite it is. Skipped by serde in both directions — it
    /// describes the file rather than living in it, and a suite deserialised
    /// from anywhere else gets an empty digest rather than a borrowed one.
    #[serde(skip)]
    pub content_sha256: String,
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
    /// Speakers the task actually needs to hear from.
    ///
    /// A subset of `known_speaker_ids`. Permission to speak is not an obligation
    /// to speak, and only these produce a deterministic failure when silent.
    #[serde(default)]
    pub required_speaker_ids: Vec<String>,
    pub allowed_tone_tags: Vec<String>,
    pub max_narration_chars: usize,
    pub structured_output: bool,
    pub authoritative_numbers_read_only: bool,
    #[serde(default)]
    pub allow_event_proposals: bool,
    /// Whether the case *demands* a proposal, as opposed to tolerating one.
    ///
    /// Permission and requirement are different things and were conflated: the
    /// prompt said an array "may" contain proposals while the evaluator counted
    /// an empty one as a deterministic failure, so a model could obey the
    /// instruction it was given and still be marked down.
    #[serde(default)]
    pub require_event_proposal: bool,
    #[serde(default)]
    pub allow_memory_suggestions: bool,
    /// Symmetric with [`Self::require_event_proposal`].
    #[serde(default)]
    pub require_memory_suggestion: bool,
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
    // Digest the complete document, then read the parts this crate needs from
    // the same value. Hashing after deserialisation would sign a suite with the
    // root fields this struct does not keep torn out of it.
    let complete: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("unable to parse {}: {error}", path.display()))?;
    let digest = suite_content_digest(&complete);
    let mut suite: BenchmarkSuite = serde_json::from_value(complete)
        .map_err(|error| format!("unable to parse {}: {error}", path.display()))?;
    suite.content_sha256 = digest;
    Ok(suite)
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
        // The case's own distinction, carried into the validator rather than
        // stopping at the evaluator. Without this the prompt could say nobody is
        // obliged to speak while the validator rejected the silence it invited,
        // and the run would record a compliant answer as a rejection before the
        // objective checks ever saw it.
        required_speaker_ids: case.constraints.required_speaker_ids.clone(),
        allowed_tone_tags: case.constraints.allowed_tone_tags.clone(),
        max_narration_chars: case.constraints.max_narration_chars,
        // Derived from the case, never assumed: a case that does not invite a
        // proposal gets exactly the production rejection.
        allow_event_proposals: case.constraints.allow_event_proposals,
        allow_memory_suggestions: case.constraints.allow_memory_suggestions,
        // The case's own obligations, carried the rest of the way. The prompt
        // and the evaluator already knew the difference; the validator did not,
        // so a case whose whole task is to produce a proposal could return an
        // empty array, be accepted, spend no retry, and be failed afterwards by
        // the evaluator — acceptance and semantics disagreeing about the same
        // row.
        require_event_proposal: case.constraints.require_event_proposal,
        require_memory_suggestion: case.constraints.require_memory_suggestion,
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
    // Everything the scene actually shows, not just the settlement's own id.
    //
    // The prompt tells the model that a subjectId must be an id present in the
    // scene, and the scene it can see is the whole slice. `ai_case_049` prints
    // `settlement.controllingFactionId = faction_compact` and contains no
    // character at all, so a proposal about that faction obeyed the instruction
    // exactly and the validator refused it: the benchmark marking down an answer
    // for reading the context it was given.
    collect_scene_ids(&case.world_state_slice, &mut push);
    ids
}

/// Serialise a JSON value with object keys sorted, recursively.
///
/// The canonical form both languages hash. Arrays keep their order because order
/// is meaning in a case list; object keys do not, so two files that differ only
/// in key order describe the same suite and must not read as tampering. Scalars
/// are written by `serde_json`, which is the same set of rules `JSON.stringify`
/// follows for the values this suite contains.
pub fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(fields) => {
            let mut keys: Vec<&String> = fields.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .into_iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::Value::String(key.clone()),
                        canonical_json(&fields[key])
                    )
                })
                .collect();
            format!("{{{}}}", body.join(","))
        }
        serde_json::Value::Array(items) => {
            let body: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", body.join(","))
        }
        other => other.to_string(),
    }
}

/// The exact content of a suite, as a digest.
///
/// `suiteVersion` is assigned by hand, so it says what somebody intended and not
/// what the file contains. A constraint, an expected fact or a whole case could
/// change while the version stayed put, and a stored run would then be evaluated
/// against a suite it never saw, with the report still naming the version it
/// recorded.
///
/// Computed from the **complete JSON**, not from `BenchmarkSuite`: that struct
/// keeps three of the file's six root fields, so hashing it after deserialisation
/// would sign a document with `outputContract`, `scenario` and `status` torn out.
pub fn suite_content_digest(complete_suite: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(canonical_json(complete_suite).as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Read the shipped suite file as raw JSON, for digesting.
pub fn load_suite_json() -> Result<serde_json::Value, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../")
        .join(SUITE_RELATIVE_PATH);
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("unable to parse {}: {error}", path.display()))
}

/// The one consequence status the suite actually uses.
///
/// Read from the data, not assumed: across the 65 cases exactly four
/// consequences exist, one carries `"status": "applied"` and three carry no
/// status at all. An absent status means the consequence has not fired, so
/// nothing needs a second name for it.
pub const APPLIED_STATUS: &str = "applied";

/// Whether a string is shaped like an entity id in this project.
///
/// `mara_001`, `settlement_helios`, `faction_compact`. The same rule the
/// TypeScript evaluator applies, so the two sides agree about what counts as an
/// identifier rather than each having its own notion.
fn is_entity_id(value: &str) -> bool {
    let mut segments = value.split('_');
    let Some(first) = segments.next() else {
        return false;
    };
    if first.is_empty() || !first.starts_with(|c: char| c.is_ascii_lowercase()) {
        return false;
    }
    if !first.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return false;
    }
    let mut had_segment = false;
    for segment in segments {
        had_segment = true;
        if segment.is_empty()
            || !segment
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return false;
        }
    }
    had_segment
}

/// Every id-shaped string visibly present in a slice of scene data.
///
/// Values and keys alike: an object keyed by entity id names that entity as
/// plainly as a field holding it. Only id-shaped strings — prose is not an
/// identifier, and an underscore is not a licence, since the id must occur in
/// the data the model was actually shown.
fn collect_scene_ids(value: &serde_json::Value, push: &mut impl FnMut(&str)) {
    match value {
        serde_json::Value::String(text) => {
            if is_entity_id(text) {
                push(text);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_scene_ids(item, push);
            }
        }
        serde_json::Value::Object(fields) => {
            for (key, nested) in fields {
                if is_entity_id(key) {
                    push(key);
                }
                collect_scene_ids(nested, push);
            }
        }
        _ => {}
    }
}

/// The system prompt, identical for every profile.
///
/// Built only from the case, with no profile-specific wording anywhere: tuning a
/// prompt so that one candidate wins is the one thing that would make the whole
/// comparison worthless.
pub fn system_prompt(case: &BenchmarkCase) -> String {
    let tags = case.constraints.allowed_tone_tags.join(", ");
    // Permission and obligation are said separately here too: listing a
    // character as permitted never implied the model had to give them a line.
    let speakers = if case.constraints.known_speaker_ids.is_empty() {
        "nessuno: non produrre dialogo".to_string()
    } else if case.constraints.required_speaker_ids.is_empty() {
        format!(
            "{} (possono parlare; nessuno e' obbligato)",
            case.constraints.known_speaker_ids.join(", ")
        )
    } else if case.constraints.required_speaker_ids == case.constraints.known_speaker_ids {
        format!(
            "{} — DEVONO parlare tutti",
            case.constraints.known_speaker_ids.join(", ")
        )
    } else {
        format!(
            "{} (possono parlare); DEVONO parlare: {}",
            case.constraints.known_speaker_ids.join(", "),
            case.constraints.required_speaker_ids.join(", ")
        )
    };
    // The model is told the exact permitted item shape. Asking for "an object"
    // and then rejecting whatever arrives would measure the prompt, not the
    // model.
    // Permission and requirement are said differently, because a model can only
    // obey the instruction it is actually given. A case that demands a proposal
    // says "devi"; one that merely tolerates it says "puoi".
    let proposals = if case.constraints.require_event_proposal {
        "event_proposals DEVE contenere almeno un oggetto di questa forma esatta e di          nessun'altra: {\"subjectId\": \"<id presente nella scena>\",          \"topic\": \"<poche parole>\", \"rationale\": \"<perche'>\"}. Resta un          suggerimento per il motore, mai un effetto applicato: niente numeri, niente          cambi di stato"
    } else if case.constraints.allow_event_proposals {
        "event_proposals puo' contenere oggetti di questa forma esatta e di nessun'altra:          {\"subjectId\": \"<id presente nella scena>\", \"topic\": \"<poche parole>\",          \"rationale\": \"<perche'>\"}. Sono suggerimenti per il motore, mai effetti          applicati: niente numeri, niente cambi di stato"
    } else {
        "event_proposals deve essere un array vuoto"
    };
    let memories = if case.constraints.require_memory_suggestion {
        "memory_suggestions DEVE contenere almeno un oggetto di questa forma esatta e di          nessun'altra: {\"characterId\": \"<id di un personaggio presente>\",          \"summary\": \"<cosa ricorda>\"}"
    } else if case.constraints.allow_memory_suggestions {
        "memory_suggestions puo' contenere oggetti di questa forma esatta e di nessun'altra:          {\"characterId\": \"<id di un personaggio presente>\", \"summary\": \"<cosa ricorda>\"}"
    } else {
        "memory_suggestions deve essere un array vuoto"
    };

    // The worked example has to agree with the instruction. Showing an empty
    // array to a case that demands a proposal contradicts the sentence above it,
    // and the example is what a small model copies.
    // Every placeholder in the worked example is an instance of the contract,
    // not decoration. `"..."` was shown where identity is constrained — a tone
    // tag outside the vocabulary, a subjectId no scene contains, a characterId
    // nobody has — so a small model that copied the example was rejected for
    // following it. Narration is free prose and keeps its ellipsis; everything
    // whose value the validator checks is a real value.
    //
    // Tone tags are optional in the contract, so the honest example is the empty
    // array unless the case has a vocabulary to draw from, in which case the
    // first allowed tag is shown deterministically.
    let tone_example = match case.constraints.allowed_tone_tags.first() {
        Some(tag) => format!("[\"{tag}\"]"),
        None => "[]".to_string(),
    };

    // The worked example is an instance of the contract, not decoration. A
    // zero-speaker case was told "non produrre dialogo" and then shown a line to
    // copy — and a small model copies the example, earning an UnknownSpeaker
    // rejection for following the prompt.
    //
    // Permission produces no example either: showing a line where none is owed
    // adds an obligation the contract does not contain. Only a required speaker
    // appears, and by name, because the identity is constrained and "..." would
    // invite the model to guess one.
    let dialogue_example = if case.constraints.required_speaker_ids.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            case.constraints
                .required_speaker_ids
                .iter()
                .map(|speaker| format!("{{\"speakerId\": \"{speaker}\", \"text\": \"...\"}}"))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    // A required proposal needs a subject the scene actually contains, taken
    // deterministically from the same grounding the validator applies. A case
    // that demands a proposal and offers no valid subject is a suite defect the
    // model cannot solve, so the example says so rather than inventing an id.
    let proposal_example = if case.constraints.require_event_proposal {
        match case_subject_ids(case).first() {
            Some(subject) => format!(
                "[{{\"subjectId\": \"{subject}\", \"topic\": \"conseguenza\", \
                 \"rationale\": \"motivo breve\"}}]"
            ),
            None => "[]".to_string(),
        }
    } else {
        "[]".to_string()
    };
    let memory_example = if case.constraints.require_memory_suggestion {
        match case.characters.first() {
            Some(character) => format!(
                "[{{\"characterId\": \"{}\", \"summary\": \"cosa ricorda\"}}]",
                character.id
            ),
            None => "[]".to_string(),
        }
    } else {
        "[]".to_string()
    };

    let structure = if case.constraints.strict_json_only {
        "\n- l'output precedente non era valido: rispondi solo con l'oggetto JSON corretto"
    } else {
        ""
    };
    // Formatting strictness belongs to `strictJsonOnly` and to nothing else.
    //
    // Every case was told "senza blocchi di codice" while only the strict cases
    // were ever checked for it, so an ordinary case could be given a rule, break
    // it, have the product validator unwrap the fence on purpose, and be recorded
    // as fully compliant. The prompt and the evaluator disagreed about what had
    // been asked, and the prompt was the one lying.
    //
    // Strict cases keep the bare-JSON demand and keep the deterministic
    // `raw_output_is_bare_json` check that measures it. Ordinary cases still owe
    // the structured contract — the object, its fields, its shape — and are not
    // told a fence is forbidden, because the validator they are judged by
    // deliberately tolerates one.
    let envelope = if case.constraints.strict_json_only {
        "Rispondi con un solo oggetto JSON: nessun blocco di codice, nessun testo \
         prima o dopo"
    } else {
        "Rispondi con un oggetto JSON di questa forma"
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
         {envelope}:\n\
         {{\"narration\": \"...\", \"dialogue\": {dialogue_example}, \
         \"tone_tags\": {tone_example}, \"event_proposals\": {proposal_example}, \
         \"memory_suggestions\": {memory_example}}}",
        language = case.constraints.language,
        speakers = speakers,
        tags = tags,
        max = case.constraints.max_narration_chars,
        proposals = proposals,
        memories = memories,
        numbers = numbers,
        structure = structure,
        dialogue_example = dialogue_example,
        tone_example = tone_example,
        proposal_example = proposal_example,
        memory_example = memory_example,
        envelope = envelope,
    )
}

/// The user turn for the one permitted retry.
///
/// A repair, not a different question. The original scene is repeated verbatim,
/// then the model is told what its own answer failed on, in the validator's own
/// words, and asked for the corrected object and nothing else.
///
/// Derived from the rejection because that is what makes a retry worth having:
/// "your output was invalid" teaches a model nothing it can act on, while
/// "unknown tone tag: epico" does. Two profiles that failed differently
/// therefore receive different retry text, and that is the fair treatment —
/// telling Lite to fix an error Standard made would be neither.
///
/// Profile-neutral all the same. Nothing here reads the profile, so the same
/// case and the same rejection produce the same retry whichever model is being
/// measured; it is the policy that is identical, not the wording. Deterministic,
/// so the recorded fingerprint reproduces.
pub fn retry_user_prompt(base_user: &str, validator_error: &str) -> String {
    format!(
        "{base_user}\n\n\
         CORREZIONE RICHIESTA\n\
         La risposta precedente e' stata rifiutata dal validatore per questo motivo:\n\
         {validator_error}\n\n\
         Correggi solo quel problema. Non cambiare i fatti, non aggiungere entita', \
         non riaprire cio' che e' chiuso. Rispondi di nuovo con l'oggetto JSON completo \
         e nient'altro."
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

    // Applied and pending are opposite facts and were printed under one heading
    // that asserted the pending one. `ai_case_060` carries a consequence marked
    // `applied`, so the model was told it had not happened while the case
    // expected it narrated as having happened — a contradiction no answer could
    // satisfy.
    //
    // The suite states a status only when it is `applied`; an absent status means
    // the consequence is still waiting. Nothing else is invented here.
    let (applied, pending): (Vec<_>, Vec<_>) = case
        .constraints
        .pending_consequences
        .iter()
        .partition(|consequence| {
            consequence.get("status").and_then(|value| value.as_str()) == Some(APPLIED_STATUS)
        });

    if !applied.is_empty() {
        sections.push(format!(
            "CONSEGUENZE GIA' AVVENUTE: sono gia' accadute e i loro effetti sono nel \
             delta autorevole qui sopra. Raccontale come avvenute, senza aggiungere \
             dettagli che il delta non mostra:\n{}",
            serde_json::to_string_pretty(&applied).unwrap_or_default()
        ));
    }
    if !pending.is_empty() {
        sections.push(format!(
            "CONSEGUENZE IN SOSPESO (non ancora avvenute, quelle nascoste non vanno rivelate):\n{}",
            serde_json::to_string_pretty(&pending).unwrap_or_default()
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

/// What a finished run actually covered, as `(profile, case)` pairs.
///
/// Two independent sets are not coverage. `lite/A` plus `standard/B` yields
/// profiles `{lite, standard}` and cases `{A, B}`, which satisfies "both
/// profiles appeared" and "both cases appeared" while neither model answered
/// either question the other did. A comparison needs the product, so the product
/// is what gets recorded.
///
/// A pair is established by any legitimate attempt: a case that took three
/// retries is covered once, not three times.
#[derive(Debug, Clone, Default)]
pub struct RunCoverage {
    pairs: std::collections::HashSet<(String, String)>,
    /// Rows that were answered by a profile other than the one that asked.
    ///
    /// Kept beside the pairs because it is a fact about the same rows, read at
    /// the same moment: a fallback row establishes no pair, and an official run
    /// that contains one is not evidence about either model.
    fell_back: Vec<String>,
    /// Pairs whose first attempt was rejected and whose retry never happened.
    ///
    /// The policy owes a rejected attempt exactly one retry, so until that retry
    /// exists the pair is an interrupted run rather than a model result. Left
    /// out of the pairs for the same reason: it has no answer to establish.
    unfinished: Vec<(String, String)>,
}

impl RunCoverage {
    /// Derive coverage from the rows a run produced.
    ///
    /// From the records, never from intent: a run covers what it generated.
    pub fn from_records(records: &[GenerationRecord]) -> Self {
        let mut coverage = Self::default();
        // Attempts per pair, so completeness is judged on the history rather than
        // on whichever row happened to be seen first.
        let mut histories: std::collections::BTreeMap<(String, String), Vec<&GenerationRecord>> =
            std::collections::BTreeMap::new();

        for record in records {
            if record.fallback_used || record.fallback_profile.is_some() {
                // Answered by another model, so it covers nothing and is named.
                coverage.fell_back.push(record.id.clone());
                continue;
            }
            histories
                .entry((record.profile.clone(), record.case_id.clone()))
                .or_default()
                .push(record);
        }

        for (pair, mut attempts) in histories {
            attempts.sort_by_key(|record| record.attempt);
            if terminal_attempt(&attempts).is_some() {
                coverage.pairs.insert(pair);
            } else if is_unfinished(&attempts) {
                coverage.unfinished.push(pair);
            }
        }
        coverage
    }

    /// Build coverage directly, for tests and for callers that already know.
    pub fn from_pairs<I, P, C>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (P, C)>,
        P: Into<String>,
        C: Into<String>,
    {
        Self {
            pairs: pairs
                .into_iter()
                .map(|(profile, case)| (profile.into(), case.into()))
                .collect(),
            // Pairs stated directly are pairs somebody vouched for; neither a
            // fallback row nor an unfinished history can be expressed this way,
            // which is the point.
            fell_back: Vec::new(),
            unfinished: Vec::new(),
        }
    }

    pub fn covers(&self, profile: &str, case_id: &str) -> bool {
        self.pairs
            .contains(&(profile.to_string(), case_id.to_string()))
    }

    /// How many distinct `(profile, case)` pairs the run established.
    pub fn pair_count(&self) -> usize {
        self.pairs.len()
    }

    /// The pairs whose history stopped before the retry policy ended it.
    pub fn unfinished_histories(&self) -> &[(String, String)] {
        &self.unfinished
    }

    /// The generations produced by a profile other than the one that asked.
    pub fn fallback_rows(&self) -> &[String] {
        &self.fell_back
    }

    /// The cases one profile is missing, in the requirement's own order.
    fn missing_for<'a>(&self, profile: &str, required_cases: &'a [String]) -> Vec<&'a str> {
        required_cases
            .iter()
            .filter(|case_id| !self.covers(profile, case_id))
            .map(String::as_str)
            .collect()
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
    /// SHA-256 of the canonicalised suite file, as it was when the run executed.
    ///
    /// The version is what somebody called the suite; this is what the suite
    /// actually contained. Written with the metadata, before the first
    /// generation, so an interrupted run still says which suite it was answering.
    pub suite_content_sha256: String,
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
        suite_content_sha256: suite.content_sha256.clone(),
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
    /// The model the runtime said answered, when it says.
    ///
    /// Kept rather than discarded: the pre-flight check proves the right model
    /// was loaded before the run, and this records what each individual response
    /// claimed, so a swap mid-run would still leave a trace in the evidence.
    pub served_model: Option<String>,
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
        served_model: outcome.model.clone(),
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

/// One retry after a rejection, and no more.
///
/// The same policy `@paa/ai-benchmark` declares, and the only place this crate
/// states it. A test reads the TypeScript declaration and refuses to let either
/// side change the number alone, because a benchmark where one language allows
/// two tries and the other allows three is measuring the retry budget.
pub const MAX_RETRIES: usize = 1;

/// A first attempt plus its one permitted retry.
pub const MAX_ATTEMPTS: usize = MAX_RETRIES + 1;

/// The attempt that ends a history, or `None` when the history has not ended.
///
/// The retry policy is fixed and has exactly three finished shapes: an accepted
/// first attempt; a rejected first followed by an accepted second; and a
/// rejected first followed by a rejected second, which is exhausted and is still
/// an answer. A rejected first attempt with no second is none of them — it is a
/// run that stopped before the model finished being asked, and reading it as a
/// completed failure counts an interruption as evidence about the model.
///
/// `MAX_ATTEMPTS` is the only authority for the ceiling. Shapes that are invalid
/// for other reasons — starting at attempt 2, a gap, a duplicate, a third try —
/// have no trustworthy last attempt either, so this names no winner and leaves
/// the specific complaint to the checks that own it.
fn terminal_attempt<'a>(attempts: &[&'a GenerationRecord]) -> Option<&'a GenerationRecord> {
    if attempts.is_empty() || attempts.len() > MAX_ATTEMPTS {
        return None;
    }
    for (index, record) in attempts.iter().enumerate() {
        if record.attempt as usize != index + 1 {
            return None;
        }
    }
    // A retry may only follow a rejection, so every attempt before the last must
    // have been rejected. An accepted attempt ends the history; anything after
    // it is a row the policy never permitted, and the pair has no honest answer.
    if attempts[..attempts.len() - 1].iter().any(|record| record.accepted) {
        return None;
    }
    let last = attempts[attempts.len() - 1];
    if last.accepted || attempts.len() == MAX_ATTEMPTS {
        return Some(last);
    }
    None
}

/// Whether a history stopped after a rejected first attempt, owing its retry.
fn is_unfinished(attempts: &[&GenerationRecord]) -> bool {
    attempts.len() == 1 && attempts[0].attempt == 1 && !attempts[0].accepted
}

/// The named requirements an official comparison must satisfy.
///
/// The runner decides whether a run *is* official evidence; the report boundary
/// decides whether a stored run *may be published* as one. Both answers have to
/// mean the same thing, and they are implemented separately because each side
/// sees different data — Rust holds the live coverage as it accumulates,
/// TypeScript holds the finished JSON.
///
/// Sharing the implementation is not possible across the language boundary, so
/// what is shared is the list of questions. It is exported to
/// `packages/ai-benchmark/tests/fixtures/official-evidence-requirements.json`,
/// asserted here and asserted there: adding a requirement on one side without
/// the other fails a test rather than quietly producing two definitions of
/// "official" that slowly disagree.
pub const OFFICIAL_EVIDENCE_REQUIREMENTS: &[&str] = &[
    "declared_official",
    "clean_checkout",
    "full_commit",
    "runtime_provenance",
    "host_facts",
    "suite_identity",
    "full_profile_case_coverage",
    "no_fallback_evidence",
    "complete_retry_history",
];

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
    let missing = official_evidence_failures(metadata, coverage, required);
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "refusing to record run {} as comparable evidence: {}.",
        metadata.run_id,
        missing
            .into_iter()
            .map(|(_, detail)| detail)
            .collect::<Vec<_>>()
            .join("; ")
    ))
}

/// Every [`OFFICIAL_EVIDENCE_REQUIREMENTS`] entry this run fails, and why.
///
/// Separate from the verdict so the tags are load-bearing rather than
/// decorative: a test can assert that every shared requirement is genuinely
/// reachable here, which is what keeps the exported list honest instead of a
/// comment that drifts.
pub fn official_evidence_failures(
    metadata: &RunMetadata,
    coverage: &RunCoverage,
    required: &CoverageRequirement,
) -> Vec<(&'static str, String)> {
    // Tagged rather than bare strings: the tag is the shared requirement, the
    // string is this side's account of how it was missed.
    let mut missing: Vec<(&'static str, String)> = Vec::new();

    // Declared purpose first: a smoke run is refused before anything else is
    // even examined, because no amount of rigour makes it the right run.
    if metadata.run_kind != RunKind::OfficialComparison {
        return vec![(
            "declared_official",
            format!(
            "run {} was recorded as a {} run, which is plumbing evidence and never \
             comparable evidence, however complete its metadata is",
                metadata.run_id,
                metadata.run_kind.label()
            ),
        )];
    }

    if metadata.git_dirty {
        missing.push((
            "clean_checkout",
            "the checkout was dirty, so nobody else can reproduce it".to_string(),
        ));
    }
    if metadata.git_commit.len() != 40
        || !metadata.git_commit.chars().all(|c| c.is_ascii_hexdigit())
    {
        missing.push((
            "full_commit",
            format!(
                "the commit '{}' is not a full 40-character SHA",
                metadata.git_commit
            ),
        ));
    }
    if metadata.runtime_release_tag.trim().is_empty() {
        missing.push((
            "runtime_provenance",
            "the runtime release tag is absent".to_string(),
        ));
    }
    match metadata.runtime_executable_sha256.as_deref() {
        Some(digest) if digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()) => {}
        Some(digest) => missing.push((
            "runtime_provenance",
            format!("the runtime digest '{digest}' is not a SHA-256"),
        )),
        None => missing.push((
            "runtime_provenance",
            "the runtime executable digest is absent".to_string(),
        )),
    }
    if metadata.host.cpu.trim().is_empty()
        || metadata.host.logical_cores == 0
        || metadata.host.total_ram_mb == 0
    {
        missing.push((
            "host_facts",
            "the host facts are incomplete".to_string(),
        ));
    }
    if metadata.suite_version.trim().is_empty() || metadata.suite_schema_version == 0 {
        missing.push((
            "suite_identity",
            "the suite identity is incomplete".to_string(),
        ));
    }

    // Coverage: what the run actually did, not what it meant to do, and per
    // profile rather than in aggregate. Reported grouped by profile, because
    // "standard is missing these four cases" is actionable and "four pairs are
    // missing" is not.
    for profile in &required.required_profiles {
        let absent = coverage.missing_for(profile, &required.required_case_ids);
        if absent.is_empty() {
            continue;
        }
        if absent.len() == required.required_case_ids.len() {
            missing.push((
                "full_profile_case_coverage",
                format!("no generations at all for {profile}, so there is nothing to compare"),
            ));
            continue;
        }
        let shown: Vec<&str> = absent.iter().take(5).copied().collect();
        missing.push((
            "full_profile_case_coverage",
            format!(
                "{profile} is missing {} of {} required cases ({}{})",
                absent.len(),
                required.required_case_ids.len(),
                shown.join(", "),
                if absent.len() > shown.len() { ", ..." } else { "" }
            ),
        ));
    }

    // Fallback is a product virtue and a measurement defect. A row where Standard
    // asked and Lite answered stays grouped under Standard, so its output,
    // acceptance, latency, retries and scores would be reported as Standard
    // evidence for work Lite did.
    // Said separately from coverage: coverage says the profile has no answer for
    // that case, and this says why — it was asked, it refused, and the one retry
    // the policy owes it was never taken.
    for (profile, case_id) in coverage.unfinished_histories() {
        missing.push((
            "complete_retry_history",
            format!(
                "{case_id} for {profile}: attempt 1 was rejected and no attempt 2 was recorded,                  so the retry evidence is missing and the history never finished"
            ),
        ));
    }

    for id in coverage.fallback_rows() {
        missing.push((
            "no_fallback_evidence",
            format!("{id} was answered by a fallback profile, not by the one it is recorded under"),
        ));
    }

    missing
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

/// Whether anything is already listening on the benchmark's port.
///
/// Measured against the real b10343 on Windows, and the result is why this
/// exists. Two `llama-server` processes can hold 127.0.0.1:8081 at once: the
/// second bind **succeeds**, the OS reports the newer socket as the listener,
/// and the incumbent keeps answering every request. In that state `/health`
/// returns 200 from a process the benchmark does not own, the manager reaches
/// Ready, and `/v1/models` — which b10343 serves without checking the API key —
/// reports the incumbent's alias. Generation then fails 401, because inference
/// *is* authenticated and the incumbent holds a different session key.
///
/// So no foreign evidence can be recorded. What can happen is a confusing
/// three-minute startup followed by an unexplained 401, over a port the run
/// never owned. This turns that into an immediate, legible refusal.
///
/// Benchmark only: the product's runtime lifecycle is untouched, and nothing
/// here kills a process it did not start.
fn port_is_occupied(host: &str, port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let Ok(mut addresses) = format!("{host}:{port}").to_socket_addrs() else {
        return false;
    };
    addresses.any(|address| {
        TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok()
    })
}

/// The refusal an occupied benchmark port earns.
pub fn occupied_port_verdict(host: &str, port: u16, occupied: bool) -> Result<(), String> {
    if !occupied {
        return Ok(());
    }
    Err(format!(
        "{host}:{port} is already in use, so this run cannot own the runtime it is measuring. \
         A previous Chronosaga session or another local-AI process is still listening; stop it \
         and run again. Nothing was run, and nothing was stopped for you."
    ))
}

/// Whether the endpoint that answered is serving the model we selected.
///
/// Readiness proves a server is listening on the port; it does not prove *which*
/// server. This asks the endpoint which alias it is serving, and refuses a
/// mismatch before any row exists.
///
/// What it does **not** prove, measured rather than assumed: b10343 answers
/// `/v1/models` without checking the API key, so an incumbent process serving
/// the same alias satisfies this check. Alias agreement is therefore evidence
/// about the endpoint, not proof of process ownership. Ownership comes from
/// elsewhere — the port preflight above, and the fact that inference *is*
/// authenticated with a fresh per-session key, so a foreign process cannot
/// produce a generation at all.
///
/// The alias comes from the launch contract, which comes from the verified
/// model, so agreement here closes the chain:
///
/// ```text
/// recorded artifact identity == verified selected model == actual serving model
/// ```
pub fn serving_identity_verdict(expected_alias: &str, served: &[String]) -> Result<(), String> {
    if served.iter().any(|alias| alias == expected_alias) {
        return Ok(());
    }
    if served.is_empty() {
        return Err(format!(
            "the endpoint is ready but serves no model at all, so nothing can be attributed \
             to '{expected_alias}'"
        ));
    }
    Err(format!(
        "the endpoint is serving {} but the benchmark selected '{expected_alias}'; refusing to \
         record generations under an identity that did not produce them",
        served
            .iter()
            .map(|alias| format!("'{alias}'"))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Whether the model that answered *this* response is the one being measured.
///
/// [`serving_identity_verdict`] asks the endpoint once, before the first prompt.
/// That closes the incumbent-process hole and nothing else: it is a snapshot, and
/// a runtime that swaps models afterwards would keep answering, keep reporting
/// the other alias, and every row after the swap would be filed under an artifact
/// that did not produce it. The preflight makes the first row trustworthy; this
/// makes every row trustworthy.
///
/// Silence is refused too. A response that does not say which model produced it
/// cannot be attributed, and attributing it anyway is exactly the assumption the
/// preflight exists to stop making.
pub fn response_identity_verdict(expected_alias: &str, reported: Option<&str>) -> Result<(), String> {
    // Stated here because this is where the alias is compared: an official run
    // never falls back. `STANDARD -> LITE` is right for the product, where the
    // player wants the game to keep going; it is wrong for a measurement, where
    // an answer produced by Lite recorded under Standard is not a worse result,
    // it is a result about a different model.
    match reported {
        Some(alias) if alias == expected_alias => Ok(()),
        Some(alias) => Err(format!(
            "the response was produced by '{alias}' but the benchmark is measuring \
             '{expected_alias}'; the runtime changed models mid-run and this row cannot \
             be attributed to either with confidence"
        )),
        None => Err(format!(
            "the runtime did not say which model answered, so this row cannot be \
             attributed to '{expected_alias}' by anything except assumption"
        )),
    }
}

/// Resolve the requested benchmark profile against the locked profile ids.
///
/// Two different situations that used to look identical from the outside:
///
/// * `standardd` is **operator error**. The id does not exist, nothing can ever
///   resolve it, and the command must fail rather than report a skip.
/// * `standard` is a real locked profile that may simply be absent from this
///   machine. That skip is deliberate and stays.
///
/// Conflating them meant a typo produced a green benchmark command with no
/// metadata, no generations and no evidence at all.
///
/// The known ids come from [`crate::model_lock::KNOWN_PROFILE_IDS`], the same
/// list the resolver and the orchestrator use; this module does not keep its
/// own. Ids are canonical and matched exactly: `Lite` and `lite ` are refused,
/// because a benchmark that silently normalises its inputs is a benchmark whose
/// records cannot be trusted to say what was asked.
fn resolve_requested_profile(raw: Option<String>) -> Result<String, String> {
    let Some(requested) = raw else {
        // No override: the documented default.
        return Ok(crate::model_lock::LITE_PROFILE_ID.to_string());
    };

    if requested.trim().is_empty() {
        return Err(format!(
            "CHRONOSAGA_BENCHMARK_PROFILE is set but empty; unset it to use the default \
             '{}' profile, or name one of: {}",
            crate::model_lock::LITE_PROFILE_ID,
            crate::model_lock::KNOWN_PROFILE_IDS.join(", ")
        ));
    }

    if crate::model_lock::KNOWN_PROFILE_IDS.contains(&requested.as_str()) {
        return Ok(requested);
    }

    Err(format!(
        "CHRONOSAGA_BENCHMARK_PROFILE names '{requested}', which is not a locked benchmark \
         profile. Known profiles are: {}. Nothing was run.",
        crate::model_lock::KNOWN_PROFILE_IDS.join(", ")
    ))
}

/// Which cases a smoke pass runs.
///
/// Named ids when asked for, otherwise the first `count`. P0.5-A needs to reach
/// specific shapes — a zero-speaker description, a proposal, a suggestion — and
/// taking the first three would only ever exercise dialogue.
fn cases_to_run(suite: &BenchmarkSuite, count: usize) -> Result<Vec<&BenchmarkCase>, String> {
    match env::var("CHRONOSAGA_BENCHMARK_CASE_IDS") {
        Ok(raw) if !raw.trim().is_empty() => select_cases(suite, &raw),
        _ => Ok(suite.cases.iter().take(count).collect()),
    }
}

/// Resolve an explicit case-id request against the suite.
///
/// Every requested id must resolve. Silently dropping a typo used to produce a
/// green command with no evidence at all: zero cases selected, zero generations,
/// and a final assertion comparing zero rows against zero attempts. An operator
/// asking for a case that does not exist has made a mistake and needs to be told,
/// not handed a passing run.
///
/// Duplicates are **deduplicated**, keeping first-request order: asking for the
/// same case twice is a harmless slip rather than an instruction to run it twice,
/// and running it twice would produce two attempt-1 rows for one pair, which the
/// fairness rules reject anyway.
fn select_cases<'a>(suite: &'a BenchmarkSuite, raw: &str) -> Result<Vec<&'a BenchmarkCase>, String> {
    let requested: Vec<&str> = raw
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();

    if requested.is_empty() {
        return Err(
            "CHRONOSAGA_BENCHMARK_CASE_IDS was set but names no case; unset it to run the \
             default smoke selection"
                .to_string(),
        );
    }

    let unknown: Vec<&str> = requested
        .iter()
        .filter(|id| !suite.cases.iter().any(|case| case.id == **id))
        .copied()
        .collect();
    if !unknown.is_empty() {
        return Err(format!(
            "CHRONOSAGA_BENCHMARK_CASE_IDS names {} case(s) the suite does not contain: {}. \
             Nothing was run.",
            unknown.len(),
            unknown.join(", ")
        ));
    }

    let mut selected: Vec<&BenchmarkCase> = Vec::new();
    for id in requested {
        if selected.iter().any(|case| case.id == id) {
            continue;
        }
        selected.push(
            suite
                .cases
                .iter()
                .find(|case| case.id == id)
                .expect("checked above"),
        );
    }
    Ok(selected)
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

/// What the environment is asking of the benchmark.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BenchmarkRequest {
    /// Nobody opted in. A normal `cargo test` skips, and that is correct.
    Disabled,
    /// Opted in, with the configuration the run needs.
    Enabled { workspace_root: String },
}

/// Read the two environment variables into a request, or refuse.
///
/// The old predicate collapsed three situations into two. `CHRONOSAGA_BENCHMARK=1`
/// with no workspace root returned false, so the test skipped and `cargo test`
/// exited green — and green meant either "the benchmark ran" or "somebody asked
/// for the benchmark and it silently did nothing because a variable was
/// missing". Those must not look the same to an operator.
///
/// Not opting in is a skip. Opting in and being unable to run is a failure.
///
/// Pure, so it can be tested without mutating process-global environment across
/// threads: the caller reads the variables and passes the values in.
pub fn benchmark_request(
    benchmark: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<BenchmarkRequest, String> {
    if benchmark != Some("1") {
        return Ok(BenchmarkRequest::Disabled);
    }
    match workspace_root {
        Some(root) if !root.trim().is_empty() => Ok(BenchmarkRequest::Enabled {
            workspace_root: root.to_string(),
        }),
        Some(_) => Err(format!(
            "{BENCHMARK_ENV}=1 asked for a benchmark run, but {WORKSPACE_ENV} is set to a blank \
             value. Set it to the development workspace root, for example \
             {WORKSPACE_ENV}=D:\\Chronosaga. Nothing was run."
        )),
        None => Err(format!(
            "{BENCHMARK_ENV}=1 asked for a benchmark run, but {WORKSPACE_ENV} is not set. The \
             models live outside the repository and the run cannot find them without it. Set it \
             to the development workspace root, for example {WORKSPACE_ENV}=D:\\Chronosaga. \
             Nothing was run."
        )),
    }
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

    /// Coverage that satisfies [`requirement`]: both profiles, both cases.
    fn full_coverage() -> RunCoverage {
        RunCoverage::from_pairs([
            ("lite", "ai_case_001"),
            ("lite", "ai_case_002"),
            ("standard", "ai_case_001"),
            ("standard", "ai_case_002"),
        ])
    }

    /// Full coverage on paper, with one case Standard did not answer itself.
    fn fallback_coverage() -> RunCoverage {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let accepted = crate::inference::InferenceOutcome {
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
            model: Some("lite".to_string()),
        };
        let mut records = vec![
            record_generation("r", case, "lite", 1, test_artifact("lite"),
                benchmark_context(4096), first_attempt_fingerprint(case), &accepted),
            record_generation("r", case, "standard", 1, test_artifact("standard"),
                benchmark_context(4096), first_attempt_fingerprint(case), &accepted),
        ];
        // Standard asked; Lite answered.
        records[1].fallback_used = true;
        records[1].fallback_profile = Some("lite".to_string());
        RunCoverage::from_records(&records)
    }

    /// Full coverage but for one pair whose retry never happened.
    fn unfinished_coverage() -> RunCoverage {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let accepted = accepted_outcome("lite");
        let mut rejected = accepted_outcome("standard");
        rejected.accepted = false;
        rejected.validation_error = Some("unknown tone tag".to_string());

        RunCoverage::from_records(&[
            record_generation("r", case, "lite", 1, test_artifact("lite"),
                benchmark_context(4096), first_attempt_fingerprint(case), &accepted),
            // Standard refused once and was never asked again.
            record_generation("r", case, "standard", 1, test_artifact("standard"),
                benchmark_context(4096), first_attempt_fingerprint(case), &rejected),
        ])
    }

    /// An accepted outcome answered by `alias`.
    fn accepted_outcome(alias: &str) -> crate::inference::InferenceOutcome {
        crate::inference::InferenceOutcome {
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
            model: Some(alias.to_string()),
        }
    }

    /// What a default smoke actually covers: a few cases, one model.
    fn smoke_coverage() -> RunCoverage {
        RunCoverage::from_pairs([("lite", "ai_case_001")])
    }

    // ---------------------------------------------------------------------
    // The shared official-evidence requirements
    // ---------------------------------------------------------------------

    /// Metadata that satisfies every reproducibility requirement there is.
    fn impeccable_metadata() -> RunMetadata {
        test_metadata(false)
    }

    /// Which shared requirements a given run fails.
    fn failed_requirements(metadata: &RunMetadata, coverage: &RunCoverage) -> Vec<&'static str> {
        official_evidence_failures(metadata, coverage, &requirement())
            .into_iter()
            .map(|(tag, _)| tag)
            .collect()
    }

    #[test]
    fn every_shared_requirement_is_reachable() {
        // The list is only worth exporting if each entry is a check something can
        // actually fail. An id nobody can trip is a promise the report boundary
        // would keep alone.
        let mut reached: Vec<&'static str> = Vec::new();

        let mut smoke = impeccable_metadata();
        smoke.run_kind = RunKind::Smoke;
        reached.extend(failed_requirements(&smoke, &full_coverage()));

        let mut dirty = impeccable_metadata();
        dirty.git_dirty = true;
        reached.extend(failed_requirements(&dirty, &full_coverage()));

        let mut short = impeccable_metadata();
        short.git_commit = "9599f38".to_string();
        reached.extend(failed_requirements(&short, &full_coverage()));

        let mut unprovenanced = impeccable_metadata();
        unprovenanced.runtime_executable_sha256 = None;
        reached.extend(failed_requirements(&unprovenanced, &full_coverage()));

        let mut hostless = impeccable_metadata();
        hostless.host.logical_cores = 0;
        reached.extend(failed_requirements(&hostless, &full_coverage()));

        let mut suiteless = impeccable_metadata();
        suiteless.suite_version = String::new();
        reached.extend(failed_requirements(&suiteless, &full_coverage()));

        reached.extend(failed_requirements(&impeccable_metadata(), &smoke_coverage()));
        reached.extend(failed_requirements(&impeccable_metadata(), &fallback_coverage()));
        reached.extend(failed_requirements(&impeccable_metadata(), &unfinished_coverage()));

        for requirement in OFFICIAL_EVIDENCE_REQUIREMENTS {
            assert!(
                reached.contains(requirement),
                "no run in this test fails '{requirement}', so the exported list \
                 claims a check that does not exist"
            );
        }
        for reached in reached {
            assert!(
                OFFICIAL_EVIDENCE_REQUIREMENTS.contains(&reached),
                "'{reached}' is enforced here but absent from the exported list, so \
                 the TypeScript boundary was never told about it"
            );
        }
    }

    // ---------------------------------------------------------------------
    // Terminal histories
    // ---------------------------------------------------------------------

    /// Coverage for one pair with the given `(attempt, accepted)` history.
    fn history_coverage(history: &[(u32, bool)]) -> RunCoverage {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let accepted = accepted_outcome("lite");
        let mut rejected = accepted_outcome("lite");
        rejected.accepted = false;
        rejected.validation_error = Some("unknown tone tag".to_string());

        let rows: Vec<GenerationRecord> = history
            .iter()
            .map(|(attempt, ok)| {
                record_generation(
                    "r", case, "lite", *attempt, test_artifact("lite"),
                    benchmark_context(4096), first_attempt_fingerprint(case),
                    if *ok { &accepted } else { &rejected },
                )
            })
            .collect();
        RunCoverage::from_records(&rows)
    }

    #[test]
    fn a_finished_history_establishes_its_pair() {
        // A: accepted first try. B: rejected then accepted. C: rejected twice,
        // which is exhausted, and exhausted is an answer.
        for history in [
            vec![(1, true)],
            vec![(1, false), (2, true)],
            vec![(1, false), (2, false)],
        ] {
            let coverage = history_coverage(&history);
            assert_eq!(coverage.pair_count(), 1, "{history:?}");
            assert!(coverage.unfinished_histories().is_empty(), "{history:?}");
        }
    }

    #[test]
    fn d_a_rejected_first_attempt_alone_is_unfinished() {
        // The defect: this counted as a completed pair, so a run could report
        // full coverage made entirely of interruptions.
        let coverage = history_coverage(&[(1, false)]);
        assert_eq!(coverage.pair_count(), 0, "an unfinished history covers nothing");
        assert_eq!(coverage.unfinished_histories().len(), 1);
    }

    #[test]
    fn g_and_h_an_unfinished_pair_is_named_with_its_case_and_profile() {
        let suite = load_suite().unwrap();
        let first = suite.cases[0].id.clone();
        let failures = official_evidence_failures(
            &impeccable_metadata(),
            &history_coverage(&[(1, false)]),
            &CoverageRequirement {
                required_case_ids: vec![first.clone()],
                required_profiles: vec!["lite".to_string()],
            },
        );
        let tags: Vec<&str> = failures.iter().map(|(tag, _)| *tag).collect();
        assert!(tags.contains(&"complete_retry_history"), "{tags:?}");

        let detail = failures
            .iter()
            .find(|(tag, _)| *tag == "complete_retry_history")
            .map(|(_, detail)| detail.clone())
            .unwrap();
        assert!(detail.contains(&first), "{detail}");
        assert!(detail.contains("lite"), "{detail}");
        assert!(detail.contains("retry evidence is missing"), "{detail}");
    }

    #[test]
    fn i_and_j_histories_that_break_the_policy_are_not_terminal_either() {
        // A retry after an acceptance, a third attempt, a history that starts at
        // two, a gap: none has a trustworthy last attempt, so none establishes a
        // pair. Their specific complaints belong to the checks that own them.
        for history in [
            vec![(1, true), (2, false)],
            vec![(1, false), (2, false), (3, false)],
            vec![(2, false)],
            vec![(1, false), (3, false)],
        ] {
            let coverage = history_coverage(&history);
            assert_eq!(coverage.pair_count(), 0, "{history:?}");
            assert!(
                coverage.unfinished_histories().is_empty(),
                "{history:?} is malformed, not merely unfinished"
            );
        }
    }

    #[test]
    fn k_one_profile_may_use_its_retry_while_the_other_does_not() {
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let lite_ok = accepted_outcome("lite");
        let standard_ok = accepted_outcome("standard");
        let mut standard_bad = accepted_outcome("standard");
        standard_bad.accepted = false;
        standard_bad.validation_error = Some("unknown tone tag".to_string());

        let coverage = RunCoverage::from_records(&[
            record_generation("r", case, "lite", 1, test_artifact("lite"),
                benchmark_context(4096), first_attempt_fingerprint(case), &lite_ok),
            record_generation("r", case, "standard", 1, test_artifact("standard"),
                benchmark_context(4096), first_attempt_fingerprint(case), &standard_bad),
            record_generation("r", case, "standard", 2, test_artifact("standard"),
                benchmark_context(4096), first_attempt_fingerprint(case), &standard_ok),
        ]);
        assert_eq!(coverage.pair_count(), 2);
        assert!(coverage.covers("lite", &case.id));
        assert!(coverage.covers("standard", &case.id));
    }

    #[test]
    fn the_retry_policy_is_one_number_in_both_languages() {
        // Neither side may raise its own budget. A benchmark where Rust allows
        // two tries and TypeScript allows three is measuring the retry budget.
        let declared = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/ai-benchmark/src/result.ts");
        let source = fs::read_to_string(&declared)
            .unwrap_or_else(|error| panic!("missing {}: {error}", declared.display()));
        assert!(
            source.contains(&format!("export const MAX_RETRIES = {MAX_RETRIES};")),
            "the TypeScript contract declares a different retry budget"
        );
        assert!(
            source.contains("export const MAX_ATTEMPTS = MAX_RETRIES + 1;"),
            "the TypeScript contract derives attempts differently"
        );
        assert_eq!(MAX_ATTEMPTS, MAX_RETRIES + 1);
    }

    #[test]
    fn a_fallback_row_covers_nothing_and_is_named() {
        // Both halves of the rule. The row is refused as evidence, and it does
        // not quietly stand in for the answer the profile never gave.
        let coverage = fallback_coverage();
        let suite = load_suite().unwrap();
        let first = suite.cases[0].id.as_str();
        assert!(coverage.covers("lite", first), "lite answered it itself");
        assert!(
            !coverage.covers("standard", first),
            "standard did not answer this case; lite did"
        );
        assert_eq!(coverage.fallback_rows().len(), 1);

        let failures = official_evidence_failures(
            &impeccable_metadata(),
            &coverage,
            &CoverageRequirement {
                required_case_ids: vec![first.to_string()],
                required_profiles: vec!["lite".to_string(), "standard".to_string()],
            },
        );
        let tags: Vec<&str> = failures.iter().map(|(tag, _)| *tag).collect();
        assert!(tags.contains(&"no_fallback_evidence"), "{tags:?}");
        assert!(
            failures
                .iter()
                .any(|(_, detail)| detail.contains("answered by a fallback profile")),
            "{failures:?}"
        );
    }

    #[test]
    fn impeccable_evidence_fails_nothing() {
        assert!(failed_requirements(&impeccable_metadata(), &full_coverage()).is_empty());
        official_run_verdict(&impeccable_metadata(), &full_coverage(), &requirement())
            .expect("this is what official evidence looks like");
    }

    #[test]
    fn the_requirement_list_is_exported_for_the_report_boundary() {
        // The same contract-fixture mechanism as the run shape, for the same
        // reason: the TypeScript gate implements these checks against the JSON it
        // holds, and neither side may add or drop one alone.
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/ai-benchmark/tests/fixtures/official-evidence-requirements.json");
        let produced =
            serde_json::to_string_pretty(&OFFICIAL_EVIDENCE_REQUIREMENTS).unwrap() + "\n";

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
            "the official-evidence requirements changed; regenerate the fixture and \
             implement the requirement at the TypeScript report boundary too"
        );
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
    fn split_coverage_between_profiles_is_refused() {
        // The defect, exactly: `lite/A` plus `standard/B` gives profiles
        // {lite, standard} and cases {A, B}, so two independent set checks both
        // pass while neither model answered what the other did.
        let coverage = RunCoverage::from_pairs([("lite", "ai_case_001"), ("standard", "ai_case_002")]);
        let refused = official_run_verdict(&test_metadata(false), &coverage, &requirement())
            .expect_err("neither profile covered the suite");

        assert!(refused.contains("lite is missing 1 of 2"), "{refused}");
        assert!(refused.contains("ai_case_002"), "{refused}");
        assert!(refused.contains("standard is missing 1 of 2"), "{refused}");
        assert!(refused.contains("ai_case_001"), "{refused}");
    }

    #[test]
    fn every_profile_case_pair_present_is_accepted() {
        official_run_verdict(&test_metadata(false), &full_coverage(), &requirement())
            .expect("both profiles answered both cases");
    }

    #[test]
    fn an_official_run_missing_a_profile_entirely_is_refused() {
        let coverage = RunCoverage::from_pairs([("lite", "ai_case_001"), ("lite", "ai_case_002")]);
        let refused = official_run_verdict(&test_metadata(false), &coverage, &requirement())
            .expect_err("one model is not a comparison");
        assert!(refused.contains("no generations at all for standard"), "{refused}");
        assert!(refused.contains("nothing to compare"), "{refused}");
    }

    #[test]
    fn a_profile_missing_one_case_is_refused_and_named() {
        // Lite ran everything, Standard is one short. The report has to say
        // which profile and which case, or nobody can act on it.
        let coverage = RunCoverage::from_pairs([
            ("lite", "ai_case_001"),
            ("lite", "ai_case_002"),
            ("standard", "ai_case_001"),
        ]);
        let refused = official_run_verdict(&test_metadata(false), &coverage, &requirement())
            .expect_err("a subset is not the suite");

        assert!(refused.contains("standard is missing 1 of 2"), "{refused}");
        assert!(refused.contains("ai_case_002"), "{refused}");
        assert!(!refused.contains("lite is missing"), "lite was complete: {refused}");
    }

    #[test]
    fn retries_do_not_inflate_coverage() {
        // A pair is established once, however many attempts it took. Three rows
        // for one case must not stand in for three cases.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let rejected = crate::inference::InferenceOutcome {
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
            model: Some("lite".to_string()),
        };
        let rows: Vec<GenerationRecord> = (1..=MAX_ATTEMPTS as u32)
            .map(|attempt| {
                record_generation("r", case, "lite", attempt, test_artifact("lite"),
                    benchmark_context(4096), first_attempt_fingerprint(case), &rejected)
            })
            .collect();

        let coverage = RunCoverage::from_records(&rows);
        assert_eq!(coverage.pair_count(), 1, "a first attempt and its retry, one pair");
        assert!(coverage.covers("lite", &case.id));
        assert!(!coverage.covers("standard", &case.id));

        // And a history that ran past the ceiling establishes nothing at all: it
        // has no trustworthy last attempt to call the profile's answer.
        let mut beyond = rows.clone();
        beyond.push(record_generation("r", case, "lite", MAX_ATTEMPTS as u32 + 1,
            test_artifact("lite"), benchmark_context(4096),
            first_attempt_fingerprint(case), &rejected));
        assert_eq!(RunCoverage::from_records(&beyond).pair_count(), 0);
    }

    #[test]
    fn a_full_run_with_retries_still_covers_everything() {
        let suite = load_suite().unwrap();
        let cases = &suite.cases[..2];
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
        // A retry follows a rejection and nothing else, so the history that
        // uses one is: rejected, then accepted.
        let mut rejected = outcome.clone();
        rejected.accepted = false;
        rejected.validation_error = Some("unknown tone tag".to_string());

        let mut rows = Vec::new();
        for case in cases {
            for profile in ["lite", "standard"] {
                rows.push(record_generation("r", case, profile, 1,
                    test_artifact(profile), benchmark_context(4096),
                    first_attempt_fingerprint(case), &rejected));
                rows.push(record_generation("r", case, profile, 2,
                    test_artifact(profile), benchmark_context(4096),
                    first_attempt_fingerprint(case), &outcome));
            }
        }

        let coverage = RunCoverage::from_records(&rows);
        assert_eq!(coverage.pair_count(), 4, "2 cases x 2 profiles, retries aside");
        let required = CoverageRequirement {
            required_case_ids: cases.iter().map(|case| case.id.clone()).collect(),
            required_profiles: vec!["lite".to_string(), "standard".to_string()],
        };
        official_run_verdict(&test_metadata(false), &coverage, &required)
            .expect("retries do not break coverage");
    }

    #[test]
    fn the_full_suite_requires_one_pair_per_profile_per_case() {
        // 65 cases across two profiles is 130 pairs, and nothing less counts.
        let suite = load_suite().unwrap();
        let required = full_comparison_requirement(&suite);
        let expected_pairs = suite.cases.len() * required.required_profiles.len();
        assert_eq!(expected_pairs, 130, "the committed suite is 65 cases");

        let complete = RunCoverage::from_pairs(
            required.required_profiles.iter().flat_map(|profile| {
                required
                    .required_case_ids
                    .iter()
                    .map(move |case_id| (profile.clone(), case_id.clone()))
            }),
        );
        assert_eq!(complete.pair_count(), expected_pairs);
        official_run_verdict(&test_metadata(false), &complete, &required)
            .expect("every pair present");

        // One pair short is not comparable.
        let mut short: Vec<(String, String)> = required
            .required_profiles
            .iter()
            .flat_map(|profile| {
                required
                    .required_case_ids
                    .iter()
                    .map(move |case_id| (profile.clone(), case_id.clone()))
            })
            .collect();
        short.pop();
        let refused = official_run_verdict(
            &test_metadata(false),
            &RunCoverage::from_pairs(short),
            &required,
        )
        .expect_err("129 of 130 is not a comparison");
        assert!(refused.contains("standard is missing 1 of 65"), "{refused}");
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
        assert_eq!(coverage.pair_count(), 2, "one case answered by two profiles");
        assert!(coverage.covers("lite", &case.id));
        assert!(coverage.covers("standard", &case.id));
        assert!(!coverage.covers("lite", "ai_case_999"));
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
            // A rejected answer still says who produced it: rejection is the
            // validator's verdict on the content, not a failure to attribute.
            model: Some("standard".to_string()),
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
    fn the_prompt_names_required_speakers_and_only_those() {
        // G: if a speaker must appear, the prompt says so. If nobody must, it
        // says that too, so a silent bystander is never an implied fault.
        let suite = load_suite().unwrap();

        let requiring = suite
            .cases
            .iter()
            .find(|case| !case.constraints.required_speaker_ids.is_empty())
            .expect("dialogue cases require their speakers");
        let prompt = system_prompt(requiring);
        assert!(prompt.contains("DEVONO parlare"), "{prompt}");
        for speaker in &requiring.constraints.required_speaker_ids {
            assert!(prompt.contains(speaker.as_str()), "{prompt}");
        }

        let permissive = suite
            .cases
            .iter()
            .find(|case| {
                !case.constraints.known_speaker_ids.is_empty()
                    && case.constraints.required_speaker_ids.is_empty()
            })
            .expect("some case permits speech without demanding it");
        let prompt = system_prompt(permissive);
        assert!(prompt.contains("nessuno e' obbligato"), "{prompt}");
        assert!(!prompt.contains("DEVONO parlare"), "{prompt}");
    }

    #[test]
    fn the_two_cases_that_expect_both_voices_now_demand_them() {
        // P2-B. Both cases state "both characters speak" as an expected fact,
        // and nothing enforced it: the prompt was free to say nobody had to
        // speak while the evaluation expected two voices. The intent is in the
        // fact itself — these are consequence scenes written around a reaction
        // from each side, not a narration that happens to have people nearby.
        let suite = load_suite().unwrap();
        for id in ["ai_case_036", "ai_case_041"] {
            let case = suite
                .cases
                .iter()
                .find(|candidate| candidate.id == id)
                .expect("the case exists");
            assert!(
                case.expected_facts
                    .iter()
                    .any(|fact| fact == "both characters speak"),
                "{id} no longer expects both voices; the requirement should follow"
            );
            assert_eq!(
                case.constraints.required_speaker_ids, case.constraints.known_speaker_ids,
                "{id} expects both to speak, so both are required"
            );

            let prompt = system_prompt(case);
            assert!(prompt.contains("DEVONO parlare"), "{id}: {prompt}");
            for speaker in &case.constraints.required_speaker_ids {
                assert!(prompt.contains(speaker.as_str()), "{id}: {prompt}");
            }
        }
    }

    // ---------------------------------------------------------------------
    // Scene grounding
    // ---------------------------------------------------------------------

    /// Every id-shaped string visible in one case's slice, computed here rather
    /// than taken from the code under test.
    fn visible_scene_ids(case: &BenchmarkCase) -> Vec<String> {
        /// The id shape, spelled out independently of the code under test.
        fn shaped(text: &str) -> bool {
            let parts: Vec<&str> = text.split('_').collect();
            parts.len() > 1
                && parts[0].starts_with(|c: char| c.is_ascii_lowercase())
                && parts.iter().all(|part| {
                    !part.is_empty()
                        && part
                            .chars()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                })
        }
        fn keep(text: &str, out: &mut Vec<String>) {
            if shaped(text) && !out.iter().any(|existing| existing == text) {
                out.push(text.to_string());
            }
        }
        fn walk(value: &serde_json::Value, out: &mut Vec<String>) {
            match value {
                serde_json::Value::String(text) => keep(text, out),
                serde_json::Value::Array(items) => {
                    for item in items {
                        walk(item, out);
                    }
                }
                serde_json::Value::Object(fields) => {
                    for (key, nested) in fields {
                        keep(key, out);
                        walk(nested, out);
                    }
                }
                _ => {}
            }
        }
        let mut ids = Vec::new();
        walk(&case.world_state_slice, &mut ids);
        ids
    }

    #[test]
    fn a_and_b_the_faction_the_scene_names_is_a_valid_subject() {
        // The finding exactly: ai_case_049 has no characters at all and prints
        // settlement.controllingFactionId. A proposal about that faction read
        // the context it was given and was refused for it.
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|candidate| candidate.id == "ai_case_049")
            .expect("the case exists");
        assert!(case.characters.is_empty(), "the case has nobody to inherit a faction from");

        let subjects = case_subject_ids(case);
        assert!(subjects.iter().any(|id| id == "faction_compact"), "{subjects:?}");
        assert!(subjects.iter().any(|id| id == "settlement_helios"), "{subjects:?}");
    }

    #[test]
    fn c_d_e_and_f_the_walk_reads_values_keys_and_arrays_but_not_prose() {
        let scene = serde_json::json!({
            "settlement": {
                "id": "settlement_helios",
                "name": "Helios Reach",
                "controllingFactionId": "faction_compact",
                "garrison": ["squad_alpha", "una pattuglia stanca"],
                "faction_compact": { "standing": 0.4 },
                "nested": { "deep": { "id": "relay_north_02" } }
            },
            "turn": 9
        });
        let mut found: Vec<String> = Vec::new();
        collect_scene_ids(&scene, &mut |id| {
            if !found.iter().any(|existing| existing == id) {
                found.push(id.to_string());
            }
        });

        assert!(found.contains(&"settlement_helios".to_string()), "C: {found:?}");
        assert!(found.contains(&"relay_north_02".to_string()), "C nested: {found:?}");
        assert!(found.contains(&"faction_compact".to_string()), "D key: {found:?}");
        assert!(found.contains(&"squad_alpha".to_string()), "E array: {found:?}");
        assert!(!found.contains(&"Helios Reach".to_string()), "F: {found:?}");
        assert!(
            !found.iter().any(|id| id.contains(' ')),
            "F: prose is not an identifier: {found:?}"
        );
        assert!(!found.contains(&"turn".to_string()), "a bare word is not an id");
    }

    #[test]
    fn an_underscore_alone_does_not_make_an_identifier() {
        for text in ["Faction_Compact", "_leading", "trailing_", "a__b", "faction compact", "turn"] {
            assert!(!is_entity_id(text), "'{text}' must not be collected");
        }
        for text in ["mara_001", "settlement_helios", "faction_compact", "relay_north_02"] {
            assert!(is_entity_id(text), "'{text}' is an id");
        }
    }

    #[test]
    fn g_an_id_absent_from_the_scene_is_still_refused() {
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|candidate| candidate.id == "ai_case_049")
            .expect("the case exists");
        assert!(
            !case_subject_ids(case).iter().any(|id| id == "settlement_fake"),
            "grounding was widened to shape, not abolished"
        );

        let payload = "{\"narration\": \"Helios Reach tace.\", \"dialogue\": [], \
                       \"tone_tags\": [], \"event_proposals\": [{\"subjectId\": \
                       \"settlement_fake\", \"topic\": \"t\", \"rationale\": \"r\"}], \
                       \"memory_suggestions\": []}";
        assert!(matches!(
            crate::inference::validate(payload, &case_contract(case)),
            Err(crate::inference::ValidationError::AuthoritativeClaim(_))
        ));
    }

    #[test]
    fn h_a_proposal_about_the_scene_faction_is_accepted() {
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|candidate| candidate.id == "ai_case_049")
            .expect("the case exists");
        let tag = case.constraints.allowed_tone_tags[0].clone();
        let payload = format!(
            "{{\"narration\": \"Helios Reach tace.\", \"dialogue\": [], \
             \"tone_tags\": [\"{tag}\"], \"event_proposals\": [{{\"subjectId\": \
             \"faction_compact\", \"topic\": \"debito\", \"rationale\": \"Il relay e' \
             stato richiamato.\"}}], \"memory_suggestions\": []}}"
        );
        crate::inference::validate(&payload, &case_contract(case))
            .unwrap_or_else(|error| panic!("{}", error.message()));
    }

    #[test]
    fn i_every_visible_scene_id_is_a_permitted_subject() {
        // The suite-wide invariant rather than a list of special cases: whatever
        // the model can read in the slice, it may legitimately name.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let subjects = case_subject_ids(case);
            for visible in visible_scene_ids(case) {
                assert!(
                    subjects.contains(&visible),
                    "{}: the scene shows '{visible}' and the validator would refuse it",
                    case.id
                );
            }
        }
    }

    #[test]
    fn j_the_older_grounding_sources_are_untouched() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let subjects = case_subject_ids(case);
            for character in &case.characters {
                assert!(subjects.contains(&character.id), "{}", case.id);
                if let Some(faction) = &character.faction_id {
                    assert!(subjects.contains(faction), "{}", case.id);
                }
                if let Some(location) = &character.location_id {
                    assert!(subjects.contains(location), "{}", case.id);
                }
            }
            for change in &case.recent_delta.changes {
                for part in change.key.split('.') {
                    assert!(subjects.contains(&part.to_string()), "{}: {part}", case.id);
                }
            }
        }
    }

    #[test]
    fn subjects_are_deduplicated_and_stable() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let subjects = case_subject_ids(case);
            let unique: std::collections::BTreeSet<&String> = subjects.iter().collect();
            assert_eq!(unique.len(), subjects.len(), "{} repeats a subject", case.id);
            assert_eq!(subjects, case_subject_ids(case), "{} is not deterministic", case.id);
        }
    }

    // ---------------------------------------------------------------------
    // Exact suite content binding
    // ---------------------------------------------------------------------

    #[test]
    fn g_key_order_does_not_change_the_canonical_form() {
        let one: serde_json::Value =
            serde_json::from_str(r#"{"b": 1, "a": {"d": [3, 2], "c": null}}"#).unwrap();
        let other: serde_json::Value =
            serde_json::from_str(r#"{"a": {"c": null, "d": [3, 2]}, "b": 1}"#).unwrap();
        assert_eq!(canonical_json(&one), canonical_json(&other));
        assert_eq!(suite_content_digest(&one), suite_content_digest(&other));

        // Array order is meaning, and must still change the digest.
        let reordered: serde_json::Value =
            serde_json::from_str(r#"{"a": {"c": null, "d": [2, 3]}, "b": 1}"#).unwrap();
        assert_ne!(suite_content_digest(&one), suite_content_digest(&reordered));
    }

    #[test]
    fn b_through_f_any_content_change_changes_the_digest() {
        // Every mutation the finding names, with the version left untouched.
        let original = load_suite_json().unwrap();
        let base = suite_content_digest(&original);

        let mutate = |edit: &dyn Fn(&mut serde_json::Value)| {
            let mut copy = original.clone();
            edit(&mut copy);
            assert_eq!(
                copy["suiteVersion"], original["suiteVersion"],
                "the version must stay put; that is the whole point"
            );
            assert_ne!(suite_content_digest(&copy), base);
        };

        // B: an expected fact.
        mutate(&|suite| {
            suite["cases"][0]["expectedFacts"][0] = serde_json::json!("something else");
        });
        // C: a constraint.
        mutate(&|suite| {
            suite["cases"][0]["constraints"]["maxNarrationChars"] = serde_json::json!(1);
        });
        // D: the world state slice.
        mutate(&|suite| {
            suite["cases"][0]["worldStateSlice"]["settlement"]["population"] =
                serde_json::json!(1);
        });
        // E: a forbidden claim.
        mutate(&|suite| {
            suite["cases"][0]["forbiddenClaims"][0] = serde_json::json!("anything");
        });
        // F: a case removed, and a case added.
        mutate(&|suite| {
            suite["cases"].as_array_mut().unwrap().pop();
        });
        mutate(&|suite| {
            let extra = suite["cases"][0].clone();
            suite["cases"].as_array_mut().unwrap().push(extra);
        });
        // And a root field the BenchmarkSuite struct does not even keep.
        mutate(&|suite| {
            suite["status"] = serde_json::json!("SOMETHING_ELSE");
        });
    }

    #[test]
    fn the_digest_covers_fields_the_struct_discards() {
        // The implementation trap, stated as a test: hashing the parsed struct
        // would sign a document with three of its six root fields torn out.
        let complete = load_suite_json().unwrap();
        let root: Vec<&String> = complete.as_object().unwrap().keys().collect();
        assert!(root.len() > 3, "{root:?}");
        for field in ["outputContract", "scenario", "status"] {
            assert!(complete.get(field).is_some(), "{field} is in the file");
        }
        // The struct keeps three of them; the digest covers all six, which is
        // why the raw JSON is hashed rather than the parsed value.
        let kept = ["schemaVersion", "suiteVersion", "cases"];
        for field in root {
            if !kept.contains(&field.as_str()) {
                assert!(
                    ["outputContract", "scenario", "status"].contains(&field.as_str()),
                    "unexpected root field {field}; check the digest still covers it"
                );
            }
        }
    }

    #[test]
    fn a_loaded_suite_carries_its_own_digest() {
        let suite = load_suite().unwrap();
        assert_eq!(suite.content_sha256.len(), 64);
        assert!(suite.content_sha256.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            suite.content_sha256,
            suite_content_digest(&load_suite_json().unwrap())
        );

        let metadata = test_metadata(false);
        assert_eq!(metadata.suite_content_sha256, suite.content_sha256);
    }

    #[test]
    fn j_the_shipped_suite_digest_is_exported_for_typescript() {
        // Two independent implementations, one expected value. Asserting each
        // against itself would prove nothing about the other.
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/ai-benchmark/tests/fixtures/suite-content-digest.json");
        let produced = serde_json::to_string_pretty(&serde_json::json!({
            "suiteVersion": load_suite().unwrap().suite_version,
            "suiteContentSha256": load_suite().unwrap().content_sha256,
        }))
        .unwrap()
            + "\n";

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
            "the suite content changed; regenerate the fixture and check TypeScript agrees"
        );
    }

    #[test]
    fn the_case_contracts_are_exported_for_the_report_boundary() {
        // The report boundary has to be able to ask whether an accepted row
        // could have been accepted *for its own case*, which means deriving the
        // same contract this crate derives. Two derivations, one exported set of
        // answers: drift on either side fails here or there.
        let suite = load_suite().unwrap();
        let mut by_case = serde_json::Map::new();
        for case in &suite.cases {
            let contract = case_contract(case);
            by_case.insert(
                case.id.clone(),
                serde_json::json!({
                    "knownSpeakerIds": contract.known_speaker_ids,
                    "requiredSpeakerIds": contract.required_speaker_ids,
                    "allowedToneTags": contract.allowed_tone_tags,
                    "maxNarrationChars": contract.max_narration_chars,
                    "allowEventProposals": contract.allow_event_proposals,
                    "requireEventProposal": contract.require_event_proposal,
                    "allowMemorySuggestions": contract.allow_memory_suggestions,
                    "requireMemorySuggestion": contract.require_memory_suggestion,
                    "allowedSubjectIds": contract.allowed_subject_ids,
                    "knownCharacterIds": contract.known_character_ids,
                }),
            );
        }
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/ai-benchmark/tests/fixtures/case-contracts.json");
        let produced =
            serde_json::to_string_pretty(&serde_json::Value::Object(by_case)).unwrap() + "\n";

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
            "the contracts the validator derives changed; regenerate the fixture and \
             check the TypeScript report boundary derives the same ones"
        );
    }

    // ---------------------------------------------------------------------
    // The worked dialogue example
    // ---------------------------------------------------------------------

    /// The `dialogue` array as the worked example renders it.
    fn worked_dialogue(case: &BenchmarkCase) -> String {
        let prompt = system_prompt(case);
        let line = prompt.lines().last().expect("the example is the last line");
        let start = line.find("\"dialogue\": ").expect("the example names dialogue") + 12;
        let rest = &line[start..];
        let end = rest.find("], \"tone_tags\"").expect("the example is well formed") + 1;
        rest[..end].to_string()
    }

    /// The worked JSON object from a prompt, as a model would copy it.
    fn worked_example(case: &BenchmarkCase) -> String {
        let prompt = system_prompt(case);
        prompt
            .lines()
            .last()
            .expect("the example is the last line")
            .trim()
            .to_string()
    }

    #[test]
    fn every_worked_example_is_accepted_by_the_real_validator() {
        // The invariant that stops the next placeholder contradiction before it
        // is written. Not "the example looks right" — the example is parsed and
        // put through the same validator the run uses, with the same contract.
        //
        // A model that copies the prompt must not be rejected for obeying it.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let example = worked_example(case);
            crate::inference::validate(&example, &case_contract(case)).unwrap_or_else(|error| {
                panic!(
                    "{}: the prompt shows an example its own contract refuses: {}\n{}",
                    case.id,
                    error.message(),
                    example
                )
            });
        }
    }

    #[test]
    fn no_constrained_identity_is_left_as_an_ellipsis() {
        // Narration is free prose and keeps its ellipsis. Everything whose value
        // the validator checks is a real value.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let example = worked_example(case);
            for field in ["speakerId", "tone_tags", "subjectId", "characterId"] {
                let placeholder = format!("\"{field}\": \"...\"");
                assert!(!example.contains(&placeholder), "{}: {example}", case.id);
            }
            assert!(!example.contains("[\"...\"]"), "{}: {example}", case.id);
            assert!(example.contains("\"narration\": \"...\""), "{}", case.id);
        }
    }

    #[test]
    fn a_required_suggestion_example_uses_a_real_id() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let example = worked_example(case);
            if case.constraints.require_event_proposal {
                let subjects = case_subject_ids(case);
                assert!(
                    subjects.iter().any(|id| example.contains(id.as_str())),
                    "{} demands a proposal and shows no grounded subject: {example}",
                    case.id
                );
            }
            if case.constraints.require_memory_suggestion {
                assert!(
                    case.characters
                        .iter()
                        .any(|character| example.contains(character.id.as_str())),
                    "{} demands a memory and shows no real character: {example}",
                    case.id
                );
            }
        }
    }

    #[test]
    fn a_tone_tag_shown_is_a_tag_the_case_allows() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let example = worked_example(case);
            let start = example.find("\"tone_tags\": ").expect("the example names tone_tags") + 13;
            let rest = &example[start..];
            let end = rest.find(']').expect("well formed") + 1;
            let shown = &rest[..end];
            if shown == "[]" {
                continue;
            }
            assert!(
                case.constraints
                    .allowed_tone_tags
                    .iter()
                    .any(|tag| shown.contains(tag.as_str())),
                "{} shows {shown}, outside its vocabulary",
                case.id
            );
        }
    }

    #[test]
    fn a_strict_case_example_is_still_bare_json() {
        let suite = load_suite().unwrap();
        for case in suite.cases.iter().filter(|case| case.constraints.strict_json_only) {
            let example = worked_example(case);
            assert!(example.starts_with('{') && example.ends_with('}'), "{example}");
            assert!(!example.contains("```"), "{example}");
        }
    }

    // ---------------------------------------------------------------------
    // Consequence status
    // ---------------------------------------------------------------------

    #[test]
    fn the_suite_states_a_status_only_when_a_consequence_has_fired() {
        // Derived, so the rendering rule below is grounded in the data rather
        // than in an assumption about what statuses might exist.
        let suite = load_suite().unwrap();
        let mut seen: Vec<String> = Vec::new();
        for case in &suite.cases {
            for consequence in &case.constraints.pending_consequences {
                let status = consequence
                    .get("status")
                    .and_then(|value| value.as_str())
                    .unwrap_or("<assente>");
                if !seen.iter().any(|existing| existing == status) {
                    seen.push(status.to_string());
                }
            }
        }
        seen.sort();
        assert_eq!(seen, vec!["<assente>".to_string(), APPLIED_STATUS.to_string()]);
    }

    #[test]
    fn a_and_b_an_applied_consequence_is_presented_as_having_happened() {
        let suite = load_suite().unwrap();
        let case = suite
            .cases
            .iter()
            .find(|candidate| candidate.id == "ai_case_060")
            .expect("the case exists");
        let prompt = user_prompt(case);

        assert!(prompt.contains("CONSEGUENZE GIA' AVVENUTE"), "{prompt}");
        // A: it is no longer under the heading that denies it happened.
        let applied_at = prompt.find("CONSEGUENZE GIA' AVVENUTE").unwrap();
        assert!(
            prompt[applied_at..].contains("con_relay_debt_01"),
            "the applied consequence must appear under the applied heading"
        );
        assert!(
            !prompt.contains("CONSEGUENZE IN SOSPESO"),
            "{} has nothing left pending: {prompt}",
            case.id
        );
    }

    #[test]
    fn c_a_pending_consequence_is_still_presented_as_not_yet_occurred() {
        let suite = load_suite().unwrap();
        for id in ["ai_case_059", "ai_case_061", "ai_case_062"] {
            let case = suite.cases.iter().find(|c| c.id == id).expect("the case exists");
            let prompt = user_prompt(case);
            assert!(prompt.contains("non ancora avvenute"), "{id}: {prompt}");
            assert!(!prompt.contains("CONSEGUENZE GIA' AVVENUTE"), "{id}: {prompt}");
        }
    }

    #[test]
    fn d_hidden_consequences_are_still_protected() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let hidden_pending = case.constraints.pending_consequences.iter().any(|c| {
                c.get("visibility").and_then(|v| v.as_str()) == Some("hidden")
                    && c.get("status").and_then(|v| v.as_str()) != Some(APPLIED_STATUS)
            });
            if hidden_pending {
                assert!(
                    user_prompt(case).contains("quelle nascoste non vanno rivelate"),
                    "{}",
                    case.id
                );
            }
        }
    }

    #[test]
    fn e_f_and_g_no_consequence_is_filed_under_the_wrong_heading() {
        // The suite-wide invariant: whichever section a consequence appears in
        // must agree with its own status.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            if case.constraints.pending_consequences.is_empty() {
                continue;
            }
            let prompt = user_prompt(case);
            let applied_at = prompt.find("CONSEGUENZE GIA' AVVENUTE");
            let pending_at = prompt.find("CONSEGUENZE IN SOSPESO");

            for consequence in &case.constraints.pending_consequences {
                let id = consequence
                    .get("id")
                    .and_then(|value| value.as_str())
                    .expect("a consequence has an id");
                let is_applied =
                    consequence.get("status").and_then(|v| v.as_str()) == Some(APPLIED_STATUS);
                let section = if is_applied { applied_at } else { pending_at };
                let section = section.unwrap_or_else(|| {
                    panic!("{}: {id} has no section to belong to:\n{prompt}", case.id)
                });
                let other = if is_applied { pending_at } else { applied_at };

                let in_section = prompt[section..]
                    .split("\n\n")
                    .next()
                    .expect("a section")
                    .contains(id);
                assert!(in_section, "{}: {id} is under the wrong heading:\n{prompt}", case.id);

                if let Some(other) = other {
                    let in_other = prompt[other..]
                        .split("\n\n")
                        .next()
                        .expect("a section")
                        .contains(id);
                    assert!(!in_other, "{}: {id} appears in both sections", case.id);
                }
            }
        }
    }

    #[test]
    fn a_b_and_c_a_case_that_obliges_nobody_is_shown_no_line() {
        let suite = load_suite().unwrap();

        // A and B: no speakers at all. ai_case_049 was told "non produrre
        // dialogo" and then shown a line to copy.
        let silent = suite
            .cases
            .iter()
            .find(|case| case.constraints.known_speaker_ids.is_empty())
            .expect("some case has nobody in it");
        assert_eq!(worked_dialogue(silent), "[]");
        assert_eq!(
            worked_dialogue(
                suite
                    .cases
                    .iter()
                    .find(|case| case.id == "ai_case_049")
                    .expect("the case exists")
            ),
            "[]"
        );

        // C: permitted but not required. Showing a line would add an obligation
        // the contract does not contain.
        let permissive = suite
            .cases
            .iter()
            .find(|case| {
                !case.constraints.known_speaker_ids.is_empty()
                    && case.constraints.required_speaker_ids.is_empty()
            })
            .expect("some case permits speech without demanding it");
        assert_eq!(worked_dialogue(permissive), "[]");
    }

    #[test]
    fn d_e_and_f_a_required_speaker_is_shown_by_name() {
        let suite = load_suite().unwrap();

        let one = suite
            .cases
            .iter()
            .find(|case| case.constraints.required_speaker_ids.len() == 1)
            .expect("some case requires one voice");
        let example = worked_dialogue(one);
        assert!(example.contains(&one.constraints.required_speaker_ids[0]), "{example}");
        assert!(!example.contains("\"speakerId\": \"...\""), "D: {example}");

        let two = suite
            .cases
            .iter()
            .find(|case| case.constraints.required_speaker_ids.len() == 2)
            .expect("some case requires two voices");
        let example = worked_dialogue(two);
        for speaker in &two.constraints.required_speaker_ids {
            assert!(example.contains(speaker.as_str()), "E: {example}");
        }
    }

    #[test]
    fn g_h_i_and_j_every_worked_example_is_a_valid_instance_of_its_contract() {
        // The invariant, derived over the whole suite: every speaker shown is
        // one the scene contains, and every speaker owed appears.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let example = worked_dialogue(case);
            for speaker in &case.constraints.known_speaker_ids {
                // Presence is not required, only legality; checked below.
                let _ = speaker;
            }
            for required in &case.constraints.required_speaker_ids {
                assert!(
                    example.contains(required.as_str()),
                    "H: {} owes a line from {required} and the example omits it: {example}",
                    case.id
                );
            }
            // G and I: nothing in the example is a speaker the scene forbids.
            for fragment in example.split("\"speakerId\": \"").skip(1) {
                let shown = fragment.split('"').next().expect("a speaker id");
                assert!(
                    case.constraints.known_speaker_ids.iter().any(|id| id == shown),
                    "{} shows '{shown}', which the scene does not contain",
                    case.id
                );
            }
            if case.constraints.known_speaker_ids.is_empty() {
                assert_eq!(example, "[]", "{} has nobody to speak", case.id);
            }
        }
    }

    #[test]
    fn i_and_j_the_cases_that_demand_a_suggestion_carry_the_demand() {
        // Read from the suite rather than remembered: the cases that require one
        // are exactly the ones whose task is to produce one.
        let suite = load_suite().unwrap();
        let mut requiring_proposal = Vec::new();
        let mut requiring_memory = Vec::new();

        for case in &suite.cases {
            let contract = case_contract(case);
            assert_eq!(
                contract.require_event_proposal, case.constraints.require_event_proposal,
                "{} lost its proposal obligation on the way to the validator",
                case.id
            );
            assert_eq!(
                contract.require_memory_suggestion, case.constraints.require_memory_suggestion,
                "{} lost its memory obligation on the way to the validator",
                case.id
            );
            if contract.require_event_proposal {
                requiring_proposal.push(case.id.as_str());
                assert_eq!(case.task, "structured_event_proposal", "{}", case.id);
            }
            if contract.require_memory_suggestion {
                requiring_memory.push(case.id.as_str());
                assert_eq!(case.task, "memory_suggestion", "{}", case.id);
            }
        }

        assert_eq!(
            requiring_proposal,
            ["ai_case_046", "ai_case_047", "ai_case_048", "ai_case_049"]
        );
        assert_eq!(
            requiring_memory,
            ["ai_case_050", "ai_case_051", "ai_case_052", "ai_case_053"]
        );
    }

    #[test]
    fn k_a_required_array_left_empty_is_rejected_rather_than_accepted() {
        // The whole point of pushing this into the validator: rejection is what
        // buys the retry. Accepting the empty array spent no attempt, inflated
        // casesAccepted, and left the evaluator to disagree with the row.
        let suite = load_suite().unwrap();
        let empty = "{\"narration\": \"Helios Reach tace.\", \"dialogue\": [], \
                     \"tone_tags\": [], \"event_proposals\": [], \"memory_suggestions\": []}";

        for id in ["ai_case_046", "ai_case_050"] {
            let case = suite.cases.iter().find(|c| c.id == id).expect("the case exists");
            let error = crate::inference::validate(empty, &case_contract(case))
                .expect_err("an empty array has not answered a case that demanded one");
            assert!(
                matches!(error, crate::inference::ValidationError::MissingField(_)),
                "{id}: {error:?}"
            );
        }
    }

    #[test]
    fn n_every_case_still_builds_a_satisfiable_contract() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            assert!(
                case_contract(case).contract_defect().is_none(),
                "{} builds an unsatisfiable contract",
                case.id
            );
        }
    }

    // ---------------------------------------------------------------------
    // Bare JSON belongs to strictJsonOnly
    // ---------------------------------------------------------------------

    #[test]
    fn a_and_d_only_strict_cases_are_told_a_fence_is_forbidden() {
        // The disagreement this closes: every case was told "senza blocchi di
        // codice" while only the strict ones were ever measured for it, so an
        // ordinary case could break a rule it had been given, have the validator
        // unwrap the fence on purpose, and be recorded as fully compliant.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let prompt = system_prompt(case);
            if case.constraints.strict_json_only {
                assert!(prompt.contains("nessun blocco di codice"), "{}: {prompt}", case.id);
                assert!(prompt.contains("nessun testo prima o dopo"), "{}", case.id);
            } else {
                assert!(
                    !prompt.contains("blocco di codice") && !prompt.contains("blocchi di codice"),
                    "{} is told a fence is forbidden and is never checked for it",
                    case.id
                );
            }
        }
    }

    #[test]
    fn j_exactly_the_declared_strict_cases_get_the_strict_instruction() {
        let suite = load_suite().unwrap();
        let told: Vec<&str> = suite
            .cases
            .iter()
            .filter(|case| system_prompt(case).contains("nessun blocco di codice"))
            .map(|case| case.id.as_str())
            .collect();
        let declared: Vec<&str> = suite
            .cases
            .iter()
            .filter(|case| case.constraints.strict_json_only)
            .map(|case| case.id.as_str())
            .collect();
        assert_eq!(told, declared);
        assert!(!declared.is_empty() && declared.len() < suite.cases.len());
    }

    #[test]
    fn i_every_case_is_still_asked_for_the_structured_object() {
        // Relaxing the envelope must not relax the contract: the object, its
        // fields and its shape are still demanded of every case.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            assert!(case.constraints.structured_output, "{}", case.id);
            let prompt = system_prompt(case);
            assert!(prompt.contains("oggetto JSON"), "{}", case.id);
            for field in ["narration", "dialogue", "tone_tags", "event_proposals", "memory_suggestions"] {
                assert!(prompt.contains(field), "{} omits {field}", case.id);
            }
        }
    }

    #[test]
    fn h_the_prompt_never_mentions_the_profile_that_will_answer_it() {
        // Both models must be asked the same question, whatever the envelope.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let prompt = system_prompt(case);
            for profile in crate::model_lock::KNOWN_PROFILE_IDS {
                assert!(!prompt.contains(profile), "{} names {profile}", case.id);
            }
        }
    }

    #[test]
    fn the_contract_a_case_produces_carries_its_obligations() {
        // The end-to-end link: without this the prompt could invite silence
        // while the application validator rejected it, and the run would record
        // a compliant answer as a rejection before the evaluator ever saw it.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            let contract = case_contract(case);
            assert_eq!(
                contract.required_speaker_ids, case.constraints.required_speaker_ids,
                "{} lost its obligations on the way to the validator",
                case.id
            );
            assert!(
                contract.speaker_contract_defect().is_none(),
                "{} builds an unsatisfiable contract",
                case.id
            );
        }
    }

    #[test]
    fn a_permissive_case_accepts_an_answer_with_no_dialogue() {
        // The defect in full: a case that permits speech and obliges none, run
        // through the real application validator.
        let suite = load_suite().unwrap();
        let permissive = suite
            .cases
            .iter()
            .find(|case| {
                !case.constraints.known_speaker_ids.is_empty()
                    && case.constraints.required_speaker_ids.is_empty()
            })
            .expect("some case permits speech without demanding it");
        let payload = "{\"narration\": \"Helios Reach tace.\", \"dialogue\": [], \
                       \"tone_tags\": [], \"event_proposals\": [], \"memory_suggestions\": []}";
        crate::inference::validate(payload, &case_contract(permissive))
            .unwrap_or_else(|error| panic!("{}: {}", permissive.id, error.message()));
    }

    #[test]
    fn a_dialogue_case_still_rejects_an_answer_with_no_dialogue() {
        let suite = load_suite().unwrap();
        for task in ["single_npc_dialogue", "two_character_conflict"] {
            let case = suite
                .cases
                .iter()
                .find(|candidate| candidate.task == task)
                .expect("the task exists");
            let payload = "{\"narration\": \"Helios Reach tace.\", \"dialogue\": [], \
                           \"tone_tags\": [], \"event_proposals\": [], \"memory_suggestions\": []}";
            crate::inference::validate(payload, &case_contract(case))
                .expect_err("the dialogue is the task");
        }
    }

    #[test]
    fn every_required_speaker_is_also_permitted() {
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            for speaker in &case.constraints.required_speaker_ids {
                assert!(
                    case.constraints.known_speaker_ids.contains(speaker),
                    "{}: '{speaker}' is required but not permitted",
                    case.id
                );
            }
        }
    }

    #[test]
    fn a_required_proposal_case_is_told_to_produce_one() {
        // D and E: the instruction says "devi", and the worked example shows a
        // populated array rather than contradicting the sentence above it.
        let suite = load_suite().unwrap();
        let required = suite
            .cases
            .iter()
            .find(|case| case.constraints.require_event_proposal)
            .expect("the suite requires proposals somewhere");

        let prompt = system_prompt(required);
        assert!(prompt.contains("event_proposals DEVE contenere almeno un oggetto"), "{prompt}");
        assert!(prompt.contains("subjectId"), "{prompt}");
        assert!(
            prompt.contains("mai un effetto applicato"),
            "it stays a suggestion: {prompt}"
        );
        // The example is populated *and* grounded: a real subject from the
        // scene, not an ellipsis the model would have to guess at.
        let subject = case_subject_ids(required)
            .first()
            .cloned()
            .expect("a case that demands a proposal has something to propose about");
        assert!(
            prompt.contains(&format!("\"event_proposals\": [{{\"subjectId\": \"{subject}\"")),
            "the example must not be empty: {prompt}"
        );
        assert!(
            !prompt.contains("\"event_proposals\": []"),
            "an empty example contradicts the requirement: {prompt}"
        );
    }

    #[test]
    fn a_required_memory_case_is_told_to_produce_one() {
        let suite = load_suite().unwrap();
        let required = suite
            .cases
            .iter()
            .find(|case| case.constraints.require_memory_suggestion)
            .expect("the suite requires memory suggestions somewhere");

        let prompt = system_prompt(required);
        assert!(prompt.contains("memory_suggestions DEVE contenere almeno un oggetto"), "{prompt}");
        assert!(prompt.contains("characterId"), "{prompt}");
        let character = required
            .characters
            .first()
            .map(|character| character.id.clone())
            .expect("a case that demands a memory has somebody to remember");
        assert!(
            prompt.contains(&format!(
                "\"memory_suggestions\": [{{\"characterId\": \"{character}\""
            )),
            "the example must not be empty: {prompt}"
        );
    }

    #[test]
    fn an_ordinary_case_still_shows_empty_arrays() {
        // F: no requirement is introduced by accident. A narration case is told
        // to leave both arrays empty and shown exactly that.
        let suite = load_suite().unwrap();
        let ordinary = suite
            .cases
            .iter()
            .find(|case| {
                !case.constraints.allow_event_proposals && !case.constraints.allow_memory_suggestions
            })
            .expect("most cases permit neither");

        let prompt = system_prompt(ordinary);
        assert!(prompt.contains("event_proposals deve essere un array vuoto"), "{prompt}");
        assert!(prompt.contains("memory_suggestions deve essere un array vuoto"), "{prompt}");
        assert!(prompt.contains("\"event_proposals\": [], \"memory_suggestions\": []"), "{prompt}");
        assert!(!prompt.contains("DEVE contenere"), "{prompt}");
    }

    #[test]
    fn a_case_that_requires_a_suggestion_also_permits_it() {
        // The contract has to be coherent, or the validator would reject exactly
        // what the prompt demanded.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            if case.constraints.require_event_proposal {
                assert!(case.constraints.allow_event_proposals, "{}", case.id);
            }
            if case.constraints.require_memory_suggestion {
                assert!(case.constraints.allow_memory_suggestions, "{}", case.id);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Explicit case selection
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Explicit profile selection
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Serving identity
    // ---------------------------------------------------------------------

    #[test]
    fn the_selected_model_serving_is_confirmed() {
        serving_identity_verdict("lite", &["lite".to_string()]).expect("lite selected, lite served");
        serving_identity_verdict("standard", &["standard".to_string()])
            .expect("standard selected, standard served");
    }

    #[test]
    fn a_different_model_answering_is_refused() {
        // The incumbent-process case: something is ready on the port and it is
        // not what we started.
        let error = serving_identity_verdict("lite", &["standard".to_string()])
            .expect_err("standard answered a lite benchmark");
        assert!(error.contains("serving 'standard'"), "{error}");
        assert!(error.contains("selected 'lite'"), "{error}");
        assert!(
            error.contains("did not produce them"),
            "the refusal must say what is at stake: {error}"
        );

        let reverse = serving_identity_verdict("standard", &["lite".to_string()])
            .expect_err("lite answered a standard benchmark");
        assert!(reverse.contains("serving 'lite'"), "{reverse}");
    }

    #[test]
    fn a_healthy_endpoint_with_no_model_is_refused() {
        // Router mode answers /health perfectly well and holds nothing.
        let error = serving_identity_verdict("lite", &[]).expect_err("nothing is loaded");
        assert!(error.contains("serves no model at all"), "{error}");
        assert!(error.contains("lite"), "{error}");
    }

    #[test]
    fn an_endpoint_holding_several_models_must_include_the_selected_one() {
        serving_identity_verdict("lite", &["standard".to_string(), "lite".to_string()])
            .expect("the selected model is among them");

        let error = serving_identity_verdict(
            "lite",
            &["standard".to_string(), "something_else".to_string()],
        )
        .expect_err("ours is not there");
        assert!(error.contains("'standard', 'something_else'"), "{error}");
    }

    #[test]
    fn the_identity_gate_precedes_the_first_prompt() {
        // Order matters more than the check: confirming after generating would
        // leave rows on disk attributed to the wrong artifact.
        //
        // Scoped to the smoke function's own body, because searching the whole
        // file would find these very search strings and compare a test against
        // itself.
        let source = include_str!("benchmark.rs");

        // Anchored on code that exists only in the runner, and searched from the
        // end: the strings this test looks for also appear in this test, and
        // finding those instead would compare the test against itself.
        let gate = source
            .rfind("block_on(provider.loaded_models())")
            .expect("the runner asks the endpoint what it holds");
        let first_request = source
            .rfind("block_on(provider.generate(")
            .expect("the runner generates");
        let first_persist = source
            .rfind("persist(&directory, &record, &outcome.raw)")
            .expect("the runner persists");

        assert!(
            gate < first_request,
            "identity must be confirmed before the first prompt is sent"
        );
        assert!(gate < first_persist, "and before any row is written");
    }

    // ---------------------------------------------------------------------
    // Per-response identity
    // ---------------------------------------------------------------------

    #[test]
    fn a_response_from_the_measured_model_is_accepted() {
        response_identity_verdict("lite", Some("lite")).expect("A: lite answered a lite benchmark");
        response_identity_verdict("standard", Some("standard")).expect("B: standard answered");
    }

    #[test]
    fn a_response_from_the_other_model_is_refused() {
        // C and D. The preflight cannot see this: it happened after the probe.
        let error = response_identity_verdict("lite", Some("standard"))
            .expect_err("standard answered a lite benchmark");
        assert!(error.contains("produced by 'standard'"), "{error}");
        assert!(error.contains("measuring 'lite'"), "{error}");
        assert!(error.contains("changed models mid-run"), "{error}");

        let reverse = response_identity_verdict("standard", Some("lite"))
            .expect_err("lite answered a standard benchmark");
        assert!(reverse.contains("produced by 'lite'"), "{reverse}");
    }

    #[test]
    fn a_response_that_names_no_model_is_refused() {
        // E. Silence is not agreement. Filing it under the selected profile is
        // the assumption the preflight exists to stop making.
        let error = response_identity_verdict("lite", None).expect_err("nothing was reported");
        assert!(error.contains("did not say which model answered"), "{error}");
        assert!(error.contains("except assumption"), "{error}");
    }

    #[test]
    fn the_response_check_precedes_the_row() {
        // I and J, at the level that matters: a mismatched answer must never
        // become a row at all, so the check has to sit between the request and
        // the record. Anchored on runner-only code and searched from the end,
        // because these strings also appear in this test.
        let source = include_str!("benchmark.rs");
        let request = source
            .rfind("block_on(provider.generate(")
            .expect("the runner generates");
        let check = source[request..]
            .find("response_identity_verdict(&profile, outcome.model.as_deref())")
            .map(|offset| request + offset)
            .expect("the runner checks who answered");
        let record = source[request..]
            .find("let record = record_generation(")
            .map(|offset| request + offset)
            .expect("the runner records");
        let persist = source[request..]
            .find("persist(&directory, &record, &outcome.raw)")
            .map(|offset| request + offset)
            .expect("the runner persists");

        assert!(check < record, "the answer must be attributed before it becomes a row");
        assert!(check < persist, "and before anything is written");
    }

    #[test]
    fn a_mismatched_response_ends_the_run_rather_than_being_dropped() {
        // The rule stated as code: refusal is total. Dropping the row would
        // leave a run whose coverage silently shrank and whose remaining numbers
        // came from an unknown mixture of two models.
        let source = include_str!("benchmark.rs");
        let call = source
            .rfind("response_identity_verdict(&profile, outcome.model.as_deref())")
            .expect("the runner checks");
        let tail = &source[call..call + 200];
        assert!(
            tail.contains("panic!"),
            "a wrong-model answer must end the run, not be skipped: {tail}"
        );
        assert!(!tail.contains("continue"), "{tail}");
    }

    #[test]
    fn the_interop_fixture_attributes_every_row() {
        // H. The fixture is what the TypeScript contract is checked against, so
        // a row without an answering model would teach the other side that such
        // rows are normal.
        let run = interop_fixture();
        let rows = run["generations"].as_array().expect("the fixture has rows");
        assert!(!rows.is_empty());
        for row in rows {
            assert_eq!(
                row["servedModel"], row["profile"],
                "{} is filed under a model that did not answer it",
                row["id"]
            );
        }
    }

    #[test]
    fn a_record_keeps_the_model_the_runtime_reported() {
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
            model: Some("lite".to_string()),
        };
        let record = record_generation(
            "run_001", case, "lite", 1, test_artifact("lite"), benchmark_context(4096),
            first_attempt_fingerprint(case), &outcome,
        );
        assert_eq!(record.served_model.as_deref(), Some("lite"));
        assert_eq!(record.artifact.profile_id, "lite");
    }

    #[test]
    fn a_locked_profile_is_accepted() {
        assert_eq!(resolve_requested_profile(Some("lite".to_string())).unwrap(), "lite");
        assert_eq!(
            resolve_requested_profile(Some("standard".to_string())).unwrap(),
            "standard"
        );
    }

    #[test]
    fn a_misspelled_profile_is_refused_and_named() {
        // The defect: `standardd` resolved to None, was reported as a skip, and
        // the command exited green with no evidence whatsoever.
        let error = resolve_requested_profile(Some("standardd".to_string()))
            .expect_err("a typo is not a profile");
        assert!(error.contains("standardd"), "{error}");
        assert!(error.contains("not a locked benchmark profile"), "{error}");
        assert!(error.contains("lite, standard"), "the error must say what is valid: {error}");
        assert!(error.contains("Nothing was run"), "{error}");
    }

    #[test]
    fn an_empty_or_blank_profile_is_refused() {
        for raw in ["", "   ", "\t"] {
            let error = resolve_requested_profile(Some(raw.to_string()))
                .expect_err("an empty value is not a selection");
            assert!(error.contains("set but empty"), "{error}");
        }
    }

    #[test]
    fn profile_ids_are_canonical_and_matched_exactly() {
        // Silently normalising would make the record disagree with the request.
        for raw in ["Lite", "STANDARD", " lite", "lite "] {
            assert!(
                resolve_requested_profile(Some(raw.to_string())).is_err(),
                "'{raw}' must be refused rather than normalised"
            );
        }
    }

    #[test]
    fn no_override_selects_the_documented_default() {
        assert_eq!(
            resolve_requested_profile(None).unwrap(),
            crate::model_lock::LITE_PROFILE_ID
        );
    }

    #[test]
    fn the_known_profiles_come_from_the_lock_not_from_here() {
        // One list, shared with the resolver and the orchestrator. A second copy
        // would drift the moment a third profile is locked.
        for id in crate::model_lock::KNOWN_PROFILE_IDS {
            assert_eq!(resolve_requested_profile(Some(id.to_string())).unwrap(), id);
        }
        assert_eq!(crate::model_lock::KNOWN_PROFILE_IDS.len(), 2);
    }

    #[test]
    fn an_unknown_profile_is_distinguishable_from_an_absent_payload() {
        // Both end the run, and they must not read the same. One is a mistake to
        // fix; the other is a machine that does not have the model.
        let typo = resolve_requested_profile(Some("standardd".to_string())).unwrap_err();
        assert!(typo.contains("not a locked benchmark profile"));

        // A real profile always resolves here; whether its payload exists is a
        // question for the resolver, and the skip message says so.
        assert!(resolve_requested_profile(Some("standard".to_string())).is_ok());
        let runner = include_str!("benchmark.rs");
        assert!(
            runner.contains("is a locked profile but its payload is not present on this machine"),
            "the skip message must not read like a typo"
        );
    }

    #[test]
    fn one_named_case_is_selected() {
        let suite = load_suite().unwrap();
        let selected = select_cases(&suite, "ai_case_001").expect("a real id");
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].id, "ai_case_001");
    }

    #[test]
    fn several_named_cases_are_selected_in_request_order() {
        let suite = load_suite().unwrap();
        let selected = select_cases(&suite, "ai_case_046, ai_case_001").expect("both real");
        assert_eq!(
            selected.iter().map(|case| case.id.as_str()).collect::<Vec<_>>(),
            vec!["ai_case_046", "ai_case_001"]
        );
    }

    #[test]
    fn one_unknown_id_among_valid_ones_fails_and_names_it() {
        // The operator mistyped one case. Running the other two and reporting
        // success would hide the mistake behind partial evidence.
        let suite = load_suite().unwrap();
        let error = select_cases(&suite, "ai_case_001, ai_case_typo, ai_case_046")
            .expect_err("an unknown id must fail the whole request");
        assert!(error.contains("ai_case_typo"), "{error}");
        assert!(error.contains("Nothing was run"), "{error}");
        assert!(!error.contains("ai_case_001"), "valid ids are not blamed: {error}");
    }

    #[test]
    fn every_id_unknown_fails_rather_than_running_nothing() {
        // The exact shape of the defect: zero cases selected used to mean zero
        // generations and a green command.
        let suite = load_suite().unwrap();
        let error = select_cases(&suite, "typo_one,typo_two").expect_err("nothing resolves");
        assert!(error.contains("2 case(s)"), "{error}");
        assert!(error.contains("typo_one"), "{error}");
        assert!(error.contains("typo_two"), "{error}");
    }

    #[test]
    fn a_repeated_id_is_run_once() {
        // Documented behaviour: deduplicate rather than reject. Running a case
        // twice would produce two attempt-1 rows for one pair, which the
        // fairness rules refuse anyway.
        let suite = load_suite().unwrap();
        let selected = select_cases(&suite, "ai_case_001,ai_case_001,ai_case_046").unwrap();
        assert_eq!(
            selected.iter().map(|case| case.id.as_str()).collect::<Vec<_>>(),
            vec!["ai_case_001", "ai_case_046"]
        );
    }

    #[test]
    fn an_empty_explicit_request_is_refused() {
        let suite = load_suite().unwrap();
        let error = select_cases(&suite, " , ,").expect_err("an empty list is not a selection");
        assert!(error.contains("names no case"), "{error}");
    }

    #[test]
    fn with_no_override_the_default_selection_is_used() {
        let suite = load_suite().unwrap();
        if env::var("CHRONOSAGA_BENCHMARK_CASE_IDS").is_ok() {
            return; // the ambient environment already chose
        }
        let selected = cases_to_run(&suite, 3).expect("the default never fails");
        assert_eq!(selected.len(), 3);
        assert_eq!(selected[0].id, suite.cases[0].id);
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
    /// What one profile's block of an official run produced.
    struct ProfileBlock {
        attempted: usize,
        accepted_first: usize,
        retried: usize,
        recovered: usize,
        exhausted: usize,
        rows: usize,
    }

    /// Run every selected case against one profile, start to reaped.
    ///
    /// The whole of a profile's participation in an official comparison lives
    /// here: its port, its verified artifact, its sidecar, its 65 cases with the
    /// one retry each may earn, and its shutdown. The orchestrator calls this
    /// twice and does nothing else, which is what keeps *one model resident at a
    /// time* a property of the structure rather than of remembering to.
    ///
    /// `run_id`, `directory` and `context` come from the caller because they
    /// belong to the run, not to the profile. Two blocks writing into one
    /// directory under one run id is what makes this one experiment instead of
    /// two runs stapled together afterwards.
    fn execute_profile_block(
        profile: &str,
        verified: &crate::model_lock::VerifiedModel,
        suite: &BenchmarkSuite,
        selected_ids: &[String],
        run_id: &str,
        directory: &std::path::Path,
        context: &ContextConfiguration,
    ) -> ProfileBlock {
        // Nothing else may hold the port this block needs to own. Checked again
        // per profile: the first block released it, and something may have taken
        // it in between.
        occupied_port_verdict(
            crate::local_ai_runtime::LOOPBACK_HOST,
            crate::local_ai_runtime::DEFAULT_PORT,
            port_is_occupied(
                crate::local_ai_runtime::LOOPBACK_HOST,
                crate::local_ai_runtime::DEFAULT_PORT,
            ),
        )
        .unwrap_or_else(|error| panic!("{profile}: {error}"));

        let manager =
            crate::runtime_e2e::build_manager_for_profile(profile, BENCHMARK_STARTUP_TIMEOUT_MS)
                .unwrap_or_else(|error| panic!("{error}"));

        // Identity comes from the model that passed its digest, so a row names
        // the exact file that produced it. The digest itself was taken by the
        // caller, before any profile was allowed to answer.
        assert_eq!(
            verified.model().profile_id(),
            profile,
            "a block must be given its own verified artifact"
        );
        let artifact = artifact_identity(verified);

        let mut guard = BenchmarkRuntimeGuard::start(manager)
            .unwrap_or_else(|error| panic!("{profile}: the runtime must start: {error}"));
        assert!(
            guard.wait_until_ready(std::time::Duration::from_millis(
                BENCHMARK_STARTUP_TIMEOUT_MS
            )),
            "{profile}: the runtime never became ready"
        );

        let spec = guard.manager().launch_spec();
        let provider =
            crate::inference::LocalModelProvider::new(spec.base_url(), spec.api_key().to_string())
                .expect("the loopback provider must build");

        let served = tauri::async_runtime::block_on(provider.loaded_models())
            .expect("a ready endpoint must answer /v1/models");
        serving_identity_verdict(profile, &served).unwrap_or_else(|error| panic!("{error}"));
        eprintln!("[{profile}] serving identity confirmed");

        let mut block = ProfileBlock {
            attempted: 0,
            accepted_first: 0,
            retried: 0,
            recovered: 0,
            exhausted: 0,
            rows: 0,
        };

        for case in suite
            .cases
            .iter()
            .filter(|case| selected_ids.iter().any(|id| id == &case.id))
        {
            let contract = case_contract(case);
            let system = system_prompt(case);
            let user = user_prompt(case);

            // Attempt 1: the comparison. Identical for both profiles, which is
            // why its fingerprint is computed from the case alone.
            let first_fingerprint = input_fingerprint(case, &system, &user);
            let first = tauri::async_runtime::block_on(provider.generate(
                &system,
                &user,
                &contract,
                request_parameters(context),
            ))
            .expect("the request must reach the local runtime");
            response_identity_verdict(profile, first.model.as_deref())
                .unwrap_or_else(|error| panic!("{} {error}", case.id));

            let first_record = record_generation(
                run_id,
                case,
                profile,
                1,
                artifact.clone(),
                context.clone(),
                first_fingerprint,
                &first,
            );
            persist(directory, &first_record, &first.raw).expect("evidence must persist");
            block.attempted += 1;
            block.rows += 1;

            if first_record.accepted {
                block.accepted_first += 1;
                eprintln!("[{profile}] {} ACCEPTED in {} ms", case.id, first_record.latency_ms);
                continue;
            }

            // Rejected, so the policy owes exactly one retry. Anything other
            // than a validator rejection has already ended the run above: a lost
            // connection, a wrong model or an unwritable directory is an
            // infrastructure failure, not an output to repair.
            let rejection = first_record
                .validator_errors
                .first()
                .cloned()
                .unwrap_or_else(|| "output rejected".to_string());
            let retry_user = retry_user_prompt(&user, &rejection);
            let retry_fingerprint = input_fingerprint(case, &system, &retry_user);
            assert_ne!(
                retry_fingerprint, first_record.input_fingerprint,
                "a retry asks something new and must fingerprint as such"
            );

            let second = tauri::async_runtime::block_on(provider.generate(
                &system,
                &retry_user,
                &contract,
                request_parameters(context),
            ))
            .expect("the retry must reach the local runtime");
            response_identity_verdict(profile, second.model.as_deref())
                .unwrap_or_else(|error| panic!("{} retry {error}", case.id));

            let mut second_record = record_generation(
                run_id,
                case,
                profile,
                2,
                artifact.clone(),
                context.clone(),
                retry_fingerprint,
                &second,
            );
            second_record.retry_used = true;
            persist(directory, &second_record, &second.raw).expect("evidence must persist");
            block.retried += 1;
            block.rows += 1;

            if second_record.accepted {
                block.recovered += 1;
            } else {
                block.exhausted += 1;
            }
            eprintln!(
                "[{profile}] {} REJECTED ({rejection}) -> retry {}",
                case.id,
                if second_record.accepted { "RECOVERED" } else { "EXHAUSTED" }
            );
        }

        // Explicit, so a cleanup failure is an error rather than a line on
        // stderr from Drop. The next block cannot start until this returns.
        guard
            .shutdown()
            .unwrap_or_else(|error| panic!("{profile}: the block must leave no process: {error}"));

        // And proven, not assumed: the port is the resource the next profile
        // needs, and "one model resident at a time" is only true if this holds.
        assert!(
            !port_is_occupied(
                crate::local_ai_runtime::LOOPBACK_HOST,
                crate::local_ai_runtime::DEFAULT_PORT
            ),
            "{profile}: the port is still held after shutdown; the next profile cannot own it"
        );
        eprintln!("[{profile}] stopped, port released");

        block
    }

    /// The official Lite-versus-Standard comparison.
    ///
    /// One run id, one metadata block, one evidence directory, both profiles —
    /// because two separately-produced runs stapled together afterwards are not
    /// a controlled experiment, whatever the report says. Sequential, never
    /// interleaved: alternating per case would mean 65 model swaps and would
    /// measure swapping.
    ///
    /// Opt-in like every other real-runtime path, and by default it runs the
    /// whole suite. `CHRONOSAGA_BENCHMARK_CASES` narrows it for orchestration
    /// smoke; the official evidence is produced without it.
    #[test]
    fn official_quality_comparison() {
        let workspace = match benchmark_request(
            env::var(OFFICIAL_ENV).ok().as_deref(),
            env::var(WORKSPACE_ENV).ok().as_deref(),
        ) {
            Ok(BenchmarkRequest::Disabled) => {
                eprintln!(
                    "skipped: set {WORKSPACE_ENV} and {OFFICIAL_ENV}=1 to run the official comparison"
                );
                return;
            }
            Ok(BenchmarkRequest::Enabled { workspace_root }) => workspace_root,
            Err(error) => panic!("{error}"),
        };

        let suite = load_suite().expect("the suite must parse");
        let selected_ids: Vec<String> = match env::var("CHRONOSAGA_BENCHMARK_CASES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
        {
            Some(limit) => cases_to_run(&suite, limit)
                .unwrap_or_else(|error| panic!("{error}"))
                .iter()
                .map(|case| case.id.clone())
                .collect(),
            None => suite.cases.iter().map(|case| case.id.clone()).collect(),
        };
        assert!(!selected_ids.is_empty(), "nothing to run");

        // The runtime is shared by both blocks, so it is verified once, before
        // either starts and before any evidence exists.
        let runtime_lock =
            crate::runtime_e2e::checkout_runtime_lock().expect("the runtime lock must parse");
        let runtime_directory = crate::runtime_e2e::resolved_runtime_directory()
            .unwrap_or_else(|| panic!("the locked runtime is not present on this machine"));
        let verified_runtime =
            crate::runtime_lock::verify_runtime_distribution(&runtime_lock, &runtime_directory)
                .unwrap_or_else(|error| {
                    panic!(
                        "refusing to benchmark an unverified runtime: {} (after {} files)",
                        error.message, error.checked
                    )
                });
        eprintln!(
            "runtime verified: {} files, {} @ {}",
            verified_runtime.files_verified(),
            verified_runtime.release_tag(),
            &verified_runtime.executable_sha256()[..16]
        );

        let run_id = format!(
            "official_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_secs())
                .unwrap_or_default()
        );
        let directory = run_directory(&workspace, &run_id);
        assert!(
            !directory.join("metadata.json").exists(),
            "{} already holds a run; official evidence is never overwritten",
            directory.display()
        );

        // Every artifact, digested before any of them answers.
        //
        // Verifying inside each block would still precede that profile's own
        // first generation, but a corrupt Standard artifact would then be found
        // only after Lite had produced 65 rows: an hour of evidence that can
        // never be published, and a run directory to throw away. A mismatched
        // size or SHA-256 costs nothing here, and costs a whole Lite block
        // there.
        let verified_models: Vec<crate::model_lock::VerifiedModel> =
            crate::model_lock::KNOWN_PROFILE_IDS
                .iter()
                .map(|profile| {
                    crate::runtime_e2e::verified_model_for_profile(profile).unwrap_or_else(|| {
                        panic!(
                            "refusing to benchmark {profile}: its artifact is absent or failed \
                             its integrity check (see the REFUSED line above)"
                        )
                    })
                })
                .collect();
        for verified in &verified_models {
            eprintln!(
                "artifact verified: {} {} bytes, {}",
                verified.model().artifact_filename(),
                verified.model().size_bytes(),
                &verified.model().expected_sha256()[..16]
            );
        }

        // Both profiles are measured under one context, so it is derived once
        // and handed to both blocks. A per-profile context would be tuning.
        let context = benchmark_context(verified_models[0].model().context_target());

        let metadata = new_run_metadata(
            &run_id,
            RunKind::OfficialComparison,
            &started_at(),
            &suite,
            &git_commit().unwrap_or_default(),
            git_dirty(),
            verified_runtime.release_tag(),
            Some(verified_runtime.executable_sha256().to_string()),
            host_facts(),
        );
        persist_metadata(&directory, &metadata).expect("metadata must persist");
        eprintln!("official run {run_id}: {} cases x 2 profiles", selected_ids.len());

        // Lite, entirely, then Standard, entirely. The order is fixed so two
        // runs of the same suite are comparable with each other as well.
        let mut blocks = Vec::new();
        for (profile, verified) in crate::model_lock::KNOWN_PROFILE_IDS
            .iter()
            .zip(verified_models.iter())
        {
            let block = execute_profile_block(
                profile,
                verified,
                &suite,
                &selected_ids,
                &run_id,
                &directory,
                &context,
            );
            eprintln!(
                "[{profile}] {}/{} accepted first try, {} retried ({} recovered, {} exhausted)",
                block.accepted_first, block.attempted, block.retried, block.recovered, block.exhausted
            );
            blocks.push((profile, block));
        }

        // What the evidence must contain for the report boundary to accept it:
        // every pair attempted once, and one row per attempt actually made.
        let rows = fs::read_to_string(directory.join("generations.jsonl")).expect("rows");
        let expected: usize = blocks.iter().map(|(_, block)| block.rows).sum();
        assert_eq!(rows.lines().count(), expected, "every attempt must be on disk");
        for (profile, block) in &blocks {
            assert_eq!(
                block.attempted,
                selected_ids.len(),
                "{profile} did not attempt every case"
            );
        }

        eprintln!("evidence in {}", directory.display());
    }

    #[test]
    fn smoke_run_executes_real_cases_through_the_application_boundary() {
        // First, before the suite is read, before the runtime is verified, before
        // any metadata exists and long before a sidecar could start: an explicit
        // request that cannot be honoured ends the run loudly rather than
        // reporting a skip somebody will read as success.
        let workspace = match benchmark_request(
            env::var(BENCHMARK_ENV).ok().as_deref(),
            env::var(WORKSPACE_ENV).ok().as_deref(),
        ) {
            Ok(BenchmarkRequest::Disabled) => {
                eprintln!(
                    "skipped: set {WORKSPACE_ENV} and {BENCHMARK_ENV}=1 to run against the real model"
                );
                return;
            }
            Ok(BenchmarkRequest::Enabled { workspace_root }) => workspace_root,
            Err(error) => panic!("{error}"),
        };
        // Before the suite is loaded, before the runtime is verified and long
        // before anything is spawned: a misspelled profile costs nothing.
        let profile = resolve_requested_profile(env::var("CHRONOSAGA_BENCHMARK_PROFILE").ok())
            .unwrap_or_else(|error| panic!("{error}"));
        let smoke_size: usize = env::var("CHRONOSAGA_BENCHMARK_CASES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3);

        let suite = load_suite().expect("the suite must parse");

        // Resolve the selection first, before the runtime is verified, the
        // sidecar is started or any metadata is written. A typo must cost
        // nothing and must not leave a half-built run directory behind.
        let selected_ids: Vec<String> = cases_to_run(&suite, smoke_size)
            .unwrap_or_else(|error| panic!("{error}"))
            .iter()
            .map(|case| case.id.clone())
            .collect();
        assert!(!selected_ids.is_empty(), "nothing to run");
        // Before anything is built or started: nothing else may hold the port
        // this run needs to own. Measured behaviour, not theory — two servers
        // can share it on Windows, and the incumbent wins.
        occupied_port_verdict(
            crate::local_ai_runtime::LOOPBACK_HOST,
            crate::local_ai_runtime::DEFAULT_PORT,
            port_is_occupied(
                crate::local_ai_runtime::LOOPBACK_HOST,
                crate::local_ai_runtime::DEFAULT_PORT,
            ),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        // A benchmark was explicitly requested, so an unresolvable payload is the
        // reason it cannot happen — not a reason to report success. Only a
        // caller who never opted in gets a skip, and that decision was already
        // made above.
        //
        // The optional end-to-end tests keep their skip: they read the same
        // construction through `manager_for_profile*`, which discards the reason.
        let manager = crate::runtime_e2e::build_manager_for_profile(
            &profile,
            BENCHMARK_STARTUP_TIMEOUT_MS,
        )
        .unwrap_or_else(|error| panic!("{error}"));

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
            guard.wait_until_ready(std::time::Duration::from_millis(
                BENCHMARK_STARTUP_TIMEOUT_MS
            )),
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

        // Attribution gate. Ready means "something is listening"; this asks the
        // endpoint which model it actually holds, before a single prompt is sent
        // and before any evidence is written.
        let served = tauri::async_runtime::block_on(provider.loaded_models())
            .expect("a ready endpoint must answer /v1/models");
        serving_identity_verdict(&profile, &served).unwrap_or_else(|error| panic!("{error}"));
        eprintln!("serving identity confirmed: {profile}");

        let mut accepted = 0usize;
        let mut attempted = 0usize;

        for case in suite
            .cases
            .iter()
            .filter(|case| selected_ids.iter().any(|id| id == &case.id))
        {
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

            // Per-response attribution, before the row exists. A single answer
            // from the wrong model invalidates the run rather than being dropped
            // quietly: a benchmark that discards inconvenient rows is measuring
            // its own filter.
            response_identity_verdict(&profile, outcome.model.as_deref())
                .unwrap_or_else(|error| panic!("{} {error}", case.id));

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

    // ---------------------------------------------------------------------
    // The official comparison lane
    // ---------------------------------------------------------------------

    /// The official runner's own body, for the order assertions below.
    fn official_body() -> &'static str {
        let source = include_str!("benchmark.rs");
        let start = source
            .find(concat!("fn official_quality_", "comparison()"))
            .expect("the official runner exists");
        let end = source[start..]
            .find("    #[test]")
            .map(|offset| start + offset)
            .expect("another test follows it");
        &source[start..end]
    }

    /// The per-profile block's body.
    fn block_body() -> &'static str {
        let source = include_str!("benchmark.rs");
        let start = source
            .find(concat!("fn execute_profile_", "block("))
            .expect("the profile block exists");
        // No newline in the needle: this file is checked out CRLF on Windows,
        // and a needle spelling a bare line feed would never match there. The
        // slice would run to the end of the file and quietly swallow every
        // test below it.
        let end = source[start..]
            .find("/// The official Lite-versus-Standard comparison.")
            .map(|offset| start + offset)
            .expect("the orchestrator follows it");
        &source[start..end]
    }

    #[test]
    fn one_run_covers_both_profiles_under_one_identity() {
        // 3 and 4: one runId, one metadata block, both profiles. Two runs
        // stapled together afterwards are not a controlled experiment.
        let runner = official_body();
        assert!(runner.contains("RunKind::OfficialComparison"), "{runner}");
        assert!(
            runner.contains("for (profile, verified) in crate::model_lock::KNOWN_PROFILE_IDS"),
            "both profiles come from the lock, in one loop"
        );
        assert_eq!(
            crate::model_lock::KNOWN_PROFILE_IDS.len(),
            2,
            "and the lock names exactly the two the comparison compares"
        );
        // One run id and one metadata write, handed to both blocks.
        assert_eq!(runner.matches(concat!("let run_", "id = format!")).count(), 1);
        assert_eq!(runner.matches(concat!("persist_", "metadata(")).count(), 1);
        // One directory, derived once, and one call site that runs twice: both
        // blocks write into the same place under the same id.
        assert_eq!(runner.matches("let directory = run_directory(").count(), 1);
        // The block is given a directory rather than deriving one, so it can
        // only ever write where the run already is.
        assert!(block_body().contains("directory: &std::path::Path"));
        assert!(!block_body().contains("run_directory("));
        assert_eq!(runner.matches(concat!("execute_profile_", "block(")).count(), 1);
    }

    #[test]
    fn the_profiles_run_sequentially_and_the_port_is_released_between_them() {
        // 13 and 14: one model resident at a time is a property of the
        // structure — the loop body starts, runs and reaps a profile before the
        // next iteration can begin — and the release is proven, not assumed.
        let block = block_body();
        let start = block.find(concat!("BenchmarkRuntimeGuard::", "start(")).expect("starts");
        let shutdown = block.find(".shutdown()").expect("stops");
        let port_check = block.rfind(concat!("port_is_", "occupied(")).expect("checks the port");
        assert!(start < shutdown, "the block starts before it stops");
        assert!(shutdown < port_check, "the port is checked after shutdown");
        assert!(
            block.contains("the port is still held after shutdown"),
            "the release must be asserted, not hoped for"
        );
        // And the orchestrator owns no runtime of its own.
        assert!(!official_body().contains(concat!("BenchmarkRuntimeGuard::", "start(")));
    }

    #[test]
    fn the_official_lane_has_its_own_opt_in() {
        // The command that produces publishable evidence cannot be typed by
        // accident while reaching for a three-case smoke.
        assert_ne!(OFFICIAL_ENV, BENCHMARK_ENV);
        assert_eq!(OFFICIAL_ENV, "CHRONOSAGA_BENCHMARK_OFFICIAL");
        assert!(official_body().contains("OFFICIAL_ENV"));
        assert!(!official_body().contains("BENCHMARK_ENV,"));

        // Not opted in is still a skip; opted in without a workspace is still a
        // failure. The official lane reuses that decision rather than restating
        // it.
        assert_eq!(
            benchmark_request(None, Some(r"D:\Chronosaga")),
            Ok(BenchmarkRequest::Disabled)
        );
        assert!(benchmark_request(Some("1"), None).is_err());
    }

    #[test]
    fn an_existing_run_directory_is_never_overwritten() {
        // 23. Official evidence accumulates; it does not get edited into shape.
        assert!(
            official_body().contains("official evidence is never overwritten"),
            "the runner must refuse to write into an existing run"
        );
        let guard = official_body();
        let check = guard.find("already holds a run").expect("the check exists");
        let first_start = guard
            .find(concat!("execute_profile_", "block("))
            .expect("the runner runs a profile");
        assert!(check < first_start, "and it must refuse before anything starts");
    }

    #[test]
    fn a_mismatched_artifact_or_runtime_stops_the_run_before_any_generation() {
        // 17, 18 and 19. The order is the claim: the runtime distribution and
        // both artifacts are checked before the first block is entered, so a
        // wrong SHA-256 or a wrong size costs nothing rather than costing a
        // completed Lite block that can never be published.
        let runner = official_body();

        let runtime = runner
            .find(concat!("verify_runtime_", "distribution("))
            .expect("the runtime is verified");
        let artifacts = runner
            .find("Every artifact, digested before any of them answers")
            .expect("the artifacts are verified");
        let first_block = runner
            .find(concat!("execute_profile_", "block("))
            .expect("a profile eventually runs");
        assert!(runtime < artifacts, "the runtime is verified first");
        assert!(artifacts < first_block, "and nothing generates before both are");

        // Both, not just the one the context happens to come from.
        assert_eq!(
            runner
                .matches(concat!("verified_model_for_", "profile(profile)"))
                .count(),
            1,
            "one resolution, applied to every locked profile"
        );
        assert!(!runner.contains(concat!("verified_model_for_", "profile(crate::")));
        // And the block trusts what it was handed instead of digesting again.
        assert!(!block_body().contains(concat!("verified_model_for_", "profile(")));
    }

    #[test]
    fn a_failed_integrity_check_is_never_read_as_an_absent_artifact() {
        // The resolver answers `None` for both, so the runner must say which it
        // refused on. "Nothing to benchmark" and "these are the wrong bytes"
        // are different facts and only one of them is a skip.
        let runner = official_body();
        let at = runner
            .find("its artifact is absent or failed")
            .expect("the artifact refusal exists");
        // And it is a different sentence from the runtime's, which refuses the
        // same run for a different reason.
        assert!(runner.contains("refusing to benchmark an unverified runtime"), "{runner}");

        // The failure is a panic, not a return: the official lane never reports
        // success without evidence. Read backwards from the refusal to the call
        // that produced the `None`, with no newline in any needle — this file is
        // checked out CRLF on Windows.
        let resolver = runner[..at]
            .rfind(concat!("verified_model_for_", "profile("))
            .expect("the refusal follows the resolution it refuses");
        assert!(
            runner[resolver..at].contains("panic!("),
            "{}",
            &runner[resolver..at]
        );
    }

    #[test]
    fn raw_output_paths_stay_inside_the_run_they_belong_to() {
        // 27. A row points at its evidence with a run-relative path, so a run
        // directory can be moved, copied or read from another machine and still
        // resolve. An absolute path would bind the evidence to one disk, and a
        // traversal would let a row name a file outside the run entirely.
        let suite = load_suite().unwrap();
        for case in &suite.cases {
            for profile in crate::model_lock::KNOWN_PROFILE_IDS {
                for attempt in 1..=MAX_ATTEMPTS as u32 {
                    let path = raw_output_path(&case.id, profile, attempt);
                    assert!(path.starts_with("raw/"), "{path}");
                    assert!(!path.contains(".."), "{path}");
                    assert!(!path.contains(':'), "{path}");
                    assert!(!path.starts_with('/') && !path.starts_with('\\'), "{path}");
                    assert!(!std::path::Path::new(&path).is_absolute(), "{path}");
                    // Forward slashes, on Windows too: the path is written into
                    // JSON that is read on other platforms.
                    assert!(!path.contains('\\'), "{path}");
                }
            }
        }

        // And it is the same string the runner writes and the row records, so
        // the two cannot drift apart.
        let case = &suite.cases[0];
        let outcome = accepted_outcome("lite");
        let record = record_generation(
            "r", case, "lite", 2, test_artifact("lite"), benchmark_context(4096),
            first_attempt_fingerprint(case), &outcome,
        );
        assert_eq!(record.raw_output_path, raw_output_path(&case.id, "lite", 2));
    }

    // ---------------------------------------------------------------------
    // The one permitted retry
    // ---------------------------------------------------------------------

    #[test]
    fn a_retry_repairs_the_rejection_it_was_given() {
        let base = "STATO: nulla";
        let retry = retry_user_prompt(base, "unknown tone tag: epico");

        // The original question is repeated verbatim: a retry is a repair, not a
        // different case.
        assert!(retry.starts_with(base), "{retry}");
        // And it says what actually went wrong, in the validator's own words.
        assert!(retry.contains("unknown tone tag: epico"), "{retry}");
        assert!(retry.contains("CORREZIONE RICHIESTA"), "{retry}");
        assert!(retry.contains("Correggi solo quel problema"), "{retry}");
    }

    #[test]
    fn the_retry_is_profile_neutral_and_deterministic() {
        // 10 and 12. Nothing here reads a profile, so the same case and the same
        // rejection produce the same retry whichever model is being measured. It
        // is the policy that is identical, not the wording.
        let one = retry_user_prompt("scena", "required field missing or empty: dialogue");
        let two = retry_user_prompt("scena", "required field missing or empty: dialogue");
        assert_eq!(one, two, "the same inputs must reproduce");

        for profile in crate::model_lock::KNOWN_PROFILE_IDS {
            assert!(!one.contains(profile), "the retry names a profile: {one}");
        }
        for word in ["Qwen", "SmolLM", "lite", "standard", "Lite", "Standard"] {
            assert!(!one.contains(word), "the retry mentions {word}: {one}");
        }

        // The function cannot depend on a profile: it is not given one.
        let source = include_str!("benchmark.rs");
        let at = source
            .find("pub fn retry_user_prompt(")
            .expect("the retry prompt exists");
        let signature = &source[at..at + 120];
        assert!(!signature.contains("profile"), "{signature}");
    }

    #[test]
    fn a_retry_is_a_different_question_and_fingerprints_as_one() {
        // 28: attempt 2 has its own raw output and its own fingerprint, so it
        // can never be mistaken for, or overwrite, attempt 1.
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let system = system_prompt(case);
        let user = user_prompt(case);

        let first = input_fingerprint(case, &system, &user);
        let retry = input_fingerprint(case, &system, &retry_user_prompt(&user, "unknown tone tag"));
        assert_ne!(first, retry);

        // Different rejections are different questions, which is the point of
        // deriving the retry from the rejection at all.
        let other = input_fingerprint(
            case,
            &system,
            &retry_user_prompt(&user, "required field missing or empty: dialogue"),
        );
        assert_ne!(retry, other);

        // And the raw paths differ by attempt, so nothing is overwritten.
        assert_ne!(
            raw_output_path(&case.id, "lite", 1),
            raw_output_path(&case.id, "lite", 2)
        );
    }

    #[test]
    fn only_a_validator_rejection_earns_a_retry() {
        // 6, 7, 8, 9. The block retries on the recorded rejection and on nothing
        // else: every other failure has already ended the run by panicking
        // before this point, because a lost connection or a wrong model is an
        // infrastructure failure and not an output to repair.
        let block = block_body();

        let accepted_exit = block
            .find("block.accepted_first += 1;")
            .expect("an accepted first attempt is counted");
        let retry_call = block
            .find(concat!("retry_user_", "prompt(&user, &rejection)"))
            .expect("the block retries");
        assert!(accepted_exit < retry_call, "acceptance must return before the retry");
        assert!(
            block[accepted_exit..retry_call].contains("continue;"),
            "an accepted first attempt must end the case"
        );

        // Exactly one retry, and no loop around it: attempt 3 is unreachable by
        // construction rather than by a counter somebody must not get wrong.
        assert_eq!(block.matches(concat!("retry_user_", "prompt(")).count(), 1);
        // Two records built, one per attempt, and no third.
        assert_eq!(block.matches("artifact.clone()").count(), 2);
        assert_eq!(block.matches(concat!("record_", "generation(")).count(), 2);
        assert!(!block.contains("attempt + 1"), "{block}");

        // And the second attempt is the last: recovered or exhausted, the case
        // ends either way.
        assert!(block.contains("block.recovered += 1;"));
        assert!(block.contains("block.exhausted += 1;"));
    }

    #[test]
    fn the_official_run_measures_both_profiles_under_one_context() {
        // Same controlled settings for both, from one derivation. A per-profile
        // context would be tuning, and the report would refuse it anyway.
        let runner = official_body();
        assert_eq!(runner.matches(concat!("benchmark_", "context(")).count(), 1);
        assert!(runner.contains("A per-profile context would be tuning"));
        // The block receives it rather than building its own.
        assert!(!block_body().contains(concat!("benchmark_", "context(")));
    }

    #[test]
    fn no_fallback_is_possible_in_the_official_lane() {
        // 20 and 21. Nothing in either function sets a fallback, and the record
        // builder writes false/None, so official evidence cannot carry one.
        for body in [official_body(), block_body()] {
            assert!(!body.contains("fallback_used = true"), "{body}");
            assert!(!body.contains("fallback_profile = Some"), "{body}");
        }
        let suite = load_suite().unwrap();
        let case = &suite.cases[0];
        let outcome = accepted_outcome("lite");
        let record = record_generation(
            "r", case, "lite", 1, test_artifact("lite"), benchmark_context(4096),
            first_attempt_fingerprint(case), &outcome,
        );
        assert!(!record.fallback_used);
        assert!(record.fallback_profile.is_none());
    }

    // ---------------------------------------------------------------------
    // Port ownership
    // ---------------------------------------------------------------------

    #[test]
    fn e_an_occupied_benchmark_port_is_refused() {
        // Behavioural, not a source scan: a real listener is bound on an
        // ephemeral port and the probe must see it.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().unwrap().port();

        assert!(port_is_occupied("127.0.0.1", port), "a bound port must read as occupied");
        let error = occupied_port_verdict("127.0.0.1", port, true).expect_err("it is occupied");
        assert!(error.contains("127.0.0.1"), "{error}");
        assert!(error.contains(&port.to_string()), "{error}");
        assert!(error.contains("cannot own the runtime it is measuring"), "{error}");

        drop(listener);
    }

    #[test]
    fn f_a_free_port_passes_and_nothing_is_stopped_for_the_operator() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        assert!(!port_is_occupied("127.0.0.1", port), "a released port must read as free");
        occupied_port_verdict("127.0.0.1", port, false).expect("a free port is not a problem");

        // The refusal is explicit that no foreign process is killed: a benchmark
        // that reaps something it did not start is worse than one that refuses.
        let error = occupied_port_verdict("127.0.0.1", 8081, true).unwrap_err();
        assert!(error.contains("nothing was stopped for you"), "{error}");
        assert!(error.contains("stop it"), "{error}");
    }

    #[test]
    fn the_port_check_precedes_construction_and_startup() {
        // Ordering, from the runner's own body: the port must be claimed before
        // a manager exists, before the guard starts anything, and before any
        // evidence. Needles carry no line endings, for the CRLF checkout.
        let runner = runner_body();
        let preflight = runner
            .find(concat!("occupied_port_", "verdict("))
            .expect("the runner claims its port");
        for later in [
            concat!("build_manager_", "for_profile("),
            concat!("persist_", "metadata("),
            concat!("BenchmarkRuntimeGuard::", "start("),
            concat!("block_on(provider.", "generate("),
        ] {
            let at = runner.find(later).unwrap_or_else(|| panic!("the runner does {later}"));
            assert!(preflight < at, "the port check must precede {later}");
        }
    }

    #[test]
    fn j_the_product_runtime_is_untouched_by_the_preflight() {
        // Benchmark only. The lifecycle the game uses knows nothing about this.
        let lifecycle = include_str!("local_ai_runtime.rs");
        assert!(!lifecycle.contains(concat!("occupied_port_", "verdict")));
        assert!(!lifecycle.contains(concat!("port_is_", "occupied")));
        let e2e = include_str!("runtime_e2e.rs");
        assert!(!e2e.contains(concat!("occupied_port_", "verdict")));
    }

    #[test]
    fn d_alias_agreement_is_not_proof_of_ownership() {
        // Measured against b10343: `/v1/models` answers without checking the API
        // key, so an incumbent serving the same alias satisfies the identity
        // verdict. The verdict is still worth having — it catches a *different*
        // alias — but it is not what stops a foreign process, and the doc comment
        // must not claim it is.
        serving_identity_verdict("lite", &["lite".to_string()])
            .expect("alias agreement passes, whoever is answering");

        let source = include_str!("benchmark.rs");
        let at = source
            .find("pub fn serving_identity_verdict(")
            .expect("the verdict exists");
        let doc = &source[at.saturating_sub(1800)..at];
        assert!(
            doc.contains("not proof of process ownership") || doc.contains("not proof of process"),
            "the doc comment must not overclaim: {doc}"
        );
    }

    // ---------------------------------------------------------------------
    // The startup allowance
    // ---------------------------------------------------------------------

    /// The smoke runner's own body.
    ///
    /// The runner is a `#[test]` like everything else here, so a whole-file
    /// search finds whichever test happens to mention the same string last.
    /// These checks are about the runner, so they read the runner.
    fn runner_body() -> &'static str {
        let source = include_str!("benchmark.rs");
        let start = source
            .find(concat!("fn smoke_run_executes_real_cases_", "through_the_application_boundary()"))
            .expect("the runner exists");
        // No newline characters in the delimiter: Git checks this file out with
        // CRLF on Windows, and a needle written with a bare line feed silently
        // fails to match there. It did — the slice ran to the end of the file and
        // a test matched its own comment. Green locally, red in CI.
        let end = source[start..]
            .find("    #[test]")
            .map(|offset| start + offset)
            .expect("another test follows the runner");
        &source[start..end]
    }

    #[test]
    fn c_and_d_one_number_governs_the_manager_and_the_wait() {
        // The runner configures the lifecycle with the benchmark allowance and
        // waits on it with the same value. Two clocks was the whole defect.
        let runner = runner_body();

        let configured = runner
            .find(concat!("build_manager_", "for_profile("))
            .expect("the runner configures the manager's allowance");
        assert!(
            runner[configured..configured + 220].contains("BENCHMARK_STARTUP_TIMEOUT_MS"),
            "the manager must be given the benchmark allowance"
        );

        let waited = runner
            .find(concat!("wait_until_", "ready(std::time::Duration::from_millis("))
            .expect("the runner waits for readiness");
        assert!(
            runner[waited..waited + 160].contains("BENCHMARK_STARTUP_TIMEOUT_MS"),
            "the wait must use the same allowance"
        );
    }

    #[test]
    fn e_no_second_literal_governs_the_same_policy() {
        // A stray duration literal beside the constant would be the two-clock
        // problem returning under a different name. The literal is not written
        // out in this comment, so the test cannot match its own prose.
        let runner = runner_body();
        assert!(
            !runner.contains(concat!("from_", "secs(180)")),
            "the startup allowance is BENCHMARK_STARTUP_TIMEOUT_MS, not a literal"
        );
        assert!(
            !runner.contains("180_000"),
            "the number belongs to the constant, not to the runner"
        );

        // And the constant itself is written once, outside the test module.
        let source = include_str!("benchmark.rs");
        let declaration = source
            .find("pub const BENCHMARK_STARTUP_TIMEOUT_MS")
            .expect("the constant is declared");
        assert_eq!(
            source[declaration..]
                .matches(concat!("= 180", "_000;"))
                .count(),
            1
        );
        assert_eq!(BENCHMARK_STARTUP_TIMEOUT_MS, 180_000);
    }

    #[test]
    fn b_the_ordinary_manager_keeps_the_product_default() {
        // `manager_for_profile` still means "the product's allowance"; only the
        // explicit variant differs, and only in that number.
        let source = include_str!("runtime_e2e.rs");
        let at = source
            .find("pub(crate) fn manager_for_profile(")
            .expect("the ordinary constructor exists");
        let body = &source[at..at + 260];
        assert!(
            body.contains("DEFAULT_STARTUP_TIMEOUT_MS"),
            "the ordinary path must keep the product default: {body}"
        );
        assert!(
            body.contains(concat!("manager_for_profile_with_", "startup_timeout(")),
            "and must delegate rather than duplicate the construction: {body}"
        );
    }

    #[test]
    fn the_two_profile_paths_share_one_construction() {
        // Same resolution, same VerifiedModel, same system_manager_with_config,
        // same lifecycle manager and watcher. Only the allowance differs.
        //
        // `manager()` builds a model-less runtime for the other end-to-end tests
        // and is not a profile path, so it is not counted here.
        let source = include_str!("runtime_e2e.rs");
        // One definition of how a profile's model is resolved. It is reached
        // from two thin wrappers — the shared constructor and the identity
        // accessor the benchmark uses — and from nowhere else.
        assert_eq!(
            source.matches("fn resolve_model_from_lock(").count(),
            1,
            "only one function resolves a profile's model"
        );
        let builder = source
            .find("pub(crate) fn build_manager_for_profile(")
            .expect("the shared constructor exists");
        assert!(
            source[builder..].contains("system_manager_with_config("),
            "and it is the one that builds the manager"
        );

        // The optional path delegates to it and discards the reason; the
        // explicit path keeps the reason. One construction, two readings.
        let optional = source
            .find("pub(crate) fn manager_for_profile_with_startup_timeout(")
            .expect("the optional constructor exists");
        assert!(
            source[optional..optional + 260].contains(concat!("build_manager_", "for_profile(")),
            "the optional path must delegate rather than duplicate"
        );
    }

    // ---------------------------------------------------------------------
    // Explicit benchmark requests
    // ---------------------------------------------------------------------

    #[test]
    fn c_d_and_e_an_explicit_run_fails_when_it_cannot_be_built() {
        // Without a payload on this machine the construction fails, and for an
        // explicit request that is the reason the benchmark cannot happen — not
        // a reason to print a skip and exit green.
        //
        // Exercised through the real construction path: on a machine without the
        // payload it returns Err, and on one with it, Ok. Either way the error
        // shape is what an operator would read.
        for profile in crate::model_lock::KNOWN_PROFILE_IDS {
            match crate::runtime_e2e::build_manager_for_profile(
                profile,
                BENCHMARK_STARTUP_TIMEOUT_MS,
            ) {
                Ok(_) => {
                    // This machine has the payload; the Ok path is what the
                    // runner then uses, and the skip is gone either way.
                }
                Err(error) => {
                    assert!(error.contains(profile), "F: the error names the profile: {error}");
                    assert!(error.contains("Nothing was run"), "{error}");
                    assert!(
                        error.contains("CHRONOSAGA_WORKSPACE_ROOT"),
                        "the error must say what configuration is missing: {error}"
                    );
                }
            }
        }
    }

    #[test]
    fn f_the_two_failures_are_told_apart() {
        // A missing runtime and a missing model are different problems and read
        // differently, so an operator is not left guessing which half is absent.
        let source = include_str!("runtime_e2e.rs");
        let at = source
            .find("pub(crate) fn build_manager_for_profile(")
            .expect("the shared constructor exists");
        let body = &source[at..];
        assert!(body.contains("locked llama.cpp runtime could not be resolved"));
        assert!(body.contains("locked model payload"));
        // Needles without newline characters: this file is checked out with CRLF
        // on Windows, and a message that wraps across a line continuation cannot
        // be matched by a needle written with a bare line feed.
        assert!(body.contains("its integrity check"));
        assert!(body.contains("could not be resolved or"));
    }

    #[test]
    fn g_h_and_i_the_failure_precedes_every_side_effect() {
        // Ordering from the source, as with the request check: the construction
        // is attempted before any metadata is written, before the RAII guard
        // starts anything, and before the first prompt. An explicit run that
        // cannot be built therefore leaves no evidence directory and no process.
        let runner = runner_body();
        let built = runner
            .find(concat!("build_manager_", "for_profile("))
            .expect("the runner builds its manager");

        for later in [
            concat!("persist_", "metadata("),
            concat!("BenchmarkRuntimeGuard::", "start("),
            concat!("block_on(provider.", "generate("),
        ] {
            let at = runner
                .find(later)
                .unwrap_or_else(|| panic!("the runner does {later}"));
            assert!(built < at, "construction must be attempted before {later}");
        }

        // And it is a panic, not a return: a skip here would be the defect.
        let tail = &runner[built..built + 220];
        assert!(tail.contains("unwrap_or_else"), "{tail}");
        assert!(tail.contains("panic!"), "{tail}");
        assert!(!tail.contains("return;"), "an explicit request must not skip: {tail}");
    }

    #[test]
    fn j_the_optional_end_to_end_path_still_skips() {
        // `manager_for_profile*` keeps returning Option, so the ordinary tests
        // that may run without a payload are untouched. Only the explicit
        // benchmark reads the reason.
        let source = include_str!("runtime_e2e.rs");
        for signature in [
            "pub(crate) fn manager_for_profile(profile_id: &str) -> Option<Arc<LocalAiRuntimeManager>>",
            "pub(crate) fn manager_for_profile_with_startup_timeout(",
        ] {
            assert!(source.contains(signature), "{signature} must still exist");
        }
        let optional = source
            .find("pub(crate) fn manager_for_profile_with_startup_timeout(")
            .expect("it exists");
        assert!(
            source[optional..optional + 300].contains(".ok()"),
            "the optional path discards the reason, which is what makes it a skip"
        );
    }

    #[test]
    fn a_and_i_not_opting_in_is_a_skip_and_needs_no_workspace() {
        // The ordinary `cargo test` path: no opt-in, no requirement to configure
        // anything, and no multi-GB payload involved.
        for benchmark in [None, Some("0"), Some(""), Some("true"), Some("yes")] {
            for workspace in [None, Some(""), Some(r"D:\Chronosaga")] {
                assert_eq!(
                    benchmark_request(benchmark, workspace),
                    Ok(BenchmarkRequest::Disabled),
                    "{benchmark:?} / {workspace:?}"
                );
            }
        }
    }

    #[test]
    fn b_and_j_an_honourable_request_is_enabled_with_its_root() {
        assert_eq!(
            benchmark_request(Some("1"), Some(r"D:\Chronosaga")),
            Ok(BenchmarkRequest::Enabled {
                workspace_root: r"D:\Chronosaga".to_string()
            })
        );
        // The value is carried through unchanged, not normalised: the run uses
        // the path the operator gave it.
        assert_eq!(
            benchmark_request(Some("1"), Some(r"  D:\Chronosaga  ")),
            Ok(BenchmarkRequest::Enabled {
                workspace_root: r"  D:\Chronosaga  ".to_string()
            })
        );
    }

    #[test]
    fn c_d_e_and_f_an_impossible_request_fails_and_names_the_variable() {
        // The defect: these returned false, the test skipped, and cargo exited
        // green — so green meant either "it ran" or "somebody asked and nothing
        // happened". An operator cannot tell those apart.
        for workspace in [None, Some(""), Some("   "), Some("\t\n")] {
            let error = benchmark_request(Some("1"), workspace)
                .expect_err("an explicit request that cannot run must fail");
            assert!(error.contains(WORKSPACE_ENV), "F: {error}");
            assert!(error.contains(BENCHMARK_ENV), "{error}");
            assert!(
                error.contains("asked for a benchmark run"),
                "the error must say a benchmark was explicitly requested: {error}"
            );
            assert!(error.contains("Nothing was run"), "{error}");
        }
    }

    #[test]
    fn g_and_h_an_invalid_request_ends_the_run_before_anything_exists() {
        // Order, not just outcome: the check has to sit ahead of the suite, the
        // runtime verification, the metadata and the sidecar, or a failed
        // request could still leave a directory or a process behind.
        let source = include_str!("benchmark.rs");
        let gate = source
            .rfind("Err(error) => panic!(\"{error}\"),")
            .expect("the runner refuses an impossible request");

        // Split so these needles do not appear literally in this test's own
        // source: another order test searches for the same strings, and finding
        // this one instead would have it compare a test against a test.
        for later in [
            concat!("load_suite().", "expect("),
            concat!("persist_", "metadata("),
            concat!("BenchmarkRuntimeGuard::", "start("),
            concat!("block_on(provider.", "generate("),
        ] {
            let at = source
                .rfind(later)
                .unwrap_or_else(|| panic!("the runner does {later} somewhere"));
            assert!(gate < at, "the request must be refused before {later}");
        }
    }
}
