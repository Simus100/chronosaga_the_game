//! Resolve the locked local AI model from the model provenance lock.
//!
//! Sibling of [`crate::runtime_lock`], which locks the llama.cpp runtime. This
//! one locks the weights: which artifact, from which pinned revision, with which
//! digest and licence.
//!
//! The file name is never guessed and the workspace is never scanned for
//! `*.gguf`. Everything comes from `config/local-ai-models.lock.json`, so a
//! stray model dropped into the workspace can never be picked up by accident.
//!
//! Resolution order is explicit and ordered, mirroring [`crate::runtime_lock`]:
//!
//! 1. **Packaged** — `resources/models/`, where the Full Offline bundle will put
//!    the weights. Empty in the current small installer, and supported anyway so
//!    populating it later needs no redesign.
//! 2. **User library** — `%LOCALAPPDATA%\it.universalis.chronosaga\models\`,
//!    the one place a player may legitimately put a model themselves.
//! 3. **Development workspace** — `CHRONOSAGA_WORKSPACE_ROOT` plus the path the
//!    lock names. Last, and for working from a checkout.
//!
//! Before P0.4-D only the third existed, which is why an installed Chronosaga
//! could never find a model without a developer environment variable.
//!
//! Two resolutions, deliberately different in cost:
//!
//! * [`resolve_from`] is **cheap**: filename and size only, no bytes read. It
//!   answers "is this profile installed?" for the diagnostics panel and for the
//!   AUTO availability question, which are asked on every status refresh.
//! * [`verify_from`] is **authoritative for serving**: it walks the same ordered
//!   sources and returns the first copy whose bytes match the locked digest.
//!   A corrupt copy in an earlier source is skipped rather than fatal, so a
//!   damaged packaged model cannot shadow a good one in the user library.
//!
//! Only [`verify_from`] can produce a [`VerifiedModel`], and only a
//! [`VerifiedModel`] may be attached to a launch contract.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::Instant,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::runtime_lock::WORKSPACE_ROOT_ENV;

/// Repository- and resource-relative location of the model lock.
pub const MODEL_LOCK_RELATIVE_PATH: &str = "config/local-ai-models.lock.json";

/// The profile P0.3-C implemented first.
pub const LITE_PROFILE_ID: &str = "lite";

/// The profile P0.4-A adds.
pub const STANDARD_PROFILE_ID: &str = "standard";

/// The locked profiles the desktop diagnostics know about, in display order.
///
/// P0.4-A Phase A deliberately stops here: two explicit profiles, no AUTO and
/// no player-facing profile manager. Those belong to Phase B.
pub const KNOWN_PROFILE_IDS: [&str; 2] = [LITE_PROFILE_ID, STANDARD_PROFILE_ID];

/// Resource-relative directory the Full Offline bundle will populate.
///
/// Deliberately supported while still empty: the resolver must already prefer it
/// so shipping the weights later is a packaging change, not an architecture one.
pub const PACKAGED_MODELS_DIR: &str = "models";

/// Directory, under the application data folder, where a player may place models.
///
/// The same folder already holds the save database and the sidecar log, so it is
/// the natural home and needs no new permission or install step.
pub const USER_MODELS_DIR_NAME: &str = "models";

/// Where a model artifact was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelSource {
    /// Shipped inside the installer.
    Packaged,
    /// The player's own model directory under the application data folder.
    UserLibrary,
    /// The external development workspace. Last, and development-only.
    DevelopmentWorkspace,
}

impl ModelSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::Packaged => "packaged",
            Self::UserLibrary => "user model library",
            Self::DevelopmentWorkspace => "development workspace",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLock {
    pub profiles: BTreeMap<String, LockedModel>,
}

/// One locked model artifact.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockedModel {
    pub profile_id: String,
    pub status: String,
    pub release_approved: bool,
    pub family: String,
    pub quantization: String,
    pub artifact_filename: String,
    pub artifact_repository: String,
    pub artifact_revision: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license: String,
    pub external_path_relative_to_workspace_root: String,
    pub context_target: u32,
}

/// A model found on disk at the exact path, name and size the lock declares.
///
/// "Resolved" is a location claim, not an integrity claim: the bytes have not
/// been read. Fields are private and there is no public constructor, so the only
/// way to obtain one is [`resolve_from`] reading the committed lock. Nothing
/// else in the crate can invent a model pointing at an arbitrary path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedModel {
    profile_id: String,
    path: PathBuf,
    family: String,
    quantization: String,
    size_bytes: u64,
    sha256: String,
    license: String,
    context_target: u32,
    release_approved: bool,
    status: String,
    artifact_repository: String,
    artifact_revision: String,
    /// The locked filename, carried rather than derived from the path later.
    artifact_filename: String,
    source: ModelSource,
}

