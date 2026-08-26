# GAMEPLAY QUALITY PROOF v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-26  
**Stato:** Product/gameplay gate specification  
**Base tecnica:** `develop@10ea07c54327f363211921e7f3104c1cade6e638` (M1 completato)  
**Relazione con i documenti esistenti:** questo documento NON sostituisce `PRODUCT_VISION_LOCKED_v1.md` o `GAME_SYSTEMS_SCHEMA_v0.1.md`. Introduce un gate operativo tra M1 e l'espansione M2. Quando una formulazione qui restringe temporaneamente lo scope, la restrizione vale per il Gameplay Quality Proof, non cambia il target finale di prodotto.

---

# 0. Perché esiste questo documento

M1 ha dimostrato che il primo loop sistemico reale funziona tecnicamente nell'app Windows:

```text
NEW / LOAD
→ EVENT / CHOICE
→ deterministic resolve
→ StateDelta
→ WORLD TICK
→ systemic reaction
→ SAVE
→ close / reopen
→ LOAD same authoritative state
→ continue
```

Questo è necessario ma non sufficiente.

Il playtest corrente non soddisfa ancora il livello minimo desiderato di:

- divertimento;
- tensione;
- profondità decisionale;
- attachment ai personaggi;
- sorpresa coerente;
- desiderio di fare un altro turno.

Il rischio principale adesso non è tecnico. È costruire 20–30 eventi, tactical combat, economia più ampia e AI narrativa sopra un loop che rimane piatto.

Per questo viene introdotto un gate esplicito:

> **Chronosaga non espande M2 finché un piccolo sistema interconnesso non dimostra di produrre decisioni difficili, conseguenze leggibili, personaggi memorabili e curiosity debt.**

---

# 1. Fonti di design e livello di evidenza

Questa specifica sintetizza tre ricerche comparative svolte dopo M1 su:

1. meaningful choice, trade-off, uncertainty e delayed consequences;
2. character attachment, memory, relationships e social propagation;
3. pacing, clocks, directed emergence, crisis arcs e “one more turn”.

I casi studio principali includono RimWorld, Dwarf Fortress, Crusader Kings, Frostpunk, Against the Storm, Wildermyth, XCOM, Battle Brothers, Darkest Dungeon, Citizen Sleeper, Victoria 3, The Sims, Kenshi e Football Manager.

Le ricerche combinano:

- developer/GDC/postmortem evidence;
- academic/design research;
- player/community evidence;
- design inference applicata a Chronosaga.

**Regola:** le proposte specifiche di questo documento sono decisioni di design per Chronosaga, non affermazioni sugli internals dei giochi studiati.

---

# 2. Design thesis

## 2.1 Formula di valore

Chronosaga non deve ottimizzare per il numero di sistemi.

Deve ottimizzare per:

```text
interesting decisions per meaningful unit of play
×
causal readability
×
character attachment
×
long-term consequence
×
coherent surprise
```

Ogni nuovo sistema deve rispondere:

> **Quale decisione interessante crea? Quale storia rende possibile? Quale conseguenza rende leggibile?**

Se non esiste una risposta concreta, il sistema non entra nel proof.

## 2.2 Loop desiderato

```text
PRESSURE
   ↓
SIGNAL / WARNING
   ↓
DILEMMA
   ├──────────────┬──────────────┐
   ↓              ↓              ↓
RESOURCE       CHARACTER       FACTION
   │              │              │
   │           MEMORY         GRIEVANCE /
   │              │           DESIRE
   └──────────────┼──────────────┘
                  ↓
                CLOCK
                  ↓
        DELAYED CONSEQUENCE
                  ↓
        CALLBACK / NEW ELIGIBILITY
                  ↓
        RECOVERY OR ESCALATION
                  ↓
             NEW PRESSURE
```

Il giocatore deve percepire non solo che “i numeri sono cambiati”, ma:

> “Ho fatto X, quella persona/fazione lo ricorda, e ora il problema Y esiste in una forma diversa.”

---

# 3. Gameplay Quality Principles — LOCKED FOR PROOF

## GQP-1 — No dominant choice

Ogni major dilemma deve evitare un'opzione chiaramente dominante in condizioni normali.

