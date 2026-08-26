# GAMEPLAY QUALITY PROOF v0.1
## Chronosaga: The Game

**Versione:** 0.1 — revisione 2, dopo revisione avversariale di architettura e fattibilità  
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
   │           MEMORY        AGENDA ITEM
   │              │              │
   └──────────────┼──────────────┘
                  ↓
               PRESSURE
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

**Nota sui nomi.** I principi di questa sezione sono numerati `GQP-1` … `GQP-10`. Le slice di implementazione della sezione 25 sono invece `GQP-0`, `GQP-A`, `GQP-B`, `GQP-C`, `GQP-D`. `GQP-0` è una **slice**, non un undicesimo principio: è chiamata così perché precede `GQP-A`, non perché preceda `GQP-1`.

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
- faction agenda item;
- pressure;
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
- pressure stage change;
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

- “Il tecnico aveva ragione sul guasto?”
- “La portavoce reagirà al mio decreto?”
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
1 settlement          Helios Reach (variante del proof)
5 important characters  cast esistente, ruoli funzionali del proof
2 factions
4 focal resources
2 pressures           1 esplicita + 1 derivata
5 event families
4 pattern detectors
12–15 player turns
persistent save/load
procedural/grounded text sufficient
0 generative AI required
0 tactical combat required
```

Lo scope è deliberatamente più piccolo della prima stesura. Un proof che non si può buttare via non è un proof: è già il prodotto.

## 4.1 Focal resources

Per il proof:

- water;
- energy;
- food;
- medicine.

Questo NON revoca il target product-wide di 8–10 risorse principali indicato nel sistema generale. Il proof usa un subset per validare la qualità decisionale senza aumentare il carico cognitivo.

## 4.2 Experimental scenario

Lo scenario è **Helios Reach**, riusato e non sostituito. Vedi sezione 6.

Il proof deve essere implementabile come variante separata e gated, senza distruggere il baseline M1 già accettato e validato sull'app Windows installata.

## 4.3 Stato P0 — nota di contesto

Per evitare ambiguità di stato: la fattibilità P0 è **già accettata** ai fini del gameplay. La qualificazione di release e hardware, e lo stato `releaseApproved` dei modelli, restano preoccupazioni separate e deliberatamente differite. Questo documento non riapre P0 e non modifica la storia della roadmap.

---


# 5. Character model minimo

Il modello deve essere piccolo e causalmente utile.

Per ogni important character:

```text
identity
role
core value
current goal
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

## 5.2 Semantica autoritativa nuova — minima

Il proof introduce come stato autoritativo nuovo soltanto:

- `coreValue`;
- `currentGoal`;
- relazioni fra personaggi;
- le aggiunte alla memoria saliente strettamente necessarie.

**`vulnerability` / `fear` non è un campo autoritativo del proof.** Può restare caratterizzazione narrativa e di contenuto quando è derivabile da `coreValue`, `currentGoal`, `stress`, `morale` e memorie. Nessuna decisione del giocatore lo consulta in modo che non sia già coperto da quei valori, e la regola 5.1 esclude i campi che non producono comportamento.

## 5.3 Salient memory

Il contratto `CharacterMemory` attuale conserva già `id`, `summary`, `tags`, Player Turn e `CausalSource`.

Il proof estende la semantica in modo minimale per poter rappresentare:

- target/subject;
- valence: positive / negative / ambivalent;
- salience;
- origine della conoscenza quando necessario;
- behavior hook;
- callback eligibility.

Ciò che governa codice va tipizzato; ciò che è soltanto descrittivo può restare nei tag esistenti.

Non fissare a priori un numero universale di memorie. Target operativo: **pochi ricordi salienti e percepibili**. Se tre ricordi producono più gameplay di venti, tre sono preferibili.

Memorie ripetitive devono poter consolidarsi concettualmente:

```text
three isolated rationing grievances
→
"Player repeatedly rationed my district"
```

Il consolidamento è una **regola** del World Tick, non un effetto d'autore. La strategia esatta è PROVISIONAL e può essere rimandata oltre i 15 turni se non serve prima.

## 5.4 Character pressure

Usare gli stati esistenti (`stress`, `morale`) dove possibile prima di aggiungere nuove barre.

Il proof non introduce un life-sim di needs granulari.

---


# 6. Cast del proof — ruoli funzionali su identità esistenti

## 6.1 Lo scenario è HELIOS REACH

Il proof **non** introduce un mondo nuovo. Usa **Helios Reach**, l'insediamento già esistente e già validato nell'app Windows, con le sue coorti, i suoi gruppi politici, le sue due fazioni e il suo cast.

Il motivo è pratico: un secondo scenario raddoppia il contenuto da mantenere e dimezza l'attenzione, per guadagnare soltanto dei nomi. E il cast esistente ha già memorie funzionanti scritte dal World Tick.

