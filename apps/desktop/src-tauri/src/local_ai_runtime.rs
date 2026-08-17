//! Local AI runtime lifecycle manager (P0.3-A).
//!
//! This module owns the state machine that will drive the `llama-server`
//! sidecar in P0.3-B. It deliberately contains no process spawning, no HTTP
//! client and no model handling: the real infrastructure is injected through the
//! [`ProcessBackend`], [`HealthProbe`] and [`Clock`] traits, so every transition
//! can be exercised without a binary on disk.
//!
//! The Simulation Core stays authoritative regardless of what happens here: a
//! runtime that never reaches [`RuntimePhase::Ready`] must degrade to the
//! procedural fallback, never block gameplay.

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
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
    /// The runtime answered healthy (HTTP 200) and can serve requests.
    Ready,
    /// A stop was requested and is being carried out.
    Stopping,
    /// The runtime crashed, timed out or answered in a way we cannot use.
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
    /// HTTP 200 with a payload we understand.
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

/// Everything the manager needs from an operating-system process.
pub trait ProcessBackend: Send + Sync {
    /// Whether the runtime binary exists on disk right now.
    fn binary_present(&self) -> bool;
    /// Where the binary is expected, for diagnostics.
    fn binary_path(&self) -> &Path;
    /// Start the runtime, returning its PID.
    fn spawn(&self, host: &str, port: u16) -> Result<u32, String>;
    /// Whether a previously spawned PID is still alive.
    fn is_running(&self, pid: u32) -> bool;
    /// Terminate a previously spawned PID.
    fn kill(&self, pid: u32) -> Result<(), String>;
}

/// Everything the manager needs from the `/health` endpoint.
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

/// Validated network and timing configuration.
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    host: String,
    port: u16,
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

    pub fn startup_timeout_ms(&self) -> u64 {
        self.startup_timeout_ms
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}:{}/health", self.host, self.port)
    }
}

/// Serializable view of the runtime, consumed by the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeSnapshot {
    /// Current lifecycle phase.
    pub state: RuntimePhase,
    pub binary_present: bool,
    pub binary_path: String,
    pub pid: Option<u32>,
    /// Milliseconds since the Unix epoch, set when the process was spawned.
    pub started_at: Option<u64>,
    pub last_error: Option<String>,
    pub host: String,
    pub port: u16,
    pub endpoint: String,
}

#[derive(Debug)]
struct RuntimeInner {
    phase: RuntimePhase,
    pid: Option<u32>,
    started_at: Option<u64>,
    last_error: Option<String>,
}

/// Owns the lifecycle of the local AI runtime.
///
/// Every public method takes `&self` and locks internally, so the manager can be
/// shared as Tauri state. All operations are synchronous and cheap (a mutex plus
/// at most one filesystem stat), so no lock is ever held across an await and the
/// UI thread is not blocked on I/O.
pub struct LocalAiRuntimeManager {
    config: RuntimeConfig,
    process: Box<dyn ProcessBackend>,
    health: Box<dyn HealthProbe>,
    clock: Box<dyn Clock>,
    inner: Mutex<RuntimeInner>,
}

impl LocalAiRuntimeManager {
    pub fn new(
        config: RuntimeConfig,
        process: Box<dyn ProcessBackend>,
        health: Box<dyn HealthProbe>,
        clock: Box<dyn Clock>,
    ) -> Self {
        let phase = if process.binary_present() {
            RuntimePhase::Stopped
        } else {
            RuntimePhase::Unavailable
        };

        Self {
            config,
            process,
            health,
            clock,
            inner: Mutex::new(RuntimeInner {
                phase,
                pid: None,
                started_at: None,
                last_error: None,
            }),
        }
    }

    /// A poisoned lock must not take the application down: the runtime is
    /// optional, gameplay continues without it.
    fn lock(&self) -> MutexGuard<'_, RuntimeInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Idle phase implied by the binary being on disk or not.
    fn idle_phase(&self) -> RuntimePhase {
        if self.process.binary_present() {
            RuntimePhase::Stopped
        } else {
            RuntimePhase::Unavailable
        }
    }

    fn build_snapshot(&self, inner: &RuntimeInner) -> LocalAiRuntimeSnapshot {
        LocalAiRuntimeSnapshot {
            state: inner.phase,
            binary_present: self.process.binary_present(),
            binary_path: self.process.binary_path().to_string_lossy().into_owned(),
            pid: inner.pid,
            started_at: inner.started_at,
            last_error: inner.last_error.clone(),
            host: self.config.host().to_string(),
            port: self.config.port(),
            endpoint: self.config.endpoint(),
        }
    }

