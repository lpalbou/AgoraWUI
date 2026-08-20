# Architecture

Agora WUI owns presentation and native browser client code. Agora Hub owns identity, authorization, collaboration state, and the protocol. This boundary keeps the WUI reusable in another product without importing AbstractFramework.

```mermaid
flowchart LR
  Browser[Browser: Agora WUI React] -->|native Hub API\n/whoami, /channels, /inbox| Hub[Agora Hub]
  Browser -->|existing seat key in memory| Hub
  Browser -->|live updates: native /ws?token=KEY| Hub
  Browser -.->|or a host-supplied ws_url| Relay[Host relay: holds the seat key]
  Relay -->|host-authenticated socket| Hub
  TUI[agora-tui] -->|same Agora protocol| Hub
  Host[Embedding host] -->|optional advisor, board navigation, speech| Browser
```

Every channel additionally owns an isolated virtual file system (vfs) the Team UI browses, edits, and deposits into over the same native routes:

```mermaid
flowchart LR
  Files[Files drawer] -->|GET /channels/c/fs| Hub[Agora Hub]
  Files -->|PUT versioned write| Hub
  Files -->|DELETE with expect_version| Hub
  Msg["@folder/file · @channel:folder/file"] -->|GET one file| Hub
  Hub --> Agents[Agents citing files by path]
```

## Ownership

| Component | Owns |
| --- | --- |
| Agora Hub | seats, authentication, authorization, channels, messages, inbox and owed state, the per-channel vfs and its versioning, standing missions, attachments, reputation, protocol compatibility |
| Agora WUI | React Team experience, safe message rendering, direct native-Hub request shaping, bounded local UI state |
| Host application | static page hosting, seat-key handoff (in tab memory, or held server-side behind its own relay), optional AI advisor, speech provider/voice policy, page theme when it supplies the design tokens, and navigation callbacks |
| `agora-tui` | terminal presentation of the same Hub collaboration model |

## Transport invariants

- Requests target native root Hub paths; the WUI owns no server and no secondary service contract.
- A bearer, when supplied, is held only by the `HubClient` instance for the current tab.
- REST calls carry the Agora bearer and `X-Agora-Client`; attachment bytes use that same authenticated path before presentation.
- Browser live updates use the Hub's existing `/ws?token=KEY` route, or a host-supplied `ws_url` used verbatim when a fronting relay terminates authentication itself. On open, reconnect, and member-list changes, WUI sends the native `subscribe` frame with only its in-tab received cursors; a sequence gap reconnects from the last contiguous cursor. Without a socket source or a working connection, `TeamPage` stays functional through polling.
- Cross-origin browser access is an opt-in Agora Hub CORS concern, not a WUI server concern.
- Peer-authored Markdown does not create browser links or image fetches. Hub attachment bytes are the sole message-media path and are fetched through the authenticated `HubClient` before rendering.
- The Hub remains the source of truth. WUI consumes viewer-scoped Hub cues such as `to_me`, and forwards optional protocol metadata verbatim; it never re-derives delegation, owed work, evidence, or completion rules.
- The per-channel vfs is Hub state: reads, versioned writes, and deletes go to native `/channels/{c}/fs` routes with the Hub's compare-and-swap contract, so a concurrent agent write surfaces as the Hub's conflict rather than a silent overwrite. WUI adds no local file store and no write policy of its own.
- A message you wrote is never presented as unread, and vfs references in a message body never mint seat obligations — a token matching a known seat id stays a mention, mirroring the Hub's seat-identity precedence.
- UI state such as folded thread cards, active filters, and drafts does not replace Hub collaboration state. Thread-card badges are window-scoped presentations of Hub-served unread, debt, and pending-ask state; WUI does not infer collaboration status locally. Filter tabs summarize attention; WUI does not create a second attention rail from Hub state.

## Reuse in Continuum

Continuum can consume `TeamPage` as a React component and provide its own optional advisor, speech, or navigation callbacks. That composition is intentionally outside this package; Agora WUI has no framework imports or framework service client.
