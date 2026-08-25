#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod inference;
mod local_ai_runtime;
mod model_lock;
mod profile_orchestrator;
mod runtime_lock;
mod runtime_watcher;

/// Opt-in lifecycle test against the real llama-server payload.
#[cfg(test)]
mod benchmark;
mod runtime_e2e;

use inference::{InferenceOutcome, LocalModelProvider};
use local_ai_runtime::{
    system_manager_with_config, LocalAiRuntimeManager, LocalAiRuntimeSnapshot, RuntimeConfig,
};
use runtime_watcher::RuntimeWatcher;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Manager, State};

/// The shape of the database file: which tables exist.
///
/// Raised to 2 by M1-C/2, which adds `campaign_systemic`.
const DATABASE_SCHEMA_VERSION: u32 = 2;

/// The shape of a stored P0 smoke payload.
///
/// Deliberately still 1, and deliberately not the same constant as the
/// database version. Adding a table next to `campaign_smoke` changed nothing
/// about what a smoke row contains, and validating one against the other would
/// invalidate every existing save the moment an unrelated table appeared.
const SMOKE_SAVE_SCHEMA_VERSION: u32 = 1;
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

/// One locked profile, as the readiness panel shows it.
///
/// Derived from `config/local-ai-models.lock.json` and from the AUTO thresholds
/// in [`profile_orchestrator`]. Nothing here is hand-maintained, which is the
/// point: the panel used to be fed by a separate planning manifest that had
/// drifted to placeholder filenames and a context size the runtime never used.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProfileSummary {
    id: String,
    label: String,
    family: String,
    quantization: String,
    /// The exact locked artifact filename, which is also what a player must
    /// place in the user model directory.
    file: String,
    context_target: u32,
    size_bytes: u64,
    license: String,
    status: String,
    release_approved: bool,
    /// Provisional planning guidance the player needs before choosing. Not the
    /// AUTO floor: for Lite those are different numbers with different meanings.
    min_ram_mb: u64,
    recommended_ram_mb: u64,
    min_logical_cores: usize,
    gpu_required: bool,
    trade_off: String,
    /// Whether the artifact is where one of the ordered sources can see it.
    available: bool,
    /// Which source holds it, when one does.
    source: Option<String>,
    /// Why it is unavailable, when it is.
    problem: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    resource_dir: String,
    /// Where the authoritative model lock was read from.
    model_lock_path: String,
    model_lock_present: bool,
    /// The directory a player may place models in.
    user_models_dir: String,
    /// The packaged model directory, when this build shipped one.
    packaged_models_dir: String,
    llama_server_path: String,
    llama_server_present: bool,
    /// Where the runtime was resolved from, or why it could not be.
    llama_server_source: String,
    /// What AUTO would choose right now, from the one authoritative resolver.
    recommended_ai_profile: String,
    /// The reason that resolver gives, in the words the player sees.
    auto_reason: String,
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

    migrate_database(&connection)?;

    Ok(connection)
}

/// Bring a database file up to the current schema, or refuse to touch it.
///
/// The previous version wrote `DATABASE_SCHEMA_VERSION` over whatever was
/// there, unconditionally. That is fine while the number never moves and
/// silently destructive the moment it does: a file written by a *newer* build
/// would be relabelled as this one's and opened as though compatible, and
/// whatever that build had added would be read with the wrong assumptions.
///
/// So the stored version is read first and decides what happens. An unknown
/// future version is an error, not a number to overwrite — this build cannot
/// know what it would be agreeing to.
/// What a database file says about itself, before anything is written to it.
///
/// `Option<u32>` collapsed two different situations into `None`: a file that
/// has never been touched, and a file that has a `metadata` table but no
/// version in it. The first is a new campaign; the second is a database
/// somebody or something has already written to in a way this build cannot
/// account for. Treating them alike meant creating tables inside the second.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StoredSchema {
    /// No `metadata` table: nothing has ever been stored here.
    Fresh,
    /// A version this file declares.
    Declared(u32),
    /// The file has been written to, but says nothing usable about its shape.
    Unversioned,
}

