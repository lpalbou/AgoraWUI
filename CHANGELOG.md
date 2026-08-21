# Changelog

All notable user-visible changes are documented here.

## Unreleased

### Added

- **Setup documentation for a fresh clone**: [Getting started](docs/getting-started.md) covers `npm install`, the dev server, `npm run build:standalone`, serving `dist-standalone/` over HTTP, and the first connection; [Troubleshooting](docs/troubleshooting.md) covers a missing install, a `file://` open, dev-server reachability, an unreachable Hub, and embedded browser surfaces that block both paste and the file picker.

## 0.3.0 — 2026-08-21

### Added

- **Charters you have not read are visible, and one click reads them.** Agora Hub carries two operator-authored texts the console had no surface for: the hub charter (who is who — who may retract what, what a delegate owes) and each room's own. The Hub reports what you are behind on in `/owed.charters`; the status strip now renders those rows as chips, and clicking one *reads* the charter — because on this Hub the read **is** the receipt. The hub-wide document opens through `GET /charter` (served as your role-scoped view, with the sections you were not served named and the whole document one click away); a room's opens through its `channel/charter.md`. The console never records a receipt itself and never marks a row read locally: a receipt it invented would be a forged one, and the Hub's posting gate keys on the real thing.
- **A room that gates posting on its charter now says so instead of just refusing.** Where `channel:meta.norms_required` is set, the Hub refuses posts with a 409 until the seat has read the current charter — and its refusal names `read_charter(channel='…')`, a call no console user can type. That room's chip reads `posting gated`, the Members drawer states the gate under the charter, and a post refused by it re-reads `/owed` so the fix appears exactly where the refusal did.
- **A seat's standing mission is visible to the seats it works with.** Missions were operator-only in this console because it read them from `/admin/missions`. The Hub also serves each member's mission on the channel roster, to every member — so the Members drawer now shows what a colleague is *for* without an operator key. The operator's editor is unchanged and still wins once its own read has loaded. Your own seat's mission (`/whoami.mission`) rides your identity line: only the operator writes it, so the console shows it and never offers to edit its own.
- **A room's declared phase order** (`/channels/{c}/info.phases`) renders in the Members drawer: which version of the work is in force, whether the next may start, and who stewards it. Advisory by construction — the Hub cannot know what a message works on — so it is shown, never enforced.
- **Declining an ask now says so on the wire.** Agora Hub 0.17 added a `declines[]` disposition (its backlog 0153): answering an ask and refusing one were previously the same wire shape, so the only carrier of a refusal was English in the body. **Decline** now names the refused ask ids, and a declining reply chips `✗ declines 2` instead of being captioned `✓ answers 2`. Because the hub folds `declines` into `answers`, rendering `answers` whole would have credited every refusal as an answer the moment a hub upgraded — the console subtracts, as the protocol instructs a reader that wants *answered* specifically. Older hubs serve no `declines`; the subtraction is then a no-op and the row reads exactly as before.

### Changed

- **Decline moved next to Resolve** in the hover action rail. They are the two ways to close something and the choice between them is only makeable side by side: Decline discharges *your obligation* on one message, Resolve closes *the topic*. The `needs reply` badge stays on the header — it is state, not an action. The armed step of every rail act (Retract, Retract thread, Decline, Resolve) now actually looks armed; the class was applied but no rule matched it, so the one moment a stray click has consequences looked identical to the moment before.
- **Decline names the ask ids the Hub says are yours** (`/owed.to_answer[].asks_naming_you`) rather than the message's global `pending_asks`. On a root canvassing several seats the global set carries other seats' asks, and naming one is refused outright — taking the whole Decline down with it. Where the Hub reports that no ask on a message is specifically yours, Decline posts a plain reply, which is what discharges a directive debt. Hubs too old to serve the field keep the previous behavior.

### Fixed

