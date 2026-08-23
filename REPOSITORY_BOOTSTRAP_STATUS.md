# REPOSITORY BOOTSTRAP STATUS
## Chronosaga: The Game

**Snapshot:** 2026-08-23 (post-merge PR #24)
**Tipo:** stato operativo/informativo, **non normativo**.

Questo file fotografa lo stato corrente del repository. Non sostituisce Product
Vision, Knowledge, Roadmap, P0 Plan o altri documenti normativi, e non ha
precedenza su di essi. In caso di conflitto prevale la Knowledge; in caso di
conflitto fra questo file e il repository reale, **prevale il repository**: Git,
i test e gli artefatti verificabili sono la fonte dello stato implementato.

## Legenda

```text
MERGED / VERIFIED     mergiato in develop e coperto da test/gate eseguiti
IN REVIEW             implementato, PR aperta, non ancora mergiato
NOT RUN               infrastruttura pronta, esecuzione non ancora effettuata
NOT RELEASE-APPROVED  candidato tecnico, nessuna approvazione di rilascio
OUT OF SCOPE          deliberatamente non incluso in questa fase
```

## Branch state

- `develop` osservato: `63b8af59846be2e85923695fa65cca8b6d7bc468`
  — merge PR #24, *P0.5-B1: operationalize official Lite vs Standard quality
  benchmark*.
- `main` osservato: `27571a85100a11875cad7d72431a48586573a976`
  — significativamente indietro rispetto a `develop` (92 commit).
- `main` e `develop` hanno storie Git divergenti per via dei merge precedenti.
  **Nessun documento normativo è però presente solo su `main`**: il diff `docs/`
  fra i due branch mostra unicamente che `develop` è più avanti. La divergenza è
  storia, non contenuto perduto.
- Non riallineare `main` e `develop` con merge/force/fast-forward automatici. Una
  promozione `develop` → `main` è una decisione deliberata separata, con PR e
  review del diff.
- Questo file è aggiornato tramite PR documentale, quindi **non pinna il proprio
  merge commit** come HEAD corrente di `develop`.

## Stato per gate

### P0.1 — Windows desktop runtime — MERGED / VERIFIED
Tauri Windows avviabile e installabile, diagnostica hardware/risorse, build e
installer verificati sul PC Windows target.

### P0.2 — SQLite smoke persistence — MERGED / VERIFIED
save/load SQLite, chiusura e riapertura applicazione, persistenza dello smoke
campaign, validati sul PC Windows target.

### P0.3-B — owned llama.cpp runtime — MERGED / VERIFIED
llama.cpp `b10343` pinned e verificabile, runtime esterno a Git, lifecycle
manager con ownership del processo, watcher background, `runtimeReady` distinto
da `inferenceReady`, binding loopback-only, packaging runtime separato dal
payload modello, zero orphan process nei test eseguiti.

### P0.3-C — prima inferenza locale Lite reale — MERGED / VERIFIED
PR #8. Inferenza offline reale con il candidato Lite, GGUF integrity-verified,
output strutturato validato application-side.

### P0.4 — Standard, AUTO e Safe fallback — MERGED / VERIFIED
- P0.4-A Standard desktop integration (PR #14);
- P0.4 AUTO orchestration e Safe fallback (PR #16);
- P0.4-D installed model resolution hardening (PR #21).

Un solo modello residente alla volta; `STANDARD → LITE → SAFE/PROCEDURAL`
preservato; Safe/Procedural resta percorso degradato di continuità, **non** un
quarto profilo normale.

### M1-A / M1-B — fondazione sistemica e primo world tick — MERGED / VERIFIED
- M1-A systemic world foundation (PR #15);
- M1-B first useful world tick (PR #18).

Lavoro di gameplay anticipato in parallelo all'infrastruttura P0. Vedi la nota
sulla sequenza in `TECHNICAL_ROADMAP_v0.2.md`: è lavoro anticipato, non una
deviazione architetturale.

### P0.5-A — benchmark harness — MERGED / VERIFIED
PR #22. Suite versionata, schemi, evaluator deterministico, report
Lite-vs-Standard, boundary di fiducia fra evidenza esterna e aggregazione.

### P0.5-B1 — execution lane ufficiale — MERGED / VERIFIED
PR #24, merge commit `63b8af59846be2e85923695fa65cca8b6d7bc468`.

L'infrastruttura di esecuzione esiste ed è mergiata. Contiene:

- un comando unico che esegue entrambi i profili sotto un solo `runId` logico;
- ciclo di vita sequenziale del modello: Lite completamente fermato e reaped,
  porta provata libera, prima che Standard parta;
- un solo retry, derivato dal rifiuto del validator, e nessun terzo tentativo;
- nessun fallback durante la comparazione;
- verifica di runtime e di entrambi gli artefatti **prima** di qualunque
  generazione;
- claim atomico della run directory: una directory esistente non viene mai
  riusata, fusa o sovrascritta;
- selezione dei casi fail-closed — `CHRONOSAGA_BENCHMARK_CASES` malformata, o
  `CHRONOSAGA_BENCHMARK_CASE_IDS` senza conteggio, rifiutano la run;
- preflight su checkout pulito e committato, senza override;
- `rawOutputSha256` per riga, che lega l'evidenza grezza ai byte scritti;
- CLI di reporting che attraversa l'intero boundary e esce non-zero su qualsiasi
  rifiuto.

**Mergiato non significa eseguito.** Vedi il gate seguente.

### P0.5 — risultato qualità ufficiale Lite vs Standard — NOT RUN

Popolazione della comparazione, decisa e lockata:

```text
minimo normativo P0            50 casi
suite versionata corrente      65 casi
run ufficiale corrente         intera suite: 65 Lite + 65 Standard
                               piu' i soli retry legittimi
```

50 è il minimo di gate, non un sottoinsieme selezionabile: la run ufficiale
esegue la suite lockata per intero. 65 è la popolazione corrente, non un limite
permanente.

La comparazione 65 × 2 **non è stata eseguita**. Nessuna evidenza in questo
repository o nel workspace è evidenza ufficiale comparabile.

Esiste una run interrotta a
`D:\Chronosaga\benchmarks\p0.5\official_1787448652` (69 righe Lite, Standard mai
avviato). È **historical incomplete evidence**: non va modificata, completata,
riparata né usata per un verdetto. Il boundary di reporting la rifiuta.

### P0.5-C — matrice performance / context / hardware — NOT RUN

### P0 — verdetto finale GO / GO WITH LIMITS / NO-GO — NOT RUN

### Windows Full Offline bundle — NOT RUN
La strategia fisica della distribuzione multi-GB resta PROVISIONAL.

## Profili modello

```text
LITE     Qwen3-1.7B Q4_K_M   P0 benchmark candidate   NOT RELEASE-APPROVED
STANDARD SmolLM3-3B  Q4_K_M  P0 benchmark candidate   NOT RELEASE-APPROVED
SAFE / PROCEDURAL   percorso degradato di continuità, non profilo equivalente
```

Entrambi restano `releaseApproved = false` finché P0.5 non produce evidenza
sufficiente. Nessun modello è release-ready senza quell'evidenza.

## Sequenza corrente

```text
P0.5-A benchmark harness            DONE
P0.5-B1 execution infrastructure    DONE
        ↓
sync del checkout locale su develop mergiato
        ↓
verifica checkout pulito / runtime / modelli
        ↓
official Lite-vs-Standard 65-case run     <- CURRENT, non ancora eseguita
        ↓
machine validation / report
        ↓
human scoring / review
        ↓
P0.5-B quality verdict
        ↓
P0.5-C performance / context / hardware matrix
        ↓
final P0 verdict — GO / GO WITH LIMITS / NO-GO
```

Dopo la chiusura di P0.5 il focus si sposta da costruire infrastruttura a
dimostrare che Chronosaga è un gioco interessante: M2 vertical slice.

## Limiti noti e lavoro aperto

- Benchmark ufficiale non eseguito; nessun verdetto di qualità.
- Matrice P0.5-C non eseguita; requisiti hardware finali non definiti.
- GPU acceleration non benchmarkata.
- Modelli non inclusi nel NSIS corrente.
- `/health` e `/v1/models` del llama-server pinned restano localmente
  discoverable anche con API key; gli endpoint di generazione sono autenticati.
- Persistence SQLite oltre lo smoke P0 non implementata.
- PostgreSQL production adapter/migrations OUT OF SCOPE in questa fase.
- Authentication, secrets di produzione, deployment VPS/pubblico OUT OF SCOPE.
- Runtime image generation OUT OF SCOPE per la v1.
- M2 vertical slice non iniziato.

## Invarianti da non violare

- Nessun GGUF, weight o payload pesante nella normale history Git.
- Nessuna raw benchmark evidence in Git; l'evidenza vive fuori dal repository.
- Simulation Core autorevole e deterministico; l'AI non muta lo stato.
- `llama-server` loopback-only, mai esposto pubblicamente.
- Un solo LLM locale residente alla volta.
- Nessun modello dichiarato release-ready senza evidenza P0.5.
