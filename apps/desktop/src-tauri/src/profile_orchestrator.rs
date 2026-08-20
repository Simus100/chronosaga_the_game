//! Player-facing AI profile orchestration (P0.4-B) and the failure chain
//! (P0.4-C).
//!
//! Three normal profiles — `AUTO`, `LITE`, `STANDARD` — plus one degraded
//! recovery path, Safe Mode. Safe is deliberately not a fourth normal profile:
//! it is what the product falls back to when no local model can serve, and the
//! interface must say so.
//!
//! Two rules shape everything here:
//!
//! * **One model at a time.** A transition stops the current runtime, proves the
//!   child is gone, and only then starts the next one. If the previous process
//!   cannot be proved dead, nothing new is started.
//! * **The profile is a preference, never campaign state.** Switching profile,
//!   or falling back, may change how richly the world is narrated. It may never
//!   change what the Simulation Core decided, what was committed, or what a save
//!   contains.

use serde::Serialize;
use std::fmt;

/// What the player asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestedProfile {
    /// Let the application choose conservatively from local hardware.
    Auto,
    Lite,
    Standard,
}

impl RequestedProfile {
    /// Parse a profile id coming from the interface.
    ///
    /// Unknown values are refused rather than defaulted: silently falling back
    /// to Lite would hide a bug in the caller. Safe Mode is deliberately not
    /// parseable here — it is an outcome, not a request.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "lite" => Ok(Self::Lite),
            "standard" => Ok(Self::Standard),
            "safe" | "procedural" => Err(
                "Safe Mode is a recovery outcome, not a profile that can be requested".to_string(),
            ),
            other => Err(format!(
                "unknown AI profile '{other}'; the normal profiles are auto, lite and standard"
            )),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Lite => "lite",
            Self::Standard => "standard",
        }
    }
}

impl fmt::Display for RequestedProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.id())
    }
}

/// The hardware facts AUTO is allowed to consider.
///
/// Deliberately small: RAM and cores only. GPU-aware selection and the final
/// thresholds belong to P0.5, which will have measurements instead of guesses.
#[derive(Debug, Clone, Copy)]
pub struct HardwareSnapshot {
    pub total_ram_mb: u64,
    pub logical_cores: usize,
}

/// Conservative RAM floor before AUTO will pick Standard.
///
/// PROVISIONAL, from `LOCAL_AI_MODEL_PROFILES_v0.1.md`. Standard measured about
/// 3.5 GB resident on this machine, so 16 GB total leaves comfortable headroom
/// for the game, the OS and the save layer.
pub const AUTO_STANDARD_MIN_RAM_MB: u64 = 16 * 1024;

/// Conservative core floor before AUTO will pick Standard.
pub const AUTO_STANDARD_MIN_CORES: usize = 6;

/// What AUTO decided and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoDecision {
    /// Always a concrete profile: AUTO never reaches the runtime.
    pub resolved_profile: String,
    pub reason: String,
}

/// Resolve a request into one concrete profile, before anything is launched.
///
/// `standard_available` reflects whether the Standard artifact is actually
/// present and verified. AUTO must not choose a model that cannot be loaded, or
/// the first thing the player sees is a fallback.
/// The hardware floor AUTO applies to a profile, as `(min RAM MB, min cores)`.
///
/// The readiness panel shows these numbers and [`resolve_auto`] enforces them,
/// so they are read from one place. P0.4-D5 exists because they used to live
/// twice: once here and once in a hand-maintained JSON manifest that had drifted
/// to a different context size and to filenames that no longer existed.
///
/// Lite has no floor by design. It is the profile that has to run wherever
/// Chronosaga runs; if it cannot, the answer is Safe Mode, not a smaller model.
pub fn hardware_floor(profile_id: &str) -> (u64, usize) {
    match profile_id {
        "standard" => (AUTO_STANDARD_MIN_RAM_MB, AUTO_STANDARD_MIN_CORES),
        _ => (0, 0),
    }
}

