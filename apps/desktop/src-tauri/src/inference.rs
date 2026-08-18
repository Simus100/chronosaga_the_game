//! First real local inference path (P0.3-C).
//!
//! Chronosaga talks to `llama-server` over loopback through this module and
//! nowhere else. The UI never reaches the model: it invokes a Tauri command,
//! Rust builds the request, authenticates it, and validates whatever comes back.
//!
//! The shape of the exchange is the one the product will keep:
//!
//! ```text
//! grounded situation from the Simulation Core
//!         ↓
//! prompt + output contract
//!         ↓
//! local model (Lite)
//!         ↓
//! JSON parse
//!         ↓
//! application validator      ← the authority, not the server
//!         ↓
//! accepted / rejected
//! ```
//!
//! Nothing here may mutate authoritative state. A rejected generation costs a
//! diagnostic message and nothing else.

use crate::local_ai_runtime::LOOPBACK_HOST;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// How long a single generation may take before it is abandoned.
///
/// PROVISIONAL: sized for a ~1.7B model answering a short prompt on CPU, and
/// due for revision once P0.5 measures the hardware matrix.
pub const INFERENCE_TIMEOUT: Duration = Duration::from_secs(120);

/// One line of spoken dialogue.
///
/// `deny_unknown_fields` is deliberate: a model that invents extra keys is not
/// following the contract, and silently dropping them would hide that.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogueLine {
    pub speaker_id: String,
    pub text: String,
}

/// The structured output contract for P0.
///
/// Deliberately small, and shaped like the schema in the AI documents so the
/// production contract is an extension of this rather than a replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct StructuredNarration {
    pub narration: String,
    pub dialogue: Vec<DialogueLine>,
    pub tone_tags: Vec<String>,
    /// Required and required to be empty in P0.3-C. No `serde(default)`: a model
    /// that omits the field has not followed the contract, and accepting the
    /// omission would let a sloppy generation look compliant.
    pub event_proposals: Vec<serde_json::Value>,
    /// Same contract as `event_proposals`.
    pub memory_suggestions: Vec<serde_json::Value>,
}

/// What the generation is allowed to contain.
#[derive(Debug, Clone)]
pub struct OutputContract {
    /// Speakers the scene actually contains.
    pub known_speaker_ids: Vec<String>,
    /// Tone vocabulary the UI understands.
    pub allowed_tone_tags: Vec<String>,
    /// Upper bound on narration length, in characters.
    pub max_narration_chars: usize,
}

impl Default for OutputContract {
    fn default() -> Self {
        Self {
            known_speaker_ids: vec!["npc_test_01".to_string()],
            allowed_tone_tags: vec![
                "teso".to_string(),
                "calmo".to_string(),
                "cupo".to_string(),
                "urgente".to_string(),
                "sollevato".to_string(),
            ],
            max_narration_chars: 1200,
        }
    }
}

/// Why a generation was refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "detail")]
pub enum ValidationError {
    /// The payload was not JSON, or did not match the contract's shape.
    Malformed(String),
    /// A required field was absent or empty.
    MissingField(String),
    /// A speaker the scene does not contain.
    UnknownSpeaker(String),
    /// A tone tag outside the agreed vocabulary.
    UnknownToneTag(String),
    /// The model tried to assert something only the Simulation Core may decide.
    AuthoritativeClaim(String),
}

impl ValidationError {
    pub fn message(&self) -> String {
        match self {
            Self::Malformed(d) => format!("output is not a valid contract payload: {d}"),
            Self::MissingField(d) => format!("required field missing or empty: {d}"),
            Self::UnknownSpeaker(d) => format!("unknown speaker: {d}"),
            Self::UnknownToneTag(d) => format!("unknown tone tag: {d}"),
            Self::AuthoritativeClaim(d) => format!("model claimed authoritative state: {d}"),
        }
    }
}

