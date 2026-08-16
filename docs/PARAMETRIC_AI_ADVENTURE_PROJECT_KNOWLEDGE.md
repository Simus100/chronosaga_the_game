# PARAMETRIC AI ADVENTURE — PROJECT KNOWLEDGE

**Versione:** 0.1  
**Data:** 2026-08-16  
**Stato:** Piano approvato / base di knowledge del progetto  
**Scopo del file:** costituire la fonte di verità iniziale per progettazione, sviluppo, prompting, architettura, deployment e iterazioni future del prodotto.

---

# 1. Visione del progetto

Realizzare un videogioco gestionale e simulativo parametrico nel quale un sistema AI economico agisce come **Dungeon Master dinamico** sopra un motore di simulazione deterministico.

Il prodotto deve unire:

- avventura procedurale;
- gestione di risorse;
- esplorazione;
- personaggi persistenti;
- combattimenti;
- fazioni e relazioni;
- missioni;
- eventi dinamici;
- decisioni con conseguenze reali;
- ramificazioni narrative;
- progressione;
- generazione procedurale e, dove utile, AI di sprite, ritratti e altri asset;
- forte rigiocabilità;
- mondo persistente e reattivo.

Il prodotto **non deve essere percepito come una chat con elementi da videogioco**. Deve sembrare un vero simulatore sistemico con un Dungeon Master invisibile che interpreta il mondo e reagisce alle decisioni del giocatore.

La frase-obiettivo percettiva è:

> “Sto giocando a un simulatore complesso e persistente in cui il mondo reagisce davvero alle mie decisioni.”

---

# 2. Principio fondamentale

L'AI non è il motore del gioco.

L'architettura deve separare chiaramente:

1. **Simulation Core** — calcola ciò che accade.
2. **World State** — memorizza ciò che è accaduto e lo stato corrente.
3. **AI Dungeon Master** — interpreta, narra e propone.
4. **UI** — rende comprensibili sistemi, decisioni e conseguenze.

L'AI può aumentare varietà, atmosfera, dialoghi, personalità ed emergenza narrativa, ma non deve possedere autorità arbitraria sulle regole.

---

# 3. Simulation Core

Il Simulation Core deve essere deterministico o pseudodeterministico e deve gestire almeno:

- statistiche;
- economia;
- risorse;
- combattimenti;
- inventario;
- probabilità;
- tempo;
- condizioni ambientali;
- relazioni;
- reputazione;
- fazioni;
- missioni;
- eventi;
- conseguenze;
- accesso a luoghi;
- progressione;
- stato dei personaggi;
- stato del mondo.

L'AI non deve decidere direttamente i valori numerici finali.

Può proporre un effetto, ma il Simulation Core deve:

1. ricevere la proposta;
2. validarla;
3. applicarla secondo le regole;
4. registrare il delta nello stato;
5. restituire il risultato alla UI e all'AI-DM.

---

# 4. World State

Il mondo deve essere espresso tramite dati persistenti.

Macro-sezioni previste:

- `world_state`
- `player_state`
- `party_state`
- `character_memory`
- `faction_state`
- `economy_state`
- `location_state`
- `quest_state`
- `event_history`
- `relationship_graph`
- `global_flags`
- `local_flags`
- `world_pressure`
- `time_state`

Ogni entità importante deve avere un ID persistente.

---

# 5. Strutture JSON

Il gioco deve essere data-driven.

File o domini logici previsti:

- `characters.json`
- `resources.json`
- `items.json`
- `weapons.json`
- `armor.json`
- `locations.json`
- `factions.json`
- `events.json`
- `encounters.json`
- `traits.json`
- `relationships.json`
- `quests.json`
- `world_rules.json`
- `status_effects.json`
- `visual_assets.json`
- `economy.json`
- `combat_rules.json`
- `generation_tables.json`

Durante la vertical slice questi dati possono essere incorporati nel codice o in JSON locali; nel prodotto devono diventare gestibili in modo modulare.

---

# 6. Event Engine

Gli eventi non devono essere semplicemente estratti casualmente.