pub fn resolve_auto(
    hardware: HardwareSnapshot,
    standard_available: bool,
) -> AutoDecision {
    let ram_gb = hardware.total_ram_mb as f64 / 1024.0;

    if !standard_available {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: "Standard is not installed or not verified on this machine".to_string(),
        };
    }
    if hardware.total_ram_mb < AUTO_STANDARD_MIN_RAM_MB {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: format!(
                "{ram_gb:.0} GB RAM is below the {} GB Standard target",
                AUTO_STANDARD_MIN_RAM_MB / 1024
            ),
        };
    }
    if hardware.logical_cores < AUTO_STANDARD_MIN_CORES {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: format!(
                "{} logical cores are below the {AUTO_STANDARD_MIN_CORES} Standard target",
                hardware.logical_cores
            ),
        };
    }

    AutoDecision {
        resolved_profile: "standard".to_string(),
        reason: format!(
            "{ram_gb:.0} GB RAM and {} logical cores meet the Standard target",
            hardware.logical_cores
        ),
    }
}

/// Resolve any request into the concrete profile to launch.
pub fn resolve_request(
    requested: RequestedProfile,
    hardware: HardwareSnapshot,
    standard_available: bool,
) -> AutoDecision {
    match requested {
        RequestedProfile::Auto => resolve_auto(hardware, standard_available),
        // A manual choice always wins over the recommendation.
        RequestedProfile::Lite => AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: "Lite selected manually".to_string(),
        },
        RequestedProfile::Standard => AutoDecision {
            resolved_profile: "standard".to_string(),
            reason: "Standard selected manually".to_string(),
        },
    }
}

/// The order in which profiles are attempted after a failure.
///
/// `STANDARD -> LITE -> SAFE`, as the locked product decision requires. Lite
/// never falls back to Standard: degrading upward would be nonsense, and it
/// would risk starting a heavier model on a machine that just failed a lighter
/// one.
pub fn fallback_chain(resolved_profile: &str) -> Vec<String> {
    match resolved_profile {
        "standard" => vec!["standard".to_string(), "lite".to_string()],
        other => vec![other.to_string()],
    }
}

/// Decide whether a stopped runtime may be replaced by a new one.
///
/// The pure half of the "one model at a time" rule. A transition is only
/// allowed to continue when the previous child is *proved* gone: a surviving
/// pid, or a runtime still claiming to serve, means ownership is uncertain and
/// nothing new may be spawned. Uncertainty is treated as "still alive", never
/// as "probably dead" — the expensive mistake is two resident models, not a
/// refused switch.
pub fn reap_verdict(
    pid: Option<u32>,
    inference_ready: bool,
    last_error: Option<&str>,
) -> Result<(), String> {
    if let Some(pid) = pid {
        return Err(format!(
            "the previous runtime process {pid} could not be confirmed stopped ({});              refusing to start another model",
            last_error.unwrap_or("no detail")
        ));
    }
    if inference_ready {
        return Err("the previous runtime still reports inference readiness".to_string());
    }
    Ok(())
}

/// Where a profile attempt ended up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOutcome {
    /// What the player asked for: `auto`, `lite` or `standard`.
    pub requested_profile: String,
    /// What AUTO or the manual choice resolved to before launching.
    pub resolved_profile: String,
    /// The profile actually serving, or `None` in Safe Mode.
    pub active_profile: Option<String>,
    /// True when no local model could be brought up.
    pub safe_mode: bool,
    /// Why AUTO chose what it chose.
    pub auto_reason: String,
    /// Every profile that was tried and why it failed, in order.
    pub attempts: Vec<ProfileAttempt>,
    /// Player-facing summary of the degradation, when there is one.
    pub fallback_reason: Option<String>,
    /// The exact label the interface shows, so the wording lives in one place
    /// and Safe Mode cannot be presented as a normal profile by accident.
    pub presentation: String,
}

/// One attempt at bringing a profile up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAttempt {
    pub profile_id: String,
    pub succeeded: bool,
    /// Why it failed. Never carries a session key or raw model output.
    pub error: Option<String>,
}

/// Player-facing label for a mode.
fn presentation_for(safe_mode: bool) -> &'static str {
    if safe_mode {
        "SAFE MODE — NO LOCAL AI"
    } else {
        "LOCAL AI ACTIVE"
    }
}

