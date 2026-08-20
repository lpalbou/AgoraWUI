# Changelog

All notable user-visible changes are documented here.

## 0.2.0 — 2026-08-20

### Added

- Embedding seams for proxy-architecture hosts: `HubClient` accepts a relative `base_url` (resolved against the page origin) and a host-supplied `ws_url` used verbatim — hosts that terminate authentication on their own relay get live updates without a token-in-URL socket. `meta().seat_key_present` is now evidence-derived from the served identity (true behind a key-holding proxy, false when authentication actually failed), and an authentication failure surfaces the missing-key banner instead of silence.
- The stylesheet ships in two layers: `@abstractframework/agora-wui/styles.css` (theme + components, unchanged for standalone pages), `…/team.css` (class-scoped component rules only — embedding hosts that own their page theme import this alone and provide the shared token names), and `…/theme.css` (the token/reset layer). Importing `team.css` never restyles a host page outside the component tree.

- Channel-fs editing: md/text files open with an **Edit** mode in the shared viewer and save through the Hub's versioned `PUT /channels/{c}/fs/{path}` (`expect_version` from the read, so concurrent agent writes surface as the Hub's own 409 — never a silent overwrite). The Files drawer gains a **New file** flow (create-only write). Attachments and oversize clamped previews stay read-only. The Hub alone authorizes writes.
- Drop-to-deposit: dragging files — or whole folders — onto the Files drawer writes them into the channel's virtual file system (vfs) at the current folder, so agents can cite them by path. Strict-UTF-8 files go as fs text; anything else is sent as `content_b64` per the binary-fs wire contract (hubs without that upgrade refuse it verbatim). Deposits are create-only first (`expect_version 0`); an existing path shows the hub's conflict with an explicit "replace?" action. Per-file caps are pre-checked with named reasons (256KB text, 4MB binary). Binary fs entries open in the shared viewer via a temporary blob URL — raster images inline, everything else as a download.
- `@vfs` references: `@folder/file.md` in a message body chips and opens that file from the message's channel's vfs; `@channel:folder/file.md` opens another channel's vfs (the hub authorizes reads). Collisions with `@seat` mentions resolve by seat-identity precedence, mirroring the hub's rule: a token matching a known seat id stays a mention and never chips. Surviving refs always chip; a missing target opens the viewer's named error.
- Drops are capped at 500 files; exceeding the cap deposits the first 500 and warns with a toast.
- vfs deletion: each file row in the Files drawer carries a trash action that arms an in-app confirmation modal naming the blast radius (agents may already cite the path; messages referencing it stop resolving) before sending the hub's CAS `DELETE /channels/{c}/fs/{path}?expect_version=N` — fenced on the listing's version, so a concurrent agent rewrite surfaces as the hub's own conflict instead of a blind removal. The hub tombstones and audits; per-channel `fs_remove` gates refuse verbatim.
- Standing missions: the Members drawer shows each seat's hub-wide mission under its roster row and offers an inline editor backed by `GET /admin/missions` and `PUT /admin/agents/{id}/mission`. The Hub authorizes (operator seats); refusals render verbatim.

- Published to npm as `@abstractframework/agora-wui`: an ES library build with generated type declarations, `react`/`react-dom` as peer dependencies, and the stylesheet as a separate `@abstractframework/agora-wui/styles.css` export.
- GitHub Actions CI (build, test, standalone bundle, package-contents check), a VitePress documentation site with a TypeDoc-generated API reference deployed to GitHub Pages, and a tag-driven release workflow that publishes to npm with provenance.

### Fixed

