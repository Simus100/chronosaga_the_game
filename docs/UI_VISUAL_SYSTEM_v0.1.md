# UI VISUAL SYSTEM v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Stato:** Product-aligned visual specification / selected details provisional until prototype review  
**Scope:** identità visiva, layout, navigation, Tactical/Warfare/Management UI, personaggi, eventi, AI-DM presentation, responsive desktop, interaction states e anti-pattern.

---

# 0. Scopo

Questo documento traduce il questionario UI/UX in una specifica operativa per Chronosaga.

La UI deve raggiungere contemporaneamente due obiettivi:

1. essere un'interfaccia di gioco leggibile ed efficiente;
2. sembrare un sistema operativo/strumento credibile interno al mondo.

Il rapporto target è **50% videogame UI / 50% diegetic operating system**.

Il giocatore deve poter passare fra tre identità senza percepire tre giochi separati:

```text
AVVENTURIERO / OPERATORE
        ↓
COMANDANTE
        ↓
GESTORE / LEADER DI FAZIONE
```

Tutte le modalità devono essere viste come moduli dello stesso sistema.

---

# 1. Stato delle decisioni

Usare tre livelli:

- **LOCKED** — scelta approvata.
- **PROVISIONAL** — scelta iniziale da verificare sul prototipo.
- **OPEN** — da decidere dopo esempi o test.

## 1.1 LOCKED

- equilibrio 50/50 fra UI da videogame e interfaccia diegetica;
- apprendimento non immediato ma efficiente dopo pochi minuti;
- identità del giocatore cambia con la scala: avventuriero, comandante, operatore;
- cinematografia moderata, non dominante;
- impronta militare media;
- livello tecnologico dipendente dal tipo di campagna, da near-future a tecnologia molto avanzata ma credibile;
- layout base a top telemetry + left panel + central viewport + right context + bottom system strip;
- central viewport circa 40% del layout standard, espandibile;
- pannelli riducibili e auto-hide intelligenti;
- pannelli ridimensionabili con layout iniziale già ottimizzato;
- 2–3 preset layout salvabili;
- navigazione ibrida: tab/aree fisse + shortcut + moduli contestuali dinamici;
- shortcut di tastiera essenziali;
- sprite tattici stilizzati;
- scheda bersaglio completa entro i limiti dell'intelligence disponibile;
- floating damage numbers configurabili;
- mappa Warfare geografica con cartografia militare tecnica;
- simboli unità originali ispirati alla chiarezza della simbologia militare, con tipo di unità sempre inequivocabile;
- supply lines come overlay attivabile;
- battaglie Warfare con mappa animata + feed narrativo + eventi;
- forecast con range + reliability/confidence;
- morale mostrato primariamente come barra;
- catena di comando graficamente importante;
- gestione con estetica da sistema operativo, non da city-builder generico;
- economia con tabelle + grafici + flussi input/output;
- catene produttive ad albero nella prima versione;
- popolazione rappresentabile a più livelli: aggregati, grafici, coorti cliccabili e composizione sociale;
- diplomazia: mappa + relationship graph + trattati;
- uso importante dei grafici;
- portrait dinamici per contesto;
- scheda personaggio come mix RPG + dossier operativo;
- ferite su body map tecnica;
- relazioni: graph + memorie chiave;
- loyalty/trust normalmente come stime, con valori più precisi solo quando giustificati da abilità/intelligence;
- teatralizzazione eventi media;
- eventi minori tramite feed + notifiche compatte;
- testo narrativo AI in posizione dinamica per contesto;
- dialoghi con composizione tipo visual novel, non chat generica;
- typing effect configurabile;
- stato AI rappresentato diegeticamente, non come generico spinner;
- densità testo media nella modalità normale;
- microanimazioni come baseline;
- effetti scan/data/glitch/noise moderati;
- glitch opzionale e contestuale;
- feedback sonoro pulsanti distinto;
- alert audio graduati;
- nessuna voce di sistema nel v0.1, ma architettura estendibile;
- supporto desktop equivalente 1080p e 1440p;
- mobile non target;
- larghezza minima desktop target: 1280 px;
- libertà Lovable bassa/moderata: esegue la specifica e può proporre alternative, non ridefinire il prodotto;
- una variante che viola la specifica richiede conferma;
- librerie UI solo quando indispensabili e/o leggere;
- output Lovable valutato con checklist dettagliata + screenshot comparison;
- primo output deve privilegiare identità visiva + UX;
- primo prototipo target ~75% del feeling finale, non wireframe generico;
- Analysis Mode attivabile con pulsante;
- quasi tutti i valori derivati devono poter essere spiegati;
- fog of war informativo attivo di default, ma configurabile;
- misinformation possibile;
- nei primi 5 secondi il giocatore deve percepire "mondo enorme in simulazione" e "interfaccia non comune";
- nei primi 30 secondi deve capire almeno chi è e dove si trova;
- priorità generale: equilibrio leggibilità/immersione;
- densità organizzata, non minimalismo vuoto;
- rapporto bellezza/credibilità: 5/10, equilibrio;
- identità sintetica: "simulatore profondo presentato come sistema operativo" + "centro di comando per una storia emergente".

