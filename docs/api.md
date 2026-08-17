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
});
```

- `base_url` defaults to the current page origin.
- `bearer_token` is memory-only and becomes an `Authorization` request header.
- Every request also identifies this client with `X-Agora-Client: agora-wui/<version>`.
- `ws_url()` derives Agora Hub's documented `/ws?token=KEY` browser route from the memory-only seat key; it returns `null` when no key is present.

The client exposes Hub resources including `meta`, `healthz`, `channels`, `messages`, `post_message`, `inbox`, `ack`, `search`, `fs_list`, `fs_read`, `upload_attachment`, `send_dm`, and reputation/moderation methods. Their paths and authorization semantics are defined by the Hub, not duplicated by this package.

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