La variante GQP è **derivata** da Helios Reach e ne riusa le identità — id di personaggi e fazioni — dove praticabile.

**Vincolo di protezione del baseline:** non si muta lo scenario baseline soltanto per trasformarne il cast. Il baseline M1 accettato resta invariato e le sue regressioni restano verdi. La variante del proof può assegnare al cast esistente ruoli funzionali, obiettivi e semantica di valore specifici del proof, senza rompere le aspettative di regressione M1.

## 6.2 Ruoli funzionali richiesti

Il proof richiede che ogni personaggio abbia una posizione distinta rispetto alle risorse focali. Questo è ciò che rende possibile la previsione: un personaggio la cui posizione non tocca acqua, energia, cibo o medicine non produce decisioni prevedibili.

Ruoli funzionali necessari, da assegnare al cast esistente:

- **governance / steward** — arbitra fra priorità, porta il costo politico;
- **infrastruttura** — avvisa in anticipo, ricorda gli avvisi ignorati;
- **cura / clinica** — porta la pressione epidemica e il triage;
- **logistica / approvvigionamento** — apre le opzioni informali e i loro debiti;
- **comunità / portavoce** — porta la voce delle coorti e la responsabilità pubblica.

Nomi, lore e attribuzione esatta dei ruoli sono **PROVISIONAL** e non costituiscono canon lock.

## 6.3 Attachment gate

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
```

Tipi iniziali sufficienti:

- ally/friend;
- family/close bond;
- rival;
- authority/dependent;
- debt/obligation.

La lista definitiva può essere più piccola se lo scenario non usa tutti i tipi.

Non è richiesto un campo `publicKnowledge` esplicito sulla relazione: la visibilità che il proof deve rappresentare riguarda le **azioni**, non i legami, ed è coperta dalla sezione 7.1.

## 7.1 Social propagation — tre canali

Una reazione non si propaga magicamente. Il proof ammette **tre** canali:

1. **direct** — il personaggio è il target diretto dell'azione;
2. **strong relationship reflection** — un evento saliente su A può creare una memoria riflessa in B quando esiste una relazione forte;
3. **public / discovered action** — un'azione pubblica, o un'azione segreta resa pubblica da un evento di scoperta deterministico, diventa conoscenza di fazione e di comunità.

Non è previsto:

- un grafo dei testimoni;
- un grafo generale della conoscenza;
- alcun delta di opinione globale automatico per una scelta segreta.

**Le azioni segrete restano locali** finché un evento deterministico di scoperta o di pubblicazione non le espone. È questa asimmetria che rende la trasparenza una scelta invece di un default, ed è ciò che alimenta `SECRET_ACTION_DISCOVERED`.

Per il proof la propagazione massima normale è 1–2 hop.

---


# 8. Faction model minimo

Fazioni sperimentali:

## Council of Order — CO

- **Material interest:** rete critica stabile, tributi/standard, controllo istituzionale.
- **Ideology:** centralizzazione, disciplina, prevedibilità.
- **Short desire:** l'insediamento resta affidabile.
- **Fear:** autonomia incontrollata / scandalo / instabilità.
- **Compromise:** risultati tecnici verificabili e stabilità.
- **Escalation:** violazioni pubbliche ripetute, promesse infrante, dipendenza manifesta dalla fazione autonomista.

## Free Conduit League — FCL

- **Material interest:** accesso indipendente a energia e scambi.
- **Ideology:** autonomia, reti locali, pragmatismo.
- **Short desire:** ottenere accesso o diritti informali all'insediamento.
- **Fear:** blocco istituzionale e perdita di contatti.
- **Compromise:** crisi condivise e vantaggio reciproco.
- **Escalation:** tradimento di accordi, repressione dei propri contatti, chiusura totale.

Nello scenario del proof questi ruoli sono assunti dalle fazioni già esistenti in Helios Reach, riusandone le identità: vedi sezione 6.

## 8.1 FactionAgendaItem — un solo concetto strutturato

Il proof introduce **un** concetto strutturato, non due collezioni parallele:

```text
FactionAgendaItem:
  kind: desire | grievance
  id
  subject
  causal source
  intensity / severity
  satisfy / resolve condition
