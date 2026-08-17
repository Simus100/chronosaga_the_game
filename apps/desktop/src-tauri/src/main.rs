#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local_ai_runtime;

use local_ai_runtime::{system_manager, LocalAiRuntimeManager, LocalAiRuntimeSnapshot};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
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

/// Where the bundled `llama-server` sidecar is expected once P0.3-B packages it.
///
/// Resolving it in one place keeps the legacy `get_runtime_status` probe and the
/// lifecycle manager pointed at the same path.
fn llama_server_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve resource directory: {error}"))?;

    Ok(resource_dir.join("bin").join(if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }))
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
    let llama_server_path = llama_server_path(&app)?;

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
        llama_server_present: llama_server_path.exists(),
        llama_server_path: as_string(&llama_server_path),
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let binary_path = llama_server_path(app.handle())?;
            app.manage::<LocalAiRuntimeState>(Arc::new(system_manager(binary_path)));
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
            stop_local_ai_runtime
        ])
        .build(tauri::generate_context!())
        .expect("error while building Chronosaga: The Game")
        .run(|app_handle, event| {
            // Never leave a sidecar behind. Stop is idempotent, so this is a
            // no-op when nothing was ever started.
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(runtime) = app_handle.try_state::<LocalAiRuntimeState>() {
                    runtime.stop();
                }
            }
        });
}
