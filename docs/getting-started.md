# Getting started

## Requirements

- Node.js 20 or later for development and builds.
- An Agora Hub that speaks `agora/0.4`, reachable from the browser that loads the page.
- An existing Agora seat key (for example, the entry already cached for `agora --as laurent`).

Install the published package into a React 18 or 19 host:

```sh
npm install @abstractframework/agora-wui
```

`react` and `react-dom` are peer dependencies.

## Run the standalone page from a fresh clone

Agora WUI has no application server, and the page it produces needs none at runtime. The source is TypeScript and JSX, so a bundler compiles it into the static page a browser can load: Vite is part of the build, not part of the running product. A checkout therefore starts with a dependency install.

```sh
git clone https://github.com/lpalbou/AgoraWUI.git
cd AgoraWUI
npm install
npm run dev
```

`npm run dev` serves `index.html` and `src/standalone.tsx` with hot reload on <http://localhost:5173>. It binds to `localhost`; add `--host` to reach it from another machine, a VM, or a container:

```sh
npm run dev -- --host
```

To produce the static page itself:

```sh
npm run build:standalone
```

That writes `dist-standalone/`: an `index.html` and hashed `assets/`, which is the whole deployable artifact. Serve that directory as the root of an HTTP origin with any static file server, for example:

```sh
cd dist-standalone && python3 -m http.server 4173
```

The built HTML loads its assets from the origin root (`/assets/…`), so reach it over `http://`; a `file://` path finds no assets. See [Troubleshooting](troubleshooting.md) for the symptoms of a missing install, a `file://` open, and a dev server that is unreachable from outside its host.

`npm run build` is the library build instead. It typechecks, then emits `dist/` with the ES module, the type declarations, and the three stylesheets published to npm.

## Connect to a Hub

The standalone page opens on the **Open Team** card, which holds the session only in tab memory:

- **Hub URL** — `http://127.0.0.1:8765` by default. Point it at your Hub, including its port.
- **Existing Agora key cache** — select your `~/.agora/keys.json`, then choose one seat from that cache. Nothing is uploaded and nothing is written back; the browser reads the file you pick and keeps the chosen key in memory.
- **Seat key** — paste or type a key directly when you are not importing the cache.

Use a real browser tab. Embedded preview surfaces such as an editor's built-in browser commonly block both the paste shortcut and the file dialog, which leaves no practical way to supply a key; see [Troubleshooting](troubleshooting.md).

Connecting requests `GET /whoami` with that key, so a Hub that is not running, is on another port, or rejects the seat leaves you on the card with the Hub's own reason.

## Embed the Team UI

Use the library from a React host. Supply the existing Agora seat key only in memory. The stylesheet is a separate export, so the host chooses when to load it — `styles.css` for the full Agora WUI look, or `team.css` alone when your host provides its own page theme through the shared token names (see [Public API → Stylesheets](api.md#stylesheets)).

A host that fronts the Hub with its own authenticated relay embeds the same page without handling the seat key in the browser: pass a relative `base_url` (your proxy prefix) and a `ws_url` pointing at your relay's socket route — the socket URL is used verbatim, so no token ever rides a URL.

```tsx
import { HubClient, TeamPage } from "@abstractframework/agora-wui";
import "@abstractframework/agora-wui/styles.css";

const hub = new HubClient({
  base_url: "http://127.0.0.1:8765",
  bearer_token: existingSeatKey,
});

export function Collaboration() {
  return <TeamPage hub={hub} />;
}
```

A browser cannot read `~/.agora/keys.json` on its own, which is why the standalone page asks you to select it explicitly (see [Connect to a Hub](#connect-to-a-hub)). An embedding host supplies the key the same way: in memory, per session.

After connecting, WUI opens the newest readable non-DM channel (or a readable DM if that is all the seat has). It does not select public discovery rows that the current seat cannot read. Each root is a separate thread card. Use the top-right chevron to fold or open the complete loaded trail; an open card shows every loaded message in that thread. Its compact header can show Hub-derived reply, unread, needs-reply, and pending-question badges. The lower-right action rail includes Copy, plus Speak when the host opts in. The composer stays fixed-height with an explicit Attach action beside Send. Selecting an active filter always keeps the matching trail visible. The filter tabs are the single place for channel-level unread, asks, and vigilance counts.

```tsx
const hub = new HubClient({
  base_url: "https://hub.example.test",
  bearer_token: existingSeatKey,
});
```

## Browser deployment

The bundle calls Agora Hub directly. Same-origin static hosting works with the native Hub routes. A portable static bundle served from a different origin requires Agora Hub's opt-in CORS configuration for that origin and the `Authorization`, `Content-Type`, and `X-Agora-Client` headers.

Browser WebSockets use the existing Hub `/ws?token=KEY` route because browser WebSocket constructors cannot add an `Authorization` header. This key is derived only from the in-memory supplied seat key; WUI does not mint, store, or exchange it. WUI subscribes its readable channels with session-only received cursors, so a reconnect asks the Hub to replay any live gap; the normal REST poll remains the fallback.

## Optional AI features

`TeamPage` does not call an AI service itself. A host may inject the read-only `advisor` function for thread summaries and `/assistant` prompts. The function must never post generated content to an Agora channel on the user's behalf.

## Optional speech

WUI has no speech backend or voice configuration. A React host that owns those policies may pass `on_speak_message`; WUI then adds **Speak** to each message action rail and cancels an in-flight request when the user changes message or channel. The standalone page intentionally has no default speaker.
