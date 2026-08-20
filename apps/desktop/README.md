# Chronosaga Desktop Shell

This is the Tauri v2 Windows shell for **Chronosaga: The Game**. Windows Full Offline is the first complete delivery target; Web compatibility remains a shared-code requirement.

Authoritative P0 documents:

- `docs/P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`
- `docs/TECHNICAL_ROADMAP_v0.2.md`
- `docs/LOCAL_AI_MODEL_PROFILES_v0.1.md`

## P0 runtime target

```text
Chronosaga
├── Tauri host
├── shared React UI
├── shared Game Core
├── SQLite
├── AI Profile Manager
├── llama-server sidecar
├── Lite ~1.7B
├── Standard ~3B
└── Procedural fallback
```

## Current implementation

### P0.1 — desktop/runtime baseline

Implemented on `feature/p0-windows-runtime`:

- real Tauri commands exposed to the React frontend;
- OS/CPU/RAM/logical-core/physical-core probe through Rust;
- free-storage probe for the application data volume;
- app-local-data and resource-path resolution;
- bundled `models/manifest.json` resolved to a stable `models/manifest.json` resource path;
- runtime check for the packaged `llama-server` resource;
- automatic Lite/Standard/Procedural recommendation using the thresholds in the model manifest;
- desktop-only P0 diagnostics screen; the normal Web UI remains unchanged in a browser.

GPU/VRAM probing is intentionally deferred to the acceleration benchmark stage; it is not faked in P0.1.

### P0.2 — SQLite persistence baseline

Implemented:

- SQLite database under the Tauri app-local-data directory;
- schema metadata;
- WAL mode and foreign-key initialization;
- smoke campaign save/load commands;
- save schema version check;
- AI profile stored as a preference only, not as authoritative simulation state;
- persistence smoke UI designed to be tested across a full app restart.

Database file:

```text
<APP_LOCAL_DATA>/chronosaga-p0.sqlite3
```

The P0 save is deliberately tiny. It proves persistence before the production campaign schema is introduced.

### P0.3 — local AI runtime and first real inference

Implemented:

- llama.cpp `b10343` locked by provenance and SHA-256, staged into the Windows
  installer as a resource (`config/local-ai-runtime.lock.json`);
- owned `llama-server` child process with start/health/timeout/stop lifecycle,
  loopback-only binding and a per-session API key;
- background watcher that advances the lifecycle; the interface only reads;
- Lite model (Qwen3-1.7B Q4_K_M) locked, hash-verified once per session and
  loaded in single-model mode;
- Rust-owned OpenAI-compatible inference client and application-side validator;
- structured output contract, with rejected output kept out of the interface.

### P0.4-A — Standard profile

Implemented:

- Standard model (SmolLM3-3B Q4_K_M) locked and hash-verified the same way;
- both profiles selectable from the desktop diagnostics, one resident at a time;
- the runtime must be stopped before the profile changes.

Both models remain P0 benchmark candidates. Neither is approved for release.

## Still required

- `AUTO` selection from the hardware probe;
- production profile UX and the `SAFE MODE` recovery presentation;
- `STANDARD -> LITE -> SAFE/PROCEDURAL` fallback chain;
- GPU/VRAM acceleration probe;
- the P0.5 benchmark: hardware matrix, context matrix, 50-case quality suite;
- multi-GB Full Offline packaging of both model payloads;
- clean-machine NSIS installer validation with models included.

Do not commit GGUF weights or third-party runtime binaries to the public repository until exact artifacts, licenses, hashes and distribution terms are recorded.

## Local developer command

From the repository root on Windows, after the prerequisites are installed:

```powershell
pnpm install
pnpm dev:desktop
```

The Tauri application should open directly on the **CHRONOSAGA // WINDOWS P0** diagnostic screen.

Use:

1. `RUN SYSTEM TEST`;
2. `SAVE / ADVANCE TURN`;
3. close Chronosaga completely;
4. start it again with `pnpm dev:desktop`;
5. press `LOAD FROM SQLITE`;
6. verify that the stored turn is preserved.

The GitHub CI includes a Windows Rust/Tauri `cargo check` so branch changes cannot rely only on the Linux/TypeScript pipeline.
