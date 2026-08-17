# LOCAL AI MODEL PROFILES v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Stato:** Product-aligned architecture / hardware values PROVISIONAL until P0 benchmark  
**Scope:** profili AI locali selezionabili, packaging Windows, browser-local AI, requisiti hardware, fallback e UI di selezione.

---

# 0. Decisione di prodotto

Chronosaga deve supportare **due classi di modello locale**, entrambe compatibili con lo stesso `AIAdapter` e con gli stessi contratti JSON.

```text
LOCAL AI
   │
   ├── LITE
   │    ~1.7B parameters
   │    lower RAM / faster CPU inference
   │
   └── STANDARD
        ~3B parameters
        better narrative quality / higher requirements
```

L'utente può scegliere il profilo in base al proprio PC. È inoltre previsto `AUTO`, che propone il profilo più adatto dopo un hardware probe e, quando utile, un breve benchmark locale.

**LOCKED:** la scelta del profilo non modifica le regole di gioco.  
**LOCKED:** il Simulation Core rimane autorevole.  
**LOCKED:** Lite e Standard devono essere intercambiabili tramite provider/adapter.  
**PROVISIONAL:** famiglie modello esatte, quantizzazione e soglie hardware finali.  
**OPEN:** eventuale terzo Quality profile futuro.

---

# 1. Perché due modelli non sono un problema architetturale

Il gioco non dipende direttamente dal nome del modello. Dipende da un contratto stabile:

```text
SIMULATION CORE
      │
      ├── WorldState
      ├── StateDelta
      ├── relevant memories
      └── allowed narrative actions
             │
             ▼
       CONTEXT BUILDER
             │
             ▼
          AIAdapter
             │
       ┌─────┴─────┐
       │           │
   LITE 1.7B   STANDARD 3B
       │           │
       └─────┬─────┘
             ▼
      structured JSON
             │
             ▼
         VALIDATOR
             │
             ▼
       player-facing text
```

Cambiare modello non deve cambiare:

- save format;
- Simulation Core;
- combat resolution;
- economy;
- world tick;
- memory schema;
- event schema;
- UI contracts.

Può cambiare invece:

- velocità di generazione;
- qualità stilistica;
- lunghezza consigliata dell'output;
- capacità di gestire dialoghi complessi;
- dimensione del contesto usato dal Context Builder.

---

# 2. Profili previsti

## 2.1 LITE — ~1.7B

**Obiettivo:** massima compatibilità hardware e latenza contenuta.

Candidato iniziale da benchmarkare:

```text
Qwen3-1.7B class
```

Motivi di interesse:

- classe 1.7B;
- forte supporto multilingue;
- capacità di instruction following, dialogue, role-play e creative writing;
- dimensione compatibile con un GGUF Q4/Q5 leggero.

Uso preferenziale:

- NPC secondari;
- dialoghi brevi;
- descrizioni;
- variazioni narrative;
- eventi semplici;
- sistemi con output JSON strettamente vincolato;
- PC con risorse limitate;
- browser WebGPU quando supportato.

## 2.2 STANDARD — ~3B

**Obiettivo:** profilo consigliato per l'esperienza completa offline.

Candidato iniziale da benchmarkare:

```text
SmolLM3-3B class
```

Motivi di interesse:

- classe 3B;
- supporto multilingue con italiano incluso;
- migliore margine per dialoghi, continuità stilistica e scene più articolate;
- dimensione ancora compatibile con distribuzione consumer in Q4/Q5.

Uso preferenziale:

- dialoghi importanti;
- personaggi principali;
- eventi multi-attore;
- conseguenze politiche/sociali;
- scene emotive;
- narrativa di guerra;
- memoria sintetizzata;
- output strutturato più articolato.

**Nota:** i nomi sopra sono candidati di benchmark, non ancora modelli di release bloccati. La quantizzazione esatta e la licenza della build distribuita devono essere validate prima della release.

---

# 3. Peso su disco — planning

Stime iniziali per GGUF quantizzati Q4/Q5:

| Profilo | Classe | Peso modello pianificato |
|---|---:|---:|
| Lite | ~1.7B | ~1.0–1.5 GB |
| Standard | ~3B | ~1.8–2.5 GB |

Se **entrambi** vengono inclusi nel pacchetto Windows Full Offline, il solo payload dei modelli può quindi essere circa:

```text
~2.8–4.0 GB
```

prima di runtime, gioco, asset e overhead dell'installer.

Di conseguenza, un installer con entrambi i modelli **non deve essere pubblicizzato come pacchetto da ~2 GB**.

Strategia prevista:

```text
WINDOWS FULL OFFLINE
├── Lite model      included
├── Standard model  included
└── Custom install  può in futuro permettere di omettere un profilo
```

