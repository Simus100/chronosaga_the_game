# KNOWLEDGE INDEX v1
## Chronosaga: The Game

**Data:** 2026-08-17

I documenti seguenti costituiscono la Knowledge di progetto.

## 1. `PRODUCT_VISION_LOCKED_v1.md`
Fonte principale per:
- identità del prodotto;
- priorità;
- micro → macro;
- sandbox;
- personaggi;
- difficoltà;
- combattimento;
- durata campagne;
- anti-AI-slop.

## 2. `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`
Fonte generale per:
- architettura concettuale;
- AI-DM;
- UI;
- VPS;
- workflow;
- decisioni storiche/approvate.

## 3. `TECHNICAL_ROADMAP_v0.2.md`
Fonte tecnica prevalente per priorità e sequenza di implementazione.

Decisione corrente:

```text
WINDOWS FIRST
→ shared playable vertical slice
→ Web compatibility hardening
→ VPS private alpha
→ optional browser-local AI
```

Copre:
- P0 Windows runtime;
- SQLite;
- dual local AI;
- shared Simulation Core;
- Lovable timing;
- micro ↔ macro vertical slice;
- Windows alpha;
- Web hardening;
- VPS alpha;
- optional WebGPU;
- CI/branch workflow;
- gates contro feature sprawl.

`TECHNICAL_ROADMAP_v0.1.md` resta storico e viene superseded da v0.2 per sequencing/priorità.

## 4. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`
Fonte per la fattibilità generale delle piattaforme:
- Web + Windows;
- Tauri;
- SQLite vs PostgreSQL;
- llama.cpp;
- modello locale incluso;
- HTML demo;
- VPS feasibility;
- packaging e distribuzione.

Quando il documento parla di ordine di delivery, prevale `TECHNICAL_ROADMAP_v0.2.md`.

## 5. `GAME_SYSTEMS_SCHEMA_v0.1.md`
Fonte prevalente per i sistemi di gameplay:
- Tactical Combat Engine;
- sistema d100;
- caratteristiche, skill, ferite e progressione;
- Warfare Engine;
- unità, comandanti, logistica e battle plans;
- Management & Simulation Engine;
- economia, produzione, popolazione e migrazione;
- politica, reputazione, diplomazia e fazioni autonome;
- World Tick;
- conseguenze e causal graph;
- automazione/delega;
- connessioni micro ↔ macro;
- assunzioni LOCKED / PROVISIONAL / OPEN;
- acceptance scenarios della prima vertical slice sistemica.

## 6. `UI_VISUAL_SYSTEM_v0.1.md`
Fonte prevalente per UI/UX e linguaggio visuale:
- equilibrio game UI / diegetic OS;
- layout e navigation;
- palette, typography e geometry;
- Tactical / Warfare / Management presentation;
- party, personaggi, ferite e relazioni;
- eventi e AI-DM presentation;
- Analysis Mode;
- informational fog of war;
- responsive desktop;
- motion/audio UI;
- anti-pattern e acceptance criteria;
- decisioni LOCKED / PROVISIONAL / OPEN derivanti dal questionario UI.

## 7. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md`
Brief operativo per Lovable:
- primo Operations Vertical Slice;
- confini fra UI e Simulation Core;
- strategia mock-first / integration-ready;
- componenti e interaction requirements;
- preview Tactical/Warfare/Management;
- screenshot review;
- Definition of Done;
- limiti di autonomia e dipendenze.

**Sequencing corrente:** il brief può essere revisionato/preparato subito, ma la produzione Lovable avanzata segue il P0 Windows/local-AI.

## 8. `LOCAL_AI_MODEL_PROFILES_v0.1.md`
Fonte prevalente per la strategia dual-model locale:
- profilo Lite ~1.7B;
- profilo Standard ~3B;
- selezione `AUTO / LITE / STANDARD / PROCEDURAL`;
- hardware probe;
- requisiti RAM/VRAM/storage PROVISIONAL;
- fallback Standard → Lite → Procedural;
- packaging Windows con due modelli;
- modello WebGPU on-demand nel browser;
- benchmark Lite/Standard;
- UI requirements del model selector;
- candidate families e gate di licenza.

## 9. `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`
Fonte operativa prevalente per il gate tecnico immediato:
- Tauri Windows installable smoke build;
- SQLite save/load;
- llama.cpp sidecar lifecycle;
- Lite ~1.7B e Standard ~3B;
- hardware matrix;
- 2k/4k/8k context matrix;
- 50-case AI quality suite;
- schema validation/retry/fallback;
- model selector funzionale;
- Full vs Compact packaging experiment;
- Web compatibility checks durante Windows-first;
- exit criteria `GO / GO WITH LIMITS / NO-GO`.

**Stato verificato 2026-08-17:** P0.1 Desktop runtime e P0.2 SQLite persistence sono stati validati sul PC Windows target. P0.3 local AI sidecar è il prossimo gate operativo.

## 10. `IMPLEMENTATION_BACKLOG_v0.1.md`
Backlog operativo aggiornato internamente a v0.2.

Ordine corrente:
- P0 Windows/local AI;
- shared simulation foundation;
- playable micro vertical slice;
- UI/Lovable;
- AI-DM production layer;
- micro ↔ macro bridge;
- Windows alpha;
- Web hardening;
- VPS alpha;
- optional browser-local AI.

## 11. `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`
Fonte prevalente per la separazione fra repository e payload pesanti:
- GitHub come source of truth di codice/manifest/documentazione;
- workspace locale come store operativo per file multi-GB;
- modelli GGUF fuori dal normale Git;
- raw AI generations/master pesanti fuori dal normale Git;
- struttura consigliata `D:\Chronosaga`;
- convenzione configurabile `CHRONOSAGA_WORKSPACE_ROOT`;
- manifest/checksum/licenze;
- packaging Full/Compact;
- ruolo e limiti dell'agente locale;
- backup source separato da heavy-asset backup.