Ogni opzione principale deve possedere almeno:

- un beneficio reale;
- un costo reale;
- una conseguenza futura plausibile o una porta chiusa/aperta.

## GQP-2 — Multi-layer consequence

Una major choice deve influenzare almeno **tre** dei seguenti layer:

- resource/settlement;
- character;
- relationship/memory;
- faction grievance/desire;
- clock/pressure;
- future event eligibility;
- recovery options.

Una scelta che produce soltanto `resource -X / satisfaction +Y` non è sufficiente.

## GQP-3 — Known / Risk / Unknown

Prima di una major choice il giocatore deve distinguere:

- **KNOWN** — conseguenze o costi certi;
- **RISK** — categorie di rischio leggibili ma non outcome esatto;
- **UNKNOWN** — dettagli futuri realmente ignoti.

Un outcome grave non può emergere “dal nulla” se il giocatore non ha ricevuto almeno un segnale coerente.

## GQP-4 — Delayed consequence needs breadcrumbs

Una conseguenza importante ritardata deve avere almeno uno dei seguenti:

- warning intermedio;
- character callback;
- clock stage change;
- faction bulletin;
- recap causale;
- event subtitle/tooltip che richiama la causa.

## GQP-5 — Characters are causal actors

Un personaggio importante non è una scheda statistica. Deve poter:

- proporre;
- avvertire;
- rifiutare;
- aiutare;
- nascondere/rivelare informazione;
- cambiare disponibilità in base a memoria/relazioni;
- lasciare il settlement o perdere il proprio ruolo quando lo stato lo giustifica.

Non tutti questi comportamenti devono esistere per ogni personaggio, ma almeno uno deve essere osservabile nel proof.

## GQP-6 — Factions are not only reputation bars

`FactionState.reputation` può continuare a esistere per compatibilità/aggregazione, ma non può essere il driver unico del comportamento nel proof.

Le due fazioni devono possedere almeno:

- material interest;
- short-term desire;
- major grievance(s);
- escalation condition;
- compromise condition.

## GQP-7 — Elastic failure

Un errore normale deve produrre una nuova situazione, non soltanto una spirale inevitabile.

Ogni major pressure deve offrire almeno una recovery path finché non viene raggiunto un vero stato di collasso causato da accumulo di decisioni/stato.

## GQP-8 — Quiet turns are gameplay

Non ogni turno deve presentare una major choice.

Un quiet turn può contenere:

- consequence surfacing;
- recovery;
- planning;
- resource redistribution;
- small character interaction;
- recap;
- foreshadowing.

Il turno deve però mantenere almeno una tensione o opportunità leggibile.

## GQP-9 — Curiosity debt

Durante la maggior parte della sessione deve esistere almeno una domanda aperta significativa:

- “Rian aveva ragione sul guasto?”
- “Lira reagirà al mio decreto?”
- “La FCL userà il debito contro di me?”
- “La crisi sanitaria è davvero sotto controllo?”

Il target di engagement è **voglio vedere cosa succede**, non **devo fare ancora grind**.

## GQP-10 — Determinism remains non-negotiable

Simulation Core e selezione di gameplay devono restare replayable.

Qualunque pseudo-randomness usata dal proof deve essere:

- seedata;
- deterministica;
- riproducibile.

Per la prima implementazione è preferibile **nessun jitter nuovo** se l'incertezza emerge già dall'interazione dei sistemi.

---

# 4. Exact experiment scope

Il Gameplay Quality Proof non è M2 completo.

Target:

```text
1 settlement
5 important characters
2 factions
4 focal resources
3 major pressure clocks
8 event families/templates
~6 pattern detectors
12–15 player turns
persistent save/load
procedural/grounded text sufficient
0 generative AI required
0 tactical combat required
```

## 4.1 Focal resources

Per il proof:

- water;
- energy;
- food;
- medicine.

Questo NON revoca il target product-wide di 8–10 risorse principali indicato nel sistema generale. Il proof usa un subset per validare la qualità decisionale senza aumentare il carico cognitivo.

## 4.2 Experimental scenario

Working name: **Helioford**.

Nome, lore e cast sono **PROVISIONAL** e non costituiscono canon lock.

