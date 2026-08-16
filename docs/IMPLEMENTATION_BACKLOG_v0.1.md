# Implementation Backlog v0.1

## P0 — Feasibility
1. Build Tauri Windows shell.
2. Add SQLite persistence adapter.
3. Bundle llama-server sidecar.
4. Benchmark 1.5B–2B Q4/Q5 model class.
5. Benchmark VPS 6C/12GB.
6. Run 50-case AI quality suite.

## M1 — Core
1. Lock GAME_SYSTEMS_SCHEMA.
2. Add Zod schemas for all game data.
3. Implement world tick.
4. Implement delayed consequences.
5. Implement character memory.
6. Implement faction simulation.
7. Add real PostgreSQL persistence.

## M2 — UI
1. Lock UI_VISUAL_SYSTEM.
2. Command screen.
3. Party inspector.
4. Map viewport.
5. Event/directive panel.
6. Chronicle.
7. Debug/dev mode.

## M3 — AI-DM
1. AI_DM_PROTOCOL.
2. LocalModelProvider.
3. CloudModelProvider.
4. ProceduralFallbackProvider.
5. Context builder.
6. Validation and anti-slop checks.
