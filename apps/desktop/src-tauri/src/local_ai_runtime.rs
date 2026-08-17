//! Local AI runtime lifecycle manager (P0.3-A).
//!
//! This module owns the state machine that will drive the `llama-server`
//! sidecar in P0.3-B. It deliberately contains no process spawning, no HTTP
//! client and no model handling: the real infrastructure is injected through the
//! [`ProcessBackend`], [`HealthProbe`] and [`Clock`] traits, so every transition
//! can be exercised without a binary on disk.
//!
//! Two invariants drive the design:
//!
//! * **We never lose a process we might still own.** A failure that leaves the
//!   child potentially alive keeps its PID tracked until a kill actually
//!   succeeds; only a confirmed-dead process releases its PID.
//! * **No external I/O happens while the state lock is held.** Every operation
//!   locks to reserve a transition, unlocks, performs the I/O, then locks again
//!   to commit. P0.3-B can therefore spawn, kill and issue HTTP without ever
//!   blocking a reader.
//!
//! The Simulation Core stays authoritative regardless of what happens here: a
//! runtime that never reaches [`RuntimePhase::Ready`] must degrade to the
//! procedural fallback, never block gameplay.
//!
//! # Runtime ready is not inference ready
//!
//! P0.3-B0 ran the locked llama-server b10343 for real. Started in router mode
//! with no model, `/health` answers `200 {"status":"ok"}` while reporting zero
//! loaded models. HTTP 200 therefore proves the HTTP runtime is up, not that
//! anything can be generated. The snapshot exposes both facts separately:
//! `runtime_ready` for the former, `inference_ready` for the latter. P0.3-B may
//! reach `runtime_ready` with no model on disk; only P0.3-C, which loads a real
//! model, may ever set `inference_ready`.
//!
//! # Debt for P0.3-B2
//!
//! The polling half of this module is reachable only from the tests until the
//! background watcher is wired, so it carries targeted `#[allow(dead_code)]`
//! attributes. B2 must delete every one of them that has become unnecessary; an
//! allow that is still needed after the watcher lands marks code that is genuinely
//! dead and should be removed instead.

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, TryLockError},
    time::{SystemTime, UNIX_EPOCH},
};

/// The only host the local runtime may ever bind to.
///
/// AGENTS.md §8 forbids exposing `llama-server` beyond loopback, so this is a
/// hard invariant rather than a default: [`RuntimeConfig::new`] rejects anything
/// else instead of falling back to it silently.
pub const LOOPBACK_HOST: &str = "127.0.0.1";

/// Port the sidecar is expected to serve on during P0.
///
/// PROVISIONAL: the final value belongs to the P0.3-B packaging work.
pub const DEFAULT_PORT: u16 = 8081;

/// Grace period a starting runtime gets before it is declared failed.
///
/// PROVISIONAL until the P0 benchmark measures real cold-start times on the
/// hardware matrix; `LOCAL_AI_MODEL_PROFILES_v0.1.md` expects Standard ~3B to be
/// noticeably slower to load than Lite ~1.7B.
pub const DEFAULT_STARTUP_TIMEOUT_MS: u64 = 30_000;

/// Lifecycle phase of the local AI runtime.
///
/// `Loading` and `Ready` are only constructed on the polling path, which has no
/// production caller until P0.3-B wires the background watcher.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimePhase {
    /// No runtime binary on disk. Nothing can be started; gameplay uses the
    /// procedural fallback. This is the expected phase for the whole of P0.3-A.
    Unavailable,
    /// Binary is present and the runtime is idle.
    Stopped,
    /// Spawn succeeded; the process exists but has not answered /health yet.
    Starting,
    /// The runtime answered but is still loading the model (HTTP 503).
    Loading,
    /// The runtime answered healthy (HTTP 200).
    ///
    /// This means the HTTP runtime is up, NOT that inference is available.
    /// Verified against the real llama-server b10343 in P0.3-B0: started in
    /// router mode with no model, `/health` answers `200 {"status":"ok"}` with
    /// zero models loaded. Read `inference_ready` on the snapshot before
    /// sending anything that needs a model.
    Ready,
    /// A stop was requested and is being carried out.
    Stopping,
    /// The runtime crashed, timed out or answered in a way we cannot use.
    ///
    /// A failed runtime may still own a live process: check `pid` on the
    /// snapshot rather than assuming the child is gone.
    Failed,
}

/// Result of a single `/health` observation.
///
/// The variants mirror the cases P0.3-B has to handle against the real endpoint;
/// keeping them explicit means the mapping to [`RuntimePhase`] is decided here,
/// once, rather than inside an HTTP client.
///
/// Only `ConnectionRefused` is constructed by the shipped binary today, because
/// P0.3-A performs no network I/O: the rest are produced by the real HTTP probe
/// in P0.3-B and by the tests that already pin their semantics. They are matched
/// exhaustively in [`LocalAiRuntimeManager::poll`], so the mapping cannot rot.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthOutcome {
    /// HTTP 200 with a payload we understand: the runtime is serving.
    ///
    /// Says nothing about loaded models — see [`RuntimePhase::Ready`].
    Ready,
    /// HTTP 503: alive but still loading the model.
    Loading,
    /// The request did not complete in time.
    Timeout,
    /// Nothing is listening on the endpoint yet.
    ConnectionRefused,
    /// A response arrived but could not be parsed.
    Malformed(String),
    /// A response arrived with a status we do not know how to interpret.
    UnexpectedStatus(u16),
}

/// Validated launch contract handed to the process backend.
///
/// The fields are private and there is no public constructor: the only way to
/// obtain a `LaunchSpec` is [`RuntimeConfig::launch_spec`], which can only ever
/// produce a loopback host because [`RuntimeConfig::new`] refuses anything else.
/// P0.3-B therefore cannot assemble a command line from arbitrary strings — it
/// receives an already-validated contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    host: String,
    port: u16,
    endpoint: String,
}

// Consumed by the real command-line builder in P0.3-B.
#[allow(dead_code)]
impl LaunchSpec {
    /// Host to bind. Guaranteed to be [`LOOPBACK_HOST`].
    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Health endpoint derived from the same host and port as the bind address,
    /// so the probe can never be pointed somewhere else than the process.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
}

