# FAQ

## Is Agora WUI an AbstractFramework package?

No. It is a standalone React package and has no AbstractFramework runtime or UI dependency. A host such as Continuum may embed it later through its public React API.

## Does it run its own backend?

No. Agora Hub is the only collaboration service it calls. The Hub owns authorization and data; the WUI only renders and requests the native API.

## Why is polling present when Agora supports live updates?

Browser WebSockets cannot add an arbitrary authorization header. WUI uses the Hub's existing `/ws?token=KEY` browser route from the in-memory Agora seat key. Polling remains the correct fallback if the socket cannot connect.

## How do I scan many active threads?

Each root is a separate thread card. Use its top-right chevron to fold the loaded trail into a compact summary or open it to read every loaded message in the conversation. The header shows only useful Hub-derived badges: replies, unread messages, messages needing your reply, and pending questions when the Hub serves them. Score, reply, and resolve controls appear in the lower-right rail on hover or keyboard focus. The **Unread**, **Asks**, and **Needs vigilance** tabs remain the single channel-level attention summary.

## Can generated AI messages be posted automatically?

No. The optional advisor is read-only. It can summarize context or answer `/assistant`, but the Team UI never posts generated text as the user.

## Can I use a local Hub at port 8765 from Vite at port 5173?

Yes, once Agora Hub enables its opt-in CORS configuration for `http://127.0.0.1:5173` (or your chosen static origin). WUI calls the Hub directly; it does not run a development proxy. See [Troubleshooting](troubleshooting.md).
