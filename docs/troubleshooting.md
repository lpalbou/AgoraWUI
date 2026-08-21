# Troubleshooting

## `npm run dev` reports that `vite` is not found

**Likely cause:** the checkout has no `node_modules`. Vite is a development dependency, so a fresh clone provides it only after an install.

**Recovery:** run `npm install`, then `npm run dev`. The bundler compiles the TypeScript and JSX sources into the static page; it is a build tool, and the page it produces still calls Agora Hub directly with no WUI server in between. See [Getting started](getting-started.md#run-the-standalone-page-from-a-fresh-clone).

## The built page is blank when opened from the file system

**Likely cause:** `dist-standalone/index.html` was opened as a `file://` path. It references its bundle and stylesheet from the origin root (`/assets/…`), which no file path resolves.

**Recovery:** serve `dist-standalone/` as the root of an HTTP origin — for example `cd dist-standalone && python3 -m http.server 4173` — and open the `http://` URL. Hosting the directory under a sub-path requires a matching Vite `base` at build time.

## The dev server URL does not open from another machine or a container

**Likely cause:** the dev server binds to `localhost` by default, so it accepts only connections originating on its own host.

**Recovery:** start it with `npm run dev -- --host` and use the printed network URL, or forward the port. A published static bundle is unaffected: it is served by whatever HTTP server you choose.

## The seat key cannot be pasted, and the file picker does not open

**Likely cause:** the page is open in an embedded browser surface rather than a browser tab — an editor preview pane such as VS Code's Simple Browser, or another host-controlled webview. These surfaces commonly consume the paste shortcut before the page receives it and suppress the file dialog, which disables both ways of supplying a seat key.

**Check:** the same URL in a real browser tab accepts a paste and opens the file picker normally.

**Recovery:** open the page in a browser tab. With a forwarded port, use your editor's ports view to open the forwarded URL externally, or enter it in the browser yourself. Both credential paths — pasting a key and importing `~/.agora/keys.json` — depend on browser capabilities the page cannot grant itself. Note that the file picker reads the filesystem of the machine running the browser, so a key cache inside a container or remote host is reachable only from a browser running there.

## Connecting reports that the Hub cannot be reached

**Likely cause:** no Hub is listening at the URL in the form. The field defaults to `http://127.0.0.1:8765`, and a Hub on another port or host does not answer there.

**Check:** request `GET /whoami` against the same URL with the same key — the connect action makes exactly that call. The seats cached in `~/.agora/keys.json` record the Hub URL each key belongs to; use the one that matches.

**Recovery:** start the Agora Hub, or correct the Hub URL to the port it serves. Keys are Hub-specific: a key issued by one Hub does not authenticate against another. The URL is resolved by the browser, not by the machine serving the page: when the page reaches you through a forwarded port, `127.0.0.1` means your own machine, so a Hub running beside the bundle needs its own port forwarded and its forwarded URL entered here — with Hub CORS for the page origin, since the two origins then differ.

## The connection form reports a network error

**Likely cause:** the WUI page and Hub use different origins and the Hub has not enabled CORS.

**Check:** open the browser developer console and inspect the failed request to `/whoami`. A CORS error occurs before the Hub can evaluate the bearer.

**Recovery:** serve the static bundle from the Hub origin, or enable Agora Hub's opt-in CORS configuration for the page origin. Do not add a WUI forwarding proxy.

## A Hub request returns 401

**Likely cause:** the in-memory seat key is absent, malformed, or belongs to no authorized seat.

**Check:** request `GET /whoami` with the same authentication context.

**Recovery:** select the existing `~/.agora/keys.json` cache in the standalone page, or use a key issued by Agora registration/onboarding. Do not put it in source code or browser storage.

## Live status stays in polling mode

**Likely cause:** the in-memory seat key is absent, the Hub rejected its native `/ws?token=KEY` route, or an embedding host holds the key server-side without passing a `ws_url` for its own socket relay.

**Recovery:** verify `GET /whoami` with the same key. Embedding hosts with a server-side key supply `ws_url` in the `HubClient` options (see [Public API](api.md)). Polling remains available while the live socket reconnects.

## The message pane does not scroll

**Recovery:** refresh the standalone page so the current bounded Team layout loads. Long channel history scrolls inside the center message pane; the browser document itself remains fixed.

## The composer is too tall or Speak is missing

**Recovery:** refresh the current static bundle. The native composer is fixed-height and scrolls its text internally. Speak is not a Hub feature: it appears only when the embedding host passes `on_speak_message`, which is where voice/provider policy belongs.

## An attachment does not render inline

**Likely cause:** the Hub refused the authenticated attachment request or the bytes are not the declared safe raster type.

**Recovery:** WUI fetches attachment bytes through the direct authenticated Hub client and creates a temporary object URL for safe presentation. Reconnect with a valid seat key if that fetch fails.
