# PLATFORM, DISTRIBUTION & LOCAL AI — FEASIBILITY v1
## Parametric AI Adventure Simulator

**Versione:** 1.0  
**Data:** 2026-08-16  
**Stato:** Decisione architetturale approvata, con benchmark obbligatori prima del lock tecnico finale  
**Scopo:** definire in modo realistico come un unico progetto possa produrre versione Web, versione Windows offline con piccolo modello AI incluso e demo HTML, mantenendo il progetto self-hosted e tecnicamente sostenibile.

---

# 1. Verdetto di fattibilità

## VERDETTO GENERALE

**Il progetto è fattibile**, a condizione di rispettare tre regole:

1. mantenere il **Simulation Core indipendente dall'AI**;
2. condividere il core e i dati tra Web e Windows attraverso adapter di piattaforma;
3. scegliere il modello locale solo dopo benchmark reali su VPS e PC target.

Non è necessario usare RPG Maker MV o GameMaker.

La direzione tecnica approvata è:

```text
REACT + TYPESCRIPT
        │
        ├── GAME CORE condiviso
        ├── GAME DATA condivisi
        └── UI condivisa
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
       WEB             WINDOWS
        │                │
   Browser + VPS       Tauri
        │                │
 PostgreSQL + AI      SQLite + AI locale
 server-side          incluso nel pacchetto
```

---

# 2. Obiettivo di distribuzione

Il progetto deve produrre almeno queste build.

## 2.1 WEB

Accesso tramite browser.

```text
Browser
   ↓ HTTPS
VPS
   ├── frontend
   ├── API
   ├── Simulation Core
   ├── PostgreSQL
   ├── AI-DM
   └── assets
```

Vantaggi:

- nessuna installazione;
- test immediati;
- aggiornamenti centralizzati;
- ideale per alpha e beta;
- permette di osservare il comportamento degli utenti;
- utile come prima build realmente pubblicabile.

---

## 2.2 WINDOWS FULL OFFLINE

Applicazione installabile con un normale Setup Windows.

Obiettivo utente:

```text
ParametricAdventure-Setup.exe
        ↓
INSTALLA
        ↓
AVVIA
        ↓
GIOCA
```

L'utente non deve installare manualmente:

- Node.js;
- Python;
- PostgreSQL;
- Ollama;
- llama.cpp;
- OpenClaw;
- altri runtime di sviluppo.

Il pacchetto deve contenere:

```text
WINDOWS APP
│
├── Tauri host
├── React UI
├── Simulation Core
├── Game Data
├── SQLite
├── llama.cpp runtime
├── piccolo modello GGUF
├── assets
└── save system
```

Questa è una **hard product requirement**.

---

## 2.3 WINDOWS HYBRID — futura

La stessa applicazione potrà scegliere:

```text
LOCAL
→ SQLite + modello locale

ONLINE
→ server + PostgreSQL + modello server

AUTO
→ locale se disponibile, server come fallback
```

Non è richiesta nella prima vertical slice.

---

## 2.4 HTML DEMO

Build statica leggera:

```text
index.html
assets/
js/
css/
data/
```

Oppure, per demo molto piccole, anche un unico file HTML con CSS/JS/data incorporati.

Uso:

- prototipi;
- condivisione rapida;
- test UX;
- demo;
- showcase.

Non è la build definitiva per l'edizione completa con LLM incluso.

Per la demo HTML:

- Simulation Core: sì;
- eventi JSON: sì;
- proceduralità: sì;
- salvataggio browser: sì;
- AI procedurale/template: sì;
- modello GGUF incluso ed eseguito come desktop sidecar: no.

---

# 3. Una sola codebase, non due giochi

Regola fondamentale:

> **Web e Windows devono condividere il più possibile lo stesso codice.**

Non creare:

```text
/web-game
/windows-game
```

come due prodotti indipendenti.

Creare invece:

```text
/apps
  /web
  /server
  /desktop

/packages
  /game-core
  /game-data
  /game-types
  /ui-system
  /ai-contracts
  /persistence-contracts
```

---

# 4. Cosa deve essere realmente condiviso

## 4.1 GAME CORE