È possibile aggiungere in seguito una distribuzione `Compact` con solo Lite senza cambiare l'architettura.

---

# 4. Requisiti hardware — valori PROVISIONAL

Queste soglie sono **planning values**, non requisiti finali. Verranno sostituite dai risultati del P0 benchmark.

| Voce | Lite ~1.7B | Standard ~3B |
|---|---|---|
| RAM minima da validare | 8 GB | 16 GB |
| RAM consigliata | 16 GB | 16–32 GB |
| CPU | moderna x64, 4+ core target | moderna x64, 6+ core consigliati |
| GPU | non obbligatoria | non obbligatoria |
| VRAM utile | 4 GB opzionali | 6 GB+ consigliati se si usa accelerazione GPU |
| Contesto iniziale target | 4k | 4k–8k |
| Storage modello | ~1.0–1.5 GB | ~1.8–2.5 GB |

Il gioco deve poter funzionare CPU-only tramite llama.cpp.

La GPU è un acceleratore, non un requisito di prodotto obbligatorio per la modalità offline base.

---

# 5. Hardware probe e selezione AUTO

Al primo avvio la UI può leggere:

- RAM totale disponibile;
- CPU/logical cores;
- eventuale GPU compatibile;
- VRAM quando rilevabile;
- spazio libero;
- risultato di un micro-benchmark opzionale.

Il selettore propone:

```text
AUTO (recommended)
LITE — ~1.7B
STANDARD — ~3B
PROCEDURAL — no generative model
```

Esempio di UI:

```text
LOCAL AI PROFILE

[ AUTO — RECOMMENDED ]
System recommendation: STANDARD
Estimated RAM requirement: 16 GB
Detected RAM: 32 GB
GPU acceleration: available

○ LITE       ~1.7B   Faster / 8 GB minimum target
● STANDARD   ~3B     Better dialogue / 16 GB minimum target
○ PROCEDURAL         No local LLM / fastest / reduced generative variety
```

Requisito UX:

> L'utente deve vedere **prima di selezionare** il modello: peso su disco, RAM minima, RAM consigliata, presenza/assenza di GPU obbligatoria e una descrizione sintetica del trade-off qualità/velocità.

---

# 6. Safety dell'override utente

L'utente può forzare un profilo diverso da quello consigliato.

Se il sistema rileva rischio concreto:

```text
STANDARD selected
Detected RAM: 8 GB
        ↓
WARNING
        ↓
Use Lite instead? [Recommended]
```

Non bloccare automaticamente l'utente salvo impossibilità tecnica nota.

In caso di OOM/startup failure:

```text
STANDARD
   ↓ failure
LITE
   ↓ failure
PROCEDURAL FALLBACK
```

Il save non deve corrompersi e il gameplay non deve dipendere dal successo dell'inferenza.

---

# 7. Windows Full Offline

Topologia:

```text
Chronosaga.exe
     │
     ├── Tauri / React
     ├── Simulation Core
     ├── SQLite
     ├── AI Profile Manager
     │      │
     │      ├── Lite GGUF
     │      └── Standard GGUF
     │
     └── llama-server.exe
             │
             └── 127.0.0.1 only
```

Sequenza:

```text
APP START
   ↓
read selected profile
   ↓
hardware sanity check
   ↓
launch llama-server with selected GGUF
   ↓
health check
   ↓
AI READY
```

Cambio profilo:

```text
stop runtime
   ↓
unload model
   ↓
start selected model
   ↓
health check
```

Non devono esistere due modelli residenti contemporaneamente in RAM salvo benchmark che dimostrino un vantaggio reale.

---

# 8. Browser / Web

Il browser non deve scaricare obbligatoriamente 3–4 GB all'apertura del sito.

Modalità previste:

```text
WEB AI MODE
   │
   ├── SERVER AI
   │      VPS queue / model server
   │
   ├── LOCAL WEBGPU
   │      model downloaded on demand
   │      cached by browser
   │
   └── PROCEDURAL
          no LLM
```

Per `LOCAL WEBGPU`:

- Lite è il primo target;
- Standard può essere esposto solo su hardware/browser compatibili;
- il modello viene scaricato on demand;
- il gioco deve mostrare dimensione download prima di procedere;
- il modello può essere memorizzato nella cache browser quando la piattaforma lo consente;
- se WebGPU non è disponibile, offrire Server AI o Procedural.

Il modello **non viene incorporato dentro un singolo HTML**.

---

# 9. VPS 6 CPU / 12 GB RAM

Strategia di benchmark:

```text
VPS
├── Linux
├── API / Fastify
├── PostgreSQL
├── Simulation Core
└── AI worker
      ├── test Lite 1.7B
      └── test Standard 3B
```

