# GAME SYSTEMS SCHEMA v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-16  
**Stato:** Product-aligned system specification / formulas provisional until playtest  
**Scope:** combattimento di personaggi, guerra su larga scala, gestione/simulazione, progressione, conseguenze e integrazione AI-DM.

---

# 0. Scopo del documento

Questo documento traduce le decisioni del questionario di allineamento in un'architettura di gameplay implementabile.

Chronosaga utilizza **tre motori di risoluzione distinti**, tutti collegati allo stesso World State:

```text
TACTICAL COMBAT ENGINE
personaggio / party / piccoli scontri
        │
        ├──────────────┐
        │              │
        ▼              ▼
WORLD STATE ◄──── WARFARE ENGINE
        ▲       squadre / eserciti / fronti
        │              │
        └──────────────┤
                       ▼
            MANAGEMENT & SIMULATION ENGINE
            economia / popolazione / politica /
            fazioni / produzione / territorio
```

Nessun motore vive isolato.

Una ferita individuale può cambiare una catena di comando.  
Una missione tattica può alterare una battaglia.  
Una guerra può distruggere produzione e causare migrazione.  
Una crisi economica può generare disordini, eventi personali e nuovi conflitti.

---

# 1. Stato delle decisioni

Usare tre livelli di certezza:

- **LOCKED** — decisione di prodotto approvata.
- **PROVISIONAL** — direzione approvata, formula/valore da playtestare.
- **OPEN** — non ancora deciso.

## 1.1 Decisioni LOCKED

- tre motori: Tactical / Warfare / Management;
- combattimento individuale ispirato al feeling dei tabletop RPG ma con matematica originale;
- d100 come dado principale;
- sei caratteristiche base + statistiche derivate;
- archetipi iniziali con crescita successiva libera;
- equipaggiamento profondo ed estendibile;
- movimento + azione come economia base del turno;
- ferite persistenti e possibilità di impianti/protesi;
- mortalità configurabile per campagna/difficoltà;
- psicologia, morale, stress e lealtà influenzano il comportamento;
- personaggi possono disobbedire, abbandonare o tradire se lo stato lo giustifica;
- sinergie tra personaggi emergenti;
- preparazione pre-combattimento rilevante;
- unità strategica minima: squadra, circa 10–20 individui;
- livello di automazione militare configurabile;
- guerra visualizzata tramite mappa + eventi + cronaca;
- tutti i principali fattori militari hanno peso: numero, equipaggiamento, esperienza, morale, comando, terreno, logistica, intelligence, meteo, tecnologia, addestramento, stanchezza;
- linee di rifornimento reali ma con UI semplificata;
- comandanti con personalità, capacità, lealtà, errori e possibile disobbedienza;
- circa 10–15 piani militari base combinabili;
- previsione battaglia approssimativa;
- battaglie possono generare focus encounter personali, automatizzabili;
- missioni personali possono influenzare significativamente guerre;
- crescita micro → macro progressiva;
- automazione/delega configurabile per sistema;
- economia sistemica;
- 8–10 risorse principali di default;
- catene produttive;
- simulazione demografica profonda per coorti;
- bisogni della popolazione;
- politica interna con gruppi/fazioni;
- reputazione per fazioni e gruppi sociali;
- diplomazia/geopolitica sistemica;
- fazioni autonome;
- guerre che non coinvolgono il giocatore;
- migrazioni reali;
- personaggi importanti possono crescere autonomamente;
- sandbox dominante;
- trama/arco principale possibile ma non obbligatorio;
- archi narrativi possono terminare, la campagna persistente continua fino a sconfitta/fine scelta;
- conseguenze capaci di durare l'intera campagna;
- conseguenze nascoste ammesse ma logicamente spiegabili;
- probabilità comunicate in modo indicativo;
- non esiste sempre una scelta buona;
- progressione ibrida;
- livello generale + abilità indipendenti;
- NPC attivi possono progredire;
- preset difficoltà + modalità Custom;
- AI-DM può proporre eventi, NPC e sottotrame solo entro validazione;
- nuovi NPC AI tramite template/schema;
- testo AI breve normalmente, più esteso negli eventi importanti;
- azione libera del giocatore solo in contesti predisposti nella prima versione;
- dettagli dei dadi disponibili su richiesta;
- formule complete in modalità Analisi;
- UI Normale + UI Analisi;
- UI dedicata a Tactical / Warfare / Management, ma parte dello stesso sistema visivo.

## 1.2 PROVISIONAL

- iniziativa tramite timeline dinamica basata sulla velocità;
- letalità tra bilanciata e pericolosa;
- posizionamento inizialmente semplificato, evoluzione verso sistema tattico completo;
- tre macro-fasi della guerra;
- tempo del mondo inizialmente astratto;
- peso della simulazione rispetto alla narrazione configurabile;
- peso gestione/combattimento configurabile;
- peso individuo/fazione configurabile.

## 1.3 OPEN

Restano aperte:

- attività ideale da sostenere per 30 minuti consecutivi;
- quali sistemi non devono mai diventare micromanagement;
- tre scene-manifesto definitive del gameplay;
- valore finale della granularità temporale;
- formula finale della timeline tattica;
- quantità di caselle/zone e scala della mappa tattica;
- bilanciamento numerico definitivo.