    fn fail(&self, inner: &mut RuntimeInner, reason: String) {
        inner.phase = RuntimePhase::Failed;
        inner.pid = None;
        inner.started_at = None;
        inner.last_error = Some(reason);
    }

    /// Whether a runtime that is still coming up has exhausted its grace period.
    fn startup_expired(&self, inner: &RuntimeInner) -> bool {
        match inner.started_at {
            Some(started_at) => {
                self.clock.now_ms().saturating_sub(started_at) > self.config.startup_timeout_ms()
            }
            None => false,
        }
    }

    /// Current snapshot without advancing the state machine. While idle the
    /// phase is recomputed, so a binary that appears (or disappears) between
    /// calls is reflected without a restart.
    ///
    /// The shipped binary reaches the same information through [`Self::poll`];
    /// this pure read exists for callers that must not cause a transition, which
    /// is what P0.3-B's background watcher will need once it owns polling.
    #[allow(dead_code)]
    pub fn snapshot(&self) -> LocalAiRuntimeSnapshot {
        let mut inner = self.lock();
        if matches!(inner.phase, RuntimePhase::Unavailable | RuntimePhase::Stopped) {
            inner.phase = self.idle_phase();
        }
        self.build_snapshot(&inner)
    }

    /// Request a start.
    ///
    /// Refuses to start a second instance, and never reports success when the
    /// binary is missing or the spawn fails.
    pub fn start(&self) -> Result<LocalAiRuntimeSnapshot, String> {
        let mut inner = self.lock();

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

        if !self.process.binary_present() {
            let reason = format!(
                "llama-server binary not found at {}",
                self.process.binary_path().display()
            );
            inner.phase = RuntimePhase::Unavailable;
            inner.pid = None;
            inner.started_at = None;
            inner.last_error = Some(reason.clone());
            return Err(reason);
        }

        match self.process.spawn(self.config.host(), self.config.port()) {
            Ok(pid) => {
                inner.phase = RuntimePhase::Starting;
                inner.pid = Some(pid);
                inner.started_at = Some(self.clock.now_ms());
                inner.last_error = None;
                Ok(self.build_snapshot(&inner))
            }
            Err(error) => {
                self.fail(&mut inner, error.clone());
                Err(error)
            }
        }
    }

    /// Advance the state machine by one `/health` observation.
    ///
    /// Only meaningful while starting, loading or ready; in any other phase it
    /// is a pure read.
    pub fn poll(&self) -> LocalAiRuntimeSnapshot {
        let mut inner = self.lock();

        if !matches!(
            inner.phase,
            RuntimePhase::Starting | RuntimePhase::Loading | RuntimePhase::Ready
        ) {
            return self.build_snapshot(&inner);
        }

        // A dead process outranks whatever /health would say.
        if let Some(pid) = inner.pid {
            if !self.process.is_running(pid) {
                self.fail(
                    &mut inner,
                    format!("local AI runtime process {pid} exited unexpectedly"),
                );
                return self.build_snapshot(&inner);
            }
        }

        let was_ready = inner.phase == RuntimePhase::Ready;

        match self.health.poll(&self.config.endpoint()) {
            HealthOutcome::Ready => {
                inner.phase = RuntimePhase::Ready;
                inner.last_error = None;
            }
            HealthOutcome::Loading => {
                if self.startup_expired(&inner) {
                    self.fail(
                        &mut inner,
                        format!(
                            "local AI runtime was still loading after {} ms",
                            self.config.startup_timeout_ms()
                        ),
                    );
                } else {
                    inner.phase = RuntimePhase::Loading;
                }
            }
            // Silence during startup is normal until the grace period expires;
            // silence after Ready means we lost the runtime.
            HealthOutcome::ConnectionRefused => {
                if was_ready {
                    self.fail(
                        &mut inner,
                        "local AI runtime refused the connection after becoming ready".to_string(),
                    );
                } else if self.startup_expired(&inner) {
                    self.fail(
                        &mut inner,
                        format!(
                            "local AI runtime did not accept connections within {} ms",
                            self.config.startup_timeout_ms()
                        ),
                    );
                }
            }
            HealthOutcome::Timeout => {
                if was_ready || self.startup_expired(&inner) {
                    self.fail(
                        &mut inner,
                        format!(
                            "local AI runtime health check timed out after {} ms",
                            self.config.startup_timeout_ms()
                        ),
                    );
                }
            }
            HealthOutcome::Malformed(detail) => {
                self.fail(
                    &mut inner,
                    format!("local AI runtime returned an unreadable health payload: {detail}"),
                );
            }
            HealthOutcome::UnexpectedStatus(status) => {
                self.fail(
                    &mut inner,
                    format!("local AI runtime returned unexpected health status {status}"),
                );
            }
        }

        self.build_snapshot(&inner)
    }

