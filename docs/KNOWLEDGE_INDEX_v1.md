# KNOWLEDGE INDEX v1
## Chronosaga: The Game

**Data:** 2026-08-30  
**Stato:** indice corrente delle fonti di Knowledge e delle regole di precedenza.

Questo indice stabilisce **quali documenti governano quali decisioni**. Non è una specifica gameplay o tecnica autonoma.

---

# 1. `PRODUCT_VISION_LOCKED_v1.md`

Fonte principale per identità e obiettivi di prodotto:

- Chronosaga come systemic adventure/management simulator, non semplice RPG/chat/story generator;
- world autonomy;
- meaningful choice;
- micro -> macro senza perdere la scala umana;
- personaggi ad alta importanza;
- conseguenze di lungo periodo;
- sandbox;
- difficoltà;
- anti-AI-slop;
- depth before breadth.

---

# 2. `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`

Fonte generale/storica per architettura concettuale, AI-DM, UI, VPS, workflow e decisioni approvate non sostituite da fonti più specifiche.

---

# 3. `TECHNICAL_ROADMAP_v0.3.md`

**Fonte tecnica prevalente per priorità e sequencing correnti.**

Strategia:

```text
WINDOWS-FIRST
WEB-COMPATIBLE
VPS-LATER
```

La v0.3 registra il nuovo modello a **due gate ortogonali**:

```text
TECHNICAL RELEASE GATE     P0.5 / #17
GAMEPLAY QUALITY GATE      GQP / #30
```

e la sequenza gameplay corrente:

```text
GQP-0 DONE
-> #34 Core hygiene
-> GQP-A
-> GQP-B
-> GQP-C
-> GQP-D
-> founder fun PASS
-> independent sample PASS
-> M2 expansion
```

`TECHNICAL_ROADMAP_v0.2.md` resta riferimento storico/dettagliato dei milestone dove non contraddice v0.3. `TECHNICAL_ROADMAP_v0.1.md` è storico.

---

# 4. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`

Fonte per fattibilità generale piattaforme/distribuzione:

- Web + Windows;
- Tauri;
- SQLite vs PostgreSQL;
- llama.cpp;
- packaging;
- VPS feasibility;
- browser-local AI feasibility.

Sul sequencing prevale `TECHNICAL_ROADMAP_v0.3.md`.

---

# 5. `GAME_SYSTEMS_SCHEMA_v0.1.md`

Fonte prevalente per sistemi gameplay e simulazione:

- Tactical Combat Engine;
- Warfare Engine;
- Management & Simulation Engine;
- d100;
- caratteristiche/skill/ferite;
- squadre/comandanti/logistica;
- produzione/economia/popolazione;
- politica/fazioni/diplomazia;
- World Tick;
- StateDelta;
- causal graph;
- micro <-> macro;
- assunzioni LOCKED / PROVISIONAL / OPEN.

Il target finale resta valido. Il Gameplay Quality Proof restringe temporaneamente lo scope prima dell'espansione M2.

---

# 6. `UI_VISUAL_SYSTEM_v0.1.md`

Fonte prevalente per UI/UX e linguaggio visuale:

- game UI / diegetic OS balance;
- layout/navigation;
- palette/typography/geometry;
- Tactical/Warfare/Management presentation;
- party/personaggi/ferite/relazioni;
- event presentation;
- Analysis Mode;
- informational fog of war;
- responsive desktop;
- motion/audio UI.

---

# 7. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md`

Brief operativo per la UI vertical slice. Governa Lovable ma non può spostare authority dal Simulation Core a React e non può anticipare sistemi vietati dal GQP.

---

# 8. `LOCAL_AI_MODEL_PROFILES_v0.1.md`

Fonte per dettagli tecnici/provisori dei profili locali:

- Lite ~1.7B;
- Standard ~3B;
- hardware probe;
- context/memory assumptions;
- candidate families;
- AUTO/fallback assumptions;
- WebGPU later.

Candidate names/quantizations restano PROVISIONAL finché P0.5 non produce il lock.

---

# 9. `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`

Fonte operativa prevalente per il gate P0/P0.5:

- Windows runtime;
- SQLite;
- llama.cpp;
- Lite/Standard benchmark;
- suite qualità versionata;
- performance/context/hardware evidence;
- validator/retry/fallback;
- candidate lock;
- exit `GO / GO WITH LIMITS / NO-GO`.

**Stato 2026-08-30:** harness ed execution lane sono mergiati; il workspace locale contiene benchmark evidence e l'inventario del 2026-08-29 identifica `official_1787510438` come run valida, ma issue #17 resta aperta e il repository non contiene ancora il verdict finale quality/performance/hardware/release-candidate. Nessun modello è release-approved.

