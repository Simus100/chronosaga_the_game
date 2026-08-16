# TECHNICAL ROADMAP v0.1
## Parametric AI Adventure Simulator

**Versione:** 0.1  
**Data:** 2026-08-16  
**Stato:** Specifica tecnica iniziale approvabile  
**Documento padre:** `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`

---

# 1. Scopo

Questo documento traduce la knowledge generale del progetto in una specifica tecnica concreta.

Obiettivi:

- definire lo stack;
- definire l'architettura runtime;
- definire la struttura del repository;
- definire i servizi Docker;
- definire database e persistenza;
- definire Simulation Core e API;
- definire AI Dungeon Master Gateway;
- definire memoria e context retrieval;
- definire asset pipeline;
- definire sicurezza;
- definire workflow con Lovable, GitHub e OpenClaw/Clawbot;
- definire CI/CD e deployment sulla VPS;
- definire criteri di accettazione della vertical slice;
- mantenere il sistema economico, self-hosted e scalabile.

Il principio guida resta:

> **Simulation Core deterministico + World State persistente + AI-DM contestuale + UI diegetica.**

---

# 2. Vincoli infrastrutturali approvati

VPS disponibile:

- **CPU:** 6 core
- **RAM:** 12 GB
- **Disco:** 200 GB SSD
- **Backup provider:** abilitato
- **Target iniziale:** alpha privata / MVP / piccoli gruppi di utenti
- **GPU dedicata:** non prevista

La VPS deve eseguire:

- frontend;
- backend;
- Simulation Core;
- PostgreSQL;
- reverse proxy;
- storage asset;
- cache;
- job queue leggera;
- logging essenziale;
- OpenClaw/Clawbot in area privata.

La VPS non deve eseguire:

- LLM pesanti;
- modelli image generation pesanti;
- video generation;
- workload GPU-intensive.

Questi servizi devono essere esterni e chiamati tramite API.

---

# 3. Stack tecnico proposto

## 3.1 Frontend

**React + TypeScript + Vite**

Motivazioni:

- compatibile con workflow Lovable;
- bundle leggero;
- ottima velocità di sviluppo;
- facile integrazione con UI custom;
- adatto a dashboard/game UI molto dense;
- semplice self-hosting.

### UI

Preferire:

- CSS custom;
- CSS variables;
- componenti proprietari;
- SVG;
- Canvas 2D;
- eventualmente WebGL soltanto quando necessario.

Usare Tailwind solo se già introdotto da Lovable, ma non lasciare che determini il linguaggio visivo finale.

### Evitare

- design system SaaS preconfezionati;
- dipendenza forte da component library visualmente riconoscibili;
- UI mobile-first come priorità iniziale.

Target iniziale:

> **desktop-first 1440p, responsivo fino a laptop standard.**

---

# 4. Backend

**Node.js + TypeScript**

Framework consigliato:

**Fastify**

Responsabilità:

- API REST;
- orchestrazione Simulation Core;
- autenticazione futura;
- save/load;
- accesso al database;
- AI Gateway;
- asset jobs;
- world state;
- validazione;
- logging;
- health check.

Il backend NON contiene la logica principale del gioco direttamente.

La logica deve vivere nel package:

`packages/simulation-core`

---

# 5. Database

## PostgreSQL

PostgreSQL è il database principale.

Motivi:

- robusto;
- adatto a dati relazionali;
- JSONB disponibile;
- semplice da eseguire sulla VPS;
- adatto a snapshot + log eventi;
- buona base per analytics futuri.

## ORM / query layer

Preferenza iniziale:

**Drizzle ORM**

Motivazioni:

- leggero;
- TypeScript-first;
- controllo SQL chiaro;
- adatto a schemi relativamente strutturati.

Prisma resta alternativa valida se lo sviluppo Lovable produce integrazioni già orientate in quella direzione.

---

# 6. Strategia dati

Non salvare l'intero mondo come un unico blob JSON.

Usare una strategia ibrida:

## Tabelle strutturate

Per:

- users;
- campaigns;
- characters;
- factions;
- locations;
- quests;
- saves;
- generated_assets.

## JSONB

Per:

- stats dinamiche;
- traits;
- memoria;
- metadata;
- stato evento;
- flag locali;
- parametri di generazione.

## Event log

Registrare ogni cambiamento importante come evento.

Esempio:

```json
{
  "type": "RESOURCE_CHANGED",
  "turn": 428,
  "campaign_id": "cmp_01",
  "entity_id": "party_01",
  "payload": {
    "resource": "food",
    "before": 18,
    "after": 12,
    "reason": "bridge_expedition"
  }
}
```

Questa struttura permette:

- replay;
- debug;
- cronaca;
- audit;
- analytics;
- ricostruzione delle conseguenze;
- eventuale rewind limitato.

---

# 7. Schema database iniziale

## users