---

# 2. Principio di proprietà delle regole

Chronosaga può ispirarsi a principi generali dei tabletop RPG — caratteristiche, prove, iniziativa, azioni, competenze, equipaggiamento, condizioni — ma **non deve dipendere da regole, testi, classi, mostri, spell list o contenuti proprietari di D&D**.

Il sistema viene progettato con:

- nomi propri;
- formule proprie;
- percentile d100;
- progressione propria;
- economia propria;
- combat model proprio.

Obiettivo: familiarità senza diventare un clone.

---

# 3. I tre motori

## 3.1 Tactical Combat Engine — TCE

Risolve:

- duelli;
- scontri tra party;
- imboscate;
- boarding;
- missioni speciali;
- infiltrazioni;
- piccoli combattimenti.

Scala target:

```text
1–12 personaggi attivi per lato → ideale
13–30 → possibile, semplificabile
>30 → valutare conversione al Warfare Engine
```

---

## 3.2 Warfare Engine — WE

Risolve:

- squadre;
- compagnie;
- eserciti;
- fronti;
- battaglie territoriali;
- conflitti con molte unità.

La squadra di 10–20 persone è l'unità atomica concettuale.

Per evitare costi inutili il motore può aggregare unità fuori dal focus:

```text
SQUAD
  ↓ aggregation
COMPANY GROUP
  ↓ aggregation
BATTLE GROUP
```

La granularità è quindi adattiva.

---

## 3.3 Management & Simulation Engine — MSE

Risolve:

- risorse;
- economia;
- produzione;
- popolazione;
- migrazione;
- insediamenti;
- fazioni;
- politica interna;
- diplomazia;
- territorio;
- ricerca;
- logistica strategica;
- evoluzione del mondo.

Non utilizza turni di combattimento.

Opera attraverso **World Ticks / Planning Cycles**.

---

# 4. Tactical Combat — caratteristiche

## 4.1 Sei caratteristiche base

Nomi provvisori originali:

```text
POWER      forza fisica / impatto
AGILITY    coordinazione / velocità
VIGOR      resistenza / salute
INTELLECT  ragionamento / tecnica
PRESENCE   influenza / leadership
RESOLVE    volontà / stabilità psicologica
```

Scala consigliata PROVISIONAL:

```text
1–20
10 = adulto medio competente
```

Modificatore derivato:

```text
attribute_modifier = floor((attribute - 10) / 2)
```

Il modificatore non viene usato da solo come in un d20: viene convertito nella matematica percentile.

---

# 5. Abilità

Ogni personaggio possiede skill indipendenti.

Esempi di famiglie:

```text
COMBAT
marksmanship
melee
heavy_weapons
explosives

FIELD
survival
stealth
mobility
scouting

TECH
engineering
medicine
hacking
science

SOCIAL
persuasion
command
deception
negotiation

MENTAL
awareness
discipline
analysis
```

Rank PROVISIONAL:

```text
0 = non addestrato
1 = base
2 = competente
3 = esperto
4 = elite
5 = maestro
```

---

# 6. Sistema d100

Il d100 deve rendere le probabilità comprensibili.

## 6.1 Test base — formula PROVISIONAL

```text
Target % = 50
         + AttributeModifier × 5
         + SkillRank × 5
         + EquipmentBonus
         + SituationalModifiers
         - DifficultyModifier
```

Clamp ordinario:

```text
5% ≤ Target ≤ 95%
```

Il giocatore tira d100.

```text
roll ≤ target → successo
roll > target → fallimento
```

Esempio:

```text
Base                         50
Agility 14 → modifier +2    +10
Marksmanship 3              +15
Weapon optics                +5
Enemy cover                 -20
────────────────────────────────
Target                       60%
```

Questa formula è **da playtest**, non ancora un lock matematico.

---

# 7. Gradi di successo

Non usare soltanto successo/fallimento.

```text
Margin = Target - Roll
```

PROVISIONAL:

```text
Margin < 0       FAIL
0–9              NARROW SUCCESS
10–24            SOLID SUCCESS
25+              STRONG SUCCESS
```

Eventi particolari possono leggere il margine.

Esempio:

```text
medicina:
NARROW → stabilizza
SOLID  → cura
STRONG → cura + riduce trauma
```

---

# 8. Informazione sulle probabilità

Scelta approvata: **indicativa, non necessariamente perfetta**.

UI Normale:

```text
LOW
RISKY
FAIR
GOOD
EXCELLENT
```

UI Analisi:

```text
Estimated success: 63%
Confidence: 81%
```

L'informazione può essere imprecisa quando:

- nemico sconosciuto;
- intelligence bassa;
- equipaggiamento nascosto;
- situazione caotica;
- percezione insufficiente.

---

# 9. Economia delle azioni tattiche

LOCKED:

```text
1 MOVE
1 MAIN ACTION
1 REACTION WINDOW
+ interazioni minori contestuali
```

Main Action esempi:

- attacco;
- abilità;
- cura;
- hacking;
- uso oggetto;
- overwatch;
- dash;
- assistenza;
- interazione complessa.

Non introdurre un sistema di Action Points nella v0.1.

---

