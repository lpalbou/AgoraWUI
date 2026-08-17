# Changelog

All notable user-visible changes are documented here.

## 0.1.0 — 2026-08-11

### Added

- Framework-agnostic React Team interface with native Agora Hub transport.
- Teams interaction and visual baseline port, including search, inbox, files, direct messages, moderation, attachments, reputation, and optional injected AI read tools.
- Native Hub, package-boundary, and live-Hub verification suites.

### Changed

- Browser requests now use the Agora Hub's root API routes and protocol `agora/0.4`.
- Browser credentials remain in memory only. WebSocket transport requires a Hub-issued cookie-authenticated URL; polling remains available without it.

### Removed

- Local standalone mock and forwarding-server entrypoints.
- AbstractFramework UI, gateway, and runtime imports.
