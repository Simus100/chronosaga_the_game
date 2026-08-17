# Chronosaga Desktop Shell

This is the Tauri v2 scaffold for the **Windows Full Offline** edition and is now the first delivery target.

Authoritative P0 plan:

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

## Current scaffold state

Present:

- Tauri v2 shell;
- Web frontend build integration;
- Windows/NSIS bundle target;
- model manifest packaged as a resource;
- Chronosaga product identity.

Still required for P0:

- real SQLite persistence adapter;
- hardware probe command;
- `AUTO / LITE / STANDARD / PROCEDURAL` settings integration;
- bundled `llama-server.exe` sidecar;
- selected benchmark GGUF artifacts;
- sidecar health/start/stop lifecycle;
- model switching;
- fallback Standard → Lite → Procedural;
- Windows installer validation on a clean machine.

Do not commit GGUF model weights or third-party runtime binaries to the public repository until the exact distribution/license strategy is approved.
