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
- runtime check for the future `bin/llama-server.exe` resource;
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

## Still required

### P0.3+

- bundle a verified `llama-server.exe` sidecar;
- select exact benchmark GGUF artifacts;
- sidecar start/health/timeout/stop lifecycle;
- GPU/VRAM acceleration probe;
- Lite ~1.7B inference benchmark;
- Standard ~3B inference benchmark;
- model switching and failure fallback;
- clean-machine NSIS installer validation.

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
