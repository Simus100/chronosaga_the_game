//! End-to-end lifecycle test against the real `llama-server`.
//!
//! Opt-in: it needs the verified external payload, which CI does not have. Run it
//! from a machine where `pnpm verify:local-ai-runtime` passes:
//!
//! ```text
//! CHRONOSAGA_WORKSPACE_ROOT=D:\Chronosaga CHRONOSAGA_RUNTIME_E2E=1 \
//!   cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- --nocapture --test-threads=1
//! ```
//!
//! Without both variables every test here reports that it skipped and passes, so
//! the normal suite stays independent of the runtime payload.

#![cfg(test)]

use crate::local_ai_runtime::{
    system_manager_with_config, LocalAiRuntimeManager, RuntimeConfig, RuntimePhase,
    DEFAULT_PORT, LOOPBACK_HOST,
};
use crate::runtime_watcher::RuntimeWatcher;
use std::{
    env, fs,
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

const E2E_ENV: &str = "CHRONOSAGA_RUNTIME_E2E";
const WORKSPACE_ENV: &str = "CHRONOSAGA_WORKSPACE_ROOT";

/// Resolve the runtime exactly as the application does: from the lock plus the
/// workspace variable, with nothing hard-coded here.
fn resolve_from_lock() -> Option<(PathBuf, PathBuf)> {
    if env::var(E2E_ENV).ok().as_deref() != Some("1") {
        return None;
    }
    let workspace = env::var(WORKSPACE_ENV).ok().filter(|v| !v.trim().is_empty())?;

    let lock_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../config/local-ai-runtime.lock.json");
    let lock: serde_json::Value = serde_json::from_str(&fs::read_to_string(lock_path).ok()?).ok()?;

    let directory = PathBuf::from(workspace)
        .join(lock["externalPathRelativeToWorkspaceRoot"].as_str()?);
    let executable = directory.join(lock["expectedExecutableName"].as_str()?);
    executable.is_file().then_some((directory, executable))
}

fn manager() -> Option<Arc<LocalAiRuntimeManager>> {
    let (directory, executable) = resolve_from_lock()?;
    let log_path = env::temp_dir().join("chronosaga-e2e-local-ai.log");
    Some(Arc::new(system_manager_with_config(
        RuntimeConfig::loopback(),
        directory,
        executable,
        log_path,
    )))
}

/// Resolve a locked profile straight from the model lock, the way the
/// application does, so the E2E run loads exactly the same artifact.
///
/// Generic over the profile id: Lite and Standard travel the identical path,
/// which is the point of the dual-model architecture.
fn resolve_model_from_lock(profile_id: &str) -> Option<crate::model_lock::VerifiedModel> {
    if env::var(E2E_ENV).ok().as_deref() != Some("1") {
        return None;
    }
    let workspace = env::var(WORKSPACE_ENV).ok()?;
    let lock_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../config/local-ai-models.lock.json");
    let lock: crate::model_lock::ModelLock =
        serde_json::from_str(&fs::read_to_string(lock_path).ok()?).ok()?;
    let resolved =
        crate::model_lock::resolve_from(&lock, profile_id, None, None, Some(&workspace))
            .ok()?;

    // The real digest over 1.28 GB, which is also how the E2E run measures it.
    let started = Instant::now();
    match resolved.verify_integrity() {
        Ok(verified) => {
            eprintln!(
                "model integrity verified in {} ms ({} ms measured inside)",
                started.elapsed().as_millis(),
                verified.verification_ms()
            );
            Some(verified)
        }
        Err(error) => {
            // Distinct from "no environment": the artifact is there and wrong.
            // Saying so out loud stops a failed integrity check from looking
            // like a skipped test.
            eprintln!("REFUSED: model integrity check failed: {}", error.message);
            if let Some(found) = error.found {
                eprintln!("  expected {} but found {found}", error.expected);
            }
            None
        }
    }
}

/// A manager configured exactly like the shipped application: real runtime, real
/// locked model, single-model mode.
fn manager_with_model() -> Option<Arc<LocalAiRuntimeManager>> {
    manager_for_profile("lite")
}

/// The same manager for any locked profile.
fn manager_for_profile(profile_id: &str) -> Option<Arc<LocalAiRuntimeManager>> {
    let (directory, executable) = resolve_from_lock()?;
    let model = resolve_model_from_lock(profile_id)?;
    let log_path = env::temp_dir().join(format!("chronosaga-e2e-{profile_id}.log"));
    Some(Arc::new(system_manager_with_config(
        RuntimeConfig::loopback().with_model(&model),
        directory,
        executable,
        log_path,
    )))
}

/// Real generations through the real validator, to measure how often the Lite
/// candidate actually satisfies the strict contract.
#[test]
fn lite_generations_pass_the_application_validator() {
    let Some(manager) = manager_with_model() else {
        eprintln!("skipped: set {WORKSPACE_ENV} and {E2E_ENV}=1 to run against the real model");
        return;
    };

    let mut watcher = RuntimeWatcher::spawn(manager.clone()).expect("the watcher must start");
    manager.start().expect("start should succeed");
    wait_until("the model to be serving", Duration::from_secs(120), || {
        manager.snapshot().state == RuntimePhase::Ready
    });

    let spec = manager.launch_spec();
    let provider = crate::inference::LocalModelProvider::new(
        spec.base_url(),
        spec.api_key().to_string(),
    )
    .expect("the provider must accept its own loopback endpoint");

    // The identity check the probe performs.
    let runtime = tauri::async_runtime::block_on(provider.serves_model("lite"))
        .expect("the model probe must answer");
    assert!(runtime, "the runtime must report serving the expected alias");

    let attempts = 5;
    let mut accepted = 0;
    let mut total_ms = 0u64;
    for attempt in 1..=attempts {
        let outcome = tauri::async_runtime::block_on(provider.generate_smoke())
            .unwrap_or_else(|error| panic!("attempt {attempt} failed to reach the model: {error}"));
        total_ms += outcome.duration_ms;
        if outcome.accepted {
            accepted += 1;
            eprintln!(
                "attempt {attempt}: ACCEPTED in {} ms, {} tok",
                outcome.duration_ms,
                outcome.completion_tokens.unwrap_or(0)
            );
        } else {
            eprintln!(
                "attempt {attempt}: REJECTED in {} ms - {}",
                outcome.duration_ms,
                outcome.validation_error.as_deref().unwrap_or("unknown")
            );
        }
    }
    eprintln!(
        "validator acceptance: {accepted}/{attempts}, mean {} ms",
        total_ms / attempts
    );

    watcher.stop();
    manager.stop();
    assert!(
        accepted >= 1,
        "the Lite candidate must satisfy the contract at least once in {attempts} attempts"
    );
}

/// P0.4-A Phase A: prove Standard runs real local inference through the very
/// same path as Lite.
///
/// Nothing here is Standard-specific except the profile id: same launch
/// contract, same loopback invariant, same session key, same validator. If this
/// passes, the dual-model architecture is doing what it claimed.
#[test]
fn standard_runs_real_local_inference_through_the_lite_path() {
    let Some(manager) = manager_for_profile("standard") else {
        eprintln!(
            "skipped: set {WORKSPACE_ENV} and {E2E_ENV}=1 with a verified Standard model present"
        );
        return;
    };

    assert!(
        !port_is_listening(),
        "port {DEFAULT_PORT} must be free before the Standard run"
    );

    let mut watcher = RuntimeWatcher::spawn(manager.clone()).expect("the watcher must start");

    // --- cold load ---
    let cold_start = Instant::now();
    let started = manager.start().expect("Standard should start");
    let first_pid = started.pid.expect("a real spawn must report a PID");
    wait_until("Standard to be serving", Duration::from_secs(180), || {
        manager.snapshot().state == RuntimePhase::Ready
    });
    let cold_load_ms = cold_start.elapsed().as_millis();

    let ready = manager.snapshot();
    assert_eq!(ready.model_profile_id.as_deref(), Some("standard"));
    assert_eq!(ready.model_context_size, Some(4096));
    assert_eq!(ready.host, LOOPBACK_HOST);
    eprintln!(
        "standard: PID {first_pid}, {} loaded in {cold_load_ms} ms at context {}",
        ready.model_label.clone().unwrap_or_default(),
        ready.model_context_size.unwrap_or_default()
    );

    let spec = manager.launch_spec();
    let provider =
        crate::inference::LocalModelProvider::new(spec.base_url(), spec.api_key().to_string())
            .expect("the provider must accept its own loopback endpoint");

    // --- readiness must name the expected model, not merely count one ---
    let serves_standard = tauri::async_runtime::block_on(provider.serves_model("standard"))
        .expect("the model probe must answer");
    assert!(serves_standard, "the runtime must report serving 'standard'");
    let serves_lite = tauri::async_runtime::block_on(provider.serves_model("lite"))
        .expect("the model probe must answer");
    assert!(
        !serves_lite,
        "one model at a time: a Standard runtime must not claim to serve Lite"
    );
    manager.record_loaded_models(u32::from(serves_standard));
    assert!(
        manager.snapshot().inference_ready,
        "inference becomes available only once the expected model is loaded"
    );

    // --- real generations through the shared validator ---
    let attempts = 5;
    let mut accepted = 0;
    let mut total_ms = 0u64;
    let mut total_tokens = 0u64;
    for attempt in 1..=attempts {
        let outcome = tauri::async_runtime::block_on(provider.generate_smoke())
            .unwrap_or_else(|error| panic!("attempt {attempt} could not reach Standard: {error}"));
        total_ms += outcome.duration_ms;
        total_tokens += outcome.completion_tokens.unwrap_or(0);
        if outcome.accepted {
            accepted += 1;
            eprintln!(
                "standard attempt {attempt}: ACCEPTED in {} ms, {} tok, {:.1} tok/s",
                outcome.duration_ms,
                outcome.completion_tokens.unwrap_or(0),
                outcome.tokens_per_second.unwrap_or(0.0)
            );
            eprintln!("  narration: {}", outcome.narration.clone().unwrap_or_default());
            for line in &outcome.dialogue {
                eprintln!("  {}: {}", line.speaker_id, line.text);
            }
            eprintln!("  tone: {}", outcome.tone_tags.join(", "));
        } else {
            eprintln!(
                "standard attempt {attempt}: REJECTED in {} ms - {}",
                outcome.duration_ms,
                outcome.validation_error.as_deref().unwrap_or("unknown")
            );
        }
    }
    eprintln!(
        "standard acceptance: {accepted}/{attempts}, mean {} ms, {} tok total",
        total_ms / attempts,
        total_tokens
    );

    // --- invalid output is still refused, on the very same validator ---
    let contract = crate::inference::SmokeScenario::contract();
    assert!(
        crate::inference::validate("{\"narration\":\"x\"}", &contract).is_err(),
        "the shared validator must still refuse an incomplete payload under Standard"
    );

    // --- stop, restart, stop ---
    let stopped = manager.stop();
    assert_eq!(stopped.state, RuntimePhase::Stopped);
    assert_eq!(stopped.pid, None);
    assert!(!stopped.inference_ready);
    wait_until("the port to close", Duration::from_secs(20), || {
        !port_is_listening()
    });

    let restarted = manager.start().expect("Standard should restart");
    let second_pid = restarted.pid.expect("a real spawn must report a PID");
    assert_ne!(first_pid, second_pid, "the restart must be a new process");
    wait_until("Standard to serve again", Duration::from_secs(180), || {
        manager.snapshot().state == RuntimePhase::Ready
    });
    eprintln!("standard: restarted as PID {second_pid}");

    watcher.stop();
    let final_snapshot = manager.stop();
    assert_eq!(final_snapshot.state, RuntimePhase::Stopped);
    assert_eq!(final_snapshot.pid, None);
    wait_until("the port to close", Duration::from_secs(20), || {
        !port_is_listening()
    });

    assert!(
        accepted >= 1,
        "Standard must satisfy the shared contract at least once in {attempts} attempts"
    );
}

/// Shutdown with a model loaded must leave nothing behind.
///
/// This is exactly what `main.rs` does on `RunEvent::Exit`: stop the watcher,
/// then stop the runtime. Loading a 1.28 GB model first makes it the realistic
/// case rather than the empty-router one.
#[test]
fn shutdown_with_a_loaded_model_leaves_no_process() {
    let Some(manager) = manager_with_model() else {
        eprintln!("skipped: set {WORKSPACE_ENV} and {E2E_ENV}=1 to run against the real model");
        return;
    };

    let mut watcher = RuntimeWatcher::spawn(manager.clone()).expect("the watcher must start");
    let started = manager.start().expect("start should succeed");
    let pid = started.pid.expect("a real spawn must report a PID");
    eprintln!("model-loaded run: spawned PID {pid}");

    wait_until("the model to be serving", Duration::from_secs(120), || {
        manager.snapshot().state == RuntimePhase::Ready
    });

    let ready = manager.snapshot();
    assert!(ready.runtime_ready);
    assert_eq!(ready.model_profile_id.as_deref(), Some("lite"));
    assert_eq!(ready.model_context_size, Some(4096));
    eprintln!(
        "model-loaded run: ready with {} at context {}",
        ready.model_label.unwrap_or_default(),
        ready.model_context_size.unwrap_or_default()
    );

    // Shutdown while the model is resident.
    watcher.stop();
    let final_snapshot = manager.stop();
    assert_eq!(final_snapshot.state, RuntimePhase::Stopped);
    assert_eq!(final_snapshot.pid, None);
    assert!(!final_snapshot.inference_ready);

    wait_until("the port to close", Duration::from_secs(15), || {
        !port_is_listening()
    });
    eprintln!("model-loaded run: reaped PID {pid}, port released");
}

fn port_is_listening() -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_PORT)),
        Duration::from_millis(300),
    )
    .is_ok()
}

