# P0 WINDOWS + LOCAL AI BENCHMARK PLAN v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Stato:** execution gate / valori hardware PROVISIONAL fino ai test reali  
**Priorità:** Windows-first · Web-compatible · VPS deferred

---

# 0. Scopo

Questo documento definisce il primo gate tecnico obbligatorio di Chronosaga.

L'obiettivo non è costruire il gioco completo, ma dimostrare che la sua base distintiva può funzionare come normale applicazione Windows installabile e completamente offline:

```text
WINDOWS PC
   │
   └── Chronosaga
        ├── Tauri / React
        ├── shared Game Core
        ├── SQLite
        ├── AI Profile Manager
        ├── llama.cpp / llama-server
        ├── Lite ~1.7B
        └── Standard ~3B
```

Il P0 deve rispondere con misure reali a cinque domande:

1. l'app Windows si installa e parte senza dipendenze manuali?
2. Lite ~1.7B gira in modo accettabile su hardware modesto?
3. Standard ~3B offre un miglioramento qualitativo sufficiente a giustificarne il peso/requisiti?
4. entrambi rispettano gli stessi contratti AI senza influenzare lo stato autorevole del gioco?
5. il gioco continua a funzionare se l'AI fallisce?

---

# 1. Strategia di delivery bloccata

## LOCKED

Chronosaga viene sviluppato con questa priorità:

```text
WINDOWS FIRST
     │
     ├── prove runtime locale
     ├── persistence locale
     ├── AI locale
     ├── vertical slice giocabile
     │
     ▼
WEB COMPATIBILITY MAINTAINED
     │
     ▼
VPS / HOSTED ALPHA LATER
```

Questo NON significa creare due giochi.

Durante tutta la fase Windows:

- `packages/game-core` resta platform-independent;
- Game Data e Game Types restano condivisi;
- React UI resta condivisibile;
- contratti `PersistenceAdapter`, `AIAdapter` e `AssetAdapter` restano platform-neutral;
- la build Web deve continuare a compilare in CI;
- non si investe ancora in autenticazione, multiutenza o AI server production-ready.

---

# 2. Cosa NON appartiene al P0

Sono esplicitamente fuori scope:

- deployment pubblico della VPS;
- autenticazione utenti;
- scaling multiutente;
- WebGPU local AI production-ready;
- PostgreSQL production adapter completo;
- Warfare completo;
- Management completo;
- Tactical completo;
- polishing visuale definitivo;
- content volume;
- image generation;
- cloud AI come requisito.

Lovable può essere usato dopo il gate P0 per accelerare la UI, ma non deve anticipare o mascherare fallimenti del runtime Windows.

---

# 3. Profili AI sotto test

## Lite

```text
Class: ~1.7B
Candidate family: Qwen3-1.7B class
Quantization target: Q4/Q5 benchmark variants
Role: compatibility / speed / low-memory
```

## Standard

```text
Class: ~3B
Candidate family: SmolLM3-3B class
Quantization target: Q4/Q5 benchmark variants
Role: recommended narrative quality
```

I nomi sono candidati, non modelli di release bloccati.

Prima della distribuzione reale devono essere registrati:

- exact model name/version;
- exact GGUF artifact;
- quantization;
- SHA-256;
- license;
- attribution requirements.

---

# 4. P0-A — Windows application feasibility

Costruire una mini-app reale che usi la stessa topologia prevista per il prodotto.

## Deve contenere

```text
Tauri app
React screen
shared TypeScript package
SQLite database
save/load smoke test
AI Profile Manager
llama-server sidecar
model manifest
procedural fallback
```

## Sequenza obbligatoria

```text
INSTALL
  ↓
FIRST LAUNCH
  ↓
hardware probe
  ↓
select AUTO / LITE / STANDARD / PROCEDURAL
  ↓
start selected local runtime
  ↓
health check
  ↓
run structured generation
  ↓
save state
  ↓
close app
  ↓
sidecar terminates
  ↓
restart
  ↓
load same state
```

## Pass criteria

- nessun Node/Python/Ollama/PostgreSQL installato manualmente dall'utente;
- runtime AI avviato dal gioco;
- bind solo loopback;
- shutdown pulito del sidecar;
- save/load non dipende dal modello selezionato;
- cambio Lite ↔ Standard non cambia il save schema;
- Procedural funziona anche con entrambi i modelli assenti/non avviabili.

---

# 5. P0-B — Hardware matrix desktop

Questa matrice è minima. Dove non è disponibile hardware fisico identico, usare limiti di RAM/CPU controllati e documentare la differenza.

