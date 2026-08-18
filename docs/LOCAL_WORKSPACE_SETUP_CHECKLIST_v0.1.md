# LOCAL WORKSPACE SETUP CHECKLIST v0.1
## Chronosaga: The Game

Use this checklist when setting up the local development machine before P0.3.

```text
D:\Chronosaga\
├── repo\chronosaga_the_game\
├── runtime-assets\
│   ├── models\lite\
│   ├── models\standard\
│   ├── visual-source\ai-generations\
│   ├── visual-source\master\
│   ├── visual-source\character-sheets\
│   ├── visual-ready\portraits\
│   ├── visual-ready\sprites\
│   ├── visual-ready\equipment\
│   ├── visual-ready\environment\
│   ├── visual-ready\ui\
│   ├── audio\
│   └── licenses\
├── builds\
├── benchmarks\
└── temp\
```

## Rules

- Clone the GitHub repository only into `repo\chronosaga_the_game`.
- Do not manually copy GGUF/model files into the Git repository.
- Do not put raw AI generation batches inside the Git repository.
- Keep release/source metadata, hashes and licensing information in Git once verified.
- The local path is configurable; `D:\Chronosaga` is the preferred Windows convention, not a runtime hard-code.
- The development agent must read `/AGENTS.md` before modifying the project.
- P0.3 may use the external model directories but must keep `llama-server` loopback-only and preserve procedural fallback.

## Setup status

```text
[ ] D:\Chronosaga created
[ ] repository cloned into repo\chronosaga_the_game
[ ] runtime-assets directories created
[ ] builds / benchmarks / temp directories created
[ ] local agent launched with D:\Chronosaga as working scope
[ ] agent has read AGENTS.md + KNOWLEDGE_INDEX_v1.md
[ ] no model weights are tracked by Git
```
