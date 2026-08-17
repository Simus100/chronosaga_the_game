# VISUAL ASSET PIPELINE v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Stato:** Approved visual-production architecture  
**Ambito:** portrait, sprite, equipment, environment, visual identity persistence

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

---

# 6. Pipeline sorgente → game-ready

## A. Source generation

Possibili output sorgente:

- concept art;
- character sheet;
- front/side/back reference;
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
- frame alignment;
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

---

# 7. Animazioni tactical

Set minimo PROVISIONAL da validare col primo prototype:

```text
idle
move / walk
attack / fire
hit
incapacitated / death
interaction
```

Direzioni/inquadrature possibili:

```text
4-direction baseline
oppure
8-direction se il valore visivo giustifica costo e peso
```

La scelta 4 vs 8 direzioni è OPEN fino al Tactical visual prototype.

Non produrre in anticipo migliaia di frame prima di aver validato camera, scala e leggibilità.

---

# 8. Environment procedural composition

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

---

# 9. Directory esterne consigliate

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

# 10. Git policy per asset visuali

Piccoli asset game-ready appropriati possono entrare in `assets/` se:

- sono necessari per source/build/test;
- dimensione ragionevole;
- provenienza e uso sono chiari;
- non trasformano la repo in un asset archive multi-GB.

Le grandi librerie devono essere gestite come pack esterni/versionati e descritte da manifest/checksum.

Raw AI generations e master pesanti non vanno nel normale Git.

---

# 11. Metadata minimi

Per un asset/pack approvato, dove applicabile:

```text
assetId
category
version
source/master identity
character/faction compatibility
frame/direction metadata
dimensions
anchor
license/provenance
SHA-256
pack name
status: source / approved / game-ready / deprecated
```

Gli ID devono essere stabili per evitare che un aggiornamento grafico rompa save o identità dei personaggi.

---

# 12. Relazione con il Simulation Core

Il Game Core conserva ID e stato visualmente rilevante, non immagini generate.

Esempio:

```text
CharacterState
  characterId
  equipment IDs
  injury IDs
  faction/rank
  persistent visual descriptor ID
        ↓
Visual Asset Adapter / Renderer
        ↓
portrait / sprite / strategic icon
```

Le immagini non decidono lo stato del personaggio. Lo rappresentano.

---

# 13. Runtime image generation futura

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

# 14. Acceptance criteria della prima libreria visuale

Prima di produrre grandi volumi, il prototype deve dimostrare:

1. un personaggio mantiene identità riconoscibile in portrait e tactical sprite;
2. almeno outfit/equipment/injury possono cambiare senza cambiare identità base;
3. layer modulari si allineano correttamente;
4. sprite sono leggibili alla camera reale del gioco;
5. nomenclatura/metadata sono deterministici;
6. asset possono essere caricati da un manifest/adapter;
7. un asset mancante degrada con placeholder controllato, non crasha il save;
8. source/master e game-ready restano separati;
9. provenance/licenza sono tracciabili;
10. non serve image generation durante il gameplay.

---

# 15. Decisioni

```text
AI-GENERATED AUTHORING LIBRARY      APPROVED
RUNTIME IMAGE GENERATOR IN V1       NOT REQUIRED / DEFERRED
MODULAR CHARACTER SPRITES           APPROVED ARCHITECTURE
PERSISTENT VISUAL IDENTITY           LOCKED PRINCIPLE
PORTRAIT + SPRITE + STRATEGIC ICON   APPROVED
RAW AI BATCHES OUTSIDE NORMAL GIT    LOCKED
4 vs 8 DIRECTIONS                    OPEN
FINAL SPRITE RESOLUTION              OPEN
FINAL ART STYLE IMPLEMENTATION       PROVISIONAL UNTIL PROTOTYPE
```
