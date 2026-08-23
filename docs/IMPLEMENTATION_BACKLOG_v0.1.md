# Implementation Backlog v0.2

**Data:** 2026-08-17  
**Strategia:** Windows-first · Web-compatible · VPS later

## P0 — Windows + Local AI Feasibility
1. Build reale Tauri Windows x64.
2. Verificare installer/startup/shutdown senza dipendenze manuali.
3. Implementare SQLite persistence adapter minimo + save/load/restart.
4. Integrare `llama-server` come sidecar loopback-only.
5. Implementare AI Profile Manager: `AUTO / LITE / STANDARD / PROCEDURAL`.
6. Benchmark Lite ~1.7B Q4/Q5.
7. Benchmark Standard ~3B Q4/Q5.
8. Test 2k / 4k / 8k context.
9. Eseguire l'intera AI quality suite versionata in italiano (minimo P0: 50 casi; suite corrente: 65).
10. Verificare schema validation + retry + fallback.
11. Verificare model switching senza cambiare save/game state.
12. Registrare RAM, TTFT, tok/s, startup, peak memory, crash/OOM.
13. Definire requisiti hardware reali post-benchmark.
14. Mantenere web/server build verdi in CI.

Documento operativo: `P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`.

## M1 — Shared Simulation Foundation
1. Stabilizzare Game/World/Character/Faction/Settlement state contracts.
2. Aggiungere schema validation per data/events/saves/AI contracts.
3. Implementare world tick multi-frequency.
4. Implementare delayed consequences.
5. Implementare structured character memory.
6. Implementare primo faction/settlement simulation slice.
7. Ampliare deterministic replay/invariant tests.

## M2 — Playable Micro Vertical Slice
1. 5 characters.
2. 1 settlement.
3. 2 factions.
4. 1 local economy/resource shortage.
5. 1 conflict.
6. 20–30 grounded events.
7. 1 tactical encounter class.
8. Persistent consequences across multiple turns.
9. Lite/Standard narration on the same authoritative state.
10. Demonstrate personal choice → macro reaction → personal consequence.

## M3 — UI / Lovable
1. Lock/review `UI_VISUAL_SYSTEM_v0.1.md`.
2. Use `LOVABLE_IMPLEMENTATION_BRIEF_v0.1.md` after P0 gate.
3. Operations screen.
4. Party/entity inspector.
5. World/map viewport.
6. Event/intel/directive panel.
7. Chronicle/event log.
8. Analysis Mode.
9. Tactical/Warfare/Management previews.
10. 1280 / 1080p / 1440p screenshot review.

## M4 — AI-DM Production Layer
1. Create `AI_DM_PROTOCOL_v0.1.md`.
2. Implement LocalModelProvider.
3. Implement ProceduralFallbackProvider.
4. Keep CloudModelProvider as optional interface.
5. Implement Context Builder + relevant-memory retrieval.
6. Implement JSON/schema validation and repair.
7. Add anti-slop/grounding checks.
8. Add AI diagnostic metrics.

## M5 — Micro ↔ Macro Bridge
1. Tactical outcome modifies Warfare state.
2. Warfare modifies resources/production/population.
3. Management/politics generates personal events.
4. Implement first supply/logistics slice.
5. Implement first commander/faction pressure slice.
6. Verify explainable causal chain in Analysis Mode.

## M6 — Windows Alpha Candidate
1. Reproducible installer.
2. Model profile selector fully functional.
3. Hardware probe + recommendation.
4. Crash/fallback recovery.
5. Save migration/version strategy.
6. Full vs Compact packaging experiment.
7. Third-party license/attribution bundle.
8. Offline acceptance test.

## M7 — Web Compatibility Hardening
1. Real PostgreSQL persistence adapter.
2. Fastify authoritative Game Core path.
3. Campaign/session persistence.
4. Server AI interface + queue.
5. Authentication only when needed for hosted alpha.
6. Save/data compatibility with Windows core contracts.

## M8 — VPS Private Alpha
1. Deploy frontend/API/PostgreSQL.
2. Benchmark Lite on 6C/12GB VPS.
3. Benchmark Standard only if Lite baseline is stable.
4. Test 1 / 2 / 5 queued AI requests.
5. Measure RAM, latency, queue time and failures.
6. Add security/backup/monitoring minimums.

## M9 — Optional Browser-Local AI
1. WebGPU capability probe.
2. Explicit Lite model download/caching.
3. Local WebGPU inference experiment.
4. Standard only on compatible hardware.
5. Fallback Local WebGPU → Server → Procedural.

## Current sequencing rule

```text
P0 Windows + AI
      ↓
Shared game vertical slice
      ↓
Lovable/UI integration
      ↓
Windows alpha
      ↓
Web hardening
      ↓
VPS alpha
      ↓
Optional WebGPU local AI
```

Do not split Chronosaga into independent Windows and Web games. Platform differences remain adapters around one shared core.