# 10. Iniziativa — timeline PROVISIONAL

Target di design:

> evitare il semplice “tutti agiscono una volta nello stesso ordine” senza trasformare il gioco in un simulatore incomprensibile.

Ogni attivazione genera un delay.

```text
NextActivation = CurrentTime
               + BaseActionDelay
               - SpeedModifier
               + ActionWeight
               + StatusDelay
```

Azioni pesanti possono ritardare il turno successivo.

Esempio concettuale:

```text
Ira      ──●──────●──────●──
Brann      ──●────────●─────
Enemy A  ─────●────●────────
```

**Gate di playtest:** confrontare questo sistema con una normale iniziativa fissa. Se la timeline aumenta complessità senza creare scelte migliori, tornare a iniziativa per round.

---

# 11. Posizionamento tattico

Esiste una distinzione tra IMPLEMENTAZIONE INIZIALE e TARGET.

## 11.1 Vertical Slice

Posizione semplificata:

```text
ENGAGED
NEAR
MID
FAR
```

Serve per validare combattimento e AI senza costruire subito un tactical renderer completo.

## 11.2 Target

Mappa a griglia.

Il modello dati deve già supportare:

```json
{
  "x": 14,
  "y": 7,
  "elevation": 1,
  "cover": "partial",
  "terrain": "industrial"
}
```

Elementi futuri:

- copertura;
- altezza;
- linea di tiro;
- ostacoli;
- terreno;
- choke point;
- area effects.

Non riscrivere il Combat Engine quando si passa alla griglia: usare un `PositionAdapter`.

---

# 12. Attacchi

Separare:

```text
TO HIT
↓
DAMAGE
↓
ARMOR / MITIGATION
↓
INJURY CHECK
```

La protezione non deve essere soltanto una “classe armatura”.

Obiettivo:

- Agility/cover riducono la probabilità di essere colpiti;
- armor riduce/trasforma il danno;
- qualità del colpo può creare injury.

---

# 13. Salute e ferite

Il personaggio possiede almeno:

```text
Health
Wounds
Stress
Morale
Fatigue
```

## 13.1 Letalità

Default target:

**tra bilanciata e pericolosa**.

Il giocatore può sopravvivere a errori normali, ma un combattimento mal preparato può produrre danni di campagna.

## 13.2 Injury

Schema:

```json
{
  "id": "inj_104",
  "location": "left_arm",
  "severity": 3,
  "type": "nerve_damage",
  "temporary": false,
  "effects": ["aim_penalty"],
  "treatments": ["surgery", "implant"],
  "resolvedBy": null
}
```

Possibili conseguenze:

- menomazioni;
- cicatrici;
- perdita di funzione;
- trauma;
- protesi;
- impianti;
- dipendenza da supporti.

Impianti e protesi possono:

- ripristinare;
- compensare;
- in alcuni casi migliorare;
- introdurre costi/rischi/maintenance.

---

# 14. Psicologia e comportamento

Variabili principali:

```text
Stress
Morale
Loyalty
Fear
Trust
Trauma
Fatigue
```

Il giocatore non controlla perfettamente gli esseri umani.

## 14.1 Obedience Check

Un ordine estremo può generare una verifica quando:

```text
stress alto
+
loyalty bassa
+
ordine contrario a personalità/obiettivo
+
paura elevata
```

Possibili risultati:

```text
OBEY
HESITATE
REFUSE
PANIC
ABANDON
BETRAY
```

Le ultime due devono essere rare e causali, non casuali.

---

# 15. Sinergie emergenti

Non costruire il party principalmente attorno a combo hardcoded.

Le sinergie derivano da tag e condizioni.

Esempio:

```text
SCOUT applica: TARGET_REVEALED
SNIPER legge: TARGET_REVEALED → accuracy bonus
TECH disattiva: COVER_SYSTEM
ASSAULT legge: COVER_DISABLED → breach bonus
```

Quindi nuove abilità possono creare combinazioni senza modificare il codice di ogni coppia di personaggi.

---

# 16. Preparazione tattica

Prima di alcuni combattimenti il giocatore può influenzare:

- squadra;
- equipaggiamento;
- posizione;
- scouting;
- intelligence;
- imboscata;
- sabotaggio;
- approccio;
- obiettivo;
- via di fuga.

La preparazione deve spesso valere più di un piccolo bonus numerico.

---

# 17. Progressione individuale

Sistema ibrido.

```text
GENERAL LEVEL
+
SKILL XP
+
TRAITS
+
EQUIPMENT
+
RELATIONSHIPS
+
STATUS / INJURIES
```

## 17.1 General Level

Rappresenta crescita complessiva e sblocchi.

## 17.2 Skill XP

Le abilità possono crescere tramite:

- utilizzo;
- training;
- esperienza spendibile;
- mentori;
- eventi.

## 17.3 Power curve

I personaggi diventano **abbastanza più forti**, ma non devono diventare immuni ai sistemi del mondo.

Un veterano deve essere nettamente migliore di una recluta, ma:

- arma pesante;
- imboscata;
- ferita grave;
- superiorità numerica;
- situazione estrema

restano pericolose.

---

# 18. Archetipi

Gli archetipi definiscono la partenza, non la prigione del personaggio.

