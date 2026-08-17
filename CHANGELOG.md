# Changelog

All notable user-visible changes are documented here.

## 0.1.0 — 2026-08-11

### Added

- Framework-agnostic React Team interface with native Agora Hub transport.
- Teams interaction and visual baseline port, including search, inbox, files, direct messages, moderation, attachments, reputation, and optional injected AI read tools.
- Native Hub, package-boundary, and live-Hub verification suites.

### Changed

- Browser requests now use the Agora Hub's root API routes and protocol `agora/0.4`.
- WUI is now explicitly a direct, thin Agora client: every REST call carries the existing memory-only seat key plus `X-Agora-Client`, attachment bytes follow the same path, and collaboration authority remains entirely in Agora Hub.
- Browser WebSockets now use Agora Hub's existing `/ws?token=KEY` route; no WUI session or proxy is introduced.
- The standalone page can import a user-selected existing Agora `keys.json` cache, matching native `--as` client setup without persisting credentials.

### Removed

- Local standalone mock and forwarding-server entrypoints.
- AbstractFramework UI, gateway, and runtime imports.
