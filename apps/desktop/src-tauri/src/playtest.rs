//! Founder-playtest evidence on disk (GQP-D).
//!
//! The interface records telemetry and the playtest bundle; this module only
//! writes it. Everything lands in one place, local to the machine:
//!
//! ```text
//! <app local data>/playtest/<session id>/
//!   telemetry.jsonl   one JSON record per line, appended
//!   summary.json      rewritten as the session goes
//!   build.json        the build being played
//!   final_save.json   the world at export, as the save boundary wrote it
//!   founder_answers.json / founder_answers.md
//! ```
//!
//! Nothing here leaves the machine and nothing here is read back by the game:
//! telemetry is not gameplay authority. Rust does not parse the content, in
//! the same way it treats save payloads as opaque.
//!
//! The interface chooses only a session id and one of a fixed set of file
//! names. Both are validated, so no value from the web side can name a path
//! outside the session directory.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

/// The directory under the app's local data directory that holds every session.
pub const PLAYTEST_DIR: &str = "playtest";

/// The only files a session may contain.
pub const PLAYTEST_FILES: [&str; 6] = [
    "telemetry.jsonl",
    "summary.json",
    "build.json",
    "final_save.json",
    "founder_answers.json",
    "founder_answers.md",
];

/// A single telemetry line may not exceed this. A beat with a World Tick delta
/// is a few tens of kilobytes; anything near this is a bug, not a record.
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

/// A whole bundle file (the final save included) may not exceed this.
const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;

/// A session id names a directory: letters, digits, `_` and `-`, at most 80.
pub fn validate_session_id(session_id: &str) -> Result<(), String> {
    let valid = !session_id.is_empty()
        && session_id.len() <= 80
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid playtest session id: {session_id:?}"))
    }
}

pub fn validate_file_name(file_name: &str) -> Result<(), String> {
    if PLAYTEST_FILES.contains(&file_name) {
        Ok(())
    } else {
        Err(format!("Not a playtest file: {file_name:?}"))
    }
}

/// The session directory under `root` (the app's local data directory).
pub fn session_dir(root: &Path, session_id: &str) -> Result<PathBuf, String> {
    validate_session_id(session_id)?;
    Ok(root.join(PLAYTEST_DIR).join(session_id))
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir)
        .map_err(|error| format!("Unable to create playtest directory {}: {error}", dir.display()))
}

/// Append one record to the session's `telemetry.jsonl`.
///
/// A line may not contain a line break: JSONL is one record per line, and a
/// record that splits would corrupt every reader of the file.
pub fn append_line(root: &Path, session_id: &str, line: &str) -> Result<PathBuf, String> {
    if line.contains('\n') || line.contains('\r') {
        return Err("A telemetry record must be a single line".to_string());
    }
    if line.len() > MAX_LINE_BYTES {
        return Err(format!("Telemetry record too large ({} bytes)", line.len()));
    }
    let dir = session_dir(root, session_id)?;
    ensure_dir(&dir)?;
    let path = dir.join("telemetry.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Unable to open {}: {error}", path.display()))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| format!("Unable to append to {}: {error}", path.display()))?;
    Ok(path)
}

/// Write (or replace) one bundle file. Written beside, then renamed, so a
/// reader never sees half a summary.
pub fn write_file(root: &Path, session_id: &str, file_name: &str, content: &str) -> Result<PathBuf, String> {
    validate_file_name(file_name)?;
    if file_name == "telemetry.jsonl" {
        return Err("telemetry.jsonl is append-only".to_string());
    }
    if content.len() > MAX_FILE_BYTES {
        return Err(format!("Playtest file too large ({} bytes)", content.len()));
    }
    let dir = session_dir(root, session_id)?;
    ensure_dir(&dir)?;
    let path = dir.join(file_name);
    let partial = dir.join(format!("{file_name}.partial"));
    fs::write(&partial, content.as_bytes())
        .map_err(|error| format!("Unable to write {}: {error}", partial.display()))?;
    fs::rename(&partial, &path).map_err(|error| format!("Unable to replace {}: {error}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(tag: &str) -> PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("chronosaga-playtest-{tag}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn appends_one_record_per_line_inside_the_session_directory() {
        let root = temp_root("append");
        let path = append_line(&root, "session_20261002-101500_abc123", r#"{"type":"beat","beatIndex":1}"#).unwrap();
        append_line(&root, "session_20261002-101500_abc123", r#"{"type":"beat","beatIndex":2}"#).unwrap();
        assert_eq!(path, root.join("playtest").join("session_20261002-101500_abc123").join("telemetry.jsonl"));
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "{\"type\":\"beat\",\"beatIndex\":1}\n{\"type\":\"beat\",\"beatIndex\":2}\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_record_that_would_split_across_lines() {
        let root = temp_root("split");
        assert!(append_line(&root, "s1", "{\"a\":1}\n{\"b\":2}").is_err());
        assert!(append_line(&root, "s1", "{\"a\":1}\r").is_err());
        assert!(!root.join("playtest").join("s1").join("telemetry.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_session_ids_that_could_name_another_path() {
        let root = temp_root("ids");
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:", "session id", "s.json"] {
            assert!(append_line(&root, bad, "{}").is_err(), "accepted {bad:?}");
            assert!(write_file(&root, bad, "summary.json", "{}").is_err(), "accepted {bad:?}");
        }
        assert!(validate_session_id(&"x".repeat(81)).is_err());
        assert!(!root.join("playtest").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_only_the_known_bundle_files() {
        let root = temp_root("files");
        for file in ["summary.json", "build.json", "final_save.json", "founder_answers.json", "founder_answers.md"] {
            let path = write_file(&root, "s1", file, "content").unwrap();
            assert_eq!(fs::read_to_string(path).unwrap(), "content");
        }
        for bad in ["../summary.json", "evil.exe", "summary.json.partial", "", "telemetry.jsonl"] {
            assert!(write_file(&root, "s1", bad, "x").is_err(), "accepted {bad:?}");
        }
        // Replacing a file leaves no partial behind.
        write_file(&root, "s1", "summary.json", "second").unwrap();
        let dir = root.join("playtest").join("s1");
        assert_eq!(fs::read_to_string(dir.join("summary.json")).unwrap(), "second");
        assert!(!dir.join("summary.json.partial").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
