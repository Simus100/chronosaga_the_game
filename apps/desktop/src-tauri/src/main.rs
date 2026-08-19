#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod inference;
mod local_ai_runtime;
mod model_lock;
mod runtime_lock;
mod runtime_watcher;

/// Opt-in lifecycle test against the real llama-server payload.
#[cfg(test)]
mod runtime_e2e;

use inference::{InferenceOutcome, LocalModelProvider};
use local_ai_runtime::{
    system_manager_with_config, LocalAiRuntimeManager, LocalAiRuntimeSnapshot, RuntimeConfig,
};
use runtime_watcher::RuntimeWatcher;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, System};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

const DATABASE_SCHEMA_VERSION: u32 = 1;
const DATABASE_FILE_NAME: &str = "chronosaga-p0.sqlite3";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    platform: String,
    os_name: String,
    os_version: String,
    kernel_version: String,
    arch: String,
    cpu_brand: String,
    logical_cores: usize,
    physical_cores: Option<usize>,
    total_ram_mb: u64,
    available_ram_mb: u64,
    free_storage_mb: Option<u64>,
    app_local_data_dir: String,
    gpu_probe_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    profiles: Vec<ModelProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelProfile {
    id: String,
    label: String,
    parameter_class: String,
    candidate_family: String,
    file: String,
    context_target: u32,
    planning: ModelPlanning,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPlanning {
    model_size_mb: ModelSizeMb,
    min_ram_mb: u64,
    recommended_ram_mb: u64,
    min_logical_cores: usize,
    gpu_required: bool,
    useful_vram_mb: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ModelSizeMb {
    min: u64,
    max: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProfileSummary {
    id: String,
    label: String,
    parameter_class: String,
    candidate_family: String,
    file: String,
    context_target: u32,
    model_size_min_mb: u64,
    model_size_max_mb: u64,
    min_ram_mb: u64,
    recommended_ram_mb: u64,
    min_logical_cores: usize,
    gpu_required: bool,
    useful_vram_mb: Option<u64>,
}

impl From<&ModelProfile> for ModelProfileSummary {
    fn from(profile: &ModelProfile) -> Self {
        Self {
            id: profile.id.clone(),
            label: profile.label.clone(),
            parameter_class: profile.parameter_class.clone(),
            candidate_family: profile.candidate_family.clone(),
            file: profile.file.clone(),
            context_target: profile.context_target,
            model_size_min_mb: profile.planning.model_size_mb.min,
            model_size_max_mb: profile.planning.model_size_mb.max,
            min_ram_mb: profile.planning.min_ram_mb,
            recommended_ram_mb: profile.planning.recommended_ram_mb,
            min_logical_cores: profile.planning.min_logical_cores,
            gpu_required: profile.planning.gpu_required,
            useful_vram_mb: profile.planning.useful_vram_mb,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    resource_dir: String,
    model_manifest_path: String,
    model_manifest_present: bool,
    llama_server_path: String,
    llama_server_present: bool,
    /// Where the runtime was resolved from, or why it could not be.
    llama_server_source: String,
    recommended_ai_profile: String,
    profiles: Vec<ModelProfileSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseStatus {
    ready: bool,
    path: String,
    schema_version: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SmokeCampaign {
    campaign_id: String,
    seed: i64,
    turn: u32,
    ai_profile: String,
    created_at: String,
    schema_version: u32,
}

fn as_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn app_local_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve app local data directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create app local data directory: {error}"))?;
    Ok(dir)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_dir(app)?.join(DATABASE_FILE_NAME))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(&path)
        .map_err(|error| format!("Unable to open SQLite database {}: {error}", as_string(&path)))?;

    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS metadata (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS campaign_smoke (
               campaign_id TEXT PRIMARY KEY NOT NULL,
               payload TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Unable to initialize SQLite schema: {error}"))?;

    connection
        .execute(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [DATABASE_SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| format!("Unable to store SQLite schema version: {error}"))?;

    Ok(connection)
}

/// Diagnostic log for the sidecar, next to the save database.
///
/// Kept out of the save file and out of Git: it exists to explain a crash or a
/// failed start, nothing more.
fn sidecar_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_dir(app)?.join("local-ai-runtime.log"))
}

fn manifest_path(app: &AppHandle) -> PathBuf {
    let bundled = app
        .path()
        .resolve("models/manifest.json", BaseDirectory::Resource)
        .ok();

    if let Some(path) = bundled {
        if path.exists() {
            return path;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../models/manifest.json")
}

fn load_manifest(app: &AppHandle) -> Result<Option<(PathBuf, ModelManifest)>, String> {
    let path = manifest_path(app);
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read model manifest {}: {error}", as_string(&path)))?;
    let manifest = serde_json::from_str::<ModelManifest>(&contents)
        .map_err(|error| format!("Unable to parse model manifest {}: {error}", as_string(&path)))?;
    Ok(Some((path, manifest)))
}

fn free_storage_mb(path: &Path) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().components().count())
        .map(|disk| disk.available_space() / 1024 / 1024)
}

fn collect_system_info(app: &AppHandle) -> Result<SystemInfo, String> {
    let mut system = System::new_all();
    system.refresh_all();
    let data_dir = app_local_data_dir(app)?;

    Ok(SystemInfo {
        platform: std::env::consts::OS.to_string(),
        os_name: System::name().unwrap_or_else(|| "Unknown".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        kernel_version: System::kernel_version().unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        cpu_brand: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string()),
        logical_cores: system.cpus().len(),
        physical_cores: System::physical_core_count(),
        total_ram_mb: system.total_memory() / 1024 / 1024,
        available_ram_mb: system.available_memory() / 1024 / 1024,
        free_storage_mb: free_storage_mb(&data_dir),
        app_local_data_dir: as_string(&data_dir),
        gpu_probe_status: "P0.1 baseline: GPU/VRAM detection is deferred to the acceleration benchmark stage."
            .to_string(),
    })
}

fn profile_fits(profile: &ModelProfile, system: &SystemInfo) -> bool {
    let storage_ok = system
        .free_storage_mb
        .map(|free| free >= profile.planning.model_size_mb.min)
        .unwrap_or(true);

    system.total_ram_mb >= profile.planning.min_ram_mb
        && system.logical_cores >= profile.planning.min_logical_cores
        && storage_ok
}

fn recommend_profile(profiles: &[ModelProfile], system: &SystemInfo) -> String {
    for id in ["standard", "lite"] {
        if profiles
            .iter()
            .find(|profile| profile.id == id)
            .is_some_and(|profile| profile_fits(profile, system))
        {
            return id.to_string();
        }
    }
    "procedural".to_string()
}

#[tauri::command]
fn get_system_info(app: AppHandle) -> Result<SystemInfo, String> {
    collect_system_info(&app)
}

#[tauri::command]
fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let system = collect_system_info(&app)?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve resource directory: {error}"))?;
    // One source of truth: exactly what the lifecycle manager resolves.
    let (llama_server_path, llama_server_present, llama_server_source) =
        match runtime_lock::resolve(&app) {
            Ok(runtime) => (
                as_string(&runtime.executable),
                true,
                runtime.source.label().to_string(),
            ),
            Err(reason) => (String::new(), false, reason),
        };

    let fallback_manifest_path = manifest_path(&app);
    let manifest = load_manifest(&app)?;
    let (manifest_path, profiles, recommended_ai_profile) = match manifest {
        Some((path, manifest)) => {
            let recommended = recommend_profile(&manifest.profiles, &system);
            let summaries = manifest
                .profiles
                .iter()
                .map(ModelProfileSummary::from)
                .collect();
            (path, summaries, recommended)
        }
        None => (fallback_manifest_path, Vec::new(), "procedural".to_string()),
    };

    Ok(RuntimeStatus {
        resource_dir: as_string(&resource_dir),
        model_manifest_present: manifest_path.exists(),
        model_manifest_path: as_string(&manifest_path),
        llama_server_present,
        llama_server_path,
        llama_server_source,
        recommended_ai_profile,
        profiles,
    })
}

#[tauri::command]
fn get_database_status(app: AppHandle) -> Result<DatabaseStatus, String> {
    let path = database_path(&app)?;
    let _connection = open_database(&app)?;
    Ok(DatabaseStatus {
        ready: true,
        path: as_string(&path),
        schema_version: DATABASE_SCHEMA_VERSION,
    })
}

fn validate_smoke_campaign(campaign: &SmokeCampaign) -> Result<(), String> {
    if campaign.campaign_id.trim().is_empty() {
        return Err("campaignId cannot be empty".to_string());
    }
    if !matches!(
        campaign.ai_profile.as_str(),
        "auto" | "lite" | "standard" | "procedural"
    ) {
        return Err("aiProfile must be auto, lite, standard or procedural".to_string());
    }
    if campaign.schema_version != DATABASE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported smoke save schema version {} (expected {})",
            campaign.schema_version, DATABASE_SCHEMA_VERSION
        ));
    }
    Ok(())
}

#[tauri::command]
fn save_smoke_campaign(app: AppHandle, campaign: SmokeCampaign) -> Result<SmokeCampaign, String> {
    validate_smoke_campaign(&campaign)?;
    let connection = open_database(&app)?;
    let payload = serde_json::to_string(&campaign)
        .map_err(|error| format!("Unable to serialize smoke campaign: {error}"))?;
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    connection
        .execute(
            "INSERT INTO campaign_smoke(campaign_id, payload, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(campaign_id) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![campaign.campaign_id, payload, updated_at],
        )
        .map_err(|error| format!("Unable to save smoke campaign: {error}"))?;

    Ok(campaign)
}

#[tauri::command]
fn load_smoke_campaign(app: AppHandle, campaign_id: String) -> Result<Option<SmokeCampaign>, String> {
    let connection = open_database(&app)?;
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM campaign_smoke WHERE campaign_id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Unable to load smoke campaign: {error}"))?;

    payload
        .map(|json| {
            serde_json::from_str::<SmokeCampaign>(&json)
                .map_err(|error| format!("Unable to parse stored smoke campaign: {error}"))
        })
        .transpose()
}

/// Shared handle to the local AI runtime lifecycle manager.
type LocalAiRuntimeState = Arc<LocalAiRuntimeManager>;

/// Current runtime status.
///
/// A pure read: it never advances the state machine and performs no filesystem
/// or network access, so the UI may poll it freely. Driving the machine forward
/// is the job of P0.3-B's background watcher.
#[tauri::command]
fn get_local_ai_runtime_status(runtime: State<'_, LocalAiRuntimeState>) -> LocalAiRuntimeSnapshot {
    runtime.snapshot()
}

#[tauri::command]
fn start_local_ai_runtime(
    runtime: State<'_, LocalAiRuntimeState>,
) -> Result<LocalAiRuntimeSnapshot, String> {
    runtime.start()
}

#[tauri::command]
fn stop_local_ai_runtime(runtime: State<'_, LocalAiRuntimeState>) -> LocalAiRuntimeSnapshot {
    runtime.stop()
}

/// What the diagnostics need to know about the locked Lite model.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAiModelStatus {
    profile_id: String,
    label: String,
    /// The artifact was found at the exact locked path, name and size.
    /// A location claim only: it says nothing about the bytes.
    resolved: bool,
    /// The artifact was hashed and matches the locked SHA-256. Only this may be
    /// shown to a player as "verified".
    integrity_verified: bool,
    /// How long the digest took, when it was computed.
    verification_ms: Option<u64>,
    path: String,
    license: String,
    context_size: u32,
    release_approved: bool,
    /// Artifact size and the digest the lock expects, for provenance.
    size_bytes: u64,
    expected_sha256: String,
    /// Candidate status from the lock, e.g. `P0_BENCHMARK_CANDIDATE`.
    status: String,
    /// Where the artifact came from, so provenance is visible in diagnostics.
    artifact_repository: String,
    artifact_revision: String,
    /// Why the model could not be used, when it could not.
    problem: Option<String>,
}

/// Outcome of the once-per-session model integrity check, kept in Tauri state.
///
/// Held so the 1.28 GB digest is computed once at startup and never again on a
/// status refresh.
struct VerifiedModelState(Option<model_lock::VerifiedModel>, Option<String>);

#[tauri::command]
fn get_local_ai_model_status(
    app: AppHandle,
    verified: State<'_, VerifiedModelState>,
) -> LocalAiModelStatus {
    let fallback = |problem: String| LocalAiModelStatus {
        profile_id: model_lock::LITE_PROFILE_ID.to_string(),
        label: "Qwen3-1.7B Q4_K_M".to_string(),
        resolved: false,
        integrity_verified: false,
        verification_ms: None,
        path: String::new(),
        license: "Apache-2.0".to_string(),
        context_size: 0,
        release_approved: false,
        size_bytes: 0,
        expected_sha256: String::new(),
        status: "UNRESOLVED".to_string(),
        artifact_repository: String::new(),
        artifact_revision: String::new(),
        problem: Some(problem),
    };

    // The verified model from startup is authoritative when present.
    if let Some(verified_model) = &verified.0 {
        let model = verified_model.model();
        return LocalAiModelStatus {
            profile_id: model.profile_id().to_string(),
            label: model.label(),
            resolved: true,
            integrity_verified: true,
            verification_ms: Some(verified_model.verification_ms()),
            path: as_string(model.path()),
            license: model.license().to_string(),
            context_size: model.context_target(),
            release_approved: model.release_approved(),
            size_bytes: model.size_bytes(),
            expected_sha256: model.expected_sha256().to_string(),
            status: model.status().to_string(),
            artifact_repository: model.artifact_repository().to_string(),
            artifact_revision: model.artifact_revision().to_string(),
            problem: None,
        };
    }

    // Otherwise report what resolution alone could establish, and why the model
    // is not usable.
    match model_lock::resolve_lite(&app) {
        Ok(model) => LocalAiModelStatus {
            profile_id: model.profile_id().to_string(),
            label: model.label(),
            resolved: true,
            integrity_verified: false,
            verification_ms: None,
            path: as_string(model.path()),
            license: model.license().to_string(),
            context_size: model.context_target(),
            release_approved: model.release_approved(),
            size_bytes: model.size_bytes(),
            expected_sha256: model.expected_sha256().to_string(),
            status: model.status().to_string(),
            artifact_repository: model.artifact_repository().to_string(),
            artifact_revision: model.artifact_revision().to_string(),
            problem: verified
                .1
                .clone()
                .or_else(|| Some("model integrity has not been verified".to_string())),
        },
        Err(error) => fallback(error.message().to_string()),
    }
}

/// Build a provider bound to this runtime endpoint and session key.
fn provider_for(runtime: &LocalAiRuntimeManager) -> Result<LocalModelProvider, String> {
    let spec = runtime.launch_spec();
    LocalModelProvider::new(spec.base_url(), spec.api_key().to_string())
}

/// Run the P0 grounded smoke generation against the local model.
///
/// Async because the request is real network I/O; the lifecycle manager stays
/// synchronous and no lock is held across the await.
#[tauri::command]
async fn run_local_ai_smoke_inference(
    runtime: State<'_, LocalAiRuntimeState>,
) -> Result<InferenceOutcome, String> {
    let snapshot = runtime.snapshot();
    if !snapshot.inference_ready {
        return Err(format!(
            "inference is not available: the runtime is {:?} with {} model(s) loaded",
            snapshot.state,
            snapshot.loaded_models.unwrap_or(0)
        ));
    }
    let provider = provider_for(&runtime)?;
    let outcome = provider.generate_smoke().await?;

    // Rejected output stays here: enough to diagnose the refusal without letting
    // unvalidated model text cross into the interface.
    if !outcome.accepted {
        let preview: String = outcome.raw.chars().take(400).collect();
        eprintln!(
            "local AI generation rejected ({}): {preview}",
            outcome.validation_error.as_deref().unwrap_or("unknown reason")
        );
    }
    Ok(outcome)
}

/// Background model-aware probe.
///
/// The lifecycle watcher proves the HTTP runtime is up; this proves a model is
/// actually loaded. Kept separate because it needs async HTTP, and deliberately
/// not driven by the interface.
fn spawn_model_probe(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            sleep_ms(500).await;

            let Some(runtime) = handle.try_state::<LocalAiRuntimeState>() else {
                continue;
            };
            if !runtime.needs_model_probe() {
                continue;
            }
            let Ok(provider) = provider_for(&runtime) else {
                continue;
            };
            // Require the expected identity, not merely "a model exists": the
            // launch contract names the profile with --alias, so a runtime
            // serving something else must not turn inference on.
            let expected = runtime
                .launch_spec()
                .model()
                .map(|model| model.profile_id().to_string());
            let Some(expected) = expected else {
                continue;
            };
            if let Ok(serving) = provider.serves_model(&expected).await {
                runtime.record_loaded_models(u32::from(serving));
            }
        }
    });
}

