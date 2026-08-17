// Pure model for the Team page (operator redesign 2026-07-14): thread
// grouping, category filters, channel badges, and the bounded transcript
// serialization the LLM features feed on. No fetching here — the page
// owns transport, this file owns the logic (testable without a DOM).

import type { HubMessage } from "./hub_client";

// ------------------------------------------------------------- threading

export type Thread = {
  /** Root message (or a reply whose parent left the window — labeled). */
  root: HubMessage;
  /** Replies in seq order (excludes the root). */
  replies: HubMessage[];
  /** True when root.reply_to points outside the fetched window. */
  orphan: boolean;
  /** Highest seq in the group (used for "new activity" ordering). */
  last_seq: number;
};

/** Bounded reply-chain walk depth — above the page window so a fully
 *  in-window chain can never split (adversary find: 100 < PAGE_LIMIT). */
const MAX_CHAIN_HOPS = 400;

/**
 * Group a channel window into threads: every message chains up its
 * reply_to links to the oldest ancestor IN THE WINDOW; that ancestor is
 * the thread root. Replies whose parent fell out of the window become
 * their own root, labeled `orphan` (never silently merged into the wrong
 * trail). Threads order by LAST ACTIVITY (`last_seq`, ascending) so a
 * fresh reply to an old root moves the whole trail toward the bottom —
 * where the operator's scroll anchor is (adversary consensus: root-seq
 * ordering made new activity in old threads invisible).
 */
export function group_threads(messages: HubMessage[]): Thread[] {
  const by_id = new Map<string, HubMessage>();
  for (const m of messages) by_id.set(m.id, m);

  // Resolve each message to its in-window root (bounded walk, cycle-safe).
  const root_of = (m: HubMessage): { root: HubMessage; orphan: boolean } => {
    let cur = m;
    let orphan = false;
    const seen = new Set<string>([cur.id]);
    for (let i = 0; i < MAX_CHAIN_HOPS; i++) {
      const parent_id = String(cur.reply_to || "");
      if (!parent_id) break;
      const parent = by_id.get(parent_id);
      if (!parent) {
        orphan = cur.id === m.id || orphan;
        break;
      }
      if (seen.has(parent.id)) break; // defensive: cycle in the wire data
      seen.add(parent.id);
      cur = parent;
    }
    return { root: cur, orphan: orphan && cur.id === m.id };
  };

  const groups = new Map<string, Thread>();
  for (const m of [...messages].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    const { root, orphan } = root_of(m);
    let t = groups.get(root.id);
    if (!t) {
      t = { root, replies: [], orphan: root.id === m.id ? orphan : false, last_seq: root.seq || 0 };
      groups.set(root.id, t);
    }
    if (m.id !== root.id) {
      t.replies.push(m);
      t.last_seq = Math.max(t.last_seq, m.seq || 0);
    }
  }
  return [...groups.values()].sort((a, b) => a.last_seq - b.last_seq || (a.root.seq || 0) - (b.root.seq || 0));
}

// --------------------------------------------------------------- filters

/** Message categories the operator filters by (his 2026-07-14 ask). */
export type TeamFilter = "all" | "unread" | "asks" | "fyi" | "resolved" | "to_me" | "vigilance";

export const TEAM_FILTERS: Array<{ id: TeamFilter; label: string; title: string }> = [
  { id: "all", label: "All", title: "Every message in the window" },
  // Unit rule (operator dm 90): the Unread count is MESSAGES — the same
  // unit and source as the blue channel badge, so the two numbers agree.
  // Every other tab counts THREADS (what the filter lists).
  { id: "unread", label: "Unread", title: "Unread MESSAGES (same number as the blue channel badge); the list shows the threads containing them" },
  { id: "asks", label: "Asks", title: "Threads with open/blocked messages — something expects an answer" },
  { id: "vigilance", label: "Needs vigilance", title: "Threads with unanswered asks, critical messages, or messages addressed to your seat" },
  { id: "fyi", label: "FYI", title: "Threads of fyi/system traffic" },
  { id: "resolved", label: "Resolved", title: "Threads closed by a resolved reply (the ✓ Resolve act) or a resolved root" },
  { id: "to_me", label: "@me", title: "Threads with messages addressed to your seat" },
];

