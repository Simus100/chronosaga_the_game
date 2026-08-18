# ARCHITECTURE STATE REVIEW — 2026-08-18
## Chronosaga: The Game

**Data review:** 2026-08-18  
**Stato:** INFORMATIONAL TECHNICAL REVIEW  
**Authority:** questo documento NON modifica autonomamente Product Vision, Knowledge o Roadmap. Registra lo stato osservato, i rischi e le raccomandazioni. Le decisioni normative emerse dalla review sono formalizzate separatamente in `AI_PRODUCT_ROLE_AND_OFFLINE_DISTRIBUTION_v1.md`.

---

# 1. Executive summary

## Verdetto

**Chronosaga è tecnicamente fattibile e l'architettura attuale è valida.**

Non emerge alcuna scelta fondamentale che richieda un cambio di stack o una riscrittura generale.

La direzione attuale è coerente con gli obiettivi:

```text
React + TypeScript shared project
        ↓
platform-independent Simulation Core
        ↓
platform adapters
   ┌─────────────┐
Windows         Web
Tauri           Browser/API later
SQLite          PostgreSQL later
llama.cpp       server AI later
```

Il rischio tecnico del runtime AI Windows è diminuito sensibilmente grazie ai test reali, alla state machine, alla process ownership e alla provenance verification.

Il rischio principale si sposta progressivamente da:

> “Possiamo far funzionare tecnicamente l'AI locale?”

verso:

> “La combinazione Simulation Core + piccoli LLM locali produce un gioco interessante e coerente?”

---

# 2. Stato osservato del repository

Al momento della review il branch:

```text
feature/p0-local-ai-runtime-v0.1
```

risulta avanti rispetto a `develop` e contiene la maggior parte del lavoro P0.3 non ancora consolidato nel ramo di integrazione.

Sono presenti e osservabili:

- lockfile pnpm;
- Cargo.lock desktop;
- test/build riproducibili;
- Local AI Runtime Manager Rust;
- real SystemProcessBackend;
- loopback health probe;
- background runtime watcher;
- real-runtime E2E opt-in;
- provenance lock llama.cpp;
- verifier SHA-256;
- staging runtime per packaging;
- configurazione Tauri AI resources separata;
- UI diagnostica runtime;
- CI Windows source/installer senza AI;
- definizione separata del futuro AI packaged installer;
- dual-model profile contracts;
- SQLite smoke persistence già validata nella fase precedente.

La base `game-core` esiste ma è ancora volutamente piccola rispetto alla visione completa: eventi, deterministic RNG e campaign creation sono fondazioni, non ancora la simulazione finale.

---

# 3. Valutazione architetturale

| Area | Valutazione | Giudizio |
|---|---:|---|
| Architettura generale | 9/10 | Molto buona |
| Windows-first strategy | 9.5/10 | Pragmatica e riduce il rischio |
| Tauri / React / TypeScript | 9/10 | Appropriata al tipo di prodotto |
| SQLite local persistence | 8.5/10 | Base valida; schema completo futuro |
| llama.cpp lifecycle | 9/10 | Solido per la fase corrente |
| Runtime provenance / integrity | 9/10 | Rigoroso e riproducibile |
| Packaging runtime | 8.5/10 | Buona struttura; acceptance finale ancora da chiudere |
| Dual-model architecture | 9/10 | Semplice, sostituibile, one-at-a-time |
| CI / reproducibility | 8.5/10 | Buona base; test Rust CI da rafforzare |
| AI quality feasibility | non ancora dimostrata | Dipende dai benchmark reali |
| Game Core | precoce | Fondazioni soltanto |
| Micro vertical slice feasibility | 8/10 | Alta se lo scope resta controllato |
| Visione completa | 6.5–7/10 | Fattibile ma molto ambiziosa |

I numeri sono valutazioni tecniche qualitative della review, non KPI di prodotto.

---

# 4. Scelte considerate corrette

## 4.1 Simulation Core autorevole

La scelta più importante del progetto è mantenere il Simulation Core indipendente dall'AI.

L'AI non deve decidere arbitrariamente:

- risultati di combattimento;
- risorse;
- stato delle fazioni;
- numeri;
- salvataggi;
- causalità autorevole.

Questo permette:

- determinismo;
- save affidabili;
- fallback;
- sostituzione del modello;
- test automatici;
- portabilità Web/Windows.

La review conferma questa decisione.

## 4.2 AI centrale ma vincolata

La review chiarisce però che “Core autorevole” non significa “AI marginale”.

La Product Direction corretta è formalizzata in `AI_PRODUCT_ROLE_AND_OFFLINE_DISTRIBUTION_v1.md`:

```text
Simulation Core determina cosa succede
AI locale determina come viene interpretato/presentato entro vincoli
```

