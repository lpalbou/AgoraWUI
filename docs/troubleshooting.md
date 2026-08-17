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

**Likely cause:** the in-memory seat key is absent, or the Hub rejected its native `/ws?token=KEY` route.

**Recovery:** verify `GET /whoami` with the same key. Polling remains available while the direct Hub WebSocket reconnects.

## The message pane does not scroll

**Recovery:** refresh the standalone page so the current bounded Team layout loads. Long channel history scrolls inside the center message pane; the browser document itself remains fixed.

## An attachment does not render inline

**Likely cause:** the Hub refused the authenticated attachment request or the bytes are not the declared safe raster type.

**Recovery:** WUI fetches attachment bytes through the direct authenticated Hub client and creates a temporary object URL for safe presentation. Reconnect with a valid seat key if that fetch fails.