## 1.2 PROVISIONAL

- palette numerica esatta;
- tipografia finale;
- stile portrait finale;
- Tactical renderer iniziale;
- timeline iniziativa nella UI;
- transizione di entrata nelle modalità;
- forma finale dell'Analysis Mode;
- prima vertical slice affidata a Lovable;
- dati mock vs Game Core nel primo passaggio;
- composizione finale del sistema politico;
- quantità di KPI/dashboards ammesse;
- uso di gradienti neon limitati a contesti olografici/segnale;
- animazioni decorative ammesse ma con budget e senza compromettere leggibilità.

## 1.3 OPEN

- scelta finale fra top-down, isometrico, top-down schematico e 2.5D per la Tactical Grid;
- stile portrait definitivo;
- collocazione definitiva della timeline tattica;
- evento che deve verificarsi obbligatoriamente nei primi 5 minuti;
- misura finale della trasformazione in Analysis Mode.

---

# 2. Visual DNA

## 2.1 Principio

Chronosaga non deve sembrare:

- un SaaS;
- un pannello amministrativo web;
- un template cyberpunk;
- una chat AI con elementi decorativi intorno;
- un RPG fantasy reskinnato.

Deve sembrare un **sistema operativo operativo, analitico e reattivo**, costruito per osservare una simulazione viva.

## 2.2 Palette PROVISIONAL

Scelta iniziale raccomandata:

```text
BACKGROUND-0      #050708   quasi nero
BACKGROUND-1      #0A0E10
SURFACE-1         #0E1417
SURFACE-2         #121A1E
GRID              #1A2A2E
TEXT-PRIMARY      #D6E2E2
TEXT-SECONDARY    #7F9598
TEAL-OPERATIONAL  #4DB8B3
CYAN-FOCUS        #74D5D1
AMBER             #D6A44A
DANGER-RED        #D85B5B
DANGER-MAGENTA    #C45584
POSITIVE          #6FAE7B
```

Target luminance:

- ~80% dello schermo resta nei livelli quasi neri/scuri;
- teal/cyan variano per layer e non devono diventare neon costante;
- amber = azione significativa / warning non critico;
- red/magenta = danger layer, errori gravi, danno, minaccia;
- verde = stato nominale/recupero/condizione positiva, usato con moderazione.

I gradienti possono comparire **solo** come fenomeno olografico, signal intensity, heatmap o data visualization; evitare grandi background gradient decorativi.

---

# 3. Tipografia PROVISIONAL

Sistema iniziale:

- **monospace tecnico** per numeri, ID, coordinate, telemetry, log e statistiche;
- **sans tecnico leggibile** per descrizioni, dialoghi e testo narrativo;
- titoli principali e labels in uppercase;
- prosa e dialoghi in sentence case.

Gerarchia consigliata:

```text
XS  11–12 px  telemetry micro
SM  13 px     label / metadata
MD  14–15 px  body / UI normal
LG  18–20 px  panel title
XL  26–32 px  event / mode title
```

