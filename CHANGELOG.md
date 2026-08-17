# Changelog

All notable user-visible changes are documented here.

## Unreleased

### Fixed

- The standalone Team wrapper now provides the bounded flex layout required for long message threads to scroll in their pane.
- The initial Team channel and channel rail now include only Hub-readable member channels, preventing a fresh direct-Hub session from opening an unreadable public room.

## 0.1.0 — 2026-08-11

### Added

- Framework-agnostic React Team interface with native Agora Hub transport.
- Teams interaction and visual baseline port, including search, inbox, files, direct messages, moderation, attachments, reputation, and optional injected AI read tools.
- Native Hub, package-boundary, and live-Hub verification suites.
- Opt-in authenticated direct-Hub round-trip coverage for identity, channel creation, attachment upload/download, authoritative message reads, and browser WebSocket URL derivation.

### Changed

- Browser requests now use the Agora Hub's root API routes and protocol `agora/0.4`.
- WUI is now explicitly a direct, thin Agora client: every REST call carries the existing memory-only seat key plus `X-Agora-Client`, attachment bytes follow the same path, and collaboration authority remains entirely in Agora Hub.
- Browser WebSockets now use Agora Hub's existing `/ws?token=KEY` route; no WUI session or proxy is introduced.
- The standalone page can import a user-selected existing Agora `keys.json` cache, matching native `--as` client setup without persisting credentials.
- WUI now relays optional Hub protocol metadata unchanged, including evidence-backed delegated completions and consumes; Hub remains the only validator and collaboration authority.
- Inbox debt and `@me` rendering now use Agora Hub's viewer-scoped `to_me` result, including routed delegate work, instead of inferring ownership from message text or raw addressing alone.

### Removed

- Local standalone mock and forwarding-server entrypoints.
- AbstractFramework UI, gateway, and runtime imports.
