# Repository Bootstrap Status

**Data:** 2026-08-17  
**Tipo:** snapshot informativo dello stato repository; non è una fonte di precedenza architetturale. In caso di conflitto prevale `KNOWLEDGE_INDEX_v1.md` e la Knowledge specifica.

## Incluso / verificato

- monorepo layout;
- shared TypeScript Simulation Core bootstrap;
- seeded deterministic RNG;
- event eligibility/selection/resolution;
- explicit StateDelta bootstrap;
- sample event data;
- procedural narrator fallback;
- Fastify API scaffold;
- React hard-SF UI scaffold;
- Docker/PostgreSQL scaffold;
- Nginx reverse proxy scaffold;
- Tauri v2 Windows shell reale;
- Windows hardware/system probe baseline;
- model manifest discovery e profile recommendation baseline;
- SQLite P0 smoke persistence con schema metadata, save/load e seed/turn retention;
- Windows NSIS installer CI build;
- P0.1 Desktop runtime validato sul PC Windows target;
- P0.2 SQLite persistence validata sul PC Windows target;
- dual local-AI profile contracts (`AUTO / LITE / STANDARD / PROCEDURAL`);
- model manifest metadata only, senza weights;
- external heavy-asset workspace architecture;
- AI-assisted visual asset authoring pipeline;
- agent policies via `AGENTS.md` e Claude bridge via `CLAUDE.md`;
- GitHub CI con TypeScript validation e Windows/Tauri check;
- Game Systems schema e UI Visual System documentation;
- project Knowledge index e roadmap Windows-first.

## Deliberatamente non incluso / non ancora validato

- `llama-server` binary bundled o installato;
- GGUF/model weights nel repository (vietati dalla policy; saranno asset esterni verificati);
- P0.3 local AI sidecar lifecycle start/health/timeout/restart/stop;
- generazione LLM reale dal desktop runtime;
- P0.4 dual-model runtime switching reale;
- P0.5 benchmark Lite/Standard e hardware requirements finali;
- full production SQLite persistence adapter oltre lo smoke P0;
- real PostgreSQL production persistence adapter/migrations;
- `AI_DM_PROTOCOL_v0.1.md` production contract;
- full gameplay implementation dei sistemi Tactical/Warfare/Management documentati;
- final game-ready portrait/sprite/environment library;
- runtime image generation (non richiesta per v1);
- authentication;
- production secrets;
- VPS/public hosted deployment.

## Gate corrente

```text
P0.1 WINDOWS DESKTOP      VALIDATED
P0.2 SQLITE SMOKE         VALIDATED
P0.3 LOCAL AI SIDECAR     NEXT
P0.4 DUAL MODEL RUNTIME   PENDING
P0.5 BENCHMARK            PENDING
```

Il prossimo lavoro implementativo deve quindi concentrarsi su P0.3 senza introdurre model weights nella normale history Git.
