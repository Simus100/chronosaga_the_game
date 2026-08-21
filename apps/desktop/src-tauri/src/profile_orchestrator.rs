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
/// Provisional planning minimum for Lite, in MB.
///
/// From `docs/LOCAL_AI_MODEL_PROFILES_v0.1.md` section 4, which marks these as
/// planning values to be replaced by the P0 benchmark. Deliberately **not** an
/// AUTO floor: AUTO applies no floor to Lite, because Lite is the profile that
/// has to run wherever Chronosaga runs. The two numbers answer different
/// questions and must not be conflated — reading `hardware_floor("lite")` as
/// "Lite needs no RAM" is exactly the mistake this constant exists to prevent.
pub const LITE_PLANNING_MIN_RAM_MB: u64 = 8 * 1024;

/// Provisional planning recommendation for Lite, in MB.
pub const LITE_PLANNING_RECOMMENDED_RAM_MB: u64 = 16 * 1024;

/// Provisional planning core target for Lite.
pub const LITE_PLANNING_MIN_CORES: usize = 4;

/// Provisional planning recommendation for Standard, in MB.
///
/// The document gives a 16–32 GB range; this is the middle of it, and the same
/// number the earlier planning material carried.
pub const STANDARD_PLANNING_RECOMMENDED_RAM_MB: u64 = 24 * 1024;

/// What a player needs to know about a profile *before* choosing it.
///
/// Required by `docs/LOCAL_AI_MODEL_PROFILES_v0.1.md` section 5: disk size,
/// minimum RAM, recommended RAM, whether a GPU is mandatory, and a short
/// quality/speed trade-off. Disk size comes from the model lock, because that is
/// a fact about the artifact. Everything here is product guidance about the
/// hardware, which is why it lives beside the AUTO logic rather than in a second
/// JSON file or in React.
///
/// All values are provisional P0 planning targets. P0.5 has not finalised
/// hardware requirements, and nothing here should be read as if it had.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileGuidance {
    pub min_ram_mb: u64,
    pub recommended_ram_mb: u64,
    pub min_logical_cores: usize,
    pub gpu_required: bool,
    /// One line the player can actually decide on.
    pub trade_off: &'static str,
}

/// Player-facing guidance for a locked profile.
///
/// Standard's minimum is not a separate constant: it *is* the AUTO threshold,
/// reused. If AUTO would refuse Standard below 16 GB, telling the player
/// anything else would be a lie, and two constants would eventually drift into
/// exactly that lie.
pub fn guidance(profile_id: &str) -> Option<ProfileGuidance> {
    match profile_id {
        "lite" => Some(ProfileGuidance {
            min_ram_mb: LITE_PLANNING_MIN_RAM_MB,
            recommended_ram_mb: LITE_PLANNING_RECOMMENDED_RAM_MB,
            min_logical_cores: LITE_PLANNING_MIN_CORES,
            gpu_required: false,
            trade_off: "Faster and lighter. Short dialogue and minor narration, \
                        on modest machines.",
        }),
        "standard" => Some(ProfileGuidance {
            min_ram_mb: AUTO_STANDARD_MIN_RAM_MB,
            recommended_ram_mb: STANDARD_PLANNING_RECOMMENDED_RAM_MB,
            min_logical_cores: AUTO_STANDARD_MIN_CORES,
            gpu_required: false,
            trade_off: "Better dialogue and richer scenes. Slower, and asks more \
                        of the machine.",
        }),
        _ => None,
    }
}

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
    // Read the floor through the same accessor the selection screen derives
    // from, so the number enforced here and the number shown there cannot drift.
    let (min_ram_mb, min_cores) = hardware_floor("standard");

    if !standard_available {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: "Standard is not installed or not verified on this machine".to_string(),
        };
    }
    if hardware.total_ram_mb < min_ram_mb {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: format!(
                "{ram_gb:.0} GB RAM is below the {} GB Standard target",
                min_ram_mb / 1024
            ),
        };
    }
    if hardware.logical_cores < min_cores {
        return AutoDecision {
            resolved_profile: "lite".to_string(),
            reason: format!(
                "{} logical cores are below the {min_cores} Standard target",
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
    fn the_standard_minimum_shown_is_the_threshold_auto_enforces() {
        // One number, not two. If these could drift, the selection screen would
        // eventually promise a machine something AUTO refuses to give it.
        let standard = guidance("standard").expect("standard is a locked profile");
        assert_eq!(standard.min_ram_mb, AUTO_STANDARD_MIN_RAM_MB);
        assert_eq!(standard.min_logical_cores, AUTO_STANDARD_MIN_CORES);
        assert_eq!(hardware_floor("standard"), (standard.min_ram_mb, standard.min_logical_cores));
    }

    #[test]
    fn lites_planning_minimum_is_not_its_auto_floor() {
        // The distinction the review caught: AUTO applies no floor to Lite, and
        // that must never be shown to a player as "Lite needs no RAM".
        let lite = guidance("lite").expect("lite is a locked profile");
        assert_eq!(hardware_floor("lite"), (0, 0), "AUTO still refuses nothing for Lite");
        assert_eq!(lite.min_ram_mb, LITE_PLANNING_MIN_RAM_MB);
        assert!(lite.min_ram_mb > 0, "a player must see a real minimum");
        assert!(lite.min_ram_mb < AUTO_STANDARD_MIN_RAM_MB, "Lite asks for less than Standard");
    }

    #[test]
    fn both_profiles_carry_everything_the_selection_screen_must_show() {
        // docs/LOCAL_AI_MODEL_PROFILES_v0.1.md section 5: minimum RAM,
        // recommended RAM, whether a GPU is mandatory, and a trade-off line.
        // Disk size is a fact about the artifact and comes from the lock.
        for id in ["lite", "standard"] {
            let g = guidance(id).unwrap_or_else(|| panic!("{id} needs guidance"));
            assert!(g.min_ram_mb > 0, "{id}");
            assert!(g.recommended_ram_mb >= g.min_ram_mb, "{id}");
            assert!(g.min_logical_cores > 0, "{id}");
            assert!(!g.gpu_required, "{id}: the offline build must run CPU-only");
            assert!(g.trade_off.len() > 20, "{id}: the trade-off must say something");
        }
        assert!(guidance("auto").is_none(), "AUTO is not an artifact");
        assert!(guidance("safe").is_none(), "Safe Mode is not an artifact");
    }

    #[test]
    fn guidance_never_decides_anything() {
        // Guidance describes; resolve_auto decides. A machine below Lite's
        // planning minimum still gets Lite rather than being refused, because
        // the alternative is no game at all.
        let tiny = HardwareSnapshot {
            total_ram_mb: LITE_PLANNING_MIN_RAM_MB / 2,
            logical_cores: 2,
        };
        assert_eq!(resolve_auto(tiny, true).resolved_profile, "lite");
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