export type FilterContext = {
  seat: string;
  /** Unread seqs for the channel (from the seat's hub inbox) — feeds the
   *  Unread filter with the SAME data as the channel badge (adversary
   *  find: a badge whose filter cannot locate the messages is a broken
   *  loop). */
  unread_seqs?: Set<number>;
  /** Seqs that were unread when the Unread filter was ENTERED (operator
   *  dm 63: clicking a message fired the read, the live set shrank, and
   *  the thread vanished from under the operator mid-read). The filter
   *  matches snapshot ∪ live — a just-read message stays visible until
   *  the filter is left, while NEW arrivals (live-only) still appear. */
  unread_snapshot_seqs?: Set<number>;
  /** Seqs the hub escalated (or serving at effective_urgency=interrupt) —
   *  from /inbox envelopes, merged by seq (backlog 0010). Feeds the
   *  vigilance filter alongside the message-visible axes. */
  escalated_seqs?: Set<number>;
  /** Viewer-scoped Hub `to_me` cues from /inbox. These include routed
   * delegate duties that are intentionally absent from the stored `to` list. */
  to_me_seqs?: Set<number>;
};

function msg_matches(m: HubMessage, filter: TeamFilter, ctx: FilterContext): boolean {
  // Retracted messages (agora 0097, operator dm 88) exist in All (dimmed
  // tombstones — transcript integrity) and in Unread while genuinely
  // unread (the badge/tab unit-parity rule from dm 90: a count the filter
  // cannot locate is a broken loop; reading the tombstone clears it).
  // Every other triage lens excludes them: the retraction's whole point
  // is that nothing demands attention for the words anymore.
  if (m.retracted === true) {
    if (filter === "all") return true;
    if (filter === "unread") return Boolean(ctx.unread_seqs?.has(m.seq) || ctx.unread_snapshot_seqs?.has(m.seq));
    return false;
  }
  const status = String(m.status || "").toLowerCase();
  switch (filter) {
    case "all":
      return true;
    case "unread":
      return Boolean(ctx.unread_seqs?.has(m.seq) || ctx.unread_snapshot_seqs?.has(m.seq));
    case "asks":
      return status === "open" || status === "blocked";
    case "fyi":
      return status === "fyi";
    case "resolved":
      // A resolved REPLY is how threads actually close on this hub (the
      // root keeps its own status) — filter_threads keeps the whole
      // thread when any message matches, so both shapes surface.
      return status === "resolved";
    case "to_me":
      return (Array.isArray(m.to) && m.to.includes(ctx.seat)) || Boolean(ctx.to_me_seqs?.has(m.seq));
    case "vigilance": {
      const unanswered = (status === "open" || status === "blocked") && m.has_resolved_reply !== true;
      const critical = m.critical === true;
      const to_me = (Array.isArray(m.to) && m.to.includes(ctx.seat)) || Boolean(ctx.to_me_seqs?.has(m.seq));
      // Hub escalation axes (backlog 0010): escalated/effective_urgency
      // live on inbox envelopes, merged in by seq.
      const escalated = Boolean(ctx.escalated_seqs?.has(m.seq));
      return unanswered || critical || to_me || escalated;
    }
  }
}

/**
 * Thread-level filtering: a thread stays visible when ANY message in it
 * matches (the trail is the unit of reading — a matching reply keeps its
 * context). "all" short-circuits.
 */
export function filter_threads(threads: Thread[], filter: TeamFilter, ctx: FilterContext): Thread[] {
  if (filter === "all") return threads;
  return threads.filter((t) => [t.root, ...t.replies].some((m) => msg_matches(m, filter, ctx)));
}

/** True when the message itself matches the active filter (row highlight/
 *  force-show under a filter — a matching reply must never hide behind
 *  the collapse window). */
export function msg_matches_filter(m: HubMessage, filter: TeamFilter, ctx: FilterContext): boolean {
  return msg_matches(m, filter, ctx);
}

// ---------------------------------------------------------------- badges

export type ChannelBadges = {
  /** Operator-seat unread envelopes (hub /inbox grouped by channel). */
  unread: number;
  /** Unresolved open questions (digest counts.open_questions). */
  open_questions: number;
};

/** Group the seat's inbox envelopes into per-channel unread counts. */
export function unread_by_channel(inbox: Array<{ channel?: string; seq?: number }>): Record<string, number> {
  // ONE truth with the Unread-filter fold (operator dm 147: badge said 2,
  // tab said 1): count DISTINCT (channel, seq) — the hub's own client
  // contract ("dedup by per-channel seq high-water") because synthetic
  // envelopes (the stale-client notice) RIDE an existing channel+seq. An
  // envelope without a numeric seq still counts (never hide a message),
  // but cannot collide.
  const seen: Record<string, Set<number>> = {};
  const out: Record<string, number> = {};
  for (const e of inbox) {
    const c = String(e.channel || "");
    if (!c) continue;
    const seq = Number(e.seq);
    if (Number.isFinite(seq)) {
      const s = (seen[c] ||= new Set());
      if (s.has(seq)) continue;
      s.add(seq);
    }
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}

/** Per-channel unread seq sets (the Unread filter + row dots ride the
 *  same inbox envelopes as the badge counts). */
export function unread_seqs_by_channel(inbox: Array<{ channel?: string; seq?: number }>): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const e of inbox) {
    const c = String(e.channel || "");
    const seq = Number(e.seq);
    if (!c || !Number.isFinite(seq)) continue;
    (out[c] ||= new Set()).add(seq);
  }
  return out;
}

