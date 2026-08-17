# Local model artifacts

Chronosaga supports local offline AI, but **model weights do not belong in the normal Git repository**.

This directory is for repository-side model metadata and documentation only.

Tracked here:

- `manifest.json`;
- profile IDs and planning metadata;
- eventual locked filename/version/size/SHA-256/license metadata;
- packaging notes.

Not tracked here:

- `*.gguf`;
- `*.safetensors`;
- raw model caches;
- multi-GB runtime packs.

During development, heavy model files live in the external workspace described by:

- `docs/LOCAL_DEVELOPMENT_WORKSPACE_EXTERNAL_ASSETS_v0.1.md`
- `config/runtime-assets.example.json`

Preferred local convention:

```text
D:\Chronosaga\runtime-assets\models\lite\...
D:\Chronosaga\runtime-assets\models\standard\...
```

The path is configurable and must not be hard-coded into the distributed product.

Before a model is packaged for a release, verify and lock:

1. exact upstream/derivative release identity;
2. commercial/distribution license and required attribution;
3. quantization/runtime compatibility;
4. exact byte size;
5. SHA-256;
6. benchmark result;
7. profile assignment (`lite` or `standard`).

Planning candidate names in project documents are **not release locks**.

The packaging stage may copy verified model payloads from the external asset store into a Windows installer/model pack, but it must never silently substitute an unverified model.

See also:

- `docs/LOCAL_AI_MODEL_PROFILES_v0.1.md`
- `docs/P0_WINDOWS_LOCAL_AI_BENCHMARK_PLAN_v0.1.md`
- `docs/PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`
- `/AGENTS.md`