/// Strip a leading ```json fence if the model wrapped its answer in one.
///
/// A convenience, not the validator's job: anything still malformed after this
/// is rejected normally.
fn unwrap_code_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let body = rest.strip_prefix("json").unwrap_or(rest);
    body.trim().strip_suffix("```").unwrap_or(body).trim()
}

/// Validate a raw model response against the contract.
///
/// This is the authority. Server-side schema constraints are used where the
/// runtime supports them, but they are a convenience: nothing reaches the game
/// without passing through here.
pub fn validate(raw: &str, contract: &OutputContract) -> Result<StructuredNarration, ValidationError> {
    let payload = unwrap_code_fence(raw);
    if payload.is_empty() {
        return Err(ValidationError::Malformed("the model returned nothing".to_string()));
    }

    // Reasoning traces must never reach the player, and their presence means the
    // runtime is not configured the way we asked.
    if payload.contains("<think>") || payload.contains("</think>") {
        return Err(ValidationError::Malformed(
            "the response contains reasoning tags, which the launch contract disables".to_string(),
        ));
    }

    let parsed: StructuredNarration = serde_json::from_str(payload)
        .map_err(|error| ValidationError::Malformed(error.to_string()))?;

    if parsed.narration.trim().is_empty() {
        return Err(ValidationError::MissingField("narration".to_string()));
    }
    if parsed.narration.chars().count() > contract.max_narration_chars {
        return Err(ValidationError::Malformed(format!(
            "narration is {} characters, the contract allows {}",
            parsed.narration.chars().count(),
            contract.max_narration_chars
        )));
    }
    if parsed.dialogue.is_empty() {
        return Err(ValidationError::MissingField("dialogue".to_string()));
    }

    for line in &parsed.dialogue {
        if !contract.known_speaker_ids.contains(&line.speaker_id) {
            return Err(ValidationError::UnknownSpeaker(line.speaker_id.clone()));
        }
        if line.text.trim().is_empty() {
            return Err(ValidationError::MissingField(format!(
                "dialogue text for {}",
                line.speaker_id
            )));
        }
    }

    for tag in &parsed.tone_tags {
        if !contract.allowed_tone_tags.contains(tag) {
            return Err(ValidationError::UnknownToneTag(tag.clone()));
        }
    }

    // P0.3-C accepts no proposals at all: the plumbing that would apply them
    // does not exist yet, so anything here is the model reaching for authority.
    if !parsed.event_proposals.is_empty() {
        return Err(ValidationError::AuthoritativeClaim(
            "event_proposals are not accepted in P0.3-C".to_string(),
        ));
    }
    if !parsed.memory_suggestions.is_empty() {
        return Err(ValidationError::AuthoritativeClaim(
            "memory_suggestions are not accepted in P0.3-C".to_string(),
        ));
    }

    Ok(parsed)
}

/// The deterministic P0 smoke scene.
///
/// Small and heavily grounded on purpose: the point is to see whether a ~1.7B
/// model can stay inside facts it was given, in Italian, and answer in the
/// required shape. It is not a writing-quality test.
pub struct SmokeScenario;

impl SmokeScenario {
    pub const SPEAKER_ID: &'static str = "npc_test_01";

    pub fn contract() -> OutputContract {
        OutputContract {
            known_speaker_ids: vec![Self::SPEAKER_ID.to_string()],
            ..OutputContract::default()
        }
    }

    /// Instructions: the rules of the exchange.
    pub fn system_prompt() -> String {
        let tags = Self::contract().allowed_tone_tags.join(", ");
        format!(
            "Sei il narratore di Chronosaga, un simulatore sistemico.\n\
             La simulazione decide i fatti; tu li racconti.\n\n\
             REGOLE ASSOLUTE:\n\
             - usa SOLO i fatti forniti;\n\
             - non inventare morti, feriti, numeri, percentuali o esiti;\n\
             - non cambiare lo stato del mondo;\n\
             - non riaprire cio che e stato chiuso;\n\
             - scrivi in italiano;\n\
             - rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo attorno.\n\n\
             FORMATO RICHIESTO:\n\
             {{\"narration\": \"...\", \"dialogue\": [{{\"speakerId\": \"{speaker}\", \"text\": \"...\"}}], \
             \"tone_tags\": [\"...\"], \"event_proposals\": [], \"memory_suggestions\": []}}\n\n\
             tone_tags ammessi: {tags}.\n\
             event_proposals e memory_suggestions devono restare array vuoti.",
            speaker = Self::SPEAKER_ID,
            tags = tags
        )
    }