```text
id
email
display_name
created_at
updated_at
```

Per la vertical slice l'autenticazione può non essere implementata.

---

## campaigns

```text
id
user_id
name
seed
status
current_turn
current_time
difficulty
world_pressure
created_at
updated_at
```

---

## characters

```text
id
campaign_id
template_id
name
role
location_id
faction_id
health
stress
morale
loyalty
status
stats_json
traits_json
memory_json
goals_json
equipment_json
visual_asset_id
created_at
updated_at
```

---

## factions

```text
id
campaign_id
name
type
power
wealth
stability
relation_player
state_json
created_at
updated_at
```

---

## locations

```text
id
campaign_id
template_id
name
type
region
danger
discovered
state_json
created_at
updated_at
```

---

## quests

```text
id
campaign_id
template_id
title
status
stage
giver_id
location_id
state_json
created_at
updated_at
```

---

## world_flags

```text
id
campaign_id
scope
scope_id
key
value_json
created_at
updated_at
```

---

## event_log

```text
id
campaign_id
turn
event_type
source
entity_type
entity_id
payload_json
created_at
```

---

## generated_assets

```text
id
campaign_id
entity_type
entity_id
asset_type
provider
prompt_hash
file_path
status
metadata_json
created_at
updated_at
```

---

## ai_calls

Solo per diagnostica e cost monitoring.

```text
id
campaign_id
provider
model
purpose
input_tokens
output_tokens
latency_ms
cost_estimate
cache_hit
created_at
```

Non salvare dati sensibili o prompt inutilmente completi se non servono.

---

# 8. Simulation Core

Percorso:

```text
packages/simulation-core/
```

Il Simulation Core deve essere indipendente da:

- React;
- HTTP;
- database;
- provider AI;
- Lovable;
- OpenClaw.

Deve poter essere testato con semplici input/output.

---

# 9. Moduli del Simulation Core

Struttura proposta:

```text
simulation-core/
├── index.ts
├── state/
│   ├── world.ts
│   ├── campaign.ts
│   ├── party.ts
│   └── character.ts
├── events/
│   ├── resolver.ts
│   ├── selector.ts
│   ├── prerequisites.ts
│   └── consequences.ts
├── combat/
│   ├── resolver.ts
│   ├── initiative.ts
│   └── effects.ts
├── economy/
│   ├── resources.ts
│   ├── prices.ts
│   └── production.ts
├── relationships/
│   ├── graph.ts
│   └── updates.ts
├── time/
│   └── clock.ts
├── rules/
│   ├── validation.ts
│   └── constants.ts
├── rng/
│   └── seeded-rng.ts
└── types/
    └── index.ts
```

---

# 10. Determinismo e seed

Ogni campagna possiede un seed.

L'RNG deve essere seed-based.

Obiettivi:

- riproducibilità;
- debug;
- test;
- replay;
- confronto fra versioni.

Input che devono contribuire al random deterministico:

- campaign seed;
- turn;
- entity ID;
- event ID;
- local salt.

L'AI non deve essere usata per determinare risultati casuali critici.

---

# 11. Event Engine

Pipeline:

```text
WORLD STATE
   ↓
ELIGIBILITY FILTER
   ↓
PREREQUISITE CHECK
   ↓
WEIGHT CALCULATION
   ↓
SEEDED SELECTION
   ↓
EVENT INSTANCE
   ↓
PLAYER CHOICE
   ↓
VALIDATION
   ↓
CONSEQUENCE RESOLVER
   ↓
STATE DELTA
   ↓
EVENT LOG
   ↓
AI NARRATION
```

L'AI arriva **dopo** la risoluzione o prima solo per descrivere/proporre, mai per sostituire il resolver.

---

# 12. Formato evento base

```json
{
  "id": "evt_bridge_memory",
  "version": 1,
  "category": "exploration",
  "tags": ["mystery", "social"],
  "weight": 1.2,
  "requirements": {
    "locations": ["ruins"],
    "min_turn": 3,
    "flags_all": [],
    "flags_none": ["bridge_destroyed"],
    "min_resources": {
      "food": 1
    }
  },
  "choices": [
    {
      "id": "investigate",
      "label": "Indaga",
      "cost": {
        "food": 1
      },
      "effects": [
        {
          "type": "FLAG_SET",
          "key": "bridge_memory",
          "value": true
        }
      ]
    }
  ]
}
```

---

# 13. State Delta

Ogni azione deve produrre un delta esplicito.

Formato:

```json
{
  "turn": 24,
  "source": "event_choice",
  "changes": [
    {
      "type": "resource",
      "id": "food",
      "before": 8,
      "after": 7
    },
    {
      "type": "flag",
      "id": "bridge_memory",
      "before": false,
      "after": true
    }
  ]
}
```

Questo delta alimenta:

- UI;
- cronaca;
- AI-DM;
- event log;
- debug;
- analytics.