```

`kind` è una distinzione **semantica reale**, non un segno algebrico. Un desiderio non è un rancore con severità negativa: un desiderio si soddisfa concedendo qualcosa, un rancore si risolve riparando qualcosa, e le due condizioni non sono l'una l'inverso dell'altra. Modellarli come un unico asse numerico renderebbe impossibile distinguere una fazione appagata da una fazione placata.

Una collezione unica evita invece il problema opposto: due tabelle separate che devono restare coerenti a mano.

`reputation` può restare come metrica aggregata e per compatibilità, ma un evento politico importante deve poter spiegare **quale elemento di agenda** lo rende possibile.

## 8.2 Confine con la politica interna

`PoliticalGroupState` resta politica **interna** all'insediamento: coorti, approvazione, linee rosse.

`FactionAgendaItem` resta memoria politica **fra** fazioni ed esterna.

I due livelli non vanno duplicati. Se una regola sta scrivendo la stessa verità in entrambi, uno dei due è il posto sbagliato.

---


# 9. Pressure model — one explicit, one derived

Il proof usa **due** pressioni, non tre.

```text
EPIDEMIC        pressione esplicita, stato autoritativo proprio
INFRASTRUCTURE  pressione derivata dallo stato dei nodi di produzione
```

## 9.1 EPIDEMIC — esplicita

È l'unica pressione che crea un dilemma non esprimibile con lo stato M1 esistente: medicine e acqua competono, e la scelta "curare adesso o prevenire dopo" non ha oggi alcuna rappresentazione.

Requisiti:

- valore interno deterministico e stadio qualitativo visibile;
- cause multiple: penuria d'acqua, soddisfazione delle coorti, scelte di triage precedenti;
- almeno due leve del giocatore;
- eventi di soglia;
- contributori causali esposti nell'UI.

## 9.2 INFRASTRUCTURE — derivata

Non introduce un contatore nuovo. Si deriva da `ProductionNodeState` — condizione, efficienza — più lo stato e la storia autoritativi della manutenzione.

La ragione è che il Core calcola già questa verità: il riciclatore consuma energia e produce acqua, e la sua efficienza governa già il ciclo osservabile nel World Tick. Un contatore parallelo duplicherebbe un valore esistente e le due copie divergerebbero.

**Requisito vincolante — agency reale.** Poiché la pressione è derivata, il proof deve fornire un modo tipizzato e di proprietà del Core perché manutenzione e danno modifichino la **condizione/efficienza autoritativa del nodo di produzione**. Senza di esso l'infrastruttura avanzerebbe solo per tick, senza leva del giocatore, e non soddisferebbe il requisito di agency della sezione 9.4.

## 9.3 La pressione politica riusa lo stato esistente

**Non esiste un clock LEGITIMACY.** La legittimità è già rappresentata tre volte nello stato autoritativo:

- `SettlementState.stability`;
- `SettlementState.satisfaction`;
- `PoliticalGroupState.approval`;

più l'agenda di fazione strutturata della sezione 8.

Un quarto contatore non aggiungerebbe una decisione: aggiungerebbe un numero che il giocatore deve imparare a ignorare. Dove serve una soglia politica, è una soglia su questi valori.

Nota: nessun clock `AUDIT`. Un audit è una situazione derivata da azioni segrete più agenda di fazione più scoperta.

## 9.4 Semantica e agency

Ogni pressione deve possedere:

- valore interno deterministico;
- stadio qualitativo visibile;
- cause multiple;
- almeno due leve del giocatore;
- segnali di soglia;
- contributori causali esposti nell'UI.

Stadi visibili suggeriti:

```text
STABLE
STRAINED
CRITICAL
CRISIS
```

Il valore numerico interno è PROVISIONAL. L'UI normale non deve necessariamente mostrare il numero esatto.

Ogni pressione deve offrire almeno due forme di interazione fra:

- guadagnare tempo;
- accelerare la risoluzione con costo o rischio;
- scambiare una pressione con un'altra;
- accettare il danno e preservare un'altra priorità.

**Una pressione che avanza soltanto per tick senza leva del giocatore non soddisfa il proof.**

## 9.5 Esempio di causalità

```text
INFRASTRUCTURE: CRITICAL

Contributori:
- manutenzione differita dopo una scelta F2
- carico del condotto non registrato
- prelievo energetico d'emergenza recente

Mitigazione disponibile:
- fermare temporaneamente un'ala della clinica
- richiedere una squadra tecnica istituzionale
- accettare una fornitura di componenti dalla fazione autonomista
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

# 11. Five event families — PROVISIONAL

Le famiglie sono strumenti di test, non quest line.

Il proof ottimizza la **densità di interazione**, non il conteggio del contenuto: cinque famiglie con varianti sensibili allo stato battono otto famiglie con una variante ciascuna.

## F1 — SCARCITY / TRIAGE

Fusione di *Water for the Sick* e *Clinic Triage*: erano lo stesso dilemma — chi subisce la penuria — a due granularità diverse.

Core conflict: sopravvivenza della clinica contro riserva strategica e razionamento generale.

Must touch:

- water/medicine;
- memoria del personaggio medico e di quello della comunità;
- EPIDEMIC;
- eleggibilità futura della responsabilità pubblica.