La UI normale deve avere densità **media**, con Analysis Mode più denso.

---

# 4. Geometria e componenti

## 4.1 Shape language

- bordi sottili;
- angoli netti o raggio minimo 0–4 px;
- divisori e grid line funzionali;
- pannelli nidificati solo quando aggiungono gerarchia;
- evitare card grandi molto arrotondate;
- evitare pill decorative;
- evitare glassmorphism.

## 4.2 Glassmorphism — definizione

Glassmorphism = pannelli traslucidi tipo vetro sfocato con blur dello sfondo, spesso accompagnati da gradienti e bordi luminosi.

**Decisione v0.1:** non usarlo nel visual system principale. Eventuali superfici trasparenti devono essere strumenti (HUD/overlay), non “card di vetro”.

---

# 5. Layout primario

```text
┌──────────────────────────────────────────────────────────────┐
│ SYSTEM / LOCATION / CLOCK / ALERTS / PRIMARY RESOURCES      │
├───────────────┬────────────────────────┬─────────────────────┤
│ LEFT CONTEXT  │                        │ RIGHT CONTEXT       │
│ PARTY         │      MAIN VIEWPORT     │ EVENT / INTEL       │
│ ENTITIES      │       ~40% BASE        │ DIRECTIVES          │
│ STATUS        │                        │ TARGET/DETAILS       │
├───────────────┴────────────────────────┴─────────────────────┤
│ LOG / COMMAND / TIMELINE / CONTEXT / MODE STATUS            │
└──────────────────────────────────────────────────────────────┘
```

## 5.1 Behaviour

- layout di default pronto all'uso;
- side panel collapse;
- intelligent auto-hide;
- drag resize;
- central viewport espandibile;
- 2–3 preset salvabili, ad esempio:
  - BALANCED;
  - COMMAND;
  - ANALYSIS.

Il resize non deve permettere configurazioni inutilizzabili: usare min/max constraints.

---

# 6. Navigation architecture

Base fissa consigliata:

```text
OPERATIONS
PERSONNEL
WORLD
INTELLIGENCE
```

Moduli che emergono in base allo stato:

```text
TACTICAL
WARFARE
ECONOMY
FACTIONS
DIPLOMACY
PRODUCTION
ARCHIVE
```

La navigation è quindi **stabile + contestuale**.

Pattern:

```text
PRIMARY TABS
+ contextual sub-navigation
+ keyboard shortcut essenziali
+ command/context strip
```

Evitare sidebar con decine di voci sempre esposte.

---

# 7. Tactical UI

## 7.1 Renderer iniziale — OPEN

Il questionario non blocca ancora la prima visualizzazione Tactical.

Opzioni da prototipare:

### A — Top-down classico
Vista dall'alto, personaggi su terreno leggibile. È la soluzione più chiara e immediata.

### B — Isometrico
Vista inclinata tipo tactical RPG/strategy. Più cinematografica e leggibile per verticalità, ma più costosa da produrre e da gestire proceduralmente.

### C — Top-down schematico
Il campo è rappresentato come una mappa tecnica: geometrie, cover, linee di tiro, sagome stilizzate e telemetria. È la soluzione più coerente con l'OS e la più economica da rendere procedurale.

### D — 2.5D
Personaggi e ambiente con profondità prospettica ma gameplay sostanzialmente 2D. Maggior wow-factor, più costoso.

**Raccomandazione da testare:** C per vertical slice → confronto A/C → eventuale evoluzione verso D.  
Non è LOCKED.

## 7.2 Character representation

- sprite/sagome stilizzate;
- silhouette leggibili a colpo d'occhio;
- stato unità distinguibile senza leggere testo;
- portrait separato per identità emotiva.

## 7.3 Target inspector

Quando l'intelligence lo consente mostrare:

- identità/tipo;
- health/wounds;
- armor;
- status;
- range;
- cover;
- equipment noto;
- threat;
- estimated hit chance;
- confidence;
- unknown/uncertain fields.

Unknown values: `???` come baseline.

## 7.4 Hit feedback

Baseline:

- flash/impact breve;
- stato HP/armor aggiornato;
- log tecnico;
- floating damage configurabile;
- ferita grave = warning visivo evidente, senza interrompere automaticamente il flusso con body scan completa.

## 7.5 Timeline initiative — OPEN

Possibili collocazioni da prototipo:

- bottom strip orizzontale;
- top contextual strip;
- collapsible vertical timeline.

Il layout non deve presupporre una soluzione fino al playtest dell'iniziativa dinamica.

---

# 8. Warfare Command UI

## 8.1 Mappa

Combinare:

- geografia leggibile;
- confini/territori;
- strade/rotte;
- topografia essenziale;
- cartografia militare tecnica;
- overlay dinamici.

Overlay:

```text
CONTROL
SUPPLY
INTELLIGENCE
THREAT
WEATHER
COMMUNICATIONS
OBJECTIVES
```

## 8.2 Unit symbols

Usare simboli geometrici originali ad alta leggibilità.

Ogni unità deve comunicare immediatamente almeno:

- tipo;
- dimensione;
- fazione;
- stato;
- direzione/ordine quando rilevante.

Non copiare set proprietari. La chiarezza della simbologia militare è un principio, non un asset da replicare.

## 8.3 Battle presentation

```text
MAP MOTION
+ PHASE STATE
+ COMMANDER ORDERS
+ MORALE
+ SUPPLY
+ EVENT FEED
+ AI NARRATIVE INTERPRETATION
```

Il giocatore può osservare lo scontro evolvere senza trasformarlo in RTS click-heavy.

## 8.4 Forecast

UI standard:

```text
ESTIMATED OUTCOME   55–70%
CONFIDENCE          64%

POSITIVE
+ experienced commander
+ prepared position

NEGATIVE
- low ammunition
- poor weather
```

Niente falsa precisione.

## 8.5 Morale

Baseline: barra visuale leggibile.

Analysis Mode può aggiungere valore numerico + cause.

## 8.6 Chain of Command

Pannello/graph importante che mostra:

```text
ARMY COMMAND
  ├─ BATTLE GROUP A
  │    ├─ unit
  │    └─ unit
  └─ BATTLE GROUP B
```

Comandanti cliccabili e con stato morale/lealtà/competenza quando noto.

---

# 9. Management & Simulation UI

## 9.1 Principio

Deve avere la potenza di una dashboard complessa senza sembrare un prodotto enterprise generico.

Sono ammessi KPI, grafici e tabelle **quando rappresentano strumenti operativi del mondo**.

## 9.2 Economy

Tre livelli:

1. summary;
2. flows;
3. deep analysis.

Esempio:

```text
WATER     8.2k   +3.1/day
FOOD      5.4k   -0.8/day  WARNING
ENERGY    82%    +4%
```

Poi:

```text
PRODUCTION
→ STORAGE
→ CONSUMPTION
→ EXPORT
```

## 9.3 Production chains

Prima visualizzazione: **tree**.

```text
RAW MATERIAL
├─ REFINED METAL
│  ├─ COMPONENTS
│  └─ ARMOR
└─ INDUSTRIAL COMPOUND
```

Flowchart/Sankey possono essere aggiunti dopo se il tree non comunica bene i colli di bottiglia.

## 9.4 Population

Layer progressivi:

```text
TOTAL POPULATION
↓
DEMOGRAPHIC CHARTS
↓
COHORTS
↓
SOCIAL COMPOSITION
↓
NEEDS / POLITICS / MIGRATION
```

La profondità è accessibile, non obbligatoriamente sempre visibile.

## 9.5 Internal politics — PROVISIONAL mix

Supportare tre rappresentazioni interoperabili:

- faction list;
- relationship network;
- power structure.

Il prototipo deve determinare quale sia primaria.

## 9.6 Diplomacy

```text
GEOPOLITICAL MAP
+ RELATIONSHIP GRAPH
+ TREATIES / AGREEMENTS / THREATS
```

---

# 10. Character & Party UI

## 10.1 Portrait

Dimensione dinamica per contesto:

- compact list;
- medium party panel;
- large dialogue/event portrait.

