# Chronosaga: The Game

> **A systemic micro-to-macro adventure and management simulator where the world remembers, evolves and reacts.**

**Chronosaga: The Game** is the public repository for a data-driven simulation game that combines exploration, strategic management, emergent storytelling, persistent characters, long-term consequences and a local-first AI Dungeon Master.

**Technical codename:** Parametric AI Adventure  
**Status:** Pre-alpha / architecture + vertical-slice development  
**Target platforms:** Web · Windows Full Offline · HTML Demo

---

## Vision

The game begins at a human scale — one character, a small party, limited resources, relationships and exploration — and can progressively expand toward settlements, factions, territories, economies and armies.

The macro layer must never erase the personal layer.

A companion betrayed early in a campaign may later return as a faction leader.  
An economic decision may destabilize a settlement, alter migration patterns and reshape the political map.

The goal is a world where **personal consequences and systemic consequences coexist**.

---

## Product Pillars

1. **Systemic World** — the world evolves even without direct player intervention.
2. **Meaningful Choice** — important choices persist and may create delayed consequences.
3. **Micro → Macro** — character/party management can grow into settlement, faction and army-scale strategy.
4. **Emergent Story** — stories arise from interacting systems, not only predefined branches.
5. **Living Characters** — memory, relationships, goals, loyalty, fear, wounds and changing opinions.
6. **Hard-Sci-Fi Operating UI** — dense, cinematic, diegetic mission-control presentation.
7. **Local-First Generative AI** — a compact local model is a product requirement for the Windows offline edition.
8. **Modular Expansion** — systems and content are designed to grow through data, rules and modules.

---

## Core Architectural Rule

> **The AI does not control the game. The Simulation Core does.**

The authoritative flow is:

```text
PLAYER ACTION
      ↓
SIMULATION CORE
      ↓
VALIDATED STATE DELTA
      ↓
PERSISTENCE
      ↓
AI INTERPRETATION
      ↓
PLAYER
```

The database remembers.  
The Simulation Core decides.  
The AI interprets.

This separation is what makes a small local model practical: the model is not asked to simulate the entire world.

---

## Shared Architecture

```text
                         SHARED PROJECT
                              │
             ┌────────────────┼────────────────┐
             │                │                │
        SIMULATION         GAME DATA        REACT UI
           CORE               JSON              │
             │                │                 │
             └────────────────┼─────────────────┘
                              │
                     ┌────────┴────────┐
                     │                 │
                    WEB             WINDOWS
                     │                 │
                Browser/VPS          Tauri
                     │                 │
                PostgreSQL           SQLite
                     │                 │
                 AI Gateway      Local AI Runtime
                                       │
                                  GGUF model
```

Web and Windows are **not separate games**. They share the same game logic, data definitions and primary UI system.

---

## AI Dungeon Master

The AI layer may:

- generate narration and dialogue;
- interpret validated consequences;
- create context-compatible narrative variations;
- propose events or memory updates;
- enrich characters and locations;
- support visual-generation prompts in later phases.

It may **not** arbitrarily change authoritative game state, damage, resources, economy, mortality or other simulation results.

Planned provider abstraction:

```text
LocalModelProvider
CloudModelProvider
ProceduralFallbackProvider
```

The game must remain playable if generative AI is unavailable.

---

## Local AI / Offline Edition

The Windows Full Offline Edition is planned to bundle:

```text
Chronosaga.exe
├── React / Tauri UI
├── Simulation Core
├── SQLite
├── llama.cpp runtime
├── compact GGUF model
├── game data
└── assets
```

The exact model family, quantization, context size and hardware requirements are **not locked yet**. They will be selected only after the P0 benchmark gate.

The repository intentionally does **not** contain model weights or third-party AI binaries.

---

## Planned Builds

| Build | Purpose |
|---|---|
| **Web** | Browser version hosted on the private VPS |
| **Windows Full Offline** | Installable Windows edition with SQLite and bundled local AI |
| **Windows Hybrid** | Future local/server hybrid mode |
| **HTML Demo** | Lightweight prototype, UI and gameplay testing build |