---

# 10. `IMPLEMENTATION_BACKLOG_v0.1.md`

Backlog operativo storicamente aggiornato internamente a v0.2. Va interpretato insieme alla Roadmap v0.3 e al GQP: eventuali item M2 non superano il fun gate.

---

# 11. `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`

Fonte prevalente per separazione repository/workspace:

- GitHub source of truth per codice, manifest e documentazione;
- `D:\Chronosaga` come workspace operativo configurabile;
- GGUF e runtime pesanti fuori dal normale Git;
- raw AI/evidence pesanti fuori dal normale Git;
- manifest/checksum/licenze;
- packaging source;
- backup source separato da heavy-asset backup.

L'inventario locale 2026-08-29 ha confermato una sola codebase Git Chronosaga sotto `D:\Chronosaga\repo\chronosaga_the_game`; il playable corrente è la build Tauri di questa repository, non un secondo prototipo/codebase separato.

---

# 12. `VISUAL_ASSET_PIPELINE_v0.1.md`

Fonte prevalente per produzione grafica AI-assisted/procedurale:

- image generation come authoring esterno;
- no runtime image generation requirement v1;
- persistent character identity;
- portrait/sprite/icon pipeline;
- raw -> curated -> master -> game-ready;
- provenance/hash/metadata;
- grandi batch fuori Git.

---

# 13. `AI_PRODUCT_ROLE_AND_OFFLINE_DISTRIBUTION_v1.md`

Fonte specifica e prevalente per ruolo dell'AI:

- AI centrale all'esperienza normale ma non autorevole;
- Simulation Core fonte dei fatti/conseguenze;
- AI per dialoghi, reazioni, narrativa, sintesi e interpretazione grounded;
- normal profiles `AUTO / LITE / STANDARD`;
- `SAFE / PROCEDURAL` degraded fallback;
- fallback `STANDARD -> LITE -> SAFE/PROCEDURAL`;
- Windows Full Offline include Lite + Standard;
- un solo modello residente alla volta;
- nessuna API cloud obbligatoria.

---

# 14. `GAMEPLAY_QUALITY_PROOF_v0.1.md`

**Fonte prevalente per il gate gameplay tra M1 e M2.**

M1 ha dimostrato che il loop funziona tecnicamente. Il GQP deve dimostrare che produce gioco interessante prima di espandere contenuto e sistemi.

Definisce:

- meaningful-choice principles;
- two proof pressures;
- character memory/relationship causal behavior;
- faction agenda;
- five event families;
- pattern detectors;
- resolved-event history;
- schema v2 proof strategy;
- deterministic selection;
- `GameplayFocus = EVENT | QUIET`;
- bounded quiet/liveness;
- GQP-0/A/B/C/D implementation slices;
- founder fun + independent sample gates.

Sequenza non negoziabile:

```text
GQP technical completion
-> founder fun PASS
-> independent small-sample PASS
-> M2 expansion
```

GQP-0 è completato con PR #33. Tracking generale: #30.

---

# File operativi root/config/status

Questi file rendono operative le Knowledge sources ma non ridefiniscono autonomamente Product Vision.

## `/AGENTS.md`

Regole obbligatorie per agenti:

- ordine di lettura Knowledge;
- branch/PR workflow;
- architecture boundaries;
- heavy-file policy;
- validation gates;
- agente come esecutore, non product director;
- niente Codex nel workflow Chronosaga salvo autorizzazione esplicita del proprietario del progetto.

## `/CLAUDE.md`

Bridge operativo per Claude Code; importa `@AGENTS.md`.

## `/REPOSITORY_BOOTSTRAP_STATUS.md`

**Unica fotografia operativa canonica** di stato corrente, gate, branch ed evidence. Non è normativa; se diverge dal repository reale, prevale il repository.

## `LOCAL_WORKSPACE_SETUP_CHECKLIST_v0.1.md`

Checklist operativa derivata dalla workspace architecture.

## `ARCHITECTURE_STATE_REVIEW_2026-08-18.md`

Snapshot storico/informativo della review tecnica del 18 agosto 2026.

## `config/runtime-assets.example.json`

Esempio development-only del contratto External Asset Store; non certifica payload installati/approvati.

---

# Stato operativo sintetico — 2026-08-30