fn migrate_database(connection: &Connection) -> Result<u32, String> {
    // Read before writing. Running the schema DDL first and asking the version
    // afterwards let an old build add tables to a database written by a newer
    // one and only then refuse it. `CREATE TABLE IF NOT EXISTS` is still a
    // write, and a refusal that has already modified the file is not a refusal.
    let stored = stored_schema(connection)?;

    match stored {
        StoredSchema::Fresh => {}

        StoredSchema::Unversioned => {
            return Err(
                "This save database has no schema version recorded. Refusing to open it: \
                 an existing file that cannot say what shape it is could be damaged by \
                 guessing."
                    .to_string(),
            );
        }

        StoredSchema::Declared(version) if version == DATABASE_SCHEMA_VERSION => {
            // Already current. Nothing to create, nothing to rewrite.
            return Ok(version);
        }

        StoredSchema::Declared(version) if version > DATABASE_SCHEMA_VERSION => {
            return Err(format!(
                "This save database was written by a newer version of Chronosaga \
                 (database schema {version}, this build supports {DATABASE_SCHEMA_VERSION}). \
                 Refusing to open it: continuing could damage the campaign."
            ));
        }

        // The only migration that has ever existed. Everything else below the
        // current version is a number this project never shipped, and inventing
        // a path for it would mean guessing at a layout nobody wrote down.
        StoredSchema::Declared(1) => {}

        StoredSchema::Declared(version) => {
            return Err(format!(
                "This save database declares schema version {version}, which no release of \
                 Chronosaga has produced. Refusing to open it: there is no migration from a \
                 layout that never existed."
            ));
        }
    }

    // Fresh, or a real v1. Both are brought forward by the same
    // `IF NOT EXISTS` statements: a v1 file keeps `metadata` and
    // `campaign_smoke` exactly as they are and gains `campaign_systemic`.
    initialize_schema(connection)?;

    connection
        .execute(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [DATABASE_SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| format!("Unable to store SQLite schema version: {error}"))?;

    Ok(DATABASE_SCHEMA_VERSION)
}

/// Classify a database file without writing to it.
///
/// A non-numeric version is an error rather than a state: the file is declaring
/// something, and this build cannot tell what.
fn stored_schema(connection: &Connection) -> Result<StoredSchema, String> {
    let metadata_exists: Option<String> = connection
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Unable to inspect the save database: {error}"))?;
    if metadata_exists.is_none() {
        return Ok(StoredSchema::Fresh);
    }

    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM metadata WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Unable to read SQLite schema version: {error}"))?;

    let Some(text) = stored else {
        return Ok(StoredSchema::Unversioned);
    };

    text.trim()
        .parse()
        .map(StoredSchema::Declared)
        .map_err(|_| format!("SQLite schema version '{text}' is not a number"))
}

/// Create the tables, separately from opening the file.
///
/// Split out so the storage logic can be exercised against an in-memory
/// database: the Tauri commands need an `AppHandle` and cannot run in a unit
/// test, but what they actually do — the SQL — has no reason to be untestable.
fn initialize_schema(connection: &Connection) -> Result<(), String> {
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
             );
             CREATE TABLE IF NOT EXISTS campaign_systemic (
               campaign_id TEXT PRIMARY KEY NOT NULL,
               envelope_version INTEGER NOT NULL,
               payload TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Unable to initialize SQLite schema: {error}"))
}

/// Diagnostic log for the sidecar, next to the save database.
///
/// Kept out of the save file and out of Git: it exists to explain a crash or a
/// failed start, nothing more.
fn sidecar_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_dir(app)?.join("local-ai-runtime.log"))
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

#[tauri::command]
fn get_system_info(app: AppHandle) -> Result<SystemInfo, String> {
    collect_system_info(&app)
}

/// Whether Standard can be located at all, without hashing it.
///
/// The single availability input AUTO is allowed to consider. Resolution only:
/// hashing a 1.9 GB artifact to answer "could we?" would cost seconds on every
/// status refresh, and the digest is checked anyway before anything is served.
/// If a located Standard later fails verification, the fallback chain handles it.
fn standard_is_available(app: &AppHandle) -> bool {
    model_lock::resolve_for_app(app, model_lock::STANDARD_PROFILE_ID).is_ok()
}

/// What AUTO would choose right now, from the one authoritative resolver.
fn auto_decision(app: &AppHandle) -> profile_orchestrator::AutoDecision {
    profile_orchestrator::resolve_auto(hardware_snapshot(app), standard_is_available(app))
}

/// Build the readiness view of every locked profile from the lock itself.
fn profile_summaries(app: &AppHandle, lock: &model_lock::ModelLock) -> Vec<ModelProfileSummary> {
    model_lock::KNOWN_PROFILE_IDS
        .iter()
        .filter_map(|id| lock.profiles.get(*id).map(|locked| (*id, locked)))
        .map(|(id, locked)| {
            // Player-facing planning guidance, which for Standard *is* the AUTO
            // threshold reused rather than a second constant. Reading the AUTO
            // floor directly would tell a player Lite needs no RAM at all.
            let guidance = profile_orchestrator::guidance(id);
            let (available, source, problem) = match model_lock::resolve_for_app(app, id) {
                Ok(resolved) => (true, Some(resolved.source().label().to_string()), None),
                Err(error) => (false, None, Some(error.message().to_string())),
            };
            ModelProfileSummary {
                id: id.to_string(),
                label: format!("{} {}", locked.family, locked.quantization),
                family: locked.family.clone(),
                quantization: locked.quantization.clone(),
                file: locked.artifact_filename.clone(),
                context_target: locked.context_target,
                size_bytes: locked.size_bytes,
                license: locked.license.clone(),
                status: locked.status.clone(),
                release_approved: locked.release_approved,
                min_ram_mb: guidance.map(|g| g.min_ram_mb).unwrap_or_default(),
                recommended_ram_mb: guidance.map(|g| g.recommended_ram_mb).unwrap_or_default(),
                min_logical_cores: guidance.map(|g| g.min_logical_cores).unwrap_or_default(),
                gpu_required: guidance.is_some_and(|g| g.gpu_required),
                trade_off: guidance.map(|g| g.trade_off.to_string()).unwrap_or_default(),
                available,
                source,
                problem,
            }
        })
        .collect()
}