Ogni evento può possedere:

- ID;
- prerequisiti;
- peso;
- luogo;
- personaggi compatibili;
- fazioni coinvolte;
- condizioni temporali;
- risorse richieste;
- flag richiesti;
- flag esclusi;
- livello di minaccia;
- probabilità;
- effetti;
- conseguenze immediate;
- conseguenze ritardate;
- follow-up;
- cooldown;
- tag narrativi;
- memoria;
- possibilità di evoluzione.

L'obiettivo è che il giocatore percepisca che gli eventi emergono dallo stato del mondo, non da una lista casuale.

---

# 7. Conseguenze e agency

Le decisioni devono modificare realmente il gioco.

Possibili variabili influenzabili:

- risorse;
- salute;
- stress;
- morale;
- reputazione;
- relazioni;
- fazioni;
- territori;
- prezzi;
- accesso a luoghi;
- missioni;
- party;
- ferite;
- abilità;
- equipaggiamento;
- informazioni possedute;
- flag;
- eventi futuri;
- comportamento degli NPC;
- stabilità politica;
- condizioni economiche;
- livelli di minaccia.

Le conseguenze possono essere:

- immediate;
- ritardate;
- nascoste;
- cumulative;
- reversibili;
- irreversibili.

Il gioco deve privilegiare **scelte con effetto reale**, evitando scelte puramente cosmetiche.

---

# 8. Personaggi

Ogni personaggio persistente deve poter avere:

- `id`
- `name`
- `role`
- `stats`
- `traits`
- `health`
- `stress`
- `morale`
- `equipment`
- `relationships`
- `memory_tags`
- `goals`
- `loyalty`
- `fear`
- `faction`
- `current_status`
- `location`
- `known_information`
- `visual_asset_id`

L'obiettivo futuro è creare storie emergenti dai sistemi invece di scrivere anticipatamente ogni arco narrativo.

---

# 9. Combattimento

Il combattimento deve essere sistemico.

L'AI può descriverlo, ma l'esito viene determinato dal motore.

Dimensioni future:

- HP;
- stamina;
- morale;
- equipaggiamento;
- abilità;
- iniziativa;
- posizionamento;
- copertura;
- ambiente;
- status effect;
- ferite;
- tratti;
- sinergie;
- leadership;
- terreno;
- informazioni precedenti allo scontro.

La vertical slice iniziale usa un sistema semplificato, da espandere soltanto dopo la validazione del loop.

---

# 10. AI Dungeon Master

## Ruolo

L'AI-DM deve:

- narrare eventi;
- generare dialoghi;
- interpretare conseguenze;
- produrre varianti testuali;
- proporre eventi compatibili;
- creare descrizioni contestuali;
- contribuire alla personalità dei personaggi;
- produrre prompt per generazione visuale quando richiesto.

Non deve:

- modificare statistiche arbitrariamente;
- inventare oggetti non validati;
- ignorare prerequisiti;
- contraddire il World State;
- riscrivere la storia già consolidata;
- diventare l'unica fonte di logica del gameplay.

## Input ideale

L'AI non riceve l'intera campagna.

Riceve:

- `WORLD SUMMARY`
- `CURRENT LOCATION`
- `RELEVANT CHARACTERS`
- `RECENT HISTORY`
- `ACTIVE FLAGS`
- `CURRENT RESOURCES`
- `CURRENT EVENT`
- `PLAYER ACTION`

## Strategia di risparmio token

Usare:

**STATE SNAPSHOT  
+ RECENT DELTA  
+ RELEVANT MEMORY  
+ CURRENT EVENT**

Evitare di inviare continuamente tutta la cronologia.

## Output strutturato ideale

```json
{
  "narration": "",
  "dialogue": [],
  "event_proposals": [],
  "memory_updates": [],
  "visual_prompt": "",
  "tags": []
}
```

Le modifiche numeriche o strutturali devono sempre passare dal Simulation Core.

---

# 11. Strategia AI economica

L'obiettivo è rendere la componente AI una frazione del costo complessivo di ogni partita.

