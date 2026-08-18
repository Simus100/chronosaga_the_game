# VISUAL ASSET PIPELINE v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Amendment:** 2026-08-18 — static modular assets + code-driven motion  
**Stato:** Approved visual-production architecture / motion strategy LOCKED  
**Ambito:** portrait, sprite, equipment, environment, visual identity persistence, tactical motion presentation

---

# 1. Decisione principale

Chronosaga v1 NON richiede un image generator locale durante il gameplay.

L'AI grafica viene usata esternamente durante lo sviluppo per produrre una libreria visuale curata, normalizzata e versionata.

```text
AI IMAGE GENERATOR / ARTIST TOOL
        ↓
RAW GENERATIONS
        ↓
CURATION
        ↓
MASTER ASSETS
        ↓
NORMALIZATION / SPLIT / CLEANUP
        ↓
GAME-READY ASSETS
        ↓
CHRONOSAGA RUNTIME
```

Vantaggi:

- nessun secondo modello generativo richiesto al giocatore;
- requisiti hardware più bassi;
- coerenza grafica controllabile;
- personaggi visivamente persistenti;
- startup e gameplay più prevedibili;
- asset testabili/versionabili;
- nessuna dipendenza dalla latenza di generazione immagini.

Runtime image generation resta una possibile estensione futura opzionale, non una dipendenza core.

---

# 2. Tre rappresentazioni dello stesso personaggio

Ogni personaggio può avere tre rappresentazioni coerenti:

```text
CHARACTER ID
    │
    ├── PORTRAIT
    │   dossier / dialogo / eventi
    │
    ├── TACTICAL SPRITE
    │   combattimento / mappe locali
    │
    └── STRATEGIC ICON
        warfare / management / command
```

Tutte devono referenziare lo stesso `characterId` e lo stesso descrittore visuale persistente.

Il passaggio micro → macro non deve far perdere l'identità di personaggi importanti.

---

# 3. Sprite modulari

Non creare migliaia di personaggi come immagini completamente indipendenti.

La varietà viene ottenuta principalmente con composizione modulare:

```text
BODY
+ FACE
+ HAIR
+ SKIN / PALETTE
+ OUTFIT
+ ARMOR
+ WEAPON
+ ACCESSORIES
+ FACTION MARKINGS
+ SCARS / INJURIES
+ DAMAGE / WEAR
        ↓
CHARACTER VISUAL
```

Categorie iniziali candidate:

```text
body
face
hair
outfit
armor
weapon
accessory
implant/prosthetic
scar/injury
rank/faction marking
wear/damage overlay
```

Il numero esatto di moduli resta PROVISIONAL fino al Tactical prototype.

## 3.1 Strategia AI-first per un team senza illustratore dedicato — LOCKED PRINCIPLE

La pipeline deve essere progettata affinché l'utente possa operare principalmente come **art director/curatore**, non come illustratore manuale.

Flusso preferito:

```text
ART DIRECTION / CONSTRAINTS
        ↓
AI CONCEPT GENERATION
        ↓
HUMAN CURATION
        ↓
STATIC MASTER COMPONENTS
        ↓
AUTOMATED NORMALIZATION
        ↓
GAME-READY MODULAR ASSETS
```

L'AI è quindi favorita per:

- concept art;
- character sheet;
- pose statiche;
- volti;
- outfit;
- armature;
- armi;
- accessori;
- props;
- environment modules;
- faction visual exploration.

Il software deve occuparsi il più possibile delle operazioni ripetitive e misurabili: canvas, alpha, anchor, naming, metadata, hash, atlas e validation.

Principio:

> **La creatività può essere AI-assisted; geometria, coerenza tecnica e contratti devono essere automatizzati e verificabili.**

---

# 4. Persistenza dell'identità visuale

Ogni personaggio procedurale importante deve conservare un descrittore stabile, ad esempio:

```json
{
  "characterId": "npc_00043892",
  "bodyId": "body_humanoid_03",
  "faceId": "face_017",
  "hairId": "hair_008",
  "skinPaletteId": "skin_04",
  "outfitId": "outfit_worker_02",
  "armorId": null,
  "weaponId": "weapon_pistol_03",
  "accessoryIds": ["acc_badge_02"],
  "injuryVisualIds": [],
  "factionMarkingId": "faction_none",
  "visualSeed": 8492
}
```

Se il personaggio evolve, cambiano solo i componenti appropriati.

Esempio:

```text
YEAR 1
worker outfit
no scars
civilian pistol

YEAR 4
same face/body identity
+ officer uniform
+ scar
+ cybernetic arm
+ service rifle
```

Non rigenerare casualmente volto/corpo ad ogni caricamento.

---

# 5. Scala grafica