    /// The grounded situation itself.
    pub fn user_prompt() -> String {
        format!(
            "SITUAZIONE\n\
             Luogo: avamposto minerario Helios-7.\n\n\
             FATTI NOTI (autorevoli, non modificabili):\n\
             - la riserva di energia e al 31%;\n\
             - il personaggio {speaker} si chiama Mara;\n\
             - Mara ha assistito allo spegnimento del reattore;\n\
             - nessuno e rimasto ferito;\n\
             - il settore B e stato sigillato.\n\n\
             ULTIMO STATE DELTA:\n\
             {{\"sealed\": \"settore_B\", \"powerReserve\": 31, \"casualties\": 0}}\n\n\
             COMPITO\n\
             Scrivi una narrazione breve (massimo 3 frasi) della situazione e UNA battuta di Mara \
             coerente con cio che ha visto.\n\
             Non dichiarare vittime, non cambiare la percentuale di energia, non riaprire il settore B."
        , speaker = Self::SPEAKER_ID)
    }
}

// ---------------------------------------------------------------------------
// Local model provider
// ---------------------------------------------------------------------------

/// Result of one real generation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceOutcome {
    pub accepted: bool,
    pub duration_ms: u64,
    /// Unvalidated model text. Kept for Rust-side diagnostics and benchmark
    /// evidence, never serialised to the interface: rejected output has not
    /// passed the contract and must not cross into the UI trust boundary.
    #[serde(skip)]
    pub raw: String,
    pub narration: Option<String>,
    pub dialogue: Vec<DialogueLine>,
    pub tone_tags: Vec<String>,
    pub validation_error: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub tokens_per_second: Option<f64>,
    pub model: Option<String>,
}

