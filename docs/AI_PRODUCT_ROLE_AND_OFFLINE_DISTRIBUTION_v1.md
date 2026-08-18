# AI PRODUCT ROLE & OFFLINE DISTRIBUTION v1
## Chronosaga: The Game

**Versione:** 1.0  
**Data:** 2026-08-18  
**Stato:** LOCKED product/architecture decision  
**Scope:** ruolo dell'AI nel prodotto, modalità normali di gioco, fallback, distribuzione Windows Full Offline, rapporto tra Simulation Core e modelli locali.

---

# 0. Scopo e precedenza

Questo documento formalizza una decisione di prodotto emersa durante la review architetturale del 18 agosto 2026.

Raffina e rende più specifiche le formulazioni presenti in:

- `PRODUCT_VISION_LOCKED_v1.md` §§11–13;
- `LOCAL_AI_MODEL_PROFILES_v0.1.md`;
- `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`;
- `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`.

In caso di conflitto sul **ruolo dell'AI nell'esperienza**, sulla distinzione fra profili normali e fallback, o sull'inclusione dei modelli nella distribuzione Windows Full Offline, prevale questo documento perché più specifico e più recente.

Non sostituisce invece:

- i benchmark P0;
- la selezione dell'esatto GGUF;
- quantizzazione, hash e licenze;
- i requisiti hardware finali;
- le formule del Simulation Core;
- il protocollo AI-DM futuro.

---

# 1. Decisione centrale

## LOCKED

> **Chronosaga è un simulatore sistemico con AI locale centrale nell'esperienza, ma non autorevole sullo stato del gioco.**

Il Simulation Core determina:

- fatti;
- regole;
- risultati;
- numeri;
- risorse;
- combattimenti;
- relazioni strutturate;
- stato di fazioni e insediamenti;
- StateDelta;
- conseguenze immediate e ritardate;
- validità del save.

L'AI interpreta e rende vivo quello stato attraverso output contestuali vincolati.

Formula:

```text
SIMULATION CORE PRODUCE LA REALTÀ
                ↓
          CONTEXT BUILDER
                ↓
        LOCAL AI LITE/STANDARD
                ↓
DIALOGHI / REAZIONI / NARRATIVA / SINTESI
                ↓
             VALIDATOR
                ↓
                UI
```

L'AI non sostituisce il Simulation Core e il Simulation Core non deve dipendere dalla disponibilità dell'AI per mantenere integrità, determinismo e salvataggio.

---

# 2. L'AI è parte essenziale dell'esperienza prevista

## LOCKED

Il fatto che il gioco mantenga integrità senza AI **non significa** che l'esperienza senza AI sia equivalente.

La formulazione corretta è:

> **Chronosaga deve mantenere continuità funzionale e integrità dello stato se l'AI locale fallisce, ma l'esperienza di prodotto prevista richiede normalmente un modello AI locale funzionante.**

L'AI è centrale per:

- dialoghi degli NPC;
- reazioni coerenti con personalità, memoria e relazioni;
- descrizione contestuale degli eventi;
- scene sociali;
- interpretazione narrativa delle conseguenze;
- report politici, economici e militari;
- cronache;
- variazione linguistica;
- sintesi e presentazione della memoria;
- contenuti contestuali emergenti;
- proposte di eventi entro contratti ammessi;
- trasformazione di dati simulati in un mondo percepito come vivo.

Il valore dell'AI deve essere percepito nell'esperienza, non necessariamente esposto come gimmick o pannello tecnico.

---

# 3. AI vincolata: principio di fattibilità

## LOCKED

I modelli locali non ricevono l'intero mondo senza struttura e non sono liberi di riscrivere lo stato.

Ricevono un contesto compatto e grounded, ad esempio:

```text
situation
+ involved characters
+ relevant memories
+ recent StateDelta
+ world/style constraints
+ allowed narrative actions
+ output schema
```

L'output AI deve attraversare validazione prima dell'uso.

Schema concettuale:

```json
{
  "narration": "",
  "dialogue": [],
  "tone_tags": [],
  "event_proposals": [],
  "memory_suggestions": []
}
```

Campi autorevoli non possono essere modificati dall'AI.

Questa limitazione non rende l'AI marginale: è il meccanismo che permette a modelli locali relativamente piccoli di essere utili e coerenti dentro un sistema complesso.

---

# 4. Profili normali di gioco

## LOCKED

La UI principale dei profili AI deve presentare:

```text
AUTO
LITE
STANDARD
```

### AUTO

Seleziona il profilo locale più adatto in base a hardware, benchmark e disponibilità.

### LITE

Profilo locale più leggero. È una modalità normale di gioco, non un fallback puramente tecnico.

### STANDARD

Profilo locale di qualità superiore previsto come esperienza consigliata quando l'hardware lo consente.

Entrambi devono usare lo stesso `AIAdapter` e gli stessi contratti di stato/output.

Cambiare Lite ↔ Standard non deve modificare:

- regole di gioco;
- save schema;
- Simulation Core;
- risultati autorevoli;
- compatibilità della campagna.

---

# 5. Procedural / Safe Mode

## LOCKED

`PROCEDURAL` non deve essere trattato nel prodotto come quarto profilo equivalente a Lite e Standard.

È una **modalità degradata di continuità e recupero**.

Naming UX consigliato:

```text
SAFE MODE — NO LOCAL AI
Reduced narrative mode
```

Può essere disponibile nelle opzioni avanzate o attivarsi automaticamente quando i modelli locali non sono utilizzabili.

Scopo:

- non bloccare il turno;
- non perdere una decisione già risolta;
- non corrompere il save;
- mantenere leggibile il risultato autorevole;
- permettere recovery/restart del runtime.

Può usare:

- template;
- frasi deterministiche;
- procedural narrator;
- descrizioni minime;
- messaggi di stato.

Non è richiesto che offra la stessa profondità narrativa di Lite/Standard.

## Fallback chain

```text
STANDARD failure
        ↓
       LITE
        ↓
SAFE / PROCEDURAL FALLBACK
```

```text
LITE failure
        ↓
SAFE / PROCEDURAL FALLBACK
```

Safe Mode deve essere l'ultima difesa tecnica, non la modalità di riferimento dell'esperienza.

---

# 6. Windows Full Offline — entrambi i modelli inclusi

## LOCKED PRODUCT REQUIREMENT

> **La distribuzione Windows Full Offline deve includere sia il profilo Lite sia il profilo Standard.**

L'utente non deve avere bisogno di Internet dopo l'installazione per passare da Lite a Standard o viceversa.

Il prodotto deve poter offrire:

```text
WINDOWS FULL OFFLINE
├── Chronosaga application
├── Simulation Core
├── SQLite
├── llama.cpp runtime
├── Lite GGUF
├── Standard GGUF
├── assets
└── save system
```

L'aumento di spazio occupato è accettato come trade-off per:

- autonomia completa;
- possibilità di scelta;
- fallback Standard → Lite senza download;
- prevedibilità della distribuzione;
- nessuna dipendenza cloud obbligatoria.

---

# 7. Un solo modello residente alla volta

## LOCKED

Lite e Standard sono entrambi installati, ma normalmente **un solo modello deve essere residente in RAM alla volta**.

Sequenza di cambio profilo:

```text
STOP current runtime/model
        ↓
select target GGUF
        ↓
START llama-server with target model
        ↓
health / inference readiness
        ↓
continue campaign
```

Non introdurre due modelli contemporaneamente in memoria salvo benchmark futuri che dimostrino un vantaggio concreto e giustifichino la complessità.

---

# 8. Runtime mode iniziale

## APPROVED DIRECTION

Per la prima implementazione con GGUF preferire una topologia semplice single-model:

```text
llama-server
--model <selected.gguf>
--host 127.0.0.1
--port <locked port>
```

Il router mode resta utile per test lifecycle e future estensioni, ma non è necessario per il primo profilo Lite/Standard.