Il proof deve essere implementabile come scenario separato/gated, senza distruggere il baseline M1 già accettato.

---

# 5. Character model minimo

Il modello deve essere piccolo e causalmente utile.

Per ogni important character:

```text
identity
role
core value
current goal
vulnerability / fear
1–2 key relationships
salient memories
current pressure
faction connection
```

## 5.1 Rule: every field creates behavior

Ogni campo aggiunto deve modificare almeno uno di:

- event eligibility;
- option availability;
- character proposal;
- warning;
- refusal/help;
- social propagation;
- callback text;
- recovery path.

Campi puramente decorativi non fanno parte del proof.

## 5.2 Salient memory

Il current `CharacterMemory` contract già conserva `id`, `summary`, `tags`, Player Turn e `CausalSource`.

Il proof deve estendere la semantica in modo minimale per poter rappresentare, direttamente o attraverso campi/tag strutturati:

- target/subject;
- valence: positive / negative / ambivalent;
- salience;
- visibility/knowledge origin quando necessario;
- behavior hook;
- callback eligibility.

Non fissare a priori un numero universale di memorie. Target operativo: **pochi ricordi salienti e percepibili**. Se tre ricordi producono più gameplay di venti, tre sono preferibili.

Memorie ripetitive devono poter consolidarsi concettualmente:

```text
three isolated rationing grievances
→
"Player repeatedly rationed my district"
```

La strategia esatta di consolidamento è PROVISIONAL.

## 5.3 Character pressure

Usare gli stati esistenti (`stress`, `morale`) dove possibile prima di aggiungere nuove barre.

Il proof non introduce un life-sim di needs granulari.

---

# 6. Cast minimo — PROVISIONAL CONTENT

## EDDA — Steward

- **Role:** settlement steward / governance.
- **Core value:** stabilità collettiva.
- **Current goal:** evitare una crisi di legittimità.
- **Vulnerability:** burnout e paura di perdere il controllo istituzionale.
- **Key relation:** fiducia funzionale con Rian; tensione politica con Lira.
- **Faction connection:** interlocutrice naturale del Council of Order.

## RIAN — Infrastructure Engineer

- **Role:** acqua/energia/manutenzione.
- **Core value:** integrità tecnica; non nascondere rischi strutturali.
- **Current goal:** stabilizzare la rete.
- **Vulnerability:** senso di colpa se un guasto evitabile provoca danni.
- **Key relation:** rapporto professionale con Edda; può essere influenzato da chi protegge il sistema rispetto alla politica.
- **Faction connection:** corteggiato da entrambe le parti per la sua competenza.

## MARA — Medic

- **Role:** clinica/triage.
- **Core value:** non usare vite vulnerabili come semplice variabile di efficienza.
- **Current goal:** mantenere la clinica operativa.
- **Vulnerability:** trauma da triage e scarsità.
- **Key relation:** forte legame con Lira.
- **Faction connection:** diffidente verso imposizioni che sacrificano pazienti per ordine/produzione.

## JACE — Quartermaster / Fixer

- **Role:** magazzini, scambi, canali informali.
- **Core value:** preservare margine di manovra.
- **Current goal:** consolidare una rete di scambi/debiti.
- **Vulnerability:** esposizione a ricatto/indagine.
- **Key relation:** rapporto ambiguo con Edda; conflitto potenziale con Rian sui workaround.
- **Faction connection:** legami opachi con Free Conduit League.

## LIRA — Community Advocate

- **Role:** rappresentanza informale/comunicazione politica.
- **Core value:** equità e legittimità percepita.
- **Current goal:** ottenere trasparenza e voce nelle decisioni.
- **Vulnerability:** impulsività; può trasformare protesta legittima in escalation.
- **Key relation:** legame forte con Mara; tensione con Edda.
- **Faction connection:** simpatia per autonomia locale ma non subordinazione automatica alla FCL.

## 6.1 Attachment gate

Almeno due personaggi devono, entro 12–15 turni, produrre una reazione futura che il giocatore possa prevedere **per i motivi giusti** sulla base di valore, memoria o relazione.

---

# 7. Relationship model minimo

Non costruire una matrice psicologica ad alta dimensionalità.

Per il proof ogni relazione importante richiede:

```text
sourceCharacterId
 targetCharacterId
 type
 strength: low | medium | high
 publicKnowledge: boolean / derived visibility
```

Tipi iniziali sufficienti:

- ally/friend;
- family/close bond;
- rival;
- authority/dependent;
- debt/obligation.

La lista definitiva può essere più piccola se il scenario non usa tutti i tipi.

## 7.1 Social propagation

Una reazione non si propaga magicamente.

Canali ammessi:

1. **direct** — il personaggio è target diretto;
2. **witness** — ha assistito o ricevuto informazione esplicita;
3. **strong relationship** — evento saliente su A può creare memoria riflessa in B;
4. **public action** — decreto/assemblea/bulletin può diventare conoscenza di fazione;
5. **discovery** — un segreto diventa pubblico attraverso evento specifico.

Per il proof la propagazione massima normale è 1–2 hop.

Nessun global opinion delta automatico per una scelta segreta.

---

# 8. Faction model minimo

Fazioni sperimentali:

## Council of Order — CO

- **Material interest:** rete critica stabile, tributi/standard, controllo istituzionale.
- **Ideology:** centralizzazione, disciplina, prevedibilità.
- **Short desire:** Helioford rimane affidabile.
- **Fear:** autonomia incontrollata / scandalo / instabilità.
- **Compromise:** risultati tecnici verificabili e stabilità.
- **Escalation:** violazioni pubbliche ripetute, promesse infrante, dipendenza manifesta dalla FCL.

## Free Conduit League — FCL

- **Material interest:** accesso indipendente a energia e scambi.
- **Ideology:** autonomia, reti locali, pragmatismo.
- **Short desire:** ottenere accesso/diritti informali o formali a Helioford.
- **Fear:** blocco CO e perdita di contatti.
- **Compromise:** crisi condivise e vantaggio reciproco.
- **Escalation:** tradimento di accordi, repressione dei propri contatti, chiusura totale.

## 8.1 Structured grievance/desire

Il proof deve poter esprimere concettualmente:

```text
Faction grievance:
  id
  cause/source
  subject
  severity
  persistence
  compromise condition

Faction desire:
  id
  target/outcome desired
  urgency
  cause
  fulfillment condition
```

`reputation` può essere mantenuta come metrica aggregata/backcompat, ma un evento politico importante deve poter spiegare **quale grievance/desire** lo rende possibile.

---

# 9. Three major pressure clocks

Clocks del proof:

1. **EPIDEMIC**
2. **INFRASTRUCTURE**
3. **LEGITIMACY**

Non introdurre `AUDIT` come quarto clock iniziale. Un audit può essere una situazione/evento derivato da secret actions + CO grievance + discovery/evidence.

## 9.1 Clock semantics

Ogni clock deve possedere:

- internal deterministic value/stage;
- visible qualitative stage;
- multiple causes;
- at least two player levers;
- threshold signals/events;
- causal contributors surfaced in UI.

Suggested visible stages:

```text
STABLE
STRAINED
CRITICAL
CRISIS
```

Il valore numerico interno è PROVISIONAL. L'UI normale non deve necessariamente mostrare il numero esatto.

## 9.2 Clock agency

Ogni clock deve offrire almeno due forme di interazione tra:

- buy time;
- accelerate resolution with cost/risk;
- trade one pressure for another;
- accept damage and preserve another priority.

Un clock che avanza soltanto per tick senza leva del giocatore non soddisfa il proof.

## 9.3 Clock causality example

```text
INFRASTRUCTURE: CRITICAL

Contributors:
- deferred maintenance after player choice E02
- unregistered conduit load
- recent emergency energy draw

Mitigation available:
- shut down clinic wing temporarily
- request CO technical team
- accept FCL component shipment
```

Il testo è illustrativo; i valori devono provenire dal Core.

---

# 10. Event taxonomy minima

Per il proof sono sufficienti sei categorie funzionali:

1. **SIGNAL** — warning/foreshadowing, normalmente no major choice;
2. **OPPORTUNITY/REQUEST** — leva o offerta, decisione media;
3. **DILEMMA** — trade-off significativo;
4. **COMPLICATION** — problema esistente cambia forma o perde una soluzione facile;
5. **CRISIS/PAYOFF** — soglia/culmine, conseguenza forte o scelta critica;
6. **AFTERMATH** — recovery, recap, role/faction consequences.