impl ResolvedModel {
    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }
    /// Which of the ordered sources actually held the artifact.
    pub fn source(&self) -> ModelSource {
        self.source
    }
    // The benchmark runner is the only consumer of these three, and it is
    // test-only for P0.5-A. Gated rather than `allow(dead_code)` so that
    // promoting the runner to production in P0.5-B is a visible edit here.
    #[cfg(test)]
    pub fn family(&self) -> &str {
        &self.family
    }
    #[cfg(test)]
    pub fn quantization(&self) -> &str {
        &self.quantization
    }
    /// The exact filename the lock declares. Not guessed from the path.
    #[cfg(test)]
    pub fn artifact_filename(&self) -> &str {
        &self.artifact_filename
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn size_bytes(&self) -> u64 {
        self.size_bytes
    }
    /// The digest the lock expects. Not proof that the file matches it.
    pub fn expected_sha256(&self) -> &str {
        &self.sha256
    }
    pub fn license(&self) -> &str {
        &self.license
    }
    pub fn context_target(&self) -> u32 {
        self.context_target
    }
    pub fn release_approved(&self) -> bool {
        self.release_approved
    }
    pub fn status(&self) -> &str {
        &self.status
    }
    pub fn artifact_repository(&self) -> &str {
        &self.artifact_repository
    }
    pub fn artifact_revision(&self) -> &str {
        &self.artifact_revision
    }

    /// Short label for diagnostics, e.g. `Qwen3-1.7B Q4_K_M`.
    pub fn label(&self) -> String {
        format!("{} {}", self.family, self.quantization)
    }

    /// Test-only constructor. Never compiled into the shipped binary, so the
    /// production path still has no way to build a model from an arbitrary path.
    #[cfg(test)]
    pub fn for_test(profile_id: &str, path: PathBuf, context_target: u32) -> Self {
        Self::for_test_with(
            profile_id,
            path,
            context_target,
            1_282_439_264,
            "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5",
        )
    }

    /// Test-only constructor with explicit size and digest, for integrity tests
    /// that use a small fixture instead of the 1.28 GB artifact.
    #[cfg(test)]
    pub fn for_test_with(
        profile_id: &str,
        path: PathBuf,
        context_target: u32,
        size_bytes: u64,
        sha256: &str,
    ) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            path,
            family: "Qwen3-1.7B".to_string(),
            quantization: "Q4_K_M".to_string(),
            size_bytes,
            sha256: sha256.to_string(),
            license: "Apache-2.0".to_string(),
            context_target,
            release_approved: false,
            status: "P0_BENCHMARK_CANDIDATE".to_string(),
            artifact_repository: "ggml-org/Qwen3-1.7B-GGUF".to_string(),
            artifact_revision: "daeb8e2d".to_string(),
            artifact_filename: "Qwen3-1.7B-Q4_K_M.gguf".to_string(),
            source: ModelSource::DevelopmentWorkspace,
        }
    }

    /// Hash the artifact and compare it with the locked digest.
    ///
    /// Streams the file in 1 MiB chunks: the Lite artifact is 1.28 GB and must
    /// never be read into memory to be hashed. Intended to run once per
    /// application session, not on every status refresh.
    pub fn verify_integrity(self) -> Result<VerifiedModel, ModelIntegrityError> {
        let started = Instant::now();
        let digest = stream_sha256(&self.path).map_err(|error| ModelIntegrityError {
            expected: self.sha256.clone(),
            found: None,
            message: format!("unable to read {} for hashing: {error}", self.path.display()),
            elapsed_ms: started.elapsed().as_millis() as u64,
        })?;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        if digest != self.sha256 {
            return Err(ModelIntegrityError {
                expected: self.sha256.clone(),
                found: Some(digest),
                message: format!(
                    "{} does not match the locked digest; refusing to load an unverified model",
                    self.path.display()
                ),
                elapsed_ms,
            });
        }

        Ok(VerifiedModel {
            model: self,
            elapsed_ms,
        })
    }
}

/// A model whose bytes have been hashed and match the lock.
///
/// The only way to build one outside tests is [`ResolvedModel::verify_integrity`],
/// which makes the type itself the proof. `RuntimeConfig::with_model` takes this
/// and not `ResolvedModel`, so an unverified artifact cannot reach a launch
/// contract even by mistake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedModel {
    model: ResolvedModel,
    elapsed_ms: u64,
}

impl VerifiedModel {
    pub fn model(&self) -> &ResolvedModel {
        &self.model
    }

    /// How long the digest took, for diagnostics.
    pub fn verification_ms(&self) -> u64 {
        self.elapsed_ms
    }

    /// Test-only shortcut, so unit tests need no 1.28 GB artifact. Never
    /// compiled into the shipped binary.
    #[cfg(test)]
    pub fn for_test(model: ResolvedModel) -> Self {
        Self {
            model,
            elapsed_ms: 0,
        }
    }
}

/// Why an artifact failed its integrity check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelIntegrityError {
    pub expected: String,
    pub found: Option<String>,
    pub message: String,
    pub elapsed_ms: u64,
}

