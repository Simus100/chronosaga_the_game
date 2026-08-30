# TECHNICAL ROADMAP v0.3
## Chronosaga: The Game

**Versione:** 0.3  
**Data:** 2026-08-30  
**Stato:** sequencing/priorities update after M1 + GQP-0  
**Strategia:** Windows-first · Web-compatible · VPS later

## Relazione con v0.2

`TECHNICAL_ROADMAP_v0.3.md` supersede `TECHNICAL_ROADMAP_v0.2.md` **per priorità, sequencing e stato di esecuzione corrente**.

`TECHNICAL_ROADMAP_v0.2.md` resta un riferimento utile per il dettaglio storico dei milestone e delle architetture non ridefinite qui. In caso di conflitto sul *cosa fare prima*, prevale v0.3.

La Product Vision, il Game Systems Schema, l'AI Product Role e il Gameplay Quality Proof restano fonti più specifiche nei rispettivi domini.

---

# 0. Current authority

Stato osservato dopo PR #33:

```text
develop  aaa8266b4f613f4f4e06148ab961f706a7eb50d0
main     27571a85100a11875cad7d72431a48586573a976
```

`main` e `develop` sono divergenti. La promozione a `main` è un'operazione deliberata separata, non un sync automatico.

Per la fotografia operativa completa usare `REPOSITORY_BOOTSTRAP_STATUS.md`.

---

# 1. Stato reale al 2026-08-30

## Completato

```text
P0.1  Windows desktop runtime
P0.2  SQLite persistence baseline
P0.3  owned llama.cpp + first real Lite inference
P0.4  Standard + AUTO + Safe fallback + model resolution
P0.5-A benchmark harness
P0.5-B1 official execution lane

M1-A  systemic world foundation
M1-B  first useful World Tick
M1-C  real installed Windows playable systemic loop

GQP specification
GQP-0 structural hygiene
```

M1 è **completo** nel senso definito dal primo playable systemic proof: scelta autoritativa, StateDelta, World Tick, reazione sistemica, save, full close/reopen, load identico e continuazione del gioco nella vera app Windows.

GQP-0 è **completo** e ha preparato il Core per il proof senza aggiungere gameplay.

## Aperto

```text
#17  P0.5 quality/performance/release decision
#30  Gameplay Quality Proof
#34  World Tick finite-result hygiene follow-up
```

Il workspace locale contiene ormai benchmark evidence P0.5, ma il repository non registra ancora un verdict finale di qualità/performance/hardware o un model release lock. Quindi P0.5 resta aperto.

---

# 2. La nuova regola: due gate ortogonali

La vecchia roadmap trattava P0.5 come il principale gate sequenziale prima di un M2 più ampio. Dopo M1-C è emerso un secondo rischio indipendente: **il gioco può funzionare tecnicamente senza essere ancora abbastanza interessante**.

Da ora Chronosaga gestisce due gate separati.

## Gate A — Technical Release / P0.5

Risponde a:

> Con quali modelli, impostazioni e requisiti hardware Chronosaga può essere distribuito Windows Full Offline con qualità accettabile?

Copre:

- Lite/Standard quality evidence;
- contract/fact preservation;
- performance/context matrix;
- hardware evidence;
- AUTO recommendations;
- candidate KEEP/REPLACE decision;
- release metadata/lock;
- successiva Full Offline clean-install proof.

Tracking: **#17**.

## Gate B — Gameplay Quality Proof

Risponde a:

> Il piccolo sistema interconnesso produce decisioni difficili, conseguenze leggibili, attachment ai personaggi, sorpresa coerente e desiderio di continuare?

Copre:

- meaningful choice;
- multi-layer consequence;
- memory/relationship/faction causality;
- pressure and recovery;
- deterministic directed pacing;
- installed Windows playtest;
- founder fun pass;
- independent small-sample pass.

Tracking: **#30**.  
Spec: `GAMEPLAY_QUALITY_PROOF_v0.1.md`.

## Regola di interazione

I due gate sono **ortogonali**, non una singola catena artificiale.

- Il lavoro GQP può proseguire mentre P0.5 è aperto se non altera benchmark contracts, runtime/model evidence o release assumptions.
- P0.5 può proseguire mentre il GQP è aperto senza imporre feature gameplay.
- **M2 expansion non può iniziare prima del PASS GQP.**
- **Model/release approval non può avvenire prima della chiusura P0.5.**
- Una futura alpha/release Windows credibile richiederà entrambi: gioco valido + runtime/model distribution valida.