Esempi generici:

```text
SCOUT
SOLDIER
TECHNICIAN
MEDIC
NEGOTIATOR
SPECIALIST
```

Dopo la creazione, sviluppo libero tramite skill/traits/equipaggiamento.

---

# 19. Equipaggiamento

Schema target profondo ma modulare.

```json
{
  "id": "weapon_001",
  "baseType": "rifle",
  "material": "alloy_a",
  "quality": 3,
  "condition": 0.87,
  "durability": 74,
  "ammoType": "kinetic_556",
  "ammo": 21,
  "capacity": 30,
  "components": ["optic_2", "stabilizer_1"],
  "tags": ["ranged", "burst"]
}
```

Il sistema deve supportare:

- armi;
- armature;
- materiali;
- qualità;
- condizione/usura;
- munizioni;
- componenti;
- moduli;
- rarità;
- manutenzione.

**Scope rule:** la vertical slice implementa un sottoinsieme, ma lo schema non deve impedirne l'espansione.

---

# 20. Mortalità

Profilo di campagna.

```text
PROTECTED
STANDARD
PERMADEATH
```

La difficoltà può suggerire un preset, ma mortalità e difficoltà rimangono configurabili separatamente in Custom.

---

# 21. Warfare Engine — modello di unità

Atomic Unit:

```text
SQUAD = ~10–20 persone
```

Schema:

```json
{
  "id": "unit_31",
  "type": "squad",
  "personnel": 14,
  "combatPower": 62,
  "equipment": 58,
  "training": 67,
  "experience": 41,
  "morale": 73,
  "cohesion": 78,
  "fatigue": 22,
  "ammo": 64,
  "supply": 71,
  "commanderId": "chr_77",
  "position": "sector_c4"
}
```

---

# 22. Gerarchia militare

La simulazione deve scalare.

```text
Squad
↓
Company Group
↓
Battle Group
↓
Army / Front
```

Unità lontane possono essere aggregate.

Quando diventano rilevanti possono essere espanse nuovamente.

Questo evita di simulare migliaia di agenti individuali a ogni tick.

---

# 23. Fattori militari

Tutti i seguenti concorrono al risultato:

```text
personnel
weapon/equipment quality
training
experience
morale
cohesion
commander
terrain
logistics
intelligence
weather/environment
technology
fatigue
position
battle plan
communications
```

Non usare un singolo “army power” come regola primaria.

È possibile calcolare un Power Estimate per UI, ma il resolver utilizza i componenti.

---

# 24. Effective Combat Power — formula PROVISIONAL

Una possibile struttura:

```text
BasePower = PersonnelFactor
          × EquipmentFactor
          × TrainingFactor

Readiness = f(Morale, Cohesion, Fatigue, Supply, Ammo)

Context = f(Command, Terrain, Intelligence, Weather, Technology, Plan)

EffectivePower = BasePower × Readiness × Context
```

I fattori devono essere normalizzati per evitare esplosioni numeriche.

Esempio range moltiplicatori:

```text
0.70 – 1.30 normalmente
0.50 – 1.50 in condizioni estreme
```

---

# 25. Prevedibilità della guerra

Target: **abbastanza prevedibile**.

La preparazione deve battere il puro RNG.

Randomness strategica PROVISIONAL:

```text
±5–15% normalmente
```

Eventi rari possono superare questo limite, ma devono avere una causa leggibile.

---

# 26. Battle Forecast

Prima dello scontro il giocatore riceve una stima:

```text
EXPECTED OUTCOME: FAVORABLE
ESTIMATED VICTORY: 60–72%
CONFIDENCE: MEDIUM
```

La forchetta dipende da Intelligence.

Bassa intelligence:

```text
45–80%
```

Alta intelligence:

```text
62–69%
```

La previsione non deve diventare una promessa.

---

# 27. Tre fasi della battaglia

Scelta iniziale: tre macro-fasi.

## PHASE 1 — PREPARATION

- intelligence;
- deployment;
- terrain;
- logistics;
- battle plan;
- reserves.

## PHASE 2 — ENGAGEMENT

- contatto;
- manovra;
- attrito;
- morale;
- ordini;
- focus events.

## PHASE 3 — RESOLUTION

- rottura;
- ritirata;
- inseguimento;
- perdite;
- prigionieri;
- territorio;
- aftermath.

In futuro possono esistere sub-fasi senza cambiare il contratto principale.

---

# 28. Battle Plans

Set iniziale target circa 12:

```text
HOLD
ASSAULT
BREAKTHROUGH
FLANK
ENCIRCLE
AMBUSH
RAID
HARASS
FEINT
DELAY
FIGHTING_RETREAT
SECURE_OBJECTIVE
```

Ogni piano:

- preferenze;
- requisiti;
- vantaggi;
- vulnerabilità;
- compatibilità comandante;
- compatibilità terreno.

Non devono essere semplici +10%.

---

# 29. Comandanti

Un comandante è un personaggio reale del World State.

Attributi strategici derivati:

```text
Command
Planning
Aggression
Caution
Adaptability
Logistics
Loyalty
Stress
Experience
DoctrineTags
```

Il comandante può:

- eseguire bene;
- adattare;
- interpretare male;
- ritardare;
- rifiutare;
- agire di propria iniziativa.

