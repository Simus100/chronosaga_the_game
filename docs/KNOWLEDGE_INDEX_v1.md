# KNOWLEDGE INDEX v1
## Chronosaga: The Game

**Data:** 2026-08-16

I documenti seguenti costituiscono la Knowledge di progetto.

## 1. `PRODUCT_VISION_LOCKED_v1.md`
Fonte principale per:
- identità del prodotto;
- priorità;
- micro → macro;
- sandbox;
- personaggi;
- difficoltà;
- combattimento;
- durata campagne;
- anti-AI-slop.

## 2. `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`
Fonte generale per:
- architettura concettuale;
- AI-DM;
- UI;
- VPS;
- workflow;
- roadmap generale;
- decisioni approvate.

## 3. `TECHNICAL_ROADMAP_v0.1.md`
Fonte tecnica per:
- stack;
- repository;
- Docker;
- database;
- API;
- Game Core;
- Event Engine;
- deployment;
- test;
- milestone.

## 4. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`
Fonte prevalente per:
- Web + Windows;
- Tauri;
- SQLite vs PostgreSQL;
- llama.cpp;
- modello locale incluso;
- HTML demo;
- VPS feasibility;
- RPG Maker/GameMaker;
- benchmark P0;
- packaging e distribuzione.

## 5. `GAME_SYSTEMS_SCHEMA_v0.1.md`
Fonte prevalente per i sistemi di gameplay:
- Tactical Combat Engine;
- sistema d100;
- caratteristiche, skill, ferite e progressione;
- Warfare Engine;
- unità, comandanti, logistica e battle plans;
- Management & Simulation Engine;
- economia, produzione, popolazione e migrazione;
- politica, reputazione, diplomazia e fazioni autonome;
- World Tick;
- conseguenze e causal graph;
- automazione/delega;
- connessioni micro ↔ macro;
- assunzioni LOCKED / PROVISIONAL / OPEN;
- acceptance scenarios della prima vertical slice sistemica.

---

# Regola di precedenza

In caso di conflitto:

1. documento più specifico;
2. documento con versione/data più recente;
3. `PRODUCT_VISION_LOCKED_v1.md` prevale sulle preferenze di prodotto;
4. `GAME_SYSTEMS_SCHEMA_v0.1.md` prevale sui dettagli di gameplay e simulazione;
5. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md` prevale su packaging/distribuzione/AI locale;
6. `TECHNICAL_ROADMAP_v0.1.md` prevale su dettagli di implementazione generici.

Le formule marcate `PROVISIONAL` non sono considerate bilanciamento definitivo e possono essere sostituite dopo playtest senza modificare la Product Vision.

---

# Documenti ancora da creare

Priorità consigliata:

1. `UI_VISUAL_SYSTEM_v0.1.md`
2. `AI_DM_PROTOCOL_v0.1.md`
3. `DATA_SCHEMA_v0.1.md`
4. `P0_BENCHMARK_PLAN_v0.1.md`

Prima della produzione avanzata deve essere eseguito anche il gate tecnico P0 definito nel documento di fattibilità.
