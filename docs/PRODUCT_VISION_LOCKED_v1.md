# PRODUCT VISION LOCKED v1
## Parametric AI Adventure Simulator

**Versione:** 1.0  
**Data:** 2026-08-16  
**Stato:** Visione di prodotto allineata tramite questionario utente  
**Relazione con gli altri documenti:** questo file prevale sulle formulazioni più generiche contenute nelle versioni precedenti della Knowledge quando esiste un conflitto di interpretazione.

---

# 1. Identità del prodotto

Il prodotto è un **simulatore parametrico di avventure, gestione ed evoluzione di un mondo persistente**, nel quale il giocatore parte da una scala personale e di piccolo gruppo e può arrivare progressivamente a una scala più ampia: comunità, insediamenti, fazioni, territori ed eventualmente eserciti.

Non è un semplice RPG.
Non è un semplice gestionale.
Non è una chat con un LLM.
Non è un generatore di storie.

È un sistema ibrido nel quale:

- il mondo viene simulato;
- le decisioni hanno conseguenze;
- i personaggi ricordano;
- le fazioni evolvono;
- le risorse cambiano;
- gli eventi emergono dallo stato;
- l'AI interpreta e arricchisce ciò che i sistemi producono.

---

# 2. Priorità emozionali e di esperienza

Ordine di priorità approvato:

1. **Gestire un sistema complesso e intelligente**
2. **Esplorare un mondo imprevedibile**
3. **Prendere decisioni difficili che cambiano realmente le cose**
4. **Vivere una storia unica**

Tutte e quattro devono essere presenti.

La storia deve emergere soprattutto dall'interazione fra sistemi, personaggi, eventi e decisioni, non da una trama lineare prefissata.

---

# 3. Core Loop — priorità

Ordine approvato:

### Priorità primaria
- esplorazione;
- decisioni narrative/politiche.

### Priorità secondaria
- gestione;
- combattimento/progressione del gruppo.

Il gioco deve quindi alternare:

```text
ESPLORA
↓
SCOPRI
↓
VALUTA
↓
DECIDI
↓
RISOLVI
↓
GESTISCI CONSEGUENZE
↓
IL MONDO REAGISCE
↓
NUOVE OPPORTUNITÀ / NUOVI PROBLEMI
```

---

# 4. Scala di gioco

La scala deve evolvere.

Il giocatore deve poter gestire:

- il proprio personaggio;
- il proprio party;
- relazioni personali;
- equipaggiamento;
- risorse del gruppo;

e, progressivamente:

- una comunità;
- un insediamento;
- una rete di alleati;
- una fazione;
- un territorio;
- un esercito;
- sistemi economici e politici più ampi.

Il passaggio micro → macro deve essere progressivo e leggibile.

Il gioco non deve abbandonare la dimensione personale quando cresce la scala.

Principio:

> La crescita del potere aumenta la scala delle decisioni, non cancella il valore dei singoli personaggi.

---

# 5. Sandbox e struttura narrativa

Valore approvato:

**Sandbox = 7/10**

Significa:

- forte proceduralità;
- mondo sistemico;
- grande libertà;
- eventi emergenti;
- possibilità di percorsi molto diversi;

ma anche:

- strutture narrative;
- archi;
- eventi speciali;
- quest;
- momenti progettati;
- sistemi di implicazione tra scelte;
- logiche modulari espandibili.

Il prodotto non deve essere né completamente lineare né completamente privo di direzione.

---

# 6. Modularità parametrica

Requisito centrale:

Il sistema deve essere **parametrico, modulare ed espandibile**.

Le future funzionalità devono poter essere aggiunte attraverso:

- nuovi moduli;
- nuovi JSON/schema;
- nuove regole;
- nuovi sistemi;
- nuovi tipi di evento;
- nuove relazioni tra sistemi.

Il progetto deve privilegiare:

```text
MODULI
+
REGOLE
+
IMPLICAZIONI
+
INTERAZIONI
```

rispetto a una grande quantità di contenuto hardcoded.

---

# 7. Tipi di decisione

Devono essere presenti tutti:

- morali;
- strategiche;
- politiche;
- personali.

Nessuna delle quattro categorie deve essere puramente decorativa.

Le decisioni devono poter influenzarsi tra loro.

Esempio:

```text
decisione morale
→ relazione personale
→ perdita di fiducia
→ cambiamento politico
→ difficoltà strategica
→ evento futuro
```

Questo principio di concatenazione deve essere uno dei pilastri del Simulation Core.

---

# 8. Difficoltà