Pure TypeScript.

Non deve dipendere da:

- browser;
- Node;
- PostgreSQL;
- SQLite;
- Tauri;
- AI provider.

Contiene:

- world tick;
- event resolver;
- combat;
- economy;
- resources;
- characters;
- relationships;
- factions;
- RNG;
- delayed consequences;
- validation.

---

## 4.2 GAME DATA

Condivisi tra tutte le build:

- JSON;
- eventi;
- item;
- personaggi;
- fazioni;
- regole;
- location;
- tabelle di generazione.

---

## 4.3 UI SYSTEM

Stessi componenti React e stesso Visual System per:

- browser;
- desktop.

La versione desktop non deve avere una UI differente dal Web salvo necessità native.

---

# 5. Adapter di piattaforma

Le differenze Web/Windows devono stare negli adapter.

## WEB

```text
PersistenceAdapter → PostgreSQL tramite API
AIAdapter          → AI sulla VPS / provider cloud
AssetAdapter       → storage server
```

## WINDOWS

```text
PersistenceAdapter → SQLite
AIAdapter          → llama.cpp locale
AssetAdapter       → filesystem locale
```

Il Game Core non deve sapere quale adapter è attivo.

---

# 6. Architettura Web

```text
INTERNET
   │
   ▼
NGINX / CADDY
   │
   ├── WEB FRONTEND
   │
   └── API
        │
        ├── GAME CORE
        ├── PostgreSQL
        ├── AI-DM Gateway
        │     └── llama.cpp / API alternativa
        ├── asset storage
        └── event log
```

Il browser non deve accedere direttamente a:

- database;
- modello;
- API key;
- OpenClaw.

---

# 7. Architettura Windows Offline

```text
TAURI APP
   │
   ├── React UI
   │
   ├── Game Core TypeScript
   │
   ├── SQLite
   │
   └── Local AI Adapter
           │
           ▼
     llama-server.exe
           │
           ▼
       model.gguf
```

Il runtime AI viene avviato automaticamente dall'app.

---

# 8. Tauri — decisione approvata

Tauri è il contenitore desktop scelto per la prima architettura Windows.

Motivazioni:

- permette di riutilizzare frontend web;
- genera normali installer Windows;
- permette di includere eseguibili esterni;
- permette di includere file aggiuntivi di grandi dimensioni come risorse;
- supporta SQLite tramite plugin SQL;
- evita di riscrivere il progetto in un motore desktop differente.

Target iniziale:

```text
Windows x64
```

Output:

```text
NSIS setup.exe
```

MSI può essere aggiunto.

---

# 9. llama.cpp — runtime locale approvato come prima scelta

Il runtime iniziale da benchmarkare è:

**llama.cpp / llama-server**

Motivi:

- esecuzione locale;
- CPU e acceleratori supportati in varie configurazioni;
- GGUF;
- runtime relativamente autonomo;
- server HTTP locale;
- Windows executable disponibile;
- endpoint compatibili con pattern OpenAI;
- nessun Python necessario all'utente finale.

Il gioco non deve accedere alle funzioni tool/file-system di llama.cpp.

Usare il runtime solo per inferenza controllata dal nostro AI Adapter.

---

# 10. Avvio del modello nella build Windows

Sequenza prevista:

```text
Game.exe
   ↓
controlla model.gguf
   ↓
avvia llama-server.exe
   ↓
bind SOLO a 127.0.0.1
   ↓
health check
   ↓
AI Adapter READY
   ↓
gioco
```

Alla chiusura:

```text
Game exits
   ↓
llama-server terminato
```

Il modello non deve aprire una porta pubblica.

---

# 11. Il modello deve essere incluso nel pacchetto

Decisione approvata:

> L'edizione Windows Full Offline contiene un piccolo modello generativo di default.

Struttura logica:

```text
/resources
  /models
    dungeon-master-default.gguf
  /bin
    llama-server.exe
```

L'installer sarà inevitabilmente più grande.

Questo è accettato come trade-off per ottenere:

- zero configurazione;
- offline reale;
- indipendenza dalle API;
- privacy locale;
- costi di inferenza nulli per la partita offline.