Ambient flavour senza gameplay può esistere come presentation layer e non richiede una categoria autorevole dedicata nel proof.

---

# 11. Eight event families — PROVISIONAL

Le famiglie sono strumenti di test, non quest line.

## E01 — Water for the Sick

Core conflict: clinic survival vs strategic water reserve / general rationing.

Must touch:

- water/medicine;
- Mara/Lira or Rian memory;
- EPIDEMIC;
- LEGITIMACY or future eligibility.

## E02 — Priority Maintenance

Core conflict: spend scarce capacity now vs preserve short-term services/growth.

Must touch:

- energy/capacity;
- Rian behavior/memory;
- INFRASTRUCTURE;
- future blackout/repair eligibility.

## E03 — Unregistered Conduit

Core conflict: immediate energy margin vs institutional/faction dependency risk.

Must touch:

- energy;
- Jace;
- FCL desire;
- secret/public knowledge;
- possible future discovery/audit situation.

## E04 — Clinic Triage

Core conflict: protect vulnerable people vs protect critical productive/technical capacity.

Must touch:

- medicine;
- Mara;
- at least one other character/role;
- EPIDEMIC or INFRASTRUCTURE;
- social legitimacy.

## E05 — Public Assembly

Core conflict: political voice/transparency vs control/escalation risk.

Must touch:

- Lira/Edda;
- public knowledge propagation;
- LEGITIMACY;
- faction future options.

## E06 — Rationing Disclosure

Core conflict: transparent pain vs short-term concealment/control.

Must touch:

- food/water pressure;
- public promise/knowledge;
- LEGITIMACY;
- later callback if concealment is discovered.

## E07 — External Rescue

Core conflict: recover now vs dependency/leverage later.

Must be conditional on prior history, not guaranteed.

Possible providers: CO or FCL depending on grievances/desires and earlier choices.

## E08 — Governance / Systemic Payoff

Not a fixed final event.

Family of variants generated by state such as:

- institutional compromise;
- dependency crisis;
- local legitimacy challenge;
- technical emergency with political consequences;
- recovery pact.

The exact variant must be eligible because of accumulated state/patterns.

## 11.1 Mandatory network properties

Across these families:

- at least 2 families can be skipped entirely by good/bad prior state;
- at least 3 change options or framing based on prior memories/grievances;
- at least 2 early costly decisions can produce later positive payoff;
- at least 2 apparently useful decisions can create later complications;
- no fixed E01→E02→...→E08 sequence.

---

# 12. Pattern detection — minimum set

Start with approximately six deterministic detectors:

```text
IGNORED_ENGINEER_WARNINGS
REPEATEDLY_PROTECTED_VULNERABLE
FACTION_DEPENDENCY_GROWING
PUBLIC_PROMISE_BROKEN
SECRET_ACTION_DISCOVERED
CHARACTER_CAUGHT_BETWEEN_LOYALTIES
```

Each pattern must specify:

- exact authoritative inputs;
- pure deterministic predicate;
- which event families/variants it can make eligible or reprioritize;
- causal source(s) for explanation.

A pattern detector detects **story potential**. It does not fabricate an outcome.

---

# 13. Event eligibility authority

`packages/game-core` remains authority for:

- world state;
- clock progression;
- memories;
- relationships;
- faction grievances/desires;
- delayed consequences;
- pattern predicates;
- event eligibility;
- authoritative choice resolution;
- StateDelta;
- World Tick.

React must not implement eligibility arithmetic or hidden simulation rules.

Rust/Tauri remains platform/persistence authority only.

---

# 14. Deterministic Story Director

The proof may introduce a small Director, but the name **non-authoritative** must not be misread as “free to be nondeterministic”.

The Director does not mutate WorldState outcomes, but its selection affects which decision the player sees. Therefore selection must be replayable.

## 14.1 Director requirements

Director may:

- receive the Core-produced eligible event set;
- select which eligible event receives focus now;
- permit a quiet turn when no urgent event must surface;
- prefer causal relevance;
- prefer novelty;
- rotate character focus;
- prefer ready payoff/complication when appropriate;
- select a relevant causal callback.