---

# 14. AI Dungeon Master Gateway

Percorso:

```text
packages/ai-dm/
```

Responsabilità:

- costruire il contesto;
- scegliere il provider;
- inviare richiesta;
- validare output;
- applicare fallback;
- cache;
- tracciare costi;
- non modificare direttamente il World State.

---

# 15. Interfaccia provider AI

Definire un adapter.

```ts
interface AIDMProvider {
  generateNarration(input: AIDMInput): Promise<AIDMOutput>;
}
```

Questo permette di sostituire in futuro:

- provider;
- modello;
- endpoint;
- modello locale leggero;
- mock locale.

Il gameplay non deve conoscere il provider.

---

# 16. AIDM Input

Formato iniziale:

```json
{
  "campaign": {
    "turn": 128,
    "location": "black_ridge",
    "world_pressure": 4
  },
  "party": [
    {
      "id": "ira_0021",
      "role": "cartographer",
      "health": 61,
      "stress": 72,
      "relevant_traits": ["analytical", "suspicious"]
    }
  ],
  "relevant_memory": [
    "ira_suspects_player",
    "warden_captain_dead"
  ],
  "recent_delta": [],
  "event": {},
  "player_action": "investigate"
}
```

---

# 17. AIDM Output

```json
{
  "narration": "",
  "dialogue": [],
  "event_proposals": [],
  "memory_updates": [],
  "visual_prompt": null,
  "tags": []
}
```

L'output deve essere validato tramite schema.

Se fallisce:

1. tentare repair JSON locale;
2. se ancora invalido, ignorare i campi non validi;
3. usare fallback procedurale;
4. non bloccare la partita.

---

# 18. Fallback AI

Il gioco deve funzionare anche con API AI non disponibile.

Fallback:

```text
AI disponibile
   ↓ no
template procedurale
   ↓
evento continua normalmente
```

Mai mostrare al giocatore un errore tecnico del provider come blocco del gameplay.

La UI può degradare dalla narrazione generativa a una descrizione procedurale.

---

# 19. Memory Retrieval

Non inviare tutta la cronologia.

La memoria deve essere multilivello.

## Livello 1 — Current State

Sempre disponibile.

## Livello 2 — Recent Delta

Ultimi turni rilevanti.

## Livello 3 — Entity Memory

Solo memoria dei personaggi coinvolti.

## Livello 4 — Campaign Summary

Riassunto compresso della campagna.

## Livello 5 — Semantic Retrieval

Da implementare solo quando serve realmente.

Per la vertical slice non serve vector database.

Prima versione:

- tag;
- entity IDs;
- recency;
- importance score.

---

# 20. Memory Score

Esempio:

```text
score =
importance * 0.50
+ relevance * 0.30
+ recency * 0.20
```

Inviare al modello solo le memorie con score più alto.

Target iniziale:

- massimo 5-12 memory items per chiamata;
- recent history estremamente compatta;
- niente intere trascrizioni della partita.

---

# 21. Caching AI

Cache key:

```text
provider
+ model
+ event_type
+ state_signature
+ character_signature
+ narrative_variant
```

Non usare cache quando la risposta deve contenere dati altamente specifici o unici.

Usare cache soprattutto per:

- descrizioni ambientali;
- microtesti;
- varianti di sistema;
- eventi generici;
- flavor text.

---

# 22. Asset Pipeline

Tipi:

- sprite;
- portrait;
- location;
- item;
- creature;
- special-event image.

Pipeline:

```text
ENTITY CREATED
   ↓
placeholder procedural
   ↓
visual job queued
   ↓
external image API
   ↓
validation
   ↓
local storage
   ↓
asset ID saved
   ↓
UI refresh
```

Il gioco non attende l'immagine.

---

# 23. Asset Storage

Prima fase:

```text
/var/lib/game/assets/
```

Suddivisione:

```text
assets/
├── portraits/
├── sprites/
├── locations/
├── creatures/
├── items/
└── temp/
```

Database salva:

- path;
- hash;
- provider;
- prompt hash;
- entity ID;
- metadata.

In futuro è possibile migrare a object storage senza cambiare l'API pubblica.

---

# 24. API backend iniziale

Prefix:

```text
/api/v1
```

## Health

```text
GET /health
```

## Campaign

```text
POST /campaigns
GET /campaigns/:id
POST /campaigns/:id/save
POST /campaigns/:id/load
```

## State

```text
GET /campaigns/:id/state
GET /campaigns/:id/log
```

## Turn

```text
POST /campaigns/:id/advance
```

## Event

```text
GET /campaigns/:id/event/current
POST /campaigns/:id/event/:eventId/choice
```

## Combat

```text
POST /campaigns/:id/combat/start
POST /campaigns/:id/combat/action
GET  /campaigns/:id/combat/:combatId
```

## Character