La difficoltà deve essere selezionabile.

Non deve modificare soltanto quantità di HP o danni.

Può influenzare:

- scarsità risorse;
- severità conseguenze;
- tolleranza agli errori;
- mortalità;
- aggressività del mondo;
- velocità di escalation;
- costo delle decisioni;
- recuperabilità degli insuccessi.

Prevedere almeno:

- Narrativa / rilassata
- Standard
- Difficile
- Simulativa / spietata

I nomi definitivi possono cambiare.

---

# 9. Mortalità e permanenza delle conseguenze

All'inizio della campagna il giocatore deve poter scegliere il livello di mortalità/permadeath.

Possibili modalità:

### Protetta
I personaggi principali non muoiono definitivamente salvo casi eccezionali.

### Standard
La morte è possibile ma relativamente rara.

### Permadeath
Qualunque personaggio può essere perso definitivamente.

La scelta deve avere impatto reale sul design della campagna.

---

# 10. Sistema di combattimento

Sono previste almeno due modalità differenti.

## 10.1 Combattimento di gruppo

Quando lo scontro coinvolge il party:

**turn-based tactical/ability combat**

Deve poter includere progressivamente:

- turni;
- abilità;
- equipaggiamento;
- posizione;
- status;
- morale;
- ferite;
- ambiente;
- sinergie.

## 10.2 Conflitto su larga scala

Quando il giocatore guida un esercito o una forza ampia:

**gestione strategica + risoluzione semi-automatica**

Il giocatore decide:

- preparazione;
- composizione;
- obiettivi;
- tattica generale;
- risorse;
- comandanti;
- priorità;

mentre il sistema risolve gran parte della battaglia.

La qualità delle decisioni precedenti deve influenzare l'esito.

---

# 11. AI — ruolo e visibilità

La visibilità dell'AI nell'interfaccia non è un requisito centrale.

Il valore dell'AI deve essere percepito tramite:

- varietà;
- reattività;
- dialoghi;
- eventi;
- memoria;
- descrizioni;
- comportamenti;
- conseguenze narrative.

Il giocatore non deve necessariamente vedere un pannello “AI”.

Il sistema può essere completamente diegetico.

---

# 12. AI — livello di autonomia creativa

Livello approvato:

**D — molto elevato, entro regole forti.**

L'AI può generare:

- testo;
- dialoghi;
- eventi;
- personaggi secondari;
- missioni;
- dettagli di luoghi;
- conseguenze narrative;
- variazioni contestuali;
- contenuto emergente.

Ma tutto deve rispettare:

- Simulation Core;
- World State;
- schema dati;
- limiti del mondo;
- validatori;
- continuità;
- regole di gioco.

Formula:

```text
AI CREA POSSIBILITÀ
↓
VALIDATORE
↓
SIMULATION CORE
↓
WORLD STATE
```

---

# 13. AI locale — requisito di prodotto

Il gioco deve essere compatibile con un **piccolo modello generativo locale**.

Obiettivo:

- versione server: possibilità di eseguire un piccolo modello sulla VPS quando tecnicamente sostenibile;
- versione scaricabile: possibilità di includere o offrire un model pack locale insieme al gioco.

Il gioco NON deve richiedere necessariamente una API cloud per funzionare.

Questo requisito deve essere trattato come:

**HARD PRODUCT REQUIREMENT / IMPLEMENTATION TO BENCHMARK**

Non fissare ancora:

- modello;
- quantizzazione;
- runtime;
- context size;
- requisiti minimi definitivi.

Questi valori devono derivare da benchmark reali.

Prevedere tre modalità:

```text
LOCAL MODEL
CLOUD/API MODEL
PROCEDURAL FALLBACK
```

Il gameplay deve funzionare in tutte e tre.

---

# 14. Densità dell'interfaccia

Scelta approvata:

**D — alta densità informativa.**

Il giocatore deve poter vedere molti dati.

Ma devono essere:

- guidati;
- ordinati;
- gerarchici;
- nominati chiaramente;
- comprensibili;
- espandibili.

Principio:

> Complessità visibile, confusione minima.

Prevedere:

- overview;
- drill-down;
- tooltip;
- filtri;
- indicatori;
- spiegazioni contestuali;
- nomenclatura coerente.

---

# 15. Art direction

Direzione approvata:

- **cinematografica**
- **computer di bordo hard-sci-fi**

La UI deve evolvere le reference condivise.

Formula estetica:

```text
MISSION OPERATING SYSTEM
+
HARD SCI-FI
+
RETROFUTURISMO TECNICO
+
CINEMATIC PRESENTATION
+
GESTIONALE STRATEGICO
```