---

# 3. Gameplay lane — sequenza autoritativa

La sequenza del `GAMEPLAY_QUALITY_PROOF_v0.1.md` è ora il percorso vincolante prima dell'espansione M2:

```text
GQP-0 structural hygiene                    DONE
        ↓
GQP-A contracts / proof scenario
        ↓
GQP-B meaningful-choice network
        ↓
GQP-C directed pacing
        ↓
GQP-D real installed Windows playtest
        ↓
founder fun PASS
        ↓
independent small-sample PASS
        ↓
M2 expansion
```

GQP-0 non è un principio gameplay; è la slice di hygiene che precede GQP-A.

## GQP-0 — done

Authority dopo merge PR #33:

`develop@aaa8266b4f613f4f4e06148ab961f706a7eb50d0`

Garantisce:

- shared authoritative EventEffect application;
- fail-closed validator/applicator semantics;
- atomic resource delta overflow refusal;
- explicit `GameplayFocus = EVENT | QUIET`;
- replay-safe GQP selection;
- replay-safe delayed consequence ordering;
- lifecycle guard against immediate re-selection after QUIET;
- no schema change / no new gameplay.

## #34 — narrow Core hygiene before proof expansion

`run-world-tick.ts` ha un writer numerico separato dal percorso EventEffect. Il follow-up #34 deve chiudere il possibile overflow non-finite con la stessa proprietà:

```text
calculate -> validate finite -> mutate -> append StateChange
```

È un fix tecnico piccolo e non riapre GQP-0. Chiuderlo **prima di introdurre nuova semantica sistemica significativa in GQP-A/B** riduce il rischio di costruire il proof sopra un writer che può produrre uno stato non salvabile.

## GQP-A — next gameplay slice

GQP-A introduce i contratti e lo scenario proof necessari alla rete di scelte successiva, inclusi i nuovi dati autoritativi previsti dalla spec. Non deve anticipare GQP-B/C contenuto o pacing.

In particolare la slice deve mantenere:

- schema-version handling esplicito;
- legacy M1 save v1 loadability;
- nessuna migrazione automatica v1 -> proof v2 salvo decisione esplicita;
- vecchio codice fail-closed su stato nuovo che non comprende;
- enum/id semantici invece di branching su prosa;
- Simulation Core come unica authority.

## GQP-B — choice network

Solo dopo i contratti di GQP-A:

- five proof event families;
- real trade-offs;
- multi-layer consequences;
- character/faction callbacks;
- recovery decisions;
- pattern-driven eligibility;
- no content-volume response a un proof debole.

## GQP-C — directed pacing

Solo quando esiste una rete di scelte realmente causale:

- urgency + causal relevance - repetition;
- `EVENT | QUIET` policy;
- bounded quiet/liveness;
- no hidden mutable scheduler state;
- no LLM authority;
- replayable deterministic selection.

## GQP-D — installed Windows playtest

Il proof finale deve essere eseguito nella vera app Windows, non soltanto in test/browser harness.

Il gate non passa con una demo tecnica: deve produrre evidence di traiettorie divergenti, causal recognition, character memory behavior, faction behavior non ridotto a reputation scalar e recovery dopo almeno un setback.

---

# 4. M2 — deferred expansion, not cancelled

La Product Vision e `GAME_SYSTEMS_SCHEMA_v0.1.md` restano il target finale. Tactical, Warfare, Management e micro -> macro non sono stati rimossi.

Sono **deferiti** finché il GQP non dimostra che il core decisionale merita espansione.

La vecchia idea M2 di 20–30 eventi + tactical encounter + economia più ampia non è il prossimo task immediato.

Regola:

> **Depth before breadth. Se il proof non è interessante, aumentare il numero di sistemi/eventi è una risposta vietata.**

Dopo il PASS GQP, M2 può riassorbire le parti utili della vecchia roadmap:

- broader content;
- Tactical first slice;
- Warfare bridge;
- wider Management;
- richer AI narration grounded in authoritative state;
- deeper UI/Analysis Mode.

---

# 5. P0.5 lane — parallel release evidence

Tracking: #17.

Lo stato non è più semplicemente “benchmark non eseguito”. L'inventario locale del 2026-08-29 ha riportato benchmark evidence e una run valida `official_1787510438` fuori da Git.

La roadmap però distingue **evidence** da **decisione**.

