import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { HubClient } from "./lib/hub_client";
import { parse_agora_key_cache, type CachedAgoraSeat } from "./lib/seat_key_cache";
import { TeamPage } from "./ui/team_page";
// Both layers, imported directly. A CSS `@import` chain is fragile when a
// bundler inlines the sheet into a <style> tag (relative imports then
// resolve against the page, not the stylesheet); dist/styles.css is
// generated as a real concatenation for npm consumers.
import "./ui/theme.css";
import "./ui/team.css";

const DEFAULT_HUB = "http://127.0.0.1:8765";

// Supplied by vite.config.app.ts, empty unless this page was built or served
// with a preset seat key. Declared rather than read from `import.meta.env`:
// these are the only two values the standalone entrypoint takes from its
// environment, and naming them here keeps that surface countable.
declare const __AGORA_PRESET_SEAT_KEY__: string;
declare const __AGORA_PRESET_HUB_URL__: string;

const PRESET_SEAT_KEY = __AGORA_PRESET_SEAT_KEY__;
const PRESET_HUB_URL = __AGORA_PRESET_HUB_URL__;

if (PRESET_SEAT_KEY) {
  // Said out loud: a page that authenticates by itself authenticates for
  // everyone who can reach it, and a built one carries the key in its bytes.
  console.warn("Agora WUI: this page holds a preset seat key and opens a session on load. Everyone who can reach it acts as that seat.");
}

function StandaloneApp(): React.ReactElement {
  const [hub_url, set_hub_url] = useState(PRESET_HUB_URL || DEFAULT_HUB);
  const [token, set_token] = useState(PRESET_SEAT_KEY);
  const [cached_seats, set_cached_seats] = useState<CachedAgoraSeat[]>([]);
  const [selected_cache_key, set_selected_cache_key] = useState("");
  const [session, set_session] = useState<{ hub_url: string; token: string } | null>(null);
  const [error, set_error] = useState("");
  const cached_seat = cached_seats.find((entry) => `${entry.hub_url}::${entry.seat}` === selected_cache_key) || null;
  const client = useMemo(
    () => session ? new HubClient({ base_url: session.hub_url, bearer_token: session.token }) : null,
    [session],
  );

  async function open_session(raw_hub_url: string, raw_token: string): Promise<void> {
    set_error("");
    const next = { hub_url: raw_hub_url.trim().replace(/\/+$/, ""), token: raw_token.trim() };
    if (!next.hub_url || !next.token) {
      set_error("Select an existing Agora key cache or enter a seat key.");
      return;
    }
    try {
      const probe = new HubClient({ base_url: next.hub_url, bearer_token: next.token });
      await probe.meta();
      set_session(next);
      set_token("");
      set_cached_seats([]);
      set_selected_cache_key("");
    } catch (cause: any) {
      set_error(String(cause?.message || cause || "The Hub rejected this session."));
    }
  }

  async function connect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await open_session(hub_url, cached_seat?.bearer_token || token);
  }

  // A preset key opens the session once, on load. A refusal leaves the card
  // exactly as a manual attempt would — prefilled, carrying the Hub's own
  // message — and Disconnect returns there without connecting again.
  const auto_connected = useRef(false);
  useEffect(() => {
    if (auto_connected.current || !PRESET_SEAT_KEY) return;
    auto_connected.current = true;
    void open_session(PRESET_HUB_URL || DEFAULT_HUB, PRESET_SEAT_KEY);
  }, []);

  async function import_key_cache(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    set_error("");
    try {
      const entries = parse_agora_key_cache(await file.text());
      const normalized_hub = hub_url.trim().replace(/\/+$/, "");
      const selected = entries.find((entry) => entry.hub_url === normalized_hub) || entries[0];
      set_cached_seats(entries);
      set_selected_cache_key(`${selected.hub_url}::${selected.seat}`);
      set_hub_url(selected.hub_url);
      set_token("");
    } catch (cause: any) {
      set_cached_seats([]);
      set_selected_cache_key("");
      set_error(String(cause?.message || cause || "Could not read the Agora key cache."));
    } finally {
      event.target.value = "";
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
        <p className="muted">Connect directly to your Agora Hub. This page only renders and relays Hub state; it never stores a seat key.</p>
        <form onSubmit={(event) => void connect(event)}>
          <label htmlFor="hub-url">Hub URL</label>
          <input id="hub-url" value={hub_url} onChange={(event) => set_hub_url(event.target.value)} autoComplete="url" spellCheck={false} />
          <label htmlFor="agora-key-cache">Existing Agora key cache</label>
          <input id="agora-key-cache" type="file" accept="application/json,.json" onChange={(event) => void import_key_cache(event)} />
          {cached_seats.length ? (
            <>
              <label htmlFor="agora-seat">Seat from that cache</label>
              <select id="agora-seat" value={selected_cache_key} onChange={(event) => {
                const value = event.target.value;
                const next = cached_seats.find((entry) => `${entry.hub_url}::${entry.seat}` === value);
                set_selected_cache_key(value);
                if (next) set_hub_url(next.hub_url);
              }}>
                {cached_seats.map((entry) => <option key={`${entry.hub_url}::${entry.seat}`} value={`${entry.hub_url}::${entry.seat}`}>{entry.seat} · {entry.hub_url}</option>)}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="hub-token">Seat key</label>
              <input id="hub-token" type="password" value={token} onChange={(event) => set_token(event.target.value)} autoComplete="off" spellCheck={false} />
            </>
          )}
          {error ? <p className="page_error" role="alert">{error}</p> : null}
          <button className="btn primary" type="submit">Connect to Hub</button>
        </form>
        <p className="muted wui_bootstrap_note">Native clients already use <code>~/.agora/keys.json</code> for <code>--as laurent</code>. A browser cannot read it itself; selecting it above imports one existing seat key into this tab only. A portable static bundle also needs Agora Hub CORS for its serving origin.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StandaloneApp />);