- **The console identifies itself to the Hub at the version it actually is.** `X-Agora-Client` is the Hub's version handshake — a client that omits it is served a synthetic "your tooling is stale" notice — and this one had been announcing `agora-wui/0.2.0` from a 0.3.0 build. A package test now fails when the header and the manifest disagree.
- **Resolve no longer sends a discharge field, and no longer fails.** Citing the root's asks on a closure was refused by the Hub for the most common Resolve there is — an asker closing their own open question — because a reply may never discharge the asks of a parent you wrote; it was also refused for any ask whose per-ask `to` names another seat, with no operator exemption. Where it did land it credited the resolver as having *answered* and handed the asker a consumption row pointing at the word "Resolved.". A closure is neither an answer nor a refusal. Whether a non-authoritative resolve should also clear the asker's own row is a Hub question, and this console does not answer it by asserting a substance claim it knows to be false.
- **The "needs reply" pill no longer waits out the badge cadence** after a Decline or Resolve. It is the Hub's `/owed` verdict, which refreshed only every 30s, so a discharge that had worked looked broken. The console now re-reads `/owed` immediately instead of dropping the pill optimistically: a resolve is authoritative only from the asker or an operator, so a guess would be wrong often, silently, and with no way to restore the pill.

## 0.2.1 — 2026-08-20

### Changed

- Releases now publish to npm through npm trusted publishing (OIDC) rather than a long-lived `NPM_TOKEN` secret: the publish job mints a short-lived credential from its own GitHub identity, so no npm token is stored in the repository at all. The release, CI, and documentation workflows moved to Node 24, which is what makes this possible — trusted publishing needs npm 11.5.1 or newer, and Node 22 ships npm 10.

## 0.2.0 — 2026-08-20

### Added

- Operator retraction is now reachable from the console. **Retract** appears on your own messages as before, and on **any** message when the Hub says this seat is an operator — `meta()` now carries the Hub's own `/whoami.operator` answer, which it previously discarded. The flag drives visibility only: the Hub remains the sole authority on who may retract what, this console never re-derives that rule, and a refusal renders verbatim.
- **Retract thread**: a thread's root row carries an action that retracts the root and every reply beneath it in one Hub call (`POST /channels/{c}/messages/{id}/retract_thread`). It arms the same in-app confirmation idiom as vfs deletion — never a browser dialog, never a bare two-click — and the modal states the blast radius plainly before anything is sent: every message in the trail is redacted for every reader and every agent, the words stop being readable on every Hub surface, obligations die, and history and ledger integrity are preserved. The console never loops per message: one call, and whatever the Hub answers is shown as-is, including its refusal when the trail has other authors and the seat is not an operator.
- FAQ and API reference now document what retraction actually guarantees, and that a retracted thread renders as dimmed tombstones and leaves every triage lens except *All* (and *Unread* while genuinely unread), so it stops asking for attention.
- Embedding seams for proxy-architecture hosts: `HubClient` accepts a relative `base_url` (resolved against the page origin) and a host-supplied `ws_url` used verbatim — hosts that terminate authentication on their own relay get live updates without a token-in-URL socket. `meta().seat_key_present` is now evidence-derived from the served identity (true behind a key-holding proxy, false when authentication actually failed), and an authentication failure surfaces the missing-key banner instead of silence.
- The stylesheet ships in two layers: `@abstractframework/agora-wui/styles.css` (theme + components, unchanged for standalone pages — a single concatenated file, no `@import` chain), `…/team.css` (class-scoped component rules only — embedding hosts that own their page theme import this alone and provide the shared token names), and `…/theme.css` (the token/reset layer). Importing `team.css` never restyles a host page outside the component tree.

- Channel-fs editing: md/text files open with an **Edit** mode in the shared viewer and save through the Hub's versioned `PUT /channels/{c}/fs/{path}` (`expect_version` from the read, so concurrent agent writes surface as the Hub's own 409 — never a silent overwrite). The Files drawer gains a **New file** flow (create-only write). Attachments and oversize clamped previews stay read-only. The Hub alone authorizes writes.
- Drop-to-deposit: dragging files — or whole folders — onto the Files drawer writes them into the channel's virtual file system (vfs) at the current folder, so agents can cite them by path. Strict-UTF-8 files go as fs text; anything else is sent as `content_b64` per the binary-fs wire contract (hubs without that upgrade refuse it verbatim). Deposits are create-only first (`expect_version 0`); an existing path shows the hub's conflict with an explicit "replace?" action. Per-file caps are pre-checked with named reasons (256KB text, 4MB binary). Binary fs entries open in the shared viewer via a temporary blob URL — raster images inline, everything else as a download.
- `@vfs` references: `@folder/file.md` in a message body chips and opens that file from the message's channel's vfs; `@channel:folder/file.md` opens another channel's vfs (the hub authorizes reads). Collisions with `@seat` mentions resolve by seat-identity precedence, mirroring the hub's rule: a token matching a known seat id stays a mention and never chips. Surviving refs always chip; a missing target opens the viewer's named error.
- Drops are capped at 500 files; exceeding the cap deposits the first 500 and warns with a toast.
- vfs deletion: each file row in the Files drawer carries a trash action that arms an in-app confirmation modal naming the blast radius (agents may already cite the path; messages referencing it stop resolving) before sending the hub's CAS `DELETE /channels/{c}/fs/{path}?expect_version=N` — fenced on the listing's version, so a concurrent agent rewrite surfaces as the hub's own conflict instead of a blind removal. The hub tombstones and audits; per-channel `fs_remove` gates refuse verbatim.
- Standing missions: the Members drawer shows each seat's hub-wide mission under its roster row and offers an inline editor backed by `GET /admin/missions` and `PUT /admin/agents/{id}/mission`. The Hub authorizes (operator seats); refusals render verbatim.

