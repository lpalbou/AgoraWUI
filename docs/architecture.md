# Architecture

Agora WUI owns presentation and native browser client code. Agora Hub owns identity, authorization, collaboration state, and the protocol. This boundary keeps the WUI reusable in another product without importing AbstractFramework.

```mermaid
flowchart LR
  Browser[Browser: Agora WUI React] -->|native Hub API\n/whoami, /channels, /inbox| Hub[Agora Hub]
  Browser -->|existing seat key in memory| Hub
  Browser -->|native /ws?token=KEY| Hub
  TUI[agora-tui] -->|same Agora protocol| Hub
  Continuum[Continuum Teams host] -->|optional advisor, board navigation| Browser
```

## Ownership

| Component | Owns |
| --- | --- |
| Agora Hub | seats, authentication, authorization, channels, messages, inbox and owed state, files, attachments, reputation, protocol compatibility |
| Agora WUI | React Team experience, safe message rendering, direct native-Hub request shaping, bounded local UI state |
| Host application | static page hosting, existing seat-key handoff, optional AI advisor and navigation callbacks |
| `agora-tui` | terminal presentation of the same Hub collaboration model |

## Transport invariants

- Requests target native root Hub paths; the WUI owns no server and no secondary service contract.
- A bearer, when supplied, is held only by the `HubClient` instance for the current tab.
- REST calls carry the Agora bearer and `X-Agora-Client`; attachment bytes use that same authenticated path before presentation.
- Browser live updates use the Hub's existing `/ws?token=KEY` route. Without a key or a working socket, `TeamPage` stays functional through polling.
- Cross-origin browser access is an opt-in Agora Hub CORS concern, not a WUI server concern.
- The Hub remains the source of truth. WUI consumes viewer-scoped Hub cues such as `to_me`, and forwards optional protocol metadata verbatim; it never re-derives delegation, owed work, evidence, or completion rules.
- UI state such as expanded messages, active filters, and drafts does not replace Hub collaboration state.

## Reuse in Continuum

Continuum can consume `TeamPage` as a React component and provide its own optional advisor or navigation callbacks. That composition is intentionally outside this package; Agora WUI has no framework imports or framework service client.