Il gioco deve poter funzionare quasi interamente localmente lato server per:

- simulazione;
- regole;
- inventario;
- economia;
- combattimento;
- relazioni;
- eventi;
- salvataggi;
- selezione del contesto;
- caching.

L'API AI deve essere usata soprattutto quando aggiunge valore percepibile.

Priorità:

1. modello testuale economico per AI-DM;
2. caching aggressivo;
3. contesto ridotto;
4. output JSON strutturato;
5. generazione visuale asincrona;
6. riuso degli asset.

---

# 12. Generazione visuale

La generazione AI di immagini non deve essere indispensabile per giocare.

Il sistema deve poter utilizzare:

- sprite procedurali locali;
- placeholder;
- asset pre-generati;
- ritratti;
- immagini di luoghi;
- creature;
- artefatti;
- anomalie;
- eventi speciali.

Ogni asset generato deve essere associato all'ID persistente dell'entità.

Principio:

> Generare una volta quando possibile, memorizzare, riutilizzare.

La generazione visuale deve essere asincrona: il gameplay non deve bloccarsi in attesa dell'immagine.

---

# 13. Art direction

Le reference visive approvate definiscono una UI con DNA:

- computer di bordo;
- terminale scientifico;
- gestionale strategico;
- software di missione;
- retrofuturismo hard-SF;
- interfaccia militare;
- database tecnico;
- altissima densità informativa;
- mappa e telemetria come elementi centrali.

La UI finale deve **evolvere** questa estetica e non copiarla letteralmente.

## DNA visivo da preservare

- fondo quasi nero;
- teal/ciano tecnologico;
- amber/arancio per risorse e avvisi;
- rosso/magenta per perdita o pericolo;
- verde per stato nominale;
- bianco sporco per testo primario;
- font monospaced e tecnici;
- bordi sottili;
- angoli netti;
- griglie;
- separatori;
- telemetria;
- coordinate;
- indicatori;
- mappe schematiche;
- tab compatti;
- pannelli ad alta densità.

## Da evitare

- dashboard SaaS;
- Material Design;
- Bootstrap look;
- grandi card arrotondate;
- pill button;
- glassmorphism;
- cyberpunk neon eccessivo;
- gradienti viola/blu generici;
- HUD da FPS;
- UI da smartphone;
- layout da chatbot;
- decorazioni senza funzione.

## Evoluzione desiderata

La reference deve diventare:

**retrofuturismo  
+ hard sci-fi  
+ visualizzazione dati moderna  
+ gestionale strategico  
+ sistema operativo diegetico**

Migliorare soprattutto:

- gerarchia;
- profondità;
- leggibilità;
- feedback;
- microanimazioni;
- visualizzazione sistemica;
- drill-down;
- tooltip;
- trend;
- filtri;
- mappe.

Non interpretare “più bello” come “più effetti”.

---

# 14. Struttura UI

## Telemetry Header

Sempre visibile.

Mostra:

- tempo;
- popolazione;
- energia;
- risorse;
- minaccia;
- posizione;
- stato missione;
- condizioni globali.

## Navigation Strip

Tab tecnici, ad esempio:

- COMANDO
- COMPAGNIA
- MAPPA
- INSEDIAMENTO
- FAZIONI
- INVENTARIO
- RICERCA
- MISSIONI
- CRONACA

## Main Viewport

Area centrale dedicata a:

- mappa;
- luogo;
- battaglia;
- dungeon;
- insediamento;
- nave;
- regione.

## Context Panel

Mostra soltanto informazioni pertinenti alla selezione.

## Event / Directive Panel

Area dedicata a:

- evento;
- contesto;
- rischio;
- costi;
- conseguenze note;
- scelte;
- eventuale timer.

Le scelte devono sembrare **direttive operative**, non pulsanti da chatbot.

## Command Strip

Azioni globali:

- AVANZA
- PAUSA
- VELOCITÀ
- SALVA
- REGISTRO
- MAPPA
- COMANDO

---

# 15. VPS approvata

Server privato disponibile:

- **CPU:** 6 core
- **RAM:** 12 GB
- **Disco:** 200 GB SSD
- **Auto Backup:** Enabled

Questa VPS è considerata sufficiente per:

- frontend;
- backend;
- database;
- reverse proxy;
- Simulation Core;
- caching;
- salvataggi;
- world state;
- OpenClaw/Clawbot in modalità privata;
- alpha/MVP iniziale.

Non è pensata per eseguire localmente modelli generativi pesanti.

Non usare la VPS per:

- LLM di grandi dimensioni;
- generazione video;
- modelli visuali pesanti;
- workload GPU intensivi.

Per tali operazioni usare servizi/API esterne.

---

# 16. Architettura deployment

Schema concettuale:

```text
INTERNET
   │
   ▼
NGINX / CADDY
HTTPS
   │
   ├──────────────► FRONTEND
   │
   └──────────────► GAME API
                      │
                      ├── Simulation Core
                      ├── PostgreSQL
                      ├── Cache
                      ├── Asset Storage
                      └── AI Gateway
                               │
                               ├── LLM API
                               └── Image API
```

OpenClaw/Clawbot deve restare separato dal traffico pubblico del gioco.

---

# 17. Stack server consigliato

Per l'MVP:

- Linux VPS;
- Docker Compose;
- Nginx o Caddy;
- frontend web;
- backend Node.js / TypeScript;
- PostgreSQL;
- Redis opzionale;
- storage locale per asset e cache;
- AI Gateway;
- OpenClaw/Clawbot privato;
- Git repository come source of truth.

Redis non è obbligatorio nella prima vertical slice.

---

# 18. Strategia di sicurezza

OpenClaw/Clawbot non deve essere esposto direttamente a Internet.

Schema:

```text
PUBLIC
443 → reverse proxy → game frontend/backend

PRIVATE
OpenClaw / Clawbot
↑
SSH / VPN / localhost / rete privata
```

Usare un utente Linux dedicato.

Evitare accesso root permanente.

Separazione minima:

```text
root
├── reverse-proxy
├── game-user
│   └── applicazione
└── openclaw-user
    └── agente
```

L'agente deve poter operare sul repository e sui processi necessari, ma con privilegi limitati.

---

# 19. Ruolo di Lovable

Lovable viene approvato come **strumento di sviluppo rapido**, soprattutto per:

- UI;
- componenti;
- layout;
- iterazioni visuali;
- schermate;
- prototipazione;
- frontend;
- integrazione iniziale;
- eventuali parti backend.

Non deve diventare una dipendenza obbligatoria del prodotto.

Il progetto deve restare esportabile e gestibile nel proprio repository.

---

# 20. Ruolo di GitHub

GitHub è la **source of truth** del codice.

Workflow approvato:

```text
ChatGPT
   ↓
specifiche / game design / prompt
   ↓
Lovable
   ↓
GitHub
   ↕
OpenClaw / Clawbot
   ↓
test / integrazione / build / deploy
   ↓
VPS
```

Nessun agente deve modificare il progetto senza sincronizzarsi con il repository.

---

# 21. Ruolo di OpenClaw / Clawbot

OpenClaw/Clawbot è concepito soprattutto come agente operativo di sviluppo e DevOps.

Può essere usato per:

- modificare codice;
- implementare task;
- eseguire test;
- fare build;
- leggere log;
- preparare deploy;
- verificare servizi;
- operare sul repository;
- eseguire procedure ripetitive;
- assistere nella manutenzione.

Non deve essere usato come Dungeon Master pubblico per i giocatori.

AI-DM e agente DevOps sono due componenti distinti.

---

# 22. Workflow di sviluppo

## Fase di progettazione

ChatGPT:

- architettura;
- game design;
- prompt;
- schemi dati;
- criteri di accettazione;
- roadmap;
- review;
- debugging concettuale.

## Fase di prototipazione

Lovable:

- frontend;
- schermate;
- componenti;
- UX;
- animazioni;
- layout.

## Fase di versionamento

GitHub:

- repository centrale;
- branch;
- versioni;
- history;
- pull request;
- rollback.