```text
GET /campaigns/:id/characters
GET /campaigns/:id/characters/:characterId
```

## AI

Non esporre endpoint provider direttamente al browser.

```text
POST /internal/ai/narrate
```

Solo backend → AI Gateway.

---

# 25. Validazione

Usare schema validation su:

- request API;
- JSON game data;
- AI output;
- environment variables;
- event definitions.

Preferenza:

**Zod**

I dati non validi devono fallire in modo esplicito durante sviluppo/build, non produrre comportamento silenzioso.

---

# 26. Frontend architecture

Struttura:

```text
apps/web/src/
├── app/
├── components/
│   ├── telemetry/
│   ├── directives/
│   ├── maps/
│   ├── entities/
│   ├── combat/
│   └── terminal/
├── features/
│   ├── campaign/
│   ├── party/
│   ├── events/
│   ├── map/
│   ├── factions/
│   └── chronicle/
├── stores/
├── api/
├── styles/
└── assets/
```

---

# 27. State management frontend

Preferenza:

**Zustand** o store equivalente leggero.

Separare:

- remote server state;
- ephemeral UI state.

Non duplicare World State completo nel frontend come fonte autoritativa.

Il server è la fonte autorevole.

---

# 28. Design System tecnico

Componenti base:

- `TelemetryValue`
- `TelemetryStrip`
- `SystemStatus`
- `DataGrid`
- `EntityTile`
- `EntityInspector`
- `DirectivePanel`
- `Timeline`
- `ResourceBar`
- `MiniGraph`
- `RelationshipGraph`
- `MapNode`
- `MapViewport`
- `WarningBanner`
- `TerminalLog`
- `MissionPanel`
- `AIEventIndicator`
- `CharacterPortrait`
- `CombatTelemetry`
- `CommandStrip`
- `TabStrip`

Ogni componente deve utilizzare token visuali centrali.

---

# 29. Design Tokens

Definire almeno:

```text
--bg-0
--bg-1
--bg-2
--line
--line-active
--text-primary
--text-secondary
--cyan
--cyan-muted
--amber
--red
--green
--magenta
--font-mono
--font-size-xs
--font-size-sm
--font-size-md
--spacing-1 ...
```

Niente colori hardcoded sparsi nei componenti.

---

# 30. Realtime

Per la prima release NON serve WebSocket.

Usare normale REST.

Aggiungere WebSocket/SSE solo per:

- multiplayer;
- job AI lunghi;
- asset generation live;
- eventi server-side asincroni.

Per asset generation può bastare polling leggero nella fase iniziale.

---

# 31. Docker Compose

Servizi pubblici e applicativi:

```yaml
services:
  reverse-proxy:
  web:
  api:
  db:
```

Servizi opzionali:

```yaml
  redis:
  worker:
```

OpenClaw/Clawbot deve essere gestito separatamente o su rete privata, non esposto nello stesso piano pubblico.

---

# 32. Layout Docker VPS

```text
/opt/parametric-game/
├── compose.yml
├── .env
├── nginx/
├── app/
├── volumes/
│   ├── postgres/
│   └── assets/
└── backups/
```

---

# 33. Porte

Pubbliche:

```text
80  → redirect HTTPS
443 → reverse proxy
```

Non pubbliche:

```text
web: 3000
api: 3001
postgres: 5432
redis: 6379
```

Le porte interne devono stare nella Docker network e non essere bindate pubblicamente.

---

# 34. Reverse Proxy

Nginx o Caddy.

Responsabilità:

- HTTPS;
- routing;
- compression;
- static caching;
- security headers;
- request size limit;
- rate limiting base.

Schema:

```text
/        → web
/api/    → api
/assets/ → asset storage / backend
```

---

# 35. Environment Variables

Esempio:

```text
NODE_ENV=
APP_URL=
DATABASE_URL=
SESSION_SECRET=

AI_PROVIDER=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=
AI_MAX_TOKENS=

IMAGE_PROVIDER=
IMAGE_API_KEY=

ASSET_ROOT=
LOG_LEVEL=
```

Mai committare `.env`.

Creare:

```text
.env.example
```

senza credenziali.

---

# 36. Sicurezza applicativa

Minimo richiesto:

- HTTPS;
- secrets fuori da Git;
- DB non esposto;
- rate limiting;
- payload validation;
- output escaping;
- CORS ristretto;
- request size limit;
- CSP progressiva;
- dependency scanning;
- backup;
- health check;
- least privilege.

---

# 37. Sicurezza OpenClaw / Clawbot

Regole obbligatorie:

- non esporlo su Internet;
- non eseguirlo come root permanente;
- utente Linux dedicato;
- accesso solo a directory necessarie;
- repository separato dai secrets runtime;
- niente accesso diretto al database production se non strettamente necessario;
- preferire deploy tramite script approvati;
- log delle operazioni importanti;
- SSH/VPN/rete privata per accesso.