| Classe test | RAM | GPU | Lite | Standard |
|---|---:|---|---|---|
| Low target | 8 GB | CPU-only / iGPU | obbligatorio | exploratory only |
| Baseline | 16 GB | CPU-only | obbligatorio | obbligatorio |
| Recommended | 16 GB | consumer GPU | obbligatorio | obbligatorio |
| Comfortable | 32 GB | consumer GPU | sanity | obbligatorio |

## Registrare

- CPU model / cores / threads;
- RAM totale e peak process RAM;
- GPU / VRAM / backend usato;
- modello e quantizzazione;
- context size;
- cold-start time;
- warm-start time;
- time to first token;
- tokens/sec;
- generation duration;
- peak memory;
- CPU utilization;
- failure/OOM;
- output validity.

---

# 6. P0-C — Context matrix

Per entrambi i profili testare almeno:

```text
2k context
4k context
8k context
```

8k può risultare non consigliabile per Lite o per hardware minimo. Il benchmark deve misurarlo, non assumerlo.

## Tipi di input

1. single NPC dialogue;
2. two-character conflict;
3. event narration after StateDelta;
4. memory-grounded reaction;
5. faction/political consequence summary;
6. warfare report;
7. location description grounded in structured state;
8. structured event proposal;
9. memory suggestion;
10. constrained JSON-only repair case.

---

# 7. P0-D — AI quality suite (minimo 50 casi)

Preparare almeno 50 scenari rappresentativi, versionati nel repository.

**50 è un minimo di gate, non una dimensione fissa della suite.** La suite
versionata può contenerne di più, e oggi ne contiene di più.

La comparazione ufficiale non seleziona un sottoinsieme: esegue **l'intera
suite lockata** nella versione usata dalla run. Un confronto su un campione
scelto a posteriori non è la stessa misura.

Stato corrente:

```text
minimo normativo P0            50 casi
suite versionata corrente      65 casi
popolazione run ufficiale      65 Lite + 65 Standard
                               piu' i soli retry legittimi (uno per rifiuto)
```

65 è la popolazione *corrente*, non un limite architetturale permanente. Una
versione futura della suite può contenerne di più; **non può scendere sotto il
minimo normativo di 50** senza una nuova decisione di prodotto esplicita.

Ogni scenario deve contenere:

```json
{
  "id": "ai_case_001",
  "task": "dialogue",
  "worldStateSlice": {},
  "characters": [],
  "relevantMemories": [],
  "recentDelta": {},
  "constraints": {},
  "expectedFacts": [],
  "forbiddenClaims": []
}
```

## Valutare 0–5

- Italian fluency;
- grounding;
- character consistency;
- memory use;
- instruction adherence;
- JSON/schema compliance;
- non-contradiction;
- narrative usefulness;
- repetition/cliché resistance;
- latency acceptability.

## Hard failures

Un output è hard-fail se:

- inventa un risultato autorevole contrario allo StateDelta;
- cambia numeri del Game Core;
- attribuisce al personaggio una memoria incompatibile con i dati forniti;
- produce JSON non recuperabile quando il task richiede schema stretto;
- genera testo inutilizzabile/ripetitivo in modo sistematico.

---

# 8. P0-E — AI contract and validator

Entrambi i modelli devono attraversare lo stesso contratto:

```text
Context Builder
     ↓
AIAdapter
     ↓
selected model
     ↓
structured output
     ↓
validator
     ↓
accepted / retry / fallback
```

Schema concettuale minimo:

```json
{
  "narration": "",
  "dialogue": [],
  "tone_tags": [],
  "event_proposals": [],
  "memory_suggestions": []
}
```

Il P0 deve dimostrare almeno:

- schema validation;
- one-shot retry con istruzione ridotta;
- invalid-field stripping quando sicuro;
- Procedural fallback;
- logging diagnostico senza bloccare il Game Core.

---

# 9. P0-F — Model profile UX

Implementare un selettore funzionale, non solo mock visuale.

```text
LOCAL AI PROFILE

AUTO
LITE ~1.7B
STANDARD ~3B
PROCEDURAL
```

Per ogni profilo mostrare:

- storage stimato/reale;
- RAM minima attualmente configurata;
- RAM consigliata;
- GPU obbligatoria: no / eventuale accelerazione;
- qualità vs velocità;
- hardware rilevato;
- raccomandazione AUTO;
- stato installato/non installato;
- risultato dell'ultimo benchmark locale quando disponibile.

## Override

L'utente può forzare Standard su hardware sotto la soglia, ricevendo warning.

Fallback runtime:

```text
STANDARD failure
      ↓
LITE
      ↓
PROCEDURAL
```

Il fallback non deve modificare il WorldState.

---

# 10. P0-G — Packaging experiments

Testare due strategie senza bloccare ancora la release finale.

## Full Offline

```text
Game + Lite + Standard
```

Vantaggio: zero download successivo.

## Compact-capable architecture

```text
Game + Lite
Standard = optional model pack
```