Director may NOT:

- invent eligibility;
- modify resources/clocks/memories/relationships/factions;
- create a StateDelta;
- hide a mandatory crisis beyond its fairness window;
- use an LLM to choose gameplay state.

## 14.2 Determinism contract

Director output must be either:

1. a pure deterministic function of authoritative persisted/derivable state/history; or
2. explicitly persisted as part of replayable gameplay scheduling state.

There must be **no hidden mutable Director state** required to reproduce a run.

Tie-breaks must be stable, e.g. deterministic event ID ordering or seeded deterministic RNG.

## 14.3 Provisional priority model

Exact weights are playtest material, not locked product math.

Conceptual score:

```text
priority = urgency
         + causal_relevance
         + payoff_readiness
         + novelty
         + character_focus_value
         - repetition_penalty
         - fatigue_penalty
```

Stable tie-break required.

## 14.4 Quiet-turn rule

The Director should be able to output “no major event now” when:

- no mandatory threshold event is due;
- recent turns already contained high-attention decisions;
- consequence/recovery surfacing is more valuable than another dilemma.

---

# 15. Pacing target

The proof should NOT hardcode an exact event rhythm, but target approximately:

```text
12–15 Player Turns
4–6 major dilemmas
1–2 crisis/payoff moments
several signals/consequences
3–5 quiet/recovery turns
```

A useful reference density:

```text
DILEMMA
→ CONSEQUENCE
→ QUIET / PREPARATION
→ SIGNAL
→ DILEMMA
→ CONSEQUENCE
→ QUIET WITH ANTICIPATION
→ COMPLICATION
→ DILEMMA
→ SIGNAL
→ CRISIS
→ AFTERMATH
```

The actual sequence must emerge from eligibility/state, not from turn number scripting.

---

# 16. Causal callback UI

The player must be able to reconstruct cause without opening a raw debug log.

Minimum presentation mechanisms:

- character quote referencing an earlier choice;
- clock tooltip listing top causal contributors;
- faction bulletin naming a grievance/desire source;
- event subtitle such as “Consequence of the maintenance decision” when appropriate;
- compact turn recap with 1–2 causal chains;
- memory card on character sheet.

## 16.1 Normal vs Analysis UI

Consistent with the existing product vision:

**Normal UI:**

- readable stage;
- human explanation;
- qualitative risk;
- concise callback.

**Analysis UI:**

- exact source IDs;
- rule/pattern name;
- contributing values;
- StateDelta linkage;
- deterministic eligibility explanation.

This simultaneously supports immersion and auditability.

---

# 17. AI boundary for the proof

Generative AI is **not required** to pass the Gameplay Quality Proof.

Procedural/authored grounded text is sufficient.

If a local AI narration spike is added later, it may receive a structured packet containing only authoritative facts such as:

```text
character identity / role
core value
current goal
current pressure
1–2 salient memories
1–2 key relationships
faction context
current event
recent authoritative StateDelta
```

AI may:

- phrase dialogue;
- summarize consequences;
- add short grounded connective tissue.

AI may NOT:

- choose event eligibility;
- choose Director selection;
- create authoritative memories;
- change relationships;
- change clocks/resources;
- invent a supported option;
- decide an outcome.

---

# 18. Recovery design

Each major pressure requires at least one non-trivial recovery route.

Examples:

- EPIDEMIC: spend medicine + lose productive capacity; request external supply with leverage cost; isolate affected district with legitimacy cost.
- INFRASTRUCTURE: shut down services; accept faction technical dependency; consume strategic resource stock.
- LEGITIMACY: public concession; fulfill a promise; allow assembly; sacrifice institutional flexibility.

Recovery cannot be a free “heal” button.

It must itself create a decision, cost, relationship or future dependency.

---

# 19. Loss without requiring permadeath

The proof does not require a full death/succession system.

Character loss may be tested through:

- departure;
- resignation;
- removal from role;
- injury that prevents current duties;
- faction defection.

A loss is meaningful only if at least two consequences are visible:

- role becomes unavailable/degraded;
- another character reacts;
- event option disappears/changes;
- memory/biography records the loss;
- faction situation changes.