/// Stream a file through SHA-256 without holding it in memory.
fn stream_sha256(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Why a locked model could not be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelResolutionError {
    /// The lock has no such profile.
    UnknownProfile(String),
    /// The artifact is not where the lock says it should be.
    Missing(String),
    /// The artifact is there but is not the locked one.
    Mismatch(String),
}

impl ModelResolutionError {
    pub fn message(&self) -> &str {
        match self {
            Self::UnknownProfile(m) | Self::Missing(m) | Self::Mismatch(m) => m,
        }
    }
}

/// Size of the artifact on disk, or `None` when it is not a file.
fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// The ordered places one profile's artifact may live.
///
/// Shared by the cheap and the verified resolutions so the two can never walk
/// different sources or a different order. The second return value collects the
/// sources that could not even be considered, for the error message.
fn candidates_for(
    locked: &LockedModel,
    packaged_models_dir: Option<&Path>,
    user_models_dir: Option<&Path>,
    workspace_root: Option<&str>,
) -> (Vec<(ModelSource, PathBuf)>, Vec<String>) {
    let mut candidates = Vec::new();
    let mut notes = Vec::new();

    match packaged_models_dir {
        Some(directory) => candidates.push((
            ModelSource::Packaged,
            directory.join(&locked.artifact_filename),
        )),
        None => notes.push("no packaged model directory in this build".to_string()),
    }

    match user_models_dir {
        Some(directory) => candidates.push((
            ModelSource::UserLibrary,
            directory.join(&locked.artifact_filename),
        )),
        None => notes.push("the user model directory could not be resolved".to_string()),
    }

    match workspace_root.map(str::trim).filter(|value| !value.is_empty()) {
        Some(root) => candidates.push((
            ModelSource::DevelopmentWorkspace,
            Path::new(root)
                .join(&locked.external_path_relative_to_workspace_root)
                .join(&locked.artifact_filename),
        )),
        None => notes.push(format!("{WORKSPACE_ROOT_ENV} is not set")),
    }

    (candidates, notes)
}

/// Build the located model for one candidate. Still only a location claim.
fn located(locked: &LockedModel, path: PathBuf, source: ModelSource) -> ResolvedModel {
    ResolvedModel {
        profile_id: locked.profile_id.clone(),
        path,
        family: locked.family.clone(),
        quantization: locked.quantization.clone(),
        size_bytes: locked.size_bytes,
        sha256: locked.sha256.clone(),
        license: locked.license.clone(),
        context_target: locked.context_target,
        release_approved: locked.release_approved,
        status: locked.status.clone(),
        artifact_repository: locked.artifact_repository.clone(),
        artifact_revision: locked.artifact_revision.clone(),
        artifact_filename: locked.artifact_filename.clone(),
        source,
    }
}

/// Resolve one profile for serving, digest included.
///
/// The authoritative path: it walks the ordered sources and returns the first
/// copy whose bytes actually match the lock. A candidate with the right name and
/// the right size but the wrong contents is **skipped, not fatal** — the search
/// continues into the next source for the same profile.
///
/// That distinction is the whole point. Stopping at the first size match would
/// let a corrupt packaged Standard shadow a perfectly good user copy, and the
/// profile would degrade to Lite or Safe Mode while verified bytes sat unused
/// one source further down.
///
/// Expensive by construction, so it is called when something is about to be
/// served, never on a status refresh. [`resolve_from`] answers the cheap
/// question.
pub fn verify_from(
    lock: &ModelLock,
    profile_id: &str,
    packaged_models_dir: Option<&Path>,
    user_models_dir: Option<&Path>,
    workspace_root: Option<&str>,
) -> Result<VerifiedModel, ModelResolutionError> {
    let Some(locked) = lock.profiles.get(profile_id) else {
        return Err(ModelResolutionError::UnknownProfile(format!(
            "the model lock declares no '{profile_id}' profile"
        )));
    };

    let (candidates, mut notes) = candidates_for(
        locked,
        packaged_models_dir,
        user_models_dir,
        workspace_root,
    );
    let mut rejected = Vec::new();

    for (source, path) in candidates {
        match file_size(&path) {
            None => notes.push(format!("not in the {}", source.label())),
            Some(size) if size != locked.size_bytes => {
                notes.push(format!("wrong size in the {}", source.label()));
                rejected.push(format!(
                    "the copy in the {} is {size} bytes, not {}",
                    source.label(),
                    locked.size_bytes
                ));
            }
            Some(_) => match located(locked, path, source).verify_integrity() {
                Ok(verified) => return Ok(verified),
                Err(error) => {
                    notes.push(format!("failed the digest in the {}", source.label()));
                    rejected.push(format!(
                        "the copy in the {} does not match the locked digest ({} ms)",
                        source.label(),
                        error.elapsed_ms
                    ));
                }
            },
        }
    }

    if !rejected.is_empty() {
        return Err(ModelResolutionError::Mismatch(format!(
            "no copy of {} could be verified: {}; refusing to load an unverified model",
            locked.artifact_filename,
            rejected.join("; ")
        )));
    }

    Err(ModelResolutionError::Missing(format!(
        "{} was not found in any supported location ({}); place it in the model \
         directory or run `pnpm verify:local-ai-models`",
        locked.artifact_filename,
        notes.join("; ")
    )))
}

/// Resolve one profile against the ordered model sources.
///
/// Pure apart from the filesystem, and independent of Tauri, so the decision
/// table is testable without a 1.28 GB artifact.
///
/// Checks the exact locked filename and the size at each source in turn, and
/// stops at the first that matches. It deliberately does NOT hash: resolution is
/// a location claim. The digest is checked once per session by
/// [`ResolvedModel::verify_integrity`], and only the resulting [`VerifiedModel`]
/// may be attached to a launch contract.
///
/// The packaged and user directories are flat — the locked filename sits
/// directly inside them — because that is the only instruction a player can
/// reasonably follow, and the only layout an installer needs to produce. The
/// development workspace keeps the nested layout the lock names, so existing
/// checkouts are untouched.
///
/// A wrong-sized file at an early source never shadows a correct one later: the
/// mismatch is remembered and only reported if nothing else satisfies the lock.
pub fn resolve_from(
    lock: &ModelLock,
    profile_id: &str,
    packaged_models_dir: Option<&Path>,
    user_models_dir: Option<&Path>,
    workspace_root: Option<&str>,
) -> Result<ResolvedModel, ModelResolutionError> {
    let Some(locked) = lock.profiles.get(profile_id) else {
        return Err(ModelResolutionError::UnknownProfile(format!(
            "the model lock declares no '{profile_id}' profile"
        )));
    };

    let (candidates, mut notes) = candidates_for(
        locked,
        packaged_models_dir,
        user_models_dir,
        workspace_root,
    );
    let mut mismatch: Option<String> = None;

    for (source, path) in candidates {
        match file_size(&path) {
            Some(size) if size == locked.size_bytes => return Ok(located(locked, path, source)),
            Some(size) => {
                notes.push(format!("wrong size in the {}", source.label()));
                mismatch.get_or_insert(format!(
                    "{} in the {} is {size} bytes but the lock expects {}; \
                     refusing to load an unverified model",
                    locked.artifact_filename,
                    source.label(),
                    locked.size_bytes
                ));
            }
            None => notes.push(format!("not in the {}", source.label())),
        }
    }

    if let Some(message) = mismatch {
        return Err(ModelResolutionError::Mismatch(message));
    }

    Err(ModelResolutionError::Missing(format!(
        "{} was not found in any supported location ({}); place it in the model \
         directory or run `pnpm verify:local-ai-models`",
        locked.artifact_filename,
        notes.join("; ")
    )))
}

/// The packaged model directory, when this build shipped one.
pub fn packaged_models_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve(PACKAGED_MODELS_DIR, BaseDirectory::Resource)
        .ok()
        .filter(|directory| directory.is_dir())
}

/// The directory a player may place models in, creating it if it is absent.
///
/// Created eagerly so the folder exists to be found: telling someone to put a
/// file somewhere that does not exist yet is a bad instruction.
pub fn user_models_dir(app: &AppHandle) -> Option<PathBuf> {
    let directory = app
        .path()
        .app_local_data_dir()
        .ok()?
        .join(USER_MODELS_DIR_NAME);
    let _ = fs::create_dir_all(&directory);
    Some(directory)
}

/// Where the authoritative model lock was resolved from.
///
/// Reported by the diagnostics so an incomplete installation is visible as a
/// path problem rather than as an unexplained absence of profiles.
pub fn lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::runtime_lock::packaged_metadata_path(app, MODEL_LOCK_RELATIVE_PATH)
}