#[tauri::command]
fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
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

    // A build with no packaged lock is incomplete, but it must still boot and
    // say so rather than refusing to render the diagnostics at all.
    let (model_lock_path, model_lock_present, profiles) =
        match model_lock::lock_path(&app) {
            Ok(path) => match model_lock::load_lock(&app) {
                Ok(lock) => (as_string(&path), true, profile_summaries(&app, &lock)),
                Err(reason) => (reason, false, Vec::new()),
            },
            Err(reason) => (reason, false, Vec::new()),
        };

    let decision = auto_decision(&app);

    Ok(RuntimeStatus {
        resource_dir: as_string(&resource_dir),
        model_lock_path,
        model_lock_present,
        user_models_dir: model_lock::user_models_dir(&app)
            .map(|dir| as_string(&dir))
            .unwrap_or_default(),
        packaged_models_dir: model_lock::packaged_models_dir(&app)
            .map(|dir| as_string(&dir))
            .unwrap_or_default(),
        llama_server_present,
        llama_server_path,
        llama_server_source,
        recommended_ai_profile: decision.resolved_profile,
        auto_reason: decision.reason,
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
        schema_version: SMOKE_SAVE_SCHEMA_VERSION,
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
    if campaign.schema_version != SMOKE_SAVE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported smoke save schema version {} (expected {})",
            campaign.schema_version, SMOKE_SAVE_SCHEMA_VERSION
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
/// The systemic save envelope, versioned separately from the database schema.
///
/// Two versions travel together and answer different questions.
/// `envelope_version` is *how these bytes are stored*: which columns exist,
/// what the payload string means. `simulation.schemaVersion`, inside the
/// payload, is *what the world is*. A future release could change either one
/// without the other, and collapsing them into a single number would make one
/// of those migrations impossible to describe.
///
/// The payload is the serialized `WorldState`, verbatim. Rust does not parse it
/// and does not know its shape: `packages/game-core` owns what a valid world
/// is, and re-implementing those rules here would create a second opinion that
/// could disagree with the first.
const SYSTEMIC_ENVELOPE_VERSION: u32 = 1;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemicSave {
    campaign_id: String,
    envelope_version: u32,
    /// Serialized `WorldState` JSON. Opaque to Rust.
    payload: String,
}

/// What a completed save reports back.
///
/// Deliberately not a `SystemicSave`: echoing the payload would send megabytes
/// back to a caller that just supplied them, and returning that field empty
/// would be worse — a `payload` of `""` reads as "the save is empty" to anyone
/// who does not know it is an artefact of the reply.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemicSaveReceipt {
    campaign_id: String,
    envelope_version: u32,
    payload_bytes: usize,
}

/// Why a systemic load produced nothing.
///
/// Distinct variants because the caller must tell them apart: "no save here" is
/// an ordinary state that offers a new game, while "the bytes are wrong" must
/// never silently become one. A corrupted save that quietly turned into a fresh
/// world would destroy a campaign and report success.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum SystemicLoad {
    /// No save exists for this campaign.
    NotFound,
    /// Bytes retrieved. The caller must still validate them through game-core.
    Found { save: SystemicSave },
    /// The row exists but this build cannot read its envelope.
    IncompatibleEnvelope { stored_version: u32, supported_version: u32 },
}

/// Write one campaign's systemic payload. Pure storage, no validation.
///
/// Keyed by campaign id, so campaign A's save replaces only campaign A's.
fn store_systemic(
    connection: &Connection,
    campaign_id: &str,
    payload: &str,
    updated_at: i64,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO campaign_systemic(campaign_id, envelope_version, payload, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(campaign_id) DO UPDATE SET
               envelope_version = excluded.envelope_version,
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![campaign_id, SYSTEMIC_ENVELOPE_VERSION, payload, updated_at],
        )
        .map(|_| ())
        .map_err(|error| format!("Unable to save systemic campaign: {error}"))
}

/// Read one campaign's systemic payload back, without judging it.
fn fetch_systemic(connection: &Connection, campaign_id: &str) -> Result<SystemicLoad, String> {
    let row: Option<(u32, String)> = connection
        .query_row(
            "SELECT envelope_version, payload FROM campaign_systemic WHERE campaign_id = ?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Unable to load systemic campaign: {error}"))?;

    let Some((envelope_version, payload)) = row else {
        return Ok(SystemicLoad::NotFound);
    };

    if envelope_version != SYSTEMIC_ENVELOPE_VERSION {
        return Ok(SystemicLoad::IncompatibleEnvelope {
            stored_version: envelope_version,
            supported_version: SYSTEMIC_ENVELOPE_VERSION,
        });
    }

    Ok(SystemicLoad::Found {
        save: SystemicSave {
            campaign_id: campaign_id.to_string(),
            envelope_version,
            payload,
        },
    })
}

/// Store one campaign's systemic world.
///
/// Keyed by campaign id, so saving campaign A replaces only campaign A. The
/// payload is stored as given; validity is the caller's proof, established
/// before this is ever called.
#[tauri::command]
fn save_systemic_campaign(
    app: AppHandle,
    campaign_id: String,
    payload: String,
) -> Result<SystemicSaveReceipt, String> {
    if campaign_id.trim().is_empty() {
        return Err("A systemic save needs a campaign id".to_string());
    }
    if payload.trim().is_empty() {
        return Err("Refusing to store an empty systemic payload".to_string());
    }

    let connection = open_database(&app)?;
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let payload_bytes = payload.len();
    store_systemic(&connection, &campaign_id, &payload, updated_at)?;

    Ok(SystemicSaveReceipt {
        campaign_id,
        envelope_version: SYSTEMIC_ENVELOPE_VERSION,
        payload_bytes,
    })
}

/// Retrieve one campaign's stored systemic world, without judging it.
///
/// Returns the bytes and says whether they were there. Whether they describe a
/// usable world is decided by `loadSystemicWorldState` in game-core, which is
/// the only place that knows.
#[tauri::command]
fn load_systemic_campaign(app: AppHandle, campaign_id: String) -> Result<SystemicLoad, String> {
    let connection = open_database(&app)?;
    fetch_systemic(&connection, &campaign_id)
}

#[tauri::command]
fn get_local_ai_runtime_status(runtime: State<'_, LocalAiRuntimeState>) -> LocalAiRuntimeSnapshot {
    runtime.snapshot()
}