---

## Current Technology Direction

- TypeScript
- React
- Vite
- Fastify
- PostgreSQL
- SQLite
- Tauri 2
- Docker Compose
- llama.cpp / GGUF
- GitHub Actions

**GitHub is the source of truth.**

Lovable may accelerate UI/UX development.  
OpenClaw may assist privately with engineering, testing and VPS operations.  
Neither is a required runtime dependency of the released game.

---

## Repository Structure

```text
apps/
├── web/                    # React/Vite client
├── server/                 # Fastify API
└── desktop/                # Tauri Windows shell

packages/
├── game-core/              # Authoritative Simulation Core
├── game-data/              # Data-driven definitions
├── game-types/             # Shared TypeScript contracts
├── ui-system/              # Visual-system primitives/tokens
├── ai-contracts/           # AI-DM provider contracts
├── persistence-contracts/  # Web/Desktop persistence abstraction
└── procedural-narrator/    # AI-free fallback narration

data/                       # JSON game content
assets/                     # Project assets and placeholders
models/                     # Model manifest only; no weights
infra/                      # Docker / Nginx / deployment scripts
docs/                       # Product and technical knowledge base
tests/                      # Cross-system tests
```

---

## Development Philosophy

1. Simulation before narration.
2. Systems before content volume.
3. Consequences before cosmetic choice.
4. Persistence before the illusion of memory.
5. Depth before breadth.
6. AI only where it adds measurable value.
7. No generative service may become a single point of failure.
8. Avoid generic procedural content and **AI slop**.
9. Keep Web and Windows on one shared core.
10. Benchmark technical assumptions before locking them.

---

## Current Bootstrap

The repository currently includes the M0/M1 bootstrap:

- deterministic seed-based Simulation Core;
- event eligibility, selection and resolution;
- explicit State Delta;
- sample parametric events;
- procedural AI fallback;
- React hard-SF vertical slice;
- Fastify API;
- Docker/PostgreSQL scaffold;
- Nginx reverse proxy;
- Tauri Windows shell scaffold;
- local-model manifest placeholder;
- GitHub CI workflow;
- project Knowledge and implementation backlog.

Not yet implemented or intentionally gated:

- production PostgreSQL persistence adapter and migrations;
- SQLite desktop adapter;
- bundled llama.cpp binary;
- selected GGUF model;
- final local-AI lifecycle;
- final Game Systems schema;
- final UI Visual System;
- authentication;
- image generation;
- production secrets.

---

## Local Development

Requirements:

- Node.js LTS
- pnpm
- Docker Desktop for PostgreSQL
- Rust + Tauri prerequisites only for desktop builds

```bash
pnpm install
docker compose up -d db
pnpm dev
```

Development endpoints:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/api/v1/health`

---

## Documentation

The `/docs` directory is part of the project specification, not optional background material.

Key documents:

- `PRODUCT_VISION_LOCKED_v1.md`
- `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`
- `TECHNICAL_ROADMAP_v0.1.md`
- `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`
- `KNOWLEDGE_INDEX_v1.md`
- `IMPLEMENTATION_BACKLOG_v0.1.md`

Major architectural changes should be checked against these documents.

---

## Copyright and Usage

**Copyright © 2026 Simone Macelloni. All rights reserved.**

The source code and project assets in this repository are publicly viewable but are **not released under an open-source license**.

Unless the copyright holder grants explicit permission, no permission is granted to reproduce, redistribute, sublicense, sell, commercially exploit or create derivative works from the project's proprietary code, documentation, visual assets or original game content.

GitHub platform functionality and third-party dependencies remain subject to their own terms and licenses.

See [`COPYRIGHT.md`](./COPYRIGHT.md).

---

## Project Principle

> **Chronosaga should not be compelling because it “uses AI.” It should be compelling because it simulates a persistent world whose systems produce consequences — and uses AI selectively to make those consequences feel alive.**