/** Viewer-scoped addressed rows. Newer Hub envelopes compute `to_me`, which
 * includes delegated operator work; older envelopes retain the raw `to`
 * fallback. The WUI consumes this served verdict and never derives routing. */
export function to_me_seqs_by_channel(
  inbox: Array<{ channel?: string; seq?: number; to_me?: boolean; to?: string[] | null }>,
  seat: string
): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const e of inbox) {
    const c = String(e.channel || "");
    const seq = Number(e.seq);
    if (!c || !Number.isFinite(seq)) continue;
    const legacy_to_me = e.to_me === undefined && Array.isArray(e.to) && seat ? e.to.includes(seat) : false;
    if (e.to_me === true || legacy_to_me) (out[c] ||= new Set()).add(seq);
  }
  return out;
}

/** STICKY-DEBT seqs (operator dm 111: "i can't unread this message").
 *  The hub pins three classes in the inbox PAST cursor acks: open/blocked
 *  obligations, addressed reply/fyi directives (0102 — they clear only on
 *  YOUR reply or an authoritative closure), and unread criticals (clear
 *  on read). Rendering these with the same "new · click clears" pill as
 *  plain unread is a lie the operator caught — clicking cannot clear
 *  them. This classifier lets the row say the truth: "needs your reply".
 */
export function debt_seqs_by_channel(
  inbox: Array<{ channel?: string; seq?: number; status?: string; to_me?: boolean; addressed?: boolean; to?: string[] | null }>,
  seat: string
): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const e of inbox) {
    const c = String(e.channel || "");
    const seq = Number(e.seq);
    if (!c || !Number.isFinite(seq)) continue;
    const status = String(e.status || "").toLowerCase();
    // `to_me` is the Hub's viewer-specific routing verdict. It covers
    // delegate obligations that cannot be reconstructed from message `to`.
    // Older Hubs omit it, so retain the raw-address fallback there only.
    const to_me = e.to_me === true || (e.to_me === undefined && Array.isArray(e.to) && seat ? e.to.includes(seat) : false);
    const broadcast = e.addressed === false || (e.addressed === undefined && (!Array.isArray(e.to) || e.to.length === 0));
    // Open/blocked broadcasts remain room-wide. An addressed row is a debt
    // only for the recipient the Hub selected; reply/fyi directives are
    // always recipient-scoped.
    const is_debt = ((status === "open" || status === "blocked") && (to_me || broadcast)) || ((status === "reply" || status === "fyi") && to_me);
    if (is_debt) (out[c] ||= new Set()).add(seq);
  }
  return out;
}

/** Hub-ESCALATED seqs (backlog 0010: fold the inbox's escalation axes into
 *  the vigilance filter). The hub raises stale obligations (`escalated`)
 *  and serves the resulting lane as `effective_urgency` — both live on
 *  /inbox envelopes only, never on channel messages, so the filter needs
 *  this seq-keyed merge. A seq qualifies when the hub explicitly escalated
 *  it or its effective lane is `interrupt` (the top lane, posted or
 *  escalated into). */
export function escalated_seqs_by_channel(
  inbox: Array<{ channel?: string; seq?: number; escalated?: boolean; effective_urgency?: string }>
): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const e of inbox) {
    const c = String(e.channel || "");
    const seq = Number(e.seq);
    if (!c || !Number.isFinite(seq)) continue;
    const lane = String(e.effective_urgency || "").toLowerCase();
    if (e.escalated === true || lane === "interrupt") (out[c] ||= new Set()).add(seq);
  }
  return out;
}

// ------------------------------------------------------------ fs browser

/** One level of a Drive-style folder view over the channel's FLAT virtual
 *  filesystem (operator dm 53): hub fs paths are plain strings with "/"
 *  separators, so folders are derived, not stored. Returns the immediate
 *  subfolders of `cwd` (with recursive file counts) and the entries that
 *  live directly in it. */