Varianti sensibili allo stato: triage individuale, razionamento di distretto, priorità contestata pubblicamente.

## F2 — MAINTENANCE

Core conflict: spendere capacità scarsa adesso contro preservare servizi a breve termine.

Must touch:

- energy/capacity;
- condizione autoritativa del nodo di produzione;
- comportamento e memoria del personaggio tecnico;
- INFRASTRUCTURE;
- eleggibilità futura di guasto o riparazione.

## F3 — UNREGISTERED CONDUIT

Core conflict: soluzione rapida e non dichiarata contro esposizione politica.

Must touch:

- energy;
- agenda di fazione;
- azione segreta e sua eventuale scoperta;
- INFRASTRUCTURE.

È la famiglia che alimenta `SECRET_ACTION_DISCOVERED` e che rende la trasparenza una decisione.

## F4 — PUBLIC ACCOUNTABILITY / TRANSPARENCY

Fusione di *Public Assembly* e *Rationing Disclosure*: erano entrambe "la verità diventa pubblica", con la disclosure come esito possibile dell'assemblea.

Core conflict: dire la verità sui costi contro mantenere margine di manovra.

Must touch:

- stability/satisfaction;
- approvazione dei gruppi politici;
- memorie pubbliche;
- agenda di fazione.

## F5 — EXTERNAL RESCUE

Core conflict: risolvere una crisi adesso contro contrarre un debito politico.

Must touch:

- risorsa in crisi;
- agenda di fazione;
- dipendenza crescente.

**Vincolo obbligatorio:** questa famiglia non deve produrre un'opzione dominante. Se accettare l'aiuto esterno è sempre corretto, la famiglia va tagliata. L'aiuto deve costare un elemento di agenda **immediato e visibile** presso la fazione avversa, e `FACTION_DEPENDENCY_GROWING` deve renderne il ripetersi progressivamente più caro.

## 11.1 Payoff e aftermath non sono una famiglia

*Governance / Systemic Payoff* è stata rimossa come famiglia autonoma.

Il payoff non è un tipo di evento: è una **funzione dello stato accumulato** e una variante che ciascuna delle cinque famiglie deve poter produrre. Trattarlo come famiglia a sé porta inevitabilmente a scriverne uno finto — un evento che dichiara una conseguenza invece di derivarla.

## 11.2 Effetti tipizzati minimi

Le scelte del proof richiedono conseguenze multi-livello, ma il principio resta: **solo effetti tipizzati minimi**, e derivazione sistemica dove possibile.

L'implementazione non è vincolata a un numero esatto di tipi nuovi. Sono probabilmente necessari:

- creazione di memoria;
- manipolazione esplicita della pressione epidemica;
- manipolazione della condizione o della manutenzione di un nodo di produzione.

Restano invece **derivate**, non effetti d'autore:

- le relazioni cambiano per memorie accumulate, non per decreto di un evento;
- gli elementi di agenda di fazione nascono da regole del World Tick quando lo stato li giustifica;
- il consolidamento delle memorie è una regola, non un effetto.

Il confine è questo: se un autore può scrivere "la fazione ora ti odia", la fazione non è un sistema — è una variabile.

Ogni tipo di effetto nuovo passa dall'applicatore condiviso e dalla validazione condivisa introdotti in GQP-0.

## 11.3 Mandatory network properties

Attraverso queste famiglie:

- almeno 2 famiglie possono essere saltate interamente da uno stato precedente buono o cattivo;
- almeno 3 cambiano opzioni o inquadramento in base a memorie ed elementi di agenda precedenti;
- almeno 2 decisioni costose iniziali possono produrre un payoff positivo tardivo;
- almeno 2 decisioni apparentemente utili possono creare complicazioni tardive;
- nessuna sequenza fissa F1→F2→…→F5.

---


# 12. Pattern detection — four detectors

Il target iniziale è **quattro** detector, non sei.

```text
IGNORED_TECHNICAL_WARNINGS
REPEATED_PROTECTION_OR_NEGLECT
FACTION_DEPENDENCY_GROWING
SECRET_ACTION_DISCOVERED
```

## 12.1 Perché questi quattro

Sono scelti per densità di interazione: ciascuno legge stato che il proof produce comunque, e ciascuno può cambiare l'eleggibilità di più di una famiglia.