## Fase di automazione

OpenClaw/Clawbot:

- implementazione task;
- test;
- fix;
- deploy;
- operazioni server.

## Fase di produzione

VPS:

- hosting;
- backend;
- database;
- Simulation Core;
- salvataggi;
- cache;
- API Gateway.

---

# 23. Struttura repository proposta

```text
/project
│
├── apps/
│   ├── web/
│   └── server/
│
├── packages/
│   ├── simulation-core/
│   ├── game-data/
│   ├── ai-dm/
│   ├── shared-types/
│   └── ui-system/
│
├── data/
│   ├── characters/
│   ├── factions/
│   ├── items/
│   ├── locations/
│   ├── events/
│   ├── quests/
│   └── rules/
│
├── assets/
│   ├── sprites/
│   ├── portraits/
│   ├── locations/
│   └── generated/
│
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── scripts/
│
├── docs/
│   ├── GAME_DESIGN.md
│   ├── ARCHITECTURE.md
│   ├── AI_DM.md
│   ├── DATA_SCHEMA.md
│   └── ROADMAP.md
│
└── docker-compose.yml
```

La struttura potrà essere semplificata durante la vertical slice.

---

# 24. Roadmap approvata

## Fase 0 — Vertical Slice

Obiettivo: validare il concetto.

Comprende:

- header telemetrico;
- tab;
- mappa;
- party;
- risorse;
- eventi e direttive;
- tre o più scelte;
- conseguenze;
- world state;
- flag;
- combattimento semplice;
- cronaca;
- sprite;
- AI-DM locale simulato.

## Fase 1 — Simulation Core

Costruire:

- entità;
- statistiche;
- inventario;
- tempo;
- eventi;
- flag;
- save/load;
- validazione regole.

## Fase 2 — Adventure Engine

Aggiungere:

- location graph;
- esplorazione;
- encounter;
- quest emergenti;
- world traversal;
- minacce.

## Fase 3 — AI-DM economico

Aggiungere:

- AI Gateway;
- state compression;
- memory retrieval;
- structured output;
- caching;
- validation layer.

## Fase 4 — Personaggi vivi

Aggiungere:

- memoria;
- relazioni;
- obiettivi;
- loyalty;
- fear;
- conflitti;
- mutamenti di comportamento.

## Fase 5 — Combat & Management

Aggiungere:

- equipaggiamento;
- status;
- morale;
- economia;
- crafting;
- tattica;
- specializzazioni.

## Fase 6 — Visual Generator

Aggiungere:

- sprite;
- ritratti;
- luoghi;
- asset AI;
- cache;
- versioning.

## Fase 7 — Creator / Data Layer

Aggiungere:

- editor JSON;
- modding;
- campagne;
- seed;
- generatori;
- strumenti di authoring.

## Fase 8 — MVP distributivo

Aggiungere:

- account;
- salvataggi cloud;
- packaging;
- analytics;
- gestione errori;
- aggiornamenti;
- strumenti amministrativi.

---

# 25. Vertical Slice — criteri di accettazione

La prima demo deve permettere di:

1. vedere un party;
2. vedere risorse;
3. vedere lo stato del mondo;
4. ricevere un evento;
5. scegliere fra almeno tre azioni;
6. modificare realmente alcuni parametri;
7. salvare flag derivanti dalla decisione;
8. riutilizzare quei flag in eventi futuri;
9. simulare un combattimento;
10. mostrare sprite procedurali;
11. visualizzare un Dungeon Master locale;
12. mostrare lo state JSON;
13. conservare una cronaca;
14. avere una UI coerente con la direzione artistica definitiva.

La vertical slice non deve essere una mockup statica.

---

# 26. Funzione obiettivo del prodotto

Massimizzare:

**AGENCY  
× EMERGENZA  
× PERSISTENZA  
× LEGGIBILITÀ  
× ATMOSFERA  
× REPLAYABILITY  
× DENSITÀ INFORMATIVA UTILE**

Minimizzare:

**COSTO AI  
× INCOERENZA  
× FEATURE CREEP  
× RUMORE VISIVO  
× DIPENDENZA DAL MODELLO  
× CONTENUTO PREFABBRICATO**

---

# 27. Ordine delle priorità

1. Decisioni con conseguenze reali.
2. Simulation Core.
3. Mondo persistente.
4. Gameplay gestionale.
5. Proceduralità.
6. UX e leggibilità.
7. Identità visiva.
8. AI Dungeon Master.
9. Generazione visuale.
10. Quantità di contenuti.

In caso di conflitto, usare questo ordine.

---

# 28. Anti-pattern di progetto

Evitare:

- AI che inventa statistiche;
- scelte puramente cosmetiche;
- falsa proceduralità;
- eventi totalmente casuali;
- mille sistemi superficiali;
- chat mascherata da videogioco;
- lore enorme prima del gameplay;
- dipendenza continua dall'API;
- rigenerazione inutile degli asset;
- feature creep;
- UI generica;
- complessità senza conseguenze;
- eccesso di parametri incomprensibili;
- overengineering prematuro;
- accoppiamento eccessivo fra UI e simulation core.

---

# 29. Principio di iterazione

Non costruire tutto contemporaneamente.

Per ogni iterazione:

1. identificare ciò che funziona;
2. congelarlo;
3. identificare massimo 3 problemi;
4. cercare la causa;
5. modificare soltanto i sistemi necessari;
6. eseguire regression check;
7. aggiungere una nuova dimensione di gameplay soltanto se aumenta il valore reale.

Non interpretare “migliorare” come “aggiungere”.

---

# 30. Criterio di successo

Dopo 5 minuti:

> “Ho preso decisioni che hanno modificato realmente questa campagna.”

Dopo 30 minuti:

> “Questo mondo sembra ricordarsi di quello che faccio.”

Nel medio periodo:

> “Sto costruendo una storia e un sistema che non avrei potuto ottenere identici in un'altra partita.”

---

# 31. Regole per le future AI che lavorano sul progetto

Ogni AI o agente deve:

1. leggere questa knowledge prima di proporre modifiche;
2. rispettare la separazione Simulation Core / World State / AI-DM / UI;
3. non trasformare il prodotto in una chat;
4. non aumentare la complessità senza un beneficio misurabile;
5. preservare le parti già approvate;
6. motivare ogni nuova feature in termini di agency, emergenza, persistenza, strategia o replayability;
7. mantenere l'AI economicamente sostenibile;
8. mantenere la UI coerente con la direzione artistica;
9. non introdurre dipendenze cloud non necessarie;
10. progettare per self-hosting sulla VPS;
11. mantenere GitHub come source of truth;
12. trattare OpenClaw/Clawbot come agente privato di sviluppo e operations;
13. preferire output strutturati e validabili;
14. applicare regression check dopo ogni revisione importante.

---

# 32. Decisioni già approvate

Sono da considerare approvate salvo revisione esplicita:

- uso della VPS privata;
- self-hosting;
- 6 CPU / 12 GB RAM / 200 GB SSD;
- Docker Compose;
- reverse proxy;
- backend applicativo;
- database PostgreSQL;
- API AI esterne per modelli pesanti;
- AI-DM economico;
- Simulation Core locale;
- GitHub come source of truth;
- Lovable come strumento di sviluppo rapido;
- OpenClaw/Clawbot come agente di sviluppo/DevOps privato;
- separazione AI-DM / agente DevOps;
- data-driven architecture;
- JSON come base parametrica;
- asset caching;
- generazione AI asincrona;
- UI hard-SF diegetica;
- sviluppo per vertical slice;
- priorità a conseguenze reali e persistenza.

---

# 33. Questioni ancora aperte

Da decidere nelle iterazioni successive:

- ambientazione definitiva;
- scala dominante: personaggio / party / insediamento / fazione;
- loop principale;
- livello di libertà narrativa;
- sistema di combattimento definitivo;
- distribuzione web vs desktop/Steam;
- modello AI da utilizzare;
- provider API;
- autenticazione;
- monetizzazione;
- sistema di salvataggio;
- multiplayer o solo single-player;
- frequenza della generazione visuale;
- editor/modding;
- strumenti amministrativi;
- osservabilità e analytics;
- backup applicativo;
- nome finale del prodotto.