Example:

```text
Rian leaves Helioford
→ engineer role vacant
→ early infrastructure warning unavailable
→ Mara remembers why he left
→ a later repair option changes
```

---

# 20. Definition of Fun — first human gate

This is not a claim that “fun” can be reduced to telemetry. These gates exist to prevent self-deception.

For the **first real human/founder playtest** of a 12–15 turn run, the proof does not pass unless all critical criteria below are met:

## Critical

1. **Meaningful hesitation** — at least 2 major choices caused genuine hesitation beyond reading time.
2. **Causal recall** — tester can explain at least 2 later situations as consequences of earlier choices.
3. **Character recall** — tester can describe at least 3/5 characters by more than role/name alone; at least 2 descriptions include value, memory, vulnerability or relationship.
4. **Behavior prediction** — before one important NPC response, tester can predict the likely reaction for a character-based reason.
5. **Strategy change** — at least once the tester deliberately changes plan because the world reacted.
6. **Fair uncertainty** — no major negative outcome is judged to have appeared without a reasonable prior signal.
7. **One-more-turn** — at least once the tester genuinely wants to continue primarily to see how an unresolved situation develops.

## Strong positive signals

- regret about at least one defensible choice;
- coherent surprise;
- attachment/loss aversion toward at least one character;
- spontaneous story retelling after the run;
- different plausible strategy desired for a replay.

If critical criteria fail, iterate the proof. Do not compensate by adding content volume.

---

# 21. Small-sample validation gate

After the founder gate passes, test with a small independent sample before broad M2 expansion.

Target: **minimum 5 independent testers**. Percentages below are directional, not statistical proof.

Desired signals:

- ≥70% can link at least one late consequence to an earlier decision;
- ≥70% want at least 3 more turns at session end;
- ≥60% report at least one coherent surprise;
- ≥60% correctly predict at least one NPC reaction for the right reason;
- ≥70% remember at least 2 characters beyond role/name;
- ≥50% report a deliberate strategy change;
- event/crisis fatigue remains minority feedback;
- no repeated complaint that outcomes feel arbitrary.

Failure means redesign/tuning before M2 content expansion.

---

# 22. Instrumentation

For playtest builds log deterministically:

- Player Turn / World Tick;
- presented event ID/variant;
- eligible event IDs at selection time;
- Director score/reason where applicable;
- choice ID;
- choice decision time (UI telemetry only, not gameplay authority);
- StateDelta;
- clock before/after;
- created/updated salient memories;
- created/cleared grievances/desires;
- delayed consequence source;
- causal callback shown;
- save/load continuity.

Telemetry must not change authoritative simulation results.

---

# 23. Anti-pattern rejection gates

Reject or redesign a feature/event if it exhibits any of these:

- obvious dominant option after one run;
- choice changes wording but not state trajectory;
- punishment disguised as choice;
- moral answer with no real competing interest;
- global hive-mind reaction to secret action;
- reputation-only political consequence;
- memory stored but never able to affect behavior;
- character personality reset between events;
- major delayed outcome with no breadcrumb;
- repeated crisis family without state-sensitive variation;
- quiet turn that contains neither recovery, planning, consequence nor anticipation;
- recovery with no cost;
- new system whose primary effect is dashboard complexity;
- AI prose promising mechanics the Core does not implement.

---

# 24. Compatibility with existing M1 contracts

Current M1 already provides valuable foundations:

- `CharacterMemory` with causal source and Player Turn;
- `CharacterState` with role, stress, morale, traits and memories;
- `FactionState` with influence/reputation/resources/relations/memory tags;
- `SettlementState` with stability/satisfaction/resourceStock;
- `DelayedConsequenceState` with trigger turn/source/effects;
- separate Player Turn and World Tick;
- `GameEvent` / `EventChoice` requirements/effects;
- `StateDelta`;
- validated persistent `WorldState`.

The proof should **extend these contracts minimally**, not replace them wholesale.

Implementation must decide, with tests, whether new proof data can be represented as backward-compatible optional fields or requires a systemic schema version change. Do not bump schemas casually; do not overload opaque string flags when structured data is required for deterministic behavior.

---

