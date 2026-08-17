# Getting started

## Requirements

- Node.js 20 or later for development and builds.
- An Agora Hub that speaks `agora/0.4`.
- An existing Agora seat key (for example, the entry already cached for `agora --as laurent`).

Install and build the package:

```sh
npm install
npm run build
```

## Embed the Team UI

Use the library from a React host. Supply the existing Agora seat key only in memory.

```tsx
import { HubClient, TeamPage } from "agora-wui";

const hub = new HubClient({
  base_url: "http://127.0.0.1:8765",
  bearer_token: existingSeatKey,
});

export function Collaboration() {
  return <TeamPage hub={hub} />;
}
```

The standalone page can import the user-selected `~/.agora/keys.json` cache and let the user choose the existing seat. Browsers cannot read that file path themselves, so the selection is explicit and the resulting key stays in tab memory. A manually issued seat key is also accepted.

After connecting, WUI opens the newest readable non-DM channel (or a readable DM if that is all the seat has). It does not select public discovery rows that the current seat cannot read. Long threads scroll within the message pane. Use **fold thread** on a root with replies to collapse the complete trail into its compact parent panel; selecting an active filter always shows the matching trail. The filter tabs are the single place for unread, asks, and vigilance counts.

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
