//! Resolve the locked local AI runtime, packaged copy first.
//!
//! The release tag, directory layout and executable name live in
//! `config/local-ai-runtime.lock.json`, which `scripts/verify-local-ai-runtime.mjs`
//! and `scripts/stage-local-ai-runtime.mjs` also read. Duplicating any of them
//! here would let the three drift apart, so everything is derived from the lock.
//!
//! Resolution order is deliberate:
//!
//! 1. **Packaged** — `resources/local-ai-runtime/`, what the installer ships.
//! 2. **Development workspace** — `CHRONOSAGA_WORKSPACE_ROOT` plus the path the
//!    lock names, for working from a checkout.
//! 3. **Unavailable** — reported with both reasons, never guessed at.
//!
//! An installed Chronosaga therefore runs without any environment variable, and
//! a machine that has both prefers the copy it shipped with. Nothing here
//! downloads, repairs, or falls back to a different release.

use serde::Deserialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

/// Environment variable naming the development workspace root.
pub const WORKSPACE_ROOT_ENV: &str = "CHRONOSAGA_WORKSPACE_ROOT";

/// Resource-relative location of the packaged runtime directory.
pub const PACKAGED_RUNTIME_DIR: &str = "local-ai-runtime";

/// Repository- and resource-relative location of the provenance lock.
pub const LOCK_RELATIVE_PATH: &str = "config/local-ai-runtime.lock.json";

/// Locate a metadata file the installer is expected to ship.
///
/// Both provenance locks are small JSON files that must travel inside the
/// installer. Where a build is allowed to look for them is a release-safety
/// question, not a convenience one:
///
/// * a **release** build has exactly one candidate, the packaged resource
///   directory. If it is not there the build is incomplete, and the honest
///   answer is a loud failure rather than a quiet success;
/// * a **debug** build additionally accepts the source checkout, so `tauri dev`
///   works without staging resources first.
///
/// The distinction is enforced by `cfg(debug_assertions)` rather than by an
/// environment variable, because a shipped binary must not be talkable into
/// reading a developer's disk. This is the defect P0.4-D3 closes: an installed
/// build was resolving its model lock out of `D:\Chronosaga\repo\...`, which
/// made the installer look self-contained on the one machine where it was not.
pub fn packaged_metadata_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resolve(relative_path, BaseDirectory::Resource)
        .ok();

    metadata_candidates(packaged, relative_path)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| missing_metadata_message(relative_path))
}

/// The ordered places a build may read packaged metadata from.
fn metadata_candidates(packaged: Option<PathBuf>, relative_path: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = packaged {
        candidates.push(path);
    }
    if let Some(path) = development_checkout_path(relative_path) {
        candidates.push(path);
    }
    candidates
}

/// The source-checkout copy. Compiled into debug builds only.
#[cfg(debug_assertions)]
fn development_checkout_path(relative_path: &str) -> Option<PathBuf> {
    Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../")
            .join(relative_path),
    )
}

/// Release builds have no development candidate at all.
#[cfg(not(debug_assertions))]
fn development_checkout_path(_relative_path: &str) -> Option<PathBuf> {
    None
}

fn missing_metadata_message(relative_path: &str) -> String {
    if cfg!(debug_assertions) {
        format!(
            "{relative_path} was found neither in the packaged resources nor in the source \
             checkout; run the build from the repository or stage the resources first"
        )
    } else {
        format!(
            "{relative_path} is missing from this installation's resources. The build is \
             incomplete: local AI metadata cannot be trusted and no model will be loaded."
        )
    }
}

/// The subset of the lock this process needs to find the runtime on disk.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLock {
    pub release_tag: String,
    pub external_path_relative_to_workspace_root: String,
    pub expected_executable_name: String,
    /// Digest of the `llama-server.exe` this release is locked to.
    ///
    /// Already verified by `pnpm verify:local-ai-runtime`; carried here so a
    /// benchmark run can record which runtime produced its numbers without
    /// re-deriving it or, worse, writing it down by hand somewhere else.
    ///
    /// The P0.5 benchmark is its only consumer and is test-only for P0.5-A, so
    /// the field is gated the same way. Promoting the runner to production in
    /// P0.5-B means deleting this attribute, which is a visible edit rather than
    /// a silent one.
    #[cfg(test)]
    pub executable_sha256: String,
}

/// Which copy of the runtime was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeSource {
    /// Shipped inside the installer.
    Packaged,
    /// Read from the external development workspace.
    DevelopmentWorkspace,
}

impl RuntimeSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::Packaged => "packaged",
            Self::DevelopmentWorkspace => "development workspace",
        }
    }
}

/// Where the runtime lives, and how we got there.
#[derive(Debug, Clone)]
pub struct ResolvedRuntime {
    /// Directory holding the executable and its DLLs. Used as the child's
    /// working directory so the distribution stays self-contained — no PATH
    /// changes and nothing installed into the system.
    pub directory: PathBuf,
    pub executable: PathBuf,
    pub release_tag: String,
    pub source: RuntimeSource,
}

