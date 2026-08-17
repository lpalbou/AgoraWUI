import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { HubClient } from "./lib/hub_client";
import { TeamPage } from "./ui/team_page";
import "./ui/styles.css";

const DEFAULT_HUB = "http://127.0.0.1:8765";

function StandaloneApp(): React.ReactElement {
  const [hub_url, set_hub_url] = useState(DEFAULT_HUB);
  const [token, set_token] = useState("");
  const [session, set_session] = useState<{ hub_url: string; token: string } | null>(null);
  const [error, set_error] = useState("");
  const client = useMemo(
    () => session ? new HubClient({ base_url: session.hub_url, bearer_token: session.token }) : null,
    [session],
  );

  async function connect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    set_error("");
    const next = { hub_url: hub_url.trim().replace(/\/+$/, ""), token: token.trim() };
    if (!next.hub_url || !next.token) {
      set_error("Enter the Agora Hub URL and a seat bearer token.");
      return;
    }
    try {
      const probe = new HubClient({ base_url: next.hub_url, bearer_token: next.token });
      await probe.meta();
      set_session(next);
      set_token("");
    } catch (cause: any) {
      set_error(String(cause?.message || cause || "The Hub rejected this session."));
    }
  }

  if (client) {
    return (
      <div className="wui_app">
        <TeamPage hub={client} />
        <button className="wui_disconnect" onClick={() => set_session(null)} title="Discard the in-memory Hub session">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <main className="wui_bootstrap">
      <section className="wui_bootstrap_card" aria-labelledby="wui-title">
        <p className="eyebrow">Agora collaboration</p>
        <h1 id="wui-title">Open Team</h1>
        <p className="muted">Connect directly to your Agora Hub. This page never stores a bearer token; it remains in memory only for this tab.</p>
        <form onSubmit={(event) => void connect(event)}>
          <label htmlFor="hub-url">Hub URL</label>
          <input id="hub-url" value={hub_url} onChange={(event) => set_hub_url(event.target.value)} autoComplete="url" spellCheck={false} />
          <label htmlFor="hub-token">Seat bearer token</label>
          <input id="hub-token" type="password" value={token} onChange={(event) => set_token(event.target.value)} autoComplete="off" spellCheck={false} />
          {error ? <p className="page_error" role="alert">{error}</p> : null}
          <button className="btn primary" type="submit">Connect to Hub</button>
        </form>
        <p className="muted wui_bootstrap_note">For the one-server production topology, serve this bundle from the Hub origin with a Hub-issued browser session. The running Hub must provide that session capability before a browser can connect without a token.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StandaloneApp />);