La selezione del modello può avvenire attraverso stop/restart del sidecar.

---

# 9. Nessuna API cloud obbligatoria

## LOCKED

Windows Full Offline non deve richiedere:

- OpenAI API;
- Anthropic API;
- Perplexity API;
- altri provider cloud;
- chiavi API;
- connessione Internet per l'inferenza normale.

L'interfaccia HTTP di `llama-server` su `127.0.0.1` è un protocollo locale interno al prodotto, non un servizio cloud.

Cloud/server AI può esistere in target Web o modalità future, ma non è requisito della normale esperienza Windows Full Offline.

---

# 10. Packaging fisico dei modelli

## PRODUCT REQUIREMENT LOCKED

Entrambi i modelli devono essere forniti all'utente nella distribuzione Full Offline.

## IMPLEMENTATION PROVISIONAL

Non è ancora bloccato che debbano stare dentro un singolo `Setup.exe`.

Sono accettabili, se necessari per limiti tecnici dell'installer:

- un singolo installer capace di gestire il payload;
- installer + payload locale nello stesso pacchetto distribuito;
- archive Full Offline contenente setup e model payload;
- altro layout che richieda un solo download iniziale e nessun download successivo per usare Lite/Standard.

Il requisito di prodotto è **offline completeness**, non il formato fisico del contenitore.

La strategia definitiva viene scelta dopo aver misurato:

- dimensione reale dei GGUF;
- compressione;
- limiti NSIS/Tauri;
- affidabilità installazione/aggiornamento;
- esperienza utente.

---

# 11. Stato autorevole e commit

## LOCKED

Una scelta del giocatore deve essere risolta e resa persistente indipendentemente dalla generazione narrativa.

Sequenza preferita:

```text
PLAYER CHOICE
      ↓
CORE RESOLVE
      ↓
STATE DELTA
      ↓
STATE COMMIT / SAVE-SAFE POINT
      ↓
AI NARRATION / DIALOGUE
      ↓
VALIDATE
      ↓
UI RESULT
```

Un errore AI non può annullare o corrompere un risultato già determinato dal Simulation Core.

---

# 12. Implicazioni per P0

P0 deve dimostrare almeno:

1. Lite reale avviabile localmente;
2. Standard reale avviabile localmente;
3. stesso contratto AI per entrambi;
4. one-model-at-a-time;
5. switching Lite ↔ Standard senza cambiare save/state;
6. Standard failure → Lite;
7. Lite failure → Safe/Procedural;
8. AI failure non corrompe il gioco;
9. qualità italiana sufficiente;
10. grounded structured output;
11. benchmark di RAM, latenza e throughput;
12. entrambi i payload distribuibili nel Full Offline.

La modalità Safe/Procedural non deve essere usata per mascherare un fallimento sistematico di Lite o Standard durante il gate P0.

---

# 13. Implicazioni UX

La normale UI utente dovrebbe comunicare:

```text
LOCAL AI PROFILE

● AUTO — Recommended
○ LITE — Faster / lower requirements
○ STANDARD — Higher quality

Advanced / Recovery:
SAFE MODE — No local AI, reduced narrative experience
```

Mostrare per Lite/Standard:

- modello installato;
- storage;
- RAM target;
- accelerazione disponibile;
- qualità/velocità;
- profilo raccomandato;
- stato runtime/inference.

Safe Mode deve dichiarare chiaramente che l'esperienza narrativa è ridotta.

---

# 14. Principio finale

> **La simulazione produce la realtà; l'AI le dà voce.**

Chronosaga non è una chat che delega il gioco a un LLM e non è neppure un gestionale che usa l'AI come decorazione occasionale.

Il prodotto nasce dall'interazione fra:

```text
SIMULATION
+
PERSISTENCE
+
MEMORY
+
CONSEQUENCES
+
LOCAL AI INTERPRETATION
```

La fattibilità dipende dal mantenere forti i confini fra queste responsabilità, non dal ridurre il ruolo dell'AI nell'esperienza.