OpenClaw/Clawbot è un **agente DevOps**, non una parte pubblica del gioco.

---

# 38. GitHub come source of truth

Branch iniziali:

```text
main
develop
feature/*
fix/*
```

Regola:

- `main` = produzione;
- `develop` = integrazione;
- feature branch per cambiamenti importanti.

Per un team molto piccolo è possibile semplificare, ma `main` deve rimanere stabile.

---

# 39. Workflow Lovable

Lovable deve lavorare principalmente su:

- UI;
- componenti;
- layout;
- UX;
- prototipi;
- frontend.

Regole:

1. sincronizzare con GitHub;
2. lavorare su branch dedicato quando possibile;
3. non riscrivere il Simulation Core;
4. non introdurre backend paralleli senza approvazione;
5. non sostituire PostgreSQL o API architecture implicitamente;
6. preservare design tokens;
7. preservare il DNA visivo approvato.

Prima di accettare cambiamenti Lovable:

- diff;
- test;
- regression check.

---

# 40. Workflow OpenClaw / Clawbot

Clawbot può:

- leggere issue/task;
- creare branch;
- modificare codice;
- eseguire test;
- eseguire lint;
- creare build;
- preparare commit;
- controllare log;
- eseguire deploy tramite script.

Non deve:

- modificare `main` direttamente senza controllo;
- cambiare schema DB senza migration;
- leggere secrets non necessari;
- cancellare volumi;
- eseguire comandi distruttivi non previsti;
- cambiare architettura fondamentale senza task esplicito.

---

# 41. Handoff Lovable ↔ Clawbot

Per evitare conflitti:

```text
SPECIFICA
   ↓
ISSUE / TASK
   ↓
BRANCH
   ↓
LOVABLE oppure CLAWBOT
   ↓
COMMIT
   ↓
TEST
   ↓
REVIEW
   ↓
MERGE
```

Mai far lavorare due agenti contemporaneamente sugli stessi file senza branch separati.

---

# 42. CI

GitHub Actions iniziale:

```text
install
↓
typecheck
↓
lint
↓
unit tests
↓
build web
↓
build api
```

Merge in `main` solo se tutto passa.

---

# 43. CD

Deployment semplice iniziale:

```text
main updated
   ↓
SSH VPS
   ↓
git pull / image pull
   ↓
docker compose build
   ↓
docker compose up -d
   ↓
health check
```

Successivamente:

- Docker registry;
- immutable images;
- rollback automatico.

Per la prima release tenere la pipeline semplice.

---

# 44. Backup

Non affidarsi soltanto al backup del provider.

Implementare:

## PostgreSQL

Backup giornaliero:

```text
pg_dump
```

Retention iniziale:

- 7 daily;
- 4 weekly.

## Assets

Backup incrementale o copia periodica.

## Config

Conservare:

- compose;
- migration;
- nginx;
- scripts;

nel repository.

Mai salvare secrets nel repository.

---

# 45. Logging

Prima fase:

- stdout Docker;
- rotating logs;
- log applicativi strutturati.

Campi:

```text
timestamp
level
service
campaign_id
request_id
event
duration_ms
```

Non loggare:

- API keys;
- password;
- token di sessione;
- prompt completi se contengono dati non necessari.

---

# 46. Monitoring

MVP:

- `/health`;
- Docker health checks;
- disk usage;
- RAM;
- CPU;
- PostgreSQL availability;
- API latency;
- AI provider failure rate.

In futuro:

- Prometheus;
- Grafana;
- Sentry o equivalente.

Non introdurre monitoring complesso prima che serva.

---

# 47. Worker / Job Queue

Per la vertical slice può non servire.

Quando entra image generation:

```text
api
 ↓
job table / Redis queue
 ↓
worker
 ↓
image provider
 ↓
asset storage
```

Se il volume è basso, iniziare con una semplice tabella `jobs` nel database.

Redis deve essere aggiunto solo quando porta vantaggio reale.

---

# 48. Performance target MVP

Target indicativi:

- UI interaction: percezione immediata;
- API normali: < 200-300 ms quando possibile;
- advance turn senza AI: < 250 ms;
- AI narration: asincrona o timeout controllato;
- save: < 1 s;
- caricamento campagna iniziale: < 2 s su connessione normale.

La simulazione non deve aspettare l'AI.

---

# 49. AI timeout

Regola:

```text
simulation result
   ↓
UI aggiornata
   ↓
AI narrative requested
```

Timeout iniziale:

```text
5-10 secondi
```

Se fallisce:

- fallback procedurale;
- nessun rollback del turno.

---

# 50. Cost Control AI

Registrare per chiamata:

- provider;
- model;
- input token;
- output token;
- latency;
- cache hit;
- purpose;
- cost estimate.

Budget control futuro:

