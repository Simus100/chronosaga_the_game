import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDatabaseStatus,
  getLocalAiRuntimeStatus,
  getRuntimeStatus,
  getSystemInfo,
  loadSmokeCampaign,
  saveSmokeCampaign,
  startLocalAiRuntime,
  stopLocalAiRuntime,
  type P0DatabaseStatus,
  type P0LocalAiRuntimeSnapshot,
  type P0RuntimeStatus,
  type P0SmokeCampaign,
  type P0SystemInfo,
} from "../platform/desktop";

const SMOKE_CAMPAIGN_ID = "p0-smoke-local";

function gbFromMb(value?: number | null): string {
  if (value === undefined || value === null) return "UNKNOWN";
  return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
}

/**
 * Player-facing label for an AI profile id.
 *
 * AUTO / LITE / STANDARD are the normal profiles. `procedural` stays the
 * internal id everywhere — save, manifest, contracts — but must never be shown
 * as a fourth equivalent choice: it is the degraded recovery path.
 */
function aiProfileLabel(value?: string): string {
  return value === "procedural" ? "SAFE MODE (NO LOCAL AI)" : (value ?? "auto").toUpperCase();
}

function normalizeProfile(value?: string): P0SmokeCampaign["aiProfile"] {
  if (value === "lite" || value === "standard" || value === "procedural") return value;
  return "auto";
}

