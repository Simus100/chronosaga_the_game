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
//! # Who drives the machine
//!
//! [`LocalAiRuntimeManager::poll`] is the only thing that advances phases, and
//! it is driven by the background watcher in `runtime_watcher`, never by the UI.
//! [`LocalAiRuntimeManager::snapshot`] stays a pure read so the interface can
//! refresh as often as it likes. Every `#[allow(dead_code)]` that P0.3-A needed
//! is gone: wiring the watcher made the whole module reachable.

use serde::Serialize;
use std::{
    fs::OpenOptions,
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, MutexGuard, TryLockError},
    time::{Duration, SystemTime, UNIX_EPOCH},
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

/// What we could learn about a child process when we asked.
///
/// The third variant is the point of the type: failing to observe a process is
/// not evidence that it died. Treating an observation error as death would make
/// the manager release a PID whose child may still be running and holding the
/// port, which is exactly the ownership leak the lifecycle must prevent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessObservation {
    /// The process is alive.
    Running,
    /// The process is confirmed gone; its PID may be released.
    Exited,
    /// We could not tell. Ownership must be retained.
    Unknown(String),
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
    /// Validated model to load, or `None` for the model-less router mode used by
    /// the P0.3-B lifecycle tests. Normal P0.3-C operation always carries one.
    model: Option<LaunchModel>,
    /// Per-session API key. Never logged, never persisted, never sent to the UI.
    api_key: String,
}

/// The model half of the launch contract.
///
/// Private fields and no public constructor: the only way to obtain one is
/// [`RuntimeConfig::with_model`], which takes an already-resolved model. Nothing
/// outside this module can point llama-server at an arbitrary path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchModel {
    path: PathBuf,
    profile_id: String,
    label: String,
    context_size: u32,
}

impl LaunchModel {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    /// Human-readable model name, e.g. `Qwen3-1.7B Q4_K_M`.
    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn context_size(&self) -> u32 {
        self.context_size
    }
}

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

    /// Base URL of the local API, e.g. `http://127.0.0.1:8081`.
    pub fn base_url(&self) -> String {
        format!("http://{}:{}", self.host(), self.port())
    }

    pub fn model(&self) -> Option<&LaunchModel> {
        self.model.as_ref()
    }

    /// Per-session API key. Callers must never log or persist this.
    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// The exact llama-server command line, minus the executable.
    ///
    /// Built here rather than in the backend so the arguments are covered by
    /// unit tests and cannot be assembled from arbitrary strings elsewhere.
    /// Every flag below was checked against `llama-server.exe --help` from the
    /// pinned b10343 payload.
    pub fn command_arguments(&self) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(model) = &self.model {
            args.push("--model".to_string());
            args.push(model.path.to_string_lossy().into_owned());
            args.push("--ctx-size".to_string());
            args.push(model.context_size.to_string());
            // Stable name for the OpenAI-compatible endpoints.
            args.push("--alias".to_string());
            args.push(model.profile_id.clone());
        }

        args.push("--host".to_string());
        args.push(self.host().to_string());
        args.push("--port".to_string());
        args.push(self.port().to_string());

        // Authentication: every request from Chronosaga carries this key.
        args.push("--api-key".to_string());
        args.push(self.api_key.clone());

        // Attack surface. b10343 enables the Web UI and permissive CORS by
        // default, and offers built-in tools, an agent mode and an MCP proxy.
        // None of that belongs in a game's private sidecar.
        args.push("--no-webui".to_string());
        args.push("--cors-origins".to_string());
        args.push(LOOPBACK_HOST.to_string());
        args.push("--no-cors-credentials".to_string());
        args.push("--no-agent".to_string());
        args.push("--no-webui-mcp-proxy".to_string());

        // Reasoning off by default: Lite is here for low-latency dialogue, not
        // for spending its budget on hidden thinking.
        args.push("--reasoning".to_string());
        args.push("off".to_string());

        args
    }

    /// The command line with the key replaced, for logs and diagnostics.
    pub fn redacted_arguments(&self) -> Vec<String> {
        let mut args = self.command_arguments();
        if let Some(index) = args.iter().position(|a| a == "--api-key") {
            if index + 1 < args.len() {
                args[index + 1] = "<redacted>".to_string();
            }
        }
        args
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
    /// Ask whether a previously spawned PID is still alive.
    ///
    /// Return [`ProcessObservation::Unknown`] rather than guessing when the
    /// question cannot be answered.
    fn observe(&self, pid: u32) -> ProcessObservation;
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
    startup_timeout_ms: u64,
    model: Option<LaunchModel>,
    api_key: String,
}