```text
max_ai_cost_per_campaign
max_ai_calls_per_minute
max_ai_calls_per_turn
```

La qualità del gioco non deve crescere linearmente con la spesa API.

---

# 51. Vertical Slice tecnica

La prima vertical slice deve avere:

## Frontend

- telemetry header;
- tab navigation;
- map viewport;
- party panel;
- resource panel;
- directive panel;
- event choice UI;
- chronicle;
- character inspector;
- command strip;
- world-state debug panel nascosto o dev-only.

## Backend

- campaign state;
- event engine;
- choices;
- consequence resolver;
- simple combat;
- save/load;
- event log.

## AI

- mock AI-DM locale;
- adapter interface;
- fallback narrative.

## Persistence

Prima versione può usare PostgreSQL subito.

---

# 52. Vertical Slice — User Flow

```text
NEW CAMPAIGN
↓
seed world
↓
show command screen
↓
advance turn
↓
event selected
↓
directive appears
↓
player choice
↓
simulation resolves
↓
state delta
↓
UI updates
↓
AI narrates
↓
chronicle stores result
↓
next turn
```

Questo è il core loop che deve essere validato prima di espandere il gioco.

---

# 53. Save Model

Salvare:

- current campaign state;
- event log;
- current RNG state/turn;
- entity state;
- active flags;
- asset references.

Per evitare corruzione:

```text
transaction
→ state update
→ event log
→ commit
```

Se la transazione fallisce, il turno non deve essere considerato completato.

---

# 54. Versioning dati

Ogni template JSON deve avere:

```json
{
  "id": "...",
  "version": 1
}
```

Le campagne devono salvare anche la versione del ruleset.

Questo permette migration future.

---

# 55. Modding futuro

La struttura data-driven deve consentire in futuro:

- nuovi eventi;
- nuovi personaggi;
- nuove fazioni;
- nuove location;
- nuove campagne;
- nuovi ruleset.

Non costruire l'editor mod nella prima release.

Prima rendere stabile lo schema.

---

# 56. Test Strategy

## Unit test

Simulation Core:

- resource changes;
- prerequisites;
- RNG;
- event selection;
- combat;
- flags;
- relationships.

## Integration test

- API → Simulation Core;
- DB transaction;
- event resolution;
- save/load.

## Regression test

Ogni bug importante deve produrre un test.

## Golden tests

Per seed noti:

```text
seed X + turn Y + state Z
→ expected event/result
```

Molto utili per il motore parametrico.

---

# 57. Dev Mode

Prevedere una modalità sviluppatore.

Funzioni:

- mostra world state;
- modifica turn;
- forza evento;
- forza flag;
- cambia risorsa;
- inspect character;
- inspect RNG seed;
- export save JSON;
- import save JSON.

Questa modalità è essenziale per bilanciamento e debugging.

Non deve essere disponibile ai normali giocatori in produzione.

---

# 58. Prima milestone

## M0 — Repository Bootstrap

Deliverable:

- monorepo;
- web;
- api;
- simulation-core;
- shared types;
- Docker Compose;
- PostgreSQL;
- reverse proxy dev;
- lint;
- tests;
- README.

Acceptance:

- tutto avviabile con un singolo comando;
- health check OK;
- frontend comunica con backend;
- DB migration funzionante.

---

# 59. Milestone M1 — Simulation Skeleton

Deliverable:

- campaign seed;
- world state;
- party;
- resources;
- flags;
- event definitions;
- event resolver;
- event log.

Acceptance:

- 50 turni automatici senza crash;
- risultati riproducibili a seed identico;
- nessun accesso AI richiesto.

---

# 60. Milestone M2 — UI Vertical Slice

Deliverable:

- UI hard-SF;
- telemetry;
- map viewport;
- directives;
- party;
- resources;
- chronicle;
- tabs;
- command strip.

Acceptance:

- il giocatore completa almeno 10 turni;
- ogni scelta produce feedback leggibile;
- la UI non appare come dashboard SaaS o chatbot.

---

# 61. Milestone M3 — Persistence

Deliverable:

- save;
- load;
- PostgreSQL;
- campaign list;
- event log persistente.

Acceptance:

- chiudere server;
- riavviare;
- riprendere esattamente la campagna.

---

# 62. Milestone M4 — AI-DM Integration

Deliverable:

- provider adapter;
- context builder;
- structured output;
- timeout;
- fallback;
- AI cost log.

Acceptance:

- assenza API non blocca gameplay;
- AI non può cambiare direttamente statistiche;
- output invalido non corrompe la campagna.

---

# 63. Milestone M5 — Private VPS Alpha

Deliverable:

- HTTPS;
- production compose;
- backup;
- logging;
- deployment;
- basic security.

Acceptance:

- accessibile tramite dominio;
- DB non esposto;
- HTTPS valido;
- backup verificato;
- deploy ripetibile.