La quantità di sprite individuali diminuisce quando aumenta la scala simulata.

```text
TACTICAL
individual sprite

↓
SMALL WARFARE
squad marker + selected individuals

↓
WARFARE
unit symbols / command markers

↓
STRATEGIC
territory / army / logistics symbology
```

Chronosaga non deve renderizzare migliaia di soldati individuali per simulare un'armata.

La profondità percepita deve provenire soprattutto da stato, causalità, logistica, personaggi e conseguenze simulate; il costo grafico non deve crescere linearmente con la complessità della simulazione.

---

# 6. Pipeline sorgente → game-ready

## A. Source generation

Possibili output sorgente:

- concept art;
- character sheet;
- front/side/back reference quando utile;
- pose reference;
- equipment sheet;
- environment concept;
- faction visual exploration.

I batch sorgente possono essere grandi e restano fuori dal normale Git.

## B. Curation

Ogni output viene valutato per:

- coerenza con `UI_VISUAL_SYSTEM_v0.1.md` e art direction futura;
- anatomia/proporzioni;
- leggibilità;
- continuità stilistica;
- originalità;
- assenza di artefatti evidenti;
- idoneità alla modularizzazione;
- provenienza/licenza/uso consentito.

## C. Master normalization

Operazioni possibili:

- pulizia bordi;
- correzione silhouette;
- separazione layer;
- uniformazione prospettiva;
- anchor point;
- palette normalization;
- ridimensionamento;
- frame/canvas alignment;
- background removal;
- naming e metadata.

## D. Game-ready export

Output ottimizzato per runtime:

- dimensioni standard;
- alpha corretto;
- naming stabile;
- compression appropriata;
- metadata;
- hash/versione;
- eventuale atlas/sprite sheet.

## E. Asset Compiler — APPROVED DIRECTION

La prima libreria consistente dovrebbe essere supportata da uno strumento/script di build dedicato, provvisoriamente chiamabile **Chronosaga Asset Compiler**, che automatizzi almeno:

```text
SOURCE ASSET
   ↓
validate dimensions / alpha
   ↓
normalize canvas
   ↓
apply anchor rules
   ↓
assign / validate assetId
   ↓
write metadata
   ↓
calculate SHA-256
   ↓
optional atlas packing
   ↓
GAME-READY ASSET
```

Il nome e l'implementazione definitiva restano PROVISIONAL; il principio di automazione è approvato.

---

# 7. Tactical motion strategy — LOCKED

## 7.1 Principio principale

Chronosaga v1 **NON richiede animazioni tradizionali frame-by-frame per i personaggi Tactical**.

La baseline approvata è:

```text
STATIC MODULAR ASSET
        +
CODE-DRIVEN MOTION
        +
VISUAL FX
        +
SOUND FEEDBACK
        ↓
READABLE TACTICAL ACTION
```

L'obiettivo non è simulare ogni passo fisico del personaggio come in un action game, ma comunicare in modo chiaro, elegante e reattivo:

- movimento;
- attacco;
- impatto;
- stato;
- incapacità;
- interazione;
- conseguenze del Simulation Core.

## 7.2 Movimento

Uno sprite statico può spostarsi fra due punti tramite interpolazione.

Effetti ammessi/combinabili:

- translation/interpolation;
- easing breve;
- piccolo bob verticale o oscillazione, se coerente con camera e stile;
- shadow displacement;
- path highlight;
- destination pulse;
- scale molto contenuta;
- orientation/flip quando tecnicamente conveniente.

Non è necessario mostrare una vera walk cycle per rendere leggibile uno spostamento tattico.

## 7.3 Attacco

Un attacco può essere rappresentato usando asset statici e motion/FX:

```text
STATIC UNIT
→ small recoil / translation / rotation
→ muzzle flash / beam / projectile / trajectory cue
→ impact effect
→ target feedback
→ state update
```

Sono ammessi:

- recoil;
- muzzle flash;
- traccia balistica;
- beam;
- projectile sprite;
- impact flash;
- particles;
- local shake;
- sound cue;
- combat log / floating feedback configurabile.

La spettacolarità non deve oscurare la lettura dello stato simulato.

## 7.4 Hit / injury / incapacitation

Baseline economica:

```text
HIT
flash + micro-knockback + FX + state marker

INJURY
persistent overlay / icon / decal where useful

INCAPACITATED
static down pose OR rotation/scale/fade/marker
```

Una posa `down` separata è utile ma non obbligatoria per ogni asset.

## 7.5 Pose statiche opzionali

Per personaggi o archetipi importanti è ammesso usare un piccolo set di pose statiche, per esempio:

```text
NORMAL
ATTACK / ACTION
DOWN / INCAPACITATED
```