La cinematografia deve apparire soprattutto nei momenti di forte importanza.

---

# 16. Immagini grandi e scene

Approccio approvato:

**D — interfaccia tecnica + scene visive forti nei momenti importanti.**

Uso normale:

- mappe;
- dati;
- pannelli;
- sprite;
- ritratti;
- diagnostica;
- telemetria.

Uso speciale:

- grandi immagini;
- illustrazioni;
- eventi cinematografici;
- luoghi importanti;
- scoperte;
- battaglie;
- svolte narrative.

Le immagini grandi devono avere valore narrativo.

---

# 17. Sistema visuale personaggi — fase iniziale

Direzione futura preferita:

**immagini generate dall'AI**, eventualmente supportate da set pre-generati.

Per la fase attuale:

- NON implementare image generation;
- creare nella UI gli spazi dedicati;
- usare placeholder chiaramente indicati;
- preparare gli asset IDs e il sistema di binding.

Esempio UI:

```text
[ CHARACTER VISUAL ]
ASSET NOT GENERATED
ID: chr_000142
STATUS: PLACEHOLDER
```

---

# 18. Durata della campagna

Il giocatore deve poter scegliere la scala della campagna.

Prevedere almeno:

### Standard
circa 5-10 ore

### Estesa
circa 20-40 ore

### Persistente
decine o centinaia di ore / simulazione continuativa

La durata deve influenzare:

- ritmo;
- quantità eventi;
- escalation;
- economia;
- memoria;
- progressione;
- generazione mondo;
- densità delle conseguenze.

Non deve essere semplicemente un timer.

---

# 19. Mondo autonomo

Requisito massimo:

**Il mondo deve vivere anche senza intervento diretto del giocatore.**

Devono poter evolvere:

- fazioni;
- economia;
- territori;
- popolazioni;
- personaggi;
- guerre;
- alleanze;
- rivalità;
- insediamenti;
- risorse;
- minacce;
- rotte;
- missioni;
- leadership.

Il giocatore deve poter osservare conseguenze non direttamente causate da lui.

Questo è uno dei principali elementi di meraviglia del prodotto.

---

# 20. Personaggi

Importanza approvata:

**massima.**

Il giocatore deve poter:

- affezionarsi;
- ricordare;
- fidarsi;
- sospettare;
- amare/odiare;
- perdere;
- tradire;
- perdonare;
- promuovere;
- abbandonare.

Ogni personaggio importante deve poter possedere:

- memoria;
- personalità;
- relazioni;
- paure;
- obiettivi;
- opinioni;
- lealtà;
- conflitti;
- esperienza;
- ferite;
- storia emergente.

I personaggi non sono semplici unità.

---

# 21. Pianificazione a lungo termine

Priorità:

**C — alta.**

Decisioni prese molti turni prima devono poter tornare a influenzare il gioco.

Target desiderato:

- conseguenze ritardate;
- catene di eventi;
- memoria politica;
- debiti;
- rancori;
- alleanze;
- investimenti;
- errori strategici;
- effetti economici.

Il sistema deve evitare che ogni turno sia isolato.

---

# 22. Anti-AI-Slop — requisito critico

Il difetto più importante da evitare è:

> **“sembrare AI slop”.**

Questo significa evitare:

- testi generici;
- eventi intercambiabili;
- immagini senza identità;
- fantasy/sci-fi cliché assemblato;
- frasi eccessivamente enfatiche;
- personaggi stereotipati;
- UI generica “AI generated”;
- quantità al posto della qualità;
- incoerenza stilistica;
- lore casuale;
- proliferazione di feature senza profondità.

Ogni generazione deve essere filtrata da:

```text
WORLD RULES
+
STYLE RULES
+
CONTEXT
+
MEMORY
+
VALIDATION
```

La proceduralità deve produrre specificità, non mediocrità combinatoria.

---

# 23. Due scene-manifesto

Il prodotto deve essere capace di generare entrambe queste esperienze.

## 23.1 Conseguenza personale

Un personaggio tradito molti turni prima:

- ricorda;
- cambia atteggiamento;
- lascia il gruppo;
- cresce altrove;
- entra in una fazione;
- torna come alleato o nemico.

Il sistema deve sapere **perché** è accaduto.

## 23.2 Conseguenza sistemica

Una decisione economica/politica precedente:

- altera produzione;
- influenza prezzi;
- indebolisce una città;
- produce migrazione o crisi;
- cambia equilibri politici;
- rende visibile sulla mappa un mondo trasformato.

