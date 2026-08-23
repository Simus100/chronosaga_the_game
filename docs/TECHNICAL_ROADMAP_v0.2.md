# TECHNICAL ROADMAP v0.2
## Chronosaga: The Game

**Versione:** 0.2  
**Data:** 2026-08-17  
**Stato:** Product-aligned implementation roadmap  
**Supersedes:** `TECHNICAL_ROADMAP_v0.1.md` per priorità e sequenza di delivery  
**Strategia:** Windows-first · Web-compatible · VPS later

---

# 0-bis. Stato di esecuzione reale

**Aggiornato:** 2026-08-23. Questa sezione è informativa: registra *dove siamo*,
non cambia la sequenza decisa sotto.

La sequenza descritta in questo documento è **concettuale**. L'esecuzione reale
non l'ha seguita in modo strettamente lineare, e questo non è un errore
architetturale: parte del lavoro M1 è stato anticipato in parallelo mentre P0
era ancora aperto, perché non dipendeva dall'esito del benchmark.

```text
già mergiato in develop
  P0.1  Windows desktop runtime
  P0.2  SQLite smoke persistence
  P0.3  llama.cpp runtime + prima inferenza Lite reale
  P0.4  Standard, AUTO/profile switching, Safe fallback, installed model resolution
  M1-A  systemic world foundation          <- lavoro anticipato, in parallelo a P0
  M1-B  first useful world tick            <- lavoro anticipato, in parallelo a P0
  P0.5-A benchmark harness
  P0.5-B1 official execution lane

non eseguito
  P0.5-B comparazione ufficiale Lite vs Standard
  P0.5-C matrice performance / context / hardware
  P0     verdetto finale GO / GO WITH LIMITS / NO-GO
  M2     playable micro vertical slice
```

**P0.5 resta il gate tecnico prioritario fino alla sua chiusura.** Finché è
aperto non vanno iniziate espansioni M2 rilevanti, salvo correzioni isolate,
test, o lavoro che non interferisce con il benchmark.

Il fatto che M1-A/M1-B siano già fatti mentre P0.5 è aperto va letto come
anticipazione deliberata, non come inversione della priorità: il gate P0 esiste
per decidere se e con quale modello Chronosaga può spedire Windows Full Offline,
e quella domanda è ancora senza risposta.

Per la fotografia operativa aggiornata: `REPOSITORY_BOOTSTRAP_STATUS.md` nella
radice del repository.

---

# 0. Decisione di priorità

Chronosaga mantiene due target principali — Windows e Web — ma non li sviluppa con la stessa intensità nello stesso momento.

La priorità è:

```text
1. WINDOWS FULL OFFLINE
2. SHARED GAME / SYSTEMS VERTICAL SLICE
3. WEB COMPATIBILITY HARDENING
4. VPS HOSTED ALPHA
5. OPTIONAL BROWSER-LOCAL AI
```

Questa sequenza riduce il rischio senza creare un fork del prodotto.

## Regola

> **Windows viene validato per primo; Web deve continuare a compilare e condividere il Game Core; infrastruttura VPS e multiutenza vengono rinviate finché il gioco non è sufficientemente maturo.**

---

# 1. Architettura invariata

```text
                    SHARED PROJECT
                         │
        ┌────────────────┼────────────────┐
        │                │                │
    GAME CORE        GAME DATA        REACT UI
        │                │                │
        └────────────────┼────────────────┘
                         │
              PLATFORM ADAPTERS
                 ┌───────┴───────┐
                 │               │
              WINDOWS           WEB
```

## Shared

- `packages/game-core`
- `packages/game-types`
- `packages/game-data`
- `packages/ui-system`
- `packages/ai-contracts`
- `packages/persistence-contracts`
- `packages/procedural-narrator`
- event schemas
- combat/economy/faction rules
- world tick
- memory contracts
- UI components where platform-neutral

## Windows adapters

- Tauri host
- SQLite
- filesystem
- local model profile manager
- llama.cpp sidecar
- GGUF models
- hardware detection
- installer

## Web adapters

- Fastify API
- PostgreSQL
- server-side AI gateway/queue
- remote persistence
- authentication later
- deployment/monitoring later

---

# 2. Milestone P0 — Windows Runtime Gate

**Priorità assoluta.**

Documento operativo: `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`.

## P0.1 Desktop shell

- Tauri v2 build reale;
- React UI smoke screen;
- Windows x64 target;
- installer smoke test;
- startup/shutdown;
- asset/resource path verification.

## P0.2 Persistence

- SQLite adapter minimo;
- create/load/save campaign smoke state;
- persistence across restart;
- schema/version metadata;
- deterministic seed retention.

## P0.3 Local AI runtime

- bundle/launch `llama-server` sidecar;
- loopback-only binding;
- health check;
- lifecycle on app start/exit;
- crash detection;
- timeout;
- restart/fallback.

## P0.4 Dual model profiles

- `AUTO`;
- `LITE ~1.7B`;
- `STANDARD ~3B`;
- `PROCEDURAL`;
- same AIAdapter;
- one resident model at a time;
- user-visible hardware requirements.

## P0.5 Benchmark