Queste NON costituiscono una sprite-sheet animation tradizionale.

Il principio è:

> aggiungere una nuova posa solo quando aumenta realmente leggibilità, identità o qualità percepita.

## 7.6 Frame animation tradizionale

Animazioni come:

```text
walk_01
walk_02
walk_03
...
attack_01
attack_02
...
```

sono **OPTIONAL / LATER**, non requisito della prima versione.

Devono essere introdotte soltanto se il Tactical prototype dimostra che static assets + motion/FX risultano insufficienti.

Non produrre grandi batch di frame AI indipendenti come baseline: aumentano rischio di flicker, incoerenza anatomica, variazioni di outfit/arma e costi di curation.

## 7.7 Direzioni

La precedente ipotesi 4-direction / 8-direction non è più un requisito iniziale.

Lo sprite Tactical può partire da:

- una singola rappresentazione leggibile;
- flip/orientation semplice;
- poche varianti direzionali;
- 4 direzioni soltanto se il prototipo dimostra un vantaggio chiaro;
- 8 direzioni soltanto in una fase successiva se il valore visivo giustifica costo e complessità.

Quindi:

```text
SINGLE / MINIMAL DIRECTION BASELINE   APPROVED
4 DIRECTIONS                          OPTIONAL AFTER PROTOTYPE
8 DIRECTIONS                          OPTIONAL / LATER
```

## 7.8 Motion data vs art asset

Il movimento appartiene principalmente alla presentazione/runtime, non al contenuto dell'immagine.

Esempio concettuale:

```text
TacticalPresentationEvent
  kind: move | attack | hit | down | interact
  sourceEntityId
  targetEntityId?
  from
  to?
  duration
  effectIds
        ↓
Renderer / Motion System
        ↓
static assets + transforms + FX + sound
```

I valori esatti e lo schema definitivo saranno definiti durante il Tactical prototype; il principio di separare **game state → presentation event → motion** è approvato.

---

# 8. Visual reference philosophy — SYSTEM-FIRST

Chronosaga può prendere ispirazione da strategy/wargame sistemici che ottengono grande profondità usando una rappresentazione grafica relativamente economica, incluso **Shadow Empire** come riferimento di filosofia di prodotto.

Elementi da studiare come principio:

- priorità alla profondità sistemica rispetto al numero di frame;
- informazione leggibile;
- unità/marker capaci di rappresentare sistemi complessi;
- mappe e overlay come strumenti di gioco;
- eventi/personaggi integrati nella simulazione;
- capacità di rappresentare grandi conflitti senza renderizzare migliaia di individui;
- motion semplice che comunica l'evoluzione dello stato.

Questa è **ispirazione funzionale**, non una direttiva per copiare:

- asset;
- UI;
- simboli proprietari;
- layout specifici;
- art direction;
- testo/lore;
- identità visiva.

Chronosaga deve mantenere il proprio Visual DNA hard-SF / operating-system / cinematic-systemic definito in `UI_VISUAL_SYSTEM_v0.1.md`.

---

# 9. Environment procedural composition

La varietà ambientale deve derivare anche dalla composizione, non solo dal numero di immagini uniche.

```text
BASE TILE / MODULE
+ PROP SET
+ DECALS
+ DAMAGE LAYER
+ LIGHTING STATE
+ WEATHER / ATMOSPHERE
+ FACTION SIGNAGE
+ PROCEDURAL PLACEMENT SEED
        ↓
LOCAL ENVIRONMENT VARIANT
```

Questo consente una grande varietà con un numero controllato di asset.

La stessa filosofia vale per il movimento ambientale: dove possibile usare proprietà runtime semplici (pulse, flicker, parallax, particle layers, light state, weather overlays) invece di moltiplicare asset animati pre-renderizzati.

---

# 10. Directory esterne consigliate

Nel workspace locale:

```text
runtime-assets\
├── visual-source\
│   ├── ai-generations\
│   ├── master\
│   └── character-sheets\
│
└── visual-ready\
    ├── portraits\
    ├── sprites\
    ├── equipment\
    ├── environment\
    └── ui\
```

`visual-source` non viene distribuito al giocatore.

`visual-ready` è la sorgente per il packaging degli asset approvati.

---

# 11. Git policy per asset visuali

Piccoli asset game-ready appropriati possono entrare in `assets/` se:

- sono necessari per source/build/test;
- dimensione ragionevole;
- provenienza e uso sono chiari;
- non trasformano la repo in un asset archive multi-GB.

Le grandi librerie devono essere gestite come pack esterni/versionati e descritte da manifest/checksum.

Raw AI generations e master pesanti non vanno nel normale Git.

---

# 12. Metadata minimi

Per un asset/pack approvato, dove applicabile:

```text
assetId
category
version
source/master identity
character/faction compatibility
pose/direction metadata when present
dimensions
anchor
license/provenance
SHA-256
pack name
status: source / approved / game-ready / deprecated
```

Gli ID devono essere stabili per evitare che un aggiornamento grafico rompa save o identità dei personaggi.

Gli eventi di motion/code-driven animation non devono richiedere che l'asset contenga frame animation metadata se non esiste una vera sequenza a frame.

---

# 13. Relazione con il Simulation Core

Il Game Core conserva ID e stato visualmente rilevante, non immagini generate e non frame di animazione.

Esempio:

```text
CharacterState
  characterId
  equipment IDs
  injury IDs
  faction/rank
  persistent visual descriptor ID
        ↓
Presentation / Visual Adapter
        ↓
portrait / tactical sprite / strategic icon
        ↓
Motion / FX Renderer
```

Le immagini e le animazioni non decidono lo stato del personaggio. Lo rappresentano.

La risoluzione autorevole deve precedere la presentazione:

```text
SIMULATION CORE RESULT
        ↓
STATE COMMIT
        ↓
PRESENTATION EVENT
        ↓
STATIC ASSET + MOTION + FX + SOUND
```

---

# 14. Runtime image generation futura

Se valutata in futuro, deve essere OPTIONAL.

Casi potenzialmente sensati:

- portrait speciale di NPC importante;
- propaganda;
- giornale/news illustration;
- event card rara;
- commemorative/campaign image.

Non è il sistema base degli sprite Tactical.

Qualsiasi visual-AI pack futuro deve poter essere rimosso senza rendere Chronosaga ingiocabile.

---

# 15. Acceptance criteria della prima libreria visuale

Prima di produrre grandi volumi, il prototype deve dimostrare:

1. un personaggio mantiene identità riconoscibile in portrait e tactical sprite;
2. almeno outfit/equipment/injury possono cambiare senza cambiare identità base;
3. layer modulari si allineano correttamente;
4. sprite statici sono leggibili alla camera reale del gioco;
5. un personaggio può muoversi da A a B tramite code-driven motion senza walk cycle obbligatoria;
6. almeno un attacco è chiaramente leggibile tramite transform + FX + sound senza sprite-sheet animation obbligatoria;
7. hit e incapacitation comunicano lo stato in modo chiaro;
8. nomenclatura/metadata sono deterministici;
9. asset possono essere caricati da un manifest/adapter;
10. un asset mancante degrada con placeholder controllato, non crasha il save;
11. source/master e game-ready restano separati;
12. provenance/licenza sono tracciabili;
13. non serve image generation durante il gameplay;
14. non serve una pipeline di migliaia di animation frame per rendere il Tactical prototype giocabile;
15. il prototipo misura se pose o direzioni aggiuntive danno un valore sufficiente a giustificarne il costo.

## 15.1 Primo prototype visuale raccomandato

Prima di produrre una libreria ampia, realizzare **un solo personaggio end-to-end**:

```text
1 persistent character identity
+ portrait
+ static tactical sprite
+ outfit variant
+ weapon variant
+ injury/scar variant
+ MOVE motion
+ ATTACK motion/FX
+ HIT feedback
+ DOWN/incapacitated presentation
```

Se questo prototipo funziona, diventa il riferimento per la futura produzione AI-assisted degli asset.

---

# 16. Decisioni

```text
AI-GENERATED AUTHORING LIBRARY        APPROVED
RUNTIME IMAGE GENERATOR IN V1         NOT REQUIRED / DEFERRED
MODULAR CHARACTER SPRITES             APPROVED ARCHITECTURE
PERSISTENT VISUAL IDENTITY             LOCKED PRINCIPLE
PORTRAIT + SPRITE + STRATEGIC ICON     APPROVED
RAW AI BATCHES OUTSIDE NORMAL GIT      LOCKED
STATIC ASSETS + CODE-DRIVEN MOTION     LOCKED BASELINE
MOTION + FX + SOUND FOR ACTION         LOCKED BASELINE
TRADITIONAL FRAME ANIMATION            NOT REQUIRED / OPTIONAL LATER
SMALL STATIC POSE SETS                 OPTIONAL
SINGLE/MINIMAL DIRECTION BASELINE      APPROVED
4 DIRECTIONS                           OPTIONAL AFTER PROTOTYPE
8 DIRECTIONS                           OPTIONAL / LATER
ASSET COMPILER AUTOMATION              APPROVED DIRECTION
SYSTEM-FIRST STRATEGY REFERENCES       APPROVED PRINCIPLE
FINAL SPRITE RESOLUTION                OPEN
FINAL ART STYLE IMPLEMENTATION         PROVISIONAL UNTIL PROTOTYPE
```
