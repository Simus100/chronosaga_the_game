# AGENTS.md — Chronosaga: The Game

This file defines mandatory operating rules for coding agents working on Chronosaga.

## 1. Read before changing anything

Read, in this order:

1. `docs/KNOWLEDGE_INDEX_v1.md`
2. `docs/PRODUCT_VISION_LOCKED_v1.md`
3. `docs/TECHNICAL_ROADMAP_v0.2.md`
4. the most specific document for the task being executed
5. `docs/LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md` for local/heavy assets
6. `docs/VISUAL_ASSET_PIPELINE_v0.1.md` for portraits/sprites/visual content

Do not reinterpret a LOCKED product or architecture decision unless the task explicitly asks for a design review.

## 2. Source of truth

- GitHub is the source of truth for code, schemas, manifests, documentation and review history.
- Work on `feature/*` branches and open a Pull Request to `develop`.
- `main` represents validated state.
- Do not commit directly to `main` for feature work.
- Do not merge a PR unless the task explicitly authorizes it or validation has been explicitly recorded.

## 3. Non-negotiable architecture

- Windows Full Offline is the current delivery priority.
- Web compatibility must remain buildable.
- VPS/public hosting is later work.
- `packages/game-core` is authoritative and deterministic.
- The LLM is never the game engine and never owns authoritative state.
- AI output must pass through contracts/validation before affecting player-facing systems.
- Gameplay must continue through procedural fallback if local AI is unavailable.
- Platform-specific behavior belongs behind adapters/boundaries.
- Do not create a second independent Windows/Web game implementation.

## 4. Heavy-file policy

The normal Git repository MUST NOT contain heavy runtime model weights or raw production libraries.

Never commit:

- `*.gguf` model weights;
- `*.safetensors`, `*.ckpt`, `*.pt`, `*.pth` model weights;
- multi-GB local model/runtime packs;
- raw AI image-generation batches;
- local build output;
- local benchmark dumps;
- temporary caches;
- secrets or API keys.

The repository stores the definition of heavy assets, not necessarily the heavy bytes themselves:

- manifest/profile ID;
- expected filename;
- version;
- exact size when locked;
- SHA-256 when locked;
- license/attribution metadata;
- source/release metadata;
- packaging rule.

Heavy local files live in the external development workspace described by `docs/LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`.

## 5. Local workspace convention

Preferred Windows development root:

```text
D:\Chronosaga\
```

Recommended structure:

```text
D:\Chronosaga\
├── repo\chronosaga_the_game\
├── runtime-assets\
│   ├── models\
│   ├── visual-source\
│   ├── visual-ready\
│   ├── audio\
│   └── licenses\
├── builds\
├── benchmarks\
└── temp\
```

The path is a development convention, not a hard-coded product requirement. Prefer a configurable workspace root (planned convention: `CHRONOSAGA_WORKSPACE_ROOT`) or explicit configuration.

## 6. Local model rules

Before an agent downloads or packages a model:

1. confirm the model/profile is part of the current task;
2. verify the exact upstream/derivative license;
3. record exact release/version information;
4. calculate and record SHA-256;
5. keep the model outside Git;
6. never assume candidate model names in planning documents are final release locks;
7. only one local LLM should normally be resident at a time;
8. preserve `STANDARD → LITE → PROCEDURAL` fallback behavior.

Do not add model weights merely to make a CI build appear complete.

## 7. Visual asset rules

Chronosaga v1 does not require runtime image generation.

AI image generation is an authoring pipeline for producing a curated library outside gameplay runtime. Follow `docs/VISUAL_ASSET_PIPELINE_v0.1.md`.

Keep separate:

```text
RAW / AI SOURCE
        ↓ curation
MASTER / EDITABLE
        ↓ normalization
GAME-READY ASSET
```

Large raw/master batches stay outside normal Git. Small approved game-ready assets may be committed only when their size, provenance and license are appropriate for the repository. Larger approved libraries should be handled as versioned asset packs with manifests/checksums.

Character visuals must preserve persistent identity through stable component IDs rather than regenerating a character every time.

## 8. Safe implementation behavior

- Inspect existing contracts before creating new ones.
- Prefer the smallest change that satisfies the task.
- Do not silently rewrite architecture documents to match an implementation shortcut.
- Do not delete user/project data to fix a migration problem.
- Never disable Windows security, CI checks or validation as a workaround.
- Never expose `llama-server` publicly; P0 desktop binding is loopback-only.
- Never log secrets or private tokens.
- Do not add telemetry/network dependencies to the offline build without an explicit product decision.

## 9. Validation before PR/merge

As applicable, run or preserve CI coverage for:

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
cargo check (desktop changes)
Windows Tauri packaging smoke (desktop changes)
```

For local-AI work also validate:

- sidecar startup;
- loopback health check;
- timeout/crash recovery;
- clean shutdown;
- selected profile/fallback;
- structured response validation;
- save integrity if the AI fails.

For visual assets validate metadata, dimensions/anchors, naming, provenance/license and reproducible asset IDs.

## 10. Agent role

The local agent is an engineering/operations executor, not the product director.

Expected flow:

```text
Chat / project decision
        ↓
Specification or task
        ↓
Local agent implementation
        ↓
Tests / build / benchmark
        ↓
Feature branch + Pull Request
        ↓
Review
        ↓
Validated merge
```

When a requirement is ambiguous and cannot be resolved from project Knowledge, stop and surface the ambiguity instead of inventing a new product rule.