/// Everything the manager needs from an operating-system process.
///
/// Implementations are called without the state lock held, so they may block on
/// real I/O. `spawn` must return `Err` only when no process was created.
pub trait ProcessBackend: Send + Sync {
    /// Whether the runtime binary exists on disk right now.
    fn binary_present(&self) -> bool;
    /// Where the binary is expected, for diagnostics.
    fn binary_path(&self) -> &Path;
    /// Start the runtime from a validated launch contract, returning its PID.
    fn spawn(&self, spec: &LaunchSpec) -> Result<u32, String>;
    /// Whether a previously spawned PID is still alive.
    #[allow(dead_code)]
    fn is_running(&self, pid: u32) -> bool;
    /// Terminate a previously spawned PID. `Err` means the process may still be
    /// running and its PID must stay tracked.
    fn kill(&self, pid: u32) -> Result<(), String>;
}

/// Everything the manager needs from the `/health` endpoint.
///
/// Called without the state lock held.
pub trait HealthProbe: Send + Sync {
    fn poll(&self, endpoint: &str) -> HealthOutcome;
}

/// Monotonic-enough time source, injected so timeout policy is testable without
/// sleeping.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

/// Wall-clock implementation used by the shipped application.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}

/// Validated network and timing configuration: the single source of host and
/// port for the whole runtime.
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    host: String,
    port: u16,
    // Read only by the timeout policy on the polling path (P0.3-B).
    #[allow(dead_code)]
    startup_timeout_ms: u64,
}

impl RuntimeConfig {
    /// Build a configuration, refusing any host that is not loopback.
    pub fn new(host: &str, port: u16, startup_timeout_ms: u64) -> Result<Self, String> {
        if host != LOOPBACK_HOST {
            return Err(format!(
                "refusing host '{host}': the local AI runtime may only bind {LOOPBACK_HOST}"
            ));
        }
        if port == 0 {
            return Err("refusing port 0: the local AI runtime needs a fixed port".to_string());
        }
        Ok(Self {
            host: host.to_string(),
            port,
            startup_timeout_ms,
        })
    }

    /// Loopback configuration with the P0 defaults.
    ///
    /// Built through [`RuntimeConfig::new`] so the shipped application goes
    /// through the same host validation as any other caller.
    pub fn loopback() -> Self {
        Self::new(LOOPBACK_HOST, DEFAULT_PORT, DEFAULT_STARTUP_TIMEOUT_MS)
            .expect("the built-in loopback defaults must always be valid")
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    #[allow(dead_code)]
    pub fn startup_timeout_ms(&self) -> u64 {
        self.startup_timeout_ms
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}:{}/health", self.host, self.port)
    }

    /// Derive the validated launch contract for the process backend.
    pub fn launch_spec(&self) -> LaunchSpec {
        LaunchSpec {
            host: self.host.clone(),
            port: self.port,
            endpoint: self.endpoint(),
        }
    }
}

/// Serializable view of the runtime, consumed by the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeSnapshot {
    /// Current lifecycle phase.
    pub state: RuntimePhase,
    /// Whether the binary was on disk at the last operation. Cached so that
    /// reading the snapshot costs no filesystem access.
    pub binary_present: bool,
    pub binary_path: String,
    /// PID of the process we still own. Present in [`RuntimePhase::Failed`] when
    /// the child may be alive and has not been reaped yet.
    pub pid: Option<u32>,
    /// Milliseconds since the Unix epoch, set when the process was spawned.
    pub started_at: Option<u64>,
    pub last_error: Option<String>,
    pub host: String,
    pub port: u16,
    pub endpoint: String,
    /// The HTTP runtime is up and answering `/health`.
    ///
    /// True in [`RuntimePhase::Ready`] and nowhere else. P0.3-B can reach this
    /// without any model on disk.
    pub runtime_ready: bool,
    /// Inference can actually be served: the runtime is up **and** it has a
    /// model loaded.
    ///
    /// Always false until P0.3-C loads a real model. Gameplay must read this,
    /// not `runtime_ready`, before choosing the local AI over the procedural
    /// fallback — a router with zero models answers 200 and generates nothing.
    pub inference_ready: bool,
    /// Models the runtime reports as loaded, or `None` while unobserved.
    ///
    /// P0.3-B1 never observes it; P0.3-C is responsible for populating it.
    pub loaded_models: Option<u32>,
}

#[derive(Debug)]
struct RuntimeInner {
    phase: RuntimePhase,
    pid: Option<u32>,
    started_at: Option<u64>,
    last_error: Option<String>,
    binary_present: bool,
    /// Populated by P0.3-C once the runtime is asked what it has loaded.
    loaded_models: Option<u32>,
}

/// Owns the lifecycle of the local AI runtime.
///
/// Two locks with distinct jobs:
///
/// * `state` protects the fields above and is held only for short, I/O-free
///   critical sections.
/// * `operation` serialises the mutating operations (start, stop, poll) so that
///   two external calls can never interleave and orphan a process. It is
///   acquired with `try_lock`, so a busy runtime answers immediately instead of
///   blocking the caller.
///
/// Everything is synchronous and no lock is ever held across an await.
pub struct LocalAiRuntimeManager {
    config: RuntimeConfig,
    process: Box<dyn ProcessBackend>,
    // Exercised by the polling path only (P0.3-B).
    #[allow(dead_code)]
    health: Box<dyn HealthProbe>,
    clock: Box<dyn Clock>,
    binary_path: String,
    state: Mutex<RuntimeInner>,
    operation: Mutex<()>,
}

impl LocalAiRuntimeManager {
    pub fn new(
        config: RuntimeConfig,
        process: Box<dyn ProcessBackend>,
        health: Box<dyn HealthProbe>,
        clock: Box<dyn Clock>,
    ) -> Self {
        let binary_present = process.binary_present();
        let binary_path = process.binary_path().to_string_lossy().into_owned();
        let phase = if binary_present {
            RuntimePhase::Stopped
        } else {
            RuntimePhase::Unavailable
        };

        Self {
            config,
            process,
            health,
            clock,
            binary_path,
            state: Mutex::new(RuntimeInner {
                phase,
                pid: None,
                started_at: None,
                last_error: None,
                binary_present,
                loaded_models: None,
            }),
            operation: Mutex::new(()),
        }
    }