Queste due scene rappresentano la promessa centrale:

> **le conseguenze devono esistere sia alla scala umana sia alla scala del mondo.**

---

# 24. Implicazioni per l'architettura

Le risposte rendono obbligatori alcuni sistemi.

## Necessari

- simulation clock;
- world tick;
- faction simulation;
- relationship graph;
- character memory;
- long-term event flags;
- delayed consequences;
- scalable entity system;
- separate micro/macro combat engines;
- campaign profile;
- difficulty profile;
- mortality profile;
- campaign length profile;
- local AI adapter;
- cloud AI adapter;
- procedural fallback.

---

# 25. Campaign Profile

All'avvio della campagna devono essere configurabili almeno:

```json
{
  "difficulty": "standard",
  "mortality": "standard",
  "campaign_length": "extended",
  "ai_mode": "local_or_auto",
  "simulation_depth": "standard"
}
```

In futuro potranno essere aggiunti preset.

---

# 26. Profilo di complessità

La grande ampiezza del progetto introduce rischio di feature creep.

Per evitarlo:

## Vertical Slice

Deve dimostrare soltanto:

- esplorazione;
- scelta;
- conseguenza;
- party;
- memoria;
- risorsa;
- evento;
- mondo che cambia;
- placeholder visuale;
- UI definitiva.

## Non ancora

- eserciti completi;
- macroeconomia avanzata;
- decine di sistemi;
- AI image generation;
- modding;
- centinaia di eventi.

La profondità deve precedere l'ampiezza.

---

# 27. Product Pillars definitivi

## PILLAR 1 — SYSTEMIC WORLD
Il mondo vive e cambia.

## PILLAR 2 — MEANINGFUL CHOICE
Ogni scelta importante deve lasciare una traccia.

## PILLAR 3 — MICRO TO MACRO
Dal singolo personaggio al territorio senza perdere la dimensione umana.

## PILLAR 4 — EMERGENT STORY
La storia nasce dalle interazioni tra sistemi.

## PILLAR 5 — LIVING CHARACTERS
Le persone ricordano e cambiano.

## PILLAR 6 — HARD-SCI-FI OPERATING UI
La UI è parte dell'identità del gioco.

## PILLAR 7 — LOCAL-FIRST GENERATIVE AI
L'AI può funzionare localmente e non controlla il Simulation Core.

## PILLAR 8 — MODULAR EXPANSION
Il prodotto deve poter crescere attraverso nuovi sistemi e moduli.

---

# 28. Funzione obiettivo aggiornata

Massimizzare:

```text
SYSTEMIC DEPTH
×
PLAYER AGENCY
×
WORLD AUTONOMY
×
CHARACTER ATTACHMENT
×
LONG-TERM CONSEQUENCE
×
EXPLORATION
×
CLARITY
×
ATMOSPHERE
```

Minimizzare:

```text
AI SLOP
×
GENERICITY
×
FEATURE CREEP
×
TOKEN COST
×
PLAYER CONFUSION
×
FAKE CHOICE
×
SYSTEM INCOHERENCE
```

---

# 29. Criterio di successo

Il progetto è allineato quando una partita può produrre contemporaneamente:

1. una storia personale memorabile;
2. una trasformazione visibile del mondo;
3. una conseguenza strategica di lungo periodo;
4. un evento non identico a quello di un'altra campagna;
5. un'interfaccia che permette di comprendere perché è successo.

---

# 30. Stato di allineamento

Dopo il questionario:

**Visione generale:** BLOCCATA  
**Core pillars:** BLOCCATI  
**Scala micro→macro:** BLOCCATA  
**Sandbox target:** BLOCCATO  
**Difficoltà configurabile:** BLOCCATA  
**Mortalità configurabile:** BLOCCATA  
**Doppio combat model:** BLOCCATO  
**AI local-first:** BLOCCATO COME REQUISITO  
**UI dense hard-SF:** BLOCCATA  
**World autonomy:** BLOCCATA  
**Character importance:** BLOCCATA  
**Campaign lengths multiple:** BLOCCATE  
**AI image generation:** DEFERRED / PLACEHOLDER FIRST  

Ancora aperti:

- ambientazione definitiva;
- setting/lore;
- modello matematico del world tick;
- formule economiche;
- schema relazioni;
- formule combattimento;
- progressione micro→macro;
- runtime AI locale;
- modello generativo specifico;
- requisiti minimi hardware client;
- bilanciamento delle tre durate campagna;
- dettagli completi del UI Visual System.
