import { useState } from "react";
import type { NarrationSource } from "../gameplay/narration";
import { tauriPersistence, type SystemicPersistence } from "../platform/persistence";
import { tauriTelemetrySink } from "../platform/playtest";
import { BUILD_INFO } from "../playtest/build-info";
import type { TelemetrySink } from "../playtest/telemetry";
import { ProofPlayScreen } from "./ProofPlayScreen";
import { SystemicPlayScreen } from "./SystemicPlayScreen";

/**
 * The one choice before play: which Helios Reach.
 *
 *   Baseline M1                 `createSystemicScenario`, schema v1 -- the
 *                               accepted M1 screen, mounted unchanged
 *   Gameplay Quality Proof      `createGqpScenario`, schema v2 -- the proof
 *
 * Two explicit modes, each with its own save slot (`cmp_7419` / `gqp_7419`).
 * Nothing silently swaps one for the other, and opening one never migrates the
 * other: a v1 world is never opened as a proof, and the proof never replaces M1.
 */

type Mode = "menu" | "m1" | "proof";

interface Props {
  readonly persistence?: SystemicPersistence;
  readonly sink?: TelemetrySink;
  readonly narration?: NarrationSource;
  readonly onExit?: () => void;
}

export function PlayRoot({ persistence = tauriPersistence, sink = tauriTelemetrySink, narration, onExit }: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [leaveArmed, setLeaveArmed] = useState(false);

  if (mode === "proof") {
    return <ProofPlayScreen persistence={persistence} sink={sink} onMenu={() => setMode("menu")} onExit={onExit} />;
  }

  if (mode === "m1") {
    // The accepted M1 screen, exactly as it was; the only addition is a way
    // back to this menu, outside it, which warns before abandoning a run.
    return (
      <>
        <SystemicPlayScreen persistence={persistence} narration={narration} onExit={onExit} />
        <button
          className="mode-back"
          onClick={() => {
            if (!leaveArmed) {
              setLeaveArmed(true);
              return;
            }
            setLeaveArmed(false);
            setMode("menu");
          }}
          onBlur={() => setLeaveArmed(false)}
        >
          {leaveArmed ? "CONFERMA: TORNA AL MENU (la partita non salvata va persa)" : "◂ MENU"}
        </button>
      </>
    );
  }

  return (
    <main className="play play--empty mode-menu">
      <h1>CHRONOSAGA</h1>
      <p className="play__subtitle">HELIOS REACH · SCEGLI COSA GIOCARE</p>
      <div className="mode-menu__options">
        <section className="mode-menu__option mode-menu__option--proof">
          <h2>Prova di gioco</h2>
          <p>La versione per il playtest del founder (Gameplay Quality Proof): decisioni, momenti di quiete, personaggi che ricordano. 12–15 momenti di gioco.</p>
          <button className="play__button play__button--primary" onClick={() => setMode("proof")}>
            PROVA DI GIOCO
          </button>
        </section>
        <section className="mode-menu__option">
          <h2>Versione base (M1)</h2>
          <p>La simulazione sistemica M1 già accettata, invariata.</p>
          <button className="play__button" onClick={() => setMode("m1")}>
            VERSIONE BASE (M1)
          </button>
        </section>
      </div>
      {onExit ? (
        <button className="play__button play__button--ghost" onClick={onExit}>
          DIAGNOSTICA P0
        </button>
      ) : null}
      <p className="mode-menu__build">versione {BUILD_INFO.commit.slice(0, 12)}</p>
    </main>
  );
}
