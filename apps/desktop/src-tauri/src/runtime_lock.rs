//! Resolve the locked local AI runtime from the provenance lock.
//!
//! The release tag, directory layout and executable name live in
//! `config/local-ai-runtime.lock.json`, which `scripts/verify-local-ai-runtime.mjs`
//! also reads. Duplicating any of them here would let the two drift apart, so
//! this module derives everything from the lock and the workspace environment
//! variable, and reports why resolution failed instead of guessing.
//!
//! Nothing here downloads or repairs: an unresolvable runtime simply leaves the
//! lifecycle manager `Unavailable`, and gameplay falls back to procedural.

use serde::Deserialize;
use std::{env, fs, path::PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager};

/// Environment variable naming the development workspace root.
///
/// PROVISIONAL convention from `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`.
pub const WORKSPACE_ROOT_ENV: &str = "CHRONOSAGA_WORKSPACE_ROOT";

const LOCK_RELATIVE_PATH: &str = "config/local-ai-runtime.lock.json";

/// The subset of the lock this process needs to find the runtime on disk.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLock {
    release_tag: String,
    external_path_relative_to_workspace_root: String,
    expected_executable_name: String,
}

/// Where the runtime lives, and how we got there.
#[derive(Debug, Clone)]
pub struct ResolvedRuntime {
    /// Directory holding the executable and its DLLs. Used as the child's
    /// working directory so the distribution stays self-contained.
    pub directory: PathBuf,
    pub executable: PathBuf,
    pub release_tag: String,
}

/// Locate the lock file: packaged resource first, development checkout second.
fn lock_path(app: &AppHandle) -> PathBuf {
    if let Ok(bundled) = app.path().resolve(LOCK_RELATIVE_PATH, BaseDirectory::Resource) {
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../").join(LOCK_RELATIVE_PATH)
}

/// Resolve the locked runtime, or explain what is missing.
///
/// The error strings surface in the runtime snapshot, so they name the thing the
/// developer has to fix rather than saying "not found".
pub fn resolve(app: &AppHandle) -> Result<ResolvedRuntime, String> {
    let path = lock_path(app);
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    let lock: RuntimeLock = serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse {}: {error}", path.display()))?;

    let workspace_root = env::var(WORKSPACE_ROOT_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "{WORKSPACE_ROOT_ENV} is not set, so the external {} runtime cannot be located",
                lock.release_tag
            )
        })?;

    let directory = PathBuf::from(workspace_root).join(&lock.external_path_relative_to_workspace_root);
    if !directory.is_dir() {
        return Err(format!(
            "Runtime directory {} does not exist; run `pnpm verify:local-ai-runtime`",
            directory.display()
        ));
    }

    let executable = directory.join(&lock.expected_executable_name);
    if !executable.is_file() {
        return Err(format!(
            "{} is missing from {}; run `pnpm verify:local-ai-runtime`",
            lock.expected_executable_name,
            directory.display()
        ));
    }

    Ok(ResolvedRuntime {
        directory,
        executable,
        release_tag: lock.release_tag,
    })
}
