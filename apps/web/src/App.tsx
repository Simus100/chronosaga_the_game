import { useEffect, useMemo, useState } from "react";
import type { GameEvent, WorldState } from "@paa/game-types";

type Resolution = {
  state: WorldState;
  narration?: { narration: string };
};

export function App() {
  const [state, setState] = useState<WorldState | null>(null);
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [narration, setNarration] = useState("SYSTEM READY // Awaiting first directive.");
  const [busy, setBusy] = useState(false);

  async function newCampaign() {
    setBusy(true);
    const created = await fetch("/api/v1/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: 7419 })
    }).then(r => r.json());
    setState(created);
    const nextEvent = await fetch(`/api/v1/campaigns/${created.campaignId}/event/current`).then(r => r.json());
    setEvent(nextEvent);
    setBusy(false);
  }

  async function choose(choiceId: string) {
    if (!state || !event) return;
    setBusy(true);
    const result: Resolution = await fetch(
      `/api/v1/campaigns/${state.campaignId}/event/${event.id}/choice`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choiceId })
      }
    ).then(r => r.json());

    setState(result.state);
    setNarration(result.narration?.narration ?? "STATE RESOLVED.");
    const nextEvent = await fetch(`/api/v1/campaigns/${result.state.campaignId}/event/current`).then(r => r.json());
    setEvent(nextEvent);
    setBusy(false);
  }

  useEffect(() => { void newCampaign(); }, []);

  const activeFlags = useMemo(
    () => state ? Object.entries(state.flags).filter(([,v]) => Boolean(v)).map(([k]) => k) : [],
    [state]
  );

  if (!state || !event) return <div className="boot">INITIALIZING WORLD STATE…</div>;

  return (
    <main className="shell">
      <header className="telemetry">
        <strong>PARAMETRIC // COMMAND OS</strong>
        <span>TURN {String(state.turn).padStart(4, "0")}</span>
        <span>DAY {String(state.day).padStart(3, "0")}</span>
        <span>PRESSURE {state.worldPressure}</span>
        <span>AI {state.profile.aiMode.toUpperCase()}</span>
      </header>

      <nav className="tabs">
        <button className="active">COMMAND</button>
        <button>PARTY</button>
        <button>MAP</button>
        <button>FACTIONS</button>
        <button>MISSIONS</button>
        <button>CHRONICLE</button>
      </nav>

      <section className="grid">
        <aside className="panel left">
          <h2>PARTY STATUS</h2>
          {state.party.map(c => (
            <article className="entity" key={c.id}>
              <div className="portrait">IMAGE<br/>PLACEHOLDER</div>
              <div>
                <strong>{c.name}</strong>
                <small>{c.role}</small>
                <p>HP {c.health} // STRESS {c.stress}</p>
              </div>
            </article>
          ))}
          <h2>RESOURCES</h2>
          {Object.entries(state.resources).map(([k,v]) => (
            <div className="metric" key={k}><span>{k.toUpperCase()}</span><b>{v}</b></div>
          ))}
        </aside>

        <section className="panel viewport">
          <div className="starfield" />
          <div className="scanline" />
          <div className="location">
            <span>SECTOR // R-17</span>
            <strong>BLACK RIDGE FRONTIER</strong>
            <small>Procedural viewport placeholder</small>
          </div>
          <div className="node n1" /><div className="node n2" /><div className="node n3" />
        </section>

        <aside className="panel right">
          <h2>EVENTS & DIRECTIVES</h2>
          <div className="event">
            <span>{event.category.toUpperCase()}</span>
            <h1>{event.title}</h1>
            <p>{event.body}</p>
          </div>
          <div className="choices">
            {event.choices.map(choice => (
              <button key={choice.id} disabled={busy} onClick={() => choose(choice.id)}>
                <b>{choice.label}</b>
                <small>{choice.description ?? "Execute directive"}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel log">
          <h2>DM INTERPRETATION</h2>
          <p>{narration}</p>
        </section>

        <section className="panel status">
          <h2>ACTIVE STATE</h2>
          <p>{activeFlags.length ? activeFlags.join(" // ") : "NO PERSISTENT FLAGS"}</p>
        </section>
      </section>

      <footer className="command">
        <button onClick={() => void newCampaign()}>NEW CAMPAIGN</button>
        <span>Simulation Core authoritative // AI narrative non-authoritative</span>
      </footer>
    </main>
  );
}