- **IGNORED_TECHNICAL_WARNINGS** — collega manutenzione, pressione infrastrutturale e memoria di un personaggio in un'unica catena. È il detector che rende un avviso ignorato una cosa che *torna indietro*, ed è la dimostrazione più diretta di conseguenza ritardata leggibile.
- **REPEATED_PROTECTION_OR_NEGLECT** — trasforma uno schema di scelte ripetute in identità politica. Legge la storia risolta e la soddisfazione delle coorti, entrambe già autoritative, e alimenta sia la famiglia scarsità/triage sia quella della responsabilità pubblica.
- **FACTION_DEPENDENCY_GROWING** — è il contrappeso che impedisce a EXTERNAL RESCUE di diventare l'opzione dominante. Senza di esso, chiamare aiuto è gratis; con esso, chiamarlo tre volte è una posizione politica.
- **SECRET_ACTION_DISCOVERED** — è l'unico che introduce l'asimmetria informativa richiesta dalla sezione 7.1, ed è il ponte fra un'azione segreta locale e una conseguenza pubblica. Rende la trasparenza una scelta invece di un default.

`PUBLIC_PROMISE_BROKEN` è coperto in larga parte da `REPEATED_PROTECTION_OR_NEGLECT` più la famiglia della responsabilità pubblica, e resta disponibile come quinto detector se il playtest lo richiede.

`CHARACTER_CAUGHT_BETWEEN_LOYALTIES` è **rimandato** finché le relazioni non si sono dimostrate utili: richiede un grafo relazionale maturo che a questo punto del proof non esiste, e un detector che legge dati appena introdotti non può produrre gameplay leggibile.

## 12.2 Requisiti per ogni detector

Ogni pattern deve specificare:

- input autoritativi esatti;
- predicato puro e deterministico;
- quali famiglie o varianti può rendere eleggibili o riprioritizzare;
- sorgenti causali per la spiegazione.

Un detector rileva **potenziale narrativo**. Non fabbrica un esito.

## 12.3 Storia degli eventi risolti

La logica di novità e ripetizione richiede una storia che oggi non esiste in alcuna forma nel `WorldState`. Va persistita, in forma minima:

```text
eventId
choiceId
playerTurn
```

Regole:

1. registra **decisioni risolte autoritativamente**, non render di React e non la semplice presentazione di un evento;
2. lo stato di gioco non si modifica per il fatto che l'UI ha mostrato qualcosa;
3. è l'unica fonte ammessa per novità e ripetizione nel proof.

Derivarla dalle memorie non è praticabile: le memorie vengono scritte solo quando una regola del World Tick lo decide, non a ogni scelta, e una storia con buchi produce penalità di ripetizione arbitrarie.

---


# 13. Event eligibility authority

`packages/game-core` remains authority for:

- world state;
- pressure progression;
- memories;
- relationships;
- faction agenda;
- delayed consequences;
- pattern predicates;
- event eligibility;
- authoritative choice resolution;
- resolved event history;
- StateDelta;
- World Tick.

React must not implement eligibility arithmetic or hidden simulation rules.

Rust/Tauri remains platform/persistence authority only.

---


# 14. Deterministic event selection

Il proof **non introduce un sottosistema Director separato**. Evolve il confine di selezione degli eventi già esistente.

La ragione è la stessa che ha fatto nascere questo documento: un punteggio a sette termini con pesi da tarare è un altro strato di fondazione invisibile. Con più famiglie e varianti, nessuno saprebbe più perché è uscito un evento invece di un altro, e la taratura consumerebbe più tempo della scrittura del contenuto. **Una selezione che non sai spiegare in una frase non è pilotabile in un playtest.**

## 14.1 Cosa può e cosa non può

La selezione può:

- ricevere l'insieme eleggibile prodotto dal Core;
- scegliere quale evento eleggibile riceve il focus adesso;
- emettere un focus `QUIET` quando nessun evento urgente deve emergere;
- preferire rilevanza causale;
- penalizzare la ripetizione;
- selezionare un callback causale rilevante.

La selezione **non** può:

- inventare eleggibilità;
- modificare risorse, pressioni, memorie, relazioni o agenda di fazione;
- produrre uno `StateDelta`;
- nascondere una crisi obbligatoria oltre la sua finestra di equità;
- usare un LLM per scegliere lo stato di gioco.

## 14.2 Contratto di determinismo

L'output della selezione deve essere:

1. una funzione pura e deterministica di stato e storia autoritativi persistiti o derivabili; oppure
2. esplicitamente persistito come parte dello stato di scheduling replayabile.

Non deve esistere **alcuno stato mutabile nascosto** necessario a riprodurre una run.

I pareggi si risolvono in modo stabile: ordinamento crescente per `id` dell'evento.

## 14.3 Modello di priorità — tre termini

```text
priority = urgency
         + causal_relevance
         - repetition
```

dove:

- **urgency** — una soglia di pressione è stata superata, oppure una conseguenza ritardata è dovuta;
- **causal_relevance** — l'evento cita una memoria saliente, un elemento di agenda attivo o un pattern rilevato;
- **repetition** — turni trascorsi dall'ultima risoluzione della stessa famiglia, letti dalla storia degli eventi risolti.

