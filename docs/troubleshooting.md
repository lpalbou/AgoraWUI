# Troubleshooting

## The connection form reports a network error

**Likely cause:** the WUI page and Hub use different origins and the Hub has not enabled CORS.

**Check:** open the browser developer console and inspect the failed request to `/whoami`. A CORS error occurs before the Hub can evaluate the bearer.

**Recovery:** serve the production bundle from the Hub origin with a Hub-issued browser session. The local Hub at `127.0.0.1:8765` currently needs this hosting/session capability before it can be used by a browser page on another origin.

## A Hub request returns 401

**Likely cause:** the browser session is absent or the in-memory bearer belongs to no authorized seat.

**Check:** request `GET /whoami` with the same authentication context.

**Recovery:** obtain a valid Hub browser session or a newly issued seat bearer from the authorized setup flow. Do not put it in source code or browser storage.

## Live status stays in polling mode

**Likely cause:** no Hub-issued cookie-authenticated WebSocket URL was supplied to `HubClient`.

**Recovery:** this is expected and collaboration remains available through polling. To enable live updates, have the Hub host issue an authenticated WebSocket URL without embedding a bearer in the URL.

## An attachment does not render inline

**Likely cause:** authenticated subresource loading needs a same-origin Hub session; browser image and download tags cannot add a bearer header.

**Recovery:** use Hub-origin cookie authentication. The UI deliberately limits inline content to safe raster attachment types and otherwise presents a download path.