---

# 12. Modello locale — NON bloccare ancora il nome

Non selezionare definitivamente il modello in fase di design.

Bloccare invece la **classe**.

## Fascia A — default desiderato

```text
~1.5B–2B parametri
quantizzazione Q4/Q5
```

Obiettivo:

- installazione ragionevole;
- RAM contenuta;
- CPU compatibility;
- buona velocità;
- sufficiente per output strutturato e narrativa breve.

## Fascia B — Quality Pack futuro

```text
~3B–4B
quantizzato
```

Per PC più potenti.

---

# 13. Candidati attuali da BENCHMARKARE, non ancora approvati

Le famiglie seguenti sono candidate tecniche, non decisioni finali.

## Qwen3-1.7B

Caratteristiche utili:

- 1.7B parametri;
- modello instruct/conversational;
- multilingue;
- licenza Apache 2.0 nella versione ufficiale consultata;
- dimensione compatibile con il target Lite dopo quantizzazione.

## SmolLM3-3B

Caratteristiche utili:

- 3B parametri;
- supporto nativo anche all'italiano;
- licenza Apache 2.0 nella versione ufficiale consultata;
- candidato per eventuale Quality Pack.

## Phi-4-mini-instruct

Caratteristiche utili:

- 3.8B parametri;
- progettato anche per ambienti constrained;
- licenza MIT nella versione ufficiale consultata;
- candidato più pesante.

Nessuno è ancora “il modello del gioco”.

---

# 14. Licenza del modello — gate obbligatorio

Prima di distribuire un modello:

1. verificare la licenza della **versione esatta**;
2. verificare la licenza dell'eventuale quantizzazione;
3. includere attribution/licence files richiesti;
4. verificare limiti commerciali;
5. documentare nome, versione e hash;
6. conservare una copia della licenza usata al momento della release.

Non assumere che una famiglia mantenga per sempre la stessa licenza.

---

# 15. Stime di dimensione — solo planning

Stime molto indicative per pesi quantizzati Q4/Q5:

| Classe | Peso modello pianificato | Uso |
|---|---:|---|
| ~1.7B | ~1–1.5 GB | default Lite |
| ~3B | ~1.8–2.5 GB | Quality |
| ~3.8B | ~2.3–3.2 GB | Quality+ |

Queste NON sono specifiche definitive.

La dimensione reale dipende da:

- architettura;
- quantizzazione;
- tokenizer;
- metadata GGUF;
- eventuali shard;
- runtime.

---

# 16. RAM — planning conservativo

Per evitare promesse irrealistiche, trattare questi valori solo come budget iniziale.

## Desktop Lite

Target da validare:

```text
8 GB RAM → minimo possibile
16 GB RAM → target consigliato
```

## VPS 12 GB

Primo candidato:

```text
1.5B–2B Q4/Q5
```

Un modello 3B può essere testato, ma non deve essere assunto come sicuro in produzione insieme a:

- PostgreSQL;
- API;
- asset service;
- OpenClaw;
- OS;
- cache;
- utenti concorrenti.

---

# 17. La VPS da 6 CPU / 12 GB / 200 GB

## È sufficiente per:

- frontend;
- backend;
- PostgreSQL;
- Game Core;
- event engine;
- asset storage;
- alpha privata;
- OpenClaw privato;
- un piccolo AI runtime sperimentale.

## Non è ancora dimostrato che sia sufficiente per:

- molti giocatori contemporanei che richiedono generazione AI;
- modello più grande;
- context window molto alta;
- OpenClaw intensivo + LLM + molti utenti nello stesso momento.

Questa parte deve essere benchmarkata.

---

# 18. Strategia AI server per la VPS

Per la prima alpha:

```text
AI requests
   ↓
QUEUE
   ↓
1 inference worker
   ↓
small model
```

Non tentare subito elevata concorrenza.

Se arrivano 5 richieste insieme:

- il gioco continua;
- la narrazione può arrivare dopo;
- le richieste AI vengono messe in coda;
- il Simulation Core non aspetta l'AI.

---

# 19. Regola fondamentale: AI asincrona

Flusso:

```text
PLAYER CHOICE
   ↓
GAME CORE RISOLVE
   ↓
STATE COMMIT
   ↓
UI MOSTRA RISULTATO
   ↓
AI GENERA NARRAZIONE
```

Mai:

```text
PLAYER CHOICE
   ↓
aspetta AI
   ↓
AI decide game state
```

---

# 20. AI locale non deve avere tutto il mondo nel prompt

Per rendere valido un modello piccolo:

```text
Current Situation
+
Relevant Characters
+
5–12 Relevant Memories
+
Recent Delta
+
Applicable Rules
+
Output Schema
```

Non inviare:

- intera cronologia;
- intero database;
- tutta la lore;
- centinaia di personaggi non coinvolti.

---

# 21. Output del piccolo modello

Preferire richieste limitate e strutturate.

Esempio:

```json
{
  "narration": "...",
  "dialogue": [],
  "tone_tags": [],
  "event_proposals": [],
  "memory_suggestions": []
}
```

Il modello non deve calcolare:

- danni;
- monete;
- probabilità;
- morte;
- economia;
- territorio.

---

# 22. Fallback obbligatorio

Tre provider logici:

```text
LocalModelProvider
CloudModelProvider
ProceduralFallbackProvider
```

Se il modello locale fallisce:

```text
local
  ↓ fail
cloud (se autorizzato)
  ↓ fail/offline
procedural fallback
```

La partita non si interrompe.

---

# 23. PostgreSQL vs SQLite

## Web

**PostgreSQL**

Memorizza:

- utenti;
- campagne;
- personaggi;
- world state;
- event log;
- asset;
- AI usage.

## Windows offline

**SQLite**

Memorizza localmente:

- campagne;
- personaggi;
- world state;
- event log;
- configurazione;
- asset references.

Il Game Core usa lo stesso contratto:

```ts
interface PersistenceAdapter {
  loadCampaign(...)
  saveDelta(...)
  appendEvent(...)
  loadMemories(...)
}
```

---

# 24. Salvataggi portabili

Obiettivo futuro:

```text
Desktop save
   ↓ export
portable campaign package
   ↓
Web import
```

e viceversa, quando le versioni del ruleset sono compatibili.

Non implementare nella prima vertical slice, ma progettare:

- schema version;
- campaign version;
- migration.

---

# 25. Lovable — ruolo definitivo

Lovable è:

- acceleratore frontend;
- prototipatore;
- UI builder;
- strumento di iterazione visuale.

Non è:

- source of truth;
- Simulation Core;
- runtime obbligatorio;
- infrastruttura obbligatoria.

Workflow:

```text
Knowledge
   ↓
Lovable task
   ↓
Git sync
   ↓
review
```

Il progetto deve restare self-hostable.

---

# 26. GitHub — source of truth

Tutto deve convergere qui.

```text
ChatGPT → specifiche
Lovable → UI code
OpenClaw → engineering / ops
Developer → code
        ↓
      GITHUB
        ↓
   build / deploy
```

Nessun tool esterno è proprietario della versione definitiva del progetto.

---

# 27. OpenClaw — ruolo definitivo

OpenClaw vive sulla VPS come strumento privato di:

- sviluppo;
- manutenzione;
- test;
- deploy;
- log inspection;
- automazione.

Non è:

- AI-DM dei giocatori;
- servizio pubblico;
- endpoint accessibile dagli utenti.

Deve essere:

- bind loopback;
- raggiungibile via SSH/Tailscale;
- eseguito con utente dedicato;
- separato dai secrets che non gli servono.

---

# 28. Modalità operative VPS

## DEV MODE

```text
Game stack
+ DB
+ OpenClaw
+ AI benchmark
```

## PUBLIC ALPHA MODE

Preferire:

```text
Game stack
+ DB
+ AI runtime
+ OpenClaw idle / limitato / eventualmente fermato
```

Se la RAM diventa critica, OpenClaw non deve competere con il runtime di gioco.

---

# 29. RPG Maker MV — valutazione

## Tecnicamente possibile

RPG Maker MV può produrre output web e Windows.

## Decisione

**NON usarlo come motore principale.**

Motivo:

il progetto richiede soprattutto:

- data UI;
- world simulation;
- database;
- AI runtime;
- micro→macro management;
- high-density mission UI;
- adapter multipiattaforma.

RPG Maker introdurrebbe un'ulteriore architettura orientata a un tipo di RPG che non coincide con il nostro core.

Rischio:

```text
RPG Maker
+ plugin
+ custom JS
+ backend
+ database
+ AI
+ external UI
```

= complessità maggiore senza beneficio sufficiente.

---

# 30. GameMaker — valutazione

## Tecnicamente possibile

GameMaker supporta build Windows e HTML5.

## Decisione

**NON usarlo come core nella fase attuale.**

Può essere rivalutato soltanto se in futuro emerge una forte necessità di gameplay 2D realtime che giustifichi un engine dedicato.

Problema attuale:

- GML + TypeScript;
- due toolchain;
- integrazione AI/database aggiuntiva;
- Lovable meno utile;
- rischio di duplicare UI e sistemi.

---

# 31. Motore grafico 2D senza GameMaker

La stack web può comunque avere gameplay visivo.

Utilizzare progressivamente:

```text
React
→ UI gestionale

Canvas 2D / WebGL
→ mappa
→ sprite
→ combattimento
→ animazioni
→ particelle
```

Se necessario, in futuro aggiungere una libreria 2D specializzata mantenendo il Game Core invariato.

---

# 32. HTML singolo — decisione

Un singolo `game.html` resta utile per:

- vertical slice;
- mock;
- demo;
- benchmark di UI;
- game systems semplici.

Non è il formato principale dell'edizione completa.

Motivo:

il prodotto finale necessita di:

- database;
- asset multipli;
- modello GGUF;
- runtime nativo;
- aggiornamenti;
- save management.

---

# 33. Installer Windows — struttura di release

Release desiderata:

```text
ParametricAdventure_Setup_x64.exe
```

Installa:

```text
App/
├── game executable
├── web assets
├── llama-server
├── model
├── licences
└── runtime resources
```

I salvataggi devono stare nella cartella dati utente, non nella directory di installazione.

---

# 34. Code signing

Prima della distribuzione pubblica Windows:

- predisporre firma del codice;
- firmare installer/app;
- stabilire un processo di release riproducibile.

Non è necessario per la prima demo privata, ma deve essere considerato prima di una release pubblica professionale.

---

# 35. Update system

Futuro:

```text
app update
≠
model update
```

Separare versioni:

```text
GAME_VERSION
MODEL_PACK_VERSION
RULESET_VERSION
SAVE_SCHEMA_VERSION
```

Il modello può essere aggiornato senza invalidare il Simulation Core.

---

# 36. Model Pack incluso e pack alternativi

Default:

```text
Model Pack Lite
→ incluso nel Full Offline Installer
```

Futuro:

```text
Model Pack Quality
Model Pack Experimental
```

Ma il gioco deve sempre essere testato con il Lite incluso.

Non rendere il Quality Pack necessario.

---

# 37. Requisito anti-AI-slop applicato al modello piccolo

Un modello piccolo non deve essere costretto a inventare tutto.

Il sistema deve fornire:

- nomi;
- world facts;
- personaggi;
- tono;
- conseguenze;
- vincoli;
- output schema.

L'AI deve principalmente:

```text
INTERPRETARE
VARIARE
DIALOGARE
DESCRIVERE
COLLEGARE
```

Non costruire da zero la logica.

Questo aumenta la qualità e riduce il rischio di AI slop.

---

# 38. Feasibility Matrix

| Componente | Stato | Nota |
|---|---|---|
| Singola codebase Web + Windows | VERDE | architettura ad adapter |
| Web su VPS | VERDE | standard web stack |
| Windows installer | VERDE | Tauri |
| SQLite desktop | VERDE | supportato |
| PostgreSQL server | VERDE | stack approvato |
| llama.cpp incluso | VERDE | sidecar + resource |
| GGUF incluso installer | VERDE | dimensione alta ma fattibile |
| 1.7B locale desktop | VERDE/GIALLO | benchmark hardware |
| piccolo modello su VPS 12 GB | GIALLO | fattibile da testare, throughput incerto |
| 3B+ su VPS con più utenti | GIALLO/ROSSO | non assumere |
| AI server multiutente | GIALLO | queue necessaria |
| HTML demo | VERDE | senza LLM desktop bundled |
| HTML full offline con modello nativo | ROSSO per v1 | non consigliato |
| Lovable frontend | VERDE | Git sync/self-host |
| OpenClaw privato VPS | VERDE | isolamento obbligatorio |
| RPG Maker core | NO | non necessario |
| GameMaker core | NO per v1 | rivalutabile |