# 25. Implementation slicing

No large-bang implementation.

## GQP-A — Contract & deterministic scenario foundation

Deliver:

- proof scenario isolated from M1 baseline;
- minimal character value/goal/vulnerability/relationship representation;
- structured faction grievance/desire representation;
- 3 clocks;
- validation/persistence/replay coverage;
- no UI ambition beyond inspectability.

Exit: state can round-trip and replay deterministically.

## GQP-B — Meaningful choice network

Deliver:

- first 4 event families;
- multi-layer effects;
- salient memory behavior hooks;
- social propagation rules;
- delayed consequences with causal breadcrumbs;
- recovery paths.

Exit: at least two clearly different deterministic trajectories from same starting seed/alternative choices.

## GQP-C — Directed pacing

Deliver:

- remaining event families required for proof;
- pattern detectors;
- deterministic eligible queue selection;
- novelty/cooldown;
- quiet turns;
- causal callback selection;
- Normal/Analysis explanation surfaces.

Exit: 12–15 turn reference runs do not require a hardcoded event sequence and produce materially different stories under different choices.

## GQP-D — Real Windows playtest build

Deliver:

- installed-app lifecycle remains valid;
- exact proof scenario playable through real UI;
- telemetry captured;
- founder playtest performed;
- Definition of Fun scored honestly.

Exit: PASS / ITERATE decision.

---

# 26. Explicit non-goals until proof passes

Do NOT build for this proof:

- tactical combat;
- warfare expansion;
- 20–30 event content expansion;
- multi-settlement simulation;
- detailed market/trade economy;
- 8–10-resource balancing pass;
- granular Sims-style needs;
- high-dimensional personality model;
- full genealogy;
- complex law tree;
- full faction internal subgroups;
- generative Story Director;
- AI-generated authoritative events/outcomes;
- large visual/art production pass;
- meta-progression;
- final campaign balance.

These remain valid future product areas. They are deliberately gated.

---

# 27. Relationship to M2

The existing roadmap says M2 must demonstrate:

```text
PLAYER CHOICE
→ RESOLUTION
→ StateDelta
→ ECONOMIC / FACTION EFFECT
→ NPC MEMORY
→ DELAYED CONSEQUENCE
→ NEW EVENT
```

and explicitly states that if this chain is not interesting, the number of systems should not be expanded.

This document operationalizes that sentence.

New sequence:

```text
M1 COMPLETE
   ↓
GAMEPLAY QUALITY PROOF
   ↓
FOUNDER FUN GATE
   ↓
SMALL-SAMPLE GATE
   ↓
M2 EXPANSION
```

M2 remains the next larger gameplay milestone; it is not cancelled. Its content/tactical expansion is blocked until the quality gate demonstrates a fun systemic core.

---

# 28. Definition of Done for GAMEPLAY QUALITY PROOF

The proof is DONE only when all are true:

1. exact Windows build is playable and persists/reloads correctly;
2. same seed + same choices reproduces authoritative state and event selection;
3. alternative choices produce at least two materially different trajectories;
4. at least two major delayed consequences are causally recognized by tester;
5. at least two characters demonstrate memory/relationship-driven future behavior;
6. no major faction reaction depends only on a reputation scalar;
7. at least one setback creates a meaningful recovery decision;
8. pacing includes real quiet/recovery turns without feeling empty;
9. founder Definition of Fun critical gate passes;
10. no P1/P2 correctness/replay/persistence issue remains;
11. only after this, schedule small-sample validation and M2 expansion.

---

# 29. Product success hypothesis

The proof is based on one falsifiable hypothesis:

> **A small number of deeply coupled deterministic systems can make Chronosaga compelling before content scale, tactical combat or generative AI are added.**

If the proof fails, the correct response is not to add more events or more systems.

The correct response is to identify which link is weak:

```text
DILEMMA
CHARACTER
CAUSALITY
PRESSURE
RECOVERY
PACING
```

and iterate that link.

If the proof passes, Chronosaga has evidence that its architecture is capable not merely of simulating a persistent world, but of producing the experience promised by `PRODUCT_VISION_LOCKED_v1.md`: a complex intelligent system, difficult consequential decisions, an unpredictable world and unique emergent stories.