---

# 34. Prossimo documento da creare

Il prossimo artefatto tecnico consigliato è:

**TECHNICAL_ROADMAP_v0.1.md**

Dovrà definire:

- stack preciso;
- Docker Compose;
- servizi;
- porte;
- struttura cartelle;
- schema database;
- schema JSON;
- Simulation Core API;
- AI-DM Gateway;
- memory retrieval;
- caching;
- sistema asset;
- sicurezza;
- workflow GitHub;
- workflow Lovable;
- workflow OpenClaw/Clawbot;
- CI/CD;
- deployment VPS;
- backup;
- logging;
- criteri di accettazione della prima release.

---

# 35. Principio finale

La forza del progetto non deve derivare dalla quantità di contenuto generato dall'AI.

Deve derivare dalla combinazione di:

**sistemi profondi + stato persistente + decisioni reali + AI contestuale + forte identità visiva.**

L'AI deve far percepire il mondo come vivo.

Il Simulation Core deve renderlo realmente coerente.


---

# 36. PRODUCT VISION LOCKED v1 — Aggiornamento 2026-08-16

La visione di prodotto è stata ulteriormente allineata tramite questionario.

Le decisioni dettagliate sono definite in:

`PRODUCT_VISION_LOCKED_v1.md`

Punti ora considerati approvati:

- priorità esperienza: sistema complesso > esplorazione > decisioni > storia;
- loop centrato su esplorazione + decisioni, con gestione e combattimento come secondo asse;
- progressione di scala micro → macro;
- sandbox target 7/10;
- sistema parametrico modulare ed espandibile;
- decisioni morali, strategiche, politiche e personali interconnesse;
- difficoltà selezionabile;
- mortalità/permadeath selezionabile;
- doppio modello di combattimento: party turn-based + eserciti strategici semi-automatici;
- AI con autonomia creativa elevata ma sempre validata dal Simulation Core;
- requisito local-first per un piccolo modello generativo;
- fallback procedurale obbligatorio;
- UI ad alta densità ma guidata;
- direzione visuale cinematografica + hard-sci-fi mission operating system;
- immagini grandi riservate a momenti/eventi importanti;
- image generation rinviata: per ora placeholder dichiarati nella UI;
- campagne Standard (5-10h), Estese (20-40h), Persistenti;
- mondo autonomo che evolve indipendentemente dal giocatore;
- personaggi con massima importanza narrativa e sistemica;
- pianificazione e conseguenze di lungo periodo;
- requisito critico anti-AI-slop.

In caso di conflitto interpretativo, `PRODUCT_VISION_LOCKED_v1.md` prevale sulle formulazioni più generiche di questo documento.


---

# 37. Platform & Local AI Architecture — Decisione 2026-08-16

La distribuzione è stata formalizzata in:

`PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`

Decisioni vincolanti aggiuntive:

- una sola codebase con build Web e Windows;
- React/TypeScript + Game Core condiviso;
- Tauri come contenitore Windows;
- PostgreSQL lato server e SQLite lato desktop;
- `llama.cpp` / `llama-server` come primo runtime locale da benchmarkare;
- piccolo modello GGUF incluso nella Windows Full Offline Edition;
- nome, quantizzazione e requisiti del modello NON fissati prima del benchmark P0;
- HTML mantenuto come demo/prototipo;
- RPG Maker MV e GameMaker non vengono adottati come core nella v1;
- AI server sulla VPS deve usare queue e non bloccare il Simulation Core;
- OpenClaw rimane privato e separato dal runtime pubblico;
- la fattibilità della VPS per un modello piccolo è considerata plausibile ma non ancora certificata finché non viene eseguito il benchmark P0.

In caso di conflitto, il documento di fattibilità più recente prevale sulle formulazioni precedenti relative a packaging, runtime AI e distribuzione.