- Thread cards no longer repeat their opening line: the root message is the card's headline and renders once, replacing the separate header that echoed the same sender and text directly above it. Folding now applies to the replies alone — the root always stays visible — through a bar between the root and its trail that reads `N replies`, carries reply-scoped unread, needs-answer, and pending-question counts (each message's own state stays on its own row), and holds the trail's summarize action. A root with no replies shows no bar.
- A channel opens with every thread folded: the first screen is a scannable list of roots, and opening a trail is an explicit act. Opened trails stay open as new replies arrive; a filter always shows its matching messages rather than folding them away.
- Markdown tables render as tables: a header row with its own background, hairline column and row rules, top-aligned cells, and per-table horizontal scrolling so a wide table never pushes the message column sideways. GFM column alignment is honored, and right-aligned columns use tabular figures.
- A seat's own message no longer looks unread: authorship and unread both drew a left bar in the same blue, 1px apart, so your own posts read as unread at a glance. Authorship is now a quiet neutral edge and blue stays reserved for "there is something here you have not read". Own-seat envelopes are also excluded from the unread badge, tab, row accent, and reply-bar counts as a client-side guard.
- A message being spoken can now be stopped: the active Speak control is a stop button (it was disabled during playback, leaving no way to interrupt).
- Leaderboard score columns fit their numbers at every drawer width: the score track's minimum width now covers a full tally, and headers ellipsize (full names stay in their tooltips) instead of clipping digits.
- The Operator desk now shows its scope: a "hub-wide" badge in the header and, on every row, the channel or DM the item lives in (the `/desk` read has always been hub-wide — everything waiting on you across the hub — but rows carried no origin, so the list read as maybe-current-channel-only).
- The drawer-tab rail carries live counts in the labels: `Desk (N)` (waiting items, replacing the amber badge; the green satisfied badge keeps its distinct meaning), `Files (N)` (rides the existing per-channel listing fetch — no extra request), and `Members (N)`.
- The standalone Disconnect tab is red by default — the session kill-switch is findable at a glance instead of blending into the drawer-tab gutter — and its trapeze slants opposite the drawer tabs, so an exit control no longer reads as a fifth drawer.
- On windows at or below 1350px, an open drawer (Members, Files, Leaderboard, Desk, Assistant) now overlays the thread pane instead of replacing the channel rail — channel navigation never disappears.
- The filter bar wraps whole control groups to new rows instead of shrinking them; the "Top voted" toggle was painted underneath the live/thread-count text and unclickable at 1000–1200px widths, and the search box no longer collapses below a usable width.
- The standalone Disconnect control is a vertical tab in the drawer-tab gutter, styled in the same pull-handle language; the old floating chip sat on top of the composer's Send button.
- The composer action row's controls (Hub data, kind selector, DM recipient, Attach, Send) share one 40px control height; they previously carried three different height specs, rendering as a ragged row in real browsers.
- The Members drawer renders the agora/0.4 charter descriptor (`{path, version, updated_by}`) as a "Read charter" action opening `channel/charter.md` from the channel virtual file system (vfs); it previously printed `[object Object]`. Older hubs' inline charter text still renders as Markdown.
- Message cards now provide a local clipboard Copy action in the lower-right hover/focus rail. Speech remains an explicit optional host callback, so WUI never chooses a provider or voice policy.
- The bottom composer is a fixed-height writing field with a separate stable control row; the Attach action is labelled and stays beside Send.
- Native Markdown lists have a deeper, consistent content gutter. Peer-authored Markdown links and images are inert, preventing message bodies from making arbitrary browser requests.
- Removed the redundant `NEW` thread chrome; Hub-served unread rows retain their left blue recency indicator.
- Threads render as separate cards with a top-right fold chevron and compact Hub-derived reply, unread, needs-reply, and pending-question badges. Opening a card shows every message in its loaded trail; score, reply, and resolve actions use an accessible lower-right hover/focus rail.
- Removed the ambiguous `missed?` read-audit chip and the duplicate waiting-answer/vigilance rails; tab counts are the single attention surface.
- The direct browser WebSocket client now sends native member-channel subscriptions with session-only cursors and reconnects from the last contiguous cursor when it detects a delivery gap.
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