/// Build the outcome from a completed sequence of attempts.
pub fn summarise(
    requested: RequestedProfile,
    decision: &AutoDecision,
    attempts: Vec<ProfileAttempt>,
) -> ProfileOutcome {
    let active = attempts
        .iter()
        .find(|attempt| attempt.succeeded)
        .map(|attempt| attempt.profile_id.clone());

    // A fallback happened whenever the profile that ended up serving is not the
    // one we resolved to — or when nothing serves at all.
    let degraded = match &active {
        Some(profile) => profile != &decision.resolved_profile,
        None => true,
    };

    let fallback_reason = degraded.then(|| {
        let failures: Vec<String> = attempts
            .iter()
            .filter(|attempt| !attempt.succeeded)
            .map(|attempt| {
                format!(
                    "{} failed: {}",
                    attempt.profile_id,
                    attempt.error.as_deref().unwrap_or("unknown reason")
                )
            })
            .collect();
        if failures.is_empty() {
            "the local AI could not be started".to_string()
        } else {
            failures.join("; ")
        }
    });

    let safe_mode = active.is_none();
    ProfileOutcome {
        requested_profile: requested.id().to_string(),
        resolved_profile: decision.resolved_profile.clone(),
        safe_mode,
        active_profile: active,
        auto_reason: decision.reason.clone(),
        attempts,
        fallback_reason,
        presentation: presentation_for(safe_mode).to_string(),
    }
}

/// Development-only switch to force a profile to fail.
///
/// Exists so the fallback chain can be exercised on a real machine without
/// corrupting a verified 1.9 GB artifact. Reads a comma-separated list of
/// profile ids, e.g. `CHRONOSAGA_FORCE_PROFILE_FAILURE=standard,lite`.
///
/// Deliberately env-driven and absent by default: nothing in a normal
/// installation can trigger it.
pub const FORCE_FAILURE_ENV: &str = "CHRONOSAGA_FORCE_PROFILE_FAILURE";

