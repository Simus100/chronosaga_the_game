# REPOSITORY BOOTSTRAP STATUS
## Chronosaga: The Game

**Snapshot:** 2026-08-19
**Tipo:** stato operativo/informativo, non normativo.

Questo file fotografa lo stato corrente della repository. Non sostituisce Product Vision, Knowledge, Roadmap, P0 Plan o altri documenti normativi.

## Branch state

- **P0.3-C functional baseline merged in `develop`:** `06812f98f6d55aa787c93984b4bc772228475b01`
  - merge PR #8: **P0.3-C: prove real Lite local inference on Windows**.
- Questo status file è stato aggiunto successivamente tramite PR documentale; per questo **non pinna il proprio merge commit come “current develop HEAD”**. L'HEAD corrente di `develop` va letto direttamente da GitHub.
- `main` osservato nello snapshot: `27571a85100a11875cad7d72431a48586573a976`
  - contiene la precedente promozione fino alla strategia visuale statica/code-driven;
  - **non contiene P0.3-C** nello snapshot.
- `main` e `develop` hanno storie Git divergenti a causa delle precedenti PR/merge; non vanno riallineati con merge/force/fast-forward automatici. Una futura promozione `develop` → `main` richiede una PR deliberata e review del diff.

## Gate completati

### P0.1 — Windows desktop runtime
**COMPLETATO / PROVATO SU PC REALE**

- Tauri Windows avviabile e installabile.
- Hardware/resource path diagnostics.
- Build/installer Windows verificati.

### P0.2 — SQLite persistence
**COMPLETATO / PROVATO SU PC REALE**

- save/load SQLite;
- chiusura e riapertura applicazione;
- persistenza del smoke campaign.

### P0.3-B — owned llama.cpp runtime
**COMPLETATO / MERGED**

- llama.cpp `b10343` pinned e verificabile;
- runtime esterno a Git;
- lifecycle manager con ownership del processo;
- watcher background;
- `runtimeReady` distinto da `inferenceReady`;
- loopback-only;
- packaging runtime AI separato dal payload modello;
- zero orphan process nei test/acceptance eseguiti.

### Visual production strategy
**MERGED / LOCKED NEL DOCUMENTO VISUAL ASSET PIPELINE**

Baseline:
- static modular assets first;
- code-driven movement/motion;
- FX/audio per comunicare azione;
- frame-by-frame animation opzionale, non requisito iniziale;
- AI-first external authoring pipeline;
- persistent identity portrait/tactical/strategic;
- asset compiler futuro per normalizzazione e metadata.

### P0.3-C — first real Lite local inference
**COMPLETATO / MERGED IN `develop`**

PR #8 ha dimostrato una vera inferenza locale offline con il candidato Lite.

Candidato P0:
- family: `Qwen3-1.7B`;
- repository GGUF: `ggml-org/Qwen3-1.7B-GGUF`;
- pinned revision: `daeb8e2d528a760970442092f6bf1e55c3b659eb`;
- artifact: `Qwen3-1.7B-Q4_K_M.gguf`;
- quantization: `Q4_K_M`;
- size: `1,282,439,264` bytes;
- SHA-256: `d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5`;
- license metadata: Apache-2.0;
- status: **P0 benchmark candidate — NOT release-approved**.

Prove tecniche incorporate:
- modello pesante fuori dal normale Git;
- lock separato runtime/model;
- verifier filename/size/SHA-256;
- SHA-256 streaming una volta per sessione applicativa;
- `ResolvedModel` distinto da `VerifiedModel`;
- solo `VerifiedModel` può entrare nel launch contract;
- single-model `llama-server --model ...`;
- context P0 = 4096;
- reasoning off nel percorso Lite smoke;
- API key casuale per sessione, non persistita e non esposta a React;
- inference HTTP posseduta da Rust via `reqwest`;
- URL inference validato strutturalmente come `http://127.0.0.1:<port>`;
- Web UI / agent / MCP proxy disabilitati;
- readiness richiede l'alias modello atteso `lite`;
- output strutturato validato application-side;
- raw rejected output non serializzato verso la UI;
- Simulation Core resta autorevole e il modello non muta lo stato.

## Real-machine P0.3-C observations

Macchina di sviluppo usata per l'acceptance:
- Intel i7-13700KF;
- 64 GB RAM;
- RTX 3090 presente ma non usata nel runtime CPU P0;
- llama.cpp Windows CPU build `b10343`;
- context 4096.

Osservazioni iniziali:
- cold model load circa 1.6 s;
- short generation circa 6.3–8.6 s;
- throughput circa 18–20 tok/s;
- working set circa 2.2 GB;
- 6 generazioni reali nel primo acceptance: 5 accettate, 1 correttamente respinta dal validator;
- stop/restart e shutdown senza orphan process verificati.

Questi dati dimostrano **fattibilità**, non fissano requisiti hardware finali e non sostituiscono P0.5.

## CI state for P0.3-C

GitHub Actions run #99 su PR #8:
- `validate`: PASS;
- `desktop-windows-check`: PASS;
- `windows-ai-installer`: SKIPPED intenzionalmente perché i payload pesanti verificati non sono disponibili sui runner hosted.

Il job Windows ha superato frontend build, Rust tests, Rust check, NSIS build e artifact upload.

## Known limitations / open work

- Standard non implementato.
- AUTO/profile switching non implementato.
- Fallback completo Standard → Lite → Safe non implementato.
- P0.5 benchmark matrix non eseguita.
- GGUF Lite corrente è un benchmark candidate, non release lock.
- `/health` e `/v1/models` del llama-server pinned restano localmente discoverable anche con API key; generation endpoints sono autenticati.
- Modello Lite non è ancora incluso nel NSIS corrente.
- Strategia fisica della distribuzione Windows Full Offline multi-GB resta PROVISIONAL.
- GPU acceleration non benchmarkata.
- Gameplay M1/M2 non ancora il focus implementativo principale.

## Next intended gate

La prossima milestone infrastrutturale è P0.4:

```text
LITE proven
    ↓
STANDARD candidate + real inference
    ↓
AUTO / profile selection
    ↓
one-model-at-a-time switching
    ↓
STANDARD → LITE → SAFE fallback
```

Prima di estendere ulteriormente l'infrastruttura oltre P0.4/P0.5, il progetto deve spostare rapidamente il focus sul vertical slice di gameplay sistemico.
