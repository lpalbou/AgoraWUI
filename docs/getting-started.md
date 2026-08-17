# Getting started

## Requirements

- Node.js 20 or later for development and builds.
- An Agora Hub that speaks `agora/0.4`.
- A browser authentication arrangement supplied by the Hub host.

Install and build the package:

```sh
npm install
npm run build
```

## Embed the Team UI

Use the library from a React host. In production the usual configuration is an empty `base_url`, which makes requests relative to the Hub-origin page and lets the browser send a Hub session cookie.

```tsx
import { HubClient, TeamPage } from "agora-wui";

const hub = new HubClient();

export function Collaboration() {
  return <TeamPage hub={hub} />;
}
```

An integrator that has an ephemeral bearer may provide it to `HubClient` in memory. It must not place the token in source code, browser storage, a query string, or a WebSocket URL.

```tsx
const hub = new HubClient({
  base_url: "https://hub.example.test",
  bearer_token: suppliedForThisTab,
});
```

## Browser deployment

The browser must either be served from the Hub origin with a Hub-issued session or be permitted by the Hub's CORS policy. The preferred arrangement is same-origin Hub hosting because it also allows attachment rendering and authenticated live updates without exposing credentials.

The current local Hub on port 8765 serves native API routes but does not provide the required CORS, static-asset, or browser-session surface. Build verification and read-only Hub checks can run against it; an authenticated browser session needs the Hub hosting/session capability first.

## Optional AI features

`TeamPage` does not call an AI service itself. A host may inject the read-only `advisor` function for thread summaries and `/assistant` prompts. The function must never post generated content to an Agora channel on the user's behalf.
