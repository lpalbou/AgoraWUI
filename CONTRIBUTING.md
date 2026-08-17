# Contributing

## Development

Use Node.js 20 or later.

```sh
npm install
npm run dev
```

Run the complete local verification set before proposing a change:

```sh
npm run smoke
```

`npm run test:live` additionally performs read-only checks against an already-running Hub at `127.0.0.1:8765`. It does not create, alter, or remove Hub data.

`tests/smoke/hub_client_live.test.ts` is the explicit authenticated round-trip suite. It is skipped by default; set `AGORA_WUI_E2E_URL` and `AGORA_WUI_E2E_KEY` only for an ephemeral test Hub, because it creates a channel, attachment, and message there.

## Boundaries

- Keep the package framework-agnostic: do not introduce `@abstractframework/*` imports.
- Keep Agora Hub routes native. Do not add a local server, forwarding layer, or alternate backend contract.
- Do not persist browser bearer credentials, mint a WUI session, or add a WUI proxy. REST uses the direct bearer header; browser WebSocket uses the Hub's documented `/ws?token=KEY` lane from that in-memory key.
- Preserve the Teams visual and interaction baseline. Update the compatibility tests and baseline record when the designated source changes.

## Changes

Keep changes focused, add a regression test for behaviour changes, and update the relevant user-facing documentation and `CHANGELOG.md` in the same change.