/// Pure resolution, independent of Tauri so it can be tested without an app.
///
/// `packaged_dir` is the resource directory if the installer shipped one.
pub fn resolve_from(
    lock: &RuntimeLock,
    packaged_dir: Option<&Path>,
    workspace_root: Option<&str>,
) -> Result<ResolvedRuntime, String> {
    let mut reasons = Vec::new();

    if let Some(directory) = packaged_dir {
        let executable = directory.join(&lock.expected_executable_name);
        if executable.is_file() {
            return Ok(ResolvedRuntime {
                directory: directory.to_path_buf(),
                executable,
                release_tag: lock.release_tag.clone(),
                source: RuntimeSource::Packaged,
            });
        }
        reasons.push(format!(
            "packaged runtime not found at {}",
            executable.display()
        ));
    } else {
        reasons.push("no packaged runtime directory in this build".to_string());
    }

    match workspace_root.map(str::trim).filter(|value| !value.is_empty()) {
        Some(root) => {
            let directory = Path::new(root).join(&lock.external_path_relative_to_workspace_root);
            let executable = directory.join(&lock.expected_executable_name);
            if executable.is_file() {
                return Ok(ResolvedRuntime {
                    directory,
                    executable,
                    release_tag: lock.release_tag.clone(),
                    source: RuntimeSource::DevelopmentWorkspace,
                });
            }
            reasons.push(format!(
                "development runtime not found at {}; run `pnpm verify:local-ai-runtime`",
                executable.display()
            ));
        }
        None => reasons.push(format!("{WORKSPACE_ROOT_ENV} is not set")),
    }

    Err(format!(
        "llama.cpp {} could not be located: {}",
        lock.release_tag,
        reasons.join("; ")
    ))
}

/// Read the lock, preferring the copy the installer shipped.
pub fn load_lock(app: &AppHandle) -> Result<RuntimeLock, String> {
    read_lock(&packaged_metadata_path(app, LOCK_RELATIVE_PATH)?)
}

/// Read and parse the runtime lock from a path.
///
/// The single interpretation of this file. Test harnesses that need the same
/// facts call this rather than reaching for `serde_json::Value` and picking out
/// keys by hand, which is how two readers of one file start to disagree.
pub fn read_lock(path: &Path) -> Result<RuntimeLock, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse {}: {error}", path.display()))
}