La disobbedienza deve derivare dallo stato e non da RNG puro.

---

# 30. Controllo e automazione militare

Livelli configurabili:

```text
FULL AUTO
COMMANDER CONTROL
PLAYER DIRECTIVES
DETAILED CONTROL
```

Il giocatore può cambiare livello per battaglia o fronte.

Automazione non significa risultato arbitrario: usa sempre lo stesso resolver.

---

# 31. Battle Focus Encounter

Una battaglia strategica può creare un evento individuale.

Esempio:

```text
WARFARE ENGINE
unità isolata
↓
FOCUS ENCOUNTER
comandante + 5 personaggi
↓
TACTICAL COMBAT ENGINE
↓
risultato
↓
WARFARE ENGINE
morale / posizione / comando modificati
```

Scelta approvata:

- presente;
- non costante;
- automatizzabile.

---

# 32. Tactical Mission → Strategic Consequence

Le missioni personali devono poter avere grande peso.

Esempi:

```text
sabotare radar
→ enemy intelligence -25

uccidere comandante
→ command efficiency ↓

aprire porta
→ new approach vector

convincere disertori
→ enemy cohesion ↓

salvare deposito
→ supply restored
```

Questo collegamento è un Product Pillar pratico.

---

# 33. Logistica militare

Importante ma non deve diventare spreadsheet punishment.

Rappresentazione:

```text
SUPPLY SOURCE
   │ capacity
   ▼
ROUTE / NODE
   │ interdiction risk
   ▼
FRONT SUPPLY POOL
   ▼
UNITS
```

Il giocatore gestisce principalmente:

- nodi;
- priorità;
- sicurezza;
- capacità;
- stock.

Non ogni singolo camion.

---

# 34. Management Engine — scala

Il giocatore può passare progressivamente da:

```text
PERSONAL
↓
PARTY
↓
BASE
↓
SETTLEMENT
↓
FACTION
↓
REGION
↓
STATE / LARGE TERRITORY
```

La scala iniziale dipende dalla campagna, ma il default parte piccolo.

---

# 35. Delegation Engine

Ogni sistema gestibile deve poter avere:

```text
MANUAL
GUIDED
AUTOMATIC
```

Esempio:

```text
Food production      AUTO
Military logistics   GUIDED
Research priorities  MANUAL
```

Questo è essenziale per evitare che la crescita micro→macro produca micromanagement incontrollabile.

---

# 36. Responsabili

Il giocatore può assegnare personaggi a ruoli.

Esempi:

```text
Governor
Quartermaster
Military Commander
Research Director
Diplomat
Security Chief
Production Chief
```

Le capacità influenzano il sistema.

Un responsabile incompetente può:

- produrre inefficienza;
- prendere decisioni sbagliate;
- ritardare;
- ignorare rischi.

Corruzione/tradimento sono possibili solo quando supportati da tratti, incentivi e relazioni.

---

# 37. Risorse

Default hard-SF / frontier set, modificabile dal ruleset.

Target 10 categorie:

```text
FOOD
WATER
ENERGY
FUEL
RAW_MATERIALS
COMPONENTS
MEDICINE
AMMUNITION
CREDITS
LABOR
```

Un setting può sostituire o aggiungere categorie.

Il Game Core non deve hardcodare i nomi.

---

# 38. Produzione

Production Node:

```json
{
  "id": "fac_20",
  "recipe": "alloy_parts",
  "capacity": 100,
  "efficiency": 0.82,
  "labor": 34,
  "inputs": {},
  "outputs": {},
  "condition": 0.91
}
```

Catena esempio:

```text
RAW MATERIAL
↓
REFINING
↓
COMPONENTS
↓
EQUIPMENT
```

Il sistema deve supportare bottleneck.

---

# 39. Economia sistemica

Il prezzo non viene scritto dall'AI.

Possibile struttura PROVISIONAL:

```text
Price = BasePrice
      × ScarcityFactor
      × DemandFactor
      × LocalRisk
      × TradeAccess
```

Scarcity deriva da:

```text
stock
production
consumption
expected demand
imports
```

La simulazione deve essere leggibile, non un modello econometrico reale.

---

# 40. Popolazione

La popolazione viene simulata per **coorti**, non necessariamente persona per persona.

Cohort dimensions:

```text
age band
occupation
wealth band
culture
political affinity
skill class
health
needs satisfaction
loyalty
```

Esempio:

```json
{
  "population": 1840,
  "occupation": "industrial",
  "wealth": "low",
  "culture": "settler_a",
  "satisfaction": 0.54,
  "politicalAffinity": "labor_bloc"
}
```

Questo permette profondità demografica senza simulare 50.000 NPC completi.

---

# 41. Bisogni della popolazione

Core needs:

```text
food
water
housing
health
security
employment
freedom/autonomy
prosperity
trust
```

Il peso varia per cultura, situazione e gruppo sociale.

La frustrazione può contribuire a:

- criminalità;
- opposizione;
- protesta;
- radicalizzazione;
- migrazione;
- rivolte;
- recruitment di fazioni.

Nessuna soglia deve produrre automaticamente sempre la stessa conseguenza.

---

# 42. Migrazione

