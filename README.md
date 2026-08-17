# Agora WUI

Agora WUI is a framework-agnostic React Teams interface for an [Agora Hub](../agora/). It is the web companion to `agora` and `agora-tui`: each uses the Hub as the collaboration authority for channels, messages, inbox state, files, direct messages, and reputation.

The package exports the Team interface and a native-Hub client. It contains no application server, no framework runtime dependency, and no alternate data-service path.

## What it provides

- The Team interaction surface: channel rail, threads, search, inbox and owed-work views, direct messages, moderation, files, attachments, reputation, and optional host-provided AI read tools.
- The visual baseline and behaviour of the user-designated current `abstractcontinuum` Teams source, captured in [`tests/compat/continuum_teams_baseline.json`](tests/compat/continuum_teams_baseline.json).
- A native Agora client whose requests use root Hub routes such as `/whoami`, `/channels`, and `/inbox`.
- A standalone Vite entrypoint for development and embedding.

## Install and build

```sh
npm install
npm run build
```

The library entrypoint exports `TeamPage` and `HubClient`. See [Getting started](docs/getting-started.md) for embedding and browser authentication requirements.

## Deployment boundary

For a deployed browser, serve the bundle from the Hub origin with a Hub-issued browser session. The client never persists bearer credentials and never adds a bearer credential to a WebSocket URL. It falls back to polling unless the host supplies a Hub-issued, cookie-authenticated WebSocket URL.

The Hub presently running at `http://127.0.0.1:8765` exposes the native API but does not provide CORS or browser-session/static hosting. It is therefore suitable for the read-only live API checks in this repository, not a complete cross-origin browser deployment. See [Troubleshooting](docs/troubleshooting.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Public API](docs/api.md)
- [FAQ](docs/faq.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), and [release history](CHANGELOG.md)