---

# 39. Feasibility Gate P0 — obbligatorio

Prima di sviluppare molti contenuti, eseguire un prototipo tecnico.

## P0.1 Windows package test

Costruire:

```text
Tauri
+ React
+ SQLite
+ llama-server sidecar
+ 1 modello candidato
```

Verificare:

- installazione;
- cold start;
- avvio modello;
- generazione;
- chiusura pulita;
- salvataggio;
- disinstallazione.

---

## P0.2 VPS benchmark

Testare almeno:

```text
1.7B Q4/Q5
3B Q4/Q5 se possibile
```

Misurare:

- RAM idle;
- RAM modello;
- startup;
- tokens/sec;
- CPU;
- latency;
- context 2k/4k/8k;
- 1 richiesta;
- 2 richieste;
- 5 richieste in queue.

---

## P0.3 AI quality benchmark

Creare 50 casi realistici:

- dialogo;
- evento;
- descrizione;
- memoria;
- conseguenza;
- JSON output.

Valutare:

- coerenza;
- italiano;
- rispetto schema;
- ripetizione;
- cliché;
- contraddizioni;
- velocità.

---

## P0.4 Simulation Core benchmark

Simulare:

```text
10.000 world ticks
1.000 personaggi sintetici
100 fazioni/event streams di test
```

Non perché la v1 richieda questi numeri, ma per identificare loop inefficienti.

---

# 40. Target P0 provvisorio

Il progetto passa il gate se:

### Desktop

- installer funziona senza dipendenze manuali;
- modello parte automaticamente;
- AI produce output entro un tempo accettabile;
- RAM non rende inutilizzabile il PC;
- gameplay non si blocca durante inferenza.

### VPS

- stack game + DB stabile;
- modello piccolo non causa OOM;
- una richiesta AI non blocca il Simulation Core;
- queue gestisce richieste simultanee;
- OpenClaw resta isolato.

---

# 41. Piani di fallback se la VPS è troppo lenta

Se il piccolo modello server non è abbastanza veloce:

## Piano A
AI locale solo per Windows; Web usa API economica.

## Piano B
VPS gioco resta invariata; AI spostata su seconda VPS più adatta.

## Piano C
Server usa modello ancora più piccolo.

## Piano D
Narrativa procedurale per utenti web free; AI premium/opzionale.

Il progetto NON fallisce se il modello non gira bene sulla VPS attuale.

---

# 42. Piani di fallback se il modello incluso è troppo debole

Non aumentare subito a un modello enorme.

Prima:

1. ridurre il compito;
2. migliorare retrieval;
3. migliorare output schema;
4. aggiungere template;
5. aggiungere style rules;
6. generare solo il delta narrativo;
7. usare due-pass soltanto negli eventi importanti.

Solo dopo considerare un modello più grande.

---

# 43. Repository aggiornato

```text
parametric-ai-adventure/
│
├── apps/
│   ├── web/
│   ├── server/
│   └── desktop/
│
├── packages/
│   ├── game-core/
│   ├── game-data/
│   ├── game-types/
│   ├── ui-system/
│   ├── ai-contracts/
│   ├── persistence-contracts/
│   └── procedural-narrator/
│
├── platform/
│   ├── web/
│   └── desktop/
│
├── models/
│   ├── manifest.json
│   └── README.md
│
├── infra/
├── docs/
├── assets/
└── tests/
```

Il vero GGUF non deve necessariamente vivere nel normale Git repository.

Per release/build usare artifact storage, Git LFS o pipeline dedicata secondo necessità.

---

# 44. Manifest del modello

