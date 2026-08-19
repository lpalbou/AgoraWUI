# Public API

The public entrypoint is [`src/index.ts`](../src/index.ts).

## `TeamPage`

`TeamPage` renders the Teams collaboration interface.

| Prop | Purpose |
| --- | --- |
| `hub?: HubClient` | Native Hub client. A default same-origin client is created when omitted. |
| `advisor?: TeamAdvisorFn` | Optional host-owned, read-only AI function for summaries and `/assistant`. |
| `on_speak_message?: TeamSpeakFn` | Optional host-owned speech callback. It receives a neutral message payload and `AbortSignal`; the host owns provider and voice policy. |
| `on_open_board?: (workId?: string) => void` | Optional host navigation for work-id chips. |
| `focus` / `on_focus_consumed` | Optional host-driven channel or message focus. |

## `HubClient`

`HubClient` is the framework-independent browser transport.

```ts
new HubClient({
  base_url?: string,
  bearer_token?: string,
  ws_url?: string,
});
```

- `base_url` defaults to the current page origin. A relative base (a host's own proxy prefix) is valid and resolves against the page origin.
- `bearer_token` is memory-only and becomes an `Authorization` request header.
- `ws_url` is for hosts that terminate authentication on their own relay: the value is used verbatim for the live socket (WUI appends nothing), so a token-in-URL route is never required. Without it, `ws_url()` derives Agora Hub's documented `/ws?token=KEY` browser route from the memory-only seat key and returns `null` when no key is present.
- Every request also identifies this client with `X-Agora-Client: agora-wui/<version>`.
- `meta().seat_key_present` is evidence-derived: true when the Hub served an identity for the request path (a direct bearer or a key-holding host proxy alike), false when authentication failed — the UI shows its missing-key guidance on that signal.

The client exposes Hub resources including `meta`, `healthz`, `channels`, `messages`, `post_message`, `inbox`, `ack`, `search`, `fs_list`, `fs_read`, `fs_put`, `upload_attachment`, `send_dm`, `missions`, `set_mission`, and reputation/moderation methods. Their paths and authorization semantics are defined by the Hub, not duplicated by this package.

`fs_put(channel, path, { content | content_b64, expect_version, mime, description })` is the Hub's versioned write: exactly one of `content` (text) or `content_b64` (base64 bytes, on hubs with binary-fs support) is sent; `expect_version` must match the stored version (`0` = create-only; omitted = unconditional), and a mismatch surfaces as the Hub's own 409. The Files drawer uses it for in-place editing, the new-file flow, and drop-to-deposit (files and folders; folder structure becomes path prefixes); the Hub alone decides who may write (for example, the `channel/` prefix is owner+operator).

Each channel owns an isolated **virtual file system (vfs)** — documents and images both people and agents can cite by path. Message bodies may reference vfs files explicitly: `@folder/file.md` resolves against the message's own channel (a message always knows its channel, so there is nothing to disambiguate), and `@channel:folder/file.md` reaches another channel's vfs, subject to the reader's own Hub read access. Both render as chips that open the shared file viewer. Collisions with `@seat` mentions resolve by seat-identity precedence: a token that exactly matches a known seat id is a mention, never a file reference — so `@laurent: review this` stays an obligation, and a channel whose name collides with a seat id cannot be @-referenced cross-channel.

`fs_delete(channel, path, expect_version?)` is the Hub's CAS delete: the Hub tombstones the entry (versions stay monotonic across delete+recreate) and posts a channel audit notice. The Files drawer's per-row trash action uses it behind an in-app confirmation that names the blast radius — agents may already cite the path.

`missions()` / `set_mission(agent_id, mission)` read and write hub-wide standing missions on the Hub's admin routes. The Members drawer shows each seat's mission under its roster row and offers an inline editor; authorization is the Hub's (operator seats), and refusals render verbatim.

`post_message(..., { data })` accepts an opaque JSON object and forwards it unchanged. This covers additive Hub protocol fields such as `evidence` and `consumes`; Agora Hub validates their shape and decides their effect. In the UI, **Hub data** and the completion-metadata field expose this direct relay without creating a WUI-side workflow.

`on_speak_message` is deliberately not backed by WUI or Agora Hub. When present, WUI exposes **Speak** on message hover/focus and passes `{ id, channel, seq, sender, title, body }` plus an `AbortSignal`. A standalone page with no host callback does not show Speak. This keeps default and per-agent voice selection outside the collaboration protocol.

## Native route examples

| Operation | Hub route |
| --- | --- |
| Identity | `GET /whoami` |
| Service health | `GET /healthz` |
| Channel list | `GET /channels` |
| Channel messages | `GET` / `POST /channels/{channel}/messages` |
| Inbox acknowledgement | `POST /inbox/ack` |
| Hub-wide search | `GET /search` |

Use URL-encoded channel and resource identifiers. Error responses are surfaced as JavaScript errors with an attached HTTP `status` when the Hub supplies one.

## Stylesheets

Three CSS entry points ship with the package:

| Export | Contents | Use when |
| --- | --- | --- |
| `@abstractframework/agora-wui/styles.css` | Theme layer + component rules | Standalone pages and hosts that want the full Agora WUI look |
| `@abstractframework/agora-wui/team.css` | Class-scoped component rules only | Embedding hosts that own their page theme |
| `@abstractframework/agora-wui/theme.css` | Design tokens, reset, and bare element rules | Rarely alone; it is what `styles.css` adds on top of `team.css` |

`team.css` contains no bare element selectors, so importing it never restyles a host page outside the component tree. It reads its colors and typography from design-token custom properties — `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--ui-surface-*`, `--ui-border-1`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-subtle`, and the `--font-*` scale. A host that defines those names in its own theme restyles the Team surface without loading the theme layer.
