# KNOWLEDGE INDEX v1
## Chronosaga: The Game

**Data:** 2026-08-17

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

## 6. `UI_VISUAL_SYSTEM_v0.1.md`
Fonte prevalente per UI/UX e linguaggio visuale:
- equilibrio game UI / diegetic OS;
- layout e navigation;
- palette, typography e geometry;
- Tactical / Warfare / Management presentation;
- party, personaggi, ferite e relazioni;
- eventi e AI-DM presentation;
- Analysis Mode;
- informational fog of war;
- responsive desktop;
- motion/audio UI;
- anti-pattern e acceptance criteria;
- decisioni LOCKED / PROVISIONAL / OPEN derivanti dal questionario UI.

## 7. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md`
Brief operativo per Lovable:
- primo Operations Vertical Slice;
- confini fra UI e Simulation Core;
- strategia mock-first / integration-ready;
- componenti e interaction requirements;
- preview Tactical/Warfare/Management;
- screenshot review;
- Definition of Done;
- limiti di autonomia e dipendenze.

## 8. `LOCAL_AI_MODEL_PROFILES_v0.1.md`
Fonte prevalente per la strategia dual-model locale:
- profilo Lite ~1.7B;
- profilo Standard ~3B;
- selezione `AUTO / LITE / STANDARD / PROCEDURAL`;
- hardware probe;
- requisiti RAM/VRAM/storage PROVISIONAL;
- fallback Standard → Lite → Procedural;
- packaging Windows con due modelli;
- modello WebGPU on-demand nel browser;
- benchmark VPS Lite/Standard;
- UI requirements del model selector;
- candidate families e gate di licenza;
- acceptance criteria del P0 dual-model.

---

# Regola di precedenza

In caso di conflitto:

1. documento più specifico;
2. documento con versione/data più recente;
3. `PRODUCT_VISION_LOCKED_v1.md` prevale sulle preferenze generali di prodotto;
4. `GAME_SYSTEMS_SCHEMA_v0.1.md` prevale sui dettagli di gameplay e simulazione;
5. `UI_VISUAL_SYSTEM_v0.1.md` prevale su UI/UX e linguaggio visuale generale;
6. `LOCAL_AI_MODEL_PROFILES_v0.1.md` prevale sui profili locali, selezione modello, requisiti visualizzati nel menu e fallback dual-model;
7. `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md` governa l'esecuzione Lovable ma non può contraddire Product Vision, Game Systems, UI Visual System o Local AI Model Profiles;
8. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md` prevale sugli aspetti generali di packaging/distribuzione/AI locale non ridefiniti dal documento dual-model;
9. `TECHNICAL_ROADMAP_v0.1.md` prevale su dettagli di implementazione generici.

Le formule o scelte marcate `PROVISIONAL` non sono considerate definitive e possono essere sostituite dopo playtest, benchmark o prototype review senza modificare la Product Vision.

---

# Documenti ancora da creare

Priorità consigliata:

1. `AI_DM_PROTOCOL_v0.1.md`
2. `DATA_SCHEMA_v0.1.md`
3. `P0_BENCHMARK_PLAN_v0.1.md`

Prima della produzione avanzata deve essere eseguito anche il gate tecnico P0 definito nei documenti di fattibilità e nei Local AI Model Profiles.