export function fs_children<T extends { path: string }>(
  entries: T[],
  cwd: string
): { dirs: Array<{ name: string; path: string; count: number }>; leaves: T[] } {
  const prefix = cwd ? cwd.replace(/\/+$/, "") + "/" : "";
  const dir_counts = new Map<string, number>();
  const leaves: T[] = [];
  for (const e of entries) {
    const p = String(e.path || "");
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) leaves.push(e);
    else {
      const name = rest.slice(0, slash);
      dir_counts.set(name, (dir_counts.get(name) || 0) + 1);
    }
  }
  return {
    dirs: [...dir_counts.entries()]
      .map(([name, count]) => ({ name, path: prefix + name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    leaves: leaves.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// ------------------------------------------------------------------ dms

/** The counterpart in a dm:<a>--<b> channel (sorted-pair name). Suffix
 *  matching, never a naive "--" split — seats may contain hyphens (the
 *  "foo--bar" corruption class). Empty string when the channel is not a
 *  dm or the seat is not one of the pair.
 *
 *  WHY THIS EXISTS (operator dm 84, "dm are NOT fyi"): the hub's native
 *  /dms/{peer}/messages route auto-addresses to=[peer], which is what
 *  raises the to-me obligation flag that wakes --important-only
 *  listeners. Posts made INSIDE an existing dm channel go through the
 *  generic channel route, which addresses nobody — so console DMs read
 *  as ambient fyi to every listener and sat unanswered for hours. Every
 *  in-dm post must carry to=[dm_peer_of(channel, seat)]. */
export function dm_peer_of(channel: string, seat: string): string {
  const c = String(channel || "");
  if (!c.startsWith("dm:") || !seat) return "";
  const pair = c.slice(3);
  if (pair.startsWith(`${seat}--`)) return pair.slice(seat.length + 2);
  if (pair.endsWith(`--${seat}`)) return pair.slice(0, pair.length - seat.length - 2);
  return "";
}

/** Status for a composer send (operator dm 86: "every dm to an agent MUST
 *  be received and interpreted as an ask"). Replies stay replies (they
 *  discharge and wake via reply-to-me); every NON-reply dm message posts
 *  as status=open — the hub's ask class: it lands in the counterpart's
 *  OWED block and stays owed until a reply discharges it. In rooms, only
 *  the explicit ask kind opens; fyi stays the room baseline. */
export function compose_status(opts: { is_reply: boolean; in_dm: boolean; kind: string }): "reply" | "open" | "fyi" {
  if (opts.is_reply) return "reply";
  if (opts.in_dm) return "open";
  return opts.kind === "ask" ? "open" : "fyi";
}

/** Message ids DISCHARGED within the loaded window: a reply from a
 *  DIFFERENT sender pointing at the id (the hub's binary-mode discharge
 *  rule, mirrored client-side). Needed because the messages list serves
 *  raw rows without the envelope's has_resolved_reply decoration — with
 *  every dm line now ask-class (dm 86), open roots would wear a warning
 *  chip FOREVER after being properly answered (adversarial find 1). */
export function replied_ids(messages: Array<{ id?: string; sender?: string; reply_to?: string | null }>): Set<string> {
  const sender_of = new Map<string, string>();
  for (const m of messages) if (m.id) sender_of.set(m.id, String(m.sender || ""));
  const out = new Set<string>();
  for (const m of messages) {
    const target = m.reply_to ? String(m.reply_to) : "";
    if (!target) continue;
    const original = sender_of.get(target);
    // Unknown original (reply window clipped the root): count it — a reply
    // exists, which is the calm-down signal; sender-equality only filters
    // self-continuations we can actually see.
    if (original === undefined || original !== String(m.sender || "")) out.add(target);
  }
  return out;
}

// ------------------------------------------------------------ reactions
// DELETED (operator dm 150 "one reputation score system"): the
// reactions:* store convention (ReactionValue/normalize/toggle/tally/key)
// stranded votes in rows the reputation system could not see — 26 of the
// operator's votes were found stranded across 9 channels. Message votes
// are hub RATINGS (rate_message/unrate_message; served row decorations +
// overlay_rating_tally below). Never reintroduce a client-side vote store.

// ------------------------------------------------------------- fs paths

/** Channel-fs path tokens mentioned in a message (operator dm 69: clicking
 *  a path like `plans/improving-entity-capabilities.md` — most commonly in
 *  the hub's "fs:put <path>" write notices — must open the file viewer).
 *  A token qualifies when it has at least one directory segment and a
 *  text-ish extension the viewer can render; URL-ish tokens are excluded
 *  (autolink owns those). Deduped in first-seen order, capped so a
 *  pathological message cannot mint a chip wall. */
const FS_PATH_RE = /(?:^|[\s("'`])((?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:md|markdown|txt|json|yaml|yml|csv|log))\b/g;
const FS_PATH_CAP = 4;

export function extract_fs_paths(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text || "").matchAll(FS_PATH_RE)) {
    const p = m[1];
    // A URL's path part matches the token shape; the scheme sits just
    // before the match — cheap context check on the source string.
    const at = m.index === undefined ? -1 : m.index;
    const before = at >= 0 ? String(text).slice(Math.max(0, at - 12), at + 1) : "";
    if (before.includes("://") || before.includes("/api/")) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= FS_PATH_CAP) break;
  }
  return out;
}

/** A path mention RESOLVED against reality (operator dm 93: a chip that
 *  404s is brittleness — prose paths may be channel-fs paths, ANOTHER
 *  SYSTEM's paths (an entity's home workspace, a repo), or files attached
 *  to the very same message). Resolution order:
 *  1. exact channel-fs path;
 *  2. unique basename match in the channel fs (file moved/rewritten);
 *  3. attachment on the message whose filename matches (basename or
 *     full) — the entity-workspace case: the prose names ITS path, the
 *     bytes ride the message;
 *  4. null — the mention stays PROSE, no chip minted (a dead button is
 *     worse than no button). */
export type FsMentionResolution =
  | { kind: "fs"; path: string; rewritten: boolean }
  | { kind: "attachment"; attachment_index: number };

export function resolve_fs_mention(
  mention: string,
  fs_paths: ReadonlySet<string> | null,
  attachments: Array<{ filename?: string }>
): FsMentionResolution | null {
  const base = mention.split("/").pop() || mention;
  // 1. Exact channel-fs path — unambiguous.
  if (fs_paths?.has(mention)) return { kind: "fs", path: mention, rewritten: false };
  // 2. EXACT attachment filename — certainty beats every heuristic below
  //    (adversarial find 2: an fs basename guess must never outrank the
  //    message's own byte-exact attachment). Full pass before any
  //    basename clause (find 3: first-wins single-pass opened attachment
  //    [0] when [1] was the exact match).
  for (let i = 0; i < attachments.length; i++) {
    if (String(attachments[i]?.filename || "") === mention) return { kind: "attachment", attachment_index: i };
  }
  // 3. Unique basename in the channel fs (file moved/rewritten).
  if (fs_paths) {
    const tail_hits: string[] = [];
    for (const p of fs_paths) {
      if (p === base || p.endsWith(`/${base}`)) tail_hits.push(p);
    }
    if (tail_hits.length === 1) return { kind: "fs", path: tail_hits[0], rewritten: tail_hits[0] !== mention };
    // Ambiguous basename: refuse to guess — fall through to attachments.
  }
  // 4. Attachment basename match (foreign-workspace path, bytes on the
  //    message).
  for (let i = 0; i < attachments.length; i++) {
    const fn = String(attachments[i]?.filename || "");
    if (fn && (fn === base || fn.split("/").pop() === base)) return { kind: "attachment", attachment_index: i };
  }
  // Unknown fs state (listing unavailable): only an attachment match may
  // chip; a bare fs guess is exactly the 404 class being removed.
  return null;
}

// -------------------------------------------------------------- /group

/** Mention token, byte-for-byte the regex agora's chat/CLI use — the two
 *  front doors must parse one grammar (agora dm handoff, 0.12.10). */
const MENTION_RE = /@([A-Za-z0-9][A-Za-z0-9_.-]*)/g;

/** Parse a `/group` line into (title, members): @mentions anywhere become
 *  the roster (order kept, dupes dropped, case folded to hub lowercase
 *  ids); the mention-stripped text is the topic title. Mirrors
 *  agora.chat.parse_group. */
export function parse_group(arg: string): { title: string; members: string[] } {
  const members: string[] = [];
  for (const m of arg.matchAll(MENTION_RE)) {
    const id = m[1].toLowerCase();
    if (!members.includes(id)) members.push(id);
  }
  const title = arg
    .replace(MENTION_RE, " ")
    .split(/\s+/)
    .join(" ")
    .trim()
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  return { title, members };
}

/** Member list from a free-text field (operator dm 71: the composer's
 *  "group" kind takes names like "@entity @assistant"). Forgiving input —
 *  @-prefixed or bare, space/comma separated — normalized to lowercase hub
 *  ids, deduped in order; tokens that can't be ids are dropped. */
export function parse_member_list(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text || "").split(/[\s,;]+/)) {
    const t = raw.replace(/^@/, "").toLowerCase();
    if (!t || !/^[a-z0-9][a-z0-9_.-]*$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Channel slug from the topic title: lowercase, dashes for runs of
 *  non-slug characters, capped at 40, uniqued against existing rooms with
 *  -2/-3… (the hub's create_channel refuses spaces/slashes/controls, so
 *  the slug must be born clean). Mirrors agora.chat.group_slug. */
export function group_slug(title: string, taken: Set<string>): string {
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!base) base = "group";
  base = base.slice(0, 40).replace(/[-.]+$/g, "");
  let slug = base;
  let n = 1;
  while (taken.has(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

// ------------------------------------------------------- prose-wall reflow

/** A text block is a WALL when it runs this long with no line breaks —
 *  the class of message the reflow exists for (operator dm 121: a whole
 *  design report as ONE paragraph). */
const WALL_MIN_CHARS = 400;
/** Enumerator tokens agents write inline: " (1) ", " (b) ", " [2] " after
 *  sentence punctuation, starting a new point. */
const WALL_ENUM_RE = /([.;:!?…]["')\]]*) +(\((?:\d{1,2}|[a-z])\)|\[\d{1,2}\]) (?=["'([{]?[A-Za-z0-9])/g;
/** ALL-CAPS section transitions ("THE DESIGN …", "WHY IT IS NOT BUILT:")
 *  after sentence punctuation: two or more consecutive all-caps words
 *  (single-letter words like "I" allowed after the first). */
const WALL_CAPS_RE = /([.;:!?…]["')\]]*) +(?=[A-Z][A-Z'-]+(?: [A-Z][A-Z'-]*)+)/g;

/** Display-only reflow of prose walls (operator dm 121: "is there a way to
 *  make these messages more readable?"). Agents often post long reports as
 *  ONE unbroken paragraph with inline enumerators — no markdown structure,
 *  so the typography pass (dm 116) has nothing to style. This inserts
 *  PARAGRAPH BREAKS (whitespace only — every author word stays verbatim,
 *  nothing is restyled, reordered, or promoted to headings; heading
 *  detection was deliberately rejected as too misfire-prone) before
 *  enumerators and ALL-CAPS section transitions, only when:
 *    - the block is a genuine wall (> WALL_MIN_CHARS, no newlines), and
 *    - at least 2 break points exist (one "(1)" in prose is not a list).
 *  Code fences and inline code spans are never touched. The stored
 *  message never changes — this runs at render time, like autolink. */
export function reflow_prose_walls(text: string): string {
  if (!text || text.length < WALL_MIN_CHARS) return text;
  // Fences out first: their content is code, not prose.
  const fence_parts = text.split(/(```[\s\S]*?(?:```|$))/);
  const out: string[] = [];
  for (const part of fence_parts) {
    if (part.startsWith("```")) {
      out.push(part);
      continue;
    }
    // Blank-line-delimited blocks; only wall-shaped ones reflow.
    const blocks = part.split(/(\n{2,})/);
    for (const block of blocks) {
      if (/\n/.test(block) || block.length < WALL_MIN_CHARS) {
        out.push(block);
        continue;
      }
      // Inline code spans within the wall stay untouched: split, reflow
      // only the prose segments, but count break points across the whole
      // block so the 2-point floor applies to the block, not per segment.
      const segs = block.split(/(`[^`\n]*`)/);
      let points = 0;
      for (const seg of segs) {
        if (seg.startsWith("`")) continue;
        points += (seg.match(WALL_ENUM_RE) || []).length + (seg.match(WALL_CAPS_RE) || []).length;
      }
      if (points < 2) {
        out.push(block);
        continue;
      }
      out.push(
        segs
          .map((seg) => {
            if (seg.startsWith("`")) return seg;
            return seg.replace(WALL_ENUM_RE, "$1\n\n$2 ").replace(WALL_CAPS_RE, "$1\n\n");
          })
          .join("")
      );
    }
  }
  return out.join("");
}

// ------------------------------------------------------------- autolink

const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`]+/g;

/** Render bare URLs as inert code-shaped references. A peer message never
 *  turns the browser into another network client: Hub attachments use the
 *  authenticated HubClient path, and the Markdown renderer separately
 *  makes authored links and images inert. The optional argument remains for
 *  source compatibility with the extracted Team surface. */
export function autolink_body(text: string, _opts?: { hub_base?: string; app_origin?: string }): string {
  if (!text || !/https?:\/\//.test(text)) return text;
  // Split out fenced code blocks first, then inline code spans — URLs
  // inside either must stay untouched (they are code, not references).
  const fence_parts = text.split(/(```[\s\S]*?(?:```|$))/);
  const out: string[] = [];
  for (let fi = 0; fi < fence_parts.length; fi++) {
    const part = fence_parts[fi];
    if (part.startsWith("```")) {
      out.push(part);
      continue;
    }
    const code_parts = part.split(/(`[^`\n]*`)/);
    for (let ci = 0; ci < code_parts.length; ci++) {
      const seg = code_parts[ci];
      if (seg.startsWith("`")) {
        out.push(seg);
        continue;
      }
      out.push(
        seg.replace(URL_RE, (url, offset: number) => {
          // Already inside markdown link/image syntax? `neutralize_unsafe_embeds`
          // handles those whole tokens, so leave their destination alone here.
          const before = seg.slice(Math.max(0, offset - 2), offset);
          if (before.endsWith("](") || before.endsWith("(")) return url;
          // Trailing punctuation is prose, not URL (the classic "see
          // https://x.dev." case) — trim it out of the link.
          const trimmed = url.replace(/[.,;:!?]+$/, "");
          const tail = url.slice(trimmed.length);
          return `\`${trimmed}\`${tail}`;
        })
      );
    }
  }
  return out.join("");
}

// -------------------------------------------------- embed-target defang

/** Defang Markdown links/images in untrusted message text. WUI deliberately
 *  has no general web transport: Hub attachments are fetched by HubClient
 *  and rendered as object URLs elsewhere, so message-body markup never
 *  creates an image or navigable link. The Markdown component repeats this
 *  policy as its renderer-level defense. Display-only; stored text is
 *  unchanged.
 *  The full destination is replaced before Markdown gets it; the renderer is
 *  the independent defense if a new Markdown construct slips past this pass. */
export function neutralize_unsafe_embeds(text: string): string {
  if (!text || !text.includes("](")) return text;
  const MD_LINK_OR_IMG = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  return text.replace(MD_LINK_OR_IMG, (_whole, _bang, alt, url) => {
    const shown = String(alt || "").trim() || String(url);
    return "`" + shown.replace(/`/g, "") + " (link disabled)`";
  });
}

// ------------------------------------------------------------ sender hue

/** Deterministic per-sender hue (Slack/IRC convention) — stable across
 *  sessions, no palette to maintain. */
export function sender_hue(sender: string): number {
  let h = 0;
  for (let i = 0; i < sender.length; i++) h = (h * 31 + sender.charCodeAt(i)) >>> 0;
  return h % 360;
}

// ------------------------------------------------- transcript for the LLM

const TRANSCRIPT_CHAR_BUDGET = 24_000;

/** Reserved for the #TRUNCATION header so the final string stays inside
 *  the budget even when truncation fires (adversary find: the header sat
 *  outside the accounting). */
const TRUNCATION_HEADER_RESERVE = 160;

/**
 * Serialize messages for an LLM context, newest-last, bounded. When the
 * window exceeds the budget the OLDEST messages drop and the header says
 * so (#TRUNCATION — labeled, never silent). A single message larger than
 * half the budget is clamped in place with its own label — one giant
 * message can never blow the whole context (adversary find).
 */
export function serialize_transcript(messages: HubMessage[], opts?: { char_budget?: number }): string {
  const budget = opts?.char_budget ?? TRANSCRIPT_CHAR_BUDGET;
  const per_message_cap = Math.max(500, Math.floor(budget / 2));
  const ordered = [...messages].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const lines: string[] = [];
  for (const m of ordered) {
    const to = Array.isArray(m.to) && m.to.length ? ` to=[${m.to.join(",")}]` : "";
    const asks = m.data?.asks?.length ? ` asks=${m.data.asks.map((a) => `${a.id}:"${a.text}"`).join("; ")}` : "";
    const answers = m.data?.answers?.length ? ` answers=[${m.data.answers.join(",")}]` : "";
    const reply = m.reply_to ? ` reply_to=${m.reply_to}` : "";
    let line = `#${m.seq} [${m.sender}] (${m.status})${to}${reply}${asks}${answers}\n${m.title ? `title: ${m.title}\n` : ""}${String(m.body || "").trim()}`;
    if (line.length > per_message_cap) {
      line = line.slice(0, per_message_cap) + `\n[#TRUNCATION: message #${m.seq} clamped to fit the context budget]`;
    }
    lines.push(line);
  }
  let dropped = 0;
  let total = lines.reduce((n, l) => n + l.length + 2, 0);
  while (lines.length > 1 && total > budget - TRUNCATION_HEADER_RESERVE) {
    const gone = lines.shift() as string;
    total -= gone.length + 2;
    dropped++;
  }
  const header = dropped > 0 ? `#TRUNCATION: the ${dropped} oldest message(s) were dropped to fit the context budget.\n\n` : "";
  return header + lines.join("\n\n");
}

/** Per-message rating tally (agora-0122, hub-served row decoration). */
export type RatingTallyView = { up: number; down: number; mine: number };

/**
 * Overlay the seat's OPTIMISTIC standing rating onto a hub-served tally
 * decoration (agora-0122 "one reputation system").
 *
 * The hub is the source of truth (`MessageRow.ratings {up,down,mine}` —
 * every rater's standing ±1 plus the viewer's own); the console applies a
 * click optimistically and must PREDICT the row the hub will serve next
 * poll, or the thumb flickers. The prediction is exact because a rating is
 * one standing statement per (rater, message): moving MY unit from `mine`
 * to `local` moves exactly one count between the up/down buckets.
 *
 * `caught_up` tells the caller the served row already reflects the local
 * click (clear the optimistic entry — later EXTERNAL changes must win).
 * Golden conformance: vendor/hub/vector_05_message_ratings.json drives this
 * fold in hub_conformance.test.ts — the overlay's predicted rows must equal
 * the vector's served rows after each flip/withdraw.
 */
export function overlay_rating_tally(
  dec: { up?: number | null; down?: number | null; mine?: number | null },
  local: number | undefined,
): RatingTallyView & { caught_up: boolean } {
  let up = Number(dec.up || 0);
  let down = Number(dec.down || 0);
  let mine = Number(dec.mine || 0);
  if (local === undefined) return { up, down, mine, caught_up: false };
  if (local === mine) return { up, down, mine, caught_up: true };
  // Remove my served unit, add my local unit (0 = withdrawn: add nothing).
  if (mine > 0) up -= 1;
  else if (mine < 0) down -= 1;
  if (local > 0) up += 1;
  else if (local < 0) down += 1;
  return { up: Math.max(0, up), down: Math.max(0, down), mine: local, caught_up: false };
}

/**
 * Split a served search snippet into render spans from the hub's highlight
 * offsets (agora-0132 `GET /search`).
 *
 * The hub serves `highlights` as `[[start, len], ...]` in CODE-POINT
 * offsets into the served snippet string — computed hub-side AFTER
 * sentinel stripping, so the offsets index the exact wire string. JS
 * strings are UTF-16: `String.prototype.slice` counts code UNITS and
 * drifts one position per astral character (emoji, some CJK) before the
 * mark — so this fold walks a code-point array, never the raw string.
 *
 * Defensive by contract, not paranoia: offsets are clamped to the snippet,
 * malformed pairs are dropped, and overlapping pairs are merged forward
 * (the hub sorts + never overlaps today; a future regression must degrade
 * to readable text, never to a crash or scrambled spans).
 */
export function snippet_spans(
  snippet: string,
  highlights: number[][] | null | undefined,
): Array<{ text: string; hit: boolean }> {
  const cps = Array.from(String(snippet ?? ""));
  const pairs = (highlights ?? [])
    .filter((h) => Array.isArray(h) && h.length >= 2 && Number.isFinite(h[0]) && Number.isFinite(h[1]) && h[0] >= 0 && h[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  const spans: Array<{ text: string; hit: boolean }> = [];
  let pos = 0;
  for (const [start, len] of pairs) {
    if (start >= cps.length) break;
    const s = Math.max(start, pos); // merge-forward on overlap
    const e = Math.min(start + len, cps.length);
    if (e <= s) continue;
    if (s > pos) spans.push({ text: cps.slice(pos, s).join(""), hit: false });
    spans.push({ text: cps.slice(s, e).join(""), hit: true });
    pos = e;
  }
  if (pos < cps.length) spans.push({ text: cps.slice(pos).join(""), hit: false });
  if (!spans.length && cps.length) spans.push({ text: cps.join(""), hit: false });
  return spans;
}

/** The six fixed sections of the grouped search report (agora-0132), in
 *  SERVED order — the order is part of the contract (structural sections
 *  first, newest-first inside; messages/people ride relevance). `kind` is
 *  the per-section pivot into sort=recent keyset paging; null = the
 *  section has no single-kind pivot (open_threads mixes message statuses —
 *  relevance top-K only, re-query to go deeper). */
export const SEARCH_SECTIONS: Array<{ id: "decisions" | "open_threads" | "work" | "people" | "files" | "messages"; label: string; kind: string | null }> = [
  { id: "decisions", label: "Decisions", kind: "decision" },
  { id: "open_threads", label: "Open threads", kind: null },
  { id: "work", label: "Work", kind: "work" },
  { id: "people", label: "People", kind: "agent" },
  { id: "files", label: "Files", kind: "file" },
  { id: "messages", label: "Messages", kind: "message" },
];
