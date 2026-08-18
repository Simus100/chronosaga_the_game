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
//! P0.3-C resolves `lite` only. The schema already carries a map of profiles so
//! Standard slots in later without a redesign.

use serde::Deserialize;
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::runtime_lock::WORKSPACE_ROOT_ENV;

/// Repository- and resource-relative location of the model lock.
pub const MODEL_LOCK_RELATIVE_PATH: &str = "config/local-ai-models.lock.json";

/// The profile P0.3-C implements.
pub const LITE_PROFILE_ID: &str = "lite";

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

/// A model that exists on disk and matches its lock entry well enough to launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedModel {
    pub profile_id: String,
    pub path: PathBuf,
    pub family: String,
    pub quantization: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license: String,
    pub context_target: u32,
    pub release_approved: bool,
    /// Candidate status carried through from the lock, so diagnostics can show
    /// that this is not an approved release model.
    pub status: String,
    pub artifact_repository: String,
    pub artifact_revision: String,
}

impl ResolvedModel {
    /// Short label for diagnostics, e.g. `Qwen3-1.7B Q4_K_M`.
    pub fn label(&self) -> String {
        format!("{} {}", self.family, self.quantization)
    }
}

/// Why a locked model could not be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelResolutionError {
    /// No workspace root, so nothing can be located.
    WorkspaceUnavailable(String),
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
            Self::WorkspaceUnavailable(m)
            | Self::UnknownProfile(m)
            | Self::Missing(m)
            | Self::Mismatch(m) => m,
        }
    }
}

/// Size of the artifact on disk, or `None` when it is not a file.
fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// Resolve one profile against a workspace root.
///
/// Pure apart from the filesystem, and independent of Tauri, so the decision
/// table is testable without a 1.28 GB artifact.
///
/// Deliberately checks size and not the digest: hashing 1.28 GB on every app
/// start would add seconds to launch for no extra safety that
/// `pnpm verify:local-ai-models` does not already provide before the model is
/// installed. Size catches the realistic local accidents — truncated copy, wrong
/// quantization, empty placeholder — and the digest stays the packaging gate.
pub fn resolve_profile(
    lock: &ModelLock,
    profile_id: &str,
    workspace_root: Option<&str>,
) -> Result<ResolvedModel, ModelResolutionError> {
    let Some(locked) = lock.profiles.get(profile_id) else {
        return Err(ModelResolutionError::UnknownProfile(format!(
            "the model lock declares no '{profile_id}' profile"
        )));
    };

    let Some(root) = workspace_root.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(ModelResolutionError::WorkspaceUnavailable(format!(
            "{WORKSPACE_ROOT_ENV} is not set, so the {profile_id} model cannot be located"
        )));
    };

    let directory = Path::new(root).join(&locked.external_path_relative_to_workspace_root);
    let path = directory.join(&locked.artifact_filename);

    let Some(size) = file_size(&path) else {
        return Err(ModelResolutionError::Missing(format!(
            "{} is missing at {}; run `pnpm verify:local-ai-models`",
            locked.artifact_filename,
            path.display()
        )));
    };

    if size != locked.size_bytes {
        return Err(ModelResolutionError::Mismatch(format!(
            "{} is {size} bytes but the lock expects {}; refusing to load an unverified model",
            locked.artifact_filename, locked.size_bytes
        )));
    }

    Ok(ResolvedModel {
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
    })
}

/// Read the model lock, preferring a packaged copy when one exists.
pub fn load_lock(app: &AppHandle) -> Result<ModelLock, String> {
    let mut candidates = Vec::new();
    if let Ok(bundled) = app
        .path()
        .resolve(MODEL_LOCK_RELATIVE_PATH, BaseDirectory::Resource)
    {
        candidates.push(bundled);
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../")
            .join(MODEL_LOCK_RELATIVE_PATH),
    );

    let path = candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| format!("No {MODEL_LOCK_RELATIVE_PATH} found in resources or checkout"))?;

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse {}: {error}", path.display()))
}