    /// A poisoned lock must not take the application down: the runtime is
    /// optional, gameplay continues without it.
    fn lock(&self) -> MutexGuard<'_, RuntimeInner> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Reserve the right to perform one external operation, or `None` if another
    /// one is already in flight.
    fn try_operation(&self) -> Option<MutexGuard<'_, ()>> {
        match self.operation.try_lock() {
            Ok(guard) => Some(guard),
            Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    fn idle_phase(binary_present: bool) -> RuntimePhase {
        if binary_present {
            RuntimePhase::Stopped
        } else {
            RuntimePhase::Unavailable
        }
    }

    fn build_snapshot(&self, inner: &RuntimeInner) -> LocalAiRuntimeSnapshot {
        let runtime_ready = inner.phase == RuntimePhase::Ready;
        LocalAiRuntimeSnapshot {
            state: inner.phase,
            binary_present: inner.binary_present,
            binary_path: self.binary_path.clone(),
            pid: inner.pid,
            started_at: inner.started_at,
            last_error: inner.last_error.clone(),
            host: self.config.host().to_string(),
            port: self.config.port(),
            endpoint: self.config.endpoint(),
            runtime_ready,
            // Deliberately conjunctive: a runtime that is up but holds no model
            // must never claim it can generate.
            inference_ready: runtime_ready && inner.loaded_models.unwrap_or(0) > 0,
            loaded_models: inner.loaded_models,
        }
    }

    /// Fail after confirming the process is gone: the PID may be released.
    fn fail_process_gone(inner: &mut RuntimeInner, reason: String) {
        inner.phase = RuntimePhase::Failed;
        inner.pid = None;
        inner.started_at = None;
        inner.last_error = Some(reason);
    }

    /// Fail while the process may still be alive.
    ///
    /// The PID and start time are deliberately retained: something must still be
    /// able to kill this child, and a later [`Self::stop`] is that something.
    fn fail_retaining_process(inner: &mut RuntimeInner, reason: String) {
        inner.phase = RuntimePhase::Failed;
        inner.last_error = Some(reason);
    }

    /// Whether a runtime that is still coming up has exhausted its grace period.
    #[allow(dead_code)]
    fn startup_expired(&self, started_at: Option<u64>, now_ms: u64) -> bool {
        match started_at {
            Some(started_at) => {
                now_ms.saturating_sub(started_at) > self.config.startup_timeout_ms()
            }
            None => false,
        }
    }

    /// Current snapshot.
    ///
    /// A pure read: it takes the state lock briefly, copies the fields and
    /// returns. It performs no filesystem or network access and never advances
    /// the state machine, so the UI can call it as often as it likes.
    pub fn snapshot(&self) -> LocalAiRuntimeSnapshot {
        let inner = self.lock();
        self.build_snapshot(&inner)
    }

    /// Request a start.
    ///
    /// Refuses to start a second instance, refuses to abandon a process that is
    /// still tracked, and never reports success when the binary is missing or
    /// the spawn fails.
    pub fn start(&self) -> Result<LocalAiRuntimeSnapshot, String> {
        let Some(_operation) = self.try_operation() else {
            return Err("another local AI runtime operation is already in progress".to_string());
        };

        // External probe, deliberately outside the state lock.
        let binary_present = self.process.binary_present();

        let spec = {
            let mut inner = self.lock();
            inner.binary_present = binary_present;

            match inner.phase {
                RuntimePhase::Starting | RuntimePhase::Loading | RuntimePhase::Ready => {
                    return Err(format!(
                        "local AI runtime is already active (phase {:?})",
                        inner.phase
                    ));
                }
                RuntimePhase::Stopping => {
                    return Err("local AI runtime is still stopping".to_string());
                }
                RuntimePhase::Unavailable | RuntimePhase::Stopped | RuntimePhase::Failed => {}
            }

            // A failed runtime may still own a live child. Starting a second one
            // would leak the first.
            if let Some(pid) = inner.pid {
                return Err(format!(
                    "local AI runtime process {pid} is still tracked; stop it before starting again"
                ));
            }

            if !binary_present {
                let reason = format!("llama-server binary not found at {}", self.binary_path);
                inner.phase = RuntimePhase::Unavailable;
                inner.started_at = None;
                inner.last_error = Some(reason.clone());
                return Err(reason);
            }

            // Reserve the transition so a concurrent start is refused.
            inner.phase = RuntimePhase::Starting;
            inner.started_at = None;
            inner.last_error = None;
            self.config.launch_spec()
        };

        // External spawn, no state lock held.
        let outcome = self.process.spawn(&spec);
        let now_ms = self.clock.now_ms();

        let mut inner = self.lock();
        match outcome {
            Ok(pid) => {
                inner.pid = Some(pid);
                inner.started_at = Some(now_ms);
                Ok(self.build_snapshot(&inner))
            }
            Err(error) => {
                // The backend contract says Err means nothing was created, so
                // there is no process to keep track of.
                Self::fail_process_gone(&mut inner, error.clone());
                Err(error)
            }
        }
    }

    /// Advance the state machine by one `/health` observation.
    ///
    /// Internal to the manager for now: P0.3-B's background watcher will drive
    /// it. Only meaningful while starting, loading or ready; in any other phase,
    /// or while another operation is in flight, it is a pure read.
    #[allow(dead_code)]
    pub fn poll(&self) -> LocalAiRuntimeSnapshot {
        let Some(_operation) = self.try_operation() else {
            return self.snapshot();
        };

        let (phase, pid, started_at) = {
            let inner = self.lock();
            if !matches!(
                inner.phase,
                RuntimePhase::Starting | RuntimePhase::Loading | RuntimePhase::Ready
            ) {
                return self.build_snapshot(&inner);
            }
            (inner.phase, inner.pid, inner.started_at)
        };

        // External observations, no state lock held.
        let process_alive = pid.map(|pid| self.process.is_running(pid));
        let health = match process_alive {
            Some(false) => None,
            _ => Some(self.health.poll(&self.config.endpoint())),
        };
        let now_ms = self.clock.now_ms();
        let expired = self.startup_expired(started_at, now_ms);

        let mut inner = self.lock();

        // Nothing else may mutate state while the operation guard is held, but
        // reconcile defensively rather than clobber an unexpected transition.
        if inner.phase != phase || inner.pid != pid {
            return self.build_snapshot(&inner);
        }

        if process_alive == Some(false) {
            let pid = pid.unwrap_or_default();
            Self::fail_process_gone(
                &mut inner,
                format!("local AI runtime process {pid} exited unexpectedly"),
            );
            return self.build_snapshot(&inner);
        }

        let was_ready = phase == RuntimePhase::Ready;
        let timeout_ms = self.config.startup_timeout_ms();

        match health.expect("health is only skipped for a confirmed-dead process") {
            HealthOutcome::Ready => {
                inner.phase = RuntimePhase::Ready;
                inner.last_error = None;
            }
            HealthOutcome::Loading => {
                if expired {
                    Self::fail_retaining_process(
                        &mut inner,
                        format!("local AI runtime was still loading after {timeout_ms} ms"),
                    );
                } else {
                    inner.phase = RuntimePhase::Loading;
                }
            }
            // Silence during startup is normal until the grace period expires;
            // silence after Ready means we lost the runtime.
            HealthOutcome::ConnectionRefused => {
                if was_ready {
                    Self::fail_retaining_process(
                        &mut inner,
                        "local AI runtime refused the connection after becoming ready".to_string(),
                    );
                } else if expired {
                    Self::fail_retaining_process(
                        &mut inner,
                        format!("local AI runtime did not accept connections within {timeout_ms} ms"),
                    );
                }
            }
            HealthOutcome::Timeout => {
                if was_ready || expired {
                    Self::fail_retaining_process(
                        &mut inner,
                        format!("local AI runtime health check timed out after {timeout_ms} ms"),
                    );
                }
            }
            HealthOutcome::Malformed(detail) => {
                Self::fail_retaining_process(
                    &mut inner,
                    format!("local AI runtime returned an unreadable health payload: {detail}"),
                );
            }
            HealthOutcome::UnexpectedStatus(status) => {
                Self::fail_retaining_process(
                    &mut inner,
                    format!("local AI runtime returned unexpected health status {status}"),
                );
            }
        }

        self.build_snapshot(&inner)
    }

    /// Stop the runtime.
    ///
    /// Idempotent when nothing is owned, and retryable when it is: a kill that
    /// fails leaves the runtime `Failed` with its PID intact, so calling stop
    /// again attempts the kill once more. Safe to call on app shutdown.
    pub fn stop(&self) -> LocalAiRuntimeSnapshot {
        let Some(_operation) = self.try_operation() else {
            return self.snapshot();
        };

        // External probe, deliberately outside the state lock.
        let binary_present = self.process.binary_present();

        let pid = {
            let mut inner = self.lock();
            inner.binary_present = binary_present;

            match inner.pid {
                // Nothing owned: settle into the idle phase and report success.
                None => {
                    inner.phase = Self::idle_phase(binary_present);
                    inner.started_at = None;
                    return self.build_snapshot(&inner);
                }
                Some(pid) => {
                    inner.phase = RuntimePhase::Stopping;
                    pid
                }
            }
        };

        // External kill, no state lock held.
        let outcome = self.process.kill(pid);

        let mut inner = self.lock();
        match outcome {
            Ok(()) => {
                inner.pid = None;
                inner.started_at = None;
                inner.last_error = None;
                inner.phase = Self::idle_phase(binary_present);
            }
            Err(error) => {
                // The child may still be running: keep owning it so a later stop
                // can try again.
                Self::fail_retaining_process(
                    &mut inner,
                    format!("failed to stop local AI runtime process {pid}: {error}"),
                );
            }
        }

        self.build_snapshot(&inner)
    }
}

/// Filesystem-backed process backend for the shipped application.
///
/// P0.3-A knows where the sidecar will live and can tell whether it is there,
/// but deliberately refuses to spawn it: launching the real `llama-server` is
/// P0.3-B work, and reporting a fake success would hide that.
pub struct SystemProcessBackend {
    binary_path: PathBuf,
}

impl SystemProcessBackend {
    pub fn new(binary_path: PathBuf) -> Self {
        Self { binary_path }
    }
}

impl ProcessBackend for SystemProcessBackend {
    fn binary_present(&self) -> bool {
        self.binary_path.is_file()
    }

