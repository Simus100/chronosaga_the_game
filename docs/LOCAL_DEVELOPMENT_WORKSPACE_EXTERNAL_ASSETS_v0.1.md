# LOCAL DEVELOPMENT WORKSPACE & EXTERNAL ASSETS v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Stato:** Architectural decision  
**Ambito:** workspace locale, modelli pesanti, asset visivi/audio, build, benchmark e packaging

---

# 1. Decisione

Chronosaga usa un modello di sviluppo **ibrido**:

```text
CHAT / PRODUCT BRAIN
        ↓
GITHUB — source of truth
        ↓
LOCAL DEVELOPMENT AGENT
        ↓
LOCAL WORKSPACE / HEAVY ASSET STORE
        ↓
BUILD / TEST / BENCHMARK
```

La chat e GitHub restano il centro decisionale e documentale. Un agente locale viene usato come braccio operativo quando il lavoro richiede accesso diretto a file multi-GB, compilazioni, benchmark, conversioni e packaging.

La repo Git NON deve diventare un archivio di modelli o raw asset da molti GB.

---

# 2. Separazione obbligatoria

## GitHub contiene

- codice;
- configurazioni;
- contratti;
- schema e manifest;
- documentazione;
- piccoli asset appropriati alla repo;
- test e fixture ragionevoli;
- versioni/checksum/licenze di asset esterni quando locked;
- workflow CI;
- storia delle review.

## External Asset Store contiene

- GGUF e altri model weights;
- eventuali runtime pack pesanti;
- batch raw di immagini generate;
- master/editable graphics;
- grandi librerie portrait/sprite/environment;
- audio sorgente e pack pesanti;
- cache;
- build locali;
- benchmark raw;
- file temporanei.

Principio:

> **Git descrive e verifica i payload pesanti; il workspace locale conserva i byte pesanti.**

---

# 3. Workspace Windows consigliato

Convenzione iniziale:

```text
D:\Chronosaga\
│
├── repo\
│   └── chronosaga_the_game\
│
├── runtime-assets\
│   ├── models\
│   │   ├── lite\
│   │   └── standard\
│   │
│   ├── visual-source\
│   │   ├── ai-generations\
│   │   ├── master\
│   │   └── character-sheets\
│   │
│   ├── visual-ready\
│   │   ├── portraits\
│   │   ├── sprites\
│   │   ├── equipment\
│   │   ├── environment\
│   │   └── ui\
│   │
│   ├── audio\
│   └── licenses\
│
├── builds\
├── benchmarks\
└── temp\
```

`D:\Chronosaga` è una convenzione per la macchina di sviluppo, NON deve essere hard-coded nel gioco.

Convenzione prevista per agent/tooling:

```text
CHRONOSAGA_WORKSPACE_ROOT
```

Un tool può usare la variabile di ambiente o una configurazione esplicita. Il runtime distribuito al giocatore deve invece usare normali directory applicative/installazione.

---

# 4. Contratto asset esterni

La repository include `config/runtime-assets.example.json` come esempio architetturale. Non è un elenco di file già installati e non implica che un modello candidato sia stato approvato per release.

Per ogni payload pesante che diventa distribuibile devono poter essere registrati almeno:

```text
assetId
assetType
profile / pack
expected filename
version
exact byte size
SHA-256
license
attribution
source/release identity
packaging status
required / optional
```

Finché versione, hash e licenza non sono verificati, il payload resta `PROVISIONAL` / development-only.

---

# 5. Politica modelli locali

I model weights non entrano nel normale Git.

```text
models/manifest.json    ✅ Git
models/README.md        ✅ Git
GGUF                    ❌ Git
raw model cache         ❌ Git
```

Durante sviluppo:

```text
D:\Chronosaga\runtime-assets\models\lite\...
D:\Chronosaga\runtime-assets\models\standard\...
```

Durante packaging:

```text
EXTERNAL VERIFIED MODEL
        ↓ SHA/license check
PACKAGING STAGE
        ↓
WINDOWS INSTALLER / MODEL PACK
```

Il packaging deve fallire esplicitamente se un asset richiesto manca o non corrisponde all'hash locked. Non deve scaricare o sostituire silenziosamente un modello diverso.

---

# 6. Strategia visual asset

L'AI grafica è usata come strumento di authoring, non come requisito runtime della v1.

```text
IMAGE GENERATOR / ARTIST TOOL
        ↓
RAW SOURCE
        ↓ curation
MASTER / NORMALIZATION
        ↓
GAME-READY LIBRARY
        ↓
PACKAGING
        ↓
CHRONOSAGA
```

Il dettaglio è definito in `VISUAL_ASSET_PIPELINE_v0.1.md`.

I raw batch AI e master pesanti restano esterni. La repo può contenere piccoli asset approvati oppure manifest/metadata di pack più grandi.

---

# 7. Asset pack e installer

La struttura deve permettere sia una release completa sia pack separati.

```text
FULL OFFLINE
Game
+ runtime
+ required visual/audio assets
+ Lite
+ Standard (se confermato dal packaging finale)
```

oppure:

```text
COMPACT
Game
+ required assets
+ Lite

OPTIONAL PACK
Standard
+ eventuali high-resolution asset pack
```

La scelta finale dipenderà da benchmark, dimensione, licenze e UX di distribuzione. L'architettura non deve obbligare a una sola strategia.

---

# 8. Responsabilità dell'agente locale

L'agente può:

- clonare/sincronizzare il repository;
- lavorare su feature branch;
- compilare;
- eseguire test;
- avviare benchmark;
- manipolare i file pesanti nel workspace;
- calcolare hash;
- generare report;
- preparare installer;
- aprire PR.

L'agente NON deve automaticamente:

- cambiare Product Vision;
- rendere l'AI autorevole;
- committare file pesanti;
- modificare direttamente `main` per feature work;
- esporre il runtime locale su rete pubblica;
- accettare una licenza non verificata;
- eliminare dati/save per risolvere un problema;
- sostituire un asset locked con uno diverso senza aggiornare manifest e review.

Le regole operative sono anche in `/AGENTS.md`.

---

# 9. Backups

Sono distinti:

## Source backup

GitHub + source snapshot CI.

## Heavy asset backup

Deve essere gestito separatamente dal Git, con copia/backup dell'External Asset Store o di pack/versioni approvate.

Non usare la history Git come backup di GGUF, raw AI generation o build multi-GB.

---

# 10. Relazione con P0.3

Prima del sidecar AI reale, la struttura attesa è:

```text
repo
  ├── code
  ├── manifest
  └── architectural metadata

external workspace
  └── verified development llama/model payloads
```

P0.3 può quindi:

1. trovare un runtime locale verificato;
2. trovare il modello selezionato nello store di sviluppo;
3. avviare `llama-server` loopback-only;
4. fare health check;
5. generare output strutturato;
6. arrestare il processo;
7. lasciare Git completamente privo dei model weights.

---

# 11. Decisioni LOCKED / PROVISIONAL

```text
GITHUB SOURCE OF TRUTH                  LOCKED
HEAVY MODEL WEIGHTS OUTSIDE NORMAL GIT  LOCKED
RAW AI VISUAL BATCHES OUTSIDE GIT       LOCKED
LOCAL AGENT AS EXECUTION ARM             APPROVED
CHAT / SPECS AS PRODUCT BRAIN            APPROVED
D:\Chronosaga DEFAULT DEV PATH           PROVISIONAL CONVENTION
CHRONOSAGA_WORKSPACE_ROOT ENV NAME       PROVISIONAL CONVENTION
FULL vs COMPACT FINAL PACKAGING           OPEN UNTIL BENCHMARK/RELEASE GATE
```
