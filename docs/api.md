# Public API

The public entrypoint is [`src/index.ts`](../src/index.ts).

## `TeamPage`

`TeamPage` renders the Teams collaboration interface.

| Prop | Purpose |
| --- | --- |
| `hub?: HubClient` | Native Hub client. A default same-origin client is created when omitted. |
| `advisor?: TeamAdvisorFn` | Optional host-owned, read-only AI function for summaries and `/assistant`. |
| `on_open_board?: (workId?: string) => void` | Optional host navigation for work-id chips. |
| `focus` / `on_focus_consumed` | Optional host-driven channel or message focus. |

## `HubClient`

`HubClient` is the framework-independent browser transport.

```ts
new HubClient({
  base_url?: string,
  bearer_token?: string,
  websocket_url?: string,
});
```

- `base_url` defaults to the current page origin.
- `bearer_token` is memory-only and becomes an `Authorization` request header.
- `websocket_url` must be issued by a Hub session host; `ws_url()` returns `null` when it is absent.

The client exposes Hub resources including `meta`, `healthz`, `channels`, `messages`, `post_message`, `inbox`, `ack`, `search`, `fs_list`, `fs_read`, `upload_attachment`, `send_dm`, and reputation/moderation methods. Their paths and authorization semantics are defined by the Hub, not duplicated by this package.

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
