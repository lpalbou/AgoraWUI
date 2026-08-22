# Contributing

## Development

Use Node.js 20 or later. A fresh clone installs first — the toolchain, including Vite, is a development dependency:

```sh
npm install
npm run dev                  # standalone page on http://localhost:5173
```

`npm run build:standalone` writes the same page as static files in `dist-standalone/`, and `npm run build` produces the published library in `dist/`. [Getting started](docs/getting-started.md#run-the-standalone-page-from-a-fresh-clone) documents both for users.

`npm run dev -- --seat agora_… --hub <url>` opens a session on load instead of re-entering a key on every reload. Both scripts run through `scripts/standalone.mjs`, which drives Vite's JS API because Vite's own CLI exits on options it does not define; the flags themselves are read in `vite.config.app.ts`. `--seat` takes a key and never a seat name: resolving a name would have the build read `~/.agora/keys.json` and authenticate as a seat nobody named a secret for, which is the ambient credential a flag exists to replace. A `--seat` build inlines that key into the artifact, so it warns. `tests/compat/preset_seat_key.test.ts` pins both properties and should keep failing loudly if a key can reach a page from anywhere but its own command line.

Run the complete local verification set before proposing a change:

```sh
npm run smoke
```

`npm run test:live` additionally performs read-only checks against an already-running Hub at `127.0.0.1:8765`. It does not create, alter, or remove Hub data.

`tests/smoke/hub_client_live.test.ts` is the explicit authenticated round-trip suite. It is skipped by default; set `AGORA_WUI_E2E_URL` and `AGORA_WUI_E2E_KEY` only for an ephemeral test Hub, because it creates a channel, attachment, and message there.

## Boundaries

- Keep the package framework-agnostic: do not introduce `@abstractframework/*` imports.
- Keep Agora Hub routes native. Do not add a local server, forwarding layer, or alternate backend contract to the package. The dev server's `--hub` proxy is the one forwarding in the repository, and it exists only inside `vite.config.app.ts` under `command === "serve"`: no build emits it, and the page it serves reaches the Hub through the same relative-`base_url` path an embedding host's relay uses.
- Do not persist browser bearer credentials, mint a WUI session, or add a WUI proxy. REST uses the direct bearer header; browser WebSocket uses the Hub's documented `/ws?token=KEY` lane from that in-memory key.
- Preserve the Teams visual and interaction baseline. Update the compatibility tests and baseline record when the designated source changes.
- Let the Hub decide collaboration state. Before computing anything from a message or envelope field — owed work, discharge, attention, authorization — check whether a Hub route already answers it (`/owed`, `/inbox`, `/channels/{c}/messages` row decorations, `/channels/{c}/digest`, `/whoami`). If one does, consume it; rendering a served verdict is presentation, deriving it again is a second source of truth, and an `||` between the two is a local guess. If none does, name the field the Hub would need to serve and keep the fallback's failure mode visible. See [Hub-decided state](docs/architecture.md#hub-decided-state).

## Changes

Keep changes focused, add a regression test for behaviour changes, and update the relevant user-facing documentation and `CHANGELOG.md` in the same change.

## Documentation site

The site at <https://www.lpalbou.info/AgoraWUI/> is built by VitePress from `docs/`. Three parts of it are generated and are not committed:

- `docs/reference/` — TypeDoc output for the public entrypoint (`npm run docs:api`).
- `docs/changelog.md`, `docs/contributing.md`, `docs/security.md` — mirrors of the root documents (`npm run docs:sync`).

```sh
npm run docs:dev     # local site with both generators
npm run docs:build   # what CI publishes
```

`.github/workflows/docs.yml` rebuilds and deploys the site on every push to `main`.

## Releasing

1. Update `version` in `package.json` and add the matching `## <version> — <date>` section to `CHANGELOG.md`.
2. Merge to `main` and push the tag `v<version>` (or run the `Release` workflow with the version as input, which creates the tag).

`.github/workflows/release.yml` then verifies that the tag, `package.json` version, and changelog entry agree, builds and tests, publishes `@abstractframework/agora-wui` to npm with provenance, and creates the GitHub Release. Publishing is idempotent: an already-published version is skipped rather than failing.