Questa separazione è particolarmente adatta a piccoli modelli locali.

## 4.3 Windows-first / Web-compatible

La priorità Windows prima di VPS, autenticazione, multiutenza e WebGPU è considerata valida.

Permette di verificare prima:

- installer;
- persistence;
- local runtime;
- local inference;
- save safety;
- performance.

Il Web resta compatibile attraverso shared packages e build CI senza forzare infrastruttura prematura.

## 4.4 Shared monorepo + adapters

È corretta la scelta di non creare due giochi distinti.

`game-core`, game data, contracts e UI condivisa devono restare comuni; SQLite/Tauri/llama.cpp e PostgreSQL/API sono adapter di piattaforma.

## 4.5 Tauri + React

Per un gioco fortemente basato su:

- pannelli;
- mappe;
- dati;
- simulazione;
- Tactical/Warfare/Management UI;
- narrativa;

React/TypeScript è una scelta adeguata.

Rust rimane confinato alle responsabilità native dove porta valore: process lifecycle, filesystem, SQLite/native bridge e packaging.

Non emerge necessità di migrare a Unity/Godot per la visione corrente.

## 4.6 Runtime come processo posseduto

La scelta di possedere direttamente `std::process::Child` è considerata valida.

Vantaggi:

- PID reale;
- duplicate-start protection;
- kill/reap;
- nessun processo intermedio shell;
- working directory controllata;
- gestione chiara di shutdown e crash.

## 4.7 Watcher separato dalla UI

Il pattern osservato è corretto:

```text
UI       → snapshot read-only
Watcher  → poll lifecycle
Manager  → state machine
Backend  → process I/O
Probe    → health I/O
```

La UI non deve guidare lo stato del runtime.

## 4.8 Loopback-only

`127.0.0.1` deve restare un invariant strutturale.

Il runtime locale non deve esporre endpoint sulla LAN e non deve introdurre cloud API obbligatorie.

## 4.9 Runtime payload fuori dal Git

È corretta la separazione:

```text
Git repository
→ source / manifests / hashes / licenses metadata

External workspace
→ executable / DLL / GGUF / heavy assets
```

Il verifier e lo staging rappresentano un buon compromesso tra riproducibilità e dimensione del repository.

## 4.10 Tauri resources per llama.cpp runtime

Per il runtime corrente composto da executable + molte DLL co-locate, il packaging come resource directory è considerato semplice e ragionevole.

Non è necessario introdurre `externalBin` soltanto per conformarsi a un pattern generico se il backend Rust possiede già correttamente il processo.

---

# 5. Dual local AI — valutazione

La strategia:

```text
AUTO
LITE
STANDARD
```

con un solo modello residente alla volta è considerata valida.

Il requisito di prodotto aggiornato è:

- Lite e Standard entrambi presenti nella distribuzione Windows Full Offline;
- nessun download necessario dopo installazione per cambiare profilo;
- AUTO sceglie il profilo;
- override manuale consentito;
- switching tramite stop/start del modello;
- stesso save e stesso Simulation Core;
- fallback Standard → Lite → Safe/Procedural.

La scelta aumenta lo storage ma non aumenta significativamente la complessità architetturale.

La forma fisica del pacchetto resta invece PROVISIONAL: non è richiesto che tutti i GB siano necessariamente compressi dentro un singolo `Setup.exe`.

---

# 6. Procedural fallback — correzione di product positioning

La review considera fuorviante trattare `PROCEDURAL` come esperienza equivalente a Lite e Standard.

Direzione approvata:

```text
NORMAL EXPERIENCE
AUTO / LITE / STANDARD

RECOVERY EXPERIENCE
SAFE MODE / PROCEDURAL
```

Safe/Procedural esiste per:

- continuità;
- recovery;
- save safety;
- degradazione controllata.

Non deve essere usato per giustificare una qualità insufficiente dei modelli durante P0.

---

# 7. Rischi ancora aperti

## 7.1 Qualità reale dei piccoli modelli

È il rischio AI principale.

Non è ancora dimostrato che la classe Lite ~1.7B e Standard ~3B raggiungano qualità sufficiente per:

- italiano;
- dialogo;
- grounding;
- memoria;
- consistency;
- JSON/schema compliance;
- anti-repetition;
- narrativa utile.

Questo rischio deve essere risolto con benchmark, non con ulteriore architettura preventiva.

## 7.2 Scala della visione gameplay

La visione completa include Tactical, Warfare e Management, oltre a economia, fazioni, personaggi, memoria, politica, logistica e mondo autonomo.

Il rischio principale è feature sprawl.

La review conferma la roadmap M2 piccola:

```text
5 characters
1 settlement
2 factions
1 local economy
1 conflict
20–30 events
1 tactical encounter class
```

Prima di espandere il gioco occorre dimostrare una catena interessante:

```text
PLAYER CHOICE
→ STATE DELTA
→ RELATION / ECONOMY / FACTION EFFECT
→ MEMORY
→ DELAYED CONSEQUENCE
→ NEW EVENT
```

## 7.3 Packaging multi-GB

Con Lite + Standard la distribuzione futura sarà di diversi GB.

Il requisito Full Offline è fattibile, ma il formato del contenitore deve essere scelto dopo i benchmark reali dei modelli e i test dell'installer.

Non vincolare la Product Vision a un singolo executable installer.

## 7.4 Hardware requirements

Tutte le soglie RAM/VRAM/CPU restano provisional finché P0 non produce dati reali.

---

# 8. Debiti tecnici piccoli rilevati

Questi punti non richiedono redesign.

## 8.1 `Child::try_wait()` error semantics

Nel backend reale, un errore di `try_wait()` non dovrebbe essere trattato semanticamente come prova certa che il processo sia morto.

Raccomandazione:

- usare `Result<bool, String>` o stato equivalente `Running / Exited / Unknown`;
- liberare il PID solo su exit confermata;
- conservare ownership su errore di osservazione.

Priorità: prima della chiusura definitiva di P0.3.

## 8.2 Watcher spawn failure

`RuntimeWatcher::spawn()` non dovrebbe poter abbattere l'app per failure del thread.

Raccomandazione:

```text
watcher creation failure
→ local AI unavailable / degraded
→ gameplay remains alive
```

Restituire `Result` è preferibile a un panic.

## 8.3 Rust tests in CI

Il job Windows dovrebbe eseguire anche:

```text
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

oltre a `cargo check`.

I test E2E con payload reale possono restare opt-in e fuori dalla normale CI hosted.

---

# 9. P0.3 packaging — stato della review

Il branch contiene già una struttura coerente per:

```text
verify locked runtime
        ↓
stage exact required files
        ↓
Tauri AI resource config
        ↓
Windows installer AI path
```

La risoluzione runtime è progettata per preferire:

```text
PACKAGED RESOURCE
        ↓ fallback development only
CHRONOSAGA_WORKSPACE_ROOT
        ↓
UNAVAILABLE
```

Questa è la direzione corretta.

La chiusura definitiva richiede acceptance reale dell'installer AI con workspace environment assente e verifica di:

- runtime packaged trovato;
- start/ready;
- stop;
- restart;
- shutdown;
- zero processi orfani.

---

# 10. Sequenza raccomandata

La review raccomanda di non aprire nuovi fronti infrastrutturali.

```text
1. chiudere P0.3 packaging + piccoli hardening
2. integrare/merge del branch dopo CI/review
3. P0.3-C primo GGUF Lite reale
4. prima inferenza locale strutturata
5. Standard + switching/fallback
6. benchmark P0 completo
7. fermare infrastruttura
8. M1/M2 playable micro vertical slice
```

Per il primo GGUF è preferibile mantenere semplice il runtime:

```text
llama-server --model selected.gguf
```

con stop/restart al cambio profilo, invece di introdurre subito dinamiche router multi-model non necessarie.

---

# 11. Cose da NON fare ora

- non cambiare stack;
- non migrare engine;
- non costruire VPS production;
- non introdurre autenticazione;
- non implementare WebGPU;
- non caricare due LLM contemporaneamente;
- non costruire Tactical + Warfare + Management completi insieme;
- non trasformare l'AI nel motore autorevole;
- non ridurre l'AI a decorazione per rendere più facile il progetto;
- non considerare Safe/Procedural equivalente all'esperienza AI.

---

# 12. Conclusione

La review non identifica un problema architetturale fondamentale.

La base è considerata **più solida della media per una pre-alpha di questa natura**, soprattutto per:

- separazione Core/AI;
- Windows-first;
- adapter architecture;
- process ownership;
- loopback isolation;
- provenance lock;
- verifier/staging;
- dual-model abstraction;
- save independence dall'AI.

La fattibilità complessiva viene stimata qualitativamente come **alta, circa 8/10**, purché lo sviluppo continui a usare vertical slice piccoli e benchmark reali come gate.

La prossima prova determinante non è aggiungere altra infrastruttura: è verificare che **un piccolo LLM locale grounded su uno stato simulato produca un'esperienza sufficientemente viva, coerente e utile**, e subito dopo dimostrare che il piccolo mondo M2 è divertente da giocare.

Principio sintetico della review:

> **La simulazione produce la realtà; l'AI le dà voce; il vertical slice deve dimostrare che questa combinazione è divertente.**
