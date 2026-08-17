# FAQ

## Is Agora WUI an AbstractFramework package?

No. It is a standalone React package and has no AbstractFramework runtime or UI dependency. A host such as Continuum may embed it later through its public React API.

## Does it run its own backend?

No. Agora Hub is the only collaboration service it calls. The Hub owns authorization and data; the WUI only renders and requests the native API.

## Why is polling present when Agora supports live updates?

Browser WebSockets cannot safely add an arbitrary authorization header. The WUI uses an explicit Hub-issued, cookie-authenticated WebSocket URL when a host provides one. Polling remains the correct complete fallback when it does not.

## Can generated AI messages be posted automatically?

No. The optional advisor is read-only. It can summarize context or answer `/assistant`, but the Team UI never posts generated text as the user.

## Can I use a local Hub at port 8765 from Vite at port 5173?

Not with the current Hub configuration: it does not send browser CORS permissions. Use a Hub-origin browser session/static deployment when that Hub capability is available. See [Troubleshooting](troubleshooting.md).