- 8/16/32 GB classes where possible;
- CPU-only baseline;
- GPU accelerated test where available;
- 2k/4k/8k contexts;
- suite qualitativa versionata (minimo P0 50 casi; suite corrente 65);
- JSON compliance;
- Italian quality;
- repetition/contradiction;
- RAM/latency/throughput.

## Exit

P0 ends with `GO`, `GO WITH LIMITS`, or `NO-GO` for each model profile.

---

# 3. Milestone M1 — Shared Simulation Foundation

Dopo P0, concentrarsi sul gioco, non sulla piattaforma.

## M1.1 State contracts

Stabilizzare:

- `WorldState`;
- `CampaignState`;
- `CharacterState`;
- `FactionState`;
- `SettlementState`;
- `ResourceState`;
- `StateDelta`;
- `PendingConsequence`;
- event/memory IDs.

## M1.2 Validation

Aggiungere schema validation per:

- game data;
- events;
- AI contracts;
- saves;
- state deltas;
- configuration/manifests.

## M1.3 World Tick

Implementare il primo scheduler multi-frequency:

```text
FOCUS AREA        frequent
ACTIVE REGION     periodic
DISTANT WORLD     aggregate
```

Non simulare ogni NPC con LLM.

## M1.4 Consequence Engine

Ogni scelta importante deve produrre:

```text
StateDelta
+
PendingConsequences
+
Event Log
```

Supportare effetti immediati e ritardati.

## M1.5 Character memory

Memoria strutturata con:

- event ID;
- subject/object;
- valence;
- importance;
- trust/fear deltas;
- timestamp;
- tags;
- decay/retrieval score.

---

# 4. Milestone M2 — Playable Micro Vertical Slice

Costruire una slice piccola ma completa.

Target iniziale:

```text
5 characters
1 settlement
2 factions
1 local economy
1 conflict
20–30 events
1 tactical encounter class
structured memory
local AI narration
persistent consequences
```

## Obiettivo

Dimostrare:

```text
PLAYER CHOICE
   ↓
TACTICAL / SOCIAL RESOLUTION
   ↓
STATE DELTA
   ↓
ECONOMIC / FACTION EFFECT
   ↓
NPC MEMORY
   ↓
DELAYED CONSEQUENCE
   ↓
NEW EVENT
```

Se questa catena non è interessante, non espandere il numero di sistemi.

---

# 5. Milestone M3 — UI / Lovable Vertical Slice

Lovable entra operativamente dopo il gate P0, usando:

- `UI_VISUAL_SYSTEM_v0.1.md`;
- `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md`;
- shared contracts;
- real Game Core boundaries.

## Primo target

Operations Vertical Slice:

```text
TOP TELEMETRY
LEFT PARTY / ENTITY
CENTER WORLD VIEW
RIGHT EVENT / INTEL / DIRECTIVES
BOTTOM LOG / CONTEXT
ANALYSIS MODE
```

## Regola

Lovable non implementa la logica autorevole nei componenti React.

Mock data ammessi per visual iteration; integrazione reale deve passare attraverso adapter/API contracts.

## Deliverable

- 1440p;
- 1080p;
- 1280-width;
- event reveal;
- dialogue;
- Analysis Mode;
- Tactical/Warfare/Management previews;
- screenshot review.

---

# 6. Milestone M4 — AI-DM Production Contract

Creare `AI_DM_PROTOCOL_v0.1.md` e implementare:

```text
WorldState slice
+ relevant memories
+ Recent StateDelta
+ allowed actions
     ↓
Context Builder
     ↓
AIAdapter
     ↓
Lite / Standard
     ↓
structured JSON
     ↓
Validator
```

## Required providers

- `LocalModelProvider`;
- `ProceduralFallbackProvider`;
- `CloudModelProvider` interface, senza renderlo requisito runtime.

## Anti-slop checks

Ogni proposta AI importante deve essere ancorata a:

- state cause;
- involved entity;
- current stakes;
- allowed consequence class.

Rifiutare output generico/non grounded.

---

# 7. Milestone M5 — Tactical → Warfare → Management Bridge

Non costruire subito tre giochi completi.

Implementare prima una catena verticale che attraversa i tre livelli.

```text
TACTICAL MISSION
      ↓
WARFARE MODIFIER
      ↓
RESOURCE / PRODUCTION CHANGE
      ↓
POPULATION / FACTION REACTION
      ↓
PERSONAL CONSEQUENCE
```

## Tactical first slice

- d100;
- six base attributes;
- derived stats;
- Move + Main Action + Reaction;
- abstract/schematic positioning initially;
- wounds/stress/morale;
- persistent injury.

## Warfare first slice

- squad-level minimum;
- 3 macro battle phases;
- selected battle plans;
- supply influence;
- commander influence;
- approximate forecast/confidence;
- focus encounter link.

## Management first slice

- 8–10 core resources;
- one production chain;
- population cohorts;
- one internal political pressure;
- migration reaction;
- delegation/manual toggle.

---

# 8. Milestone M6 — Windows Alpha Candidate

Una volta che la vertical slice è interessante:

- installer reproducible;
- model profile menu;
- Lite/Standard/fallback tested;
- save migration strategy;
- crash recovery;
- logs;
- settings;
- graphics/audio baseline;
- offline guarantee;
- package/license notices;
- no developer runtime requirements.

## Distribution experiments

### Full Offline

```text
Game + Lite + Standard
```

### Compact

```text
Game + Lite
Standard optional pack
```

Architettura e manifest devono permettere entrambe.

---

# 9. Milestone M7 — Web Compatibility Hardening

La Web build viene mantenuta verde durante tutto lo sviluppo, ma qui diventa un deliverable reale.

## Implementare

- real Fastify API boundary;
- PostgreSQL persistence adapter;
- campaign/session model;
- authoritative server-side Game Core;
- save migration parity;
- hosted asset strategy;
- basic authentication if required;
- server AI interface;
- procedural fallback.

## Non ancora

- grande scaling;
- WebGPU as hard requirement;
- complex billing;
- enterprise observability.

---

# 10. Milestone M8 — VPS Private Alpha

Target VPS corrente:

```text
6 CPU
12 GB RAM
200 GB SSD
GPU not assumed
```

## Runtime

```text
reverse proxy
web frontend
Fastify
Game Core
PostgreSQL
AI queue
one inference worker initially
```

## Test

- 1 AI request;
- 2 simultaneous;
- 5 queued;
- Lite baseline;
- Standard exploratory;
- API + PostgreSQL active;
- peak memory;
- queue delay;
- error recovery;
- security exposure.

OpenClaw deve restare separato dal gameplay runtime e può essere limitato/spento se contende RAM.

---

# 11. Milestone M9 — Optional Browser-Local AI

Solo dopo Windows e hosted Web stabili.

Target:

```text
Browser
   ↓
WebGPU support probe
   ↓
explicit model download
   ↓
cache
   ↓
Lite local inference
```

Standard WebGPU resta opportunistico e dipendente dall'hardware.

Fallback:

```text
LOCAL WEBGPU
   ↓ unavailable
SERVER AI
   ↓ unavailable/disabled
PROCEDURAL
```

Il browser non scarica modelli multi-GB senza consenso esplicito.

---

# 12. CI strategy

Durante Windows-first development CI deve proteggere la codebase condivisa.

## Ogni PR

- install;
- TypeScript typecheck;
- unit tests;
- shared core tests;
- web build;
- server build;
- data/schema validation.

## Aggiungere appena disponibile

- Rust/Tauri check;
- desktop build smoke;
- Windows packaging job;
- SQLite migration test;
- AI contract fixtures;
- deterministic simulation replay tests.

## Nightly/manual

- Windows artifact;
- AI benchmark subset;
- save compatibility suite;
- large simulation benchmark.

---

# 13. Branch workflow

```text
feature/*
    ↓ PR
 develop
    ↓ validation / integration
 main
```

`main` deve rappresentare stato validato.

Evitare commit diretti su `main` per nuove feature salvo manutenzione eccezionale.

---

# 14. Priorità di lavoro indicative

Fino alla prima vertical slice giocabile:

```text
Game systems / Core       40%
Windows + local AI        25%
UI / Lovable              20%
Tests / tooling            10%
Web / VPS                   5%
```

Le percentuali sono guida di focus, non pianificazione oraria rigida.

---

# 15. Gates contro feature sprawl

Non aggiungere un nuovo sistema maggiore se non risponde sì ad almeno una:

1. rende più interessante la catena causa → conseguenza?
2. migliora il loop Explore → Discover → Decide → Consequence?
3. aumenta la profondità senza aggiungere micromanagement sproporzionato?
4. è necessario per validare il micro → macro?

Non implementare tecnologia perché “AI” o “procedural” se non migliora il gioco.

---

# 16. Success criteria della prima vera alpha

Chronosaga raggiunge una alpha utile quando:

- Windows si installa normalmente;
- funziona offline;
- save/load persistente;
- almeno Lite o Standard è sufficientemente credibile;
- AI failure degrada a procedural;
- 5 personaggi sono memorabili e mantengono stato/memoria;
- almeno una decisione produce conseguenze ritardate;
- una missione personale influenza uno stato macro;
- economia/fazione reagiscono coerentemente;
- UI permette di capire cosa sta succedendo;
- Analysis Mode spiega almeno i valori principali;
- due campagne possono divergere per cause sistemiche, non solo per testo generato.

---

# 17. Decisione finale di questa roadmap

```text
WINDOWS-FIRST       LOCKED DELIVERY PRIORITY
WEB-COMPATIBLE      LOCKED ARCHITECTURAL REQUIREMENT
VPS-LATER           LOCKED SEQUENCING DECISION
DUAL LOCAL AI       LOCKED ARCHITECTURAL PROFILE STRATEGY
MODEL NAMES         PROVISIONAL UNTIL P0
HARDWARE LIMITS     PROVISIONAL UNTIL P0
WEBGPU LOCAL AI     OPTIONAL / LATER
```

La complessità viene contenuta mantenendo una sola codebase e validando una piattaforma completa prima di rendere operative tutte le altre topologie.