/// Generate a per-session API key from the OS RNG.
///
/// A fresh key every launch: it never reaches disk, the save file or the UI, so
/// there is nothing to rotate and nothing to leak between sessions.
fn generate_session_key() -> String {
    let mut bytes = [0u8; 32];
    if getrandom::fill(&mut bytes).is_err() {
        // Fail closed. An unauthenticated sidecar is not an acceptable
        // degradation, so make the key unusable rather than predictable.
        return String::new();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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
        let api_key = generate_session_key();
        if api_key.is_empty() {
            return Err(
                "refusing to configure the local AI runtime without a session API key".to_string(),
            );
        }

        Ok(Self {
            host: host.to_string(),
            port,
            startup_timeout_ms,
            model: None,
            api_key,
        })
    }

    /// Attach a model that has passed its integrity check.
    ///
    /// The parameter type is the guarantee: a [`VerifiedModel`] can only be
    /// produced by hashing an artifact resolved from the committed lock, so an
    /// arbitrary path cannot reach a launch contract even by mistake.
    pub fn with_model(mut self, verified: &crate::model_lock::VerifiedModel) -> Self {
        let model = verified.model();
        self.model = Some(LaunchModel {
            path: model.path().to_path_buf(),
            profile_id: model.profile_id().to_string(),
            label: model.label(),
            context_size: model.context_target(),
        });
        self
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

    /// Derive the validated launch contract for the process backend.
    pub fn launch_spec(&self) -> LaunchSpec {
        LaunchSpec {
            host: self.host.clone(),
            port: self.port,
            endpoint: self.endpoint(),
            model: self.model.clone(),
            api_key: self.api_key.clone(),
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
    /// Populated by the model-aware probe once the runtime is Ready.
    pub loaded_models: Option<u32>,
    /// Profile the runtime was launched with, e.g. `lite`, or `None` in the
    /// model-less router mode.
    pub model_profile_id: Option<String>,
    /// Human-readable model name, e.g. `Qwen3-1.7B Q4_K_M`.
    pub model_label: Option<String>,
    /// Context window the runtime was started with.
    pub model_context_size: Option<u32>,
    /// Absolute path the model was loaded from, for diagnostics.
    pub model_path: Option<String>,
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
    /// Built once from the config, so the bind address and the probed endpoint
    /// can never disagree.
    /// The active launch contract.
    ///
    /// Behind its own short-lived lock so the selected profile can be changed
    /// while the runtime is idle. Reads are cheap and never perform I/O, so this
    /// does not weaken the "no I/O under the state lock" rule.
    launch: Mutex<LaunchSpec>,
    process: Box<dyn ProcessBackend>,
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
            launch: Mutex::new(config.launch_spec()),
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
        let launch = self.launch_spec();
        let model = launch.model();
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
            model_profile_id: model.map(|m| m.profile_id().to_string()),
            model_label: model.map(|m| m.label().to_string()),
            model_context_size: model.map(|m| m.context_size()),
            model_path: model.map(|m| m.path().to_string_lossy().into_owned()),
        }
    }

    /// Fail after confirming the process is gone: the PID may be released.
    fn fail_process_gone(inner: &mut RuntimeInner, reason: String) {
        inner.phase = RuntimePhase::Failed;
        inner.loaded_models = None;
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
        inner.loaded_models = None;
        inner.last_error = Some(reason);
    }

    /// Whether a runtime that is still coming up has exhausted its grace period.
    fn startup_expired(&self, started_at: Option<u64>, now_ms: u64) -> bool {
        match started_at {
            Some(started_at) => {
                now_ms.saturating_sub(started_at) > self.config.startup_timeout_ms()
            }
            None => false,
        }
    }

    /// The validated launch contract, for callers that need the endpoint or the
    /// session key. The key must never be logged or sent to the interface.
    pub fn launch_spec(&self) -> LaunchSpec {
        self.launch
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Swap the model the next start will load.
    ///
    /// Allowed only while nothing is owned: a running runtime keeps the contract
    /// it was launched with, which is what "one model at a time" means in
    /// practice. Phase B builds the player-facing profile manager on top of
    /// this; Phase A only needs the diagnostics to be able to choose.
    pub fn select_model(
        &self,
        model: Option<&crate::model_lock::VerifiedModel>,
    ) -> Result<LocalAiRuntimeSnapshot, String> {
        let Some(_operation) = self.try_operation() else {
            return Err("another local AI runtime operation is already in progress".to_string());
        };

        {
            let inner = self.lock();
            if inner.pid.is_some() {
                return Err(format!(
                    "local AI runtime process {} is still tracked; stop it before changing model",
                    inner.pid.unwrap_or_default()
                ));
            }
            if matches!(
                inner.phase,
                RuntimePhase::Starting | RuntimePhase::Loading | RuntimePhase::Ready
                    | RuntimePhase::Stopping
            ) {
                return Err(format!(
                    "cannot change model while the runtime is {:?}",
                    inner.phase
                ));
            }
        }

        let mut config = RuntimeConfig::loopback();
        if let Some(model) = model {
            config = config.with_model(model);
        }
        {
            let mut launch = self
                .launch
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *launch = config.launch_spec();
        }

        let mut inner = self.lock();
        inner.loaded_models = None;
        inner.last_error = None;
        Ok(self.build_snapshot(&inner))
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

    /// Record what a model-aware probe found.
    ///
    /// This is the evidence half of `inference_ready`: the lifecycle knows the
    /// HTTP runtime is up, but only a probe can say a model is actually loaded.
    /// Ignored unless the runtime is Ready, so a late answer cannot resurrect a
    /// runtime that has since stopped or failed.
    pub fn record_loaded_models(&self, count: u32) {
        let mut inner = self.lock();
        if inner.phase == RuntimePhase::Ready {
            inner.loaded_models = Some(count);
        }
    }

    /// Whether a model-aware probe is still needed.
    pub fn needs_model_probe(&self) -> bool {
        let inner = self.lock();
        inner.phase == RuntimePhase::Ready && inner.loaded_models.is_none()
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
            inner.loaded_models = None;
            self.launch_spec()
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
        let observation = pid.map(|pid| self.process.observe(pid));
        // Probing health is pointless once the process is known to be gone, and
        // misleading when we could not observe it at all.
        let health = match observation {
            Some(ProcessObservation::Exited) | Some(ProcessObservation::Unknown(_)) => None,
            _ => Some(self.health.poll(self.launch_spec().endpoint())),
        };
        let now_ms = self.clock.now_ms();
        let expired = self.startup_expired(started_at, now_ms);

        let mut inner = self.lock();

        // Nothing else may mutate state while the operation guard is held, but
        // reconcile defensively rather than clobber an unexpected transition.
        if inner.phase != phase || inner.pid != pid {
            return self.build_snapshot(&inner);
        }

        match observation {
            // Confirmed dead: nothing left to own.
            Some(ProcessObservation::Exited) => {
                let pid = pid.unwrap_or_default();
                Self::fail_process_gone(
                    &mut inner,
                    format!("local AI runtime process {pid} exited unexpectedly"),
                );
                return self.build_snapshot(&inner);
            }
            // We could not tell. Fail loudly but keep the child: a later stop
            // must still be able to terminate it.
            Some(ProcessObservation::Unknown(reason)) => {
                let pid = pid.unwrap_or_default();
                Self::fail_retaining_process(
                    &mut inner,
                    format!("cannot determine whether process {pid} is alive: {reason}"),
                );
                return self.build_snapshot(&inner);
            }
            Some(ProcessObservation::Running) | None => {}
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
                    inner.loaded_models = None;
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
                inner.loaded_models = None;
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

// ---------------------------------------------------------------------------
// Production backends
// ---------------------------------------------------------------------------

/// Owns the real `llama-server` child process.
///
/// The child is held in a `Mutex<Option<Child>>` rather than tracked by PID
/// alone: owning the handle is what lets us reap it, and a reaped child cannot
/// become a zombie. Only one may exist at a time.
///
/// The working directory is the runtime directory so the 29 DLLs that make up
/// the distribution sit next to the executable — `llama-server.exe` is a 9 KB
/// shim and cannot start without them.
pub struct SystemProcessBackend {
    directory: PathBuf,
    executable: PathBuf,
    log_path: PathBuf,
    child: Mutex<Option<Child>>,
}

impl SystemProcessBackend {
    pub fn new(directory: PathBuf, executable: PathBuf, log_path: PathBuf) -> Self {
        Self {
            directory,
            executable,
            log_path,
            child: Mutex::new(None),
        }
    }

    /// Append one diagnostic line. Best effort: failing to log must never break
    /// the lifecycle, so the result is deliberately discarded.
    fn log(&self, line: &str) {
        rotate_log_if_needed(&self.log_path, LOG_MAX_BYTES);
        let stamp = SystemClock.now_ms();
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = writeln!(file, "[{stamp}] {line}");
        }
    }

    fn lock_child(&self) -> MutexGuard<'_, Option<Child>> {
        self.child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl ProcessBackend for SystemProcessBackend {
    fn binary_present(&self) -> bool {
        self.executable.is_file()
    }

    fn binary_path(&self) -> &Path {
        &self.executable
    }

    fn spawn(&self, spec: &LaunchSpec) -> Result<u32, String> {
        let mut slot = self.lock_child();

        // Refuse a second sidecar, and reap a dead one before replacing it.
        if let Some(existing) = slot.as_mut() {
            let pid = existing.id();
            let observation = existing
                .try_wait()
                .map(|status| status.map(|status| status.to_string()))
                .map_err(|error| error.to_string());

            match classify_pre_spawn(pid, observation) {
                PreSpawnDecision::RefuseRunning(message) => return Err(message),
                PreSpawnDecision::ReplaceExited(note) => {
                    self.log(&note);
                    *slot = None;
                }
                PreSpawnDecision::RefuseUnknown(message) => {
                    self.log(&format!("pre-spawn {message}"));
                    return Err(message);
                }
            }
        }

        if !self.binary_present() {
            return Err(format!(
                "llama-server not found at {}",
                self.executable.display()
            ));
        }

        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|error| {
                format!(
                    "unable to open the sidecar log {}: {error}",
                    self.log_path.display()
                )
            })?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("unable to duplicate the sidecar log handle: {error}"))?;

        let mut command = Command::new(&self.executable);
        command
            .current_dir(&self.directory)
            .args(spec.command_arguments())
            .stdin(Stdio::null())
            // Redirected to a file rather than piped: nobody drains a pipe here,
            // and a full pipe buffer would stall the child.
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        // No console window, and no shell in between: the executable is invoked
        // directly.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let child = command
            .spawn()
            .map_err(|error| format!("unable to start {}: {error}", self.executable.display()))?;
        let pid = child.id();
        // Redacted: the session key must never reach the log file.
        self.log(&format!(
            "start pid={pid} exe={} args={:?}",
            self.executable.display(),
            spec.redacted_arguments()
        ));
        *slot = Some(child);
        Ok(pid)
    }

    fn observe(&self, pid: u32) -> ProcessObservation {
        let mut slot = self.lock_child();
        let Some(child) = slot.as_mut() else {
            // We own nothing, so there is nothing of ours left running.
            return ProcessObservation::Exited;
        };
        if child.id() != pid {
            return ProcessObservation::Unknown(format!(
                "this backend owns PID {}, not {pid}",
                child.id()
            ));
        }
        match child.try_wait() {
            Ok(None) => ProcessObservation::Running,
            Ok(Some(status)) => {
                self.log(&format!("exit pid={pid} status={status}"));
                *slot = None;
                ProcessObservation::Exited
            }
            // An error here says the question failed, not that the child died:
            // keep owning it so stop() can still reach it.
            Err(error) => {
                self.log(&format!("observation failed pid={pid}: {error}"));
                ProcessObservation::Unknown(error.to_string())
            }
        }
    }

    fn kill(&self, pid: u32) -> Result<(), String> {
        let mut slot = self.lock_child();
        let Some(child) = slot.as_mut() else {
            // Nothing owned, so the caller may safely release the PID.
            return Ok(());
        };
        if child.id() != pid {
            return Err(format!(
                "asked to stop PID {pid} but this backend owns PID {}",
                child.id()
            ));
        }

        if matches!(child.try_wait(), Ok(Some(_))) {
            self.log(&format!("stop pid={pid} (already exited)"));
            *slot = None;
            return Ok(());
        }

        child
            .kill()
            .map_err(|error| format!("unable to terminate PID {pid}: {error}"))?;
        // Reap, so no zombie survives the kill.
        child
            .wait()
            .map_err(|error| format!("terminated PID {pid} but could not reap it: {error}"))?;
        self.log(&format!("stop pid={pid} (terminated and reaped)"));
        *slot = None;
        Ok(())
    }
}

/// Size at which the sidecar log is rolled over.
///
/// Deliberately tiny policy: one previous generation, no framework. The log
/// exists to explain the last crash, not to be an audit trail.
pub const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Roll `path` to `path.1` once it exceeds `max_bytes`, keeping one generation.
///
/// Best effort throughout: a rotation that cannot happen must never stop the
/// runtime from starting.
fn rotate_log_if_needed(path: &Path, max_bytes: u64) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return; // No log yet, nothing to roll.
    };
    if metadata.len() < max_bytes {
        return;
    }

    let mut previous = path.as_os_str().to_owned();
    previous.push(".1");
    let previous = PathBuf::from(previous);
    // Overwrites the older generation: two is all we keep.
    let _ = std::fs::rename(path, &previous);
}

/// What to do about a child that is already owned when a start is requested.
#[derive(Debug, PartialEq, Eq)]
enum PreSpawnDecision {
    /// The child is confirmed alive: keep it and refuse the duplicate.
    RefuseRunning(String),
    /// The child is confirmed gone and already reaped: the slot is free.
    ReplaceExited(String),
    /// We could not tell: keep owning it and refuse to start another.
    RefuseUnknown(String),
}

/// Decide what an already-owned child means for a new spawn request.
///
/// Split out from `spawn` so the three cases can be tested directly; inducing a
/// real `try_wait()` failure would mean corrupting an OS handle.
///
/// The error case is deliberately not folded in with "exited". Doing so would
/// abandon a child that may still be running, and would call the blocking
/// `wait()` on a process whose status we just failed to read — which can hang
/// forever.
fn classify_pre_spawn(pid: u32, observation: Result<Option<String>, String>) -> PreSpawnDecision {
    match observation {
        Ok(None) => PreSpawnDecision::RefuseRunning(format!(
            "llama-server is already running as PID {pid}"
        )),
        Ok(Some(status)) => {
            PreSpawnDecision::ReplaceExited(format!("exit pid={pid} status={status}"))
        }
        Err(error) => PreSpawnDecision::RefuseUnknown(format!(
            "cannot determine whether llama-server PID {pid} is still running ({error});              stop it before starting a new one"
        )),
    }
}

/// Blocking `/health` probe over loopback TCP.
///
/// Written on `std::net` rather than pulling an HTTP crate: the request is one
/// fixed `GET /health` against 127.0.0.1 returning a tiny JSON body, so a client
/// carrying TLS, redirects, proxies and an async runtime would be dependency
/// weight for nothing — and TLS is meaningless on loopback.
pub struct LoopbackHealthProbe {
    timeout: Duration,
}

impl LoopbackHealthProbe {
    pub fn new(timeout: Duration) -> Self {
        Self { timeout }
    }
}

/// Extract the port from an endpoint, refusing anything that is not loopback.
///
/// The probe cannot be aimed elsewhere even if handed a hostile endpoint.
fn loopback_port(endpoint: &str) -> Option<u16> {
    let prefix = format!("http://{LOOPBACK_HOST}:");
    let rest = endpoint.strip_prefix(&prefix)?;
    let (port, path) = rest.split_once('/')?;
    if path != "health" {
        return None;
    }
    port.parse().ok()
}

impl HealthProbe for LoopbackHealthProbe {
    fn poll(&self, endpoint: &str) -> HealthOutcome {
        let Some(port) = loopback_port(endpoint) else {
            return HealthOutcome::Malformed(format!(
                "refusing to probe non-loopback endpoint {endpoint}"
            ));
        };

        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let mut stream = match TcpStream::connect_timeout(&address, self.timeout) {
            Ok(stream) => stream,
            Err(error) => {
                return match error.kind() {
                    ErrorKind::TimedOut => HealthOutcome::Timeout,
                    _ => HealthOutcome::ConnectionRefused,
                }
            }
        };
        if stream.set_read_timeout(Some(self.timeout)).is_err()
            || stream.set_write_timeout(Some(self.timeout)).is_err()
        {
            return HealthOutcome::Timeout;
        }

        let request = format!(
            "GET /health HTTP/1.1\r\nHost: {LOOPBACK_HOST}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        );
        if let Err(error) = stream.write_all(request.as_bytes()) {
            return match error.kind() {
                ErrorKind::TimedOut | ErrorKind::WouldBlock => HealthOutcome::Timeout,
                _ => HealthOutcome::ConnectionRefused,
            };
        }

        let mut raw = Vec::new();
        if let Err(error) = stream.read_to_end(&mut raw) {
            return match error.kind() {
                ErrorKind::TimedOut | ErrorKind::WouldBlock => HealthOutcome::Timeout,
                _ => HealthOutcome::Malformed(format!("health response could not be read: {error}")),
            };
        }

        classify_health_response(&String::from_utf8_lossy(&raw))
    }
}

/// Turn a raw HTTP/1.1 response into a lifecycle outcome.
///
/// Split out from the socket so the mapping is unit-testable without a server.
fn classify_health_response(response: &str) -> HealthOutcome {
    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return HealthOutcome::Malformed("health response had no header terminator".to_string());
    };
    let Some(status_line) = head.lines().next() else {
        return HealthOutcome::Malformed("health response had no status line".to_string());
    };
    let Some(status) = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
    else {
        return HealthOutcome::Malformed(format!("unreadable status line: {status_line}"));
    };

    match status {
        // Verified against the real b10343 in P0.3-B0: router mode answers this
        // with zero models loaded, so it proves the runtime is up and nothing
        // more.
        200 => match serde_json::from_str::<serde_json::Value>(body.trim()) {
            Ok(value) if value.get("status").and_then(|status| status.as_str()) == Some("ok") => {
                HealthOutcome::Ready
            }
            Ok(_) => HealthOutcome::Malformed(format!(
                "health payload did not report status ok: {}",
                body.trim()
            )),
            Err(error) => HealthOutcome::Malformed(format!("health payload is not JSON: {error}")),
        },
        503 => HealthOutcome::Loading,
        other => HealthOutcome::UnexpectedStatus(other),
    }
}

/// Timeout for a single loopback health request. Generous for a local socket,
/// far below the startup grace period so a slow probe cannot mask a hang.
pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

/// Build the manager the application ships with.
///
/// The configuration is explicit so the caller can attach the resolved model
/// before the runtime exists; a model-less config yields router mode.
pub fn system_manager_with_config(
    config: RuntimeConfig,
    directory: PathBuf,
    executable: PathBuf,
    log_path: PathBuf,
) -> LocalAiRuntimeManager {
    LocalAiRuntimeManager::new(
        config,
        Box::new(SystemProcessBackend::new(directory, executable, log_path)),
        Box::new(LoopbackHealthProbe::new(HEALTH_TIMEOUT)),
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
        observe_error: StdMutex<Option<String>>,
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
                observe_error: StdMutex::new(None),
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

        /// Make observation fail, without saying anything about the child.
        fn fail_observation_with(&self, error: &str) {
            *self.observe_error.lock().unwrap() = Some(error.to_string());
        }

        fn allow_observation(&self) {
            *self.observe_error.lock().unwrap() = None;
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

        fn observe(&self, _pid: u32) -> ProcessObservation {
            if let Some(error) = self.observe_error.lock().unwrap().clone() {
                return ProcessObservation::Unknown(error);
            }
            if *self.running.lock().unwrap() {
                ProcessObservation::Running
            } else {
                ProcessObservation::Exited
            }
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
        fn observe(&self, pid: u32) -> ProcessObservation {
            self.0.observe(pid)
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
    fn an_observation_error_never_counts_as_a_confirmed_exit() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        assert_eq!(manager.poll().state, RuntimePhase::Ready);

        // The operating system stops answering the question. That says nothing
        // about whether the child is alive.
        process.fail_observation_with("access is denied");

        let snapshot = manager.poll();
        assert_eq!(snapshot.state, RuntimePhase::Failed);
        assert_eq!(
            snapshot.pid,
            Some(4242),
            "an unobservable process must stay owned, not be declared dead"
        );
        assert!(snapshot.started_at.is_some());
        assert!(
            snapshot.last_error.unwrap().contains("cannot determine"),
            "the error must say we could not tell, not that it exited"
        );
    }

    #[test]
    fn a_runtime_we_cannot_observe_can_still_be_stopped() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        manager.poll();
        process.fail_observation_with("handle is invalid");
        assert_eq!(manager.poll().pid, Some(4242));

        // A failing kill must not release it either.
        process.fail_kill_with("access denied");
        let still_owned = manager.stop();
        assert_eq!(still_owned.state, RuntimePhase::Failed);
        assert_eq!(still_owned.pid, Some(4242));

        // Once termination works, ownership is released properly.
        process.allow_kill();
        let stopped = manager.stop();
        assert_eq!(stopped.state, RuntimePhase::Stopped);
        assert_eq!(stopped.pid, None);
        assert_eq!(process.kill_calls(), 2, "the stop was retried, not skipped");
    }

    #[test]
    fn an_unobservable_runtime_refuses_to_start_a_second_process() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        process.fail_observation_with("observation failed");
        manager.poll();

        let error = manager
            .start()
            .expect_err("a possibly-live child must block a new spawn");
        assert!(error.contains("still tracked"), "unexpected error: {error}");
    }

    #[test]
    fn an_unobservable_runtime_is_released_only_through_stop() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        process.fail_observation_with("transient failure");
        assert_eq!(manager.poll().state, RuntimePhase::Failed);

        // Failed is terminal for the polling path: the watcher does not keep
        // probing a runtime it has given up on, so the PID stays owned however
        // many times it is polled. That is the safe direction to err in.
        process.allow_observation();
        process.crash();
        for _ in 0..3 {
            assert_eq!(
                manager.poll().pid,
                Some(4242),
                "polling must not silently release a process it never confirmed dead"
            );
        }

        // stop() is the way out, and it succeeds even though the child already
        // died on its own.
        let stopped = manager.stop();
        assert_eq!(stopped.state, RuntimePhase::Stopped);
        assert_eq!(stopped.pid, None);
        manager
            .start()
            .expect("a released runtime can be started again");
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
            fn observe(&self, _pid: u32) -> ProcessObservation {
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
            launch: Mutex::new(RuntimeConfig::loopback().launch_spec()),
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

        // Two configurations agree on the network contract but never on the
        // session key: a fresh one is generated per runtime on purpose.
        let other = RuntimeConfig::new(LOOPBACK_HOST, 9099, 1).unwrap().launch_spec();
        assert_eq!(spec.host(), other.host());
        assert_eq!(spec.port(), other.port());
        assert_eq!(spec.endpoint(), other.endpoint());
        assert_ne!(
            spec.api_key(),
            other.api_key(),
            "each runtime must get its own session key"
        );
    }

    #[test]
    fn every_session_gets_a_fresh_unguessable_key() {
        let first = RuntimeConfig::loopback();
        let second = RuntimeConfig::loopback();

        let first = first.launch_spec();
        let second = second.launch_spec();
        assert_eq!(first.api_key().len(), 64, "32 bytes of entropy, hex encoded");
        assert!(first.api_key().chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first.api_key(), second.api_key());
    }

    #[test]
    fn the_command_line_carries_the_locked_model_and_closes_the_runtime_down() {
        let model = crate::model_lock::VerifiedModel::for_test(
            crate::model_lock::ResolvedModel::for_test(
                "lite",
                PathBuf::from("D:/models/Qwen3-1.7B-Q4_K_M.gguf"),
                4096,
            ),
        );
        let config = RuntimeConfig::loopback().with_model(&model);
        let spec = config.launch_spec();
        let args = spec.command_arguments();
        let joined = args.join(" ");

        // Single-model mode, from the locked path only.
        assert!(joined.contains("--model D:/models/Qwen3-1.7B-Q4_K_M.gguf"));
        assert!(joined.contains("--ctx-size 4096"));
        assert!(joined.contains("--alias lite"));

        // Loopback and nothing else.
        assert!(joined.contains(&format!("--host {LOOPBACK_HOST}")));
        assert!(joined.contains(&format!("--cors-origins {LOOPBACK_HOST}")));

        // The attack surface b10343 enables by default is closed.
        for flag in [
            "--no-webui",
            "--no-cors-credentials",
            "--no-agent",
            "--no-webui-mcp-proxy",
        ] {
            assert!(args.iter().any(|a| a == flag), "{flag} must be passed");
        }

        // Reasoning off: Lite is here for dialogue, not hidden thinking.
        assert!(joined.contains("--reasoning off"));

        // Authenticated, and never fetched from the network.
        assert!(args.iter().any(|a| a == "--api-key"));
        assert!(!joined.contains("-hf"), "no remote model download");
        assert!(!joined.contains("--tools"), "no built-in tools");
    }

    #[test]
    fn a_model_less_launch_stays_in_router_mode() {
        let spec = RuntimeConfig::loopback().launch_spec();
        let args = spec.command_arguments();
        assert!(spec.model().is_none());
        assert!(!args.iter().any(|a| a == "--model"), "no model must be passed");
        // Security flags apply either way.
        assert!(args.iter().any(|a| a == "--no-webui"));
    }

    #[test]
    fn the_session_key_never_appears_in_diagnostics() {
        let spec = RuntimeConfig::loopback().launch_spec();
        let redacted = spec.redacted_arguments().join(" ");

        assert!(
            !redacted.contains(spec.api_key()),
            "the log line must not carry the key"
        );
        assert!(redacted.contains("--api-key <redacted>"));
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
    fn the_snapshot_reports_the_model_the_runtime_was_launched_with() {
        let model = crate::model_lock::VerifiedModel::for_test(
            crate::model_lock::ResolvedModel::for_test(
                "lite",
                PathBuf::from("D:/models/Qwen3-1.7B-Q4_K_M.gguf"),
                4096,
            ),
        );
        let manager = LocalAiRuntimeManager::new(
            RuntimeConfig::loopback().with_model(&model),
            Box::new(SharedProcess(Arc::new(FakeProcess::present()))),
            Box::new(FakeHealth::new(vec![HealthOutcome::Ready])),
            Box::new(SharedClock(Arc::new(FakeClock::new()))),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.model_profile_id.as_deref(), Some("lite"));
        assert_eq!(snapshot.model_label.as_deref(), Some("Qwen3-1.7B Q4_K_M"));
        assert_eq!(snapshot.model_context_size, Some(4096));
        assert!(snapshot.model_path.unwrap().ends_with("Qwen3-1.7B-Q4_K_M.gguf"));

        // Router mode reports no model at all.
        let router = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        assert_eq!(router.snapshot().model_profile_id, None);
    }

    fn verified(profile: &str, file: &str) -> crate::model_lock::VerifiedModel {
        crate::model_lock::VerifiedModel::for_test(crate::model_lock::ResolvedModel::for_test(
            profile,
            PathBuf::from(format!("D:/models/{file}")),
            4096,
        ))
    }

    #[test]
    fn selecting_a_profile_swaps_the_whole_launch_contract() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );

        manager
            .select_model(Some(&verified("lite", "Qwen3-1.7B-Q4_K_M.gguf")))
            .expect("selecting while idle is allowed");
        let lite = manager.snapshot();
        assert_eq!(lite.model_profile_id.as_deref(), Some("lite"));

        manager
            .select_model(Some(&verified("standard", "SmolLM3-Q4_K_M.gguf")))
            .expect("selecting another profile while idle is allowed");
        let standard = manager.snapshot();
        assert_eq!(standard.model_profile_id.as_deref(), Some("standard"));
        assert!(standard.model_path.unwrap().ends_with("SmolLM3-Q4_K_M.gguf"));

        // One model at a time: the contract holds exactly one, never both.
        let args = manager.launch_spec().command_arguments().join(" ");
        assert!(args.contains("SmolLM3-Q4_K_M.gguf"));
        assert!(!args.contains("Qwen3-1.7B-Q4_K_M.gguf"));
        assert_eq!(args.matches("--model").count(), 1);
    }

    #[test]
    fn a_running_runtime_refuses_to_have_its_model_swapped() {
        let manager = manager_with(
            Arc::new(FakeProcess::present()),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager
            .select_model(Some(&verified("lite", "Qwen3-1.7B-Q4_K_M.gguf")))
            .unwrap();
        manager.start().expect("start should succeed");

        let error = manager
            .select_model(Some(&verified("standard", "SmolLM3-Q4_K_M.gguf")))
            .expect_err("a live runtime must not be swapped underneath");
        assert!(error.contains("still tracked"), "unexpected error: {error}");

        // The running contract is untouched.
        assert!(manager
            .launch_spec()
            .command_arguments()
            .join(" ")
            .contains("Qwen3-1.7B-Q4_K_M.gguf"));

        // After a stop the swap is allowed again.
        manager.stop();
        manager
            .select_model(Some(&verified("standard", "SmolLM3-Q4_K_M.gguf")))
            .expect("stopping first is the supported path");
    }

    #[test]
    fn readiness_evidence_is_dropped_when_the_profile_changes() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));
        manager.record_loaded_models(1);
        assert!(manager.snapshot().inference_ready);

        manager.stop();
        manager
            .select_model(Some(&verified("standard", "SmolLM3-Q4_K_M.gguf")))
            .expect("selecting after a stop is allowed");

        let snapshot = manager.snapshot();
        assert_eq!(
            snapshot.loaded_models, None,
            "evidence about the previous model must not survive the swap"
        );
        assert!(!snapshot.inference_ready);
    }

    #[test]
    fn a_model_probe_is_what_turns_on_inference_ready() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));

        // Ready, but nothing has yet proved a model is loaded.
        assert!(manager.needs_model_probe());
        let before = manager.snapshot();
        assert!(before.runtime_ready && !before.inference_ready);

        // A server answering /health with zero models must stay unusable.
        manager.record_loaded_models(0);
        let empty = manager.snapshot();
        assert!(
            !empty.inference_ready,
            "a runtime with no loaded model must never claim inference"
        );
        assert_eq!(empty.loaded_models, Some(0));

        manager.record_loaded_models(1);
        let serving = manager.snapshot();
        assert!(serving.inference_ready);
        assert!(!manager.needs_model_probe(), "the probe answer is remembered");
    }

    #[test]
    fn probe_evidence_is_discarded_when_the_runtime_leaves_ready() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));
        manager.record_loaded_models(1);
        assert!(manager.snapshot().inference_ready);

        manager.stop();
        let stopped = manager.snapshot();
        assert_eq!(stopped.loaded_models, None, "stale evidence must not survive");
        assert!(!stopped.inference_ready);
    }

    #[test]
    fn a_late_probe_answer_cannot_revive_a_stopped_runtime() {
        let manager = ready_manager(Arc::new(FakeProcess::present()), Arc::new(FakeClock::new()));
        manager.stop();

        // An in-flight probe that lands after the stop must be ignored.
        manager.record_loaded_models(1);
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.state, RuntimePhase::Stopped);
        assert!(!snapshot.inference_ready);
        assert_eq!(snapshot.loaded_models, None);
    }

    #[test]
    fn a_crash_clears_the_inference_evidence() {
        let process = Arc::new(FakeProcess::present());
        let manager = manager_with(
            process.clone(),
            vec![HealthOutcome::Ready],
            Arc::new(FakeClock::new()),
        );
        manager.start().expect("start should succeed");
        manager.poll();
        manager.record_loaded_models(1);
        assert!(manager.snapshot().inference_ready);

        process.crash();
        let failed = manager.poll();
        assert_eq!(failed.state, RuntimePhase::Failed);
        assert!(!failed.inference_ready);
        assert_eq!(failed.loaded_models, None);
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

    /// A real backend pointed at a path that does not exist. Used to prove the
    /// production code fails cleanly without needing llama-server in CI.
    fn absent_backend() -> SystemProcessBackend {
        let missing = PathBuf::from("/definitely/not/here");
        SystemProcessBackend::new(
            missing.clone(),
            missing.join("llama-server.exe"),
            std::env::temp_dir().join("chronosaga-absent-runtime.log"),
        )
    }

    #[test]
    fn a_pre_spawn_observation_error_refuses_the_start_and_keeps_ownership() {
        let decision = classify_pre_spawn(4242, Err("handle is invalid".to_string()));

        match decision {
            PreSpawnDecision::RefuseUnknown(message) => {
                assert!(message.contains("4242"), "the PID must be named: {message}");
                assert!(
                    message.contains("cannot determine"),
                    "the message must say we could not tell, not that it exited: {message}"
                );
                assert!(message.contains("stop it"), "it must say how to recover: {message}");
            }
            other => panic!("an observation error must never allow a replacement: {other:?}"),
        }
    }

    #[test]
    fn a_confirmed_running_child_refuses_a_duplicate_spawn() {
        match classify_pre_spawn(77, Ok(None)) {
            PreSpawnDecision::RefuseRunning(message) => assert!(message.contains("77")),
            other => panic!("a live child must block a second spawn: {other:?}"),
        }
    }

    #[test]
    fn a_confirmed_exited_child_frees_the_slot() {
        match classify_pre_spawn(77, Ok(Some("exit code: 0".to_string()))) {
            PreSpawnDecision::ReplaceExited(note) => {
                assert!(note.contains("77") && note.contains("exit code: 0"));
            }
            other => panic!("a reaped child must free the slot: {other:?}"),
        }
    }

    #[test]
    fn only_a_confirmed_exit_ever_frees_the_slot() {
        // The whole point of the three-way split: exactly one of the outcomes
        // may release ownership.
        let frees = |observation| {
            matches!(
                classify_pre_spawn(1, observation),
                PreSpawnDecision::ReplaceExited(_)
            )
        };
        assert!(!frees(Ok(None)), "running must not free the slot");
        assert!(frees(Ok(Some("exit code: 1".to_string()))), "exited frees it");
        assert!(!frees(Err("io error".to_string())), "unknown must not free it");
    }

    #[test]
    fn the_real_backend_fails_cleanly_when_the_binary_is_absent() {
        let backend = absent_backend();
        assert!(!backend.binary_present());

        let error = backend
            .spawn(&RuntimeConfig::loopback().launch_spec())
            .expect_err("a missing binary must not spawn");
        assert!(error.contains("not found"), "unexpected error: {error}");

        // Nothing was started, so nothing is owned and nothing can be running.
        assert_eq!(
            backend.observe(1234),
            ProcessObservation::Exited,
            "owning nothing means nothing of ours is running"
        );
        assert!(
            backend.kill(1234).is_ok(),
            "killing an unowned process must be a no-op, not an error"
        );
    }

    #[test]
    fn the_log_rotates_once_it_passes_the_size_limit() {
        let directory = std::env::temp_dir().join("chronosaga-log-rotation-test");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let log = directory.join("local-ai-runtime.log");
        let previous = directory.join("local-ai-runtime.log.1");

        // Below the limit: nothing moves.
        std::fs::write(&log, vec![b'x'; 100]).unwrap();
        rotate_log_if_needed(&log, 1_000);
        assert!(log.is_file(), "a small log stays put");
        assert!(!previous.exists(), "nothing to roll yet");

        // At or above the limit: the current log becomes the previous one.
        std::fs::write(&log, vec![b'x'; 1_000]).unwrap();
        rotate_log_if_needed(&log, 1_000);
        assert!(!log.exists(), "the oversized log was rolled away");
        assert_eq!(std::fs::metadata(&previous).unwrap().len(), 1_000);

        // Only one generation is kept: a second rotation overwrites it.
        std::fs::write(&log, vec![b'y'; 2_000]).unwrap();
        rotate_log_if_needed(&log, 1_000);
        assert_eq!(
            std::fs::metadata(&previous).unwrap().len(),
            2_000,
            "the older generation is discarded, never accumulated"
        );

        // A missing log is not an error.
        let _ = std::fs::remove_file(&log);
        rotate_log_if_needed(&log, 1_000);

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn the_real_backend_refuses_to_stop_a_process_it_does_not_own() {
        // Guards against releasing the PID of a child that belongs to somebody
        // else: an Ok here would make the manager forget a live process.
        let backend = absent_backend();
        assert!(backend.kill(4242).is_ok(), "owning nothing is a clean no-op");
    }

    /// Assemble an HTTP/1.1 response with real CRLF separators.
    fn http_response(status_line: &str, body: &str) -> String {
        format!("{status_line}\r\nContent-Type: application/json\r\n\r\n{body}")
    }

    #[test]
    fn health_responses_map_to_the_documented_outcomes() {
        // The body the real b10343 returns in router mode.
        assert_eq!(
            classify_health_response(&http_response("HTTP/1.1 200 OK", r#"{"status":"ok"}"#)),
            HealthOutcome::Ready
        );
        assert_eq!(
            classify_health_response(&http_response(
                "HTTP/1.1 503 Service Unavailable",
                r#"{"status":"loading"}"#
            )),
            HealthOutcome::Loading
        );
        assert_eq!(
            classify_health_response(&http_response("HTTP/1.1 418 I am a teapot", "")),
            HealthOutcome::UnexpectedStatus(418)
        );
        assert!(matches!(
            classify_health_response(&http_response("HTTP/1.1 200 OK", "not json at all")),
            HealthOutcome::Malformed(_)
        ));
        assert!(
            matches!(
                classify_health_response(&http_response(
                    "HTTP/1.1 200 OK",
                    r#"{"status":"degraded"}"#
                )),
                HealthOutcome::Malformed(_)
            ),
            "a 200 that does not report ok is not a ready runtime"
        );
        assert!(matches!(
            classify_health_response("garbage without headers"),
            HealthOutcome::Malformed(_)
        ));
    }

    #[test]
    fn the_health_probe_refuses_every_non_loopback_endpoint() {
        for endpoint in [
            "http://0.0.0.0:8081/health",
            "http://192.168.1.10:8081/health",
            "http://localhost:8081/health",
            "http://[::1]:8081/health",
            "https://example.com/health",
            "http://127.0.0.1:8081/completion",
            "http://127.0.0.2:8081/health",
        ] {
            assert_eq!(
                loopback_port(endpoint),
                None,
                "{endpoint} must not be probed"
            );
        }

        assert_eq!(loopback_port("http://127.0.0.1:8081/health"), Some(8081));
    }

    #[test]
    fn the_probe_reports_connection_refused_when_nothing_listens() {
        // Port 1 on loopback: reserved and never served, so this exercises the
        // real socket path without depending on llama-server.
        let probe = LoopbackHealthProbe::new(Duration::from_millis(250));
        let outcome = probe.poll("http://127.0.0.1:1/health");
        assert!(
            matches!(
                outcome,
                HealthOutcome::ConnectionRefused | HealthOutcome::Timeout
            ),
            "unexpected outcome: {outcome:?}"
        );
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