Novità e fatica sono la stessa grandezza vista da due lati e non richiedono termini separati. La prontezza del payoff è già `DelayedConsequenceState.triggerTurn` e non va duplicata in un peso.

I valori numerici esatti sono materiale da playtest, non matematica di prodotto bloccata.

## 14.4 Quiet focus

Il focus `QUIET` è ammesso solo quando:

- nessun evento di soglia obbligatorio è dovuto;
- nessuna crisi sta superando la propria finestra di equità.

È preferibile quando i turni recenti contenevano già decisioni ad alta attenzione, o quando far emergere una conseguenza o un recupero vale più di un altro dilemma.

Un turno silenzioso è una scelta della selezione, non l'assenza di un evento eleggibile: vedi il modello `GameplayFocus` in GQP-0.

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
- pressure tooltip listing top causal contributors;
- faction bulletin naming the agenda item behind it;
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
- choose event selection;
- create authoritative memories;
- change relationships;
- change pressures/resources;
- invent a supported option;
- decide an outcome.

---

# 18. Recovery design

Ogni pressione principale richiede almeno un percorso di recupero non banale.

## 18.1 Il recupero è gameplay, non un meccanismo esistente

`DelayedConsequenceState.reversible` **non implementa il recupero**. È un campo che dichiara che una conseguenza è annullabile in linea di principio; non contiene la decisione, il costo, né la regola che la annulla.

Il recupero è un evento, una scelta o una regola successiva che cambia lo stato autoritativo **a un prezzo**. `DelayedConsequenceState` può essere riusato per la tempistica e per la catena causale — è già il posto giusto in cui far arrivare un effetto più tardi con la sua sorgente — ma il proof non parte da un motore di recupero esistente, perché non esiste.

## 18.2 Percorsi richiesti

- **EPIDEMIC:** spendere medicine e perdere capacità produttiva; richiedere fornitura esterna con costo di leva politica; isolare un distretto pagando in soddisfazione.
- **INFRASTRUCTURE:** fermare servizi; accettare dipendenza tecnica da una fazione; consumare stock strategico per una riparazione.

Il recupero non può essere un pulsante di guarigione gratuito.

Deve a sua volta creare una decisione, un costo, una relazione o una dipendenza futura.

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
Tarek Oss leaves Helios Reach
→ ruolo tecnico vacante
→ avviso precoce sull'infrastruttura non più disponibile
→ Mara Senn ricorda perché se n'è andato
→ una successiva opzione di riparazione cambia
```

---


# 20. Definition of Fun — first human gate

Questo non è il tentativo di ridurre il divertimento a telemetria. Questi cancelli esistono per impedire l'autoinganno di chi ha scritto il gioco.

Per il **primo playtest umano/del fondatore** di una run da 12–15 turni, il proof non passa se i criteri critici non sono soddisfatti.

## 20.1 Controlli osservabili — hard checks

Tre criteri sono promossi a verifica osservabile perché non dipendono dal giudizio di chi valuta:

1. **Esitazione misurabile.** La telemetria registra il tempo fra la comparsa dell'evento e la risoluzione della scelta. Un dilemma vero produce pause misurabilmente più lunghe del tempo di lettura. È l'unico segnale oggettivo disponibile su un campione di uno, e va strumentato (sezione 22).
2. **Richiamo causale non assistito.** A fine run, senza guardare lo schermo né i log, il tester spiega almeno due situazioni tardive come conseguenze di scelte precedenti. Non assistito è la parte che conta: se serve l'UI per ricostruire la catena, i breadcrumb non stanno funzionando.
3. **Divergenza deterministica di traiettoria.** Due run dallo stesso seed con scelte diverse devono produrre stati finali autoritativi materialmente diversi. Questo è **verificabile in automatico** e non richiede un essere umano; è già l'exit di GQP-B ed è l'unico controllo che può fallire senza che nessuno se ne accorga a sensazione.

## 20.2 Criteri qualitativi critici

Restano critici e restano giudizio umano:

4. **Predizione del comportamento** — prima di una risposta NPC importante, il tester prevede la reazione probabile per una ragione fondata sul personaggio.
5. **Desiderio di un altro turno** — almeno una volta il tester vuole continuare soprattutto per vedere come si sviluppa una situazione irrisolta.
6. **Richiamo dei personaggi** — il tester descrive almeno 3 personaggi su 5 con qualcosa di più di ruolo e nome; almeno 2 descrizioni includono valore, memoria o relazione.
7. **Cambio di strategia** — almeno una volta il tester cambia deliberatamente piano perché il mondo ha reagito.
8. **Incertezza equa** — nessun esito negativo importante appare senza un segnale preventivo ragionevole.

I punti 4 e 5 restano i due segnali qualitativi decisivi: sono ciò che distingue un sistema che funziona da un sistema interessante.

## 20.3 Segnali positivi forti

- rimpianto per almeno una scelta difendibile;
- sorpresa coerente;
- attaccamento o avversione alla perdita verso almeno un personaggio;
- racconto spontaneo della storia dopo la run;
- desiderio di una strategia diversa per un replay.

## 20.4 Onestà del campione

La telemetria del fondatore **non è prova statistica** e non va presentata come tale. Un campione di uno può dimostrare che qualcosa non funziona; non può dimostrare che funziona.

Se i criteri critici falliscono, si itera il proof. Non si compensa aggiungendo volume di contenuto.

---


# 21. Small-sample validation gate

## 21.1 Ordine obbligatorio dei cancelli

```text
GQP technical completion
        ↓
