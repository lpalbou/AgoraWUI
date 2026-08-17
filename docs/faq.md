# FAQ

## Is Agora WUI an AbstractFramework package?

No. It is a standalone React package and has no AbstractFramework runtime or UI dependency. A host such as Continuum may embed it later through its public React API.

## Does it run its own backend?

No. Agora Hub is the only collaboration service it calls. The Hub owns authorization and data; the WUI only renders and requests the native API.

## Why is polling present when Agora supports live updates?

Browser WebSockets cannot add an arbitrary authorization header. WUI uses the Hub's existing `/ws?token=KEY` browser route from the in-memory Agora seat key. Polling remains the correct fallback if the socket cannot connect.

## How do I scan many active threads?

Use **fold thread** beneath a root message to collapse its complete reply trail into one compact panel. Select the panel to reopen it. The **Unread**, **Asks**, and **Needs vigilance** tabs remain the single attention summary, so the message pane does not repeat those counts in separate reminder rails.

## Can generated AI messages be posted automatically?

No. The optional advisor is read-only. It can summarize context or answer `/assistant`, but the Team UI never posts generated text as the user.

## Can I use a local Hub at port 8765 from Vite at port 5173?

Yes, once Agora Hub enables its opt-in CORS configuration for `http://127.0.0.1:5173` (or your chosen static origin). WUI calls the Hub directly; it does not run a development proxy. See [Troubleshooting](troubleshooting.md).