Esempio:

```json
{
  "id": "dm-lite",
  "version": "1.0",
  "family": "TBD",
  "file": "dungeon-master-default.gguf",
  "sha256": "...",
  "quantization": "TBD",
  "license": "TBD",
  "context_target": 4096,
  "min_ram_mb": null,
  "recommended_ram_mb": null
}
```

I valori RAM restano `null` finché non benchmarkati.

---

# 45. Flusso completo del progetto

```text
TU
│
├── idee / feedback
│
▼
CHATGPT
│
├── Product Vision
├── Game Systems
├── Technical Specs
└── task
│
▼
GITHUB
│
├───────────────┐
▼               ▼
LOVABLE       OPENCLAW
UI/UX         engineering / ops
│               │
└───────┬───────┘
        ▼
      GITHUB
        │
        ├─────────────┐
        ▼             ▼
     WEB BUILD     WINDOWS BUILD
        │             │
        ▼             ▼
       VPS         Tauri installer
        │             │
 PostgreSQL+AI     SQLite+local AI
```

---

# 46. Sequenza di sviluppo raccomandata

## FASE 1
HTML/React vertical slice.

## FASE 2
Game Core reale.

## FASE 3
PostgreSQL + server Web.

## FASE 4
Deploy VPS.

## FASE 5
Tauri shell.

## FASE 6
SQLite adapter.

## FASE 7
llama.cpp sidecar + modello Lite.

## FASE 8
Benchmark P0.

## FASE 9
Solo dopo: espansione profonda dei sistemi.

---

# 47. Decisioni bloccate

Sono ora considerate bloccate salvo revisione esplicita:

- Web + Windows dallo stesso progetto;
- React/TypeScript come base UI;
- Tauri per Windows;
- Game Core multipiattaforma;
- PostgreSQL Web;
- SQLite desktop;
- llama.cpp come primo runtime da benchmarkare;
- modello locale incluso nella Full Offline Edition;
- model selection post-benchmark;
- AI-DM separato dal Simulation Core;
- HTML come demo, non come main full offline;
- niente RPG Maker MV come core;
- niente GameMaker come core nella v1;
- GitHub source of truth;
- Lovable frontend accelerator;
- OpenClaw privato sulla VPS;
- fallback procedurale sempre disponibile.

---

# 48. Decisioni NON ancora bloccate

- modello esatto;
- quantizzazione;
- context window;
- tokens/sec minimi;
- requisiti minimi Windows;
- dimensione installer;
- modello Web vs desktop uguale o diverso;
- eventuale API cloud;
- firma commerciale Windows;
- store di distribuzione;
- eventuale Steam;
- updater;
- asset image generation provider.

Queste decisioni dipendono dai benchmark o da scelte commerciali future.

---

# 49. Base di verifica tecnica consultata

Questa specifica è stata verificata, alla data del documento, contro documentazione primaria/ufficiale relativa a:

- Tauri 2: Windows installer, sidecar binaries, bundled resources, SQL/SQLite;
- llama.cpp: runtime locale, Windows `llama-server.exe`, HTTP server e GGUF;
- Lovable: Git sync e self-hosting/deployment esterno;
- OpenClaw: esecuzione su Linux VPS e modello di sicurezza;
- RPG Maker MV: deployment Web;
- GameMaker: target HTML5;
- model card ufficiali Qwen, Hugging Face SmolLM e Microsoft Phi per parametri/licenze dei candidati menzionati.

Le capacità dei tool sono tecnicamente documentate; le prestazioni reali del modello sulla VPS restano da misurare.

---

# 50. Principio finale di fattibilità

Il progetto non deve dipendere dal fatto che “un piccolo LLM sia abbastanza intelligente da creare il gioco”.

Il progetto è fattibile perché:

```text
SIMULATION CORE
fa il lavoro difficile di coerenza

DATABASE
fa il lavoro di memoria

EVENT ENGINE
fa il lavoro di causalità

RETRIEVAL
seleziona il contesto

SMALL LLM
trasforma il risultato in linguaggio vivo
```

Questa separazione è ciò che rende realistico distribuire un piccolo modello insieme al gioco.
