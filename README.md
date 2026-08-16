# Parametric AI Adventure

> **A systemic adventure and management simulator where the world remembers, evolves and reacts.**

**Parametric AI Adventure** is an experimental game project combining systemic simulation, exploration, strategic management, emergent storytelling and generative AI.

The project is built around one fundamental rule:

> **The AI does not control the game. The world simulation does.**

A deterministic Simulation Core manages the state of the world, while a lightweight AI Dungeon Master interprets events, characters, memories and consequences to make that world feel alive.

---

## Vision

The game is designed to move progressively from **micro to macro scale**.

A campaign may begin with:

* one character;
* a small party;
* limited resources;
* personal relationships;
* exploration and survival.

Over time, the same campaign may expand toward:

* settlements;
* factions;
* economies;
* political influence;
* territories;
* armies;
* large-scale conflicts.

The personal layer never disappears.

A companion betrayed early in the campaign may return much later as the leader of another faction.
An economic decision may eventually destabilize a settlement, alter migration patterns and reshape the political map.

The goal is to create a world where **personal consequences and systemic consequences coexist**.

---

## Product Pillars

### Systemic World

The world evolves even when the player is not directly interacting with it.

### Meaningful Choice

Important decisions modify persistent state and may generate delayed consequences.

### Micro → Macro

Gameplay can evolve from individual characters and parties to settlements, factions and armies.

### Emergent Story

Stories emerge from interactions between systems rather than relying exclusively on predefined narrative branches.

### Living Characters

Important characters can possess memory, relationships, goals, loyalties, fears, injuries and evolving opinions.

### Modular Simulation

Game systems and content are designed to be data-driven and expandable.

### Local-First Generative AI

The game is designed to support a compact local generative model instead of requiring permanent access to a cloud AI service.

### Diegetic Hard-Sci-Fi Interface

The interface is conceived as a dense, cinematic mission operating system rather than a conventional web dashboard or chatbot.

---

## Architecture

```text
                    SHARED PROJECT
                          │
          ┌───────────────┼───────────────┐
          │               │               │
     SIMULATION        GAME DATA        GAME UI
        CORE              JSON            React
          │               │               │
          └───────────────┼───────────────┘
                          │
                 ┌────────┴────────┐
                 │                 │
                WEB             WINDOWS
                 │                 │
               VPS               Tauri
                 │                 │
            PostgreSQL           SQLite
                 │                 │
             AI Gateway      Local AI Runtime
                                   │
                              compact GGUF model
```

The Simulation Core remains independent from:

* AI providers;
* databases;
* browser APIs;
* desktop runtime;
* deployment platform.

This allows the same game logic to power both the Web and Windows editions.

---

## AI Dungeon Master

The AI layer is intentionally limited.

It may:

* generate narration;
* create dialogue;
* interpret consequences;
* propose context-compatible events;
* enrich characters;
* produce variations;
* generate narrative details.

It may **not** arbitrarily change authoritative game state.

The expected flow is:

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

---

## Local AI

The Windows edition is planned to support a **small generative model bundled with the game**.

Target architecture:

```text
Windows Application
│
├── Game UI
├── Simulation Core
├── SQLite
├── Local AI Adapter
├── llama.cpp runtime
└── bundled GGUF model
```

The exact model is intentionally **not locked yet**.

Model family, quantization, context size, memory requirements and performance targets will be selected through real benchmarks before release.

The game must also retain a procedural fallback so that AI failure never makes a campaign unplayable.

---

## Platforms

Planned builds:

| Build                    | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| **Web**                  | Online version hosted on the project VPS                       |
| **Windows Full Offline** | Installable desktop edition with local database and bundled AI |
| **Windows Hybrid**       | Future local/server hybrid mode                                |
| **HTML Demo**            | Lightweight prototype and rapid testing build                  |

Web and Windows are not separate games.

They share the same Simulation Core, data definitions and primary UI system.

---

## Technology

Current architectural direction:

* **TypeScript**
* **React**
* **Vite**
* **Fastify**
* **PostgreSQL**
* **SQLite**
* **Tauri**
* **Docker Compose**
* **llama.cpp / GGUF**
* **GitHub Actions**

GitHub is the source of truth for the project.

Lovable may be used to accelerate UI development.

OpenClaw may be used privately for engineering, testing and deployment operations.

Neither is a runtime dependency of the released game.

---

## Development Philosophy

The project follows several strict rules:

1. Simulation before narration.
2. Systems before content volume.
3. Consequences before cosmetic choices.
4. Persistence before illusion of memory.
5. Modular design before feature proliferation.
6. AI only where AI provides measurable value.
7. The game must remain functional when generative AI is unavailable.
8. Avoid generic AI-generated content and **AI slop**.
9. Build depth before breadth.
10. Validate technical assumptions through benchmarks.

---

## Current Status

**Pre-alpha / architecture and vertical-slice development**

Current work focuses on:

* Simulation Core;
* event system;
* persistent state;
* world evolution;
* character memory;
* Web vertical slice;
* Windows packaging feasibility;
* local AI benchmarking;
* UI visual system.

The project is not yet a public release.

---

## Repository Structure

```text
apps/
├── web/
├── server/
└── desktop/

packages/
├── game-core/
├── game-data/
├── game-types/
├── ui-system/
├── ai-contracts/
├── persistence-contracts/
└── procedural-narrator/

data/
assets/
models/
infra/
docs/
tests/
```

---

## Documentation

The `/docs` directory contains the project's design and technical knowledge base, including:

* Product Vision;
* Technical Roadmap;
* Platform and Local AI Feasibility;
* architecture decisions;
* implementation backlog;
* future game-system specifications.

These documents define the intended direction of the product and should be consulted before major architectural changes.

---

## Copyright & License

**Copyright © 2026 Simone Macelloni. All rights reserved.**

This repository is currently proprietary and is **not distributed under an open-source license**.

No permission is granted to copy, modify, redistribute, sublicense or commercially exploit the source code or project assets except where expressly authorized by the copyright holder.

Third-party libraries, runtimes, models and other dependencies remain subject to their respective licenses.

---

**Status:** Pre-alpha
**Platforms:** Web · Windows
**Architecture:** Local-first · Data-driven · AI-assisted · Systemic