Priorità:

1. benchmark Lite come baseline stabile;
2. benchmark Standard con stesso workload;
3. misurare RAM reale, startup, tok/s, latency e queue time;
4. testare 1 richiesta, 2 simultanee e 5 in coda;
5. verificare assenza di OOM insieme a database/API;
6. evitare OpenClaw intensivo durante il benchmark di produzione.

Il fatto che un 3B entri in RAM non equivale automaticamente a capacità multiutente adeguata: CPU e queue latency sono gate separati.

---

# 10. Il piccolo modello non simula il mondo

Regola centrale:

```text
GAME STATE
   ↓
CONTEXT RETRIEVAL
   ↓
2–8k relevant tokens
   ↓
SMALL LLM
   ↓
NARRATION / DIALOGUE / PROPOSALS
   ↓
SCHEMA VALIDATION
   ↓
GAME
```

Il modello non calcola:

- danni;
- economia;
- probabilità;
- supply;
- morale autorevole;
- territorio;
- mortalità;
- world tick;
- relazioni numeriche.

Questi dati vengono forniti dal Simulation Core.

Questo design aumenta molto la probabilità che modelli da 1.7B–3B siano sufficienti per il ruolo assegnato.

---

# 11. Routing intelligente futuro

L'architettura permette, senza renderlo requisito v0.1, di usare profili diversi per task diversi:

```text
minor NPC / short description
          ↓
        LITE

important dialogue / complex event
          ↓
      STANDARD
```

Nella prima versione, tuttavia, è preferibile tenere **un solo modello residente alla volta** e rispettare la scelta dell'utente.

Il routing per-task potrà essere attivato solo se non introduce continui swap di modello e latenza eccessiva.

---

# 12. Contratto AI invariato

Entrambi i profili devono restituire lo stesso schema concettuale:

```json
{
  "narration": "...",
  "dialogue": [],
  "tone_tags": [],
  "event_proposals": [],
  "memory_suggestions": []
}
```

Il validator può:

- rifiutare output non valido;
- richiedere una rigenerazione breve;
- ridurre il task;
- usare template/procedural fallback.

---

# 13. P0 benchmark obbligatorio

Prima di bloccare i requisiti hardware finali:

## Desktop

Testare almeno:

- 8 GB RAM / CPU-only per Lite;
- 16 GB RAM / CPU-only per Lite e Standard;
- 16 GB RAM + GPU consumer;
- startup cold/warm;
- 2k / 4k / 8k context;
- 50 casi narrativi rappresentativi;
- JSON schema compliance;
- italiano;
- ripetizione;
- contraddizioni;
- memoria rilevante;
- shutdown/restart e model switching.

## VPS

Testare:

- Lite e Standard;
- RAM idle/peak;
- token throughput;
- TTFT;
- 1 request;
- 2 requests;
- 5 queued;
- Game Core/API/PostgreSQL contemporanei.

## Browser

Testare:

- supporto WebGPU;
- download/caching;
- RAM/VRAM;
- startup;
- Lite;
- Standard solo su hardware compatibile;
- fallback a Server/Procedural.

---

# 14. Acceptance criteria

La strategia dual-model è accettata quando:

- [ ] Lite e Standard usano lo stesso AIAdapter;
- [ ] il cambio modello non cambia il save;
- [ ] un solo modello viene caricato in RAM alla volta;
- [ ] il menu mostra chiaramente requisiti e dimensione;
- [ ] AUTO produce una raccomandazione hardware ragionevole;
- [ ] failure Standard → Lite non blocca la partita;
- [ ] failure Lite → Procedural non blocca la partita;
- [ ] Windows non richiede installazioni manuali di runtime AI;
- [ ] browser non scarica modelli senza consenso esplicito;
- [ ] la VPS usa queue e gameplay asincrono;
- [ ] i modelli superano il benchmark qualitativo in italiano;
- [ ] licenza e hash della quantizzazione finale vengono registrati.

---

# 15. Decisione corrente

```text
WINDOWS FULL OFFLINE
  Lite ~1.7B      INCLUDED / SELECTABLE
  Standard ~3B    INCLUDED / SELECTABLE
  Auto            DEFAULT SELECTION MODE

WEB
  Server AI       SUPPORTED TARGET
  Local WebGPU    OPTIONAL / ON-DEMAND
  Procedural      ALWAYS AVAILABLE

MODEL NAMES
  Qwen3-1.7B      BENCHMARK CANDIDATE
  SmolLM3-3B      BENCHMARK CANDIDATE

FINAL MODEL / QUANTIZATION / HARDWARE REQUIREMENTS
  NOT LOCKED UNTIL P0
```