---

# 64. Milestone M6 — Visual Asset Generation

Deliverable:

- asset jobs;
- placeholder;
- provider adapter;
- local cache;
- entity binding.

Acceptance:

- il gioco non aspetta la generazione;
- asset riutilizzato dopo la prima generazione;
- fallimento provider non rompe UI.

---

# 65. Milestone M7 — Closed MVP

Deliverable:

- campagna giocabile;
- progression;
- combat;
- relationships;
- factions;
- quest/emergent events;
- AI-DM;
- persistent assets.

Acceptance:

- sessione 30-60 minuti;
- scelte con effetti osservabili;
- almeno una conseguenza ritardata;
- almeno una relazione che cambia;
- almeno un evento generato dallo stato precedente.

---

# 66. Ordine di implementazione consigliato

Non iniziare da AI o image generation.

Ordine:

```text
1. repository
2. simulation core
3. JSON schema
4. event resolver
5. persistence
6. UI vertical slice
7. save/load
8. AI-DM mock
9. AI API
10. asset generation
11. content expansion
12. balancing
```

---

# 67. Cose da NON implementare nella prima fase

- multiplayer;
- PvP;
- mobile app;
- Steam integration;
- mod editor;
- complex crafting;
- fully tactical grid combat;
- voice synthesis;
- video generation;
- vector database;
- Kubernetes;
- microservices;
- dedicated message broker;
- elaborate analytics stack;
- custom LLM hosting.

---

# 68. Monolite modulare

Per la VPS e per il team iniziale usare:

> **monolite modulare**

Non microservizi.

Separazione tramite package e moduli, non tramite decine di servizi.

Motivo:

- meno RAM;
- meno DevOps;
- meno failure modes;
- più facile debug;
- più facile per Lovable/Clawbot;
- deployment semplice.

In futuro i componenti ad alto carico possono essere estratti.

---

# 69. Strategia di scalabilità

Prima scala verticalmente sulla VPS.

Se il prodotto cresce:

## Step 1

Separare worker AI.

## Step 2

Object storage.

## Step 3

DB gestito o VPS DB dedicata.

## Step 4

Replica frontend/API.

## Step 5

Queue dedicata.

Non anticipare questi costi.

---

# 70. Definition of Done per ogni feature

Una feature è completata solo quando:

- requisito chiaro;
- codice implementato;
- typecheck passa;
- test passa;
- nessun errore console;
- UI coerente;
- state changes validati;
- logging sufficiente;
- nessun secret introdotto;
- documentazione aggiornata se serve;
- regression check completato.

---

# 71. Template task per Lovable / Clawbot

Ogni task importante deve contenere:

```text
TITLE

GOAL
Cosa deve cambiare.

CONTEXT
Perché esiste.

FILES / MODULES
Area da modificare.

MUST HAVE
Requisiti obbligatori.

DO NOT CHANGE
Elementi da preservare.

ACCEPTANCE CRITERIA
Come verificare il successo.

TEST
Test richiesti.

OUTPUT
Commit / file / schermata / endpoint.
```

Questo riduce drasticamente la deriva degli agenti.

---

# 72. Regola architetturale non negoziabile

Nessun agente deve trasformare:

```text
AI-DM
```

in:

```text
AI controls game state directly
```

Flusso obbligatorio:

```text
AI proposes
↓
validator
↓
simulation core
↓
state delta
↓
persistence
```

---

# 73. Regola visiva non negoziabile

Ogni nuova schermata deve rispettare:

- black dominant;
- cyan/teal operational;
- amber semantic;
- mono typography;
- dense but hierarchical;
- sharp geometry;
- mission-control feel;
- data-driven visuals;
- no SaaS cards;
- no chatbot layout.

---

# 74. Regola costi non negoziabile

Prima di aggiungere una chiamata AI chiedere:

> Questa chiamata produce un valore che non possiamo ottenere con una regola, un template o una cache?

Se la risposta è no, non usare l'AI.

---

# 75. Roadmap immediata operativa

## Step A

Creare repository GitHub.

## Step B

Creare monorepo.

## Step C

Creare Docker Compose dev.

## Step D

Avviare PostgreSQL.

## Step E

Implementare seed + campaign state.

## Step F

Portare la demo visuale nel frontend React.

## Step G

Implementare event schema.

## Step H

Implementare event resolver.

## Step I

Collegare scelte → state delta.

## Step J

Persistenza DB.

## Step K

AI-DM mock.

## Step L

Deploy VPS alpha.

Solo dopo:

- provider AI reale;
- image generation;
- contenuto espanso.

---

# 76. Prima struttura GitHub consigliata

```text
parametric-ai-adventure/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── simulation-core/
│   ├── ai-dm/
│   ├── game-data/
│   ├── shared-types/
│   └── ui-system/
├── data/
├── assets/
├── infra/
├── docs/
├── tests/
├── .github/
│   └── workflows/
├── .env.example
├── compose.yml
├── package.json
├── README.md
└── pnpm-workspace.yaml
```