/// Whether this profile is being forced to fail for a fallback drill.
pub fn forced_failure(profile_id: &str, raw: Option<&str>) -> bool {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .any(|entry| !entry.is_empty() && entry.eq_ignore_ascii_case(profile_id))
    })
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIG: HardwareSnapshot = HardwareSnapshot {
        total_ram_mb: 64 * 1024,
        logical_cores: 24,
    };
    const SMALL: HardwareSnapshot = HardwareSnapshot {
        total_ram_mb: 8 * 1024,
        logical_cores: 4,
    };

    #[test]
    fn auto_always_resolves_to_one_concrete_profile() {
        for (hardware, available) in [(BIG, true), (BIG, false), (SMALL, true), (SMALL, false)] {
            let decision = resolve_auto(hardware, available);
            assert!(
                ["lite", "standard"].contains(&decision.resolved_profile.as_str()),
                "AUTO must never leave 'auto' unresolved: {decision:?}"
            );
            assert!(!decision.reason.is_empty(), "the choice must be explainable");
        }
    }

    #[test]
    fn the_displayed_floor_is_the_enforced_floor() {
        // One source of truth: whatever the readiness panel shows for Standard
        // has to be exactly what AUTO refuses to go below.
        let (min_ram, min_cores) = hardware_floor("standard");
        assert_eq!(min_ram, AUTO_STANDARD_MIN_RAM_MB);
        assert_eq!(min_cores, AUTO_STANDARD_MIN_CORES);

        let just_below = HardwareSnapshot {
            total_ram_mb: min_ram - 1,
            logical_cores: min_cores,
        };
        assert_eq!(resolve_auto(just_below, true).resolved_profile, "lite");

        let too_few_cores = HardwareSnapshot {
            total_ram_mb: min_ram,
            logical_cores: min_cores - 1,
        };
        assert_eq!(resolve_auto(too_few_cores, true).resolved_profile, "lite");

        let exactly_at_the_floor = HardwareSnapshot {
            total_ram_mb: min_ram,
            logical_cores: min_cores,
        };
        assert_eq!(
            resolve_auto(exactly_at_the_floor, true).resolved_profile,
            "standard"
        );
    }

    #[test]
    fn lite_carries_no_hardware_floor() {
        // Lite must remain reachable on any machine that can run the game.
        assert_eq!(hardware_floor("lite"), (0, 0));
        assert_eq!(hardware_floor("anything-else"), (0, 0));
    }

    #[test]
    fn auto_picks_standard_only_on_capable_hardware() {
        let decision = resolve_auto(BIG, true);
        assert_eq!(decision.resolved_profile, "standard");
        assert!(decision.reason.contains("meet the Standard target"));
    }

    #[test]
    fn auto_stays_conservative_on_small_machines() {
        let decision = resolve_auto(SMALL, true);
        assert_eq!(decision.resolved_profile, "lite");
        assert!(decision.reason.contains("below"));

        // Cores alone are enough to hold it back.
        let few_cores = HardwareSnapshot {
            total_ram_mb: 64 * 1024,
            logical_cores: 4,
        };
        assert_eq!(resolve_auto(few_cores, true).resolved_profile, "lite");
    }

    #[test]
    fn auto_never_chooses_a_model_that_is_not_there() {
        // Choosing Standard when it is missing would make the player's first
        // experience a fallback.
        let decision = resolve_auto(BIG, false);
        assert_eq!(decision.resolved_profile, "lite");
        assert!(decision.reason.contains("not installed"));
    }

    #[test]
    fn a_manual_choice_overrides_the_recommendation() {
        // Small machine, but the player insisted on Standard.
        let manual = resolve_request(RequestedProfile::Standard, SMALL, true);
        assert_eq!(manual.resolved_profile, "standard");
        assert!(manual.reason.contains("manually"));

        // Capable machine, but the player insisted on Lite.
        let lite = resolve_request(RequestedProfile::Lite, BIG, true);
        assert_eq!(lite.resolved_profile, "lite");
        assert!(lite.reason.contains("manually"));
    }

    #[test]
    fn only_the_three_normal_profiles_can_be_requested() {
        assert_eq!(RequestedProfile::parse("auto").unwrap(), RequestedProfile::Auto);
        assert_eq!(RequestedProfile::parse("lite").unwrap(), RequestedProfile::Lite);
        assert_eq!(
            RequestedProfile::parse("standard").unwrap(),
            RequestedProfile::Standard
        );

        for rejected in ["", "AUTO", "quality", "gpt-4", "../../etc/passwd"] {
            assert!(
                RequestedProfile::parse(rejected).is_err(),
                "{rejected} must be refused"
            );
        }
    }

    #[test]
    fn safe_mode_is_not_a_requestable_profile() {
        for id in ["safe", "procedural"] {
            let error = RequestedProfile::parse(id).expect_err("Safe is an outcome, not a request");
            assert!(
                error.contains("recovery outcome"),
                "the message must say why: {error}"
            );
        }
    }

    #[test]
    fn the_chain_degrades_downward_only() {
        assert_eq!(fallback_chain("standard"), vec!["standard", "lite"]);
        // Lite has nowhere lighter to go: the next step is Safe, which is not a
        // model attempt at all.
        assert_eq!(fallback_chain("lite"), vec!["lite"]);
    }

    fn ok(profile: &str) -> ProfileAttempt {
        ProfileAttempt {
            profile_id: profile.to_string(),
            succeeded: true,
            error: None,
        }
    }

    fn failed(profile: &str, error: &str) -> ProfileAttempt {
        ProfileAttempt {
            profile_id: profile.to_string(),
            succeeded: false,
            error: Some(error.to_string()),
        }
    }

    #[test]
    fn a_clean_start_is_not_reported_as_a_fallback() {
        let decision = resolve_request(RequestedProfile::Standard, BIG, true);
        let outcome = summarise(RequestedProfile::Standard, &decision, vec![ok("standard")]);

        assert_eq!(outcome.active_profile.as_deref(), Some("standard"));
        assert!(!outcome.safe_mode);
        assert_eq!(outcome.fallback_reason, None);
        assert_eq!(outcome.presentation, "LOCAL AI ACTIVE");
    }

    #[test]
    fn standard_failing_into_lite_is_reported_as_degraded() {
        let decision = resolve_request(RequestedProfile::Standard, BIG, true);
        let outcome = summarise(
            RequestedProfile::Standard,
            &decision,
            vec![failed("standard", "model failed to load"), ok("lite")],
        );

        assert_eq!(outcome.active_profile.as_deref(), Some("lite"));
        assert!(!outcome.safe_mode, "a working Lite is not Safe Mode");
        let reason = outcome.fallback_reason.expect("the degradation must be explained");
        assert!(reason.contains("standard failed"));
        assert!(reason.contains("model failed to load"));
    }

    #[test]
    fn both_models_failing_lands_in_safe_mode() {
        let decision = resolve_request(RequestedProfile::Auto, BIG, true);
        let outcome = summarise(
            RequestedProfile::Auto,
            &decision,
            vec![
                failed("standard", "integrity check failed"),
                failed("lite", "runtime did not start"),
            ],
        );

        assert!(outcome.safe_mode);
        assert_eq!(outcome.active_profile, None);
        assert_eq!(outcome.presentation, "SAFE MODE — NO LOCAL AI");
        let reason = outcome.fallback_reason.unwrap();
        assert!(reason.contains("standard failed") && reason.contains("lite failed"));
    }

    #[test]
    fn safe_mode_is_reached_even_when_nothing_was_attempted() {
        let decision = resolve_request(RequestedProfile::Auto, SMALL, false);
        let outcome = summarise(RequestedProfile::Auto, &decision, Vec::new());
        assert!(outcome.safe_mode);
        assert!(outcome.fallback_reason.is_some());
    }

    #[test]
    fn the_forced_failure_switch_is_off_unless_asked_for() {
        assert!(!forced_failure("standard", None));
        assert!(!forced_failure("standard", Some("")));
        assert!(!forced_failure("standard", Some("lite")));

        assert!(forced_failure("standard", Some("standard")));
        assert!(forced_failure("lite", Some("standard,lite")));
        assert!(forced_failure("STANDARD", Some("standard")));
        assert!(forced_failure("lite", Some(" lite , standard ")));
    }

    #[test]
    fn ownership_that_cannot_be_proved_gone_blocks_the_next_profile() {
        // A surviving pid is the whole reason a transition may be refused: the
        // alternative is two resident models fighting over the same port.
        let refused = reap_verdict(Some(4321), false, Some("kill returned access denied"));
        let message = refused.expect_err("a surviving pid must block the next start");
        assert!(message.contains("4321"), "{message}");
        assert!(message.contains("refusing to start another model"), "{message}");

        // A runtime with no pid that still claims to serve is equally suspect.
        assert!(reap_verdict(None, true, None).is_err());

        // Only a reaped, silent runtime clears the way.
        assert!(reap_verdict(None, false, None).is_ok());
    }

    #[test]
    fn a_fallback_carries_no_campaign_state() {
        // Falling all the way to Safe Mode is a presentation change. Whatever
        // the Simulation Core decided, committed or saved is none of this
        // module's business, and the serialised outcome proves it: the only
        // keys crossing to the interface are profile ids and reasons.
        let decision = resolve_request(RequestedProfile::Auto, BIG, true);
        let outcome = summarise(
            RequestedProfile::Auto,
            &decision,
            vec![failed("standard", "forced"), failed("lite", "forced")],
        );
        assert!(outcome.safe_mode);

        let json: serde_json::Value = serde_json::to_value(&outcome).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("the outcome is an object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "activeProfile",
                "attempts",
                "autoReason",
                "fallbackReason",
                "presentation",
                "requestedProfile",
                "resolvedProfile",
                "safeMode",
            ],
            "a new field crossed into the outcome; campaign state must never travel here"
        );

        for forbidden in ["turn", "seed", "worldState", "campaign", "save", "schema"] {
            assert!(
                !keys.contains(&forbidden),
                "the outcome must not carry '{forbidden}'"
            );
        }
    }

    #[test]
    fn the_outcome_never_carries_a_secret_or_raw_model_text() {
        // The outcome is serialised straight to the interface, so it may only
        // ever contain profile ids and human-readable reasons.
        let decision = resolve_request(RequestedProfile::Auto, BIG, true);
        let outcome = summarise(
            RequestedProfile::Auto,
            &decision,
            vec![failed("standard", "runtime did not become ready"), ok("lite")],
        );
        let json = serde_json::to_string(&outcome).unwrap();

        for forbidden in ["api-key", "apiKey", "Bearer", "--model", ".gguf"] {
            assert!(
                !json.contains(forbidden),
                "the outcome must not leak '{forbidden}': {json}"
            );
        }
    }
}