Migrazione = movimento reale tra location.

Pressure model PROVISIONAL:

```text
Push = insecurity
     + unemployment
     + shortage
     + persecution
     + disaster

Pull = safety
     + jobs
     + prosperity
     + social ties
     + policy

MigrationFlow = f(Push, Pull, Distance, Capacity, Access)
```

Le migrazioni cambiano:

- popolazione;
- lavoro;
- consumo;
- politica;
- cultura;
- prezzi;
- tensione sociale.

---

# 43. Politica interna

Ogni insediamento/fazione può possedere gruppi di interesse.

Esempi:

```text
industrial bloc
military bloc
workers
settlers
religious/cultural group
merchant network
scientific elite
localist movement
```

Ogni gruppo possiede:

```text
Influence
Approval
Resources
Goals
RedLines
Leadership
Relationships
```

---

# 44. Reputazione

Non una sola barra globale.

Livelli:

```text
personal relationship
social group reputation
faction reputation
regional reputation
```

Una scelta può migliorare una reputazione e peggiorarne un'altra.

---

# 45. Diplomacy / Geopolitics Engine

Entità:

```text
factions
territories
treaties
alliances
wars
trade agreements
claims
debts
threat perceptions
influence
```

Le fazioni agiscono regolarmente senza il giocatore.

Possibili azioni autonome:

- alleanza;
- commercio;
- embargo;
- minaccia;
- mobilitazione;
- guerra;
- propaganda;
- espansione;
- infiltrazione;
- trattato.

Il mondo non aspetta il turno narrativo del giocatore.

---

# 46. World Tick

Scelta attuale: **tempo astratto**, da valutare.

Separare:

```text
PLAYER TURN
= una decisione/azione significativa

WORLD TICK
= avanzamento simulazione
```

Non devono essere necessariamente 1:1.

Schema:

```text
player action
↓
local resolution
↓
0..N world ticks
↓
faction simulation
↓
economy
↓
population
↓
events
```

In futuro un `CalendarAdapter` può tradurre tick in ore/giorni/mesi.

---

# 47. World Autonomy

Ad ogni tick, il motore valuta solo entità rilevanti.

Livelli di simulazione:

```text
FOCUS      high fidelity
ACTIVE     normal simulation
BACKGROUND coarse simulation
DORMANT    event-driven only
```

Questo rende fattibile un mondo grande.

---

# 48. NPC Autonomous Progression

NPC importanti possono:

```text
learn
train
change job
form relationships
join factions
receive promotions
lose status
gain power
become leaders
```

Non serve simulare la stessa profondità per tutti.

`simulation_priority` determina la frequenza.

---

# 49. Narrative Layer

Chronosaga è sandbox-first.

La trama principale può esistere come **Arc**, non come binario obbligatorio.

```text
WORLD SIMULATION
+
OPTIONAL STORY ARCS
+
EMERGENT EVENTS
```

Ignorare un arco non deve interrompere la campagna salvo conseguenze logiche.

---

# 50. Finali

Due concetti distinti.

## Arc Ending

Un filone può avere un finale sistemico:

- vittoria;
- fallimento;
- compromesso;
- trasformazione;
- abbandono.

## Campaign Ending

La campagna persistente può continuare finché:

- il giocatore viene sconfitto;
- condizioni di world failure;
- il giocatore sceglie di concludere;
- scenario specifico impone una fine.

---

# 51. Consequence Engine

Ogni conseguenza può avere:

```text
scope
visibility
delay
duration
reversibility
magnitude
causalSource
```

Schema:

```json
{
  "id": "con_12",
  "source": "decision_442",
  "triggerAt": 618,
  "visibility": "hidden",
  "scope": "regional",
  "effects": [],
  "reversible": true
}
```

---

# 52. Conseguenze nascoste

Ammesse, ma il giocatore deve poter ricostruire il nesso dopo che emergono.

Principio:

> mystery before revelation; causality after revelation.

Il gioco può non dire subito “questa scelta causerà X”.

Ma quando X accade deve esistere una catena causale nel log.

---

# 53. Causal Graph

Target strutturale:

```text
CHOICE
 ↓
FLAG
 ↓
RESOURCE CHANGE
 ↓
GROUP REACTION
 ↓
POLITICAL PRESSURE
 ↓
MIGRATION
 ↓
FACTION OPPORTUNITY
 ↓
WAR
```

Il motore deve poter spiegare almeno i principali nodi della catena.

---

# 54. Recuperabilità e severità

Input utente:

```text
punishment target = 7.5–8 / 10
comeback target   = 3–4 / 10
```

Interpretazione:

- errori importanti devono pesare;
- il giocatore non deve poter cancellare facilmente una crisi;
- recuperare deve essere possibile ma costoso;
- alcune perdite diventano parte permanente della storia.

Questo non significa snowball inevitabile.

Prevedere **recovery paths costosi**, non reset.

---

# 55. Campaign Axes

Oltre alla difficoltà, una campagna può avere tre slider di esperienza.

## Simulation ↔ Narrative

```text
1 = narrative-heavy
10 = simulation-heavy
DEFAULT = 5
```

## Combat ↔ Management

```text
1 = combat-heavy
10 = management-heavy
DEFAULT = 5
```