#[tauri::command]
fn start_local_ai_runtime(
    runtime: State<'_, LocalAiRuntimeState>,
) -> Result<LocalAiRuntimeSnapshot, String> {
    // Refuse before the spawn, not after: llama-server happily starts in router
    // mode with no model and reports itself healthy.
    local_ai_runtime::serving_start_verdict(runtime.launch_spec().model().is_some())?;
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

/// Verified models and resolution problems, cached per profile.
///
/// Hashing a multi-GB artifact is expensive, so each profile is verified at most
/// once per application session: at startup for the default, and on first
/// selection for the other.
#[derive(Default)]
struct ModelCache {
    verified: BTreeMap<String, model_lock::VerifiedModel>,
    problems: BTreeMap<String, String>,
}

struct ModelCacheState(Mutex<ModelCache>);

/// The profile the desktop diagnostics currently target.
///
/// An application preference, deliberately not campaign state: selecting a
/// profile must never touch the save or the authoritative WorldState.
struct SelectedProfileState(Mutex<String>);

/// What the player last requested (`auto`, `lite`, `standard`) and how the last
/// transition ended, including any fallback.
///
/// Preference and diagnostics only. Nothing here is written to the campaign.
struct ProfileOutcomeState(Mutex<Option<profile_orchestrator::ProfileOutcome>>);

/// Read the hardware facts AUTO is allowed to consider.
fn hardware_snapshot(app: &AppHandle) -> profile_orchestrator::HardwareSnapshot {
    let mut system = System::new_all();
    system.refresh_all();
    let _ = app;
    profile_orchestrator::HardwareSnapshot {
        total_ram_mb: system.total_memory() / 1024 / 1024,
        logical_cores: system.cpus().len(),
    }
}

/// Stop the runtime and prove the child is gone.
///
/// The hard precondition of every transition: if the previous process cannot be
/// proved dead, nothing new may be started. Returns the reason on failure.
fn stop_and_confirm_reaped(runtime: &LocalAiRuntimeManager) -> Result<(), String> {
    let snapshot = runtime.stop();
    profile_orchestrator::reap_verdict(
        snapshot.pid,
        snapshot.inference_ready,
        snapshot.last_error.as_deref(),
    )
}

/// Bring one concrete profile up: verify, select, start, wait for readiness.
///
/// Every early return leaves the runtime stopped and reaped, so the caller can
/// immediately try the next profile in the chain.
fn try_profile(
    app: &AppHandle,
    cache: &ModelCacheState,
    runtime: &LocalAiRuntimeManager,
    profile_id: &str,
) -> Result<(), String> {
    // Development-only drill switch, so the fallback chain can be exercised
    // without corrupting a verified artifact.
    let forced = std::env::var(profile_orchestrator::FORCE_FAILURE_ENV).ok();
    if profile_orchestrator::forced_failure(profile_id, forced.as_deref()) {
        return Err(format!(
            "{profile_id} failure forced by {}",
            profile_orchestrator::FORCE_FAILURE_ENV
        ));
    }

    let verified = verify_profile(app, cache, profile_id)?;
    runtime.select_model(Some(&verified))?;

    runtime.start().map_err(|error| {
        // A failed start must not leave anything owned behind.
        let _ = stop_and_confirm_reaped(runtime);
        error
    })?;

    // Wait for the watcher to carry it to Ready, then for the model-aware probe
    // to confirm the expected model is the one serving.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    while std::time::Instant::now() < deadline {
        let snapshot = runtime.snapshot();
        if snapshot.inference_ready {
            return Ok(());
        }
        if matches!(
            snapshot.state,
            local_ai_runtime::RuntimePhase::Failed | local_ai_runtime::RuntimePhase::Unavailable
        ) {
            let reason = snapshot
                .last_error
                .unwrap_or_else(|| format!("{profile_id} runtime failed"));
            stop_and_confirm_reaped(runtime)?;
            return Err(reason);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    stop_and_confirm_reaped(runtime)?;
    Err(format!("{profile_id} never reported an expected-model readiness"))
}



/// Verify one profile, reusing the cached answer when there is one.
fn verify_profile(
    app: &AppHandle,
    cache: &ModelCacheState,
    profile_id: &str,
) -> Result<model_lock::VerifiedModel, String> {
    {
        let guard = cache.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(model) = guard.verified.get(profile_id) {
            return Ok(model.clone());
        }
    }

    // The digest-aware walk: it tries every source in order and only stops at a
    // copy whose bytes match. A corrupt copy in an earlier source is skipped, so
    // a damaged packaged model cannot make a good user copy unreachable.
    match model_lock::verify_for_app(app, profile_id) {
        Ok(verified) => {
            eprintln!(
                "local AI model verified: {profile_id} = {} from the {} (sha256 in {} ms)",
                verified.model().label(),
                verified.model().source().label(),
                verified.verification_ms()
            );
            let mut guard = cache.0.lock().unwrap_or_else(|p| p.into_inner());
            guard.problems.remove(profile_id);
            guard
                .verified
                .insert(profile_id.to_string(), verified.clone());
            Ok(verified)
        }
        Err(error) => {
            let message = error.message().to_string();
            eprintln!("local AI model {profile_id} could not be verified: {message}");
            cache
                .0
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .problems
                .insert(profile_id.to_string(), message.clone());
            Err(message)
        }
    }
}

/// Status of the currently selected profile.
#[tauri::command]
fn get_local_ai_model_status(
    app: AppHandle,
    cache: State<'_, ModelCacheState>,
    selected: State<'_, SelectedProfileState>,
) -> LocalAiModelStatus {
    let profile_id = selected.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    model_status(&app, &cache, &profile_id)
}

/// Status of every locked profile, for the diagnostic selector.
///
/// Does not hash: it reports what resolution alone can establish, plus whatever
/// verification has already been cached. Choosing a profile is what triggers the
/// digest.
#[tauri::command]
fn list_local_ai_profiles(
    app: AppHandle,
    cache: State<'_, ModelCacheState>,
) -> Vec<LocalAiModelStatus> {
    model_lock::KNOWN_PROFILE_IDS
        .iter()
        .map(|id| model_status(&app, &cache, id))
        .collect()
}

/// Select the profile the runtime will load next.
///
/// React sends a profile id and nothing else: the path, the digest and the
/// command line all stay on this side. An unknown id is refused rather than
/// defaulted, and a running runtime is never silently replaced.
#[tauri::command]
fn select_local_ai_profile(
    app: AppHandle,
    profile_id: String,
    cache: State<'_, ModelCacheState>,
    selected: State<'_, SelectedProfileState>,
    runtime: State<'_, LocalAiRuntimeState>,
) -> Result<LocalAiModelStatus, String> {
    if !model_lock::KNOWN_PROFILE_IDS.contains(&profile_id.as_str()) {
        return Err(format!(
            "unknown local AI profile '{profile_id}'; the lock declares {:?}",
            model_lock::KNOWN_PROFILE_IDS
        ));
    }

    // One model at a time: the runtime keeps whatever it was launched with until
    // it is stopped.
    let snapshot = runtime.snapshot();
    if snapshot.pid.is_some() {
        return Err(
            "stop the local AI runtime before selecting another profile".to_string()
        );
    }

    let verified = verify_profile(&app, &cache, &profile_id)?;
    runtime.select_model(Some(&verified))?;
    *selected.0.lock().unwrap_or_else(|p| p.into_inner()) = profile_id.clone();
    eprintln!("local AI profile selected: {profile_id}");

    Ok(model_status(&app, &cache, &profile_id))
}

/// Apply a requested profile, falling back through the chain when needed.
///
/// This is the whole of P0.4-B and P0.4-C in one product action:
///
/// ```text
/// requested (auto|lite|standard)
///   -> AUTO resolves to one concrete profile
///   -> stop current runtime, prove the child is gone
///   -> try the profile, then the rest of the chain
///   -> Safe Mode if none can serve
/// ```
///
/// Blocking on purpose: the transition must be atomic from the interface's point
/// of view, and the manager is synchronous.
#[tauri::command]
fn apply_local_ai_profile(
    app: AppHandle,
    profile_id: String,
    cache: State<'_, ModelCacheState>,
    selected: State<'_, SelectedProfileState>,
    outcome_state: State<'_, ProfileOutcomeState>,
    runtime: State<'_, LocalAiRuntimeState>,
) -> Result<profile_orchestrator::ProfileOutcome, String> {
    let requested = profile_orchestrator::RequestedProfile::parse(&profile_id)?;

    // Never start a second sidecar on top of a live one.
    stop_and_confirm_reaped(&runtime)?;

    // The same availability input the readiness panel uses, so the recommendation
    // the player is shown and the decision actually taken cannot disagree.
    let standard_available = standard_is_available(&app);
    let decision = profile_orchestrator::resolve_request(
        requested,
        hardware_snapshot(&app),
        standard_available,
    );
    eprintln!(
        "local AI profile requested={} resolved={} ({})",
        requested, decision.resolved_profile, decision.reason
    );

    let mut attempts = Vec::new();
    for candidate in profile_orchestrator::fallback_chain(&decision.resolved_profile) {
        match try_profile(&app, &cache, &runtime, &candidate) {
            Ok(()) => {
                attempts.push(profile_orchestrator::ProfileAttempt {
                    profile_id: candidate.clone(),
                    succeeded: true,
                    error: None,
                });
                *selected.0.lock().unwrap_or_else(|p| p.into_inner()) = candidate;
                break;
            }
            Err(error) => {
                eprintln!("local AI profile {candidate} failed: {error}");
                attempts.push(profile_orchestrator::ProfileAttempt {
                    profile_id: candidate,
                    succeeded: false,
                    error: Some(error),
                });
            }
        }
    }

    let outcome = profile_orchestrator::summarise(requested, &decision, attempts);
    if outcome.safe_mode {
        // Nothing local can serve. Gameplay continues on the deterministic core;
        // only narration is reduced.
        eprintln!(
            "local AI unavailable, entering SAFE MODE: {}",
            outcome.fallback_reason.as_deref().unwrap_or("no local model could start")
        );
        stop_and_confirm_reaped(&runtime)?;
    }

    *outcome_state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(outcome.clone());
    Ok(outcome)
}

/// The last transition outcome, for the diagnostics panel.
#[tauri::command]
fn get_local_ai_profile_outcome(
    outcome_state: State<'_, ProfileOutcomeState>,
) -> Option<profile_orchestrator::ProfileOutcome> {
    outcome_state
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// Build the diagnostic view of one profile.
fn model_status(app: &AppHandle, cache: &ModelCacheState, profile_id: &str) -> LocalAiModelStatus {
    let cached = {
        let guard = cache.0.lock().unwrap_or_else(|p| p.into_inner());
        (
            guard.verified.get(profile_id).cloned(),
            guard.problems.get(profile_id).cloned(),
        )
    };

    if let (Some(verified), _) = (&cached.0, &cached.1) {
        let model = verified.model();
        return LocalAiModelStatus {
            profile_id: model.profile_id().to_string(),
            label: model.label(),
            resolved: true,
            integrity_verified: true,
            verification_ms: Some(verified.verification_ms()),
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

    match model_lock::resolve_for_app(app, profile_id) {
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
            problem: cached
                .1
                .or_else(|| Some("model integrity has not been verified yet".to_string())),
        },
        Err(error) => LocalAiModelStatus {
            profile_id: profile_id.to_string(),
            label: profile_id.to_uppercase(),
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
            problem: Some(error.message().to_string()),
        },
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
            // Verify the default profile once. Only a verified artifact may be
            // attached to the launch contract; a same-size impostor is refused
            // here rather than handed to llama-server. The other profile is
            // verified when it is first selected.
            let cache = ModelCacheState(Mutex::new(ModelCache::default()));
            let default_profile = model_lock::LITE_PROFILE_ID;
            let model = verify_profile(handle, &cache, default_profile).ok();


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

            app.manage(cache);
            app.manage(SelectedProfileState(Mutex::new(default_profile.to_string())));
            app.manage(ProfileOutcomeState(Mutex::new(None)));
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
            save_systemic_campaign,
            load_systemic_campaign,
            get_local_ai_runtime_status,
            start_local_ai_runtime,
            stop_local_ai_runtime,
            get_local_ai_model_status,
            list_local_ai_profiles,
            select_local_ai_profile,
            apply_local_ai_profile,
            get_local_ai_profile_outcome,
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

#[cfg(test)]
mod systemic_persistence_tests {
    use super::*;

    /// A database with the real schema, in memory.
    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        initialize_schema(&connection).expect("schema");
        connection
    }

    fn payload_of(load: &SystemicLoad) -> &str {
        match load {
            SystemicLoad::Found { save } => &save.payload,
            other => panic!("expected a stored save, got {other:?}"),
        }
    }

    #[test]
    fn a_stored_payload_comes_back_byte_for_byte() {
        // Rust transports; it must not reshape. A payload that came back
        // re-serialised would silently change the world game-core validates.
        let db = database();
        let payload = r#"{"campaignId":"c1","nested":{"water":14.5},"text":"acqua è 14"}"#;
        store_systemic(&db, "c1", payload, 100).expect("store");

        let loaded = fetch_systemic(&db, "c1").expect("fetch");
        assert_eq!(payload_of(&loaded), payload);
    }

    #[test]
    fn an_absent_campaign_is_not_found_rather_than_an_error() {
        // 26 and the "never a new game" rule: absence is an ordinary answer,
        // and it is not the same answer as failure.
        let db = database();
        assert!(matches!(
            fetch_systemic(&db, "never_saved").expect("fetch"),
            SystemicLoad::NotFound
        ));
    }

    #[test]
    fn one_campaign_cannot_return_another_campaigns_save() {
        // 26. Keyed storage, proven rather than assumed.
        let db = database();
        store_systemic(&db, "alpha", r#"{"id":"alpha"}"#, 1).expect("alpha");
        store_systemic(&db, "beta", r#"{"id":"beta"}"#, 2).expect("beta");

        assert_eq!(payload_of(&fetch_systemic(&db, "alpha").unwrap()), r#"{"id":"alpha"}"#);
        assert_eq!(payload_of(&fetch_systemic(&db, "beta").unwrap()), r#"{"id":"beta"}"#);
        assert!(matches!(
            fetch_systemic(&db, "gamma").unwrap(),
            SystemicLoad::NotFound
        ));
    }

    #[test]
    fn saving_one_campaign_leaves_the_others_untouched() {
        let db = database();
        store_systemic(&db, "alpha", r#"{"turn":1}"#, 1).expect("alpha");
        store_systemic(&db, "beta", r#"{"turn":1}"#, 1).expect("beta");

        store_systemic(&db, "alpha", r#"{"turn":9}"#, 2).expect("alpha again");

        assert_eq!(payload_of(&fetch_systemic(&db, "alpha").unwrap()), r#"{"turn":9}"#);
        assert_eq!(payload_of(&fetch_systemic(&db, "beta").unwrap()), r#"{"turn":1}"#);
    }

    #[test]
    fn re_saving_replaces_rather_than_accumulating() {
        let db = database();
        for turn in 1..=5 {
            store_systemic(&db, "c1", &format!(r#"{{"turn":{turn}}}"#), turn).expect("store");
        }
        let rows: i64 = db
            .query_row("SELECT COUNT(*) FROM campaign_systemic", [], |row| row.get(0))
            .expect("count");
        assert_eq!(rows, 1, "one campaign is one row");
        assert_eq!(payload_of(&fetch_systemic(&db, "c1").unwrap()), r#"{"turn":5}"#);
    }

    #[test]
    fn an_envelope_this_build_cannot_read_is_named_as_such() {
        // Not "not found" and not a parse error: the row is there and this
        // build does not understand how it is stored. Collapsing that into
        // either of the others would either lose a campaign or invent one.
        let db = database();
        db.execute(
            "INSERT INTO campaign_systemic(campaign_id, envelope_version, payload, updated_at)
             VALUES ('future', 99, '{}', 1)",
            [],
        )
        .expect("insert");

        match fetch_systemic(&db, "future").expect("fetch") {
            SystemicLoad::IncompatibleEnvelope { stored_version, supported_version } => {
                assert_eq!(stored_version, 99);
                assert_eq!(supported_version, SYSTEMIC_ENVELOPE_VERSION);
            }
            other => panic!("expected an incompatible envelope, got {other:?}"),
        }
    }

    #[test]
    fn systemic_and_smoke_storage_do_not_share_a_table() {
        // 24 and 13: old P0 smoke rows must never be read as systemic state,
        // and a systemic save must not disturb them.
        let db = database();
        db.execute(
            "INSERT INTO campaign_smoke(campaign_id, payload, updated_at)
             VALUES ('shared_id', '{\"seed\":1,\"turn\":3}', 1)",
            [],
        )
        .expect("smoke row");

        // The same id, systemic side: absent, because they are separate stores.
        assert!(matches!(
            fetch_systemic(&db, "shared_id").expect("fetch"),
            SystemicLoad::NotFound
        ));

        store_systemic(&db, "shared_id", r#"{"systemic":true}"#, 2).expect("store");

        // Both survive, neither is confused for the other.
        let smoke: String = db
            .query_row(
                "SELECT payload FROM campaign_smoke WHERE campaign_id = 'shared_id'",
                [],
                |row| row.get(0),
            )
            .expect("smoke still there");
        assert!(smoke.contains("\"turn\":3"));
        assert_eq!(
            payload_of(&fetch_systemic(&db, "shared_id").unwrap()),
            r#"{"systemic":true}"#
        );
    }

    #[test]
    fn a_fresh_database_is_created_at_the_current_schema() {
        let db = Connection::open_in_memory().expect("db");
        assert_eq!(migrate_database(&db).expect("migrate"), DATABASE_SCHEMA_VERSION);
        assert_eq!(DATABASE_SCHEMA_VERSION, 2);

        let stored: String = db
            .query_row("SELECT value FROM metadata WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("version");
        assert_eq!(stored, "2");
    }

    #[test]
    fn a_v1_database_migrates_to_v2_without_losing_its_rows() {
        // The shape a real installation has today: metadata and smoke only.
        let db = Connection::open_in_memory().expect("db");
        db.execute_batch(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TABLE campaign_smoke (
               campaign_id TEXT PRIMARY KEY NOT NULL,
               payload TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             INSERT INTO metadata(key, value) VALUES ('schema_version', '1');
             INSERT INTO campaign_smoke(campaign_id, payload, updated_at)
               VALUES ('old_run', '{\"seed\":7419,\"turn\":4}', 1700000000);",
        )
        .expect("v1 database");

        assert_eq!(migrate_database(&db).expect("migrate"), 2);

        let version: String = db
            .query_row("SELECT value FROM metadata WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, "2");

        // The player's existing campaign is still there, byte for byte.
        let payload: String = db
            .query_row(
                "SELECT payload FROM campaign_smoke WHERE campaign_id = 'old_run'",
                [],
                |row| row.get(0),
            )
            .expect("smoke row survived");
        assert_eq!(payload, "{\"seed\":7419,\"turn\":4}");

        // And the new table now exists for systemic saves.
        store_systemic(&db, "new_campaign", r#"{"ok":true}"#, 1).expect("systemic table exists");
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let db = Connection::open_in_memory().expect("db");
        migrate_database(&db).expect("first");
        store_systemic(&db, "c1", r#"{"turn":3}"#, 1).expect("store");

        assert_eq!(migrate_database(&db).expect("second"), DATABASE_SCHEMA_VERSION);
        assert_eq!(payload_of(&fetch_systemic(&db, "c1").unwrap()), r#"{"turn":3}"#);
    }

    #[test]
    fn a_database_from_a_newer_build_is_refused_without_being_touched() {
        // The dangerous case, and the one the first version of this test
        // missed. It is not enough to check that the version survives: an old
        // build must not modify the file at all before refusing it, and
        // `CREATE TABLE IF NOT EXISTS` is a modification.
        //
        // So the fixture deliberately lacks `campaign_systemic`. If the schema
        // DDL runs before the version is read, the table appears — and a
        // database written by a newer build has been altered by one that
        // cannot read it.
        let db = Connection::open_in_memory().expect("db");
        db.execute_batch(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TABLE future_marker (note TEXT NOT NULL);
             INSERT INTO metadata(key, value) VALUES ('schema_version', '99');
             INSERT INTO future_marker(note) VALUES ('written by a later build');",
        )
        .expect("future database");

        let error = migrate_database(&db).expect_err("must refuse");
        assert!(error.contains("newer version"), "{error}");
        assert!(error.contains("99"), "{error}");
        assert!(error.contains("Refusing to open"), "{error}");

        // The declared version is untouched.
        let still: String = db
            .query_row("SELECT value FROM metadata WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("version");
        assert_eq!(still, "99");

        // The newer build's own data is untouched.
        let marker: String = db
            .query_row("SELECT note FROM future_marker", [], |row| row.get(0))
            .expect("marker");
        assert_eq!(marker, "written by a later build");

        // And nothing of ours was created inside it.
        for table in ["campaign_systemic", "campaign_smoke"] {
            let created: Option<String> = db
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .optional()
                .expect("inspect");
            assert!(created.is_none(), "{table} was created inside a future database");
        }
    }

    /// Assert that a refusal left the file exactly as it was.
    fn assert_untouched(db: &Connection, expected_version: Option<&str>, marker: &str) {
        let version: Option<String> = db
            .query_row(
                "SELECT value FROM metadata WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("read version");
        assert_eq!(version.as_deref(), expected_version, "metadata was rewritten");

        let note: String = db
            .query_row("SELECT note FROM existing_marker", [], |row| row.get(0))
            .expect("marker survived");
        assert_eq!(note, marker, "existing data was modified");

        for table in ["campaign_systemic", "campaign_smoke"] {
            let created: Option<String> = db
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .optional()
                .expect("inspect");
            assert!(created.is_none(), "{table} was created inside a refused database");
        }
    }

    /// A database that has been written to, with whatever version rows are given.
    fn existing_database(version_rows: &str) -> Connection {
        let db = Connection::open_in_memory().expect("db");
        db.execute_batch(&format!(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TABLE existing_marker (note TEXT NOT NULL);
             INSERT INTO existing_marker(note) VALUES ('pre-existing data');
             {version_rows}"
        ))
        .expect("fixture");
        db
    }

    #[test]
    fn a_metadata_table_without_a_version_is_refused_untouched() {
        // The state that used to be indistinguishable from a fresh database.
        // Something has already written here; creating tables inside it on the
        // assumption that it is new is exactly the guess to avoid.
        let db = existing_database("");
        assert_eq!(stored_schema(&db).expect("classify"), StoredSchema::Unversioned);

        let error = migrate_database(&db).expect_err("must refuse");
        assert!(error.contains("no schema version recorded"), "{error}");
        assert!(error.contains("Refusing to open"), "{error}");

        assert_untouched(&db, None, "pre-existing data");
    }

    #[test]
    fn a_version_this_project_never_shipped_is_refused_untouched() {
        // Only 1 -> 2 has ever existed. Treating 0 as "old enough to be v1"
        // would migrate a layout nobody ever wrote down. Numbers above the
        // current version are a different refusal, covered separately.
        for version in ["0"] {
            let db = existing_database(&format!(
                "INSERT INTO metadata(key, value) VALUES ('schema_version', '{version}');"
            ));
            assert_eq!(
                stored_schema(&db).expect("classify"),
                StoredSchema::Declared(version.parse().unwrap())
            );

            let error = migrate_database(&db).expect_err("must refuse");
            assert!(error.contains("no release of"), "{version}: {error}");
            assert!(error.contains("never existed"), "{version}: {error}");

            assert_untouched(&db, Some(version), "pre-existing data");
        }
    }

    #[test]
    fn a_non_numeric_version_is_refused_untouched() {
        let db = existing_database(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', 'banana');",
        );
        let error = migrate_database(&db).expect_err("must refuse");
        assert!(error.contains("not a number"), "{error}");
        assert_untouched(&db, Some("banana"), "pre-existing data");
    }

    #[test]
    fn the_four_database_states_are_told_apart() {
        // Fresh and unversioned are different answers, and used to be the same
        // one. Everything downstream depends on that distinction.
        let fresh = Connection::open_in_memory().expect("db");
        assert_eq!(stored_schema(&fresh).expect("classify"), StoredSchema::Fresh);

        assert_eq!(
            stored_schema(&existing_database("")).expect("classify"),
            StoredSchema::Unversioned
        );

        let versioned = existing_database(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', '1');",
        );
        assert_eq!(stored_schema(&versioned).expect("classify"), StoredSchema::Declared(1));

        let broken = existing_database(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', 'x');",
        );
        assert!(stored_schema(&broken).is_err());
    }

    #[test]
    fn an_unreadable_schema_version_is_an_error_not_a_zero() {
        let db = Connection::open_in_memory().expect("db");
        migrate_database(&db).expect("current");
        db.execute("UPDATE metadata SET value = 'banana' WHERE key = 'schema_version'", [])
            .expect("corrupt it");

        let error = migrate_database(&db).expect_err("must refuse");
        assert!(error.contains("not a number"), "{error}");
    }

    #[test]
    fn the_three_version_domains_are_separate_numbers() {
        // Adding a table beside campaign_smoke changed nothing about what a
        // smoke row contains. Validating one against the other would have
        // invalidated every existing save the moment an unrelated table
        // appeared — which is exactly what happened before this split.
        assert_eq!(DATABASE_SCHEMA_VERSION, 2);
        assert_eq!(SMOKE_SAVE_SCHEMA_VERSION, 1);
        assert_eq!(SYSTEMIC_ENVELOPE_VERSION, 1);

        let source = include_str!("main.rs");
        let production = source
            .find(concat!("mod systemic_persistence_", "tests"))
            .map(|at| &source[..at])
            .expect("test module");
        // The smoke payload check must compare against its own constant.
        assert!(production.contains("campaign.schema_version != SMOKE_SAVE_SCHEMA_VERSION"));
        assert!(!production.contains("campaign.schema_version != DATABASE_SCHEMA_VERSION"));
    }

    #[test]
    fn rust_stores_bytes_and_does_not_validate_worlds() {
        // The division that keeps one definition of a valid world. Rust accepts
        // a payload it cannot interpret; game-core is what refuses it. Teaching
        // Rust the rules would create a second opinion that could disagree.
        let db = database();
        store_systemic(&db, "c1", "this is not even json", 1).expect("stored anyway");
        assert_eq!(payload_of(&fetch_systemic(&db, "c1").unwrap()), "this is not even json");

        // Scanned up to this test module, so the needles below do not match
        // themselves. No newline in the marker: this file is checked out CRLF
        // on Windows.
        let source = include_str!("main.rs");
        let production = source
            .find(concat!("mod systemic_persistence_", "tests"))
            .map(|at| &source[..at])
            .expect("the test module marks the end of production code");

        for rule in [
            concat!("resource", "Stock"),
            concat!("simulation.", "tick"),
            concat!("validate", "Systemic"),
            concat!("world", "Pressure"),
            concat!("delayed", "Consequences"),
        ] {
            assert!(
                !production.contains(rule),
                "main.rs mentions {rule}: simulation validation belongs to game-core"
            );
        }
    }
}