/// Resolve the Lite model for this application instance.
///
/// P0.3-C never packages the weights, so this is workspace-only for now. The
/// packaged path is prepared by [`load_lock`] reading a bundled lock first.
pub fn resolve_lite(app: &AppHandle) -> Result<ResolvedModel, ModelResolutionError> {
    let lock = load_lock(app).map_err(ModelResolutionError::Missing)?;
    let workspace = env::var(WORKSPACE_ROOT_ENV).ok();
    resolve_profile(&lock, LITE_PROFILE_ID, workspace.as_deref())
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
            resolve_profile(&lock(), "lite", Some(root.to_str().unwrap())).expect("must resolve");

        assert_eq!(resolved.profile_id, "lite");
        assert_eq!(resolved.label(), "Qwen3-1.7B Q4_K_M");
        assert_eq!(resolved.context_target, 4096);
        assert!(!resolved.release_approved, "a candidate is not release approved");
        assert!(resolved.path.ends_with("Qwen3-1.7B-Q4_K_M.gguf"));
    }

    #[test]
    fn resolution_is_deterministic_for_the_same_workspace() {
        let root = workspace_with("deterministic", "Qwen3-1.7B-Q4_K_M.gguf", 64);
        let first = resolve_profile(&lock(), "lite", Some(root.to_str().unwrap())).unwrap();
        let second = resolve_profile(&lock(), "lite", Some(root.to_str().unwrap())).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn a_missing_artifact_is_reported_not_guessed() {
        let root = std::env::temp_dir().join("chronosaga-model-test-empty");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("runtime-assets/models/lite/qwen3")).unwrap();

        let error = resolve_profile(&lock(), "lite", Some(root.to_str().unwrap()))
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

        let error = resolve_profile(&lock(), "lite", Some(root.to_str().unwrap()))
            .expect_err("a stray artifact must not satisfy the lock");
        assert!(matches!(error, ModelResolutionError::Missing(_)));
        assert!(error.message().contains("Qwen3-1.7B-Q4_K_M.gguf"));
    }

    #[test]
    fn an_artifact_of_the_wrong_size_is_refused() {
        let root = workspace_with("truncated", "Qwen3-1.7B-Q4_K_M.gguf", 10);

        let error = resolve_profile(&lock(), "lite", Some(root.to_str().unwrap()))
            .expect_err("a truncated artifact must be refused");
        assert!(matches!(error, ModelResolutionError::Mismatch(_)));
        assert!(
            error.message().contains("refusing to load an unverified model"),
            "unexpected message: {}",
            error.message()
        );
    }

    #[test]
    fn no_workspace_means_no_model() {
        let error = resolve_profile(&lock(), "lite", None).expect_err("nothing to resolve");
        assert!(matches!(error, ModelResolutionError::WorkspaceUnavailable(_)));
        assert!(error.message().contains(WORKSPACE_ROOT_ENV));

        let blank = resolve_profile(&lock(), "lite", Some("   ")).expect_err("blank is not a path");
        assert!(matches!(blank, ModelResolutionError::WorkspaceUnavailable(_)));
    }

    #[test]
    fn an_unknown_profile_is_refused_rather_than_defaulted() {
        // Asking for Standard before it is locked must fail, never silently fall
        // back to Lite.
        let error = resolve_profile(&lock(), "standard", Some("D:/whatever"))
            .expect_err("standard is not locked yet");
        assert!(matches!(error, ModelResolutionError::UnknownProfile(_)));
        assert!(error.message().contains("standard"));
    }

    #[test]
    fn the_shipped_lock_file_parses_and_declares_lite() {
        // Guards the real config against drifting away from this struct.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../")
            .join(MODEL_LOCK_RELATIVE_PATH);
        let contents = fs::read_to_string(&path).expect("the repository lock must be readable");
        let lock: ModelLock = serde_json::from_str(&contents).expect("the lock must parse");

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
