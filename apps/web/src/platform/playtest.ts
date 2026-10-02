import { invoke } from "@tauri-apps/api/core";
import type { PlaytestFile, TelemetrySink } from "../playtest/telemetry";

/**
 * The real telemetry sink: files in the app's local data directory, written by
 * Rust (`playtest.rs`). The interface names a session and one of a fixed set of
 * files; Rust decides the path and refuses anything else. Nothing is uploaded.
 */
export const tauriTelemetrySink: TelemetrySink = {
  location(sessionId) {
    return invoke<string>("playtest_session_dir", { sessionId });
  },
  append(sessionId, line) {
    return invoke<void>("playtest_append_line", { sessionId, line });
  },
  write(sessionId: string, file: PlaytestFile, content: string) {
    return invoke<string>("playtest_write_file", { sessionId, fileName: file, content });
  }
};