pub fn load_lock(app: &AppHandle) -> Result<ModelLock, String> {
    let path = crate::runtime_lock::packaged_metadata_path(app, MODEL_LOCK_RELATIVE_PATH)?;

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse {}: {error}", path.display()))
}

/// Resolve one locked profile for this application instance.
///
/// P0.4-A never packages the weights, so this is workspace-only for now. The
/// packaged path is prepared by [`load_lock`] reading a bundled lock first.
/// Verify one profile for serving against this application's real sources.
///
/// The only production route to a [`VerifiedModel`].
pub fn verify_for_app(
    app: &AppHandle,
    profile_id: &str,
) -> Result<VerifiedModel, ModelResolutionError> {
    let lock = load_lock(app).map_err(ModelResolutionError::Missing)?;
    let packaged = packaged_models_dir(app);
    let user = user_models_dir(app);
    let workspace = env::var(WORKSPACE_ROOT_ENV).ok();
    verify_from(
        &lock,
        profile_id,
        packaged.as_deref(),
        user.as_deref(),
        workspace.as_deref(),
    )
}

pub fn resolve_for_app(
    app: &AppHandle,
    profile_id: &str,
) -> Result<ResolvedModel, ModelResolutionError> {
    let lock = load_lock(app).map_err(ModelResolutionError::Missing)?;
    let packaged = packaged_models_dir(app);
    let user = user_models_dir(app);
    let workspace = env::var(WORKSPACE_ROOT_ENV).ok();
    resolve_from(
        &lock,
        profile_id,
        packaged.as_deref(),
        user.as_deref(),
        workspace.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn lock() -> ModelLock {
        let mut profiles = BTreeMap::new();
        profiles.insert(
            "lite".to_string(),
            LockedModel {
                profile_id: "lite".to_string(),
                status: "P0_BENCHMARK_CANDIDATE".to_string(),
                release_approved: false,
                family: "Qwen3-1.7B".to_string(),
                quantization: "Q4_K_M".to_string(),
                artifact_filename: "Qwen3-1.7B-Q4_K_M.gguf".to_string(),
                artifact_repository: "ggml-org/Qwen3-1.7B-GGUF".to_string(),
                artifact_revision: "daeb8e2d528a760970442092f6bf1e55c3b659eb".to_string(),
                size_bytes: 64,
                sha256: "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5"
                    .to_string(),
                license: "Apache-2.0".to_string(),
                external_path_relative_to_workspace_root: "runtime-assets/models/lite/qwen3"
                    .to_string(),
                context_target: 4096,
            },
        );
        ModelLock { profiles }
    }

    /// Build a workspace holding an artifact of `size` bytes under the locked name.
    fn workspace_with(label: &str, name: &str, size: usize) -> PathBuf {
        let root = std::env::temp_dir().join(format!("chronosaga-model-test-{label}"));
        let _ = fs::remove_dir_all(&root);
        let directory = root.join("runtime-assets/models/lite/qwen3");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(name), vec![b'g'; size]).unwrap();
        root
    }

    #[test]
    fn the_locked_lite_artifact_resolves_from_the_workspace() {
        let root = workspace_with("ok", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let resolved =
            resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap())).expect("must resolve");

        assert_eq!(resolved.profile_id, "lite");
        assert_eq!(resolved.label(), "Qwen3-1.7B Q4_K_M");
        assert_eq!(resolved.context_target, 4096);
        assert!(!resolved.release_approved, "a candidate is not release approved");
        assert!(resolved.path.ends_with("Qwen3-1.7B-Q4_K_M.gguf"));
    }

    #[test]
    fn resolution_is_deterministic_for_the_same_workspace() {
        let root = workspace_with("deterministic", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let first = resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap())).unwrap();
        let second = resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap())).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn a_missing_artifact_is_reported_not_guessed() {
        let root = std::env::temp_dir().join("chronosaga-model-test-empty");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("runtime-assets/models/lite/qwen3")).unwrap();

        let error = resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap()))
            .expect_err("nothing to resolve");
        assert!(matches!(error, ModelResolutionError::Missing(_)));
        assert!(error.message().contains("verify:local-ai-models"));
    }

    #[test]
    fn a_different_gguf_in_the_directory_is_never_substituted() {
        // A stray model with another name must not be picked up: the lock names
        // exactly one artifact, and scanning for *.gguf is precisely the
        // accident this design prevents.
        let root = workspace_with("stray", "some-other-model-Q8_0.gguf", 64);

        let error = resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap()))
            .expect_err("a stray artifact must not satisfy the lock");
        assert!(matches!(error, ModelResolutionError::Missing(_)));
        assert!(error.message().contains("Qwen3-1.7B-Q4_K_M.gguf"));
    }

    #[test]
    fn an_artifact_of_the_wrong_size_is_refused() {
        let root = workspace_with("truncated", "Qwen3-1.7B-Q4_K_M.gguf", 10);

        let error = resolve_from(&lock(), "lite", None, None, Some(root.to_str().unwrap()))
            .expect_err("a truncated artifact must be refused");
        assert!(matches!(error, ModelResolutionError::Mismatch(_)));
        assert!(
            error.message().contains("refusing to load an unverified model"),
            "unexpected message: {}",
            error.message()
        );
    }

    #[test]
    fn no_source_at_all_means_no_model() {
        // With every source absent the error must name each place that was
        // considered, so a player is told what to do rather than that something
        // unspecified went wrong.
        let error = resolve_from(&lock(), "lite", None, None, None).expect_err("nothing to resolve");
        assert!(matches!(error, ModelResolutionError::Missing(_)));
        assert!(error.message().contains(WORKSPACE_ROOT_ENV), "{}", error.message());
        assert!(error.message().contains("packaged"), "{}", error.message());
        assert!(error.message().contains("user model"), "{}", error.message());

        let blank = resolve_from(&lock(), "lite", None, None, Some("   "))
            .expect_err("blank is not a path");
        assert!(matches!(blank, ModelResolutionError::Missing(_)));
    }

    /// A flat directory holding an artifact of `size` bytes under the locked name.
    fn flat_dir_with(label: &str, name: &str, size: usize) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("chronosaga-flat-{label}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(name), vec![b'g'; size]).unwrap();
        directory
    }

    #[test]
    fn the_packaged_directory_wins_over_everything_else() {
        // What the Full Offline bundle will rely on: once the installer ships
        // weights, they are what runs, whatever else is on the machine.
        let packaged = flat_dir_with("packaged", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let user = flat_dir_with("user-loses", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let workspace = workspace_with("ws-loses", "Qwen3-1.7B-Q4_K_M.gguf", 64);

        let resolved = resolve_from(
            &lock(),
            "lite",
            Some(&packaged),
            Some(&user),
            Some(workspace.to_str().unwrap()),
        )
        .expect("must resolve");

        assert_eq!(resolved.source(), ModelSource::Packaged);
        assert!(resolved.path().starts_with(&packaged));
    }

    #[test]
    fn the_user_library_is_used_when_nothing_was_packaged() {
        // The path that makes an installed Chronosaga usable at all today.
        let user = flat_dir_with("user-wins", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let workspace = workspace_with("ws-second", "Qwen3-1.7B-Q4_K_M.gguf", 64);

        let resolved = resolve_from(
            &lock(),
            "lite",
            None,
            Some(&user),
            Some(workspace.to_str().unwrap()),
        )
        .expect("must resolve");

        assert_eq!(resolved.source(), ModelSource::UserLibrary);
        assert!(resolved.path().starts_with(&user));
    }

    #[test]
    fn the_development_workspace_is_the_last_resort() {
        let workspace = workspace_with("ws-last", "Qwen3-1.7B-Q4_K_M.gguf", 64);

        let resolved = resolve_from(
            &lock(),
            "lite",
            None,
            None,
            Some(workspace.to_str().unwrap()),
        )
        .expect("must resolve");

        assert_eq!(resolved.source(), ModelSource::DevelopmentWorkspace);
    }

    #[test]
    fn an_installed_app_needs_no_environment_variable() {
        // The defect P0.4-D4 closes: before this, a model could only ever be
        // found through a developer environment variable.
        let user = flat_dir_with("no-env", "Qwen3-1.7B-Q4_K_M.gguf", 64);

        let resolved =
            resolve_from(&lock(), "lite", None, Some(&user), None).expect("must resolve");

        assert_eq!(resolved.source(), ModelSource::UserLibrary);
    }

    #[test]
    fn a_damaged_early_copy_never_shadows_a_good_later_one() {
        // A truncated download in the user folder must not make a correct
        // packaged or workspace copy unreachable.
        let user = flat_dir_with("truncated-user", "Qwen3-1.7B-Q4_K_M.gguf", 10);
        let workspace = workspace_with("good-ws", "Qwen3-1.7B-Q4_K_M.gguf", 64);

        let resolved = resolve_from(
            &lock(),
            "lite",
            None,
            Some(&user),
            Some(workspace.to_str().unwrap()),
        )
        .expect("the good copy must still be reachable");

        assert_eq!(resolved.source(), ModelSource::DevelopmentWorkspace);
    }

    #[test]
    fn a_damaged_copy_is_reported_when_it_is_the_only_one() {
        let user = flat_dir_with("truncated-only", "Qwen3-1.7B-Q4_K_M.gguf", 10);

        let error = resolve_from(&lock(), "lite", None, Some(&user), None)
            .expect_err("a truncated artifact must be refused");

        assert!(matches!(error, ModelResolutionError::Mismatch(_)));
        assert!(
            error.message().contains("refusing to load an unverified model"),
            "{}",
            error.message()
        );
    }

    #[test]
    fn a_stray_model_in_the_user_library_is_never_substituted() {
        // The user directory is the one place an arbitrary file can appear, so
        // the "never scan for *.gguf" rule matters most there.
        let user = flat_dir_with("stray-user", "some-other-model-Q8_0.gguf", 64);

        let error = resolve_from(&lock(), "lite", None, Some(&user), None)
            .expect_err("a stray artifact must not satisfy the lock");

        assert!(matches!(error, ModelResolutionError::Missing(_)));
        assert!(error.message().contains("Qwen3-1.7B-Q4_K_M.gguf"));
    }

    #[test]
    fn each_source_keeps_its_own_layout() {
        // Flat for packaged and user, nested for the workspace. Getting this
        // wrong silently makes one of the three sources dead.
        let user = flat_dir_with("layout", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let flat = resolve_from(&lock(), "lite", None, Some(&user), None).unwrap();
        assert_eq!(flat.path(), user.join("Qwen3-1.7B-Q4_K_M.gguf"));

        let workspace = workspace_with("layout-ws", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let nested = resolve_from(
            &lock(),
            "lite",
            None,
            None,
            Some(workspace.to_str().unwrap()),
        )
        .unwrap();
        assert_eq!(
            nested.path(),
            workspace
                .join("runtime-assets/models/lite/qwen3")
                .join("Qwen3-1.7B-Q4_K_M.gguf")
        );
    }

    /// A lock holding both profiles, each pointing at its own directory.
    fn dual_lock() -> ModelLock {
        let mut lock = lock();
        let mut standard = lock.profiles.get("lite").unwrap().clone();
        standard.profile_id = "standard".to_string();
        standard.family = "SmolLM3-3B".to_string();
        standard.artifact_filename = "SmolLM3-Q4_K_M.gguf".to_string();
        standard.external_path_relative_to_workspace_root =
            "runtime-assets/models/standard/smollm3".to_string();
        lock.profiles.insert("standard".to_string(), standard);
        lock
    }

    #[test]
    fn each_profile_resolves_to_its_own_artifact() {
        let root = std::env::temp_dir().join("chronosaga-dual-profile");
        let _ = fs::remove_dir_all(&root);
        let lite_dir = root.join("runtime-assets/models/lite/qwen3");
        let standard_dir = root.join("runtime-assets/models/standard/smollm3");
        fs::create_dir_all(&lite_dir).unwrap();
        fs::create_dir_all(&standard_dir).unwrap();
        fs::write(lite_dir.join("Qwen3-1.7B-Q4_K_M.gguf"), vec![b'l'; 64]).unwrap();
        fs::write(standard_dir.join("SmolLM3-Q4_K_M.gguf"), vec![b's'; 64]).unwrap();

        let lock = dual_lock();
        let workspace = root.to_str().unwrap();

        let lite = resolve_from(&lock, "lite", None, None, Some(workspace)).expect("lite must resolve");
        assert_eq!(lite.profile_id(), "lite");
        assert!(lite.path().ends_with("Qwen3-1.7B-Q4_K_M.gguf"));

        let standard =
            resolve_from(&lock, "standard", None, None, Some(workspace)).expect("standard must resolve");
        assert_eq!(standard.profile_id(), "standard");
        assert!(standard.path().ends_with("SmolLM3-Q4_K_M.gguf"));

        // Neither may borrow the other's artifact.
        assert_ne!(lite.path(), standard.path());
    }

    #[test]
    fn the_known_profiles_are_exactly_the_locked_ones() {
        assert_eq!(KNOWN_PROFILE_IDS, ["lite", "standard"]);
        for id in KNOWN_PROFILE_IDS {
            assert!(
                dual_lock().profiles.contains_key(id),
                "{id} must be resolvable"
            );
        }
    }

    #[test]
    fn an_unknown_profile_is_refused_rather_than_defaulted() {
        // Asking for Standard before it is locked must fail, never silently fall
        // back to Lite.
        let error = resolve_from(&lock(), "standard", None, None, Some("D:/whatever"))
            .expect_err("standard is not locked yet");
        assert!(matches!(error, ModelResolutionError::UnknownProfile(_)));
        assert!(error.message().contains("standard"));
    }

    /// Digest of a fixture, computed the same way the verifier does.
    fn digest_of(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn an_artifact_matching_the_locked_digest_is_verified() {
        let directory = std::env::temp_dir().join("chronosaga-integrity-ok");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("model.gguf");
        let bytes = b"pretend this is a gguf".to_vec();
        fs::write(&path, &bytes).unwrap();

        let resolved = ResolvedModel::for_test_with(
            "lite",
            path,
            4096,
            bytes.len() as u64,
            &digest_of(&bytes),
        );
        let verified = resolved.verify_integrity().expect("the digest matches");
        assert_eq!(verified.model().profile_id(), "lite");
    }

    #[test]
    fn a_same_size_artifact_with_the_wrong_digest_is_refused() {
        // The case size checking alone cannot catch: identical length, different
        // bytes. Nothing may launch from this.
        let directory = std::env::temp_dir().join("chronosaga-integrity-swap");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("model.gguf");

        let genuine = b"the real weights......".to_vec();
        let impostor = b"a different payload!!!".to_vec();
        assert_eq!(genuine.len(), impostor.len(), "the fixture must be same-size");
        fs::write(&path, &impostor).unwrap();

        let resolved = ResolvedModel::for_test_with(
            "lite",
            path,
            4096,
            genuine.len() as u64,
            &digest_of(&genuine),
        );
        let error = match resolved.verify_integrity() {
            Err(error) => error,
            Ok(_) => panic!("a same-size impostor must never verify"),
        };
        assert_eq!(error.expected, digest_of(&genuine));
        assert_eq!(error.found, Some(digest_of(&impostor)));
        assert!(error.message.contains("refusing to load an unverified model"));
    }

    #[test]
    fn a_missing_artifact_fails_verification_rather_than_panicking() {
        let resolved = ResolvedModel::for_test_with(
            "lite",
            PathBuf::from("/definitely/not/here/model.gguf"),
            4096,
            10,
            &digest_of(b"whatever"),
        );
        let error = match resolved.verify_integrity() {
            Err(error) => error,
            Ok(_) => panic!("a missing artifact cannot verify"),
        };
        assert!(error.found.is_none());
        assert!(error.message.contains("unable to read"));
    }

    /// A directory holding `bytes` under `name`, for source-ordering tests.
    fn source_dir(label: &str, name: &str, bytes: &[u8]) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("chronosaga-source-{label}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(name), bytes).unwrap();
        directory
    }

    /// A workspace holding `bytes` at the nested layout the lock names.
    fn workspace_dir(label: &str, name: &str, bytes: &[u8]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("chronosaga-source-ws-{label}"));
        let _ = fs::remove_dir_all(&root);
        let directory = root.join("runtime-assets/models/standard/smollm3");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(name), bytes).unwrap();
        root
    }

    /// A lock whose Standard entry expects `genuine`.
    fn lock_expecting(genuine: &[u8]) -> ModelLock {
        let mut lock = dual_lock();
        let standard = lock.profiles.get_mut("standard").unwrap();
        standard.size_bytes = genuine.len() as u64;
        standard.sha256 = digest_of(genuine);
        lock
    }

    const GENUINE: &[u8] = b"the real SmolLM3 weights";
    const IMPOSTOR: &[u8] = b"a different payload!!!!!";
    const NAME: &str = "SmolLM3-Q4_K_M.gguf";

    #[test]
    fn a_corrupt_packaged_copy_does_not_shadow_a_valid_user_copy() {
        // The exact shape Codex flagged: the packaged copy has the right name
        // and the right byte count, so cheap resolution stops there. If serving
        // resolution stopped there too, a good user copy one source further down
        // would never be tried and the profile would degrade for nothing.
        assert_eq!(GENUINE.len(), IMPOSTOR.len(), "the fixture must be same-size");
        let packaged = source_dir("corrupt-packaged", NAME, IMPOSTOR);
        let user = source_dir("valid-user", NAME, GENUINE);
        let lock = lock_expecting(GENUINE);

        // Cheap resolution still stops at the first size match, by design.
        let cheap = resolve_from(&lock, "standard", Some(&packaged), Some(&user), None).unwrap();
        assert_eq!(cheap.source(), ModelSource::Packaged);

        // Serving resolution keeps going and lands on the copy that verifies.
        let verified =
            verify_from(&lock, "standard", Some(&packaged), Some(&user), None).expect("must verify");
        assert_eq!(verified.model().source(), ModelSource::UserLibrary);
        assert!(verified.model().path().starts_with(&user));
        assert_eq!(verified.model().profile_id(), "standard");
    }

    #[test]
    fn a_corrupt_user_copy_does_not_shadow_a_valid_workspace_copy() {
        // The same rule one source further along the chain.
        let user = source_dir("corrupt-user", NAME, IMPOSTOR);
        let workspace = workspace_dir("valid-ws", NAME, GENUINE);
        let lock = lock_expecting(GENUINE);

        let verified = verify_from(
            &lock,
            "standard",
            None,
            Some(&user),
            Some(workspace.to_str().unwrap()),
        )
        .expect("must verify");

        assert_eq!(verified.model().source(), ModelSource::DevelopmentWorkspace);
        assert!(verified.model().path().starts_with(&workspace));
    }

    #[test]
    fn a_corrupt_copy_never_reaches_a_launch_contract() {
        // Whatever is served must be the verified copy and nothing else: the
        // corrupt path must not appear anywhere in the command line.
        use crate::local_ai_runtime::RuntimeConfig;

        let packaged = source_dir("never-launched", NAME, IMPOSTOR);
        let user = source_dir("launched", NAME, GENUINE);
        let lock = lock_expecting(GENUINE);

        let verified =
            verify_from(&lock, "standard", Some(&packaged), Some(&user), None).unwrap();
        let arguments = RuntimeConfig::loopback()
            .with_model(&verified)
            .launch_spec()
            .command_arguments();

        let model_flag = arguments
            .iter()
            .position(|argument| argument == "--model")
            .expect("a serving contract always carries --model");
        let served = &arguments[model_flag + 1];
        assert_eq!(served, &verified.model().path().to_string_lossy().to_string());
        assert!(served.contains("chronosaga-source-launched"));
        assert!(
            !arguments
                .iter()
                .any(|argument| argument.contains("chronosaga-source-never-launched")),
            "the corrupt copy must not appear in the command line: {arguments:?}"
        );
    }

    #[test]
    fn every_copy_being_unusable_is_reported_rather_than_guessed() {
        // When nothing verifies, the caller has to be able to tell the two cases
        // apart: bytes that exist but are wrong, and bytes that are simply not
        // there. The profile fallback chain reacts to the failure, not to the
        // reason, but the player is told which one it was.
        let packaged = source_dir("all-corrupt-packaged", NAME, IMPOSTOR);
        let user = source_dir("all-corrupt-user", NAME, IMPOSTOR);
        let lock = lock_expecting(GENUINE);

        let error = verify_from(&lock, "standard", Some(&packaged), Some(&user), None)
            .expect_err("no copy verifies");
        assert!(matches!(error, ModelResolutionError::Mismatch(_)));
        let message = error.message();
        assert!(message.contains("does not match the locked digest"), "{message}");
        assert!(message.contains("refusing to load an unverified model"), "{message}");
        assert!(message.contains("packaged"), "{message}");
        assert!(message.contains("user model library"), "{message}");

        // Nothing present at all is a different, equally explicit answer.
        let absent = source_dir("all-absent", "unrelated.txt", b"x");
        let missing = verify_from(&lock, "standard", Some(&absent), None, None)
            .expect_err("nothing to verify");
        assert!(matches!(missing, ModelResolutionError::Missing(_)));
        assert!(missing.message().contains("verify:local-ai-models"));
    }

    #[test]
    fn the_profile_chain_still_degrades_when_no_copy_of_standard_verifies() {
        // P2-A must not weaken P0.4-C: if Standard genuinely has no usable copy
        // anywhere, the chain still degrades to Lite, and to Safe Mode when Lite
        // is unusable too.
        use crate::profile_orchestrator::{
            fallback_chain, resolve_auto, summarise, HardwareSnapshot, ProfileAttempt,
            RequestedProfile,
        };

        let big = HardwareSnapshot {
            total_ram_mb: 64 * 1024,
            logical_cores: 24,
        };
        let mut lock = lock_expecting(GENUINE);
        let genuine_lite = b"the real Qwen3 weights";
        {
            let lite = lock.profiles.get_mut("lite").unwrap();
            lite.size_bytes = genuine_lite.len() as u64;
            lite.sha256 = digest_of(genuine_lite);
        }

        // Standard is corrupt everywhere; Lite is good.
        let directory = std::env::temp_dir().join("chronosaga-chain-degrades");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(NAME), IMPOSTOR).unwrap();
        fs::write(directory.join("Qwen3-1.7B-Q4_K_M.gguf"), genuine_lite).unwrap();

        let decision = resolve_auto(big, true);
        assert_eq!(decision.resolved_profile, "standard");

        let mut attempts = Vec::new();
        let mut served = None;
        for candidate in fallback_chain(&decision.resolved_profile) {
            match verify_from(&lock, &candidate, None, Some(&directory), None) {
                Ok(verified) => {
                    attempts.push(ProfileAttempt {
                        profile_id: candidate,
                        succeeded: true,
                        error: None,
                    });
                    served = Some(verified);
                    break;
                }
                Err(error) => attempts.push(ProfileAttempt {
                    profile_id: candidate,
                    succeeded: false,
                    error: Some(error.message().to_string()),
                }),
            }
        }
        let outcome = summarise(RequestedProfile::Auto, &decision, attempts);
        assert!(!outcome.safe_mode);
        assert_eq!(outcome.active_profile.as_deref(), Some("lite"));
        assert_eq!(served.unwrap().model().profile_id(), "lite");

        // Now break Lite as well: Safe Mode, exactly as before.
        fs::write(directory.join("Qwen3-1.7B-Q4_K_M.gguf"), b"not the weights......").unwrap();
        let mut attempts = Vec::new();
        for candidate in fallback_chain(&decision.resolved_profile) {
            let error = verify_from(&lock, &candidate, None, Some(&directory), None)
                .expect_err("nothing may verify now");
            attempts.push(ProfileAttempt {
                profile_id: candidate,
                succeeded: false,
                error: Some(error.message().to_string()),
            });
        }
        let outcome = summarise(RequestedProfile::Auto, &decision, attempts);
        assert!(outcome.safe_mode);
        assert!(outcome.active_profile.is_none());
    }

    #[test]
    fn auto_falls_back_when_standard_is_the_right_size_but_the_wrong_bytes() {
        // The dangerous shape, because it passes every cheap check: the exact
        // locked filename, the exact locked byte count, different contents. A
        // half-finished download or a swapped file looks like this.
        //
        // Resolution must accept it, because resolution is only a location
        // claim. The digest is what has to stop it, and it has to stop it before
        // anything can be launched from it. This walks the same chain
        // apply_local_ai_profile walks, with real files on disk.
        use crate::local_ai_runtime::{serving_start_verdict, RuntimeConfig};
        use crate::profile_orchestrator::{
            fallback_chain, resolve_auto, summarise, HardwareSnapshot, ProfileAttempt,
            RequestedProfile,
        };

        let directory = std::env::temp_dir().join("chronosaga-auto-corrupt-standard");
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();

        let genuine_standard = b"the real SmolLM3 weights".to_vec();
        let impostor_standard = b"a different payload!!!!!".to_vec();
        assert_eq!(
            genuine_standard.len(),
            impostor_standard.len(),
            "the fixture only means something if the sizes match"
        );
        let genuine_lite = b"the real Qwen3 weights".to_vec();

        fs::write(directory.join("SmolLM3-Q4_K_M.gguf"), &impostor_standard).unwrap();
        fs::write(directory.join("Qwen3-1.7B-Q4_K_M.gguf"), &genuine_lite).unwrap();

        let mut lock = dual_lock();
        {
            let lite = lock.profiles.get_mut("lite").unwrap();
            lite.size_bytes = genuine_lite.len() as u64;
            lite.sha256 = digest_of(&genuine_lite);
        }
        {
            let standard = lock.profiles.get_mut("standard").unwrap();
            standard.size_bytes = genuine_standard.len() as u64;
            standard.sha256 = digest_of(&genuine_standard);
        }

        // AUTO sees a machine that comfortably qualifies for Standard, and an
        // artifact that resolves. Resolution alone cannot tell it is corrupt.
        let standard_resolves =
            resolve_from(&lock, "standard", None, Some(&directory), None).is_ok();
        assert!(
            standard_resolves,
            "name and size are correct, so resolution must succeed"
        );

        let decision = resolve_auto(
            HardwareSnapshot {
                total_ram_mb: 64 * 1024,
                logical_cores: 24,
            },
            standard_resolves,
        );
        assert_eq!(decision.resolved_profile, "standard");

        // Walk the product's chain: resolve, verify, and only then serve.
        let mut attempts = Vec::new();
        let mut serving = None;
        for candidate in fallback_chain(&decision.resolved_profile) {
            let resolved =
                resolve_from(&lock, &candidate, None, Some(&directory), None).expect("resolvable");
            match resolved.verify_integrity() {
                Ok(verified) => {
                    attempts.push(ProfileAttempt {
                        profile_id: candidate,
                        succeeded: true,
                        error: None,
                    });
                    serving = Some(verified);
                    break;
                }
                Err(error) => attempts.push(ProfileAttempt {
                    profile_id: candidate,
                    succeeded: false,
                    error: Some(error.message),
                }),
            }
        }

        // The corrupt Standard never became a VerifiedModel.
        assert_eq!(attempts[0].profile_id, "standard");
        assert!(!attempts[0].succeeded);
        assert!(
            attempts[0]
                .error
                .as_deref()
                .is_some_and(|message| message.contains("refusing to load an unverified model")),
            "{:?}",
            attempts[0].error
        );

        // The fallback reached a Lite that really did verify.
        let serving = serving.expect("Lite must serve");
        assert_eq!(serving.model().profile_id(), "lite");

        let outcome = summarise(RequestedProfile::Auto, &decision, attempts);
        assert!(!outcome.safe_mode, "Lite verified, so this is not Safe Mode");
        assert_eq!(outcome.active_profile.as_deref(), Some("lite"));
        assert!(
            outcome.fallback_reason.is_some(),
            "a degraded session must say why"
        );

        // Whatever is served is served with --model, pointing at the verified
        // artifact and at nothing else. This is the router-mode guarantee: the
        // only launch contract that can exist here carries a model, and one
        // without a model is refused before any spawn.
        let spec = RuntimeConfig::loopback().with_model(&serving).launch_spec();
        let arguments = spec.command_arguments();
        let model_flag = arguments
            .iter()
            .position(|argument| argument == "--model")
            .expect("every spawn must carry --model");
        assert_eq!(
            arguments[model_flag + 1],
            serving.model().path().to_string_lossy()
        );
        assert!(serving_start_verdict(spec.model().is_some()).is_ok());
        assert!(
            serving_start_verdict(RuntimeConfig::loopback().launch_spec().model().is_some())
                .is_err(),
            "a model-less contract must still be refused"
        );
    }

    #[test]
    fn the_shipped_lock_file_parses_and_declares_lite() {
        // Guards the real config against drifting away from this struct.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../")
            .join(MODEL_LOCK_RELATIVE_PATH);
        let contents = fs::read_to_string(&path).expect("the repository lock must be readable");
        let lock: ModelLock = serde_json::from_str(&contents).expect("the lock must parse");

        for id in KNOWN_PROFILE_IDS {
            assert!(
                lock.profiles.contains_key(id),
                "the shipped lock must declare the '{id}' profile"
            );
        }

        let standard = lock
            .profiles
            .get(STANDARD_PROFILE_ID)
            .expect("standard must be locked");
        assert_eq!(standard.family, "SmolLM3-3B");
        assert_eq!(standard.quantization, "Q4_K_M");
        assert_eq!(standard.size_bytes, 1_915_305_312);
        assert_eq!(
            standard.sha256,
            "8334b850b7bd46238c16b0c550df2138f0889bf433809008cc17a8b05761863e"
        );
        assert!(
            !standard.release_approved,
            "Standard is a benchmark candidate, not an approved release model"
        );

        let lite = lock.profiles.get(LITE_PROFILE_ID).expect("lite must be locked");
        assert_eq!(lite.profile_id, "lite");
        assert_eq!(lite.family, "Qwen3-1.7B");
        assert_eq!(lite.quantization, "Q4_K_M");
        assert_eq!(lite.license, "Apache-2.0");
        assert_eq!(lite.size_bytes, 1_282_439_264);
        assert_eq!(
            lite.sha256,
            "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5"
        );
        assert!(
            !lite.release_approved,
            "a P0 benchmark candidate must never claim release approval"
        );
    }
}
