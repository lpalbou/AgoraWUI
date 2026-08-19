# Troubleshooting

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