    fn binary_path(&self) -> &Path {
        &self.binary_path
    }

    fn spawn(&self, _spec: &LaunchSpec) -> Result<u32, String> {
        if !self.binary_present() {
            return Err(format!(
                "llama-server binary not found at {}",
                self.binary_path.display()
            ));
        }
        Err("spawning the llama-server sidecar is not implemented yet (P0.3-B)".to_string())
    }

    fn is_running(&self, _pid: u32) -> bool {
        false
    }

    fn kill(&self, _pid: u32) -> Result<(), String> {
        Ok(())
    }
}

/// Health probe placeholder for the shipped application.
///
/// P0.3-A performs no network I/O at all; nothing is listening, so the honest
/// answer is that the connection would be refused.
pub struct UnimplementedHealthProbe;

impl HealthProbe for UnimplementedHealthProbe {
    fn poll(&self, _endpoint: &str) -> HealthOutcome {
        HealthOutcome::ConnectionRefused
    }
}

/// Build the manager the application ships with.
pub fn system_manager(binary_path: PathBuf) -> LocalAiRuntimeManager {
    LocalAiRuntimeManager::new(
        RuntimeConfig::loopback(),
        Box::new(SystemProcessBackend::new(binary_path)),
        Box::new(UnimplementedHealthProbe),
        Box::new(SystemClock),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    /// Scriptable process backend. Test-only by construction: it lives inside
    /// `#[cfg(test)]` and never ships.
    struct FakeProcess {
        binary_present: StdMutex<bool>,
        path: PathBuf,
        next_pid: StdMutex<u32>,
        running: StdMutex<bool>,
        spawn_error: StdMutex<Option<String>>,
        kill_error: StdMutex<Option<String>>,
        kill_calls: StdMutex<u32>,
    }

    impl FakeProcess {
        fn present() -> Self {
            Self {
                binary_present: StdMutex::new(true),
                path: PathBuf::from("/fake/bin/llama-server"),
                next_pid: StdMutex::new(4242),
                running: StdMutex::new(true),
                spawn_error: StdMutex::new(None),
                kill_error: StdMutex::new(None),
                kill_calls: StdMutex::new(0),
            }
        }

        fn missing() -> Self {
            let backend = Self::present();
            *backend.binary_present.lock().unwrap() = false;
            backend
        }

        fn crash(&self) {
            *self.running.lock().unwrap() = false;
        }

        fn fail_kill_with(&self, error: &str) {
            *self.kill_error.lock().unwrap() = Some(error.to_string());
        }

        fn allow_kill(&self) {
            *self.kill_error.lock().unwrap() = None;
        }

        fn kill_calls(&self) -> u32 {
            *self.kill_calls.lock().unwrap()
        }
    }

    impl ProcessBackend for FakeProcess {
        fn binary_present(&self) -> bool {
            *self.binary_present.lock().unwrap()
        }

        fn binary_path(&self) -> &Path {
            &self.path
        }

        fn spawn(&self, spec: &LaunchSpec) -> Result<u32, String> {
            assert_eq!(
                spec.host(),
                LOOPBACK_HOST,
                "spawn must only ever receive a loopback launch contract"
            );
            if let Some(error) = self.spawn_error.lock().unwrap().clone() {
                return Err(error);
            }
            Ok(*self.next_pid.lock().unwrap())
        }

        fn is_running(&self, _pid: u32) -> bool {
            *self.running.lock().unwrap()
        }

        fn kill(&self, _pid: u32) -> Result<(), String> {
            *self.kill_calls.lock().unwrap() += 1;
            match self.kill_error.lock().unwrap().clone() {
                Some(error) => Err(error),
                None => Ok(()),
            }
        }
    }

    /// Health probe that replays a scripted sequence, repeating the last entry.
    struct FakeHealth {
        outcomes: StdMutex<Vec<HealthOutcome>>,
        cursor: StdMutex<usize>,
    }

    impl FakeHealth {
        fn new(outcomes: Vec<HealthOutcome>) -> Self {
            Self {
                outcomes: StdMutex::new(outcomes),
                cursor: StdMutex::new(0),
            }
        }
    }

    impl HealthProbe for FakeHealth {
        fn poll(&self, endpoint: &str) -> HealthOutcome {
            assert!(
                endpoint.starts_with("http://127.0.0.1:"),
                "health probe must only ever be pointed at loopback, got {endpoint}"
            );
            let outcomes = self.outcomes.lock().unwrap();
            let mut cursor = self.cursor.lock().unwrap();
            let index = (*cursor).min(outcomes.len().saturating_sub(1));
            *cursor += 1;
            outcomes
                .get(index)
                .cloned()
                .unwrap_or(HealthOutcome::ConnectionRefused)
        }
    }

    /// Clock the test drives by hand, so timeout policy needs no sleeping.
    struct FakeClock {
        now: StdMutex<u64>,
    }

    impl FakeClock {
        fn new() -> Self {
            Self {
                now: StdMutex::new(1_000),
            }
        }

        fn advance(&self, ms: u64) {
            *self.now.lock().unwrap() += ms;
        }
    }

    impl Clock for FakeClock {
        fn now_ms(&self) -> u64 {
            *self.now.lock().unwrap()
        }
    }

    struct SharedProcess(Arc<FakeProcess>);

    impl ProcessBackend for SharedProcess {
        fn binary_present(&self) -> bool {
            self.0.binary_present()
        }
        fn binary_path(&self) -> &Path {
            self.0.binary_path()
        }
        fn spawn(&self, spec: &LaunchSpec) -> Result<u32, String> {
            self.0.spawn(spec)
        }
        fn is_running(&self, pid: u32) -> bool {
            self.0.is_running(pid)
        }
        fn kill(&self, pid: u32) -> Result<(), String> {
            self.0.kill(pid)
        }
    }

    struct SharedClock(Arc<FakeClock>);

    impl Clock for SharedClock {
        fn now_ms(&self) -> u64 {
            self.0.now_ms()
        }
    }

    fn manager_with(
        process: Arc<FakeProcess>,
        health: Vec<HealthOutcome>,
        clock: Arc<FakeClock>,
    ) -> LocalAiRuntimeManager {
        LocalAiRuntimeManager::new(
            RuntimeConfig::new(LOOPBACK_HOST, 8081, DEFAULT_STARTUP_TIMEOUT_MS).unwrap(),
            Box::new(SharedProcess(process)),
            Box::new(FakeHealth::new(health)),
            Box::new(SharedClock(clock)),
        )
    }

    /// Drive a manager all the way to Ready.
    fn ready_manager(process: Arc<FakeProcess>, clock: Arc<FakeClock>) -> LocalAiRuntimeManager {
        let manager = manager_with(process, vec![HealthOutcome::Ready], clock);
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Ready);
        manager
    }

    /// Drive a manager into Failed while its process is still alive.
    fn failed_but_alive(
        process: Arc<FakeProcess>,
        outcome: HealthOutcome,
    ) -> LocalAiRuntimeManager {
        let manager = manager_with(process, vec![outcome], Arc::new(FakeClock::new()));
        manager.start().expect("start should succeed");
        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        manager
    }

    #[test]
    fn starts_unavailable_when_no_binary_is_installed() {
        let manager = manager_with(
            Arc::new(FakeProcess::missing()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Unavailable);
        assert!(!snapshot.binary_present);
        assert_eq!(snapshot.pid, None);
    }

    #[test]
    fn start_with_missing_binary_reports_an_explicit_error() {
        let manager = manager_with(
            Arc::new(FakeProcess::missing()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        let error = manager.start().expect_err("start must not succeed");
        assert!(error.contains("not found"), "unexpected error: {error}");

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Unavailable);
        assert_eq!(snapshot.pid, None, "no process may be recorded");
        assert!(snapshot.last_error.is_some());
    }

    #[test]
    fn binary_available_means_stopped_not_unavailable() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Stopped);
        assert!(snapshot.binary_present);
    }

    #[test]
    fn stopped_moves_to_starting_on_start() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        let snapshot = manager.start().expect("start should succeed");
        assert_eq!(snapshot.state, RuntimePhase::Starting);
        assert_eq!(snapshot.pid, Some(4242));
        assert!(snapshot.started_at.is_some());
    }