    /// Stop the runtime. Idempotent: stopping an idle runtime does nothing and
    /// is not an error, which is what makes it safe to call on app shutdown.
    pub fn stop(&self) -> LocalAiRuntimeSnapshot {
        let mut inner = self.lock();

        if matches!(inner.phase, RuntimePhase::Unavailable | RuntimePhase::Stopped) {
            inner.phase = self.idle_phase();
            inner.pid = None;
            inner.started_at = None;
            return self.build_snapshot(&inner);
        }

        inner.phase = RuntimePhase::Stopping;
        inner.last_error = None;

        if let Some(pid) = inner.pid {
            if let Err(error) = self.process.kill(pid) {
                inner.last_error = Some(format!("failed to stop process {pid}: {error}"));
            }
        }

        inner.pid = None;
        inner.started_at = None;
        inner.phase = self.idle_phase();
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

    fn spawn(&self, _host: &str, _port: u16) -> Result<u32, String> {
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
    use std::sync::Mutex as StdMutex;

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
    }

    impl ProcessBackend for FakeProcess {
        fn binary_present(&self) -> bool {
            *self.binary_present.lock().unwrap()
        }

        fn binary_path(&self) -> &Path {
            &self.path
        }

        fn spawn(&self, host: &str, _port: u16) -> Result<u32, String> {
            assert_eq!(host, LOOPBACK_HOST, "spawn must only ever be told loopback");
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

    use std::sync::Arc;

    fn manager_with(
        process: Arc<FakeProcess>,
        health: Vec<HealthOutcome>,
        clock: Arc<FakeClock>,
    ) -> LocalAiRuntimeManager {
        struct SharedProcess(Arc<FakeProcess>);
        impl ProcessBackend for SharedProcess {
            fn binary_present(&self) -> bool {
                self.0.binary_present()
            }
            fn binary_path(&self) -> &Path {
                self.0.binary_path()
            }
            fn spawn(&self, host: &str, port: u16) -> Result<u32, String> {
                self.0.spawn(host, port)
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
        let process = Arc::new(FakeProcess::present());
        let clock = Arc::new(FakeClock::new());
        let manager = manager_with(
            process,
            vec![HealthOutcome::Ready, HealthOutcome::ConnectionRefused],
            clock,
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Ready);

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert!(snapshot.last_error.unwrap().contains("after becoming ready"));
    }

    #[test]
    fn process_crash_fails_the_runtime() {
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
        assert_eq!(snapshot.pid, None, "a dead PID must not linger");
        assert!(snapshot.last_error.unwrap().contains("exited unexpectedly"));
    }

    #[test]
    fn spawn_failure_fails_the_runtime() {
        let process = Arc::new(FakeProcess::present());
        *process.spawn_error.lock().unwrap() = Some("permission denied".to_string());
        let manager = manager_with(process, vec![HealthOutcome::Ready], Arc::new(FakeClock::new()));

        let error = manager.start().expect_err("spawn failure must surface");
        assert!(error.contains("permission denied"));

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(snapshot.pid, None);
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
        assert_eq!(*process.kill_calls.lock().unwrap(), 1, "the process must be killed once");
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
            *process.kill_calls.lock().unwrap(),
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
        assert_eq!(*process.kill_calls.lock().unwrap(), 0);
    }

    #[test]
    fn failed_runtime_can_be_restarted() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Malformed("boom".to_string())],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Failed);

        let snapshot = manager.start().expect("restart after failure must be allowed");
        assert_eq!(snapshot.state, RuntimePhase::Starting);
        assert_eq!(snapshot.last_error, None, "a restart clears the previous error");
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
    fn non_loopback_hosts_are_rejected() {
        for host in ["0.0.0.0", "192.168.1.10", "localhost", "::1", ""] {
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
            "pid",
            "startedAt",
            "lastError",
            "host",
            "port",
            "endpoint",
        ] {
            assert!(json.get(key).is_some(), "snapshot is missing '{key}'");
        }
        assert_eq!(json["state"], "unavailable");
        assert_eq!(json["host"], LOOPBACK_HOST);
    }

    #[test]
    fn shipped_backend_refuses_to_fake_a_successful_spawn() {
        let backend = SystemProcessBackend::new(PathBuf::from("/definitely/not/here/llama-server"));
        assert!(!backend.binary_present());
        let error = backend
            .spawn(LOOPBACK_HOST, DEFAULT_PORT)
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
            assert_eq!(handle.join().expect("thread must not panic"), RuntimePhase::Unavailable);
        }
    }

    #[test]
    fn concurrent_starts_produce_exactly_one_running_instance() {
        let manager = Arc::new(manager_with(
            Arc::new(FakeProcess::present()),
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
}
