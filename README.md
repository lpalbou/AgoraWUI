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

Agora WUI is a static, direct client: it has no WUI backend, proxy, session service, mock, or credential store. It uses an existing Agora seat key in tab memory, sends it to the Hub on REST calls, and uses Agora's existing browser WebSocket route. The standalone page can import a user-selected `~/.agora/keys.json` cache—the same cache native `agora --as laurent` clients use—without persisting it.

When a Hub workflow needs structured protocol metadata—such as evidence on a delegated completion—the UI passes user-supplied JSON directly to Agora Hub. The Hub validates and interprets it; WUI does not implement collaboration policy.

Same-origin static hosting needs no additional transport. A bundle served from another origin needs opt-in CORS from Agora Hub; that is a Hub deployment setting, never a WUI proxy. See [Troubleshooting](docs/troubleshooting.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Public API](docs/api.md)
- [FAQ](docs/faq.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), and [release history](CHANGELOG.md)