Package manager consigliato:

**pnpm**

---

# 77. Primo comando target

L'obiettivo del bootstrap è arrivare a:

```bash
docker compose up -d
pnpm install
pnpm dev
```

e ottenere:

```text
web      → running
api      → healthy
postgres → healthy
```

---

# 78. Prima release tecnica

Nome interno:

**v0.1 Vertical Slice**

Deve dimostrare soltanto:

- che il Simulation Core funziona;
- che il mondo conserva stato;
- che le scelte hanno conseguenze;
- che la UI comunica bene lo stato;
- che l'AI può essere aggiunta senza governare il motore;
- che tutto gira sulla VPS.

Se questi punti funzionano, il progetto è tecnicamente validato.

---

# 79. Criterio finale di architettura

La struttura corretta deve permettere tre scenari:

## Scenario A — AI offline

Il gioco continua.

## Scenario B — Image API offline

Il gioco continua con placeholder.

## Scenario C — Lovable/OpenClaw non disponibili

Il gioco in produzione continua.

Questo garantisce che nessun servizio di sviluppo o generativo diventi un single point of failure del gameplay.

---

# 80. Principio conclusivo

Il vantaggio competitivo del progetto non deve essere:

> “usa l'AI”.

Deve essere:

> **“simula un mondo persistente e sistemico, e utilizza l'AI soltanto dove aumenta davvero la sensazione che quel mondo sia vivo.”**

Questa architettura è la base tecnica da mantenere nelle prossime iterazioni.


---

# 81. PRODUCT VISION LOCKED v1 — Impatto tecnico

Il questionario di allineamento introduce i seguenti requisiti tecnici obbligatori:

## Campaign configuration

Aggiungere al modello campagna:

```text
difficulty_profile
mortality_profile
campaign_length_profile
ai_mode
simulation_depth
```

## World autonomy

Prevedere un `world tick` capace di far evolvere in autonomia:

- fazioni;
- territori;
- economia;
- personaggi;
- relazioni;
- minacce;
- insediamenti.

## Micro → Macro

Il dominio deve supportare sia:

- party / personaggi;
- unità;
- insediamenti;
- fazioni;
- eserciti;
- territori.

Senza obbligare la prima vertical slice a implementare tutta la macro-scala.

## Combat

Prevedere due resolver separabili:

```text
party-combat/
strategic-conflict/
```

## Long-term consequences

Il sistema eventi deve supportare:

- delayed effects;
- scheduled consequences;
- dormant flags;
- memory triggers;
- faction reactions;
- world-state implications.

## Local AI

L'AI layer deve astrarre almeno:

```text
LocalModelProvider
CloudModelProvider
ProceduralFallbackProvider
```

Il modello specifico e il runtime NON sono ancora fissati: devono essere scelti mediante benchmark reali su VPS e client target.

## Visual assets

Nella fase corrente:

- creare slot UI;
- asset IDs;
- placeholder;
- stato `not_generated`.

Non integrare ancora un provider immagini.

## Campaign duration

La durata selezionata deve poter modificare parametri di ritmo e simulazione, non semplicemente la durata massima.

Profili:

```text
standard
extended
persistent
```

## Anti-AI-slop

Introdurre successivamente:

- style rules;
- content validators;
- repetition detection;
- memory grounding;
- event diversity checks;
- cliché/duplicate controls.

Il documento `PRODUCT_VISION_LOCKED_v1.md` è da considerare requisito di prodotto per tutte le milestone successive.


---

# 82. Web + Windows + Local Model — Implementation Track

Aggiungere alle milestone un percorso di fattibilità P0 prima dell'espansione massiva dei contenuti.

## P0-A — Desktop shell

- `apps/desktop`;
- Tauri;
- riuso React UI;
- SQLite adapter;
- build Windows x64.

## P0-B — Local AI

- `llama-server` sidecar;
- GGUF resource;
- bind 127.0.0.1;
- health check;
- lifecycle start/stop;
- `LocalModelProvider`.

## P0-C — Server AI benchmark

Sulla VPS 6 CPU / 12 GB:

- test classe 1.5B–2B Q4/Q5;
- test 3B solo come candidato;
- misurare RAM, CPU, startup, tokens/sec, queue e context;
- non promettere concorrenza finché non misurata.

## P0-D — Build targets

Mantenere:

```text
web
desktop-full-offline
html-demo
```

La build `desktop-full-offline` deve includere un modello Lite di default prima della release pubblica.

## P0-E — Platform adapters

Formalizzare:

```text
PersistenceAdapter
AIAdapter
AssetAdapter
```

con implementazioni Web e Desktop.

Il Game Core deve rimanere completamente indipendente dagli adapter.
