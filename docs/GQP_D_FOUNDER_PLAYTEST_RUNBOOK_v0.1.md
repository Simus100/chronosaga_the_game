# GQP-D — Founder playtest runbook v0.1
## Chronosaga: The Game

Questo documento spiega come si gioca e si raccolgono le prove del **founder playtest** del Gameplay Quality Proof (GQP spec §20, §22; issue #46). Non è un documento di design: descrive la build, non la cambia.

Il founder gate **non** è deciso dal software. Lo stato corretto finché Simone non ha giocato e risposto è:

```text
Founder gate: PENDING HUMAN PLAYTEST
```

---

## 1. Installare e avviare

1. Installare `Chronosaga The Game_0.1.0_x64-setup.exe` dall'artifact CI `chronosaga-windows-p0-<sha>` del commit indicato nella PR (build senza runtime AI locale: il proof non richiede AI, spec §17).
2. Avviare **Chronosaga: The Game**.
3. Nel menu iniziale scegliere **PROVA DI GIOCO** (il Gameplay Quality Proof). *Versione base (M1)* resta disponibile, separata e invariata.
4. Lasciare spuntato *Registra la telemetria del playtest* e premere **INIZIA LA PROVA** (seme canonico `7419`).

## 2. Giocare

Tutto il testo del proof è in italiano; la versione inglese verrà aggiunta più avanti.


- Una sessione guidata è di **12–15 Gameplay Beat**. Il gioco non si blocca al momento 12: il chip *SESSIONE DI PROVA* in basso a destra mostra quando l'obiettivo della sessione è raggiunto.
- Un **EVENTO** chiede una decisione. Ogni opzione mostra *Cosa sai* (gli effetti certi calcolati dal Core), *Rischi* e *Cosa non sai*. Una decisione fa avanzare il **Turno giocatore**.
- Un momento di **QUIETE** non chiede nulla: mostra cosa si muove nel mondo. *Lascia passare il tempo* esegue un **ciclo del mondo** (World Tick); il Turno giocatore non cambia.
- Il **Gameplay Beat** è solo un contatore della telemetria: non è nel salvataggio e il gioco non lo legge.
- Prima di alcune reazioni di un personaggio il gioco chiede *Come pensi che reagirà? Perché?*. Rispondere prima di vedere la reazione (si può saltare). Si possono registrare altre previsioni dal pannello *SESSIONE DI PROVA → REGISTRA UNA PREVISIONE*.
- Se il Core non ha più nulla da proporre compare **LA PROVA SI FERMA QUI**: è un limite del contenuto, segnalato apposta, non una fine della partita. Nell'esplorazione completa di GQP-C non accade entro il beat 15.

## 3. Salvare, chiudere, riaprire

- **SALVA** scrive il mondo del proof nello slot `gqp_7419` (separato da M1, `cmp_7419`).
- Si può chiudere l'applicazione, riaprirla, scegliere *Prova di gioco* → **CARICA LA PROVA** e continuare. Il mondo, le memorie, la storia, le conseguenze, le agende e il limite di quiete continuano esattamente.
- Dopo la riapertura parte una **nuova sessione di telemetria**: la continuità è registrata dal record `load`, la cui impronta SHA-256 coincide con quella del record `save` della sessione precedente.
- Un salvataggio illeggibile, incompatibile o non del proof viene **segnalato e non toccato**: non diventa mai una nuova partita.

## 4. Finire e rispondere

1. Dal chip *SESSIONE DI PROVA* → **TERMINA E QUESTIONARIO**.
2. Il questionario nasconde il gioco. Rispondere **senza guardare cronologia, telemetria o riepiloghi**: il richiamo causale e il richiamo dei personaggi devono venire dalla memoria della partita.
3. **SALVA LE RISPOSTE**, poi **ESPORTA IL PACCHETTO**.

Il software non valuta le risposte e non deduce nulla dalla telemetria.

## 5. Dove sono i dati

Tutto resta sul computer; nessun invio in rete.

| cosa | dove |
|---|---|
| salvataggi (M1 e proof) | `%LOCALAPPDATA%\it.universalis.chronosaga\chronosaga-p0.sqlite3` |
| telemetria e bundle | `%LOCALAPPDATA%\it.universalis.chronosaga\playtest\session_<data-ora>_<id>\` |

Una cartella di sessione contiene:

| file | contenuto |
|---|---|
| `telemetry.jsonl` | un record JSON per riga: `session_start`, `beat`, `save`, `load`, `npc_prediction`, `sample_target_reached`, `pacing_defect`, `questionnaire` |
| `summary.json` | conteggi della sessione, obiettivo del campione, stato del founder gate |
| `build.json` | commit, branch e ora della build giocata |
| `final_save.json` | il mondo al momento dell'export, come lo scrive il confine di salvataggio |
| `founder_answers.json` / `.md` | le risposte del founder e le previsioni, non valutate |

Il percorso esatto della sessione corrente è nel pannello *SESSIONE DI PROVA*.

**Disinstallazione.** L'uninstaller NSIS di Tauri offre una casella per cancellare i dati dell'applicazione: se viene spuntata, elimina anche salvataggi e telemetria. Copiare prima la cartella `playtest\`.

## 6. Cosa consegnare dopo il playtest

- SHA della build (in `build.json` e nel menu iniziale);
- la cartella o le cartelle `playtest\session_*` (telemetria, riepilogo, salvataggio finale, risposte);
- impressioni libere, screenshot o problemi incontrati.

Con questi si decide insieme **PASS** oppure **ITERATE** (spec §20). Se il test fallisce non si aggiunge contenuto: si classifica il problema (chiarezza, ritmo, qualità delle scelte, causalità dei personaggi, equità, UI, tecnico) e si corregge il minimo necessario.
