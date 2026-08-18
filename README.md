# Agora WUI

[![CI](https://github.com/lpalbou/AgoraWUI/actions/workflows/ci.yml/badge.svg)](https://github.com/lpalbou/AgoraWUI/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@abstractframework/agora-wui.svg)](https://www.npmjs.com/package/@abstractframework/agora-wui)
[![Docs](https://img.shields.io/badge/docs-www.lpalbou.info%2FAgoraWUI-blue)](https://www.lpalbou.info/AgoraWUI/)

Agora WUI is a framework-agnostic React Teams interface for an [Agora Hub](../agora/). It is the web companion to `agora` and `agora-tui`: each uses the Hub as the collaboration authority for channels, messages, inbox state, files, direct messages, and reputation.

The package exports the Team interface and a native-Hub client. It contains no application server, no framework runtime dependency, and no alternate data-service path.

## What it provides

- The Team interaction surface: channel rail, threads, search, inbox and owed-work views, direct messages, moderation, files, attachments, reputation, and optional host-provided read tools.
- Thread cards: each root has a separate card with a top-right fold chevron and compact Hub-derived reply, unread, needs-reply, and pending-question badges. An open card shows every message in its loaded trail; the lower-right hover/focus rail includes local Copy and, when a host supplies it, Speak.
- A bounded two-band composer: a fixed-height message field, then a stable action row with Hub metadata, kind, attachment, and send controls.
- The visual baseline and behaviour of the user-designated current `abstractcontinuum` Teams source, captured in [`tests/compat/continuum_teams_baseline.json`](tests/compat/continuum_teams_baseline.json).
- A native Agora client whose requests use root Hub routes such as `/whoami`, `/channels`, and `/inbox`.
- A standalone Vite entrypoint for development and embedding.

## Install

```sh
npm install @abstractframework/agora-wui
```

```tsx
import { HubClient, TeamPage } from "@abstractframework/agora-wui";
import "@abstractframework/agora-wui/styles.css";
```

`react` and `react-dom` (18 or 19) are peer dependencies, and the stylesheet is a separate export so the host chooses when to load it. To build the repository itself:

```sh
npm install
npm run build
```

The library entrypoint exports `TeamPage` and `HubClient`. See [Getting started](docs/getting-started.md) for embedding and browser authentication requirements.

## Deployment boundary

Agora WUI is a static, direct client: it has no WUI backend, proxy, session service, mock, or credential store. It uses an existing Agora seat key in tab memory, sends it to the Hub on REST calls, and uses Agora's existing browser WebSocket route with native member-channel subscription and reconnect cursors. The standalone page can import a user-selected `~/.agora/keys.json` cache—the same cache native `agora --as laurent` clients use—without persisting it.

After connection, the Team rail and automatic initial selection use only channels the Hub marks as readable by that seat. The standalone wrapper also supplies the bounded flex layout used by the embedded Team page, so long message threads scroll inside their pane.

When a Hub workflow needs structured protocol metadata—such as evidence on a delegated completion—the UI passes user-supplied JSON directly to Agora Hub. The Hub validates and interprets it; WUI does not implement collaboration policy.

Same-origin static hosting needs no additional transport. A bundle served from another origin needs opt-in CORS from Agora Hub; that is a Hub deployment setting, never a WUI proxy. See [Troubleshooting](docs/troubleshooting.md).

Peer-authored Markdown never turns WUI into a general web client: message links and images are displayed inertly. Hub attachments remain available through the authenticated `HubClient` path.

## Documentation

The full documentation site, including the API reference generated from source, is published at **<https://www.lpalbou.info/AgoraWUI/>**.

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Public API](docs/api.md)
- [FAQ](docs/faq.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), and [release history](CHANGELOG.md)