```text
P0.1-P0.4                        MERGED / VERIFIED
P0.5 harness/execution lane      MERGED / VERIFIED
P0.5 local evidence              PRESENT
P0.5 final verdict / lock        OPEN (#17)

M1-A / M1-B / M1-C              COMPLETE / VERIFIED
Gameplay Quality Proof spec      MERGED
GQP-0                            COMPLETE / VERIFIED
GQP-A                            NOT STARTED
GQP overall                      OPEN (#30)
World Tick finite hygiene        OPEN (#34)

post-GQP0 baseline develop       aaa8266b4f613f4f4e06148ab961f706a7eb50d0
main                             divergent / deliberate promotion required
```

Per l'HEAD operativo corrente dopo eventuali PR documentali successive usare `REPOSITORY_BOOTSTRAP_STATUS.md` e il repository reale, non questo baseline SHA storico.

---

# Regola di precedenza

In caso di conflitto:

1. prevale il documento più specifico per il dominio;
2. a parità di specificità, prevale versione/data più recente;
3. `PRODUCT_VISION_LOCKED_v1.md` governa identità e priorità generali di prodotto;
4. `GAMEPLAY_QUALITY_PROOF_v0.1.md` governa lo scope/gate temporaneo tra M1 e M2 e restringe l'espansione finché il proof non passa;
5. `AI_PRODUCT_ROLE_AND_OFFLINE_DISTRIBUTION_v1.md` governa ruolo AI, profili normali/fallback e Full Offline dual-model requirement;
6. `GAME_SYSTEMS_SCHEMA_v0.1.md` governa dettagli dei sistemi gameplay target;
7. `UI_VISUAL_SYSTEM_v0.1.md` governa UI/UX;
8. `VISUAL_ASSET_PIPELINE_v0.1.md` governa visual asset authoring;
9. `LOCAL_AI_MODEL_PROFILES_v0.1.md` governa dettagli tecnici/provisori dei profili non ridefiniti da fonti più specifiche;
10. `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md` governa esecuzione e verdict P0/P0.5;
11. `LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md` governa workspace/heavy assets;
12. `TECHNICAL_ROADMAP_v0.3.md` governa priorità/sequencing tecnici correnti;
13. `TECHNICAL_ROADMAP_v0.2.md` resta dettaglio storico dove v0.3 non lo sostituisce;
14. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md` governa l'esecuzione Lovable entro i boundary sopra;
15. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md` governa aspetti generali di piattaforma/distribuzione non ridefiniti da fonti più specifiche.

`AGENTS.md`, `CLAUDE.md`, checklist e status non possono contraddire queste fonti.

---

# Decisioni correnti

```text
WINDOWS-FIRST                         LOCKED
WEB-COMPATIBLE                        LOCKED
VPS-LATER                             LOCKED
AI CENTRAL / CORE AUTHORITATIVE       LOCKED
NORMAL AI MODES AUTO/LITE/STANDARD    LOCKED
SAFE/PROCEDURAL = DEGRADED FALLBACK   LOCKED
FULL OFFLINE INCLUDES LITE+STANDARD   LOCKED PRODUCT REQUIREMENT
ONE LOCAL MODEL RESIDENT AT A TIME    LOCKED
MODEL WEIGHTS OUTSIDE NORMAL GIT      LOCKED
RAW BENCHMARK EVIDENCE OUTSIDE GIT    LOCKED
PERSISTENT VISUAL IDENTITY            LOCKED PRINCIPLE
RUNTIME IMAGE GENERATOR V1            NOT REQUIRED / DEFERRED
GQP BEFORE M2 EXPANSION               LOCKED FOR CURRENT DELIVERY
MODEL RELEASE APPROVAL                REQUIRES P0.5 VERDICT
EXACT GGUF / QUANTIZATION             PROVISIONAL UNTIL P0.5 LOCK
PHYSICAL MULTI-GB PACKAGE FORMAT      PROVISIONAL UNTIL RELEASE GATE
HARDWARE REQUIREMENTS                 PROVISIONAL UNTIL P0.5
WEBGPU LOCAL AI                       OPTIONAL / LATER
```

---

# Prossime fonti/documenti attesi

Dopo la chiusura del piccolo follow-up #34 e durante il GQP:

1. contratti/schema proof prodotti da GQP-A;
2. eventuali fixtures/report di GQP-B/C;
3. playtest evidence GQP-D;
4. P0.5 verdict/report repository-facing per riconciliare l'evidenza locale;
5. `AI_DM_PROTOCOL_v0.1.md` quando il production AI-DM layer diventa il prossimo boundary reale;
6. asset-pack manifest definitivo dopo il relativo prototype/release need.

Prima di espandere M2, prevale il Gameplay Quality Proof. Prima di approvare modelli/release Windows Full Offline, prevale P0.5.
