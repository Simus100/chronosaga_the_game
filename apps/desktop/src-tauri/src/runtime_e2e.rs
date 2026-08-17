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
    system_manager, LocalAiRuntimeManager, RuntimePhase, DEFAULT_PORT, LOOPBACK_HOST,
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
    Some(Arc::new(system_manager(directory, executable, log_path)))
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

    let mut watcher = RuntimeWatcher::spawn(manager.clone());
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

    let mut watcher = RuntimeWatcher::spawn(manager.clone());
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