Vantaggio: installer base più piccolo.

Il codice deve supportare entrambe le strategie tramite manifest, senza hardcode del path di un singolo modello.

---

# 11. P0-H — Performance targets

Non fissare soglie commerciali definitive prima dei risultati.

Per il gate tecnico usare queste categorie:

## PASS

- output strutturato affidabile;
- latenza compatibile con gameplay asincrono;
- nessun crash/OOM sul target dichiarato;
- startup ragionevole;
- fallback funzionante.

## CONDITIONAL PASS

- modello utile ma richiede riduzione context/output;
- Standard richiede hardware superiore al target preliminare;
- GPU acceleration necessaria per esperienza consigliata ma CPU-only resta funzionale.

## FAIL

- frequenti crash/OOM;
- qualità italiana insufficiente;
- schema compliance non recuperabile;
- latenza tale da rendere inutilizzabile anche il flusso asincrono;
- modello altera sistematicamente i fatti forniti.

---

# 12. P0-I — Vertical narrative smoke scenario

Creare una scena minima con:

```text
5 characters
1 settlement
2 factions
1 resource shortage
1 recent betrayal
1 incoming threat
1 delayed consequence
```

Il Game Core produce lo stato e una scelta.

La scelta deve generare:

```text
StateDelta
  ↓
Persistence
  ↓
AI context
  ↓
Lite or Standard narration
  ↓
validated dialogue/event proposal
```

Ripetere lo stesso scenario con Lite e Standard per confronto diretto.

---

# 13. Web compatibility during Windows-first development

La versione Web non viene abbandonata.

CI deve continuare a verificare almeno:

```text
shared typecheck
shared tests
web build
server build
```

Non sono richiesti nel P0:

- hosted production deployment;
- server AI concurrency;
- browser-local WebGPU.

Le API/adapter devono però restare progettati in modo che tali target possano essere aggiunti senza fork del Game Core.

---

# 14. VPS — deferred gate

La VPS 6 CPU / 12 GB / 200 GB resta un target previsto, ma viene testata **dopo** aver validato il prodotto locale Windows.

Il successivo gate VPS misurerà:

- Lite CPU-only;
- Standard CPU-only se ragionevole;
- API + PostgreSQL + Game Core concorrenti;
- queue latency;
- 1 / 2 / 5 richieste;
- memory pressure;
- hosted-save path;
- sicurezza/deployment.

Non investire in scaling VPS prima che la vertical slice Windows sia utile e giocabile.

---

# 15. Lovable gate

Lovable resta previsto per l'Operations Vertical Slice e il visual system.

Ordine:

```text
P0 WINDOWS RUNTIME
      ↓
P0 LOCAL AI
      ↓
PASS / CONDITIONAL PASS
      ↓
LOVABLE UI IMPLEMENTATION
      ↓
REAL CORE INTEGRATION
```

È ammesso preparare UI mock/brief prima del P0, ma la produzione visuale avanzata non deve diventare la priorità finché runtime e AI locale non sono dimostrati.

---

# 16. Deliverable del P0

Il gate produce:

1. mini build Windows installabile;
2. SQLite save/load test;
3. working llama.cpp sidecar lifecycle;
4. Lite benchmark report;
5. Standard benchmark report;
6. risultati di qualità sull'intera suite versionata (minimo P0: 50 casi; suite corrente: 65);
7. selected quantization recommendations;
8. measured hardware recommendation table;
9. model profile selector;
10. documented failures/workarounds;
11. decisione `GO / GO WITH LIMITS / NO-GO`.

---

# 17. Exit criteria

Il progetto può passare dal P0 alla vertical slice di produzione quando:

- [ ] installer Windows avviabile senza dipendenze manuali;
- [ ] SQLite save/load stabile;
- [ ] Lite parte e genera output valido sul target minimo accettato;
- [ ] Standard parte sul target raccomandato;
- [ ] almeno un profilo raggiunge qualità narrativa sufficiente in italiano;
- [ ] stesso AIAdapter per Lite/Standard;
- [ ] un solo modello residente alla volta;
- [ ] fallback Standard → Lite → Procedural verificato;
- [ ] AI failure non blocca il gameplay;
- [ ] hardware requirements sostituiti con misure reali;
- [ ] Web build ancora verde;
- [ ] nessun fork del Game Core fra Windows e Web.

---

# 18. Decisione dopo P0

Possibili risultati:

```text
A — STANDARD wins
3B consigliato / Lite compatibility

B — LITE is enough
1.7B default / 3B optional quality pack

C — dual profile confirmed
AUTO chooses by hardware

D — local models insufficient
procedural/local fallback + architecture preserved
```

Il P0 non deve confermare una convinzione già presa. Deve permettere di cambiare il packaging o il profilo consigliato sulla base dei dati.