Questa decisione prevale su eventuali esempi storici che possano suggerire di versionare direttamente model weights o grandi librerie raw nella repository.

## 12. `VISUAL_ASSET_PIPELINE_v0.1.md`
Fonte prevalente per la produzione grafica procedurale/AI-assisted:
- AI image generation come authoring esterno, non requisito runtime v1;
- portrait + Tactical sprite + strategic icon per lo stesso personaggio;
- sprite modulari;
- identità visuale persistente tramite component IDs;
- pipeline raw → curated → master → game-ready;
- ambiente tramite composizione modulare/procedurale;
- asset metadata/hash/provenance;
- grandi librerie e raw AI fuori dal normale Git;
- 4 vs 8 directions e risoluzioni finali ancora OPEN.

---

# File operativi root/config/status

Questi file fanno parte del sistema operativo/documentale del progetto ma NON introducono una nuova fonte di precedenza rispetto ai 12 documenti Knowledge sopra elencati.

## `/AGENTS.md`
Regole obbligatorie per agenti di coding/operations:
- ordine di lettura della Knowledge;
- branch/PR workflow;
- divieto di model weights/heavy raw assets nel Git;
- limiti architetturali;
- sicurezza;
- controlli di licenza/hash;
- validation gates;
- ruolo dell'agente come esecutore, non product director.

## `/CLAUDE.md`
Bridge operativo per Claude Code. Importa `@AGENTS.md` e non ridefinisce autonomamente la Knowledge.

## `config/runtime-assets.example.json`
Esempio architetturale development-only del contratto External Asset Store. Non certifica che modelli o pack siano installati/approvati e non contiene model weights.

## `LOCAL_WORKSPACE_SETUP_CHECKLIST_v0.1.md`
Checklist operativa per inizializzare una macchina di sviluppo prima del P0.3. Deriva da `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`; in caso di conflitto prevale quest'ultimo.

## `REPOSITORY_BOOTSTRAP_STATUS.md`
Snapshot informativo dello stato corrente del repository e dei gate completati/pending. Non è una specifica architetturale e non ha precedenza sulla Knowledge; deve essere mantenuto aggiornato per evitare che agenti o sviluppatori assumano uno stato storico come corrente.

---

# Regola di precedenza

In caso di conflitto:

1. documento più specifico;
2. documento con versione/data più recente;
3. `PRODUCT_VISION_LOCKED_v1.md` prevale sulle preferenze generali di prodotto;
4. `GAME_SYSTEMS_SCHEMA_v0.1.md` prevale sui dettagli di gameplay e simulazione;
5. `UI_VISUAL_SYSTEM_v0.1.md` prevale su UI/UX e linguaggio visuale generale;
6. `VISUAL_ASSET_PIPELINE_v0.1.md` prevale su pipeline portrait/sprite/visual asset e identità visuale persistente;
7. `LOCAL_AI_MODEL_PROFILES_v0.1.md` prevale sui profili locali, selezione modello e fallback dual-model;
8. `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md` prevale sull'esecuzione del gate P0;
9. `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md` prevale su workspace locale, heavy asset storage, model-weight Git policy e packaging source dei payload;
10. `TECHNICAL_ROADMAP_v0.2.md` prevale sulla sequenza di delivery e sulle priorità tecniche;
11. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md` governa l'esecuzione Lovable ma non può contraddire Product Vision, Game Systems, UI Visual System, Visual Asset Pipeline, Local AI Model Profiles, P0 Plan, External Asset architecture o Roadmap v0.2;
12. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md` prevale sugli aspetti generali di packaging/distribuzione non ridefiniti da documenti più specifici/recenti;
13. `TECHNICAL_ROADMAP_v0.1.md` resta riferimento storico e non prevale su v0.2.

`AGENTS.md`, `CLAUDE.md`, le checklist e i file status rendono operative o descrivono queste regole ma non possono ridefinire autonomamente Product Vision o Knowledge specifica.

Le formule, soglie hardware o scelte marcate `PROVISIONAL` possono essere sostituite dopo playtest, benchmark o prototype review senza modificare la Product Vision.

---

# Decisioni di delivery/asset correnti

```text
WINDOWS-FIRST                       LOCKED
WEB-COMPATIBLE                      LOCKED
VPS-LATER                           LOCKED
DUAL LOCAL AI                       LOCKED ARCHITECTURE
MODEL WEIGHTS OUTSIDE NORMAL GIT    LOCKED
RAW AI VISUAL BATCHES OUTSIDE GIT   LOCKED
AI VISUAL LIBRARY AUTHORING         APPROVED
RUNTIME IMAGE GENERATOR V1          NOT REQUIRED / DEFERRED
PERSISTENT VISUAL IDENTITY          LOCKED PRINCIPLE
LOCAL AGENT EXECUTION ARM           APPROVED
1.7B / 3B MODEL NAMES               PROVISIONAL
HARDWARE REQUIREMENTS               PROVISIONAL UNTIL P0
WEBGPU LOCAL AI                     OPTIONAL / LATER
```

---

# Documenti ancora da creare

Priorità consigliata dopo/parallelamente al P0:

1. `AI_DM_PROTOCOL_v0.1.md`
2. `DATA_SCHEMA_v0.1.md`
3. test fixtures per la 50-case AI quality suite
4. report risultati P0 desktop
5. asset-pack manifest/schema definitivo dopo il primo visual prototype
6. benchmark VPS in una fase successiva

Prima della produzione avanzata UI/content, il gate P0 Windows/local-AI deve produrre almeno un `GO` o `GO WITH LIMITS` documentato.