## Individual ↔ Faction

```text
1 = individual-heavy
10 = faction/macro-heavy
DEFAULT = 7
```

Questi slider non devono disabilitare i sistemi.

Cambiano:

- frequenza;
- automazione;
- quantità di focus;
- UI priority;
- event weights.

---

# 56. Difficulty Profiles

Preset:

```text
STORY
STANDARD
VETERAN
SIMULATION
CUSTOM
```

Custom permette di modificare indipendentemente:

- damage/lethality;
- mortality;
- scarcity;
- intelligence quality;
- enemy/faction aggression;
- economic pressure;
- morale severity;
- save/recovery policy;
- consequence severity;
- automation.

Non fare difficoltà = HP sponge.

---

# 57. AI-DM — ruolo nei sistemi

AI può:

- narrare;
- dialogare;
- proporre un evento;
- proporre NPC;
- proporre sottotrama;
- proporre memoria;
- descrivere una battaglia;
- trasformare dati in cronaca.

AI non può direttamente:

- modificare HP;
- inventare risorse possedute;
- decidere hit chance;
- spostare confini;
- uccidere personaggi;
- creare una fazione persistente senza validazione.

---

# 58. NPC generation tramite template

AI produce:

```json
{
  "template": "frontier_officer",
  "name": "...",
  "personalityTags": [],
  "motivation": "...",
  "narrativeNotes": "..."
}
```

Simulation Core completa/valida:

- stats;
- skill budget;
- equipment;
- faction;
- power level;
- persistence.

---

# 59. Free-form actions

Prima versione: solo in eventi predisposti.

Flusso:

```text
PLAYER TEXT
↓
AI intent extraction
↓
VALID INTENT SCHEMA
↓
Simulation Core selects test
↓
d100 resolution
↓
state delta
↓
AI narration
```

Esempio:

```text
“Fingo di avere rinforzi.”
↓
intent: deception
attribute: Presence
skill: Deception
opposition: commander resolve
```

L'AI non decide se il bluff riesce.

---

# 60. UI — due livelli

## Normal Mode

Mostra:

- informazioni decisive;
- rischi sintetici;
- stato;
- conseguenze;
- direttive.

## Analysis Mode

Mostra:

- formule;
- modificatori;
- roll;
- breakdown;
- confidence;
- causal details;
- economy details.

Questo permette profondità senza obbligare tutti a leggere una spreadsheet.

---

# 61. UI per scala

Tre ambienti visuali coerenti:

```text
TACTICAL OS
→ character combat / party

WARFARE COMMAND
→ units / fronts / logistics

STRATEGIC OPERATIONS
→ economy / politics / population / faction
```

Stesso Visual System:

- tipografia;
- colori;
- terminologia;
- interaction grammar.

Diversa densità e rappresentazione.

---

# 62. Data flow tra i motori

Ogni motore produce `StateDelta`.

```text
TacticalResult
↓
StateDelta
↓
World State
↓
Warfare / Management reads changed state
```

Esempio:

```json
{
  "source": "tactical:mission_812",
  "changes": [
    {"type":"commander_status","id":"chr_77","value":"dead"},
    {"type":"intel","faction":"red","delta":-18},
    {"type":"supply_route","id":"route_9","value":"disabled"}
  ]
}
```

---

# 63. Causal ownership

Ogni modifica persistente deve dichiarare:

```text
source_engine
source_event
source_actor
turn/tick
rule
```

Serve per:

- debug;
- cronaca;
- spiegazioni;
- anti-AI-slop;
- save integrity.

---

# 64. Performance strategy

Non simulare tutto alla stessa risoluzione.

```text
player vicinity → full
same region      → medium
other regions    → coarse
inactive content → event driven
```

Personaggi importanti hanno simulazione più frequente.

Popolazioni grandi usano coorti.

Eserciti lontani usano aggregati.

Questo principio è obbligatorio per la fattibilità Web/VPS/Windows.

---

# 65. Vertical Slice — Systems v0.1

La prima slice NON implementa l'intero documento.

Deve dimostrare:

## Tactical

- 4 caratteristiche/6 caratteristiche già nello schema definitivo;
- d100;
- skill;
- move + action;
- stress;
- injury semplice;
- posizione astratta;
- 2–4 personaggi;
- risultato persistente.

## Warfare

- 4–8 squadre;
- morale;
- supply;
- commander;
- terrain;
- 3 battle phases;
- auto/manual directive;
- un focus encounter possibile.

## Management

- un insediamento;
- 8–10 risorse schema, 4–6 attive;
- una catena produttiva;
- due population cohorts;
- due political groups;
- un'altra fazione autonoma;
- un world tick.

## Cross-system proof

Obbligatoria una catena:

```text
TACTICAL CHOICE
→ WARFARE MODIFIER
→ ECONOMIC CONSEQUENCE
→ POPULATION / FACTION REACTION
```

Se questa catena funziona, l'architettura è valida.

---

# 66. Acceptance Scenario A — Tactical → Warfare

