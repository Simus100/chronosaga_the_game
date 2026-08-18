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

/// The subset of the lock this process needs to find the runtime on disk.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLock {
    pub release_tag: String,
    pub external_path_relative_to_workspace_root: String,
    pub expected_executable_name: String,
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
    let mut candidates = Vec::new();
    if let Ok(bundled) = app.path().resolve(LOCK_RELATIVE_PATH, BaseDirectory::Resource) {
        candidates.push(bundled);
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../")
            .join(LOCK_RELATIVE_PATH),
    );

    let path = candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| format!("No {LOCK_RELATIVE_PATH} found in resources or checkout"))?;

    let contents = fs::read_to_string(&path)
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
        }
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
