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

## Open a session with `--seat`

Hand the page a seat key when you start it and it opens an authenticated session on load, with no
paste and no file picker. This is the practical path where the connection card cannot receive a
key — embedded browser surfaces block both — and it removes the re-entry step from ordinary local
work.

```sh
npm run dev -- --seat agora_… --hub http://127.0.0.1:8760
```

The same flags work on a build:

```sh
npm run build:standalone -- --seat agora_… --hub http://127.0.0.1:8760
```

| Flag | Meaning |
| --- | --- |
| `--seat <key>` | The seat key the page opens with |
| `--hub <url>` | The Hub it opens against, replacing the `http://127.0.0.1:8765` default. On the dev server this also carries that Hub at `/hub` on the dev origin |

`--hub` on the dev server means the page calls its own origin and Vite forwards to the Hub, so no
CORS configuration is involved and a Hub the browser cannot route to — one on a container's
loopback, say — is still reachable. That forwarding is the dev server's; a built bundle has none
and calls the Hub directly, which is the deployment the [Browser deployment](#browser-deployment)
section describes.

`--seat` takes the key itself, never a seat name. Naming a seat would mean the build reading
`~/.agora/keys.json` and authenticating as a seat whose secret nobody put on that command line;
whoever starts the page supplies it explicitly, every time. Nothing is read from the environment
for the same reason. That does mean the key enters your shell history — use your shell's leading-space
convention, or run it from the page's connection card instead, if that matters to you.

The dev server takes the flags whether it is bound to localhost or exposed to your network, so a
page reached from a phone or another laptop opens the same session:

```sh
npm run dev -- --seat agora_… --hub http://192.168.1.20:8760 --host
```

Understand what a `--seat` build produces before serving it: **the seat key is written into the
JavaScript, in cleartext, and everyone who loads that page acts as that seat.** Serve such a bundle
only where you would hand out the key itself, never publish or copy it, and rotate the key if it
escapes. The build prints a warning saying so. A build without `--seat` contains no key at all, and
the published npm package has no path to one — the library build defines neither value and does not
compile the standalone entrypoint.

A key the Hub refuses leaves you on the connection card with its reason, prefilled, ready to
correct by hand. To pick a seat out of `~/.agora/keys.json` instead of naming a key, use the card's
file picker: that read happens in the browser, at your explicit selection, and nothing on the
command line reaches for it.

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

The bundle calls Agora Hub directly. Same-origin static hosting works with the native Hub routes. A portable static bundle served from a different origin requires Agora Hub's opt-in CORS configuration for that origin and the `Authorization`, `Content-Type`, and `X-Agora-Client` headers — `agora up --cors-origin <origin>` on the Hub, which already allows exactly those three headers. The dev server's `--hub` forwarding does not apply here: a build ships no forwarding layer.

Browser WebSockets use the existing Hub `/ws?token=KEY` route because browser WebSocket constructors cannot add an `Authorization` header. This key is derived only from the in-memory supplied seat key; WUI does not mint, store, or exchange it. WUI subscribes its readable channels with session-only received cursors, so a reconnect asks the Hub to replay any live gap; the normal REST poll remains the fallback.

## Optional AI features

`TeamPage` does not call an AI service itself. A host may inject the read-only `advisor` function for thread summaries and `/assistant` prompts. The function must never post generated content to an Agora channel on the user's behalf.

## Optional speech

WUI has no speech backend or voice configuration. A React host that owns those policies may pass `on_speak_message`; WUI then adds **Speak** to each message action rail and cancels an in-flight request when the user changes message or channel. The standalone page intentionally has no default speaker.