1. Il giocatore prepara una missione.
2. Il party tenta di sabotare un relay.
3. Il TCE risolve con d100.
4. Uno dei personaggi subisce una ferita persistente.
5. Il relay viene distrutto.
6. Il Warfare Engine legge `enemy_intel_modifier = -X`.
7. La previsione della battaglia cambia.
8. L'esito strategico tiene conto del sabotaggio.
9. Il Chronicle può spiegare la catena.

PASS se nessuna AI modifica direttamente i numeri.

---

# 67. Acceptance Scenario B — Economy → Population → Politics

1. Una risorsa critica diventa scarsa.
2. Il prezzo aumenta.
3. Una production chain perde output.
4. Una coorte perde lavoro/soddisfazione.
5. Migration Pressure aumenta.
6. Un gruppo politico guadagna consenso.
7. La fazione avversaria reagisce/opportunisticamente interviene.
8. Il giocatore vede causa ed effetto in Analysis Mode.

---

# 68. Acceptance Scenario C — Character → Macro

1. Un NPC accumula esperienza autonomamente.
2. Cambia ruolo.
3. Riceve comando di un'unità.
4. La relazione col giocatore influenza obedience/loyalty.
5. Una decisione personale altera il suo comportamento in guerra o politica.

Questo scenario testa il principio “la macro-scala non cancella la dimensione umana”.

---

# 69. Anti-micromanagement rule

Anche se le domande 71–72 non sono state ancora definite, adottare una regola provvisoria:

> ogni sistema profondo deve avere un livello di delega equivalente al livello di dettaglio che introduce.

Se aggiungiamo:

- supply routes → aggiungiamo auto-routing;
- produzione → aggiungiamo production policy;
- eserciti → aggiungiamo commander automation;
- population → non chiediamo gestione individuo per individuo.

---

# 70. Depth vs speed

Decisione:

> privilegiare profondità senza perdere troppa velocità.

Implementazione:

- dettagli nascosti dietro drill-down;
- sistemi complessi con default sensati;
- automazione;
- previsioni sintetiche;
- Analysis Mode opzionale;
- risoluzioni batch dove possibile.

---

# 71. Clarity vs mystery

Target: mix.

Il giocatore deve capire:

- le regole principali;
- perché una conseguenza importante è avvenuta dopo che emerge;
- quali fattori stanno influenzando un sistema.

Può non sapere:

- probabilità esatte;
- intenzioni nascoste;
- informazioni non scoperte;
- conseguenze future non ancora manifeste.

---

# 72. Settings Profile v0.1

```json
{
  "difficulty": "standard",
  "mortality": "standard",
  "campaignLength": "extended",
  "simulationNarrative": 5,
  "combatManagement": 5,
  "individualFaction": 7,
  "automation": {
    "warfare": "guided",
    "economy": "guided",
    "population": "automatic",
    "logistics": "guided"
  },
  "uiMode": "normal"
}
```

---

# 73. Moduli Game Core suggeriti

```text
packages/game-core/src/
│
├── tactical/
│   ├── checks
│   ├── initiative
│   ├── actions
│   ├── damage
│   ├── injury
│   ├── morale
│   └── position
│
├── warfare/
│   ├── units
│   ├── commanders
│   ├── battle-plans
│   ├── forecast
│   ├── resolver
│   ├── supply
│   └── focus-encounters
│
├── management/
│   ├── economy
│   ├── production
│   ├── resources
│   ├── population
│   ├── migration
│   ├── politics
│   ├── diplomacy
│   └── delegation
│
├── consequences/
├── world-tick/
├── relationships/
├── progression/
└── state/
```

---

# 74. Sistemi da NON implementare tutti insieme

Per evitare feature creep:

**Non costruire subito:**

- tutte le 10 risorse complete;
- economia globale complessa;
- 100+ unità in battaglia;
- griglia tattica completa;
- impianti avanzati;
- politica con decine di gruppi;
- tutte le doctrine;
- tutti gli stati psicologici.

Costruire prima la catena cross-system della sezione 65.

---

# 75. Domande da riaprire dopo il primo prototipo

Dopo il primo playtest rispondere con dati, non impressioni astratte:

1. Timeline initiative è più interessante di round initiative?
2. Posizionamento astratto rende il combat troppo superficiale?
3. Quanto spesso il giocatore apre Analysis Mode?
4. La logistica genera decisioni o lavoro?
5. La simulazione demografica produce eventi leggibili?
6. Le tre battle phases bastano?
7. Le probabilità d100 sono abbastanza intuitive?
8. L'AI con testo breve riesce a rendere vivi i delta sistemici?
9. Quanto dura un turno decisionale medio?
10. Quale attività il giocatore vuole continuare per 30 minuti?

Questi risultati alimenteranno `GAME_SYSTEMS_SCHEMA_v0.2.md`.

---

# 76. Regola finale

Chronosaga non deve avere tre minigiochi separati.

Deve avere **tre scale dello stesso mondo**:

```text
PERSON
  ↓
UNIT
  ↓
SOCIETY
```

Il valore del progetto emerge quando un fatto può attraversare tutte e tre:

```text
ferita di una persona
→ perdita di un comandante
→ sconfitta locale
→ perdita di una rotta
→ scarsità
→ migrazione
→ crisi politica
→ nuova guerra
```

Se il Simulation Core può produrre e spiegare catene di questo tipo, il sistema è allineato alla visione del prodotto.