/// Structurally validate an inference base URL.
///
/// Parsed rather than prefix-matched: `http://127.0.0.1.evil.com/`,
/// `http://user@127.0.0.1:8081@evil.com/` and similar shapes all start with the
/// right characters while pointing somewhere else entirely.
///
/// Accepts only `http`, host exactly 127.0.0.1, an explicit port, no
/// credentials, and no path.
pub fn validate_loopback_url(base_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(base_url)
        .map_err(|error| format!("refusing an unparseable inference endpoint {base_url}: {error}"))?;

    if parsed.scheme() != "http" {
        return Err(format!(
            "refusing scheme '{}': the local runtime is plain HTTP on loopback",
            parsed.scheme()
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("refusing an endpoint carrying credentials: {base_url}"));
    }
    match parsed.host_str() {
        Some(host) if host == LOOPBACK_HOST => {}
        Some(host) => {
            return Err(format!(
                "refusing host '{host}': the inference endpoint may only be {LOOPBACK_HOST}"
            ))
        }
        None => return Err(format!("refusing an endpoint with no host: {base_url}")),
    }
    if parsed.port().is_none() {
        return Err(format!("refusing an endpoint without an explicit port: {base_url}"));
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err(format!("refusing an endpoint carrying a path: {base_url}"));
    }
    Ok(())
}

/// Talks to the local OpenAI-compatible endpoint.
///
/// Holds the session key. Nothing outside this struct sees it, and it is never
/// written to the log or returned to the interface.
pub struct LocalModelProvider {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl LocalModelProvider {
    pub fn new(base_url: String, api_key: String) -> Result<Self, String> {
        validate_loopback_url(&base_url)?;
        if api_key.is_empty() {
            return Err("refusing to call the local runtime without a session key".to_string());
        }
        let client = reqwest::Client::builder()
            .timeout(INFERENCE_TIMEOUT)
            // A local sidecar must never be reached through a corporate proxy.
            .no_proxy()
            .build()
            .map_err(|error| format!("unable to build the inference client: {error}"))?;
        Ok(Self {
            base_url,
            api_key,
            client,
        })
    }

    /// Whether the runtime is serving the model we expect.
    ///
    /// Stronger than "some model exists": the launch contract passes
    /// `--alias lite`, so the expected identity is known and can be required.
    /// A runtime serving something else is not a runtime Chronosaga may use.
    pub async fn serves_model(&self, expected_alias: &str) -> Result<bool, String> {
        Ok(self
            .loaded_models()
            .await?
            .iter()
            .any(|id| id == expected_alias))
    }

    /// Ask the runtime which models it has loaded.
    ///
    /// This is the model-aware half of `inference_ready`: a server answering
    /// `/health` with no model loaded returns an empty list here.
    pub async fn loaded_models(&self) -> Result<Vec<String>, String> {
        let response = self
            .client
            .get(format!("{}/v1/models", self.base_url))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|error| format!("model probe failed: {error}"))?;

        if !response.status().is_success() {
            return Err(format!("model probe returned HTTP {}", response.status()));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("model probe returned unreadable JSON: {error}"))?;

        Ok(body["data"]
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Run the smoke generation and validate the result.
    pub async fn generate_smoke(&self) -> Result<InferenceOutcome, String> {
        let contract = SmokeScenario::contract();
        let request = serde_json::json!({
            "messages": [
                { "role": "system", "content": SmokeScenario::system_prompt() },
                { "role": "user", "content": SmokeScenario::user_prompt() }
            ],
            // Low temperature: this is a grounding test, not a creativity test.
            "temperature": 0.3,
            "max_tokens": 400,
            // Server-side constraint where the runtime honours it. The
            // application validator still runs on the result regardless.
            "response_format": { "type": "json_object" },
            // Belt and braces with --reasoning off, for templates that read it
            // from the request instead of the command line.
            "chat_template_kwargs": { "enable_thinking": false }
        });

        let started = std::time::Instant::now();
        let response = self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    format!("the local model did not answer within {INFERENCE_TIMEOUT:?}")
                } else {
                    format!("inference request failed: {error}")
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("the local runtime returned HTTP {status}"));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("the local runtime returned unreadable JSON: {error}"))?;
        let duration_ms = started.elapsed().as_millis() as u64;

        let raw = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let completion_tokens = body["usage"]["completion_tokens"].as_u64();
        let tokens_per_second = completion_tokens.and_then(|tokens| {
            (duration_ms > 0).then(|| tokens as f64 / (duration_ms as f64 / 1000.0))
        });

        let mut outcome = InferenceOutcome {
            accepted: false,
            duration_ms,
            raw: raw.clone(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            validation_error: None,
            prompt_tokens: body["usage"]["prompt_tokens"].as_u64(),
            completion_tokens,
            tokens_per_second,
            model: body["model"].as_str().map(str::to_string),
        };

        match validate(&raw, &contract) {
            Ok(valid) => {
                outcome.accepted = true;
                outcome.narration = Some(valid.narration);
                outcome.dialogue = valid.dialogue;
                outcome.tone_tags = valid.tone_tags;
            }
            Err(error) => outcome.validation_error = Some(error.message()),
        }

        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unwrap the error side with a message naming the case under test.
    trait ExpectRejected {
        fn unwrap_err_or_panic(self, case: &str) -> ValidationError;
    }

    impl ExpectRejected for Result<StructuredNarration, ValidationError> {
        fn unwrap_err_or_panic(self, case: &str) -> ValidationError {
            match self {
                Err(error) => error,
                Ok(_) => panic!("{case} should have been rejected"),
            }
        }
    }

    fn valid_payload() -> String {
        serde_json::json!({
            "narration": "Le luci di emergenza tingono di rosso il corridoio principale.",
            "dialogue": [{ "speakerId": "npc_test_01", "text": "Ho visto il reattore spegnersi." }],
            "tone_tags": ["teso"],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string()
    }

    #[test]
    fn a_well_formed_grounded_answer_is_accepted() {
        let parsed = validate(&valid_payload(), &SmokeScenario::contract()).expect("must accept");
        assert!(parsed.narration.contains("emergenza"));
        assert_eq!(parsed.dialogue.len(), 1);
        assert_eq!(parsed.dialogue[0].speaker_id, "npc_test_01");
        assert_eq!(parsed.tone_tags, vec!["teso".to_string()]);
    }

    #[test]
    fn a_fenced_answer_is_unwrapped_before_validation() {
        let fenced = format!("```json\n{}\n```", valid_payload());
        assert!(validate(&fenced, &SmokeScenario::contract()).is_ok());
    }

    #[test]
    fn malformed_json_is_rejected() {
        let error = validate("{not json at all", &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn an_empty_answer_is_rejected() {
        let error = validate("   ", &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn a_missing_required_field_is_rejected() {
        let payload = serde_json::json!({
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
            "tone_tags": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn an_empty_narration_is_rejected() {
        let payload = serde_json::json!({
            "narration": "   ",
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert_eq!(error, ValidationError::MissingField("narration".to_string()));
    }

    #[test]
    fn a_wrong_field_type_is_rejected() {
        let payload = serde_json::json!({
            "narration": "ok",
            "dialogue": "should be an array",
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn an_unknown_speaker_is_rejected() {
        let payload = serde_json::json!({
            "narration": "ok",
            "dialogue": [{ "speakerId": "npc_inventato_99", "text": "esisto?" }],
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert_eq!(
            error,
            ValidationError::UnknownSpeaker("npc_inventato_99".to_string())
        );
    }

    #[test]
    fn an_unknown_tone_tag_is_rejected() {
        let payload = serde_json::json!({
            "narration": "ok",
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
            "tone_tags": ["euforico_inventato"],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::UnknownToneTag(_)));
    }

    #[test]
    fn an_unexpected_top_level_field_is_rejected() {
        // The model must not smuggle authoritative state in beside the contract.
        let payload = serde_json::json!({
            "narration": "ok",
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": [],
            "powerReserve": 12
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(
            matches!(error, ValidationError::Malformed(ref d) if d.contains("powerReserve")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn an_unexpected_dialogue_field_is_rejected() {
        let payload = serde_json::json!({
            "narration": "ok",
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao", "damageDealt": 12 }],
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn proposals_are_refused_because_nothing_can_apply_them_yet() {
        for field in ["event_proposals", "memory_suggestions"] {
            let mut payload = serde_json::json!({
                "narration": "ok",
                "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
                "tone_tags": [],
                "event_proposals": [],
                "memory_suggestions": []
            });
            payload[field] = serde_json::json!([{ "type": "combat_resolved" }]);

            let error = validate(&payload.to_string(), &SmokeScenario::contract()).unwrap_err();
            assert!(
                matches!(error, ValidationError::AuthoritativeClaim(_)),
                "{field} must be refused"
            );
        }
    }

    #[test]
    fn a_reasoning_trace_is_rejected_rather_than_stripped() {
        // Blindly deleting <think> blocks would hide a misconfigured runtime.
        let payload = format!("<think>rifletto</think>{}", valid_payload());
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(
            matches!(error, ValidationError::Malformed(ref d) if d.contains("reasoning")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn an_overlong_narration_is_rejected() {
        let payload = serde_json::json!({
            "narration": "a".repeat(2000),
            "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
            "tone_tags": [],
            "event_proposals": [],
            "memory_suggestions": []
        })
        .to_string();
        let error = validate(&payload, &SmokeScenario::contract()).unwrap_err();
        assert!(matches!(error, ValidationError::Malformed(_)));
    }

    #[test]
    fn every_required_field_is_mandatory() {
        // Omitting any of the five must fail: a model that leaves a field out
        // has not followed the contract, whatever the rest looks like.
        for omitted in [
            "narration",
            "dialogue",
            "tone_tags",
            "event_proposals",
            "memory_suggestions",
        ] {
            let mut payload = serde_json::json!({
                "narration": "ok",
                "dialogue": [{ "speakerId": "npc_test_01", "text": "ciao" }],
                "tone_tags": ["teso"],
                "event_proposals": [],
                "memory_suggestions": []
            });
            payload.as_object_mut().unwrap().remove(omitted);

            let error = validate(&payload.to_string(), &SmokeScenario::contract())
                .unwrap_err_or_panic(omitted);
            assert!(
                matches!(error, ValidationError::Malformed(ref d) if d.contains(omitted)),
                "omitting {omitted} must be rejected, got {error:?}"
            );
        }
    }

    #[test]
    fn hostile_pseudo_loopback_urls_are_refused() {
        for url in [
            // Passes a naive starts_with check, resolves elsewhere.
            "http://127.0.0.1.evil.com:8081",
            "http://127.0.0.1:8081@evil.com",
            "http://user:pass@127.0.0.1:8081",
            // Not loopback.
            "http://0.0.0.0:8081",
            "http://192.168.1.10:8081",
            "http://localhost:8081",
            "http://[::1]:8081",
            "http://127.0.0.2:8081",
            // Wrong scheme, or no port, or carrying a path.
            "https://127.0.0.1:8081",
            "http://127.0.0.1",
            "http://127.0.0.1:8081/v1",
            "file:///etc/passwd",
            "not a url at all",
            "",
        ] {
            assert!(
                validate_loopback_url(url).is_err(),
                "{url} must be refused"
            );
        }

        assert!(validate_loopback_url("http://127.0.0.1:8081").is_ok());
        assert!(validate_loopback_url("http://127.0.0.1:8081/").is_ok());
    }

    #[test]
    fn rejected_model_text_never_crosses_into_the_interface() {
        let outcome = InferenceOutcome {
            accepted: false,
            duration_ms: 10,
            raw: "SECRET-UNVALIDATED-MODEL-TEXT".to_string(),
            narration: None,
            dialogue: Vec::new(),
            tone_tags: Vec::new(),
            validation_error: Some("rejected".to_string()),
            prompt_tokens: None,
            completion_tokens: None,
            tokens_per_second: None,
            model: None,
        };
        let json = serde_json::to_string(&outcome).unwrap();

        assert!(
            !json.contains("SECRET-UNVALIDATED-MODEL-TEXT"),
            "unvalidated text must not be serialised to the UI: {json}"
        );
        assert!(json.contains("validationError"), "the reason still reaches the UI");
    }

    #[test]
    fn the_provider_refuses_a_non_loopback_endpoint() {
        for url in [
            "http://0.0.0.0:8081",
            "http://192.168.1.10:8081",
            "https://api.openai.com",
            "http://localhost:8081",
        ] {
            assert!(
                LocalModelProvider::new(url.to_string(), "key".to_string()).is_err(),
                "{url} must be refused"
            );

        }
        assert!(
            LocalModelProvider::new("http://127.0.0.1:8081".to_string(), "k".to_string()).is_ok(),
            "loopback must be accepted"
        );
    }

    #[test]
    fn the_provider_refuses_to_run_without_a_session_key() {
        // Failing closed: an unauthenticated call is not an acceptable
        // degradation.
        let result = LocalModelProvider::new("http://127.0.0.1:8081".to_string(), String::new());
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("an empty key must be refused"),
        };
        assert!(error.contains("session key"));
    }

    #[test]
    fn the_smoke_prompt_states_the_facts_and_the_prohibitions() {
        let user = SmokeScenario::user_prompt();
        assert!(user.contains("31%"), "the authoritative number must be given");
        assert!(user.contains("nessuno e rimasto ferito"));
        assert!(user.contains("settore B"));
        assert!(user.contains("Non dichiarare vittime"));

        let system = SmokeScenario::system_prompt();
        assert!(system.contains("non inventare"));
        assert!(system.contains(SmokeScenario::SPEAKER_ID));
        assert!(system.contains("JSON"));
    }
}