Stile definitivo **OPEN**.

Candidate:

- realistico;
- realistic scan + biometric overlay;
- stylized hard-SF portrait.

## 10.2 Character sheet

Mix dossier + RPG:

```text
IDENTITY
ROLE / ARCHETYPE
ATTRIBUTES
SKILLS
EQUIPMENT
HEALTH / INJURIES
STRESS / MORALE
RELATIONSHIPS
MEMORIES
TRAITS
CURRENT GOALS
```

## 10.3 Injury view

Body map tecnica con zone cliccabili.

Non mostrare solo "-10 HP" quando esiste una injury persistente.

## 10.4 Relationships

Graph + memory evidence.

Esempio:

```text
TRUST: HIGH (estimated)
KEY MEMORIES
- rescued during Outpost 7 breach
- disagreed over civilian evacuation
```

Valori esatti visibili solo quando la modalità/capacità informativa lo giustifica.

---

# 11. Events & AI-DM presentation

## 11.1 Major event pattern — PROVISIONAL choice

Per eventi importanti usare:

```text
SIGNAL DETECTED
       ↓
ANALYSIS
       ↓
EVENT CLASSIFICATION
       ↓
DIRECTIVE AVAILABLE
```

La sequenza deve essere breve; non una cutscene obbligatoria lunga.

## 11.2 Minor events

- event feed;
- compact notification;
- expandable detail.

## 11.3 Narrative positioning

Dinamica per contesto:

- exploration: right context panel;
- dialogue: expanded communication layer;
- warfare: event feed + detail drawer;
- critical event: dedicated focus panel.

## 11.4 Dialogues

Visual-novel-inspired composition:

```text
PORTRAIT / SCENE
DIALOGUE TEXT
SPEAKER STATE
CHOICES / RESPONSE
CONTEXT DATA
```

Non usare una chatbox centrale come rappresentazione primaria dell'AI-DM.

## 11.5 AI generation state

Esempi diegetici:

```text
INTERPRETING STATE...
CORRELATING MEMORY...
ASSEMBLING REPORT...
GENERATING COMMS RESPONSE...
```

Non fingere processi che il sistema non esegue realmente; il label deve descrivere la fase effettiva del provider quando possibile.

---

# 12. Motion system

Baseline: microanimazioni.

## 12.1 Consentiti

- panel reveal 120–220 ms;
- cursor/focus response;
- map pulse;
- signal sweep;
- low-intensity scanline/noise;
- alert pulse;
- phase transition;
- optional glitch.

## 12.2 Regola

L'animazione deve fare almeno una delle cose:

- comunicare stato;
- indicare gerarchia;
- mostrare transizione;
- aumentare atmosfera senza ostacolare il controllo.

Decorazione pura ammessa solo entro un budget visivo basso.

## 12.3 Mode transition — PROVISIONAL

Default da testare: piccola transizione OS, circa 200–450 ms.

Sequenze cinematografiche possono essere riservate a battaglie/eventi eccezionali, non a ogni cambio tab.

---

# 13. Audio UI

Baseline:

- feedback button distinto ma breve;
- alert graduati;
- categorie audio diverse per information / warning / critical;
- nessuna system voice nella prima versione.

Preparare comunque event hooks per futura voce sintetica.

---

# 14. Responsive desktop

Target equivalenti:

- 1920×1080;
- 2560×1440.

Minimo target: **1280 px width**.

A 1280:

- pannelli laterali collassabili;
- viewport preservato;
- secondary telemetry condensata;
- nessuna modalità mobile.

Mobile: non supportato nel v0.1.

---

# 15. Analysis Mode

## 15.1 Obiettivo

Mostrare "perché" senza obbligare il giocatore a giocare sempre dentro una spreadsheet.

Attivazione: pulsante dedicato.

Target PROVISIONAL: aumentare significativamente la densità informativa ma mantenere lo stesso layout mentale.

## 15.2 Explainability

Quasi ogni valore derivato deve poter esporre una breakdown.

Esempio:

```text
MORALE                         63
─────────────────────────────────
base                           70
recent casualties              -8
commander confidence            +5
supply shortage                 -6
victory momentum                +2
─────────────────────────────────
current                         63
```

Questa breakdown proviene dal Simulation Core, non dall'AI-DM.

---

# 16. Informational Fog of War

Default: la UI non mostra informazioni che il giocatore/entità controllata non dovrebbe conoscere.

Configurabile tramite campaign/custom settings.

Unknown baseline:

```text
???
```

Dove utile:

```text
ESTIMATE: ???
CONFIDENCE: LOW
```

La misinformation è possibile quando derivata da sistemi reali di intelligence/errore; non deve essere inventata arbitrariamente dall'AI.

---

# 17. Anti-pattern policy

## 17.1 Vietati nel default visual system

- grandi rounded cards SaaS;
- glassmorphism;
- icone giganti;
- chat AI centrale dominante;
- UI fantasy classica nel tema Chronosaga hard-SF;
- gradienti neon come estetica globale;
- emoji come iconografia di sistema primaria.

## 17.2 Ammessi con vincoli

- KPI/dashboard: **favoriti quando operativi**, ma con styling diegetico/tecnico;
- gradienti: heatmap/signal/holographic data only;
- whitespace: sufficiente a creare gerarchia, mai layout vuoto;
- emoji: eventuale testo generato/social content, non comandi di sistema;
- animazioni atmosferiche: moderate;
- temi visuali alternativi futuri possono sostituire l'hard-SF senza modificare il core, ma il tema default non usa fantasy ornamentale.

---

# 18. First-use experience

## 18.1 Primo impatto — 5 secondi

Il giocatore deve pensare:

> "Qui c'è un mondo enorme che sta venendo simulato."

E:

> "Questa interfaccia non sembra il solito gestionale."

## 18.2 Entro 30 secondi

Deve capire almeno:

- chi sta controllando;
- dove si trova.

Il problema corrente e le azioni disponibili devono emergere subito dopo, senza obbligo di essere pienamente comprese nei primi 30 secondi.

## 18.3 Entro 5 minuti — OPEN

Non ancora bloccato un evento obbligatorio. Il prototipo deve misurare quale sequenza produce il migliore onboarding senza scripting artificiale.

---

# 19. Prima vertical slice UI — PROVISIONAL

Raccomandazione:

**Operations Vertical Slice**, non una singola pagina isolata.

Comprende:

- top telemetry;
- party/entity panel;
- central world viewport;
- active situation/event;
- directive choices;
- resource summary;
- event feed;
- Analysis Mode;
- access point visibile a Tactical/Warfare/Management anche se alcuni moduli sono placeholder.

Il prototipo deve dimostrare il linguaggio dell'intero prodotto.

---

# 20. Acceptance criteria per UI v0.1

Il prototipo è accettabile se:

1. in 5 secondi comunica scala e identità;
2. in 30 secondi permette di identificare soggetto e luogo;
3. nessuna schermata sembra un template SaaS generico;
4. la central viewport resta leggibile a 1080p e 1440p;
5. pannelli sono ridimensionabili senza rompere il layout;
6. normal mode è leggibile senza Analysis Mode;
7. Analysis Mode spiega almeno 5 valori derivati reali/mock coerenti;
8. eventi major/minor hanno gerarchia nettamente diversa;
9. dialoghi non sembrano una chat AI;
10. fog of war distingue known / unknown / estimate;
11. Tactical/Warfare/Management condividono visual DNA;
12. componenti non contengono logica autoritativa del Simulation Core;
13. responsive desktop funziona fino a 1280px;
14. screenshot comparison non mostra regressione verso rounded SaaS/cards/glassmorphism.

---

# 21. Decisioni da riesaminare dopo il primo prototipo

- Tactical A/C/D visual approach;
- initiative timeline placement;
- portrait style;
- political visualization primary mode;
- exact palette saturation;
- exact fonts;
- Analysis Mode depth;
- quantity of animated effects;
- first 5-minute onboarding event;
- amount of central viewport vs contextual panels.

Queste decisioni non devono essere codificate come irreversibili prima della review visuale.