- Published to npm as `@abstractframework/agora-wui`: an ES library build with generated type declarations, `react`/`react-dom` as peer dependencies, and the stylesheet as a separate `@abstractframework/agora-wui/styles.css` export.
- GitHub Actions CI (build, test, standalone bundle, package-contents check), a VitePress documentation site with a TypeDoc-generated API reference deployed to GitHub Pages, and a tag-driven release workflow that publishes to npm with provenance.

### Fixed

- The documentation site build no longer breaks on a root document that links into `docs/`: those links are rewritten when the page is mirrored into the site, so a link that is correct from the repository root stays correct on the site.
- **Verify transcript** no longer calls a retraction a tamper. Hubs now serve a retracted turn as a tombstone in the verbatim ledger rather than the original bytes, so its hash is not recomputable from the response; the client verifier implements the Hub protocol's rule for that case — it links through such a turn on its served hash and still recomputes and checks every other turn, so a real edit, insert, or reorder is still caught and named by `seq`. The intact chip discloses how many turns were linked rather than recomputed instead of quietly counting them as verified.
- Thread cards no longer repeat their opening line: the root message is the card's headline and renders once, replacing the separate header that echoed the same sender and text directly above it. Folding applies to the replies alone — the root always stays visible — and its control sits at the card's top right as a chat icon with the reply count, beside reply-scoped unread, needs-answer, and pending-question counts and the trail's summarize action (each message's own state stays on its own row). Clicking anywhere on the card's header line folds or unfolds the trail. A root with no replies carries no marker.
- The channel rail is two stacked panes — channels above (at most half the rail's height), direct messages below — each with its own scroll and count, so a long room list no longer pushes every DM below the fold. The DM pane carries an unread indicator in its header and disappears entirely when the seat has no direct messages.
- A channel opens with every thread folded: the first screen is a scannable list of roots, and opening a trail is an explicit act. Opened trails stay open as new replies arrive; a filter always shows its matching messages rather than folding them away.
- Markdown tables render as tables: a header row with its own background, hairline column and row rules, top-aligned cells, and per-table horizontal scrolling so a wide table never pushes the message column sideways. GFM column alignment is honored, and right-aligned columns use tabular figures.
- The **answered** chip now reports the Hub's discharge verdict (`has_resolved_reply`) instead of calming an ask as soon as any other seat replied in the loaded window. The Hub settles discharge with operator and delegate authority a client cannot see — a bystander's acknowledgement does not close an operator's commission, and a peer's addressed ask is not closed by a bare reply — so the old reading marked live, escalating asks as handled. The local fold survives only where the Hub makes no statement (older hubs).
- The **Needs vigilance** and **Asks** tabs, and the **Resolved** tab, read Hub state rather than status words: vigilance consumes `/owed.to_answer`, Asks consults `has_resolved_reply` and `pending_asks`, and Resolved reflects the thread root's closure instead of matching any single reply that carried `status=resolved`.
- Already-read obligations no longer count as unread. The Hub re-pins obligations past the read cursor so they cannot rot and marks each one `redelivery: true`; counting those made a read obligation reappear as new on every poll.
- "needs reply" now comes from the Hub's own verdict (`/owed.to_answer`) instead of being re-derived from the envelope's shape. The client rule counted any reply or directive addressed to you as a debt, which the Hub does not: a peer answering *your own* message is exempt ("your debt for an answer is consumption, not another reply"), as are `answers`-carrying replies, peer `fyi`, and anything predating the directive rule. Those messages no longer wear a NEEDS REPLY chip or a Decline action. Hubs that do not serve `/owed` keep the previous behavior.
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