    #[test]
    fn starting_moves_to_loading_on_503() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Loading],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Loading);
    }

    #[test]
    fn loading_moves_to_ready_on_200() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Loading, HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Loading);

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Ready);
        assert_eq!(snapshot.last_error, None);
    }

    #[test]
    fn loading_stays_loading_while_within_the_startup_window() {
        let clock = Arc::new(FakeClock::new());
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Loading],
            clock.clone(),
        );
        manager.start().expect("start should succeed");
        clock.advance(DEFAULT_STARTUP_TIMEOUT_MS - 1);
        assert_eq!(manager.poll().state, RuntimePhase::Loading);
    }

    #[test]
    fn health_timeout_fails_only_after_the_timeout_policy_elapses() {
        let clock = Arc::new(FakeClock::new());
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Timeout],
            clock.clone(),
        );
        manager.start().expect("start should succeed");

        assert_eq!(
            manager.poll().state,
            RuntimePhase::Starting,
            "a single slow probe must not kill a runtime that is still starting"
        );

        clock.advance(DEFAULT_STARTUP_TIMEOUT_MS + 1);
        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert!(snapshot.last_error.unwrap().contains("timed out"));
    }

    #[test]
    fn malformed_health_payload_fails_immediately() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Malformed("not json".to_string())],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert!(snapshot.last_error.unwrap().contains("unreadable"));
    }

    #[test]
    fn unexpected_health_status_fails_immediately() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::UnexpectedStatus(418)],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert!(snapshot.last_error.unwrap().contains("418"));
    }

    #[test]
    fn connection_refused_during_startup_keeps_waiting() {
        let clock = Arc::new(FakeClock::new());
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::ConnectionRefused],
            clock.clone(),
        );
        manager.start().expect("start should succeed");
        clock.advance(1_000);
        assert_eq!(manager.poll().state, RuntimePhase::Starting);
    }

    #[test]
    fn connection_refused_after_ready_fails() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready, HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Ready);

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert!(snapshot.last_error.unwrap().contains("after becoming ready"));
    }

    #[test]
    fn process_crash_releases_the_pid() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        process.crash();

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(
            snapshot.pid, None,
            "a confirmed-dead process releases its PID"
        );
        assert!(snapshot.last_error.unwrap().contains("exited unexpectedly"));
    }

    #[test]
    fn malformed_health_keeps_tracking_a_process_that_may_be_alive() {
        let process = Arc::new(FakeProcess::present());
        let manager = failed_but_alive(
            process.clone(),
            HealthOutcome::Malformed("garbage".to_string()),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(
            snapshot.pid,
            Some(4242),
            "the child may still be running and must stay owned"
        );
        assert!(snapshot.started_at.is_some());
    }

    #[test]
    fn unexpected_health_keeps_tracking_a_process_that_may_be_alive() {
        let process = Arc::new(FakeProcess::present());
        let manager = failed_but_alive(process, HealthOutcome::UnexpectedStatus(500));

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(snapshot.pid, Some(4242));
    }

    #[test]
    fn health_timeout_keeps_tracking_a_process_that_may_be_alive() {
        let process = Arc::new(FakeProcess::present());
        let clock = Arc::new(FakeClock::new());
        let manager = manager_with(process, vec![HealthOutcome::Timeout], clock.clone());
        manager.start().expect("start should succeed");
        clock.advance(DEFAULT_STARTUP_TIMEOUT_MS + 1);

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(
            snapshot.pid,
            Some(4242),
            "a timeout says nothing about whether the child died"
        );
    }

    #[test]
    fn connection_refused_after_ready_keeps_tracking_the_process() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready, HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        manager.poll();

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(snapshot.pid, Some(4242));
    }

    #[test]
    fn a_failed_runtime_that_still_owns_a_process_refuses_to_start_again() {
        let process = Arc::new(FakeProcess::present());
        let manager = failed_but_alive(process, HealthOutcome::UnexpectedStatus(500));

        let error = manager
            .start()
            .expect_err("starting a second child while one is owned must be refused");
        assert!(error.contains("still tracked"), "unexpected error: {error}");
        assert_eq!(manager.snapshot().pid, Some(4242));
    }

    #[test]
    fn pid_is_not_lost_until_cleanup_succeeds() {
        let process = Arc::new(FakeProcess::present());
        let manager = failed_but_alive(
            process.clone(),
            HealthOutcome::Malformed("garbage".to_string()),
        );

        process.fail_kill_with("access denied");
        for _ in 0..3 {
            let snapshot = manager.stop();
            assert_eq!(snapshot.state, RuntimePhase::Failed);
            assert_eq!(snapshot.pid, Some(4242), "a failed kill must not drop the PID");
        }
        assert_eq!(process.kill_calls(), 3, "every stop retries the kill");

        process.allow_kill();
        let snapshot = manager.stop();
        assert_eq!(snapshot.state, RuntimePhase::Stopped);
        assert_eq!(snapshot.pid, None);
    }

    #[test]
    fn kill_failure_fails_the_stop_and_a_retry_completes_it() {
        let process = Arc::new(FakeProcess::present());
        let manager = ready_manager(process.clone(), Arc::new(FakeClock::new()));
        process.fail_kill_with("the process would not die");

        let failed = manager.stop();
        assert_eq!(failed.state, RuntimePhase::Failed);
        assert_eq!(failed.pid, Some(4242), "the PID must survive a failed kill");
        assert!(failed.last_error.unwrap().contains("failed to stop"));

        process.allow_kill();
        let stopped = manager.stop();
        assert_eq!(stopped.state, RuntimePhase::Stopped);
        assert_eq!(stopped.pid, None);
        assert_eq!(stopped.last_error, None);
        assert_eq!(process.kill_calls(), 2, "the second stop retried the kill");
    }

    #[test]
    fn spawn_failure_releases_the_pid() {
        let process = Arc::new(FakeProcess::present());
        *process.spawn_error.lock().unwrap() = Some("permission denied".to_string());
        let manager = manager_with(process, vec![HealthOutcome::Ready], Arc::new(FakeClock::new()));

        let error = manager.start().expect_err("spawn failure must surface");
        assert!(error.contains("permission denied"));

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(
            snapshot.pid, None,
            "a spawn that returned Err created no process"
        );
    }

    #[test]
    fn duplicate_start_is_refused_and_leaves_one_instance() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        let first = manager.start().expect("first start should succeed");

        let error = manager.start().expect_err("second start must be refused");
        assert!(error.contains("already active"), "unexpected error: {error}");
        assert_eq!(
            manager.snapshot().pid,
            first.pid,
            "the original process must be untouched"
        );
    }

    #[test]
    fn ready_stops_through_stopping_back_to_stopped() {
        let process = Arc::new(FakeProcess::present());
        let manager = ready_manager(process.clone(), Arc::new(FakeClock::new()));

        let snapshot = manager.stop();
        assert_eq!(snapshot.state, RuntimePhase::Stopped);
        assert_eq!(process.kill_calls(), 1, "the process must be killed once");
    }

    #[test]
    fn stop_is_idempotent() {
        let process = Arc::new(FakeProcess::present());
        let manager = ready_manager(process.clone(), Arc::new(FakeClock::new()));

        manager.stop();
        let second = manager.stop();
        let third = manager.stop();

        assert_eq!(second.state, RuntimePhase::Stopped);
        assert_eq!(third.state, RuntimePhase::Stopped);
        assert_eq!(
            process.kill_calls(),
            1,
            "a stopped runtime must not be killed again"
        );
    }

    #[test]
    fn stop_without_a_process_does_nothing() {
        let process = Arc::new(FakeProcess::missing());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );

        let snapshot = manager.stop();
        assert_eq!(snapshot.state, RuntimePhase::Unavailable);
        assert_eq!(process.kill_calls(), 0);
    }

    #[test]
    fn failed_runtime_can_be_restarted_once_its_process_is_released() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Malformed("boom".to_string())],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Failed);

        // The child may still be alive, so the runtime must be reaped first.
        assert_eq!(manager.stop().state, RuntimePhase::Stopped);

        let snapshot = manager.start().expect("restart after failure must be allowed");
        assert_eq!(snapshot.state, RuntimePhase::Starting);
        assert_eq!(snapshot.last_error, None, "a restart clears the previous error");
    }

    #[test]
    fn crashed_runtime_restarts_without_an_explicit_stop() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        process.crash();
        assert_eq!(manager.poll().pid, None, "a dead process is released");

        let snapshot = manager
            .start()
            .expect("a confirmed-dead runtime owns nothing and may restart");
        assert_eq!(snapshot.state, RuntimePhase::Starting);
    }

    #[test]
    fn stop_clears_pid_and_start_time() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));
        assert!(manager.snapshot().pid.is_some());

        let snapshot = manager.stop();
        assert_eq!(snapshot.pid, None);
        assert_eq!(snapshot.started_at, None);
    }

    #[test]
    fn missing_binary_never_panics_across_the_whole_lifecycle() {
        let manager = manager_with(
            Arc::new(FakeProcess::missing()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );

        for _ in 0..3 {
            assert!(manager.start().is_err());
            let _ = manager.poll();
            let _ = manager.stop();
            let _ = manager.snapshot();
        }

        assert_eq!(manager.snapshot().state, RuntimePhase::Unavailable);
    }

    #[test]
    fn snapshot_is_a_pure_read_and_never_advances_the_state_machine() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );

        manager.start().expect("start should succeed");
        for _ in 0..10 {
            assert_eq!(
                manager.snapshot().state,
                RuntimePhase::Starting,
                "reading the status must not drive the runtime forward"
            );
        }

        assert_eq!(manager.poll().state, RuntimePhase::Ready);
        for _ in 0..10 {
            assert_eq!(manager.snapshot().state, RuntimePhase::Ready);
        }
    }

    #[test]
    fn snapshot_performs_no_process_io() {
        struct ExplodingProcess(PathBuf);
        impl ProcessBackend for ExplodingProcess {
            fn binary_present(&self) -> bool {
                panic!("snapshot must not touch the filesystem");
            }
            fn binary_path(&self) -> &Path {
                &self.0
            }
            fn spawn(&self, _spec: &LaunchSpec) -> Result<u32, String> {
                panic!("snapshot must not spawn");
            }
            fn is_running(&self, _pid: u32) -> bool {
                panic!("snapshot must not probe the process");
            }
            fn kill(&self, _pid: u32) -> Result<(), String> {
                panic!("snapshot must not kill");
            }
        }

        struct ExplodingHealth;
        impl HealthProbe for ExplodingHealth {
            fn poll(&self, _endpoint: &str) -> HealthOutcome {
                panic!("snapshot must not issue a health request");
            }
        }

        // `new` is allowed one probe; after that the backend refuses everything.
        let manager = LocalAiRuntimeManager {
            config: RuntimeConfig::loopback(),
            process: Box::new(ExplodingProcess(PathBuf::from("/fake/llama-server"))),
            health: Box::new(ExplodingHealth),
            clock: Box::new(SystemClock),
            binary_path: "/fake/llama-server".to_string(),
            state: Mutex::new(RuntimeInner {
                phase: RuntimePhase::Stopped,
                pid: None,
                started_at: None,
                last_error: None,
                binary_present: true,
                loaded_models: None,
            }),
            operation: Mutex::new(()),
        };

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Stopped);
        assert!(snapshot.binary_present, "the cached value is reported");
    }

    #[test]
    fn non_loopback_hosts_are_rejected() {
        for host in [
            "0.0.0.0",
            "192.168.1.10",
            "10.0.0.5",
            "::",
            "::1",
            "localhost",
            "127.0.0.2",
            "",
        ] {
            let error = RuntimeConfig::new(host, 8081, DEFAULT_STARTUP_TIMEOUT_MS)
                .expect_err("non-loopback host must be refused");
            assert!(error.contains("only bind"), "unexpected error: {error}");
        }

        let config = RuntimeConfig::new(LOOPBACK_HOST, 8081, DEFAULT_STARTUP_TIMEOUT_MS)
            .expect("loopback must be accepted");
        assert_eq!(config.host(), LOOPBACK_HOST);
        assert_eq!(config.endpoint(), "http://127.0.0.1:8081/health");
    }

    #[test]
    fn port_zero_is_rejected() {
        let error = RuntimeConfig::new(LOOPBACK_HOST, 0, DEFAULT_STARTUP_TIMEOUT_MS)
            .expect_err("port 0 must be refused");
        assert!(error.contains("port 0"));
    }

    #[test]
    fn launch_spec_is_always_loopback_and_agrees_with_the_config() {
        let config = RuntimeConfig::new(LOOPBACK_HOST, 9099, DEFAULT_STARTUP_TIMEOUT_MS).unwrap();
        let spec = config.launch_spec();

        assert_eq!(spec.host(), LOOPBACK_HOST);
        assert_eq!(spec.port(), 9099);
        assert_eq!(spec.endpoint(), "http://127.0.0.1:9099/health");
        assert_eq!(spec.endpoint(), config.endpoint());
        assert_eq!(spec, RuntimeConfig::new(LOOPBACK_HOST, 9099, 1).unwrap().launch_spec());
    }

    #[test]
    fn last_error_is_populated_on_failure_and_cleared_on_success() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::UnexpectedStatus(500), HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");

        let failed = manager.poll();
        assert_eq!(failed.state, RuntimePhase::Failed);
        assert!(failed.last_error.is_some());

        manager.stop();
        manager.start().expect("restart should succeed");
        let recovered = manager.poll();
        assert_eq!(recovered.state, RuntimePhase::Ready);
        assert_eq!(recovered.last_error, None);
    }

    #[test]
    fn snapshot_serializes_the_documented_contract() {
        let manager = manager_with(
            Arc::new(FakeProcess::missing()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        );
        let json = serde_json::to_value(manager.snapshot()).expect("snapshot must serialize");

        for key in [
            "state",
            "binaryPresent",
            "binaryPath",
            "pid",
            "startedAt",
            "lastError",
            "host",
            "port",
            "endpoint",
            "runtimeReady",
            "inferenceReady",
            "loadedModels",
        ] {
            assert!(json.get(key).is_some(), "snapshot is missing '{key}'");
        }
        assert_eq!(json["state"], "unavailable");
        assert_eq!(json["host"], LOOPBACK_HOST);
        assert_eq!(json["runtimeReady"], false);
        assert_eq!(json["inferenceReady"], false);
    }

    #[test]
    fn a_ready_runtime_is_not_an_inference_ready_runtime() {
        // The real llama-server b10343 answers 200 in router mode with zero
        // models loaded (measured in P0.3-B0), so reaching Ready must not imply
        // that anything can be generated.
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));
        let snapshot = manager.snapshot();

        assert_eq!(snapshot.state, RuntimePhase::Ready);
        assert!(snapshot.runtime_ready, "the HTTP runtime is up");
        assert!(
            !snapshot.inference_ready,
            "no model is loaded, so inference must not be advertised"
        );
        assert_eq!(snapshot.loaded_models, None, "P0.3-C observes this, not B1");
    }

    #[test]
    fn inference_ready_requires_both_a_ready_runtime_and_a_loaded_model() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));

        // Simulate what P0.3-C will observe: the runtime reports a loaded model.
        manager.lock().loaded_models = Some(1);
        let serving = manager.snapshot();
        assert!(serving.runtime_ready && serving.inference_ready);

        // A runtime that drops back out of Ready cannot stay inference ready,
        // even while it still remembers a model.
        manager.stop();
        let stopped = manager.snapshot();
        assert!(!stopped.runtime_ready);
        assert!(
            !stopped.inference_ready,
            "a stopped runtime serves nothing, whatever it last had loaded"
        );
    }

    #[test]
    fn no_idle_or_failed_phase_ever_claims_readiness() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Malformed("boom".to_string())],
            Arc::new(FakeClock::new()),
        );

        for snapshot in [
            manager.snapshot(),                       // Stopped
            manager.start().expect("start"),          // Starting
            manager.poll(),                           // Failed
            manager.stop(),                           // Stopped again
        ] {
            assert!(!snapshot.runtime_ready, "{:?} must not be runtime ready", snapshot.state);
            assert!(!snapshot.inference_ready, "{:?} must not be inference ready", snapshot.state);
        }
    }

    #[test]
    fn shipped_backend_refuses_to_fake_a_successful_spawn() {
        let backend = SystemProcessBackend::new(PathBuf::from("/definitely/not/here/llama-server"));
        assert!(!backend.binary_present());
        let error = backend
            .spawn(&RuntimeConfig::loopback().launch_spec())
            .expect_err("a missing binary must not spawn");
        assert!(error.contains("not found"));
    }

    #[test]
    fn manager_is_shareable_across_threads() {
        let manager = Arc::new(manager_with(
            Arc::new(FakeProcess::missing()),
            vec![HealthOutcome::ConnectionRefused],
            Arc::new(FakeClock::new()),
        ));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let manager = manager.clone();
                std::thread::spawn(move || {
                    let _ = manager.start();
                    let _ = manager.poll();
                    let _ = manager.stop();
                    manager.snapshot().state
                })
            })
            .collect();

        for handle in handles {
            assert_eq!(
                handle.join().expect("thread must not panic"),
                RuntimePhase::Unavailable
            );
        }
    }

    #[test]
    fn concurrent_starts_produce_exactly_one_running_instance() {
        let process = Arc::new(FakeProcess::present());
        let manager = Arc::new(manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        ));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let manager = manager.clone();
                std::thread::spawn(move || manager.start().is_ok())
            })
            .collect();

        let successes = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread must not panic"))
            .filter(|started| *started)
            .count();

        assert_eq!(successes, 1, "only one start may win the race");
        assert_eq!(manager.snapshot().state, RuntimePhase::Starting);
    }

    #[test]
    fn concurrent_start_and_stop_never_orphan_a_process() {
        let process = Arc::new(FakeProcess::present());
        let manager = Arc::new(manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        ));

        let handles: Vec<_> = (0..12)
            .map(|index| {
                let manager = manager.clone();
                std::thread::spawn(move || {
                    if index % 2 == 0 {
                        let _ = manager.start();
                    } else {
                        let _ = manager.stop();
                    }
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("thread must not panic");
        }

        // Whatever order the operations landed in, the runtime must end up
        // either owning exactly one process or owning none — never in a state
        // that claims a PID it has released, or vice versa.
        let snapshot = manager.snapshot();
        match snapshot.state {
            RuntimePhase::Starting | RuntimePhase::Loading | RuntimePhase::Ready => {
                assert!(snapshot.pid.is_some(), "an active runtime must own its process");
            }
            RuntimePhase::Stopped | RuntimePhase::Unavailable => {
                assert_eq!(snapshot.pid, None, "an idle runtime must own nothing");
            }
            RuntimePhase::Failed | RuntimePhase::Stopping => {}
        }

        // A final stop must always converge, retrying until the child is reaped.
        assert_eq!(manager.stop().state, RuntimePhase::Stopped);
        assert_eq!(manager.snapshot().pid, None);
    }
}