Prima di dichiarare P0.5 chiuso servono ancora, nel repository/review history:

1. riconciliazione dell'evidenza ufficiale;
2. quality/contract result esplicito Lite vs Standard;
3. human-review rubric outcome dove richiesto;
4. performance/context evidence sufficiente;
5. hardware/AUTO recommendations con distinzione measured vs inferred;
6. candidate outcome per profilo: KEEP / KEEP WITH CHANGES / REPLACE / NO NORMAL-PROFILE QUALITY;
7. release metadata lock solo se giustificato;
8. final P0 verdict.

Nessun validator weakening per far passare un modello.

---

# 6. Windows Full Offline

Il requisito resta LOCKED:

```text
Windows Full Offline
= game
+ Lite P0-approved payload
+ Standard P0-approved payload
+ local runtime
+ no mandatory cloud/API after install
```

Un solo modello resta residente alla volta.

Il formato fisico multi-GB resta provisional finché i payload non sono lockati e una clean-machine installation proof non è completata.

---

# 7. Shared architecture invariants

```text
                 SHARED PROJECT
                      │
       ┌──────────────┼──────────────┐
       │              │              │
   GAME CORE       GAME DATA      REACT UI
       │              │              │
       └──────────────┼──────────────┘
                      │
             PLATFORM ADAPTERS
                ┌─────┴─────┐
                │           │
             WINDOWS       WEB
```

Invarianti:

- `packages/game-core` authoritative + deterministic;
- AI interprets/narrates, never owns state;
- React does not implement hidden authoritative rules;
- Rust/Tauri owns platform/persistence/local-runtime boundaries, not gameplay rules;
- one shared game implementation, not separate Windows/Web games;
- Web compatibility remains green during Windows-first development;
- heavy model/raw evidence stays outside normal Git;
- Safe/Procedural preserves gameplay integrity but is degraded narrative recovery.

---

# 8. UI / Lovable sequencing

UI work is useful only quando sostiene il proof e non nasconde la qualità del loop.

Consentito prima del GQP PASS:

- clarity/readability fixes;
- surfaces necessarie a GQP-D;
- Analysis/causal explanation support;
- accessibility/responsive regression;
- mock/visual work che non sostituisce la logica reale.

Da evitare:

- large polish pass usato per compensare scelte piatte;
- UI che implementa eligibility/pressure arithmetic;
- Tactical/Warfare screens come feature complete prima del gate.

---

# 9. AI-DM sequencing

L'AI resta centrale all'esperienza normale ma non è il prossimo problema da usare per “rendere divertente” un loop debole.

Prima del GQP PASS:

- mantenere i contract;
- usare narration grounded dove già disponibile;
- non delegare event selection/outcome al modello;
- non introdurre cloud dependency obbligatoria;
- non mascherare causalità con prosa generata.

Dopo che il proof sistemico è interessante, il production AI-DM layer può crescere sopra cause già valide.

---

# 10. Branch / validation workflow

```text
feature/* or docs/*
        ↓ PR
     develop
        ↓ deliberate promotion
       main
```

Ogni PR applicabile deve preservare:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cargo test --locked       when desktop/Rust affected
cargo check --locked      when desktop/Rust affected
Windows packaging/checks  when desktop affected
```

Exact-head review prima dei merge sostanziali.

Niente commit diretti su `main` per feature work.

---

# 11. Immediate sequence

Dopo il post-GQP0 documentation sync:

```text
1. close #34  World Tick finite-result hygiene
2. open/execute GQP-A contracts + proof scenario
3. GQP-B meaningful-choice network
4. GQP-C directed pacing
5. GQP-D installed Windows playtest
6. founder fun PASS
7. independent small-sample PASS
8. only then M2 expansion
```

Parallel lane:

```text
#17 P0.5 evidence reconciliation
-> quality/performance/hardware decision
-> model candidate lock
-> final P0 / Full Offline gate
```

---

# 12. Success condition before M2

M2 può ripartire soltanto quando il proof dimostra, non presume:

- same seed + different choices -> materially different trajectories;
- delayed consequences are causally recognizable;
- at least two characters exhibit memory-driven future behavior;
- major faction behavior is not driven by reputation scalar alone;
- at least one setback creates a real recovery decision;
- founder fun gate passes;
- independent small sample passes.

Questa è la differenza tra un'architettura che funziona e un gioco che merita di essere ampliato.
