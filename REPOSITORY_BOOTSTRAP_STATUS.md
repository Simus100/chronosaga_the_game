# REPOSITORY BOOTSTRAP STATUS
## Chronosaga: The Game

**Snapshot:** 2026-08-30 (post-merge PR #33 / GQP-0)  
**Tipo:** stato operativo/informativo, **non normativo**.

Questo file è la fotografia operativa canonica del progetto. Non sostituisce Product Vision, Knowledge, Roadmap, P0 Plan o Gameplay Quality Proof. In caso di conflitto con il repository reale, **prevalgono Git, test, CI, artefatti e prove riproducibili**.

## Legenda

```text
MERGED / VERIFIED      mergiato in develop e coperto da gate/evidenza verificata
OPEN / IN PROGRESS     gate o issue ancora aperta
EVIDENCE PRESENT       esiste evidenza locale, ma il verdetto non è ancora lockato in repo
NOT RELEASE-APPROVED   candidato tecnico, nessuna approvazione di rilascio
OUT OF SCOPE           deliberatamente non incluso nella fase corrente
```

---

## Branch state

- `develop` osservato e validato: `aaa8266b4f613f4f4e06148ab961f706a7eb50d0`
  — merge PR #33, **GQP-0 structural hygiene**.
- `main` osservato: `27571a85100a11875cad7d72431a48586573a976`.
- Confronto `main...develop` al 2026-08-30: **diverged**, `develop` 129 commit avanti e 3 indietro; merge base `490c8871b45e12a62086826bdda172919c289a66`.
- Non riallineare automaticamente `main` e `develop` con force/merge opportunistici. La promozione `develop -> main` resta una decisione deliberata con review del diff.
- Questo file viene aggiornato tramite branch/PR documentale e quindi non pinna necessariamente il commit di merge della propria PR come HEAD finale.

---

# Stato dei gate

## P0.1 — Windows desktop runtime — MERGED / VERIFIED

Tauri Windows avviabile/installabile, diagnostica hardware/risorse, build e installer verificati sul PC Windows target.

## P0.2 — persistence baseline — MERGED / VERIFIED

SQLite save/load e persistenza attraverso chiusura/riapertura sono provati. Il lavoro M1-C ha successivamente esteso il boundary alla persistenza del `WorldState` sistemico reale.

## P0.3 — owned llama.cpp + first real Lite inference — MERGED / VERIFIED

- llama.cpp pinned;
- lifecycle owned dal desktop;
- binding loopback-only;
- Lite inference reale;
- output strutturato validato application-side;
- heavy runtime/model payload fuori dal normale Git.

## P0.4 — Standard, AUTO, Safe fallback, installed model resolution — MERGED / VERIFIED

- Standard desktop integration;
- AUTO/profile switching;
- `STANDARD -> LITE -> SAFE/PROCEDURAL` fallback;
- installed-model resolution hardening;
- un solo modello locale residente alla volta.

`SAFE / PROCEDURAL` resta recovery/degraded continuity, non un quarto profilo normale equivalente.

## P0.5-A / P0.5-B1 — benchmark harness + execution lane — MERGED / VERIFIED

La suite versionata corrente contiene 65 casi e l'infrastruttura di esecuzione ufficiale Lite-vs-Standard è mergiata. Il reporting è fail-closed, l'evidenza raw resta fuori dal repository e i candidati non vengono promossi soltanto perché l'inferenza funziona.

## P0.5 — quality/performance/release decision — OPEN / IN PROGRESS

Issue autoritativa: **#17**.

La vecchia fotografia del 2026-08-23 diceva che la run ufficiale non era stata eseguita. Questa affermazione non è più sufficiente: l'inventario locale del workspace svolto il 2026-08-29 ha riportato quattro directory/run P0.3-P0.5 e ha identificato `D:\Chronosaga\benchmarks\p0.5\official_1787510438` come run locale valida.

Questa evidenza vive fuori da Git e **non viene trasformata automaticamente in un verdetto**. Nel repository, #17 resta aperta e non è ancora registrata una decisione finale KEEP/REPLACE/NO NORMAL-PROFILE QUALITY, né un lock completo di performance/hardware/AUTO thresholds.

Stato corretto quindi:

```text
benchmark infrastructure        DONE
local benchmark evidence        PRESENT
repository quality verdict      OPEN
performance/hardware lock       OPEN
release candidate lock          OPEN
final P0 verdict                OPEN
```

La precedente run interrotta `official_1787448652` resta historical incomplete evidence e non deve essere modificata o usata come verdetto.

## Model profiles — NOT RELEASE-APPROVED

```text
LITE      Qwen3-1.7B Q4_K_M   benchmark candidate
STANDARD  SmolLM3-3B Q4_K_M   benchmark candidate
SAFE / PROCEDURAL             degraded continuity path
```

Finché #17 non produce una decisione esplicita, nessun profilo viene dichiarato release-ready e `releaseApproved=true` non è giustificato.

## Windows Full Offline bundle — OPEN

Il requisito di prodotto resta: Windows Full Offline deve poter distribuire localmente **Lite + Standard** dopo il lock P0.5. La forma fisica definitiva del bundle multi-GB e la clean-machine release proof non sono ancora chiuse.

---

# M1 — Shared systemic foundation — COMPLETE / VERIFIED

## M1-A — systemic world foundation — MERGED / VERIFIED

Fondazione `WorldState` sistemica, entità e authority del Simulation Core.

## M1-B — first useful World Tick — MERGED / VERIFIED

Primo tick deterministico con produzione/consumo e reazioni sistemiche.

## M1-C — first playable systemic Windows loop — MERGED / VERIFIED

Issue #19 chiusa. PR #29 merge commit:

`10ea07c54327f363211921e7f3104c1cade6e638`

Acceptance verificata nell'app Windows installata:

```text
NEW / LOAD
-> EVENT / CHOICE
-> deterministic resolve
-> StateDelta
-> WORLD TICK
-> systemic reaction
-> SAVE
-> full process close
-> reopen
-> LOAD same authoritative state
-> continue
```

Evidenza registrata:

- exact-head CI green;
- AI-enabled NSIS installato e verificato;
- migrazione SQLite legacy preservata;
- scelta + StateDelta + due World Tick esercitati;
- save/close/reopen/load con stato autoritativo preservato esattamente;
- continuazione del gioco dal save;
- persistence-lock overlap checks;
- loop Safe/Procedural completato con zero GGUF e zero llama-server inference.

**Il playable corrente non è una seconda codebase/prototipo separato:** l'inventario locale del 2026-08-29 non ha trovato un altro progetto Chronosaga. L'app installata in `%LOCALAPPDATA%` è una build della stessa repository.

---

# Gameplay Quality Proof — ACTIVE GATE BEFORE M2

Spec normativa: `docs/GAMEPLAY_QUALITY_PROOF_v0.1.md`.  
Tracking issue: **#30** — open.

M1 dimostra che il loop funziona tecnicamente. Non dimostra ancora che sia abbastanza interessante da giustificare l'espansione M2. Il GQP è quindi il gate gameplay/fun tra M1 e M2.

Sequenza lockata del proof:

```text
GQP-0 structural hygiene
   -> GQP-A contracts/scenario
   -> GQP-B meaningful-choice network
   -> GQP-C directed pacing
   -> GQP-D real Windows playtest
   -> founder fun PASS
   -> independent small-sample PASS
   -> M2 expansion
```

## GQP-0 — MERGED / VERIFIED

PR #33 merged.  
Accepted feature HEAD: `7cc571eea0abf4d9a8ce7d1654f1a8e3bbdb5fef`  
Merge commit / current develop authority: `aaa8266b4f613f4f4e06148ab961f706a7eb50d0`  
Issue #32: **closed / completed**.

GQP-0 ha introdotto soltanto hygiene strutturale, senza nuovo gameplay:

- shared authoritative `EventEffect` applicator;
- validator/applicator parity fail-closed;
- atomic finite `RESOURCE_DELTA` writes;
- typed `GameplayFocus = EVENT | QUIET`;
- lifecycle boundary senza raw state transition pubblica;
- GQP event selection order-independent e replay-safe;
- delayed consequence ordering locale-independent;
- M1 behavior/schema preservati.

Exact-head CI e Windows desktop checks erano verdi prima del merge.

## Core hygiene follow-up — issue #34 — OPEN

Durante la review finale di GQP-0 è stato identificato un writer numerico separato in `run-world-tick.ts` che non eredita automaticamente la nuova guardia finite-result di `RESOURCE_DELTA`.

Issue #34 traccia il fix fail-closed per l'aritmetica World Tick. Non riapre GQP-0 e non introduce gameplay.

## GQP-A — NOT STARTED

Non iniziare ancora GQP-B/C/D, tactical combat, 20–30 event expansion o altri sistemi M2. Il prossimo lavoro gameplay è GQP-A dopo il piccolo follow-up di hygiene #34 e il presente docs-sync.

---

# Due gate ortogonali

Chronosaga ora ha due rischi distinti, che non vanno confusi:

```text
TECHNICAL RELEASE GATE                GAMEPLAY QUALITY GATE
P0.5 / #17                            GQP / #30
AI quality + performance              meaningful decisions
model/release candidate lock          causal readability
hardware/AUTO evidence                character attachment
Full Offline feasibility              pacing / curiosity debt
```

- P0.5 decide **con quale AI locale e su quale hardware** il prodotto può essere distribuito.
- GQP decide **se il piccolo sistema giocabile è abbastanza interessante** da espandere.
- GQP technical work può procedere mentre #17 resta aperta quando non interferisce con il benchmark.
- M2 expansion non può bypassare il GQP.
- Model/release approval non può bypassare P0.5.

---

# Workspace locale osservato

Inventario locale 2026-08-29:

```text
D:\Chronosaga\
├── repo\chronosaga_the_game\   unica codebase Git Chronosaga trovata
├── runtime-assets\             ~3.1 GB, GGUF + llama.cpp fuori Git
├── builds\                     snapshot P0.4 del 20 agosto
├── benchmarks\                 evidence P0.3-P0.5 fuori Git
├── temp\                       scratch
└── documenti operativi locali
```

Non è stata trovata una cartella separata contenente un vecchio prototipo giocabile. Le build archiviate P0.4 precedono M1-C e mostrano il diagnostic surface; il playable sistemico corrente deriva dalla repository attuale.

---

# Sequenza operativa corrente

```text
GQP-0 merge / close #32                     DONE
        ↓
post-GQP0 documentation sync                CURRENT
        ↓
#34 World Tick finite arithmetic hygiene
        ↓
GQP-A contracts / proof scenario
        ↓
GQP-B meaningful-choice network
        ↓
GQP-C directed pacing
        ↓
GQP-D installed Windows playtest
        ↓
founder fun PASS
        ↓
independent small-sample PASS
        ↓
M2 expansion
```

In parallelo, senza interferire con questa lane:

```text
#17 P0.5 evidence reconciliation
→ quality / performance / hardware verdict
→ model candidate lock
→ final P0 / Full Offline release gate
```

---

# Limiti e debiti aperti

- #17 P0.5 non ha ancora un verdict/release lock registrato.
- #30 Gameplay Quality Proof non ancora completato.
- #34 World Tick finite-result hygiene aperto.
- Windows Full Offline multi-GB clean-install proof non chiusa.
- GPU acceleration non è un requisito P0.5 CPU baseline e non è ancora una release claim.
- PostgreSQL production adapter, authentication e VPS/public deployment restano fasi successive.
- Runtime image generation resta OUT OF SCOPE per v1.
- `main` non rappresenta ancora l'attuale `develop`; promozione da fare solo deliberatamente.

---

# Invarianti da non violare

- `packages/game-core` è autorevole e deterministico.
- L'AI non muta mai direttamente lo stato autoritativo.
- Nessun GGUF/model weight/raw benchmark evidence nel normale Git.
- `llama-server` resta loopback-only.
- Un solo LLM locale residente alla volta.
- `SAFE / PROCEDURAL` è fallback degradato, non profilo normale equivalente.
- Nessun modello release-ready senza P0.5.
- Nessuna espansione M2 prima del Gameplay Quality Proof PASS.
- Gameplay Beat, Player Turn e World Tick restano concetti distinti.