/// Sleep helper: Tauri already runs on an async runtime, so the probe loop does
/// not need a timer dependency of its own.
async fn sleep_ms(millis: u64) {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(millis))
    })
    .await
    .ok();
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let log_path = sidecar_log_path(handle)?;

            // Resolve the locked runtime from the external workspace. A failure
            // is not fatal: the manager simply reports Unavailable and gameplay
            // keeps its procedural fallback.
            // Resolve the locked Lite model. Its absence is not fatal: the
            // runtime simply starts model-less and inference stays unavailable.
            // Resolve, then hash once. Only a verified artifact may be
            // attached to the launch contract; a same-size impostor is refused
            // here rather than handed to llama-server.
            let (model, model_problem) = match model_lock::resolve_lite(handle) {
                Ok(resolved) => {
                    let label = resolved.label();
                    let path = resolved.path().to_path_buf();
                    match resolved.verify_integrity() {
                        Ok(verified) => {
                            eprintln!(
                                "local AI model verified: {label} at {} (sha256 in {} ms)",
                                path.display(),
                                verified.verification_ms()
                            );
                            (Some(verified), None)
                        }
                        Err(error) => {
                            eprintln!("local AI model integrity check failed: {}", error.message);
                            (None, Some(error.message))
                        }
                    }
                }
                Err(error) => {
                    eprintln!("local AI model unavailable: {}", error.message());
                    (None, Some(error.message().to_string()))
                }
            };

            let model_state = model.clone();
            let manager = match runtime_lock::resolve(handle) {
                Ok(runtime) => {
                    eprintln!(
                        "local AI runtime resolved ({}): llama.cpp {} at {}",
                        runtime.source.label(),
                        runtime.release_tag,
                        runtime.executable.display()
                    );
                    let mut config = RuntimeConfig::loopback();
                    if let Some(verified) = &model {
                        config = config.with_model(verified);
                    }
                    Arc::new(system_manager_with_config(
                        config,
                        runtime.directory,
                        runtime.executable,
                        log_path,
                    ))
                }
                Err(reason) => {
                    // Report Unavailable honestly rather than pointing the
                    // manager at a path nobody verified.
                    eprintln!("local AI runtime unavailable: {reason}");
                    Arc::new(system_manager_with_config(
                        RuntimeConfig::loopback(),
                        PathBuf::new(),
                        PathBuf::from(&reason),
                        log_path,
                    ))
                }
            };

            app.manage(VerifiedModelState(model_state, model_problem));
            app.manage::<LocalAiRuntimeState>(manager.clone());

            // An observer we cannot start is a degraded local AI, not a dead
            // application: the Simulation Core and the Safe/Procedural path do
            // not depend on it.
            match RuntimeWatcher::spawn(manager) {
                Ok(watcher) => {
                    app.manage(Mutex::new(watcher));
                }
                Err(reason) => eprintln!(
                    "local AI watcher unavailable, runtime will not advance on its own: {reason}"
                ),
            }
            spawn_model_probe(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_runtime_status,
            get_database_status,
            save_smoke_campaign,
            load_smoke_campaign,
            get_local_ai_runtime_status,
            start_local_ai_runtime,
            stop_local_ai_runtime,
            get_local_ai_model_status,
            run_local_ai_smoke_inference
        ])
        .build(tauri::generate_context!())
        .expect("error while building Chronosaga: The Game")
        .run(|app_handle, event| {
            // Never leave a sidecar behind. Stop is idempotent, so this is a
            // no-op when nothing was ever started.
            if matches!(event, tauri::RunEvent::Exit) {
                // Order matters: silence the observer first, then reap the
                // child. Stop is idempotent, so this is a no-op when nothing
                // was ever started.
                if let Some(watcher) = app_handle.try_state::<Mutex<RuntimeWatcher>>() {
                    watcher
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .stop();
                }
                if let Some(runtime) = app_handle.try_state::<LocalAiRuntimeState>() {
                    let snapshot = runtime.stop();
                    if let Some(pid) = snapshot.pid {
                        eprintln!(
                            "local AI runtime process {pid} survived shutdown: {}",
                            snapshot.last_error.unwrap_or_default()
                        );
                    }
                }
            }
        });
}