founder fun PASS
        ↓
independent small-sample PASS
        ↓
M2 expansion
```

L'ordine non è indicativo. **M2 non può essere pianificata, avviata o schedulata in parallelo a un campione non ancora superato.** Un fallimento del campione dopo che M2 è già partita non produce una correzione: produce la pressione a dichiarare superato il cancello.

Il PASS del fondatore autorizza il campione indipendente, non l'espansione.

## 21.2 Segnali desiderati

Target: **minimo 5 tester indipendenti**. Le percentuali sono direzionali e non costituiscono prova statistica: cinque persone non producono un intervallo di confidenza, producono un'indicazione.

- ≥70% collega almeno una conseguenza tardiva a una decisione precedente;
- ≥70% vuole almeno altri 3 turni a fine sessione;
- ≥60% riporta almeno una sorpresa coerente;
- ≥60% prevede correttamente almeno una reazione NPC per la ragione giusta;
- ≥70% ricorda almeno 2 personaggi oltre ruolo e nome;
- ≥50% riporta un cambio di strategia deliberato;
- la fatica da eventi/crisi resta feedback minoritario;
- nessuna lamentela ripetuta che gli esiti sembrino arbitrari.

Il fallimento significa redesign o tuning **prima** dell'espansione di contenuto M2.

---


# 22. Instrumentation

For playtest builds log deterministically:

- Player Turn / World Tick;
- presented event ID/variant;
- eligible event IDs at selection time;
- selection score/reason where applicable;
- choice ID;
- choice decision time (UI telemetry only, not gameplay authority);
- StateDelta;
- pressure stage before/after;
- created/updated salient memories;
- created/resolved faction agenda items;
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
- `ProductionNodeState` with recipe/capacity/efficiency;
- `DelayedConsequenceState` with trigger turn/source/effects;
- separate Player Turn and World Tick;
- `GameEvent` / `EventChoice` requirements/effects;
- `StateDelta`;
- validated persistent `WorldState`.

The proof should **extend these contracts minimally**, not replace them wholesale.

## 24.1 Schema versioning — DECISIONE ESTERNA

La semantica autoritativa introdotta dal proof richiede **`SystemicSimulationState` schema v2**.

Questa è una decisione di prodotto deliberata, non una scorciatoia. La ragione è di sicurezza, non di comodità: rendere i campi nuovi opzionali su v1 li farebbe sopravvivere al round-trip **fuori** dalla garanzia sull'input ostile che il confine di persistenza M1 ha costruito, perché il validatore attuale non rifiuta i campi che non conosce. Un salvataggio manipolato potrebbe iniettare una pressione non finita o una relazione verso un personaggio inesistente e il confine non se ne accorgerebbe.

Regole vincolanti:

1. i salvataggi M1 legacy restano **schema v1** e devono continuare a caricarsi;
2. il codice nuovo deve continuare a validare e caricare v1;
3. lo scenario GQP viene creato **direttamente come v2**;
4. **nessuna migrazione automatica v1 → v2**: un mondo M1 non diventa un mondo del proof per il fatto di essere aperto;
5. il codice vecchio deve **rifiutare v2**, non caricarlo silenziosamente ignorando campi autoritativi che non comprende;
6. la versione dell'envelope di persistenza **non** cambia per questo motivo: l'envelope descrive il trasporto, lo schema descrive il contenuto;
7. ogni campo v2 riceve validazione di forma **e** di invariante su input ostile nella stessa slice in cui viene introdotto. Nessuna eccezione, nessun "lo validiamo dopo".

Il punto 5 è quello che rende il bump necessario piuttosto che opzionale: senza un numero che cambia, una build precedente non ha modo di sapere che il mondo che sta aprendo contiene decisioni che non sa interpretare.

---


# 25. Implementation slicing

No large-bang implementation.

Ogni slice deve poter essere abbandonata senza lasciare uno strato di fondazione orfano. Se una slice non si può buttare via, è troppo grande.

Le slice sono `GQP-0`, `GQP-A`, `GQP-B`, `GQP-C`, `GQP-D`. Non vanno confuse con i principi `GQP-1` … `GQP-10` della sezione 3, che sono vincoli di design e non unità di lavoro.

## GQP-0 — Structural hygiene BEFORE any proof feature

Questa slice non aggiunge gameplay, contenuto o campi di dominio. Esiste perché il codice attuale ha tre punti in cui l'aggiunta di semantica nuova divergerebbe silenziosamente.

Deliver:

1. **Applicazione degli effetti condivisa.** `resolveChoice` e `applyDueConsequences` contengono oggi due implementazioni indipendenti della stessa semantica di `EventEffect`. Un effetto immediato e lo stesso effetto ritardato devono passare per un unico applicatore autoritativo, altrimenti una divergenza fra i due produce mondi diversi a seconda di *quando* l'effetto arriva.
2. **Semantica di validazione della forma condivisa dove praticabile.** L'elenco dei tipi di effetto ammessi è dichiarato in più autorità (tipo, applicatore immediato, applicatore ritardato, validatore evento, validatore stato persistito). Una divergenza fra validatore e applicatore non è un fastidio di manutenzione: è un vettore di corruzione del salvataggio, perché il confine accetterebbe un effetto che nessuno sa applicare.
3. **Modello `GameplayFocus` esplicito.**

```text
GameplayFocus = EVENT | QUIET
```

Il turno silenzioso è una decisione del gioco, non l'assenza di un valore. Rappresentarlo come `event: GameEvent | null` sparso fra controller, sessione e componenti produce controlli di nullità in ogni punto di lettura e un'omissione basta a rompere lo schermo. Un focus tipizzato costringe ogni consumatore a dichiarare cosa fa quando non c'è evento.

4. **Selezione indipendente dall'ordine del catalogo, nel percorso GQP.** La selezione pesata attuale scorre l'insieme eleggibile nell'ordine dell'array. A parità di seed e turno, riordinare il catalogo cambia l'evento estratto. Nel percorso GQP l'insieme eleggibile va ordinato deterministicamente per `id` prima della selezione.

**Vincolo esplicito:** non modificare il comportamento M1 già accettato solo per ordinare il suo catalogo legacy. Il baseline M1 resta protetto e le sue regressioni devono restare verdi invariate.

Exit: nessuna feature nuova, nessun contenuto nuovo, suite esistente verde, e i quattro punti sopra verificati da test.

## GQP-A — Contract & deterministic scenario foundation

Deliver:

- scenario GQP derivato da Helios Reach, isolato dal baseline M1;
- `SystemicSimulationState` schema v2 con le regole della sezione 24;
- `coreValue`, `currentGoal`, relazioni fra personaggi;
- `FactionAgendaItem` strutturato;
- pressione EPIDEMIC esplicita e pressione INFRASTRUCTURE derivata;
- storia degli eventi risolti (sezione 12.1);
- validazione della forma e degli invarianti su input ostile per **ogni** campo nuovo, nella stessa slice;
- nessuna ambizione di UI oltre l'ispezionabilità.

Exit: lo stato fa round-trip e replay deterministico su file reale.

## GQP-B — Meaningful choice network

Deliver:

- prime tre famiglie di eventi;
- effetti tipizzati minimi necessari (sezione 11.2);
- hook comportamentali sulle memorie salienti;
- propagazione sociale a tre canali;
- conseguenze ritardate con breadcrumb causali;
- almeno un percorso di recupero reale per ciascuna pressione.

Exit: **due traiettorie deterministicamente divergenti dallo stesso seed sotto scelte diverse, verificate da un test**, non da un'impressione.

## GQP-C — Directed pacing

Deliver:

- famiglie di eventi rimanenti;
- quattro pattern detector;
- selezione a tre termini dentro il confine di selezione esistente;
- novità/ripetizione derivata dalla storia risolta;
- turni silenziosi;
- selezione del callback causale;
- superfici di spiegazione Normal.

Exit: run di riferimento da 12–15 turni senza sequenza hardcoded, con storie materialmente diverse sotto scelte diverse.

## GQP-D — Real Windows playtest build

Deliver:

- ciclo di vita dell'app installata ancora valido;
- scenario del proof giocabile attraverso l'UI reale;
- telemetria catturata;
- playtest del fondatore eseguito;
- Definition of Fun valutata onestamente.

Exit: decisione PASS / ITERATE.

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
- generative or non-deterministic event selection;
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
11. only after all the above, the small-sample validation may be **scheduled**.

M2 expansion is not part of this list and is not authorized by it. Completing the proof authorizes the founder gate; passing the founder gate authorizes the small-sample validation; **only a passed small-sample authorizes M2**, and M2 may not be scheduled in parallel with a sample that has not yet passed (section 21.1).

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