fn wait_until(label: &str, timeout: Duration, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for {label}");
}

/// Two full cycles through the real binary, driven only by the watcher.
#[test]
fn real_llama_server_completes_two_start_stop_cycles() {
    let Some(manager) = manager() else {
        eprintln!("skipped: set {WORKSPACE_ENV} and {E2E_ENV}=1 to run against the real runtime");
        return;
    };

    assert!(
        !port_is_listening(),
        "port {DEFAULT_PORT} is already in use before the test starts"
    );

    let mut watcher = RuntimeWatcher::spawn(manager.clone()).expect("the watcher must start");
    let mut pids = Vec::new();

    for cycle in 1..=2 {
        let started = manager
            .start()
            .unwrap_or_else(|error| panic!("cycle {cycle}: start failed: {error}"));
        assert_eq!(started.state, RuntimePhase::Starting);
        let pid = started.pid.expect("a real spawn must report a PID");
        eprintln!("cycle {cycle}: spawned PID {pid}");
        pids.push(pid);

        // Nothing polls here: the watcher alone must carry it to Ready.
        wait_until("the runtime to become ready", Duration::from_secs(30), || {
            manager.snapshot().state == RuntimePhase::Ready
        });

        let ready = manager.snapshot();
        assert!(ready.runtime_ready, "cycle {cycle}: the runtime must be up");
        assert!(
            !ready.inference_ready,
            "cycle {cycle}: router mode has no model loaded, so inference must stay false"
        );
        assert_eq!(ready.host, LOOPBACK_HOST);
        assert_eq!(ready.pid, Some(pid));
        assert!(port_is_listening(), "cycle {cycle}: the port must be served");
        eprintln!(
            "cycle {cycle}: ready on {} (runtimeReady={} inferenceReady={})",
            ready.endpoint, ready.runtime_ready, ready.inference_ready
        );

        // Starting again must not produce a second process.
        assert!(
            manager.start().is_err(),
            "cycle {cycle}: a running runtime must refuse a duplicate start"
        );
        assert_eq!(manager.snapshot().pid, Some(pid));

        let stopped = manager.stop();
        assert_eq!(stopped.state, RuntimePhase::Stopped, "cycle {cycle}");
        assert_eq!(stopped.pid, None, "cycle {cycle}: the PID must be released");

        wait_until("the port to close", Duration::from_secs(10), || {
            !port_is_listening()
        });
        eprintln!("cycle {cycle}: stopped, port released");
    }

    assert_ne!(pids[0], pids[1], "the restart must be a genuinely new process");

    watcher.stop();
    assert!(!port_is_listening(), "nothing may still be listening");
}

/// Dropping everything the way application shutdown does must leave no child.
#[test]
fn shutdown_without_an_explicit_stop_leaves_no_process() {
    let Some(manager) = manager() else {
        eprintln!("skipped: set {WORKSPACE_ENV} and {E2E_ENV}=1 to run against the real runtime");
        return;
    };

    let mut watcher = RuntimeWatcher::spawn(manager.clone()).expect("the watcher must start");
    let started = manager.start().expect("start should succeed");
    let pid = started.pid.expect("a real spawn must report a PID");
    wait_until("ready", Duration::from_secs(30), || {
        manager.snapshot().state == RuntimePhase::Ready
    });

    // Exactly what main.rs does on RunEvent::Exit.
    watcher.stop();
    let final_snapshot = manager.stop();

    assert_eq!(final_snapshot.state, RuntimePhase::Stopped);
    assert_eq!(final_snapshot.pid, None);
    wait_until("the port to close", Duration::from_secs(10), || {
        !port_is_listening()
    });
    eprintln!("shutdown reaped PID {pid} and released the port");
}