export function DesktopP0Screen() {
  const [system, setSystem] = useState<P0SystemInfo | null>(null);
  const [runtime, setRuntime] = useState<P0RuntimeStatus | null>(null);
  const [database, setDatabase] = useState<P0DatabaseStatus | null>(null);
  const [loaded, setLoaded] = useState<P0SmokeCampaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("P0 diagnostics not executed yet.");
  const [error, setError] = useState<string | null>(null);

  const [ai, setAi] = useState<P0LocalAiRuntimeSnapshot | null>(null);
  const aiTimer = useRef<number | null>(null);

  // A pure read on the Rust side: the background watcher is what advances the
  // state machine, this only mirrors it.
  async function refreshAi() {
    try {
      setAi(await getLocalAiRuntimeStatus());
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function startAi() {
    setBusy(true);
    try {
      setAi(await startLocalAiRuntime());
      setMessage("Local AI runtime starting; the watcher will report readiness.");
    } catch (cause) {
      setError(String(cause));
      setMessage("Local AI runtime failed to start.");
      void refreshAi();
    } finally {
      setBusy(false);
    }
  }

  async function stopAi() {
    setBusy(true);
    try {
      setAi(await stopLocalAiRuntime());
      setMessage("Local AI runtime stopped.");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function runDiagnostics() {
    setBusy(true);
    setError(null);
    setMessage("RUNNING LOCAL RUNTIME CHECK…");
    try {
      const [nextSystem, nextRuntime, nextDatabase] = await Promise.all([
        getSystemInfo(),
        getRuntimeStatus(),
        getDatabaseStatus(),
      ]);
      setSystem(nextSystem);
      setRuntime(nextRuntime);
      setDatabase(nextDatabase);
      setMessage("P0.1 / P0.2 BASELINE READY");
    } catch (reason) {
      setError(String(reason));
      setMessage("P0 CHECK FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function saveSmoke() {
    if (!database?.ready) await runDiagnostics();
    setBusy(true);
    setError(null);
    try {
      const campaign: P0SmokeCampaign = {
        campaignId: SMOKE_CAMPAIGN_ID,
        seed: 7419,
        turn: (loaded?.turn ?? 0) + 1,
        aiProfile: normalizeProfile(runtime?.recommendedAiProfile),
        createdAt: loaded?.createdAt ?? new Date().toISOString(),
        schemaVersion: 1,
      };
      const saved = await saveSmokeCampaign(campaign);
      setLoaded(saved);
      setMessage(`SQLITE SAVE OK // TURN ${saved.turn}`);
    } catch (reason) {
      setError(String(reason));
      setMessage("SQLITE SAVE FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function loadSmoke() {
    setBusy(true);
    setError(null);
    try {
      const campaign = await loadSmokeCampaign(SMOKE_CAMPAIGN_ID);
      setLoaded(campaign);
      setMessage(campaign ? `SQLITE LOAD OK // TURN ${campaign.turn}` : "NO SMOKE SAVE FOUND");
    } catch (reason) {
      setError(String(reason));
      setMessage("SQLITE LOAD FAILED");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void runDiagnostics();
    void refreshAi();
    aiTimer.current = window.setInterval(() => void refreshAi(), 500);
    return () => {
      if (aiTimer.current !== null) window.clearInterval(aiTimer.current);
    };
  }, []);

  const runtimeChecks = useMemo(
    () => [
      { label: "DATABASE", value: database?.ready ? "READY" : "WAIT", ok: Boolean(database?.ready) },
      {
        label: "MODEL MANIFEST",
        value: runtime?.modelManifestPresent ? "READY" : "MISSING",
        ok: Boolean(runtime?.modelManifestPresent),
      },
      {
        label: "LLAMA SERVER",
        value: runtime?.llamaServerPresent ? "READY" : "P0.3 PENDING",
        ok: Boolean(runtime?.llamaServerPresent),
      },
    ],
    [database, runtime],
  );

  return (
    <main className="p0-shell">
      <header className="p0-topline">
        <div>
          <strong>CHRONOSAGA // WINDOWS P0</strong>
          <span>LOCAL RUNTIME VALIDATION</span>
        </div>
        <div className="p0-phase">P0.1 + P0.2</div>
      </header>

      <section className="p0-hero">
        <div>
          <span className="p0-kicker">SYSTEM INITIALIZATION</span>
          <h1>WINDOWS OFFLINE BASELINE</h1>
          <p>
            Hardware probe, resource-path validation and SQLite persistence. The LLM runtime is
            intentionally the next gate, not a hidden dependency of this screen.
          </p>
        </div>
        <button disabled={busy} onClick={() => void runDiagnostics()}>
          {busy ? "CHECKING…" : "RUN SYSTEM TEST"}
        </button>
      </section>

      <section className="p0-layout">
        <article className="p0-panel p0-system">
          <h2>HARDWARE / OS</h2>
          <dl>
            <div><dt>OS</dt><dd>{system ? `${system.osName} ${system.osVersion}` : "—"}</dd></div>
            <div><dt>ARCH</dt><dd>{system?.arch.toUpperCase() ?? "—"}</dd></div>
            <div><dt>CPU</dt><dd>{system?.cpuBrand ?? "—"}</dd></div>
            <div><dt>LOGICAL CORES</dt><dd>{system?.logicalCores ?? "—"}</dd></div>
            <div><dt>PHYSICAL CORES</dt><dd>{system?.physicalCores ?? "—"}</dd></div>
            <div><dt>RAM TOTAL</dt><dd>{gbFromMb(system?.totalRamMb)}</dd></div>
            <div><dt>RAM AVAILABLE</dt><dd>{gbFromMb(system?.availableRamMb)}</dd></div>
            <div><dt>FREE STORAGE</dt><dd>{gbFromMb(system?.freeStorageMb)}</dd></div>
          </dl>
          <p className="p0-note">{system?.gpuProbeStatus ?? "GPU probe pending."}</p>
        </article>

        <article className="p0-panel p0-runtime">
          <h2>LOCAL AI READINESS</h2>
          <div className="p0-recommendation">
            <span>AUTO RECOMMENDATION</span>
            <strong>{runtime?.recommendedAiProfile?.toUpperCase() ?? "—"}</strong>
          </div>
          <div className="p0-profile-grid">
            {runtime?.profiles.map(profile => (
              <div className="p0-profile" key={profile.id}>
                <strong>{profile.label}</strong>
                <span>{profile.candidateFamily}</span>
                <small>
                  {gbFromMb(profile.modelSizeMinMb)}–{gbFromMb(profile.modelSizeMaxMb)} model · RAM min {gbFromMb(profile.minRamMb)}
                </small>
              </div>
            )) ?? <span className="p0-muted">Waiting for model manifest…</span>}
          </div>
          <p className="p0-path">MANIFEST // {runtime?.modelManifestPath ?? "—"}</p>
        </article>

        <article className="p0-panel p0-checks">
          <h2>RUNTIME GATES</h2>
          {runtimeChecks.map(check => (
            <div className="p0-check" key={check.label}>
              <span>{check.label}</span>
              <b className={check.ok ? "ok" : "pending"}>{check.value}</b>
            </div>
          ))}
          <p className="p0-path">DATA // {system?.appLocalDataDir ?? "—"}</p>
          <p className="p0-path">DB // {database?.path ?? "—"}</p>
        </article>

        <article className="p0-panel p0-checks">
          <h2>LOCAL AI RUNTIME</h2>
          <div className="p0-check"><span>STATE</span>
            <b className={ai?.runtimeReady ? "ok" : "pending"}>{ai?.state.toUpperCase() ?? "—"}</b></div>
          <div className="p0-check"><span>BINARY PRESENT</span>
            <b className={ai?.binaryPresent ? "ok" : "pending"}>{ai?.binaryPresent ? "YES" : "NO"}</b></div>
          <div className="p0-check"><span>PID</span>
            <b className="pending">{ai?.pid ?? "—"}</b></div>
          <div className="p0-check"><span>RUNTIME READY</span>
            <b className={ai?.runtimeReady ? "ok" : "pending"}>{ai?.runtimeReady ? "TRUE" : "FALSE"}</b></div>
          <div className="p0-check"><span>INFERENCE READY</span>
            <b className={ai?.inferenceReady ? "ok" : "pending"}>{ai?.inferenceReady ? "TRUE" : "FALSE"}</b></div>
          <div className="p0-check"><span>HOST</span><b className="pending">{ai?.host ?? "—"}</b></div>
          <div className="p0-check"><span>PORT</span><b className="pending">{ai?.port ?? "—"}</b></div>
          <div className="p0-actions">
            <button disabled={busy} onClick={() => void startAi()}>START LOCAL AI</button>
            <button disabled={busy} onClick={() => void stopAi()}>STOP LOCAL AI</button>
            <button disabled={busy} onClick={() => void refreshAi()}>REFRESH STATUS</button>
          </div>
          {ai?.lastError && <p className="p0-path">ERROR // {ai.lastError}</p>}
          <small>
            RUNTIME READY significa che llama-server risponde su /health. Non significa che
            l&apos;inferenza sia disponibile: senza modello caricato INFERENCE READY resta FALSE
            fino a P0.3-C. I profili normali sono AUTO / LITE / STANDARD; SAFE MODE (nessuna AI
            locale) e&apos; un percorso di recupero a narrativa ridotta, non un quarto profilo
            equivalente.
          </small>
        </article>

        <article className="p0-panel p0-save">
          <h2>SQLITE PERSISTENCE SMOKE TEST</h2>
          <div className="p0-save-state">
            <span>CAMPAIGN</span><b>{loaded?.campaignId ?? SMOKE_CAMPAIGN_ID}</b>
            <span>SEED</span><b>{loaded?.seed ?? 7419}</b>
            <span>TURN</span><b>{loaded?.turn ?? "NOT LOADED"}</b>
            <span>AI PROFILE</span><b>{aiProfileLabel(loaded?.aiProfile)}</b>
            <span>SCHEMA</span><b>{database?.schemaVersion ?? "—"}</b>
          </div>
          <div className="p0-actions">
            <button disabled={busy} onClick={() => void saveSmoke()}>SAVE / ADVANCE TURN</button>
            <button disabled={busy} onClick={() => void loadSmoke()}>LOAD FROM SQLITE</button>
          </div>
          <small>
            Test reale: salva, chiudi completamente Chronosaga, riaprilo e premi LOAD FROM SQLITE.
            Il turno deve essere lo stesso.
          </small>
        </article>
      </section>

      <footer className="p0-footer">
        <div className={error ? "p0-result error" : "p0-result"}>{message}</div>
        {error && <pre>{error}</pre>}
        <span>SIMULATION CORE AUTHORITY // LOCAL-FIRST // WEB-COMPATIBLE</span>
      </footer>
    </main>
  );
}