/// Resolve the locked runtime for this application instance.
pub fn resolve(app: &AppHandle) -> Result<ResolvedRuntime, String> {
    let lock = load_lock(app)?;
    let packaged = app
        .path()
        .resolve(PACKAGED_RUNTIME_DIR, BaseDirectory::Resource)
        .ok();
    let workspace = env::var(WORKSPACE_ROOT_ENV).ok();

    resolve_from(&lock, packaged.as_deref(), workspace.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn lock() -> RuntimeLock {
        RuntimeLock {
            release_tag: "b10343".to_string(),
            external_path_relative_to_workspace_root:
                "runtime-assets/runtime/llama.cpp/b10343/win-cpu-x64".to_string(),
            expected_executable_name: "llama-server.exe".to_string(),
            executable_sha256:
                "7a110e56e47fab319791c1f450321ecb77449a372e4c75db68d69069e7cd531e".to_string(),
        }
    }

    #[test]
    fn the_shipped_lock_declares_the_executable_digest() {
        // Benchmark provenance reads this field, so it has to exist in the real
        // file rather than only in a fixture.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../config/local-ai-runtime.lock.json");
        let shipped = read_lock(&path).expect("the shipped runtime lock must parse");
        assert_eq!(shipped.executable_sha256.len(), 64);
        assert!(shipped.executable_sha256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!shipped.release_tag.is_empty());
    }

    /// Build a throwaway directory containing a fake executable and DLL, so the
    /// tests never need the real 30 MB payload.
    fn fake_runtime(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("chronosaga-lock-test-{label}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("llama-server.exe"), b"fake").unwrap();
        fs::write(directory.join("llama.dll"), b"fake").unwrap();
        directory
    }

    #[test]
    fn the_packaged_runtime_wins_over_the_development_workspace() {
        let packaged = fake_runtime("packaged-wins");
        let workspace = std::env::temp_dir().join("chronosaga-lock-test-workspace-wins");
        let dev_dir = workspace.join(&lock().external_path_relative_to_workspace_root);
        fs::create_dir_all(&dev_dir).unwrap();
        fs::write(dev_dir.join("llama-server.exe"), b"fake").unwrap();

        let resolved = resolve_from(
            &lock(),
            Some(&packaged),
            Some(workspace.to_str().unwrap()),
        )
        .expect("both are present, so resolution must succeed");

        assert_eq!(resolved.source, RuntimeSource::Packaged);
        assert_eq!(resolved.directory, packaged);
        assert_eq!(resolved.release_tag, "b10343");
    }

    #[test]
    fn the_workspace_is_used_when_nothing_was_packaged() {
        let workspace = std::env::temp_dir().join("chronosaga-lock-test-dev-only");
        let dev_dir = workspace.join(&lock().external_path_relative_to_workspace_root);
        let _ = fs::remove_dir_all(&workspace);
        fs::create_dir_all(&dev_dir).unwrap();
        fs::write(dev_dir.join("llama-server.exe"), b"fake").unwrap();

        let resolved = resolve_from(&lock(), None, Some(workspace.to_str().unwrap()))
            .expect("the development runtime must be found");

        assert_eq!(resolved.source, RuntimeSource::DevelopmentWorkspace);
        assert_eq!(resolved.directory, dev_dir);
    }

    #[test]
    fn a_missing_packaged_runtime_falls_back_to_the_workspace() {
        let empty_packaged = std::env::temp_dir().join("chronosaga-lock-test-empty-package");
        let _ = fs::remove_dir_all(&empty_packaged);
        fs::create_dir_all(&empty_packaged).unwrap();

        let workspace = std::env::temp_dir().join("chronosaga-lock-test-fallback");
        let dev_dir = workspace.join(&lock().external_path_relative_to_workspace_root);
        let _ = fs::remove_dir_all(&workspace);
        fs::create_dir_all(&dev_dir).unwrap();
        fs::write(dev_dir.join("llama-server.exe"), b"fake").unwrap();

        let resolved = resolve_from(
            &lock(),
            Some(&empty_packaged),
            Some(workspace.to_str().unwrap()),
        )
        .expect("the workspace must take over");

        assert_eq!(resolved.source, RuntimeSource::DevelopmentWorkspace);
    }

    #[test]
    fn an_installed_app_needs_no_workspace_variable() {
        let packaged = fake_runtime("no-env");
        let resolved = resolve_from(&lock(), Some(&packaged), None)
            .expect("a packaged runtime must resolve without the environment variable");

        assert_eq!(resolved.source, RuntimeSource::Packaged);
        assert_eq!(resolved.executable, packaged.join("llama-server.exe"));
    }

    #[test]
    fn the_executable_always_sits_in_the_directory_used_as_working_directory() {
        // The DLLs live beside the executable, so the two must never diverge:
        // llama-server.exe is a shim and cannot start without them.
        let packaged = fake_runtime("colocated");
        let resolved = resolve_from(&lock(), Some(&packaged), None).unwrap();

        assert_eq!(
            resolved.executable.parent().unwrap(),
            resolved.directory,
            "the working directory must be the directory holding the DLLs"
        );
        assert!(resolved.directory.join("llama.dll").is_file());
    }

    #[test]
    fn neither_source_available_reports_both_reasons() {
        let error = resolve_from(&lock(), None, None).expect_err("nothing to resolve");

        assert!(error.contains("b10343"), "the error must name the release");
        assert!(error.contains("no packaged runtime"), "unexpected error: {error}");
        assert!(error.contains(WORKSPACE_ROOT_ENV), "unexpected error: {error}");
    }

    #[test]
    fn a_release_build_has_no_development_candidate() {
        // The whole point of P0.4-D3: a shipped binary may look in exactly one
        // place. If this ever regresses, an installed app can start reading a
        // developer's checkout again and the installer stops being provable.
        assert_eq!(
            development_checkout_path(LOCK_RELATIVE_PATH).is_some(),
            cfg!(debug_assertions),
            "the source-checkout candidate must exist in debug builds and only there"
        );
    }

    #[test]
    fn the_packaged_copy_is_always_tried_first() {
        let packaged = PathBuf::from("C:/install/config/local-ai-runtime.lock.json");
        let candidates = metadata_candidates(Some(packaged.clone()), LOCK_RELATIVE_PATH);

        assert_eq!(candidates.first(), Some(&packaged));
        assert_eq!(candidates.len(), if cfg!(debug_assertions) { 2 } else { 1 });
    }

    #[test]
    fn a_missing_packaged_lock_names_the_build_as_incomplete() {
        // The message a player would see. It must point at the installation,
        // not at a machine they do not have.
        let message = missing_metadata_message(LOCK_RELATIVE_PATH);
        assert!(message.contains(LOCK_RELATIVE_PATH), "{message}");
        if !cfg!(debug_assertions) {
            assert!(message.contains("installation"), "{message}");
            assert!(!message.contains("checkout"), "{message}");
        }
    }

    #[test]
    fn an_empty_workspace_variable_counts_as_unset() {
        let error = resolve_from(&lock(), None, Some("   ")).expect_err("blank is not a path");
        assert!(error.contains(WORKSPACE_ROOT_ENV));
    }

    #[test]
    fn resolution_never_falls_back_to_the_legacy_resources_bin_path() {
        // P0.3-B2A probed resources/bin/llama-server.exe. That convention is
        // gone: a build that only has the old layout must report Unavailable
        // rather than quietly finding a runtime nobody verified.
        let legacy = std::env::temp_dir().join("chronosaga-lock-test-legacy");
        let bin = legacy.join("bin");
        let _ = fs::remove_dir_all(&legacy);
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("llama-server.exe"), b"fake").unwrap();

        let error = resolve_from(&lock(), Some(&legacy), None)
            .expect_err("resources/bin must not be searched any more");
        assert!(error.contains("packaged runtime not found"));
    }
}
