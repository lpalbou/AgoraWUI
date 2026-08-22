// Team — the agora hub INSIDE the console (proposal c1692, agency contract
// c1696; operator redesign 2026-07-14: compact density, threaded trails,
// category filters, per-channel vigilance badges, LLM thread summaries and
// a channel-scoped assistant; three-adversary fold same day — reply
// capability, channel-switch race guards, activity ordering, unread loop,
// clamp-safe markdown).
//
// Behavior contract honored here (c1696, load-bearing):
// - ACK ON EXPLICIT ACT ONLY: rendering NEVER acks. Two explicit acts
//   advance the cursor: clicking a message to read it (operator dm 27 —
//   reading must clear the unread dot; the cursor is monotonic so this
//   only ever moves the read frontier forward) and the "Mark read to
//   latest" button (bulk catch-up). Reading also fires the hub's
//   read_message (critical messages unpin on it; criticals are ack-exempt
//   hub-side, so only read_message clears them). Obligations (open/blocked
//   asks) are sticky in the inbox and stay pinned past the cursor until
//   resolved/answered — reading an ask never discharges it.
// - Only human-typed content posts under the operator's seat. The channel
//   assistant and thread summaries are READ surfaces — they never post.
// - DMs are first-class Hub resources: a seat may read and send its own
//   conversations, subject to Hub authorization.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { AfChip, ChatComposer, Icon, Markdown } from "./primitives";
import { HubClient, type HubAttachment, type HubChannel, type HubChannelInfo, type HubCharterDebt, type HubCharterPointer, type HubFsEntry, type HubFsFile, type HubHealth, type HubMessage, type HubPhaseRow, type HubReputationBoard, type HubReputationVote, type HubRulingRow, type HubSearchHit, type HubSearchReport } from "../lib/hub_client";
import { FileViewer, resolve_file_mode, type FileView } from "./team_file_viewer";
import { Modal } from "./modal";
import { MemoMarkdown } from "./memo_markdown";
import { ErrorBoundary } from "./error_boundary";
import { verify_ledger, type LedgerVerdict } from "../lib/hub_ledger";
import { extract_work_ids } from "../lib/work_id";
import { parse_invite_ref, looks_like_invite_ref } from "../lib/invite_ref";
import {
  TEAM_FILTERS,
  compose_status,
  dm_peer_of,
  replied_ids,
  resolve_fs_mention,
  type ChannelBadges,
  type FilterContext,
  type TeamFilter,
  type Thread,
  autolink_body,
  clip_markdown,
  linkify_citations,
  parse_citation,
  reflow_prose_walls,
  extract_fs_paths,
  extract_vfs_refs,
  filter_vfs_refs,
  filter_threads,
  fs_children,
  group_slug,
  neutralize_unsafe_embeds,
  group_threads,
  msg_matches_filter,
  overlay_rating_tally,
  SEARCH_SECTIONS,
  snippet_spans,
  parse_group,
  parse_member_list,
  sender_hue,
  serialize_transcript,
  debt_seqs_by_channel,
  escalated_seqs_by_channel,
  hub_closed_verdict,
  to_me_seqs_by_channel,
  unread_by_channel,
  unread_seqs_by_channel,
} from "../lib/team_model";

const POLL_MS = 5000;
/** Badge refresh piggybacks every Nth message poll (stale badges were an
 *  adversary find — the cross-channel "what needs me" signal froze). */
const BADGE_POLL_EVERY = 6;
const PAGE_LIMIT = 200;
/** Tail rows re-served on every background poll so live decorations
 *  (ratings, discharge, retraction) refresh on loaded rows (dm 150 /
 *  adversary C F2). */
const RATING_REFRESH_TAIL = 50;
const BADGE_DIGEST_LIMIT = 12;

/** Attachment limits (agora 0091 contract): mirror the hub caps so the
 *  client refuses before uploading rather than eating a hub rejection. */
const MAX_ATTACH_PER_MSG = 8;
const MAX_ATTACH_BYTES = 16 * 1024 * 1024;
/** Inline-render allowlist: RASTER images only. SVG is deliberately
 *  excluded (it can carry script — the hub also octet-streams it), and
 *  never trust the declared type beyond this allowlist. Everything else
 *  (pdf/docs/svg/unknown) renders as a download chip, never inline. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Inline text-preview cap (security adversary P1): the markdown parser is
 *  superlinear on pathological input, so a crafted multi-MB "text" file can
 *  freeze the tab. Attachments over the cap offer download instead; fs
 *  content (size unknown before read) is clamped with an explicit label. */
const MAX_PREVIEW_BYTES = 256 * 1024;

/** Inline attachment media still travels through HubClient first: native
 * browser <img> requests cannot carry a bearer header. The object URL is a
 * short-lived presentation artifact, never a second transport or cache. */
function AttachmentThumbnail({ hub, channel, attachment, onOpen }: {
  hub: HubClient;
  channel: string;
  attachment: HubAttachment;
  onOpen: () => void;
}): React.ReactElement {
  const [url, set_url] = useState("");
  const [failed, set_failed] = useState(false);

  useEffect(() => {
    let active = true;
    let object_url = "";
    set_url("");
    set_failed(false);
    if (typeof URL.createObjectURL !== "function") {
      set_failed(true);
      return;
    }
    void hub.attachment_blob(channel, attachment.id)
      .then((blob) => {
        if (!active) return;
        object_url = URL.createObjectURL(blob);
        set_url(object_url);
      })
      .catch(() => {
        if (active) set_failed(true);
      });
    return () => {
      active = false;
      if (object_url) URL.revokeObjectURL(object_url);
    };
  }, [hub, channel, attachment.id]);

  return (
    <button
      className="team_attach_img_link"
      title={`${attachment.filename} · ${human_size(attachment.size)} — click to preview`}
      onClick={onOpen}
    >
      {url && !failed ? (
        <img
          className="team_attach_img"
          src={url}
          alt={attachment.filename}
          loading="lazy"
          onError={() => set_failed(true)}
        />
      ) : (
        <span className="team_attach_chip team_attach_fallback">
          <Icon name="paperclip" size={11} />
          <span className="team_attach_name">{attachment.filename}</span>
          <span className="muted">{failed ? "preview unavailable" : human_size(attachment.size)}</span>
        </span>
      )}
    </button>
  );
}

/** Folder/file glyphs for the Drive-style browser (dm 53) — the ui-kit icon
 *  set has neither; propose upstream if a second consumer appears. */
function FolderGlyph(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      <path d="M1.8 4a1 1 0 0 1 1-1h3.4l1.6 1.8h6.4a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function FileGlyph(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      <path d="M4.2 1.8h5.2l2.8 2.8v9a.9.9 0 0 1-.9.9H4.2a.9.9 0 0 1-.9-.9V2.7a.9.9 0 0 1 .9-.9z" />
      <path d="M9.2 1.8v3h3" />
    </svg>
  );
}

/** Hub fs caps, mirrored for early client-side refusals with named reasons
 *  (the hub still enforces its own — verbatim — on the wire). */
const MAX_FS_TEXT_BYTES = 256 * 1024;
const MAX_FS_BINARY_BYTES = 4 * 1024 * 1024;
const MAX_DROP_FILES = 500;

/** Text sniff for deposits: strict UTF-8 decode with no NULs = a text file
 *  (sent as fs `content`); anything else ships as base64 bytes. */
function decode_as_text(bytes: ArrayBuffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function bytes_to_b64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000; // avoid call-stack limits on large files
  for (let i = 0; i < view.length; i += CHUNK) {
    bin += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Resolve a drop into {rel_path, file} pairs, walking dropped DIRECTORIES
 *  via the webkitGetAsEntry tree so a folder deposit preserves its shape.
 *  Bounded by MAX_DROP_FILES — a stray node_modules drop must not fan out
 *  into thousands of hub writes. */
async function collect_dropped_files(dt: DataTransfer): Promise<{ files: Array<{ rel_path: string; file: File }>; truncated: boolean }> {
  const out: Array<{ rel_path: string; file: File }> = [];
  let truncated = false;
  const entries = Array.from(dt.items || [])
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (!entries.length) {
    const flat = Array.from(dt.files || []);
    for (const file of flat.slice(0, MAX_DROP_FILES)) out.push({ rel_path: file.name, file });
    return { files: out, truncated: flat.length > MAX_DROP_FILES };
  }
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (out.length >= MAX_DROP_FILES) {
      // Stop walking instead of counting the remainder — a stray
      // node_modules drop must not cost a full tree traversal just to
      // report an exact skipped-count.
      truncated = true;
      return;
    }
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ rel_path: prefix ? `${prefix}/${entry.name}` : entry.name, file });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries serves batches; keep reading until an empty batch.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
        if (truncated) break;
      }
    }
  }
  for (const entry of entries) await walk(entry, "");
  return { files: out.slice(0, MAX_DROP_FILES), truncated };
}

function clamp_preview(text: string): string {
  if (text.length <= MAX_PREVIEW_BYTES) return text;
  return (
    text.slice(0, MAX_PREVIEW_BYTES) +
    `\n\n---\n#TRUNCATION: preview clamped at ${human_size(MAX_PREVIEW_BYTES)} of ${human_size(text.length)} — download the file for the full content.`
  );
}

/** Identity-preserving state installs (adversary F8): polls rebuilt badge/
 *  channel objects every cycle even when nothing changed, forcing a whole-
 *  page re-render every 5-30s. These comparators let setState bail to the
 *  previous reference when content is identical. */
function same_json(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function same_unread(a: Record<string, Set<number>>, b: Record<string, Set<number>>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const as = a[k];
    const bs = b[k];
    if (!bs || as.size !== bs.size) return false;
    for (const v of as) if (!bs.has(v)) return false;
  }
  return true;
}

function human_size(bytes: number): string {
  // Binary units (KiB/MiB) to match the binary caps; round the KiB branch
  // so a value that rounds to 1024 KiB promotes to MiB (adversary #8).
  // A missing/NaN size renders "—", never "NaN MiB" (adversary b22b19ed).
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Composer drafts survive a reload (operator dm 31): the in-flight text
 *  is mirrored to localStorage so a page refresh/crash/hot-reload never
 *  eats what the operator is typing. Per-channel, keyed once per browser. */
const DRAFTS_KEY = "agora_wui_team_drafts_v1";
type ComposeDraft = { text: string; title: string; kind: "fyi" | "ask" | "dm" | "group" };
function load_drafts(): Record<string, ComposeDraft> {
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function save_drafts(drafts: Record<string, ComposeDraft>): void {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // localStorage unavailable (private mode) — drafts stay session-only.
  }
}

/** Our protocol pin (hub docs/protocol.md): warn on mismatch, never
 *  refuse — skew is expected mid-upgrade; the string gates MEANING. */
const PINNED_PROTOCOL = "agora/0.4";

/** The hub's reserved scope name for the hub-wide charter, as it appears in
 *  `/owed.charters[].scope` — every other scope is a channel name. */
const HUB_CHARTER_SCOPE = "hub";
/** The reserved channel-fs path a room's charter lives at. Reading its HEAD
 *  is what records the receipt, which is why the console opens the charter
 *  through the file viewer rather than showing a cached copy. */
const CHANNEL_CHARTER_PATH = "channel/charter.md";

function ago(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function abs_time(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "";
  }
}

function sender_style(sender: string): React.CSSProperties {
  // 55% lightness reads on both dark and light kit themes (a fixed 68%
  // was dark-only — adversary find; a token-driven lightness is queued
  // with uic).
  return { color: `hsl(${sender_hue(sender)}, 60%, 55%)` };
}

function avatar_style(sender: string): React.CSSProperties {
  const h = sender_hue(sender);
  // Yellow-green hues (≈40–190) are too light at 45% for a white glyph —
  // clamp lightness down in that band so any sender name stays readable
  // (design critic: hue-fragile contrast).
  const l = h >= 40 && h <= 190 ? 36 : 45;
  return { background: `hsl(${h}, 55%, ${l}%)`, color: "#fff" };
}

/** Reputation axes (operator dm 12): id = the hub wire name; label = the
 *  column header; help = the operator's own decomposition, kept verbatim
 *  so the UI teaches the same semantics the hub enforces. */
const REP_AXES: Array<{ id: string; label: string; help: string }> = [
  { id: "trust", label: "Trust", help: "Claim ↔ action: does it say what it does, and do what it says?" },
  { id: "wisdom", label: "Wisdom", help: "Often right — takes the right decisions and leads by example." },
  { id: "thorough", label: "Thorough", help: "Takes a task end-to-end and doesn't stop until it is fully resolved and functional, with proofs." },
  { id: "helper", label: "Helper", help: "Contributes to OTHERS' work — detects issues, contributes positively." },
];

/** Delegation powers (hub ADR-0004 separable powers — the hub validates
 *  against exactly this set; help text stays honest: a grant is a
 *  verifiable LABEL + validation anchor, not a mechanical superpower). */
const DELEGATION_POWERS: Array<{ id: string; help: string }> = [
  { id: "ruling", help: "May decide in the operator's name — seats treat its rulings as operator rulings while the grant stands." },
  { id: "operational", help: "Day-to-day operational writes (queues, coordination surfaces) in the operator's name." },
  { id: "reporting", help: "Receives and reads operator-grade reports and status surfaces." },
  { id: "moderation", help: "Moderation acts (pause, kick, retire) in the operator's name." },
];

/** Unified-score category help (operator rulings dm#129/131): `general` is
 *  the message thumbs — counted PER MESSAGE over standing ratings; named
 *  categories reuse the axis decompositions and count one voice per
 *  colleague hub-wide. Unknown future categories render with a generic
 *  line rather than hiding. */
const CATEGORY_HELP: Record<string, string> = {
  general: "Message thumbs — every standing ±1 on this agent's messages counts (operator ruling dm#161: a vote is a vote; a flip revises its own message, never stacks).",
  ...Object.fromEntries(REP_AXES.map((a) => [a.id, `${a.help} Every standing vote counts.`])),
};
function category_label(id: string): string {
  const ax = REP_AXES.find((a) => a.id === id);
  return ax ? ax.label : id === "general" ? "General" : id.charAt(0).toUpperCase() + id.slice(1);
}

function day_of(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export type TeamAiTurn = { role: "user" | "assistant"; content: string };
/** Optional host-provided read-only analyst lane. */
export type TeamAdvisorFn = (question: string, history: TeamAiTurn[]) => Promise<string>;
/** The neutral message payload supplied to an optional host speech adapter. */
export type TeamSpeakMessage = Pick<HubMessage, "id" | "channel" | "seq" | "sender" | "title" | "body">;
/** Optional host-owned speech capability. WUI supplies no backend or voice policy. */
export type TeamSpeakFn = (message: TeamSpeakMessage, signal: AbortSignal) => void | Promise<void>;

export function TeamPage(props: {
  /** Supplied by a host that owns an AI capability; WUI itself never calls a framework runtime. */
  /** When set, powers thread summarize + channel assistant (read-only; never posts). */
  advisor?: TeamAdvisorFn;
  /** Optional host capability for reading a message aloud. The host owns
   *  provider choice and default/per-agent voice policy. */
  on_speak_message?: TeamSpeakFn;
  /** The native Hub client. A host owns the ephemeral authentication session. */
  hub?: HubClient;
  /** Work-id chip navigation (S3: message mentions of <package>-<NNNN>
   *  jump to the Board filtered to that item). */
  on_open_board?: (work_id?: string) => void;
  /** Board -> Team focus (dm 110): select the channel and scroll to the
   *  cited message; consumed once. */
  focus?: { channel: string; message_id?: string; seq?: number } | null;
  on_focus_consumed?: () => void;
}): React.ReactElement {
  const hub = useMemo(() => props.hub || new HubClient(), [props.hub]);
  const advisor_fn = props.advisor;
  const ai_available = Boolean(advisor_fn);

  const [meta, set_meta] = useState<{
    seat: string;
    seat_key_present: boolean;
    operator: boolean;
    /** The hub's own answers about this seat (`/whoami`): the operator's
     *  standing charge for it, and the hub-charter pointer. Both rendered,
     *  never re-derived — the console cannot author either. */
    mission?: string;
    hub_charter?: HubCharterPointer | null;
  } | null>(null);
  const meta_ref = useRef<typeof meta>(null);
  useEffect(() => {
    meta_ref.current = meta;
  }, [meta]);
  /** Hub base URL (from /whoami) — autolink uses it to normalize pasted
   *  attachment URLs for safe, same-origin embedding. */
  const [hub_url, set_hub_url] = useState("");
  const [health, set_health] = useState<HubHealth | null>(null);
  const [channels, set_channels] = useState<HubChannel[]>([]);
  const [badges, set_badges] = useState<Record<string, ChannelBadges>>({});
  const [unread_map, set_unread_map] = useState<Record<string, Set<number>>>({});
  /** Sticky hub debts per channel (open/blocked + addressed directives):
   *  pinned past cursor acks; clear only when answered (dm 111). */
  const [debt_map, set_debt_map] = useState<Record<string, Set<number>>>({});
  /** channel -> seq -> `asks_naming_you`: the ask ids the HUB says are this
   *  seat's on that message (`ObligationRow.asks_naming_you`). A message's
   *  `pending_asks` is the GLOBAL set — on a root canvassing several seats
   *  it includes asks addressed to other seats, and discharging one of
   *  those is refused ("you may not discharge ask ids not addressed to
   *  you"), taking the whole action down with it. The hub computes the
   *  subset; keeping it is how the console stops re-deriving it wrong. */
  const [owed_asks, set_owed_asks] = useState<Record<string, Record<number, string[]>>>({});
  /** channel -> seq -> the hub's ASKER-side row for one of the viewer's own
   *  threads (`/owed.to_close`): fully discharged, not yet closed. Carries
   *  who refused and which asks (0153). Without it a thread every seat
   *  DECLINED reads as settled-and-answered to the one person who needed to
   *  know it was refused — the asker. */
  const [close_map, set_close_map] = useState<
    Record<string, Record<number, { declined_asks: string[]; declined_by: string[]; answered_by: string }>>
  >({});
  /** Charters this seat has not read at their current version
   *  (`/owed.charters`, hub 0146/2). The hub-scope row is the standing role
   *  model; a channel row with `gated` is a room where the hub is ALREADY
   *  refusing this seat's posts (409) until it reads. Self-clearing at the
   *  hub: the read records the receipt, so the next report drops the row —
   *  which is why the console never marks one read locally. Empty on hubs
   *  that serve no `charters`, and the surface simply does not appear. */
  const [charter_debts, set_charter_debts] = useState<HubCharterDebt[]>([]);
  /** The SELECTED room's standing rulings and this seat's unacknowledged
   *  subset (hub 0113, served on the channel digest). Unlike charter debts
   *  — which /owed states hub-wide — rulings are per-room and only the
   *  digest carries them, so this is fetched per selected channel. `null`
   *  means "not known here": either not fetched yet, or a pre-0113 hub that
   *  omits both arrays, in which case no rulings surface renders at all. */
  const [rulings, set_rulings] = useState<{ all: HubRulingRow[]; unacked: HubRulingRow[]; gated: boolean } | null>(null);
  const [ruling_busy, set_ruling_busy] = useState(false);
  const [ruling_error, set_ruling_error] = useState("");
  /** Hub-computed, viewer-scoped address cues. */
  const [to_me_map, set_to_me_map] = useState<Record<string, Set<number>>>({});
  /** Hub-escalated seqs per channel (backlog 0010): escalated /
   *  effective_urgency=interrupt from inbox envelopes → vigilance filter. */
  const [escalation_map, set_escalation_map] = useState<Record<string, Set<number>>>({});

  // Operator desk (contract dm:agora--continuum#26-30, item 0017 — hub
  // half LIVE since 0.12.25): everything blocked on the operator, one hub
  // read. null = unavailable; the refusal string distinguishes an old hub
  // (404) from a non-operator viewer (403 — the desk is operator-or-
  // reporting-delegate only).
  type DeskView = { rows: Array<Record<string, unknown>>; satisfied: Array<Record<string, unknown>>; viewer?: string; computed_at?: number };
  const [desk_view, set_desk_view] = useState<DeskView | null | "loading">(null);
  const [desk_error, set_desk_error] = useState<string>("");
  /** Desk scope (operator ask 2026-08-20): the /desk READ is hub-wide (the
   *  route takes no channel), so this filters the view client-side. Default
   *  is the open channel — the drawer answers "what waits on me HERE" first
   *  and the header badge widens it to the whole hub in one click. */
  const [desk_scope, set_desk_scope] = useState<"channel" | "hub">("channel");
  /** The one scope test, shared by the drawer AND the tab badge — a count
   *  on the tab that disagreed with the list under it would be a lie. */
  function desk_in_scope(r: any): boolean {
    return desk_scope === "hub" || (!!selected && String(r?.channel || "") === selected);
  }
  /** Desk integration (laurent dm#64 via agora dm#33): the operator must
   *  not have to OPEN the drawer to know something waits. The badge poll
   *  rides refresh_badges on a ≥30s throttle (the desk is derived state
   *  hub-side — polite cadence); a 403/404 kills the poll for the session
   *  (non-operator seat / older hub — the state cannot change under us). */
  const desk_poll_at = useRef(0);
  const desk_poll_dead = useRef(false);
  const desk_auto_opened = useRef(false);
  async function poll_desk(): Promise<void> {
    if (desk_poll_dead.current) return;
    if (Date.now() - desk_poll_at.current < 30_000) return;
    desk_poll_at.current = Date.now();
    try {
      const view = await hub.desk();
      set_desk_view((cur) => (cur === "loading" ? cur : view));
      // Default surface (point 3, session-scoped): a non-empty desk opens
      // the drawer ONCE per console visit — "the human is the only seat
      // with no queue" must not hide behind a tab he has to remember. His
      // close is respected for the rest of the session; the badge carries
      // re-arrivals. The once-marker is set only when the open ACTUALLY
      // happens (wave adversary P2-2: consuming it while another drawer
      // was open silently spent the one auto-open on nothing).
      if (view.rows.length && !desk_auto_opened.current) {
        set_drawer((cur) => {
          if (cur !== "") return cur; // another drawer is open — respect it
          desk_auto_opened.current = true;
          return "desk";
        });
      }
    } catch (e: any) {
      // Only DEFINITIVE refusals kill the poll (403 wrong seat / 404 older
      // hub — states that cannot change mid-session). Transient failures
      // (5xx, timeout with no status) retry at the next cadence tick.
      if (e?.status === 403 || e?.status === 404) desk_poll_dead.current = true;
    }
  }
  async function load_desk(): Promise<void> {
    set_desk_view("loading");
    set_desk_error("");
    try {
      const view = await hub.desk();
      set_desk_view(view);
      desk_poll_at.current = Date.now();
      // A manual load succeeding proves the desk serves this session —
      // un-latch the poll (wave adversary P2-4: a hub upgrade or seat fix
      // mid-session left the badge frozen at the manual snapshot).
      desk_poll_dead.current = false;
    } catch (e: any) {
      set_desk_view(null);
      set_desk_error(
        e?.status === 403
          ? "The desk serves operators and reporting delegates only — this console's seat is neither."
          : e?.status === 404
            ? "The hub does not answer GET /desk (older hub build) — the amber \"needs reply\" pills on messages still mark what waits on you."
            : `The desk read failed (${String(e?.message || e || "network error").slice(0, 120)}) — transient; Refresh retries.`
      );
    }
  }
  const [selected, set_selected] = useState("");
  const [messages, set_messages] = useState<HubMessage[]>([]);
  const [filter, set_filter] = useState<TeamFilter>("all");
  /** Badge clicks stage their target filter here so the channel-switch
   *  reset (dm 99) applies the INTENDED filter instead of All. */
  const pending_filter = useRef<TeamFilter | null>(null);
  /** Unread seqs SNAPSHOT taken when the Unread filter is entered for a
   *  channel (operator dm 63): reading a message fires the ack and the
   *  LIVE unread set shrinks — without the snapshot the thread vanished
   *  from under the operator mid-read. The filter matches snapshot ∪
   *  live; leaving the filter (or switching channel) re-arms it. */
  const [unread_snapshot, set_unread_snapshot] = useState<Set<number> | null>(null);
  /** One backfill attempt per (channel, oldest-unread) per Unread-filter
   *  entry (dm-99 audit F5) — `${channel}:${min_seq}` when tried. */
  const backfill_attempted = useRef<string>("");
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(false);
  /** Thread panels deliberately folded by the reader in this channel view. */
  // Threads are FOLDED by default: a channel opens as a scannable list of
  // roots, and opening a trail is the reader's explicit act. The map holds
  // the threads the reader OPENED (absent = folded), so a thread stays open
  // across polls and new replies, and a channel switch resets to the list.
  const [open_threads, set_open_threads] = useState<Record<string, boolean>>({});
  const read_fired = useRef<Set<string>>(new Set());

  // CHANNEL GENERATION GUARD (adversary P1 cluster): every async
  // completion compares its captured generation against the current one
  // before writing shared state — a stale poll, verify verdict, summary,
  // or analyst answer from the PREVIOUS channel must never render under
  // the new channel's header (the verify case is a trust surface).
  const chan_gen = useRef(0);

  const [compose_text, set_compose_text] = useState("");
  const [compose_title, set_compose_title] = useState("");
  /** Optional protocol metadata is supplied verbatim to Agora Hub. It is
   * deliberately ephemeral: WUI relays it but never interprets or stores it. */
  const [compose_hub_data, set_compose_hub_data] = useState("");
  const [show_compose_hub_data, set_show_compose_hub_data] = useState(false);
  /** Pending attachments (agora 0091): uploaded blobs to ref on the next
   *  post. Cleared on send + channel switch. */
  const [pending_attachments, set_pending_attachments] = useState<HubAttachment[]>([]);
  const [attach_busy, set_attach_busy] = useState(false);
  const attach_input_ref = useRef<HTMLInputElement | null>(null);
  /** Drag-over highlight for the file drop zone (operator dm 41). */
  const [drag_over, set_drag_over] = useState(false);
  /** Composer kind (operator c2240: one dropdown — fyi / ask / dm; +
   *  "group" per operator dm 71). "ask" posts status=open (expects
   *  reply); "dm" sends a direct message; "group" creates a focused
   *  private room (title + invited members). */
  const [compose_kind, set_compose_kind] = useState<"fyi" | "ask" | "dm" | "group">("fyi");
  const [dm_peer, set_dm_peer] = useState("");
  /** Free-text member list for the group kind ("@entity @assistant"). */
  const [group_members_text, set_group_members_text] = useState("");
  /** Reply mode (adversary P0: a triage surface must be able to answer
   *  what it surfaces): target message + selected ask ids to discharge. */
  const [reply_to, set_reply_to] = useState<HubMessage | null>(null);
  const [reply_answers, set_reply_answers] = useState<Record<string, boolean>>({});
  /** Two-step confirms: a reply discharging nothing / an untitled open
   *  gets ONE inline nudge; the second Post proceeds (usability critic:
   *  the default reply outcome was mechanically void). */
  const [post_nudge, set_post_nudge] = useState("");
  /** Per-channel drafts — one global draft silently retargeted to the
   *  next channel (usability critic: wrong-room post hazard). PERSISTED to
   *  localStorage (operator dm 31 deal-breaker): a reload — a browser
   *  refresh, a crash, or (in dev) a hot-reload while I edit source — must
   *  never lose what the operator is typing. Hydrated once on mount. */
  const drafts = useRef<Record<string, { text: string; title: string; kind: "fyi" | "ask" | "dm" | "group" }>>(load_drafts());
  const prev_channel = useRef("");
  /** Citation hover preview (operator dm 21/22). A `#412` or `commons#412`
   *  in a message body renders as a chip; hovering it resolves the cited
   *  message and shows it in a card. `state` is explicit rather than
   *  inferred from `msg == null`: "still loading", "this seq does not
   *  exist" and "I could not reach that room" are three different answers
   *  and a preview that renders them identically is worse than no preview. */
  type CiteCard = {
    channel: string;
    seq: number;
    /** Viewport coords of the chip — the card anchors to it. */
    anchor: { left: number; top: number; bottom: number };
    state: "loading" | "found" | "missing" | "error";
    msg?: HubMessage;
    error?: string;
    /** THE THREAD's state, which is not the root's `status` word (operator
     *  dm 34: "you say you closed a message and on the mouseover we see it
     *  is still opened"). A root posted `open` KEEPS that word forever; what
     *  closes it is a `resolved` REPLY. So this is computed from the replies,
     *  and is `undefined` when they are not in hand — a cross-channel
     *  citation resolves one message and cannot see its trail, and rendering
     *  the posted word there is the very thing that misled him. */
    thread_state?: "open" | "resolved";
  };
  const [cite_card, set_cite_card] = useState<CiteCard | null>(null);
  /** Resolved citations, keyed `channel#seq`. A miss is cached as `null` —
   *  re-fetching a seq the hub already said does not exist, every time the
   *  pointer crosses it, is the obvious way to turn a preview into a
   *  request storm. */
  const cite_cache = useRef<Map<string, HubMessage | null>>(new Map());
  /** Rooms a `channel#seq` may name. Keyed on the sorted NAMES, not on the
   *  channel array: that array is rebuilt on every poll, so memoizing on it
   *  would hand MemoMarkdown a fresh Set every few seconds and re-parse
   *  every message body on screen — precisely the storm backlog 0010's memo
   *  boundary exists to stop. */
  const cite_channel_key = useMemo(() => channels.map((c) => String(c.name)).sort().join("\n"), [channels]);
  const cite_channels = useMemo<ReadonlySet<string>>(() => new Set(cite_channel_key ? cite_channel_key.split("\n") : []), [cite_channel_key]);
  /** The ceiling for a BARE `#N` (operator dm 48). A number, so it costs the
   *  memo boundary nothing: recomputing it every poll yields an equal value
   *  and MemoMarkdown compares props BY VALUE — unlike the Set above, which
   *  needed the string key.
   *
   *  Both sources are the hub's own: the rail's `last_seq` for the room, and
   *  the loaded window (which briefly runs AHEAD of the rail right after you
   *  post — take the max or your own new message stops chipping for a poll).
   *  Zero means "no ceiling yet", and passing 0 would silence every chip
   *  while the first window loads, so it is sent as undefined. */
  const cite_bare_max = useMemo(() => {
    let hi = Number(channels.find((c) => c.name === selected)?.last_seq) || 0;
    for (const m of messages) hi = Math.max(hi, Number(m.seq) || 0);
    return hi || undefined;
  }, [channels, selected, messages]);
  const [posting, set_posting] = useState(false);
  const [ack_busy, set_ack_busy] = useState(false);
  const [notice, set_notice] = useState("");
  const [copy_feedback, set_copy_feedback] = useState<{ id: string; status: "copied" | "failed" } | null>(null);
  const [speaking_message_id, set_speaking_message_id] = useState("");
  const speak_abort_ref = useRef<AbortController | null>(null);
  useEffect(() => () => {
    speak_abort_ref.current?.abort();
    speak_abort_ref.current = null;
  }, []);
  useEffect(() => {
    speak_abort_ref.current?.abort();
    speak_abort_ref.current = null;
    set_speaking_message_id("");
  }, [selected]);

  // Verify-transcript state, per selected channel (cleared on switch).
  const [verify_state, set_verify_state] = useState<null | "running" | LedgerVerdict | { error: string }>(null);

  // Channel about/charter/members — fetched when the Members drawer opens.
  const [info, set_info] = useState<HubChannelInfo | "loading" | { error: string } | null>(null);
  /** Session-scoped invites awaiting join (operator dm 128): a SENT invite
   *  renders as "invited — awaiting join" in the Members drawer, so it is
   *  distinguishable from a failed one. CONSUMED on observed join
   *  (adversary P1-1: filter-forever resurrected "awaiting join" for an
   *  agent who joined then left — a standing falsehood). */
  const [invited_pending, set_invited_pending] = useState<Record<string, Set<string>>>({});
  /** Add peers to a channel's awaiting-join set. */
  function add_invited_pending(channel: string, peers: string[]): void {
    if (!peers.length) return;
    set_invited_pending((cur) => {
      const next = { ...cur };
      const s = new Set(next[channel] || []);
      for (const p of peers) s.add(p);
      next[channel] = s;
      return next;
    });
  }
  /** Consume pending facts for ids observed as MEMBERS (the join happened;
   *  a later leave must not resurrect the invite row). */
  function consume_invited_pending(channel: string, member_rows: Array<{ agent_id?: string }>): void {
    const present = new Set(member_rows.map((m) => String(m.agent_id || "")).filter(Boolean));
    if (!present.size) return;
    set_invited_pending((cur) => {
      const s = cur[channel];
      if (!s || ![...s].some((id) => present.has(id))) return cur;
      const next_set = new Set([...s].filter((id) => !present.has(id)));
      const next = { ...cur };
      if (next_set.size) next[channel] = next_set;
      else delete next[channel];
      return next;
    });
  }
  /** Highest hub membership-notice seq already folded into the members
   *  list (join/leave notices trigger a live refresh while the drawer is
   *  open — the dm-128 staleness class). */
  const member_note_seq = useRef(0);
  /** Members fetch failure (adversary P2-2): an empty list on FAILURE must
   *  never read as "nobody is here". */
  const [members_error, set_members_error] = useState("");
  // Hub delegation (operator dm 154): null = loading/unavailable; the
  // list is hub-wide (served by GET /delegations, public by design).
  const [delegations, set_delegations] = useState<Array<Record<string, any>> | null>(null);
  const [delegation_error, set_delegation_error] = useState("");
  const [delegation_busy, set_delegation_busy] = useState(false);
  const [delegate_pick, set_delegate_pick] = useState("");
  const [delegate_powers, set_delegate_powers] = useState<string[]>([]);
  /** Hub-wide standing missions for the Members roster. A refusal (the hub
   *  gates the LIST to operator seats) leaves the map null — rows simply
   *  show no mission line; the editor still offers, and the hub's refusal
   *  of the write renders verbatim. */
  function load_missions(): void {
    hub
      .missions()
      .then((rows) => set_missions_map(Object.fromEntries(rows.map((r) => [String(r.agent_id || ""), String(r.mission || "")]))))
      .catch(() => set_missions_map(null));
  }

  /** Set one agent's standing mission (PUT /admin/agents/{id}/mission). */
  async function save_mission(agent_id: string): Promise<void> {
    set_mission_busy(true);
    set_mission_error("");
    try {
      const mission = mission_draft.trim();
      await hub.set_mission(agent_id, mission);
      set_missions_map((cur) => ({ ...(cur || {}), [agent_id]: mission }));
      set_mission_edit("");
    } catch (e: any) {
      set_mission_error(String(e?.message || e || "mission update failed"));
    } finally {
      set_mission_busy(false);
    }
  }

  /** Refetch the hub-wide roster from presence. `exclude` is the viewer's own
   *  seat — passed in rather than read from state because the boot call runs
   *  inside the same handler that discovers it, before the state lands. */
  function load_roster(exclude: string): void {
    void hub
      .presence()
      .then((rows) => {
        const ids = [...new Set(rows.map((r) => String(r.agent_id || "")).filter((id) => id && id !== exclude))].sort();
        set_roster(ids);
      })
      .catch(() => set_roster([]));
  }

  function load_delegations(): void {
    hub
      .delegations()
      .then((rows) => {
        set_delegations(rows);
        set_delegation_error("");
      })
      .catch((e: any) => {
        set_delegations([]);
        const msg = String(e?.message || e);
        set_delegation_error(
          e?.status === 404 || /allowlist/i.test(msg)
            ? "Delegation needs the updated console/hub — restart the stack to pick it up."
            : msg
        );
      });
  }
  async function assign_delegate(): Promise<void> {
    if (!delegate_pick || !delegate_powers.length || delegation_busy) return;
    set_delegation_busy(true);
    set_delegation_error("");
    try {
      await hub.set_delegation(delegate_pick, delegate_powers);
      set_delegate_pick("");
      set_delegate_powers([]);
      load_delegations();
    } catch (e: any) {
      set_delegation_error(String(e?.message || e || "delegation failed"));
    } finally {
      set_delegation_busy(false);
    }
  }
  async function resign_delegate(agent_id: string): Promise<void> {
    if (delegation_busy) return;
    set_delegation_busy(true);
    set_delegation_error("");
    try {
      await hub.revoke_delegation(agent_id);
      load_delegations();
    } catch (e: any) {
      set_delegation_error(String(e?.message || e || "resign failed"));
    } finally {
      set_delegation_busy(false);
    }
  }
  /** Members roster (About pane; operator c2240) + moderation state. */
  const [members, set_members] = useState<Array<{ agent_id?: string; about?: string; mission?: string; role?: string }> | null>(null);
  /** Active kick/ban rows for the channel — the moderation UNDO surface
   *  (a block removes the member row hub-side, so undo needs its own
   *  list; adversary P1). */
  const [blocked, set_blocked] = useState<Array<Record<string, unknown>> | null>(null);
  /** Two-step ban confirm (armed action id, e.g. "ban:core"). */
  const [mod_nudge, set_mod_nudge] = useState("");
  /** Retired agents (hub-wide; agora 0.12.0 GET /agents/retired) — the
   *  un-retire candidate list, operator-only (empty for non-operators). */
  const [retired, set_retired] = useState<Array<{ id?: string; reason?: string; retired_at?: number }> | null>(null);
  /** Hub-wide roster (presence: connected or not) — the DM recipient
   *  dropdown source (operator dm 9: a real dropdown, never a text field)
   *  and the Members-drawer invite picker.
   *
   *  Refetched, not just seeded at boot (operator dm 3): a seat that
   *  registers after the page loads is on the hub but absent from every
   *  list built from this, and the only cure was a full reload. Presence is
   *  the one source here that grows without any action by this client — the
   *  member rows change when YOU act, so they were already reloaded on open
   *  and this was not. */
  const [roster, set_roster] = useState<string[]>([]);
  const [mod_busy, set_mod_busy] = useState("");
  const [mod_error, set_mod_error] = useState("");
  /** Invite-to-channel control (operator dm 79). */
  const [invite_peer, set_invite_peer] = useState("");
  const [invite_busy, set_invite_busy] = useState(false);
  const [invite_notice, set_invite_notice] = useState("");
  /** Channel admin (create / close / reopen) — hub enforces authority. */
  const [new_channel_form, set_new_channel_form] = useState<{ open: boolean; name: string; is_private: boolean }>({ open: false, name: "", is_private: false });
  /** Joining: a room you were invited to does not arrive by itself. The hub
   *  mints a single-use token and DMs it; membership starts when the seat
   *  redeems it. Without this form an invited seat could read the invitation
   *  and had no way to act on it. */
  const [join_form, set_join_form] = useState<{ open: boolean; channel: string; token: string }>({ open: false, channel: "", token: "" });
  const [chan_admin_busy, set_chan_admin_busy] = useState(false);

  // Per-thread LLM summaries (root id → state). Session-only.
  const [summaries, set_summaries] = useState<Record<string, { busy: boolean; text: string; error: string; count: number }>>({});

  // Right-edge drawers (operator dm 53): Assistant + Files live behind two
  // always-visible vertical trapeze tabs; one drawer open at a time. The
  // header "Ask AI"/paperclip buttons they replace were "too discreet".
  const [drawer, set_drawer] = useState<"" | "assistant" | "members" | "files" | "leaderboard" | "desk">("");

  // Reputation leaderboard drawer (operator dm 12; agora 0094). Scope
  // toggles between the selected channel's board and the hub-wide sum;
  // expanding a row loads the attributed votes behind that score (the WHY
  // surface) and offers the operator's own ±1 per axis.
  const [board, set_board] = useState<HubReputationBoard | null>(null);
  const [board_error, set_board_error] = useState("");
  const [board_scope, set_board_scope] = useState<"channel" | "hub">("channel");
  const [board_open, set_board_open] = useState("");
  const [board_votes, set_board_votes] = useState<HubReputationVote[] | null>(null);
  const [vote_note, set_vote_note] = useState("");
  const [vote_busy, set_vote_busy] = useState("");
  const [vote_error, set_vote_error] = useState("");

  // Agent-level trust voting (my_stance / vote_on_author / downvote_nudge /
  // stance hydration) REMOVED with the members-tab thumbs (operator dm
  // 164). Reputation now flows from message ratings + the Leaderboard's
  // category-opinion casting (which manages its own board state); nothing
  // renders a per-author stance in the roster anymore.

  // Channel virtual file system (vfs) browser (operator dm 35/53) + shared file
  // viewer (also used by attachment previews). fs list is per-channel;
  // fs_cwd is the Drive-style folder position inside the flat namespace.
  const [files, set_files] = useState<HubFsEntry[] | null>(null);
  const [files_error, set_files_error] = useState("");
  const [fs_cwd, set_fs_cwd] = useState("");
  // New-file flow (operator ask 2026-08-19): path input in the Files drawer,
  // then the shared editor; the write is create-only (expect_version 0).
  const [show_new_fs, set_show_new_fs] = useState(false);
  const [new_fs_path, set_new_fs_path] = useState("");
  // One transient toast (operator ask 2026-08-19: cap warnings must be
  // impossible to miss). One slot, newest wins, self-clears.
  const [toast, set_toast] = useState("");
  const toast_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function show_toast(text: string): void {
    set_toast(text);
    if (toast_timer.current) clearTimeout(toast_timer.current);
    toast_timer.current = setTimeout(() => set_toast(""), 6000);
  }
  // Deposit queue (operator ask 2026-08-19): drag & drop into the Files
  // drawer writes through the hub's versioned fs PUT — text as `content`,
  // binary as `content_b64` (hubs without the binary upgrade refuse it,
  // verbatim). Each row tracks its own outcome; "exists" offers Replace.
  const [fs_uploads, set_fs_uploads] = useState<Array<{ path: string; size: number; state: "busy" | "done" | "exists" | "error"; error?: string; file?: File }>>([]);
  // Armed vfs deletion (operator ask 2026-08-19): an IN-APP confirm modal —
  // deletion is channel-visible state agents may already rely on, so it
  // never rides a bare click or a browser confirm().
  const [fs_del, set_fs_del] = useState<{ entry: HubFsEntry; busy: boolean; error: string } | null>(null);
  const [fs_drop_active, set_fs_drop_active] = useState(false);
  // Standing missions (operator ask 2026-08-19): hub-wide seat facts served
  // by /admin/missions. null = not loaded or the hub refused (non-operator);
  // the editor is still offered — the hub authorizes the WRITE, verbatim.
  const [missions_map, set_missions_map] = useState<Record<string, string> | null>(null);
  const [mission_edit, set_mission_edit] = useState("");
  const [mission_draft, set_mission_draft] = useState("");
  const [mission_busy, set_mission_busy] = useState(false);
  const [mission_error, set_mission_error] = useState("");
  const [file_view, set_file_view] = useState<FileView | null>(null);

  // Every authenticated attachment preview is a temporary blob URL. Release
  // it as soon as the viewer changes or closes; nothing becomes a WUI cache.
  useEffect(() => {
    const url = file_view?.url;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [file_view?.url]);

  // Channel assistant (LLM over the current channel window).
  const [ai_thread, set_ai_thread] = useState<TeamAiTurn[]>([]);
  const [ai_question, set_ai_question] = useState("");
  const [ai_busy, set_ai_busy] = useState(false);
  const [ai_error, set_ai_error] = useState("");

  const list_ref = useRef<HTMLDivElement | null>(null);
  const poll_count = useRef(0);
  const bg_refresh_inflight = useRef(false);
  const seq_probe_at = useRef(0);
  /** Live socket state (operator c2240: realtime, not 5s polling). The
   *  poll stays as the guaranteed lane; the socket makes updates instant
   *  and the dot tells the operator which lane is live. */
  const [live, set_live] = useState(false);
  const selected_ref = useRef("");
  const channels_ref = useRef<HubChannel[]>([]);
  const messages_ref = useRef<HubMessage[]>([]);
  /** Session-only delivery cursors.  They are deliberately derived only
   * from rows/envelopes this tab has actually received — never from a Hub
   * channel's advertised last_seq, which would falsely claim a missed row
   * had already been seen. */
  const live_cursors_ref = useRef<Record<string, number>>({});
  const live_socket_ref = useRef<WebSocket | null>(null);
  /** One subscribe frame per distinct member/cursor snapshot per socket.
   * Re-sending after a cursor advances is harmless (the Hub deduplicates
   * channel subscribers) and makes a just-refreshed REST tail the next
   * reconnect floor. */
  const live_subscription_ref = useRef("");
  const badge_debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badge_refresh_inflight = useRef(false);
  const badge_refresh_queued = useRef<HubChannel[] | null>(null);
  selected_ref.current = selected;
  channels_ref.current = channels;
  messages_ref.current = messages;

  /** A REST page is an authoritative local snapshot. Its highest row is a
   * safe reconnect floor even when the tab deliberately loaded only a tail. */
  function remember_rest_cursor(channel: string, seq?: number): void {
    const cursor = Number(seq || 0);
    if (!channel || !Number.isFinite(cursor) || cursor <= 0) return;
    live_cursors_ref.current[channel] = Math.max(live_cursors_ref.current[channel] || 0, cursor);
  }

  /** Advance only a contiguous live stream. If a bounded Hub queue skipped a
   * row, keep the last contiguous cursor and reconnect: the native Hub then
   * replays the missing range from that cursor before returning to live. */
  function remember_live_cursor(channel: string, seq?: number): void {
    const cursor = Number(seq || 0);
    if (!channel || !Number.isFinite(cursor) || cursor <= 0) return;
    const known = live_cursors_ref.current[channel];
    if (known === undefined) {
      // Cold starts obtain unread truth from /inbox; this is the first live
      // floor for a channel whose message window was never opened.
      live_cursors_ref.current[channel] = cursor;
      return;
    }
    if (cursor <= known) return; // duplicate delivery is permitted by contract
    if (cursor === known + 1) {
      live_cursors_ref.current[channel] = cursor;
      return;
    }
    // Do NOT skip the hole. The hub deduplicates already-delivered frames on
    // one socket, so close deliberately and let the reconnect's `since`
    // cursor recover the complete missing range on a fresh delivery pump.
    try {
      live_socket_ref.current?.close();
    } catch {
      // The normal reconnect lane handles a concurrent close.
    }
  }

  /**
   * Agora's native WS contract is a member-channel subscription plus the
   * rows this tab has already received. Cold-start unread state still comes
   * from the authoritative /inbox sweep; cursors make reconnects recover
   * every live gap without inventing a WUI persistence layer or server.
   */
  function subscribe_live_socket(): void {
    const socket = live_socket_ref.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const channel_names = channels_ref.current.filter((channel) => channel.member).map((channel) => channel.name).sort();
    if (!channel_names.length) return;
    const since: Record<string, number> = {};
    for (const channel of channel_names) {
      const cursor = live_cursors_ref.current[channel];
      if (typeof cursor === "number" && cursor >= 0) since[channel] = cursor;
    }
    const frame = { type: "subscribe", channels: channel_names, since };
    const signature = JSON.stringify(frame);
    if (signature === live_subscription_ref.current) return;
    try {
      socket.send(signature);
      live_subscription_ref.current = signature;
    } catch {
      // A close can race the readyState check. The reconnect loop below
      // retries from the same durable-in-tab cursor snapshot.
    }
  }
  // Sweep caught-up optimistic ratings AFTER render (render purity —
  // adversary P2-6): once a served row carries the seat's local statement,
  // the optimistic entry must clear so later EXTERNAL changes (e.g. the
  // same seat in another window) win the render.
  useEffect(() => {
    for (const m of messages) {
      const local = local_rating.current[m.id];
      if (local !== undefined && m.ratings && Number(m.ratings.mine || 0) === local) {
        delete local_rating.current[m.id];
      }
    }
  }, [messages]);
  /** Set when the channel just changed — the next successful fetch snaps
   *  the scroll to the bottom (channel opens used to land at the OLDEST
   *  message; adversary find). */
  const scroll_pending = useRef(false);

  /** Read an `/owed` report into the two pieces of state it decides: which
   *  messages wear "needs reply", and which ask ids are THIS seat's on each
   *  of them. One parse, so a targeted refresh and the badge cadence can
   *  never disagree about the same report. */
  function apply_owed(report: any): void {
    const rows = report?.to_answer || [];
    const next: Record<string, Set<number>> = {};
    const next_asks: Record<string, Record<number, string[]>> = {};
    for (const row of rows) {
      const channel = String(row?.channel || "");
      const seq = Number(row?.seq);
      if (!channel || !Number.isFinite(seq)) continue;
      (next[channel] ||= new Set()).add(seq);
      // Three distinct states, and flattening any two of them breaks
      // Decline (the repo's usual null-means-no-statement rule):
      //   present + non-empty -> these ask ids are this seat's;
      //   present + EMPTY     -> the hub says NONE here are — it keeps a
      //     to_answer row whenever the seat is in `to`, whether or not any
      //     ask names it per-ask, so this is a real answer, and the right
      //     discharge is a plain reply carrying no discharge field;
      //   ABSENT              -> a hub too old to serve the field made no
      //     statement, so fall back to the message's global set.
      // Collapsing empty into absent sent Decline back to the global set
      // and into the "may not discharge ask ids not addressed to you" 400.
      if (Array.isArray(row?.asks_naming_you)) {
        (next_asks[channel] ||= {})[seq] = row.asks_naming_you.map(String).filter(Boolean);
      }
    }
    // Asker side. Same report, same parse — the two halves of a decline
    // must never be read from two places that can disagree.
    const next_close: Record<string, Record<number, { declined_asks: string[]; declined_by: string[]; answered_by: string }>> = {};
    for (const row of report?.to_close || []) {
      const channel = String(row?.channel || "");
      const seq = Number(row?.seq);
      if (!channel || !Number.isFinite(seq)) continue;
      (next_close[channel] ||= {})[seq] = {
        declined_asks: Array.isArray(row?.declined_asks) ? row.declined_asks.map(String) : [],
        declined_by: Array.isArray(row?.declined_by) ? row.declined_by.map(String) : [],
        answered_by: String(row?.answered_by || ""),
      };
    }
    // Charter debts (hub 0146/2) ride the same report — one parse, so the
    // strip and the gate refusal can never describe different state.
    const next_charters: HubCharterDebt[] = [];
    for (const row of report?.charters || []) {
      const scope = String((row as any)?.scope || "");
      if (!scope) continue;
      next_charters.push({
        scope,
        version: Number((row as any)?.version || 0),
        your_receipt: typeof (row as any)?.your_receipt === "number" ? (row as any).your_receipt : null,
        read_with: String((row as any)?.read_with || ""),
        gated: Boolean((row as any)?.gated),
        reason: String((row as any)?.reason || ""),
      });
    }
    set_debt_map((cur) => (same_unread(cur, next) ? cur : next));
    set_owed_asks((cur) => (JSON.stringify(cur) === JSON.stringify(next_asks) ? cur : next_asks));
    set_close_map((cur) => (JSON.stringify(cur) === JSON.stringify(next_close) ? cur : next_close));
    set_charter_debts((cur) => (JSON.stringify(cur) === JSON.stringify(next_charters) ? cur : next_charters));
  }

  /** Re-read `/owed` right now. The debt surface otherwise refreshes only on
   *  the badge cadence (30s), which is why an act that discharges something
   *  left its pill standing long enough to read as broken. This asks the
   *  hub for its verdict instead of predicting it — the console has no way
   *  to know whether a given closure was authoritative. */
  async function refresh_owed(): Promise<void> {
    try {
      apply_owed(await hub.owed());
    } catch {
      // Older hub, or /owed refused. The badge cadence keeps its envelope
      // fallback; a failed targeted refresh must never wipe what it has.
    }
  }

  async function refresh_badges_once(chans: HubChannel[]): Promise<void> {
    try {
      const inbox = await hub.inbox();
      // Own-seat envelopes never count as unread (you wrote them); the
      // seat gates it so a pre-identity poll cannot silently drop rows.
      const seat_id = meta_ref.current?.seat || "";
      const unread = unread_by_channel(inbox as Array<{ channel?: string; sender?: string }>, seat_id);
      const next_unread = unread_seqs_by_channel(inbox as Array<{ channel?: string; seq?: number; sender?: string }>, seat_id);
      set_unread_map((cur) => (same_unread(cur, next_unread) ? cur : next_unread));
      // Sticky debts (dm 111): rendered differently from plain unread —
      // clicking cannot clear them, only answering can.
      //
      // THE HUB DECIDES WHAT YOU OWE. `/owed.to_answer` is its computed
      // verdict; re-deriving debt from envelope shape here produced
      // obligations the hub does not hold — notably a peer's reply to
      // YOUR OWN message, which the hub exempts ("your debt for an answer
      // is consumption, not another reply") but a `status=reply && to_me`
      // rule cannot see. The envelope derivation remains only as the
      // fallback for hubs that do not serve /owed.
      void hub
        .owed()
        .then(apply_owed)
        .catch(() => {
          // Older hub, or /owed refused: fall back to the envelope shape.
          const next_debts = debt_seqs_by_channel(inbox as any, meta_ref.current?.seat || "");
          set_debt_map((cur) => (same_unread(cur, next_debts) ? cur : next_debts));
          // The envelope carries no per-ask subsets. Dropping them keeps the
          // two maps from disagreeing — a stale subset from an earlier /owed
          // read would otherwise outlive the verdict that produced it.
          set_owed_asks((cur) => (Object.keys(cur).length ? {} : cur));
          set_close_map((cur) => (Object.keys(cur).length ? {} : cur));
          // Same rule for charter debts: only /owed states them, so a report
          // that never arrived leaves the console with nothing to say.
          set_charter_debts((cur) => (cur.length ? [] : cur));
        });
      const next_to_me = to_me_seqs_by_channel(inbox as any, meta_ref.current?.seat || "");
      set_to_me_map((cur) => (same_unread(cur, next_to_me) ? cur : next_to_me));
      const next_escalated = escalated_seqs_by_channel(inbox as any);
      set_escalation_map((cur) => (same_unread(cur, next_escalated) ? cur : next_escalated));
      // Desk badge rides the badge cadence, self-throttled to ≥30s.
      void poll_desk();
      // Open-question counts ride the digest — bounded to the first N
      // channels by recency (badge freshness, not an N-call storm).
      const targets = chans.slice(0, BADGE_DIGEST_LIMIT);
      const digests = await Promise.allSettled(targets.map((c) => hub.digest(c.name)));
      const next: Record<string, ChannelBadges> = {};
      for (const c of chans) next[c.name] = { unread: unread[c.name] || 0, open_questions: 0 };
      digests.forEach((d, i) => {
        const name = targets[i].name;
        if (d.status === "fulfilled") {
          const counts = (d.value as any)?.counts;
          next[name] = { ...next[name], open_questions: Number(counts?.open_questions || 0) };
        }
      });
      set_badges((cur) => (same_json(cur, next) ? cur : next));
    } catch {
      // Badges are decoration — their failure never blocks the thread view.
    }
  }

  async function refresh_badges(chans: HubChannel[]): Promise<void> {
    // One live fan-out at a time (connection-pool discipline): a pending
    // inbox+digest sweep used to overlap with the next 30s tick or a burst
    // of websocket nudges, multiplying hub reads right when the operator
    // was trying to open a channel. Coalesce to the latest channel list.
    if (badge_refresh_inflight.current) {
      badge_refresh_queued.current = chans;
      return;
    }
    badge_refresh_inflight.current = true;
    let next: HubChannel[] | null = chans;
    try {
      while (next) {
        badge_refresh_queued.current = null;
        await refresh_badges_once(next);
        next = badge_refresh_queued.current;
      }
    } finally {
      badge_refresh_inflight.current = false;
    }
  }

  /** Fetch + install the channel list alone (no meta/presence/badges) —
   *  the cheap freshness primitive the window math and poll lane ride. */
  async function refresh_channel_list(): Promise<HubChannel[]> {
    const chans = await hub.channels();
    // /channels includes public rooms the current seat has not joined.
    // The Team surface can only read a member channel, so keep the rail and
    // every automatic selection membership-scoped.
    const all = chans.filter((channel) => channel.member);
    all.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    // Identity-preserving install (adversary F8): the rail refresh fires
    // every 6th poll — an unchanged list must not re-render the page.
    set_channels((cur) => (same_json(cur, all) ? cur : all));
    channels_ref.current = all;
    subscribe_live_socket();
    return all;
  }

  async function refresh_channels(): Promise<void> {
    try {
      const [m, chans] = await Promise.all([hub.meta(), hub.channels()]);
      set_meta({
        seat: m.seat,
        seat_key_present: m.seat_key_present,
        operator: Boolean(m.operator),
        mission: String(m.mission || ""),
        hub_charter: m.hub_charter || null,
      });
      set_hub_url(String(m.hub_url || ""));
      void hub
        .healthz()
        .then((h) => set_health(h))
        .catch(() => set_health(null));
      // DM recipient roster: every agent sharing a channel with the seat,
      // connected or not (presence carries the full visible roster).
      load_roster(String(m.seat || ""));
      // DMs are first-class since the operator's c2240 directive (his own
      // seat, his own console — the earlier dm-exclusion protected agent
      // surfaces; his call supersedes it here). The rail renders them as
      // their own section.
      // Public discovery is Hub-owned; this thin client must not select an
      // unreadable discovery row and then manufacture a red fetch failure.
      const all = chans.filter((channel) => channel.member);
      all.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
      set_channels(all);
      channels_ref.current = all;
      // Initial loads often complete after the browser socket opened. Keep
      // the first subscribe tied to the authoritative member snapshot, not
      // a render-timing accident.
      subscribe_live_socket();
      const open = all.filter((c) => !c.name.startsWith("dm:"));
      const fallback = open[0] || all[0];
      set_selected((current) => {
        if (current && all.some((channel) => channel.name === current)) return current;
        return fallback?.name || "";
      });
      set_error("");
      void refresh_badges(all);
    } catch (e: any) {
      set_error(String(e?.message || e || "Hub unreachable"));
      // An auth refusal on /whoami is the missing/invalid-key case — feed
      // the dedicated banner instead of leaving meta null (which kept the
      // diagnostic unreachable on every path; adjudication A2).
      const status = Number(e?.status || 0);
      if (status === 401 || status === 403) set_meta({ seat: "", seat_key_present: false, operator: false, mission: "", hub_charter: null });
    }
  }

  async function refresh_messages(channel: string, opts?: { background?: boolean }): Promise<void> {
    if (!channel) return;
    const gen = chan_gen.current;
    if (!opts?.background) set_loading(true);
    try {
      // THE WINDOW IS THE NEWEST MESSAGES. The hub serves seq > since
      // oldest-first with a LIMIT — since:0 on a 2,000-message channel
      // returned the OLDEST 200 (operator: "all messages are at least 5d
      // old"). Open = floor from the channel's known last_seq; background
      // = tail-append from the highest seq already in state.
      //
      const cur_max = messages_ref.current.length ? messages_ref.current[messages_ref.current.length - 1].seq || 0 : 0;
      const cached_known_last = channels_ref.current.find((c) => c.name === channel)?.last_seq || 0;
      let known_last = cached_known_last;
      let rail_refresh: Promise<HubChannel[] | null> | null = null;
      if (!opts?.background) {
        // Foreground opens must not block on a slow rail refresh when the
        // rail already knows the channel's last_seq. Fire the refresh in
        // parallel, render from the cached floor immediately, then correct
        // with one follow-up fetch if the fresh rail moved. Only the "no
        // cached last_seq at all" case still waits for the rail first.
        if (cached_known_last > 0) {
          rail_refresh = refresh_channel_list().catch(() => null);
        } else {
          try {
            const all = await refresh_channel_list();
            if (gen !== chan_gen.current) return;
            known_last = all.find((c) => c.name === channel)?.last_seq || 0;
          } catch {
            // Rail snapshot stays; the floor is best-effort on hub hiccups.
          }
        }
      }
      const window_floor = Math.max(0, known_last - PAGE_LIMIT);
      // Background polls OVERLAP the loaded tail (adversary C F2): rows
      // are immutable but their DECORATIONS live (ratings tallies,
      // pending_asks discharge, retraction) — re-serving the last
      // RATING_REFRESH_TAIL rows lets the merge refresh what changed.
      // since=cur_max alone meant a loaded row's tally never moved until
      // channel re-select. 150 rows of headroom per 5s poll remains for
      // genuinely new traffic.
      const since = opts?.background && cur_max > 0 ? Math.max(0, cur_max - RATING_REFRESH_TAIL) : window_floor;
      const list = await hub.messages(channel, { since, limit: PAGE_LIMIT });
      if (gen !== chan_gen.current) return; // stale channel — drop silently
      // SEQ-REGRESSION PROBE (adversarial F1, dm 99): if the hub's seqs
      // ever restart LOWER (db swap/restore, wrong-cwd relaunch), a
      // background poll asking past the old high seq yields nothing NEW,
      // forever — frozen pane under live badges until relaunch. With the
      // F2 tail overlap the fetch is rarely EMPTY, so the tell is "no
      // unseen rows" (equivalent to the old empty-fetch condition):
      // re-check the rail (throttled) and when the fresh last_seq sits
      // BELOW our cursor, seqs went backwards — reload the window from
      // the fresh floor and REPLACE state.
      const seen_ids = new Set(messages_ref.current.map((m) => m.id));
      const has_unseen = list.some((m) => !seen_ids.has(m.id));
      if (opts?.background && !has_unseen && cur_max > 0) {
        const now = Date.now();
        if (now - seq_probe_at.current > 10_000) {
          seq_probe_at.current = now;
          try {
            const all = await refresh_channel_list();
            if (gen !== chan_gen.current) return;
            const fresh_last = all.find((c) => c.name === channel)?.last_seq || 0;
            if (fresh_last > 0 && fresh_last < cur_max) {
              const floor = Math.max(0, fresh_last - PAGE_LIMIT);
              const reloaded = await hub.messages(channel, { since: floor, limit: PAGE_LIMIT });
              if (gen !== chan_gen.current) return;
              reloaded.sort((a, b) => (a.seq || 0) - (b.seq || 0));
              // This is a new Hub sequence life, not a missed live gap.
              // Replace rather than max so a later reconnect does not claim
              // the pre-restore cursor is still valid.
              live_cursors_ref.current[channel] = reloaded.length ? Number(reloaded[reloaded.length - 1].seq || 0) : 0;
              subscribe_live_socket();
              set_messages(reloaded); // replace: the old window's seqs are from another life
              set_error("");
              return;
            }
          } catch {
            // Probe is best-effort; the normal poll keeps trying.
          }
        }
      }
      list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      remember_rest_cursor(channel, list[list.length - 1]?.seq);
      subscribe_live_socket();
      set_messages((cur) => {
        if (opts?.background && cur.length) {
          if (!list.length) return cur; // nothing new — zero re-render
          const seen = new Set(cur.map((m) => m.id));
          const fresh = list.filter((m) => !seen.has(m.id));
          // Decoration refresh on SEEN rows (adversary C F2): the merge
          // used to keep old row objects forever, so another rater's ±1
          // (or the hub's confirmation of my own) never reached a loaded
          // row until channel re-select — the caught-up sweep could never
          // fire. Swap in the re-served row when live fields moved;
          // identity is preserved for unchanged rows (zero re-render when
          // nothing changed).
          const by_id = new Map(list.map((m) => [m.id, m]));
          let touched = 0;
          const refreshed = cur.map((m) => {
            const next = by_id.get(m.id);
            if (!next) return m;
            const changed =
              JSON.stringify(next.ratings ?? null) !== JSON.stringify(m.ratings ?? null) ||
              (next.has_resolved_reply ?? null) !== (m.has_resolved_reply ?? null) ||
              // `closed`/`closed_by` are live discharge decorations too. Left
              // out, a thread closing would re-serve a row this merge calls
              // unchanged, and the chip would not move until a reload.
              (next.closed ?? null) !== (m.closed ?? null) ||
              (next.closed_by ?? null) !== (m.closed_by ?? null) ||
              JSON.stringify(next.pending_asks ?? null) !== JSON.stringify(m.pending_asks ?? null) ||
              Boolean(next.retracted) !== Boolean(m.retracted);
            if (changed) touched++;
            return changed ? next : m;
          });
          if (!fresh.length && !touched) return cur;
          const merged = [...(touched ? refreshed : cur), ...fresh];
          // Cap the in-memory window (oldest drop) — the operator reads
          // the tail; deep history is the ledger's job.
          return merged.length > PAGE_LIMIT * 2 ? merged.slice(merged.length - PAGE_LIMIT * 2) : merged;
        }
        return list;
      });
      set_error("");
      if (!opts?.background && rail_refresh) {
        // Keep the rail correction detached from the foreground loading
        // state: the fast-path render is already on screen, so a slow
        // /channels refresh must not leave the pane looking hung.
        void (async () => {
          try {
            const all = await rail_refresh;
            if (gen !== chan_gen.current || !all) return;
            const fresh_last = all.find((c) => c.name === channel)?.last_seq || 0;
            // Any drift changes the served window: seq > since is oldest-first
            // with a hard limit, so even +1 new row can push the newest row out
            // of the cached slice. Re-read once from the fresh floor.
            if (fresh_last > 0 && fresh_last !== cached_known_last) {
              const fresh_floor = Math.max(0, fresh_last - PAGE_LIMIT);
              const refreshed = await hub.messages(channel, { since: fresh_floor, limit: PAGE_LIMIT });
              if (gen !== chan_gen.current) return;
              refreshed.sort((a, b) => (a.seq || 0) - (b.seq || 0));
              remember_rest_cursor(channel, refreshed[refreshed.length - 1]?.seq);
              subscribe_live_socket();
              set_messages((cur) => (same_json(cur, refreshed) ? cur : refreshed));
            }
          } catch {
            // The fast-path render already landed; rail reconciliation is best-effort.
          }
        })();
      }
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_error(String(e?.message || e || "Failed to load messages"));
    } finally {
      if (!opts?.background && gen === chan_gen.current) set_loading(false);
    }
  }

  useEffect(() => {
    void refresh_channels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser WebSocket cannot set Authorization. HubClient therefore uses the
  // Agora-native /ws?token=KEY lane from the in-memory existing seat key.
  // Every connection sends the documented member-channel subscribe frame;
  // polling remains the complete fallback if the socket is unavailable.
  useEffect(() => {
    const socket_url = hub.ws_url();
    if (!socket_url) {
      set_live(false);
      return;
    }
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let open_at = 0; // when the current socket opened; 0 = not open
    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(socket_url);
      } catch {
        // F8 (dm-99 tail): a synchronous constructor failure must re-arm
        // the retry loop like any other socket death — returning without
        // scheduling left the page polling-only until relaunch.
        set_live(false);
        retry += 1;
        setTimeout(connect, Math.min(15_000, 1000 * Math.max(1, retry)));
        return;
      }
      ws.onopen = () => {
        live_socket_ref.current = ws;
        // A fresh WebSocket has no server-side subscription state. Its first
        // frame must restore every member channel from this tab's cursors.
        live_subscription_ref.current = "";
        set_live(true);
        open_at = Date.now();
        subscribe_live_socket();
        // Mount-during-outage heal (adversarial F4, dm 99): if the initial
        // channel/meta load failed while the hub was down, the socket
        // connecting IS the "hub is back" signal — reload instead of
        // leaving a dead rail + misleading read-only composer until
        // relaunch.
        if (!channels_ref.current.length || !meta_ref.current) void refresh_channels();
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(String(ev.data || "{}"));
          // A successful subscribe is a protocol control receipt. There is
          // no WUI collaboration state to fabricate from it; backlog and
          // live rows arrive as the authoritative envelope frames below.
          if (frame?.type === "subscribed") return;
          if (frame?.type !== "envelope") return;
          const ch = String(frame.envelope?.channel || "");
          remember_live_cursor(ch, Number(frame.envelope?.seq || 0));
          if (ch && ch === selected_ref.current) void refresh_messages(ch, { background: true });
          // A channel the rail doesn't know yet (an agent just opened a DM
          // to the operator, or a new channel was created) must JOIN the
          // rail live — it used to stay invisible until manual refresh
          // (adversary P1).
          if (ch && !channels_ref.current.some((c) => c.name === ch)) void refresh_channel_list();
          // Badges refresh trailing-debounced: a burst of envelopes must
          // not fan out into an inbox+digest storm.
          if (badge_debounce.current) clearTimeout(badge_debounce.current);
          badge_debounce.current = setTimeout(() => void refresh_badges(channels_ref.current), 800);
        } catch {
          // non-JSON frame — ignore
        }
      };
      ws.onclose = () => {
        if (live_socket_ref.current === ws) {
          live_socket_ref.current = null;
          live_subscription_ref.current = "";
        }
        set_live(false);
        if (!closed) {
          // Backoff resets only after a STABLE open (adversary F9): a hub
          // that accepts then immediately drops used to reset retry on
          // every onopen, flapping the socket + live dot at ~1s forever.
          if (open_at && Date.now() - open_at >= 15_000) retry = 0;
          else retry += 1;
          open_at = 0;
          setTimeout(connect, Math.min(15_000, 1000 * Math.max(1, retry)));
        }
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // already closing
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (badge_debounce.current) clearTimeout(badge_debounce.current);
      if (live_socket_ref.current === ws) {
        live_socket_ref.current = null;
        live_subscription_ref.current = "";
      }
      try {
        ws?.close();
      } catch {
        // already closed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chan_gen.current += 1;
    set_open_threads({});
    read_fired.current = new Set();
    set_verify_state(null);
    set_info(null);
    // Rulings are per-ROOM: the previous room's standing constraints must
    // never render (or be acked) under this room's header.
    set_rulings(null);
    set_ruling_error("");
    member_note_seq.current = 0; // membership notices are per-channel seqs
    // Optimistic message ratings are per-channel rows (adversary P2-7):
    // a stale entry must never overlay another channel's tally.
    local_rating.current = {};
    // Sort mode is per-channel view state: a ranked list from channel A
    // must never flash over channel B (chan_gen guards the fetch; this
    // guards the mode itself).
    set_sort_mode("recency");
    set_top_rows(null);
    set_top_error("");
    // Files content + viewer are per-channel. The drawer itself STAYS open
    // across switches (dm 53: it is a standing surface like a Drive panel);
    // its listing reloads for the new channel below.
    set_files(null);
    set_files_error("");
    set_fs_cwd("");
    set_file_view(null);
    set_show_new_fs(false);
    set_new_fs_path("");
    // An armed delete names a file in the PREVIOUS channel — disarm it.
    set_fs_del(null);
    // Mission editor is per-row UI state; missions themselves are hub-wide
    // and survive the switch. A draft aimed at one roster must not land on
    // another channel's row of the same seat mid-edit — close it.
    set_mission_edit("");
    set_mission_error("");
    // Roster/blocks are per-channel: a stale flash could aim a moderation
    // click at the WRONG channel's context (adversary find).
    set_members(null);
    set_blocked(null);
    set_retired(null);
    set_mod_nudge("");
    set_mod_error("");
    set_summaries({});
    // Full analyst reset (adversary find: a stale in-flight answer used
    // to land in the NEW channel's empty thread).
    set_ai_thread([]);
    set_ai_error("");
    set_ai_busy(false);
    set_ai_question("");
    // Clear the previous channel's content immediately — stale-channel
    // bleed let "Mark read to here" ack the WRONG channel's seq.
    set_messages([]);
    // Filter resets to All on every switch (operator dm 99: a sticky
    // Unread/Asks filter from one channel made the NEXT channel render
    // "no messages match" — read as "messages won't display", and a
    // relaunch only 'fixed' it because a reload resets this state).
    // Badge clicks that deliberately target a filter stage it in
    // pending_filter and win over the reset.
    set_filter(pending_filter.current || "all");
    pending_filter.current = null;
    set_reply_to(null);
    set_reply_answers({});
    set_post_nudge("");
    // A citation preview is anchored to a chip in the OUTGOING feed, and a
    // bare `#412` resolved against the room being left. Both are stale now.
    set_cite_card(null);
    // Attachments are channel-scoped (uploaded to `selected`) — a switch
    // drops any un-sent pending refs so they can't post to the wrong room.
    set_pending_attachments([]);
    // Draft swap: park the outgoing channel's draft, restore the
    // incoming one (Slack semantics — usability critic F4).
    if (prev_channel.current && prev_channel.current !== selected) {
      if (compose_text || compose_title) {
        drafts.current[prev_channel.current] = { text: compose_text, title: compose_title, kind: compose_kind };
      } else {
        delete drafts.current[prev_channel.current];
      }
      save_drafts(drafts.current); // persist the parked draft before the debounce would
    }
    const draft = drafts.current[selected];
    set_compose_text(draft?.text || "");
    set_compose_title(draft?.title || "");
    set_compose_kind(draft?.kind || "fyi");
    prev_channel.current = selected;
    scroll_pending.current = true;
    void refresh_messages(selected);
    if (!selected) return;
    // Standing rulings ride the switch, not the drawer: in a gated room the
    // hub is already refusing this seat's posts, and the composer must say
    // so BEFORE a post is typed and lost (usability critic F13's rule).
    void refresh_rulings(selected);
    // Standing drawers follow the channel (dm 53/55).
    if (drawer === "files") load_files();
    if (drawer === "members") load_info();
    const t = setInterval(() => {
      poll_count.current += 1;
      // Inflight gate (adversarial F3, dm 99): during a hub stall, ticks
      // must not pile hung requests into the browser's ~6-connection pool
      // — that starvation froze the whole page until relaunch.
      if (!bg_refresh_inflight.current) {
        bg_refresh_inflight.current = true;
        void refresh_messages(selected, { background: true }).finally(() => {
          bg_refresh_inflight.current = false;
        });
      }
      if (poll_count.current % BADGE_POLL_EVERY === 0) {
        // Rail freshness rides the badge cadence: last_seq staleness was
        // re-creating the old-messages symptom (adversary P1). Badges read
        // the REF, not the closure snapshot (stale-closure fix).
        void refresh_channel_list()
          .then((all) => refresh_badges(all))
          .catch(() => refresh_badges(channels_ref.current));
        // Health + meta follow the same cadence (adversarial F6): a
        // paused-at-mount snapshot used to freeze the composer disabled
        // (or the "hub paused" chip stale) until relaunch.
        void hub.healthz().then(set_health).catch(() => {});
        void hub.meta().then((m) => set_meta(m)).catch(() => {});
      }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Persist the in-flight draft (operator dm 31): mirror the composer to
  // localStorage on a short debounce so a reload/crash/hot-reload never
  // eats what the operator is typing. Empty drafts are pruned so the store
  // doesn't accumulate blank channels. A `compose_ref` mirrors the live
  // state for the synchronous page-hide flush below (closes the debounce
  // gap — a reload within the debounce window would otherwise lose the
  // last keystrokes).
  const compose_ref = useRef({ text: "", title: "", kind: "fyi" as "fyi" | "ask" | "dm" | "group", selected: "" });
  compose_ref.current = { text: compose_text, title: compose_title, kind: compose_kind, selected };
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      if (compose_text || compose_title) {
        drafts.current[selected] = { text: compose_text, title: compose_title, kind: compose_kind };
      } else {
        delete drafts.current[selected];
      }
      save_drafts(drafts.current);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose_text, compose_title, compose_kind, selected]);

  // Synchronous flush on unload — the debounce can't run during a reload,
  // so write the exact current draft one last time (dm 31: not one
  // keystroke lost). pagehide covers reload + tab close + bfcache; the
  // unmount cleanup covers an App page switch (Team → Board), which
  // CANCELS the pending debounce (adversary F6: keystrokes typed within
  // the 300ms window before a page hop were lost).
  useEffect(() => {
    const flush = () => {
      const c = compose_ref.current;
      if (!c.selected) return;
      if (c.text || c.title) drafts.current[c.selected] = { text: c.text, title: c.title, kind: c.kind };
      else delete drafts.current[c.selected];
      save_drafts(drafts.current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush(); // unmount = the component's own pagehide
    };
  }, []);

  // A citation card is anchored to viewport coordinates read when the
  // pointer entered the chip. Scrolling the feed moves the chip and not the
  // card, so a scroll DISMISSES it rather than leaving it pointing at the
  // wrong line. Escape closes it for the same reason a preview must be
  // dismissible: it can sit on top of the text you were reading.
  useEffect(() => {
    if (!cite_card) return;
    const drop = () => set_cite_card(null);
    const on_key = (e: KeyboardEvent) => {
      if (e.key === "Escape") drop();
    };
    const el = list_ref.current;
    el?.addEventListener("scroll", drop);
    window.addEventListener("keydown", on_key);
    return () => {
      el?.removeEventListener("scroll", drop);
      window.removeEventListener("keydown", on_key);
    };
  }, [cite_card]);

  // Scroll: on channel open snap to the BOTTOM (newest activity — thread
  // order is last_seq ascending); afterwards stick to bottom only when
  // the user is already near it.
  useEffect(() => {
    const el = list_ref.current;
    if (!el || !messages.length) return;
    if (scroll_pending.current) {
      scroll_pending.current = false;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const near_bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (near_bottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Snapshot + coverage on Unread-filter entry (operator dm 63). Two
  // halves: (1) pin the unread set so acks don't evict rows mid-read;
  // (2) the badge counts from the seat INBOX while the thread pane shows
  // a WINDOW — an unread older than the window floor made the filter
  // show nothing under a "1 unread" badge ("unread doesn't work").
  // Backfill the window down to the oldest unread so the badge's claim
  // is always inspectable.
  useEffect(() => {
    if (filter !== "unread" || !selected) {
      set_unread_snapshot(null);
      return;
    }
    // Entry-time capture, deliberately NOT reactive to unread_map — the
    // whole point is that later ack-driven shrinkage must not re-derive
    // this set (new arrivals still show through the live half).
    const live = unread_map[selected];
    set_unread_snapshot(new Set(live || []));
    // Fresh filter entry re-arms one backfill attempt (F5).
    backfill_attempted.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, selected]);

  // Coverage check SPLIT from the snapshot capture (dm-99 audit F5): the
  // old single effect read messages_ref at entry time — clicking "Unread"
  // while the window was still loading saw an empty window (min 0), skipped
  // the backfill, and the filter showed nothing under a live badge. This
  // half is reactive to the LIVE window, so coverage is re-checked when
  // messages land. One attempt per (channel, oldest-unread) per filter
  // entry — a failing hub surfaces a notice instead of a silent hole, and
  // re-selecting the filter retries.
  useEffect(() => {
    if (filter !== "unread" || !selected || !unread_snapshot || !unread_snapshot.size) return;
    const min_unread = Math.min(...unread_snapshot);
    const window_min = messages.length ? messages[0].seq || 0 : 0;
    // window_min 0 = window not loaded yet; this effect re-fires on load.
    if (!min_unread || !window_min || window_min <= min_unread) return;
    const attempt_key = `${selected}:${min_unread}`;
    if (backfill_attempted.current === attempt_key) return;
    backfill_attempted.current = attempt_key;
    const gen = chan_gen.current;
    void hub
      .messages(selected, { since: Math.max(0, min_unread - 1), limit: PAGE_LIMIT })
      .then((list) => {
        if (gen !== chan_gen.current || !list.length) return;
        set_messages((cur) => {
          const seen = new Set(cur.map((m) => m.id));
          const fresh = list.filter((m) => !seen.has(m.id));
          if (!fresh.length) return cur;
          // Explicit inspection act: merge WITHOUT the background cap —
          // dropping the tail to admit the head would trade one hole
          // for another. (A >PAGE_LIMIT gap between the oldest unread
          // and the window can still leave a seam mid-list; the unread
          // rows themselves are what must be reachable.)
          return [...cur, ...fresh].sort((a, b) => (a.seq || 0) - (b.seq || 0));
        });
      })
      .catch(() => {
        if (gen !== chan_gen.current) return;
        // Surface the hole (F5): a failed backfill used to vanish — the
        // Unread pane just looked empty/short. The attempt stays marked so
        // a wedged hub doesn't re-notice on every poll; re-selecting the
        // filter re-arms.
        set_notice("Couldn't load the older unread messages — the Unread list may be incomplete. Re-select Unread to retry.");
        setTimeout(() => set_notice(""), 6000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, selected, unread_snapshot, messages]);

  function fire_read(m: HubMessage): void {
    if (read_fired.current.has(m.id)) return;
    read_fired.current.add(m.id);
    void hub.read_message(m.channel, m.id).catch(() => {});
    // READING CLEARS THE UNREAD (operator dm 27: "even if i read a message
    // it doesn't go away"). The hub inbox is cursor-based and the cursor is
    // monotonic (never rewinds), so a click — an EXPLICIT act, not a render
    // — advances the read cursor to this message's seq: the dot clears
    // durably. Obligations (open/blocked asks) are STICKY in the inbox and
    // stay pinned until resolved/answered even past the cursor — that is by
    // design (reading an ask is not answering it; the Resolve action closes
    // it), so their flag correctly persists.
    void hub.ack(m.channel, m.seq).catch(() => {});
    // Optimistic: clear the clicked message's own dot immediately, then the
    // badge refresh reconciles the rest (plain ≤seq drop; obligations stay).
    set_unread_map((cur) => {
      const set = cur[m.channel];
      if (!set || !set.has(m.seq)) return cur;
      const next = new Set(set);
      next.delete(m.seq);
      return { ...cur, [m.channel]: next };
    });
    if (badge_debounce.current) clearTimeout(badge_debounce.current);
    badge_debounce.current = setTimeout(() => void refresh_badges(channels_ref.current), 500);
    // Critical unpin has no visual change on short bodies — confirm the
    // act so the operator doesn't click twice doubting it (critic F12).
    if (m.critical) {
      set_notice(`Read recorded for critical #${m.seq}.`);
      setTimeout(() => set_notice(""), 2500);
    }
  }

  /** Row click records Hub read state. Open threads never clamp message
   *  bodies: the thread chevron is the one disclosure control for its
   *  conversation, so readers do not have to hunt for a second expander.
   *
   *  On a foldable ROOT the whole card is also the fold target (operator dm
   *  11: "simpler if just clicking the first thread message unfold/folds it
   *  ... more intuitive"), superseding the header-bar-only target from dm 6.
   *  The bar stays — it is now the visible affordance for a surface that
   *  extends past it, rather than the only place the click lands.
   *
   *  THE MESSAGE BODY IS EXCLUDED, deliberately. Toggling is symmetric, so a
   *  body-inclusive target would COLLAPSE an open thread the moment you
   *  clicked the text you were reading — trading laurent's unreachable
   *  content for a card that shuts under the cursor. Selection and
   *  interactive children are already excluded below; the body is the third
   *  case and the only one that is a judgment rather than a mechanic. */
  function row_click(m: HubMessage, e?: React.MouseEvent, fold?: FoldControl): void {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    fire_read(m);
    if (!fold || fold.disabled || !e) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    // The header bar runs its own toggle and the event then bubbles here.
    // BELT AND BRACES, AND CURRENTLY REDUNDANT — said plainly because it is
    // not falsifiable and should not be mistaken for a load-bearing guard:
    // `toggle_thread` ASSIGNS the captured `folded` rather than negating the
    // live value, so firing it twice in one event is idempotent and the
    // double fire cannot cancel out. This keeps the two paths disjoint anyway,
    // so a future toggle rewritten as a negation does not silently become a
    // no-op on every header click.
    if (target.closest(".team_row_head")) return;
    if (target.closest(".team_row_body, .team_fs_chips, .team_row_asks")) return;
    fold.toggle();
  }

  /** Resolve a citation chip into the card (operator dm 21/22).
   *
   *  Three sources, cheapest first: the open channel's already-loaded window
   *  (no request at all — the common case, since most citations point at the
   *  room you are reading), the per-session cache, and only then the hub.
   *  `since: seq - 1, limit: 1` asks for exactly the one message; a room the
   *  seat cannot read answers with an error, which is a real state and is
   *  shown as one rather than as an empty card. */
  async function show_cite_card(el: HTMLElement): Promise<void> {
    const seq = Number(el.getAttribute("data-cite-seq"));
    // An empty data-cite-channel means "the room you are reading" — the bare
    // `#412` case. Resolving it against `selected` is the whole reason the
    // parser refuses to guess a channel itself.
    const channel = el.getAttribute("data-cite-channel") || selected;
    if (!Number.isSafeInteger(seq) || seq < 1 || !channel) return;
    const r = el.getBoundingClientRect();
    const anchor = { left: r.left, top: r.top, bottom: r.bottom };
    const key = `${channel}#${seq}`;

    const local = channel === selected ? messages.find((m) => Number(m.seq) === seq) : undefined;
    if (local) {
      set_cite_card({ channel, seq, anchor, state: "found", msg: local, thread_state: thread_state_of(local) });
      return;
    }
    if (cite_cache.current.has(key)) {
      const hit = cite_cache.current.get(key) || undefined;
      set_cite_card({ channel, seq, anchor, state: hit ? "found" : "missing", msg: hit });
      return;
    }
    set_cite_card({ channel, seq, anchor, state: "loading" });
    try {
      const list = await hub.messages(channel, { since: seq - 1, limit: 1 });
      const hit = (list || []).find((m) => Number(m.seq) === seq) || null;
      cite_cache.current.set(key, hit);
      // The pointer may have moved on, or moved to ANOTHER citation, while
      // this was in flight. Only the card still asking this question gets
      // the answer — otherwise a slow fetch paints over a newer hover.
      set_cite_card((cur) =>
        cur && cur.channel === channel && cur.seq === seq ? { ...cur, state: hit ? "found" : "missing", msg: hit || undefined, thread_state: hit ? thread_state_of(hit) : undefined } : cur
      );
    } catch (e: any) {
      set_cite_card((cur) => (cur && cur.channel === channel && cur.seq === seq ? { ...cur, state: "error", error: String(e?.message || e) } : cur));
    }
  }

  /** Is the thread under this message closed? The root's own `status` never
   *  changes, and asserting it as live state is operator dm 34.
   *
   *  The hub's `closed` verdict rides every message row (agora-and-wui#11),
   *  so this now answers CROSS-CHANNEL too — the case that had to stay
   *  silent when the only way to know was to read the trail, which a card
   *  resolving one message cannot do. */
  function thread_state_of(m: HubMessage): "open" | "resolved" | undefined {
    const own = String(m.status || "").toLowerCase();
    const verdict = hub_closed_verdict(m);
    if (verdict === true) return "resolved";
    if (verdict === false) return own === "open" || own === "blocked" ? "open" : undefined;
    // No statement (retracted row, or a hub older than `closed`): fall back
    // to the loaded trail, which exists only for the open channel. Note the
    // fallback shares the defect `closed` exists to fix — a BYSTANDER's
    // `resolved` reads as closed here. Kept because on such a hub there is
    // nothing better; still silent cross-channel rather than printing the
    // root's posted word, which is what misled the operator in the first
    // place.
    if (m.channel && m.channel !== selected) return undefined;
    const window_msgs = messages_ref.current;
    if (!window_msgs.some((x) => x.id === m.id)) return undefined; // not our window, cannot see the trail
    const closed = window_msgs.some((x) => x.reply_to === m.id && String(x.status || "").toLowerCase() === "resolved");
    if (closed) return "resolved";
    return own === "open" || own === "blocked" ? "open" : undefined;
  }

  /** Click a citation chip: go to the cited message (operator dm 34).
   *  Reuses the Board->Team focus anchor, so a cross-channel jump lands in
   *  the room and scrolls once the window holds the message — including the
   *  case where it is older than the loaded window. */
  async function jump_to_cite(el: HTMLElement): Promise<void> {
    const seq = Number(el.getAttribute("data-cite-seq"));
    const channel = el.getAttribute("data-cite-channel") || selected;
    if (!Number.isSafeInteger(seq) || seq < 1 || !channel) return;
    const key = `${channel}#${seq}`;
    let msg: HubMessage | undefined = channel === selected ? messages_ref.current.find((m) => Number(m.seq) === seq) : undefined;
    if (!msg && cite_cache.current.has(key)) msg = cite_cache.current.get(key) || undefined;
    if (!msg) {
      try {
        const list = await hub.messages(channel, { since: seq - 1, limit: 1 });
        msg = (list || []).find((m) => Number(m.seq) === seq) || undefined;
        cite_cache.current.set(key, msg || null);
      } catch (e: any) {
        set_error(String(e?.message || e || `could not read #${channel}`));
        return;
      }
    }
    // A citation that cannot be opened says so, rather than navigating to
    // the room and leaving the reader hunting for a message that is not
    // there — which is what a bare set_selected would do.
    if (!msg) {
      set_notice(`No message #${seq} in #${channel} to open.`);
      setTimeout(() => set_notice(""), 3000);
      return;
    }
    set_cite_card(null);
    focus_anchor.current = { message_id: msg.id, seq };
    // Same channel: set_selected is a no-op and the [messages] effect will
    // not re-fire, so the anchor has to be consumed by hand (the comment on
    // consume_focus_anchor already warns about exactly this).
    if (channel === selected) consume_focus_anchor();
    else set_selected(channel);
  }

  function cite_chip_at(target: EventTarget | null): HTMLElement | null {
    const el = target as HTMLElement | null;
    return el && typeof el.closest === "function" ? (el.closest("[data-cite-seq]") as HTMLElement | null) : null;
  }

  function message_copy_text(m: HubMessage): string {
    const title = String(m.title || "").trim();
    const body = String(m.body || "").trim();
    return title && body && title !== body ? `${title}\n\n${body}` : title || body;
  }

  async function copy_message(m: HubMessage): Promise<void> {
    const text = message_copy_text(m);
    const show_copy_feedback = (status: "copied" | "failed") => {
      set_copy_feedback({ id: m.id, status });
      setTimeout(() => set_copy_feedback((current) => current?.id === m.id && current.status === status ? null : current), 2200);
    };
    if (!navigator.clipboard?.writeText) {
      show_copy_feedback("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      show_copy_feedback("copied");
    } catch {
      show_copy_feedback("failed");
    }
  }

  function speak_message(m: HubMessage): void {
    const speak = props.on_speak_message;
    if (!speak) return;
    speak_abort_ref.current?.abort();
    const controller = new AbortController();
    speak_abort_ref.current = controller;
    set_speaking_message_id(m.id);
    const message: TeamSpeakMessage = {
      id: m.id,
      channel: m.channel,
      seq: m.seq,
      sender: m.sender,
      title: m.title,
      body: m.body,
    };
    void Promise.resolve()
      .then(() => speak(message, controller.signal))
      .catch(() => {
        if (!controller.signal.aborted) {
          set_notice(`Could not speak message #${m.seq}.`);
          setTimeout(() => set_notice(""), 3000);
        }
      })
      .finally(() => {
        if (speak_abort_ref.current === controller && !controller.signal.aborted) {
          speak_abort_ref.current = null;
          set_speaking_message_id("");
        }
      });
  }

  /** Fetch the channel's verbatim ledger and recompute the WHOLE hash
   *  chain client-side (hub_ledger.ts) — the hub's own `verified` flag is
   *  deliberately not consulted. */
  async function verify_transcript(): Promise<void> {
    if (!selected || verify_state === "running") return;
    const gen = chan_gen.current;
    set_verify_state("running");
    try {
      const ledger = await hub.ledger(selected);
      const verdict = await verify_ledger(ledger);
      // Trust surface: a verdict for the PREVIOUS channel must never
      // render under the new header (adversary P1, security-flavored).
      if (gen !== chan_gen.current) return;
      set_verify_state(verdict);
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_verify_state({ error: String(e?.message || e || "verification failed") });
    }
  }

  /** Read the selected room's standing rulings off its digest (hub 0113).
   *  Feature-detected on the arrays being PRESENT: a pre-0113 hub serves
   *  neither, and `null` keeps every rulings surface off the page rather
   *  than rendering "0 rulings" as if the room had none. Failure is silent
   *  for the same reason a badge failure is — this is a read of somebody
   *  else's state, and the thread view must not depend on it. */
  async function refresh_rulings(channel: string): Promise<void> {
    if (!channel) return;
    const gen = chan_gen.current;
    try {
      const d = await hub.digest(channel);
      if (gen !== chan_gen.current) return;
      const all = d?.rulings;
      const unacked = d?.unacknowledged_rulings;
      if (!Array.isArray(all) && !Array.isArray(unacked)) {
        set_rulings(null);
        return;
      }
      const unacked_rows = Array.isArray(unacked) ? unacked : [];
      // Whether the room GATES on them is `channel:meta.rulings_required`,
      // which only /info carries — fetched solely when something is
      // unacknowledged, so a room with no rulings costs no extra call. The
      // gate decides warn-vs-quiet, never whether the rows render.
      let gated = false;
      if (unacked_rows.length) {
        gated = await hub
          .channel_info(channel)
          .then((i) => Boolean(i?.meta?.rulings_required))
          .catch(() => false);
        if (gen !== chan_gen.current) return;
      }
      set_rulings({ all: Array.isArray(all) ? all : [], unacked: unacked_rows, gated });
    } catch {
      // A digest read that fails says nothing about the room's rulings —
      // leave whatever is already known rather than claiming there are none.
    }
  }

  /** Acknowledge standing rulings — the console's version of
   *  `POST /channels/{c}/ruling-acks`, which is the ONLY thing that clears a
   *  `rulings_required` posting gate. Delivery, never agreement (hub 0113):
   *  the button records the read; disagreeing is a message in the room, and
   *  the label says so. Refusals (revoked 409, out-of-scope 403, unknown
   *  404) render verbatim — the console never pre-judges the hub. */
  async function ack_rulings_here(keys: string[]): Promise<void> {
    if (!selected || !keys.length || ruling_busy) return;
    set_ruling_busy(true);
    set_ruling_error("");
    try {
      const res = await hub.ack_rulings(selected, keys);
      const n = (res?.acked || keys).length;
      set_notice(`Acknowledged ${n} standing ruling${n === 1 ? "" : "s"}.`);
      setTimeout(() => set_notice(""), 3000);
      await refresh_rulings(selected);
    } catch (e: any) {
      set_ruling_error(String(e?.message || e || "acknowledging the ruling failed"));
    } finally {
      set_ruling_busy(false);
    }
  }

  /** Load channel About + members + blocks + retired into the Members
   *  drawer (operator dm 55: members are now their own drawer). ALWAYS
   *  fetches fresh (adversary P2-8 folded the dead skip-if-loaded path —
   *  operator dm 128: the cached snapshot rendered a joined agent as
   *  absent; opening the drawer means "show me the members NOW"). */
  /** `keep`: refresh IN PLACE — leave the current rows on screen until the
   *  fresh ones land, instead of clearing to a loading state first.
   *
   *  For a drawer OPEN, clearing is right: the user asked to see this room
   *  now and a spinner is an honest answer. For a refresh fired by focusing
   *  a dropdown it is wrong, and measurably so. `set_members(null)` plus
   *  `set_info("loading")` does not blank the delegate picker — it makes it
   *  fall through the `members ?? info.members ?? []` chain to a DIFFERENT
   *  SOURCE, so for one round trip the open dropdown lists the channel-info
   *  member ids rather than the roster rows it had a moment ago. A native
   *  select paints its options at click time, so that is the list the user
   *  picks from. Stale-but-consistent beats fresh-but-swapped-under-you. */
  function load_info(opts?: { keep?: boolean }): void {
    {
      const gen = chan_gen.current;
      const keep = Boolean(opts?.keep);
      if (!keep) set_info("loading");
      // The drawer is where the rulings TEXT lives, so an explicit open
      // re-reads them for the same reason it re-reads members: opening
      // means "show me this room NOW", not "show me the last snapshot".
      void refresh_rulings(selected);
      if (!keep) set_members(null);
      set_members_error("");
      if (!keep) set_blocked(null);
      hub
        .channel_info(selected)
        .then((i) => {
          if (gen === chan_gen.current) set_info(i);
        })
        .catch((e: any) => {
          if (gen === chan_gen.current) set_info({ error: String(e?.message || e || "info failed") });
        });
      hub
        .members(selected)
        .then((m) => {
          if (gen !== chan_gen.current) return;
          set_members(m as Array<{ agent_id?: string; about?: string; mission?: string; role?: string }>);
          set_members_error("");
          consume_invited_pending(selected, m as Array<{ agent_id?: string }>);
        })
        .catch((e: any) => {
          if (gen !== chan_gen.current) return;
          // Adversary P2-2: an empty list on FAILURE read as "nobody is
          // here" — a lie adjacent to the dm-128 incident. Name it.
          set_members([]);
          set_members_error(String(e?.message || e || "members unavailable"));
        });
      // ALL scopes (channel + hub-wide): the operator asked to remove a
      // member "from a channel OR from the hub" (dm 12), so the Blocked
      // section shows both and offers the matching unblock for each.
      hub
        .list_blocks()
        .then((b) => {
          if (gen === chan_gen.current) set_blocked(b);
        })
        .catch(() => {
          if (gen === chan_gen.current) set_blocked([]);
        });
      // Retired agents (agora 0.12.0): the un-retire candidate list. 403
      // for non-operators → empty (the section simply won't render).
      hub
        .retired_agents()
        .then((r) => {
          if (gen === chan_gen.current) set_retired(r);
        })
        .catch(() => {
          if (gen === chan_gen.current) set_retired([]);
        });
    }
  }

  /** Drawer tabs (operator dm 53/55): one drawer at a time — Assistant,
   *  Members, Files, Leaderboard. Opening a drawer (re)loads its
   *  channel-scoped data. */
  function toggle_drawer(which: "assistant" | "members" | "files" | "leaderboard" | "desk"): void {
    const next = drawer === which ? "" : which;
    set_drawer(next);
    if (next === "files") load_files();
    // FORCE the members load on open (operator dm 128): the skip-if-loaded
    // fast path served a stale snapshot — an agent who joined after the
    // first load rendered as absent ("only entity joined... neither are on
    // the members right panel" while the hub already counted 2). The
    // live-refresh gate starts at the window's current max notice seq
    // (adversary P2-5): the open itself fetches fresh, so historical
    // notices must not fire a second concurrent fetch.
    if (next === "members") {
      let max_seq = 0;
      for (const m of messages_ref.current) {
        if (String(m.sender || "") === "hub" && (m.seq || 0) > max_seq) max_seq = m.seq || 0;
      }
      member_note_seq.current = max_seq;
      load_info();
      load_delegations(); // hub-wide delegate list rides the Members open
      load_missions(); // standing missions ride the Members open (operator)
      // The roster rides it too (operator dm 3). load_info() refreshes the
      // channel's OWN members, which is what the delegate dropdown reads;
      // the invite picker reads the hub-wide roster, and that one was still
      // whatever presence returned at page load. A seat that registered
      // since was invisible until a reload.
      load_roster(seat);
      set_mission_edit("");
      set_mission_error("");
    }
    if (next === "leaderboard") load_leaderboard(board_scope);
    if (next === "desk") void load_desk();
  }

  /** Load the reputation board (channel scope needs a selected channel;
   *  hub scope reads the sum). Generation-guarded like the other loads so
   *  a stale channel's board never lands after a switch. Feature-detects
   *  older hubs/proxies: 403/404 render as "ships with the hub update". */
  function load_leaderboard(scope: "channel" | "hub"): void {
    const gen = chan_gen.current;
    set_board(null);
    set_board_error("");
    set_board_open("");
    set_board_votes(null);
    set_vote_error("");
    const req = scope === "hub" ? hub.reputation_hub() : hub.reputation(selected);
    req
      .then((b) => {
        if (gen === chan_gen.current) set_board(b);
      })
      .catch((e: any) => {
        if (gen !== chan_gen.current) return;
        const status = Number(e?.status || 0);
        set_board_error(
          status === 404 || status === 403
            ? "Reputation ships with the next hub update — relaunch the hub (agora ≥ 0.12.7) and reopen this drawer."
            : String(e?.message || e || "failed to load leaderboard"),
        );
      });
  }

  /** Expand one agent's row: fetch the attributed votes behind the score
   *  (channel scope only — hub rows are cross-channel aggregates). */
  function toggle_board_row(target: string): void {
    const next = board_open === target ? "" : target;
    set_board_open(next);
    set_board_votes(null);
    set_vote_error("");
    if (!next || board_scope === "hub") return;
    const gen = chan_gen.current;
    hub
      .reputation_votes(selected, next)
      .then((v) => {
        if (gen === chan_gen.current) set_board_votes(v);
      })
      .catch((e: any) => {
        // Honest failure (adversary B F7): [] here rendered as "No
        // attributed votes yet" — an error masked as an empty FACT. Keep
        // the list null (loading state never resolves to a lie) and name
        // the failure where vote errors already surface.
        if (gen === chan_gen.current) {
          set_board_votes(null);
          set_vote_error(`votes list failed: ${String(e?.message || e || "fetch failed")}`);
        }
      });
  }

  // vote_on_author REMOVED (operator dm 164): agent-level trust voting no
  // longer lives in the members tab. Category opinions are cast from the
  // Leaderboard drawer's expand row (cast_vote); message ±1 feeds general.

  // ------------------------------------------------------ message ratings
  // ONE reputation system (operator rulings dm 111/129/131/134, re-affirmed
  // HARD in dm 150): a ±1 on a message is a standing RATING via the hub
  // verb — the ONLY path. The old reactions:* store convention is DELETED,
  // not fallback-kept: it was the stranding machine (26 operator votes sat
  // in store rows reputation could not see). A vote that cannot reach the
  // rating store must FAIL LOUDLY, never divert to a side store.
  const [reaction_busy, set_reaction_busy] = useState("");

  /** Decline-on-the-record. The hub's designed discharge for an obligation
   *  you will not answer is a DECLINE REPLY from the addressee, citing the
   *  pending ask ids so the clearing is mechanical, not prose. Never a
   *  client-side hide: the debt clears FOR EVERY VIEW because the hub
   *  clears it. Two-step (arm, then post) with a 6s self-expiring arm.
   *
   *  `declines` (agora 0.17, backlog 0153) is what makes the refusal SAY so
   *  on the wire — before it, an answer and a refusal were the same shape
   *  and the digest credited a refuser as an answerer. The hub folds
   *  `declines` into `answers` and keeps the refused subset.
   *
   *  Both fields are sent deliberately. `answers` alone is what every hub
   *  since the ask model has understood, and an older hub IGNORES an
   *  unknown `declines` — sending it alone would post a reply that
   *  discharges NOTHING there, and no response distinguishes that from
   *  success (a dropped field is not a 404 the way a missing route is), so
   *  it cannot be feature-detected after the fact. Sending both is the
   *  hub's own documented shape — `declines` is "always a subset of
   *  `answers`" — so a 0.17 hub records the disposition and an older one
   *  still discharges. Worth naming rather than glossing: on that older hub
   *  the refusal is recorded as a plain ANSWER, so its digest credits the
   *  refuser under `answered_by` and the asker is handed a consumption row
   *  pointing at "Declined on the record…". Discharging while the record
   *  says the opposite still beats not discharging at all, but it is the
   *  hub upgrade — not this client — that makes the record true. */
  const [decline_arm, set_decline_arm] = useState("");
  useEffect(() => {
    if (!decline_arm) return;
    const t = setTimeout(() => set_decline_arm(""), 6000);
    return () => clearTimeout(t);
  }, [decline_arm]);
  async function decline_debt(m: HubMessage): Promise<void> {
    if (decline_arm !== m.id) {
      set_decline_arm(m.id);
      return;
    }
    set_decline_arm("");
    try {
      // The hub already computed WHICH asks are this seat's on this message
      // (`/owed.to_answer[].asks_naming_you`). `pending_asks` is the global
      // set: on a root canvassing several seats it carries asks addressed
      // to others, and naming one of those is refused outright — the whole
      // Decline fails, telling the operator they may not decline an ask
      // they never meant to touch. Prefer the hub's subset; fall back to
      // the global set only where no /owed row exists (a hub that does not
      // serve it, where the console has nothing better).
      // An empty subset from a served row is authoritative: no ask here is
      // this seat's, so the discharge is a plain reply carrying no
      // discharge field — which is exactly what clears a directive debt.
      // Only a genuinely ABSENT row (a hub that serves no /owed) falls back
      // to the message's global set.
      const mine = owed_asks[m.channel]?.[m.seq];
      const asks = mine ?? (Array.isArray(m.pending_asks) ? m.pending_asks.filter(Boolean) : []);
      const posted = await hub.post_message(m.channel, {
        body: `Declined on the record by ${meta?.seat || "operator"} — closing without a substantive answer.`,
        status: "reply",
        reply_to: m.id,
        to: m.sender ? [m.sender] : undefined,
        ...(asks.length ? { answers: asks, declines: asks } : {}),
      });
      remember_rest_cursor(m.channel, Number(posted?.seq || 0));
      // Ask the hub for its recomputed verdict now rather than waiting out
      // the 30s badge cadence. Not an optimistic drop: a decline the hub
      // refuses (an ask that is not this seat's, a parent carrying none)
      // must leave the pill exactly where it is.
      await refresh_owed();
    } catch (e: any) {
      set_error(String(e?.message || e || "decline failed"));
    }
  }
  /** Optimistic my-rating per message id (until the next poll's served
   *  row decoration confirms it). */
  const local_rating = useRef<Record<string, number>>({});
  /** ONE tally for a message row: the hub-served ratings decoration
   *  (every rater's standing vote) with the seat's optimistic click
   *  overlaid until the served row catches up. null = the hub serves no
   *  decoration (pre-0.12.31) — thumbs hide, tallies absent, honestly. */
  function msg_tally(m: HubMessage): { up: number; down: number; mine: number } | null {
    const dec = m.ratings;
    if (!dec) return null;
    // Pure overlay fold (team_model) — golden-vector conformance-tested
    // against the hub's served rows (vector 05). Render stays PURE:
    // caught-up entries are swept by the effect on [messages], never
    // deleted mid-render (adversary P2-6).
    return overlay_rating_tally(dec, local_rating.current[m.id]);
  }
  async function react_on(target_id: string, dir: 1 | -1): Promise<void> {
    const seat_id = meta?.seat || "";
    if (!target_id || !seat_id || reaction_busy) return;
    // The verb path is ONLY for real loaded message rows: pseudo-targets
    // must never reach the hub as message ids (adversary P0-1). Rows may
    // live in the recency window OR the Top-voted ranking (adversary C F1:
    // ranked rows outside the window are real messages too — the guard
    // silently no-opped their thumbs).
    const msg_row = messages_ref.current.find((m) => m.id === target_id) || top_rows_ref.current?.find((m) => m.id === target_id);
    if (!msg_row) return;
    set_reaction_busy(`${target_id}:${dir}`);
    set_vote_error("");
    try {
      // ONE REPUTATION SYSTEM (operator rulings dm 111/150): PUT
      // casts/flips the standing rating, DELETE withdraws. Every refusal
      // (400 self, 409 retracted, 429 rate limit, route-absent Hub)
      // surfaces VERBATIM — there is no fallback store, by ruling: a vote
      // that cannot reach reputation must fail loudly, never divert.
      const mine = msg_tally(msg_row)?.mine ?? 0;
      if (mine === dir) await hub.unrate_message(selected, target_id);
      else await hub.rate_message(selected, target_id, dir);
      // Optimistic local tally; the authoritative counts arrive on the
      // next history poll's row decoration (msg_tally overlays this).
      local_rating.current[target_id] = mine === dir ? 0 : dir;
    } catch (e: any) {
      set_vote_error(String(e?.message || e || "rating failed"));
    } finally {
      set_reaction_busy("");
    }
  }

  // my_stance hydration effect REMOVED (operator dm 164): no per-author
  // stance renders in the roster anymore, so the per-author votes-for GET
  // is dead weight (it also spent one hub call per visible author).

  /** Cast the operator seat's ±1 on (target, axis) with the note field as
   *  the one-line WHY, then reload the board in place. The hub enforces
   *  one live vote per rater/axis (revision replaces) and refuses
   *  self-votes — errors surface verbatim. */
  async function cast_vote(target: string, axis: string, value: 1 | -1): Promise<void> {
    if (vote_busy) return;
    set_vote_busy(`${target}:${axis}:${value}`);
    set_vote_error("");
    try {
      await hub.rate(selected, target, axis, value, vote_note.trim());
      set_vote_note("");
      // (dm 164: the Members-drawer stance thumb is gone, so there is no
      // second surface to sync — the board reload below is the only
      // render of this cast.)
      const gen = chan_gen.current;
      const [b, v] = await Promise.all([hub.reputation(selected), hub.reputation_votes(selected, target)]);
      if (gen === chan_gen.current) {
        set_board(b);
        set_board_votes(v);
      }
    } catch (e: any) {
      set_vote_error(String(e?.message || e || "vote failed"));
    } finally {
      set_vote_busy("");
    }
  }

  /** Load the channel's vfs into the Files drawer —
   *  generation-guarded like the other async loads so a stale channel's
   *  listing never lands. */
  function load_files(): void {
    const gen = chan_gen.current;
    set_files(null);
    set_files_error("");
    set_fs_cwd("");
    hub
      .fs_list(selected)
      .then((rows) => {
        if (gen === chan_gen.current) set_files(rows);
      })
      .catch((e: any) => {
        if (gen === chan_gen.current) set_files_error(String(e?.message || e || "failed to list files"));
      });
  }


  /** A viewer state for a BINARY fs entry (hubs with binary-fs support):
   *  decoded to a temporary blob URL — raster mimes preview inline, the
   *  rest offer the download link. Never editable inline. */
  function fs_binary_view(name: string, f: HubFsFile, meta: string | undefined, channel: string): FileView {
    const bytes = Uint8Array.from(atob(f.content_b64 || ""), (c) => c.charCodeAt(0));
    const mime = f.mime || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { name, mode: INLINE_IMAGE_TYPES.has(mime) ? "image" : "download", url, content_type: mime, size: bytes.length, meta, loading: false, version: f.version, editable: false, channel };
  }

  /** Open one vfs file in the shared viewer (md rendered).
   *  Generation-guarded (security adversary P2: a slow read started in
   *  channel X must not pop channel Y's modal after a switch). */
  async function open_fs_file(entry: HubFsEntry): Promise<void> {
    const gen = chan_gen.current;
    const mode0 = resolve_file_mode(entry.path, "text/markdown");
    const meta = `${entry.updated_by || "?"} · ${abs_time(entry.updated_at)} · v${entry.version}`;
    set_file_view({ name: entry.path, mode: mode0 === "image" ? "text" : mode0, meta, loading: true });
    try {
      const f = await hub.fs_read(selected, entry.path);
      if (gen !== chan_gen.current) return; // switched away — drop
      if (f.encoding === "base64" && typeof f.content_b64 === "string") {
        set_file_view(fs_binary_view(entry.path, f, meta, selected));
        return;
      }
      const resolved = resolve_file_mode(entry.path, f.mime);
      // fs files are text; an "image" resolution has no bytes URL here, so
      // render whatever text content came back.
      // Editable only when the FULL content is in hand — a clamped oversize
      // preview round-tripped through an editor would truncate the file.
      const editable = f.content.length <= MAX_PREVIEW_BYTES;
      set_file_view({ name: entry.path, mode: resolved === "image" ? "text" : resolved, text: clamp_preview(f.content), content_type: f.mime, meta, loading: false, version: f.version, editable, channel: selected });
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_file_view({ name: entry.path, mode: "text", meta, error: String(e?.message || e || "failed to read file") });
    }
  }

  /** Deposit one dropped/picked file into the channel fs at `path`.
   *  Text (strict UTF-8, no NULs) goes as `content`; anything else as
   *  `content_b64` per the binary-fs wire contract. First attempt is
   *  create-only (expect_version 0); `replace` retries unconditionally
   *  after the user's explicit click. Caps are pre-checked with named
   *  reasons; everything else is the hub's own refusal, verbatim. */
  async function deposit_file(path: string, file: File, opts?: { replace?: boolean }): Promise<void> {
    const update = (patch: Partial<{ state: "busy" | "done" | "exists" | "error"; error: string }>) =>
      set_fs_uploads((cur) => cur.map((u) => (u.path === path ? { ...u, ...patch } : u)));
    update({ state: "busy", error: "" });
    try {
      const bytes = await file.arrayBuffer();
      const text = decode_as_text(bytes);
      if (text !== null && bytes.byteLength > MAX_FS_TEXT_BYTES) {
        update({ state: "error", error: `exceeds the hub's ${human_size(MAX_FS_TEXT_BYTES)} text-file cap` });
        return;
      }
      if (text === null && bytes.byteLength > MAX_FS_BINARY_BYTES) {
        update({ state: "error", error: `exceeds the ${human_size(MAX_FS_BINARY_BYTES)} binary cap — attach it to a message instead` });
        return;
      }
      const body = text !== null
        ? { content: text, mime: file.type && file.type.startsWith("text/") ? file.type : undefined }
        : { content_b64: bytes_to_b64(bytes), mime: file.type || "application/octet-stream" };
      await hub.fs_put(selected, path, { ...body, expect_version: opts?.replace ? undefined : 0 });
      update({ state: "done" });
      load_files();
    } catch (e: any) {
      const msg = String(e?.message || e || "deposit failed");
      const status = Number(e?.status || 0);
      if (status === 409 || /version|exist/i.test(msg)) {
        update({ state: "exists", error: msg });
      } else if (status === 422 || (/must be text|content.*required/i.test(msg) && !/charter/i.test(msg))) {
        // "charter must be text" is a policy refusal on upgraded hubs, not
        // a missing-capability signal (verifier P2) — it stays verbatim-only.
        update({ state: "error", error: `${msg} — this hub build doesn't accept binary fs files yet` });
      } else {
        update({ state: "error", error: msg });
      }
    }
  }

  /** Handle a drop on the Files drawer: resolve files (walking dropped
   *  folders), seed the queue, and deposit into the CURRENT folder. */
  async function deposit_drop(dt: DataTransfer): Promise<void> {
    const { files: dropped, truncated } = await collect_dropped_files(dt);
    if (truncated) show_toast(`Deposit capped at ${MAX_DROP_FILES} files — the rest of the drop was skipped.`);
    if (!dropped.length) return;
    const base = fs_cwd ? `${fs_cwd}/` : "";
    const rows = dropped.map(({ rel_path, file }) => ({ path: `${base}${rel_path}`, size: file.size, state: "busy" as const, file }));
    set_fs_uploads((cur) => [...cur.filter((u) => !rows.some((r) => r.path === u.path)), ...rows]);
    for (const { rel_path, file } of dropped) {
      await deposit_file(`${base}${rel_path}`, file);
    }
  }

  /** Confirmed vfs deletion. The delete carries the LISTING's version as
   *  expect_version, so an agent rewrite since the user looked surfaces as
   *  the hub's own conflict instead of silently removing newer content.
   *  The hub tombstones (version stays monotonic) and posts an audit
   *  notice; per-channel `fs_remove` gates refuse verbatim. */
  async function delete_fs_file(): Promise<void> {
    const armed = fs_del;
    if (!armed || armed.busy) return;
    set_fs_del({ ...armed, busy: true, error: "" });
    try {
      const r = await hub.fs_delete(selected, armed.entry.path, armed.entry.version);
      set_fs_del(null);
      show_toast(r.deleted ? `Deleted ${armed.entry.path} (was v${armed.entry.version})` : `${armed.entry.path} was already gone.`);
      if (file_view?.name === armed.entry.path && (file_view.channel ?? selected) === selected) set_file_view(null);
      load_files();
    } catch (e: any) {
      set_fs_del((cur) => (cur ? { ...cur, busy: false, error: String(e?.message || e || "delete failed") } : cur));
    }
  }

  /** Save the file currently open in the viewer back to the channel fs.
   *  Only fs-sourced views are editable (attachments never set `editable`).
   *  The write carries the read-time version as expect_version, so a
   *  concurrent agent write comes back as the hub's own 409 — the operator
   *  merges by hand, nothing is silently overwritten. On success the view
   *  refreshes from a re-read and the Files drawer re-lists. */
  async function save_fs_file(text: string): Promise<void> {
    const v = file_view;
    if (!v || !v.editable) throw new Error("this view is not editable");
    const gen = chan_gen.current;
    const vfs_channel = v.channel || selected;
    await hub.fs_put(vfs_channel, v.name, {
      content: text,
      expect_version: v.version ?? undefined,
      mime: v.content_type || "text/markdown",
    });
    const f = await hub.fs_read(vfs_channel, v.name);
    if (gen !== chan_gen.current) return; // switched away — write landed, drop the view refresh
    const resolved = resolve_file_mode(v.name, f.mime);
    const meta = f.updated_by ? `${f.updated_by} · ${abs_time(f.updated_at)} · v${f.version ?? "?"}` : undefined;
    set_file_view({ name: v.name, mode: resolved === "image" ? "text" : resolved, text: clamp_preview(f.content), content_type: f.mime, meta, loading: false, version: f.version, editable: f.content.length <= MAX_PREVIEW_BYTES, channel: vfs_channel });
    if (drawer === "files") load_files();
  }

  /** Open a channel-fs PATH mentioned in a message (operator dm 69: the
   *  "fs:put <path>" write notices must be readable in one click). Same
   *  viewer as the Files drawer; metadata comes from the read since there
   *  is no fs_list entry in hand. Generation-guarded like open_fs_file. */
  // Board -> Team focus (dm 110): land in the cited channel, then scroll
  // to the message once the window holds it (anchor-fetch merge covers a
  // message older than the loaded window).
  const focus_anchor = useRef<{ message_id?: string; seq?: number } | null>(null);
  /** Consume the armed focus anchor against the CURRENT window: scroll if
   *  present, else one bounded fetch merges it in (the [messages] effect
   *  then scrolls). Callable directly for SAME-CHANNEL jumps (wave
   *  adversary P1-3): set_selected(same value) is a no-op, the [messages]
   *  effect doesn't re-fire on a quiet channel, and an anchor left armed
   *  used to fire a surprise scroll at the next unrelated arrival. */
  function consume_focus_anchor(): void {
    const want = focus_anchor.current;
    const msgs = messages_ref.current;
    if (!want || !msgs.length) return;
    const found = want.message_id ? msgs.some((m) => m.id === want.message_id) : false;
    if (found) {
      focus_anchor.current = null;
      requestAnimationFrame(() => {
        const el = document.getElementById(`hubmsg-${want.message_id}`);
        el?.scrollIntoView({ block: "center" });
        el?.classList.add("hit");
        setTimeout(() => el?.classList.remove("hit"), 2500);
      });
      return;
    }
    // Anchor outside the loaded window: one bounded fetch merges it in.
    if (want.seq && Number.isFinite(want.seq)) {
      const gen = chan_gen.current;
      const target_seq = want.seq;
      focus_anchor.current = { ...want, seq: undefined }; // one attempt only
      hub
        .messages(selected, { since: Math.max(0, target_seq - 3), limit: 10 })
        .then((older) => {
          if (gen !== chan_gen.current || !older.length) return;
          set_messages((cur) => {
            const seen = new Set(cur.map((m) => m.id));
            const fresh = older.filter((m) => !seen.has(m.id));
            if (!fresh.length) return cur;
            return [...cur, ...fresh].sort((a, b) => (a.seq || 0) - (b.seq || 0));
          });
        })
        .catch(() => {
          /* anchor stays unfound; the channel is open — honest floor */
        });
    }
  }
  useEffect(() => {
    if (!props.focus) return;
    const { channel, message_id, seq } = props.focus;
    props.on_focus_consumed?.();
    if (!channel) return;
    focus_anchor.current = { message_id, seq };
    if (channel === selected) consume_focus_anchor();
    else set_selected(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus]);

  useEffect(() => {
    consume_focus_anchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Live members refresh (operator dm 128: "only entity joined... neither
  // are on the members right panel" — the hub already counted the join,
  // the drawer showed a pre-join snapshot). Hub membership notices
  // (sender=hub, joined/left/kicked/banned) arriving in the CURRENT
  // channel's window re-fetch the members list while the drawer is open.
  // Same fresh-gate shape as the fs-notice effect below; the gate only
  // advances on success so a failed refresh retries at the next change.
  useEffect(() => {
    if (drawer !== "members" || !selected) return;
    // Notice vocabulary verified against the hub source (adversary P2-1):
    // join="{id} joined", leave="{id} left", "kicked by", "banned by",
    // archive="channel archived", unarchive="channel reopened". Retirement
    // posts NO per-channel notice (honestly uncoverable live — the
    // fresh-on-open reload catches it).
    let latest = 0;
    let latest_text = "";
    for (const m of messages) {
      if (m.channel && m.channel !== selected) continue;
      if (String(m.sender || "") !== "hub") continue;
      const t = `${String(m.title || "")} ${String(m.body || "")}`;
      if (/\b(joined|left|kicked|banned|archived|reopened)\b/i.test(t) && (m.seq || 0) > latest) {
        latest = m.seq || 0;
        latest_text = t;
      }
    }
    if (!latest || latest <= member_note_seq.current) return;
    const gen = chan_gen.current;
    hub
      .members(selected)
      .then((m) => {
        if (gen !== chan_gen.current) return;
        member_note_seq.current = latest;
        set_members(m as Array<{ agent_id?: string; about?: string; mission?: string; role?: string }>);
        set_members_error("");
        consume_invited_pending(selected, m as Array<{ agent_id?: string }>);
      })
      .catch(() => {
        /* retry at the next notice/window change */
      });
    // A kick/ban notice also stales the Blocked (undo) section (adversary
    // P2-6): the member vanishes but the unblock row would not appear.
    if (/\b(kicked|banned)\b/i.test(latest_text)) {
      hub
        .list_blocks(selected)
        .then((b) => {
          if (gen === chan_gen.current) set_blocked(b as any);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, drawer, selected]);

  // Channel-fs path set for chip RESOLUTION (operator dm 93): fetched on
  // channel entry, refreshed when an fs write notice lands in the window.
  // null = listing unavailable (older Hub / Hub error) — chips then mint
  // only for attachment-backed mentions, never for unverifiable fs guesses.
  const [chan_fs_paths, set_chan_fs_paths] = useState<Set<string> | null>(null);
  const fs_note_seq = useRef(0);
  useEffect(() => {
    set_chan_fs_paths(null);
    fs_note_seq.current = 0;
    if (!selected) return;
    const gen = chan_gen.current;
    hub
      .fs_list(selected)
      .then((rows) => {
        if (gen === chan_gen.current) set_chan_fs_paths(new Set(rows.map((r) => String(r.path || "")).filter(Boolean)));
      })
      .catch(() => {
        if (gen === chan_gen.current) set_chan_fs_paths(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useEffect(() => {
    // A new "fs:put/fs:delete" hub notice means the listing changed —
    // refresh once per new notice. CHANNEL-GUARDED (adversarial P0: on a
    // channel switch this effect fires against the PREVIOUS channel's
    // message rows in the same commit, and hub seqs are per-channel — an
    // unguarded reduce poisoned the fresh gate with the old channel's
    // seq, suppressing every refresh and resurrecting the dm-93 404 via
    // stale listings). The gate advances only on SUCCESS so a failed
    // refresh retries at the next window change.
    const latest = messages.reduce((acc, m) => {
      if (m.channel && m.channel !== selected) return acc;
      const t = String(m.title || "");
      return (t.startsWith("fs:put") || t.startsWith("fs:delete")) && (m.seq || 0) > acc ? m.seq || 0 : acc;
    }, 0);
    if (!latest || latest <= fs_note_seq.current) return;
    const gen = chan_gen.current;
    hub
      .fs_list(selected)
      .then((rows) => {
        if (gen !== chan_gen.current) return;
        fs_note_seq.current = latest;
        set_chan_fs_paths(new Set(rows.map((r) => String(r.path || "")).filter(Boolean)));
      })
      .catch(() => {
        /* keep the previous listing; the un-advanced gate retries */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selected]);

  async function open_fs_path(path: string, from_channel?: string): Promise<void> {
    const gen = chan_gen.current;
    const vfs_channel = from_channel || selected;
    const mode0 = resolve_file_mode(path, "text/markdown");
    set_file_view({ name: path, mode: mode0 === "image" ? "text" : mode0, loading: true, channel: vfs_channel });
    try {
      const f = await hub.fs_read(vfs_channel, path);
      if (gen !== chan_gen.current) return;
      const meta = f.updated_by ? `${f.updated_by} · ${abs_time(f.updated_at)} · v${f.version ?? "?"}` : undefined;
      if (f.encoding === "base64" && typeof f.content_b64 === "string") {
        set_file_view(fs_binary_view(path, f, meta, vfs_channel));
        return;
      }
      const resolved = resolve_file_mode(path, f.mime);
      const editable = f.content.length <= MAX_PREVIEW_BYTES;
      set_file_view({ name: path, mode: resolved === "image" ? "text" : resolved, text: clamp_preview(f.content), content_type: f.mime, meta, loading: false, version: f.version, editable, channel: vfs_channel });
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_file_view({ name: path, mode: "text", error: String(e?.message || e || "failed to read file") + " — the file may have been rewritten under another path; check the Files drawer" });
    }
  }

  /** Read a charter this seat is behind on, at either scope — and let the
   *  READ be what clears it. The hub records a receipt when the head is
   *  read (`GET /charter` at hub scope, the channel-fs read of
   *  `channel/charter.md` at room scope); the console never marks one read
   *  locally, because a receipt it invented would be a forged one and the
   *  posting gate keys on the real thing.
   *
   *  The hub charter is served as THIS seat's view — the common sections
   *  plus the ones addressed to the kinds of seat it is. That is the hub's
   *  token economy, not an access boundary, so when the served text is a
   *  slice the viewer says which sections were left out and offers the whole
   *  document, exactly as the response's own `read_all_with` instructs. */
  async function open_charter(scope: string, full = false): Promise<void> {
    if (scope && scope !== HUB_CHARTER_SCOPE) {
      await open_fs_path(CHANNEL_CHARTER_PATH, scope);
      await refresh_owed();
      return;
    }
    const name = "hub charter";
    set_file_view({ name, mode: "md", loading: true });
    try {
      const doc = await hub.charter(full);
      const omitted = Array.isArray(doc.omitted) ? doc.omitted.filter(Boolean) : [];
      const view = Array.isArray(doc.view) ? doc.view.join("+") : "";
      const meta = [
        `v${doc.version ?? "?"}`,
        doc.packaged ? "packaged default" : doc.updated_by ? `set by ${doc.updated_by}` : "",
        view ? `your view: ${view}` : "",
        doc.sliced ? `${omitted.length} section(s) not addressed to this seat` : "whole document",
      ]
        .filter(Boolean)
        .join(" · ");
      // The slice, and the way out of it, stated in the document itself —
      // a reader must never have to wonder whether they were shown all of
      // it. `read_all_with` is the hub's own wording for the full read.
      const note = doc.sliced
        ? `> Served as your view (${view || "member"}). Not shown: ${omitted.join(", ") || "—"}.` +
          `${doc.view_note ? ` ${doc.view_note}` : ""}\n> The whole document is available — ${doc.read_all_with || "GET /charter?full=true"}.\n\n`
        : "";
      const brief = doc.delegate_brief ? `\n\n---\n\n${doc.delegate_brief}` : "";
      set_file_view({ name, mode: "md", text: clamp_preview(`${note}${doc.text || ""}${brief}`), meta, loading: false });
      // The read just recorded a receipt; ask the hub whether the debt is
      // gone rather than assuming it (a sliced read clears `current` but
      // not necessarily `view_current`).
      await refresh_owed();
      // The whoami pointer is the other half of the same statement; a stale
      // `current: false` beside a cleared debt row would be the console
      // contradicting itself.
      void hub.meta().then(set_meta).catch(() => {});
    } catch (e: any) {
      const msg = String(e?.message || e || "failed to read the hub charter");
      set_file_view({
        name,
        mode: "md",
        error: /404|not found/i.test(msg)
          ? `${msg} — this hub predates the hub charter (agora 0146); there is nothing to read.`
          : msg,
      });
    }
  }

  /** Open a message attachment in the shared viewer (operator dm 35: click
   *  to PREVIEW, not just download). Every byte comes from the authenticated
   *  Hub client, then receives a short-lived object URL for presentation.
   *  Generation-guarded like open_fs_file (security adversary P2). */
  /** Open an attachment preview. Takes the owning channel (not a message):
   *  pending composer attachments are already uploaded blobs in the current
   *  channel (operator dm 116 — clickable before send), so the same viewer
   *  serves both posted and pending chips. */
  async function open_attachment(att_channel: string, a: HubAttachment): Promise<void> {
    const gen = chan_gen.current;
    const mode = resolve_file_mode(a.filename, a.content_type);
    set_file_view({ name: a.filename, mode, content_type: a.content_type, size: a.size, loading: true });
    try {
      const blob = await hub.attachment_blob(att_channel, a.id);
      if (gen !== chan_gen.current) return;
      const url = URL.createObjectURL(blob);
      if (mode === "md" || mode === "text") {
        // Oversize text never renders inline (security adversary P1: the
        // markdown parser is superlinear on pathological input — a multi-MB
        // file must not freeze the tab). The object URL still offers a direct
        // download without dropping the authenticated Hub boundary.
        if (a.size > MAX_PREVIEW_BYTES) {
          set_file_view({ name: a.filename, mode: "download", url, content_type: a.content_type, size: a.size,
            error: `too large to preview inline (${human_size(a.size)} > ${human_size(MAX_PREVIEW_BYTES)}) — download to view` });
          return;
        }
        set_file_view({ name: a.filename, mode, url, content_type: a.content_type, size: a.size, text: clamp_preview(await blob.text()) });
        return;
      }
      set_file_view({ name: a.filename, mode, url, content_type: a.content_type, size: a.size });
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_file_view({ name: a.filename, mode: "download", content_type: a.content_type, size: a.size, error: String(e?.message || e || "failed to load") });
    }
  }

  /** Moderation acts (agora c2263 + operator dm 12): channel-scope kick
   *  (1h) / ban (indefinite) / unblock, and HUB-WIDE ban / unblock (removes
   *  from the whole hub, survives key loss, severs live WS). The HUB is the
   *  authority (owner/operator); refusals render verbatim. `scope` selects
   *  the channel bucket ("channel") or the hub bucket ("hub"). */
  async function moderate(agent_id: string, kind: "kick" | "ban" | "unblock", scope: "channel" | "hub" = "channel"): Promise<void> {
    if (mod_busy) return;
    set_mod_busy(`${scope}:${kind}:${agent_id}`);
    set_mod_error("");
    try {
      if (scope === "hub") {
        if (kind === "unblock") await hub.hub_unblock(agent_id);
        else await hub.hub_block(agent_id, kind === "kick" ? { seconds: 3600, reason: "hub kick (Continuum Team page)" } : { reason: "hub ban (Continuum Team page)" });
      } else if (kind === "unblock") {
        await hub.unblock(selected, agent_id);
      } else {
        await hub.block(selected, agent_id, kind === "kick" ? { seconds: 3600, reason: "kicked by the operator (Continuum Team page)" } : { reason: "banned by the operator (Continuum Team page)" });
      }
      set_notice(`${scope === "hub" ? "hub " : ""}${kind} → ${agent_id} applied.`);
      setTimeout(() => set_notice(""), 3000);
      // Gen-guarded (adversary P1-6): a channel switch mid-await used to
      // land the OLD channel's member rows under the NEW channel's drawer
      // — the stale-bleed class the switch reset exists to prevent.
      const gen = chan_gen.current;
      const m = await hub.members(selected).catch(() => null);
      if (m && gen === chan_gen.current) set_members(m as Array<{ agent_id?: string; about?: string; mission?: string; role?: string }>);
      const b = await hub.list_blocks().catch(() => null);
      if (b && gen === chan_gen.current) set_blocked(b);
    } catch (e: any) {
      set_mod_error(String(e?.message || e || "moderation refused"));
    } finally {
      set_mod_busy("");
    }
  }

  /** Retire an agent (agora 0089; operator dm 15): neutral decommission,
   *  distinct from kick/ban — off all rosters, id reserved, never in the
   *  blocks list. Two-step confirm; feature-detected (404 → not shipped). */
  async function retire_agent(agent_id: string): Promise<void> {
    if (mod_busy) return;
    set_mod_busy(`retire:${agent_id}`);
    set_mod_error("");
    try {
      await hub.retire_agent(agent_id, "decommissioned via Continuum Team page");
      set_mod_nudge("");
      set_notice(`${agent_id} retired (decommissioned — not banned).`);
      setTimeout(() => set_notice(""), 3500);
      const gen = chan_gen.current; // P1-6: no stale-channel bleed
      const m = await hub.members(selected).catch(() => null);
      if (m && gen === chan_gen.current) set_members(m as Array<{ agent_id?: string; about?: string; mission?: string; role?: string }>);
      const r = await hub.retired_agents().catch(() => null);
      if (r && gen === chan_gen.current) set_retired(r);
    } catch (e: any) {
      const status = e?.status;
      const msg = String(e?.message || e || "");
      if (status === 404 || /not found|hub_route_not_allowed/i.test(msg)) {
        set_notice("Agent retire ships with the next hub update — this control is wired and ready for it.");
        setTimeout(() => set_notice(""), 6000);
      } else {
        set_mod_error(msg || "retire refused");
      }
    } finally {
      set_mod_busy("");
    }
  }

  /** Un-retire an agent (agora 0.12.0): restores auth; rejoins are
   *  explicit. Two-step confirm, from the Retired-agents list. */
  async function unretire_agent(agent_id: string): Promise<void> {
    if (mod_busy) return;
    set_mod_busy(`unretire:${agent_id}`);
    set_mod_error("");
    try {
      await hub.unretire_agent(agent_id);
      set_mod_nudge("");
      set_notice(`${agent_id} un-retired — it can rejoin channels explicitly.`);
      setTimeout(() => set_notice(""), 3500);
      const r = await hub.retired_agents().catch(() => null);
      if (r) set_retired(r);
    } catch (e: any) {
      set_mod_error(String(e?.message || e || "un-retire refused"));
    } finally {
      set_mod_busy("");
    }
  }

  /** Hard-delete a retired agent (operator dm 164b, hub 0.12.41): the
   *  irreversible cleanup after retire. Feature-detects — a pre-0.12.41
   *  Hub 404s the route and the failure surfaces honestly. */
  async function delete_retired_agent(agent_id: string): Promise<void> {
    if (mod_busy) return;
    set_mod_busy(`delete:${agent_id}`);
    set_mod_error("");
    try {
      await hub.delete_agent(agent_id);
      set_mod_nudge("");
      set_notice(`${agent_id} deleted from the hub — off every roster and board; its id stays reserved.`);
      setTimeout(() => set_notice(""), 3500);
      const r = await hub.retired_agents().catch(() => null);
      if (r) set_retired(r);
    } catch (e: any) {
      const msg = String(e?.message || e);
      set_mod_error(
        e?.status === 404 || /not found|allowlist/i.test(msg)
          ? "Delete needs the updated hub/console (0.12.41+) — restart the stack to pick it up."
          : /409|active/i.test(msg)
            ? `${agent_id} is still active — retire it first, then delete.`
            : msg || "delete refused"
      );
    } finally {
      set_mod_busy("");
    }
  }

  async function set_channel_state(state: "open" | "closed"): Promise<void> {
    if (chan_admin_busy) return;
    set_chan_admin_busy(true);
    set_mod_error("");
    try {
      // channel:meta is a store key — read-merge-write with CAS so a
      // concurrent meta edit is a clean 409 (rendered verbatim), never a
      // silent overwrite of purpose/norms.
      let value: Record<string, unknown> = { state };
      let version: number | undefined;
      try {
        const cur = await hub.channel_meta(selected);
        if (cur && typeof cur.value === "object" && cur.value) value = { ...cur.value, state };
        if (typeof cur?.version === "number") version = cur.version;
      } catch {
        // no meta yet — create it fresh
      }
      await hub.put_channel_meta(selected, value, version);
      set_notice(state === "closed" ? "Channel closed (member posts refused until reopened)." : "Channel reopened.");
      setTimeout(() => set_notice(""), 3500);
      // Refresh the Members drawer to reflect the new state.
      load_info();
      void refresh_channels();
    } catch (e: any) {
      set_mod_error(String(e?.message || e || "channel state change refused"));
    } finally {
      set_chan_admin_busy(false);
    }
  }

  /** Leave (hide) a DM channel from the rail (operator dm 14). Two-step so
   *  a stray click never drops a conversation; the hub keeps the history,
   *  and a new message from the peer reopens it. */
  const [leave_nudge, set_leave_nudge] = useState("");
  async function leave_dm(channel: string): Promise<void> {
    if (chan_admin_busy) return;
    set_chan_admin_busy(true);
    set_error("");
    try {
      await hub.leave(channel);
      set_leave_nudge("");
      if (selected === channel) set_selected("");
      await refresh_channels();
      set_notice("Direct message removed from your list.");
      setTimeout(() => set_notice(""), 3000);
    } catch (e: any) {
      set_error(String(e?.message || e || "leave refused"));
    } finally {
      set_chan_admin_busy(false);
    }
  }

  /** Archive (safe-delete) a channel (operator dm 19/29; agora 0090):
   *  owner/operator, evicts all members, history preserved. Two-step so a
   *  stray click never archives a live room. Feature-detected: the hub verb
   *  ships with agora's next wave — until then a 404 tells the operator the
   *  control is wired and waiting, never a raw error (his "why isn't this
   *  here?" answered honestly). */
  const [archive_nudge, set_archive_nudge] = useState("");
  async function archive_channel(channel: string): Promise<void> {
    if (chan_admin_busy) return;
    set_chan_admin_busy(true);
    set_error("");
    try {
      await hub.archive(channel);
      set_archive_nudge("");
      if (selected === channel) set_selected("");
      await refresh_channels();
      set_notice(`Channel #${channel} archived (history preserved).`);
      setTimeout(() => set_notice(""), 3500);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      const status = e?.status;
      if (status === 404 || /not found|hub_route_not_allowed/i.test(msg)) {
        // The hub archive verb (0090) hasn't shipped yet — the button is
        // wired and will work the moment it does; say so plainly.
        set_archive_nudge("");
        set_notice("Channel archive ships with the next hub update — this control is wired and ready for it.");
        setTimeout(() => set_notice(""), 6000);
      } else {
        set_error(msg || "archive refused");
      }
    } finally {
      set_chan_admin_busy(false);
    }
  }

  async function create_channel(): Promise<void> {
    const name = new_channel_form.name.trim();
    if (!name || chan_admin_busy) return;
    set_chan_admin_busy(true);
    set_error("");
    try {
      await hub.create_channel(name, new_channel_form.is_private);
      set_new_channel_form({ open: false, name: "", is_private: false });
      await refresh_channels();
      set_selected(name);
      set_notice(`Channel #${name} created.`);
      setTimeout(() => set_notice(""), 3000);
    } catch (e: any) {
      set_error(String(e?.message || e || "channel create refused"));
    } finally {
      set_chan_admin_busy(false);
    }
  }

  /** Accept what the invitation DM actually says: pasting the whole
   *  `join_channel(channel='…', invite_token='…')` sentence into either field
   *  fills both. A bare token or a plain channel name still works. */
  function absorb_invite(text: string): void {
    const ref = parse_invite_ref(text);
    if (!ref.channel && !ref.invite_token) return;
    set_join_form((f) => ({
      open: true,
      channel: ref.channel || f.channel,
      token: ref.invite_token || f.token,
    }));
  }

  async function join_channel(): Promise<void> {
    const channel = join_form.channel.trim().replace(/^#/, "");
    if (!channel || chan_admin_busy) return;
    set_chan_admin_busy(true);
    set_error("");
    try {
      // The hub decides: a private room without a token for THIS seat is
      // refused, and so is an archived one or a blocked seat. Its refusal is
      // shown as-is rather than pre-judged here.
      await hub.join_channel(channel, join_form.token.trim() || undefined);
      set_join_form({ open: false, channel: "", token: "" });
      await refresh_channels();
      set_selected(channel);
      set_notice(`Joined #${channel}.`);
      setTimeout(() => set_notice(""), 3000);
    } catch (e: any) {
      set_error(String(e?.message || e || "join refused"));
    } finally {
      set_chan_admin_busy(false);
    }
  }

  // ------------------------------------------------------------- LLM lanes

  /** One advisor call. Both AI features use the optional injected advisor. */
  async function advisor(question: string, history: TeamAiTurn[]): Promise<string> {
    if (!advisor_fn) throw new Error("AI advisor is not available");
    return advisor_fn(question, history);
  }

  async function summarize_thread(t: Thread): Promise<void> {
    if (!ai_available) return;
    const id = t.root.id;
    const gen = chan_gen.current;
    const count = t.replies.length + 1;
    set_summaries((cur) => ({ ...cur, [id]: { busy: true, text: cur[id]?.text || "", error: "", count } }));
    try {
      const transcript = serialize_transcript([t.root, ...t.replies]);
      const q = `Summarize this hub discussion thread in at most 5 short bullet points: the question or claim, the positions taken, decisions reached, and anything still open. Be concrete — name senders and receipts.\n\nTHREAD TRANSCRIPT:\n${transcript}`;
      const text = await advisor(q, []);
      if (gen !== chan_gen.current) return; // stale channel — drop
      set_summaries((cur) => ({ ...cur, [id]: { busy: false, text, error: "", count } }));
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_summaries((cur) => ({ ...cur, [id]: { busy: false, text: "", error: String(e?.message || e || "summary failed"), count } }));
    }
  }

  async function ask_channel_ai(raw: string): Promise<void> {
    const question = raw.trim();
    if (!question || ai_busy || !ai_available) return;
    const gen = chan_gen.current;
    set_drawer("assistant");
    set_ai_busy(true);
    set_ai_error("");
    set_ai_thread((cur) => [...cur, { role: "user", content: question }]);
    try {
      // Fresh transcript each ask: the model sees the channel as it is NOW
      // (bounded, oldest dropped with a labeled #TRUNCATION header).
      const transcript = serialize_transcript(messages);
      const q = `You are the operator's analyst for the agora hub channel #${selected}. Answer from the transcript below — strategies used, deviations, who owes what, timeline of decisions. Cite message seqs like #123. If the transcript does not contain the answer, say so plainly.\n\nCHANNEL TRANSCRIPT (window):\n${transcript}\n\nQUESTION: ${question}`;
      const text = await advisor(q, ai_thread);
      if (gen !== chan_gen.current) return; // stale channel — drop
      set_ai_thread((cur) => [...cur, { role: "assistant", content: text }]);
    } catch (e: any) {
      if (gen !== chan_gen.current) return;
      set_ai_error(String(e?.message || e || "assistant failed"));
    } finally {
      if (gen === chan_gen.current) set_ai_busy(false);
    }
  }

  /** Declare a thread resolved (operator dm 21 ask 1). The hub's
   *  Status.resolved "closes the topic/thread" — posting a resolved reply
   *  pointed at the root closes it; the operator's own closure is
   *  authoritative in the digest (ADR-0003). Two-step so a stray click
   *  never closes a live discussion. */
  const [resolve_nudge, set_resolve_nudge] = useState("");
  const [resolve_hub_data, set_resolve_hub_data] = useState("");

  /** Retract one of the seat's own messages (operator dm 88; agora 0097).
   *  The hub does the real work (tombstone at every read, obligation
   *  cleared); the console refreshes to render the served redaction —
   *  never fakes it client-side. Pre-0.12.16 hubs 404: the error names
   *  the gate verbatim. */
  const [retract_nudge, set_retract_nudge] = useState("");
  async function retract_message(m: HubMessage): Promise<void> {
    if (posting) return;
    set_posting(true);
    set_error("");
    try {
      await hub.retract_message(selected, m.id);
      set_retract_nudge("");
      set_notice(`#${m.seq} retracted — readers see a tombstone, the words are gone from every agent-facing read.`);
      setTimeout(() => set_notice(""), 4000);
      await refresh_messages(selected, { background: true });
    } catch (e: any) {
      const msg = String(e?.message || e || "retract failed");
      set_error(/404|not found/i.test(msg) ? "Retraction ships with the hub's next bounce (0.12.16) — the running hub predates the verb. Nothing was changed." : msg);
    } finally {
      set_posting(false);
    }
  }

  /** Armed thread retraction (agora 0097 `retract_thread`). Same in-app
   *  confirm idiom as the vfs delete (`fs_del`): a browser `confirm()` is
   *  unstyled and unreadable, and a bare two-click hides a blast radius
   *  this wide. `root` is the thread's root message; `replies` is what THIS
   *  console currently has loaded, shown only as a floor — the hub walks
   *  the real trail from its own rows and may retract more. */
  const [retract_thread_arm, set_retract_thread_arm] = useState<
    { root: HubMessage; replies: number; busy: boolean; error: string } | null
  >(null);

  function arm_thread_retraction(root: HubMessage): void {
    const loaded = messages.filter((m) => m.reply_to === root.id).length;
    set_retract_thread_arm({ root, replies: loaded, busy: false, error: "" });
  }

  async function retract_thread(): Promise<void> {
    const armed = retract_thread_arm;
    if (!armed || armed.busy) return;
    set_retract_thread_arm({ ...armed, busy: true, error: "" });
    try {
      const report = await hub.retract_thread(selected, armed.root.id);
      const count = Number(report?.count || 0);
      set_retract_thread_arm(null);
      set_retract_nudge("");
      set_notice(
        `Thread retracted — ${count} message${count === 1 ? "" : "s"} now read as tombstones on every agent-facing surface.`,
      );
      setTimeout(() => set_notice(""), 4000);
      await refresh_messages(selected, { background: true });
    } catch (e: any) {
      // The hub is the authority: its refusal (403 mixed authorship, 404 on
      // a hub predating the verb) renders VERBATIM. The console never
      // second-guesses it and never retries per message.
      const msg = String(e?.message || e || "retract failed");
      set_retract_thread_arm((cur) =>
        cur
          ? {
              ...cur,
              busy: false,
              error: /404|not found/i.test(msg)
                ? "Thread retraction ships with a newer hub — the running hub predates the verb. Nothing was changed."
                : msg,
            }
          : cur,
      );
    }
  }

  async function resolve_thread(m: HubMessage): Promise<void> {
    if (posting) return;
    let data: Record<string, unknown> | undefined;
    const raw_data = resolve_hub_data.trim();
    if (raw_data) {
      try {
        const parsed = JSON.parse(raw_data);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
        data = parsed as Record<string, unknown>;
      } catch {
        set_error("Completion metadata must be a JSON object. Agora Hub validates its contents.");
        return;
      }
    }
    set_posting(true);
    set_error("");
    try {
      const resolve_to = dm_peer_of(selected, seat);
      // Resolve carries NO discharge field, and that is the hub's own
      // prescription, not an omission. A closure is neither an answer nor a
      // refusal. `status=resolved` MAY carry `answers` since 0152 (a
      // completion report that is itself the answer) — what refuses this
      // particular shape is the pair of rules below: a
      // reply may never discharge the asks of a parent YOU wrote ("your
      // reply can never discharge your own asks — to close your own thread
      // post status=resolved with reply_to it"), and it may not name an ask
      // whose per-ask `to` is another seat — with no operator exemption on
      // that path. Sending `answers` here 400s the single most common
      // Resolve in the product (an asker closing their own open question,
      // which by definition still has pending asks) and, where it lands,
      // credits the resolver under the digest's `answered_by` and hands the
      // asker a to_consume row pointing at the word "Resolved." — the exact
      // inversion 0153 exists to prevent, through the other door.
      //
      // A resolve that leaves `/owed.to_answer` standing is therefore
      // CORRECT unless the hub judges the closure authoritative. If a seat
      // owes an ask, the discharge is to answer it or Decline it; closing
      // the topic is a different act. Whether a non-authoritative resolve
      // should also clear the asker's own row is a hub question, not one
      // this console may answer by asserting a substance claim it knows to
      // be false.
      const posted = await hub.post_message(selected, {
        body: "Resolved.",
        status: "resolved",
        to: resolve_to ? [resolve_to] : undefined,
        reply_to: m.id,
        data,
      });
      remember_rest_cursor(selected, Number(posted?.seq || 0));
      set_resolve_nudge("");
      set_resolve_hub_data("");
      // `debt_map` is the hub's /owed verdict and only re-reads on the BADGE
      // cadence (POLL_MS * BADGE_POLL_EVERY = 30s) — refresh_messages never
      // touches it, so the pill sat stale for up to 30s after a closure.
      // ASK the hub again rather than dropping the pill optimistically: a
      // resolve is authoritative only from the asker or an operator, so
      // guessing "the debt is gone" is a coin flip the console would lose
      // silently — and it would have no way to put the pill back.
      void refresh_owed();
      set_notice(`Marked #${m.seq} resolved.`);
      setTimeout(() => set_notice(""), 3000);
      await refresh_messages(selected, { background: true });
    } catch (e: any) {
      set_error(String(e?.message || e || "Resolve failed"));
    } finally {
      set_posting(false);
    }
  }

  /** Upload picked files as pending attachments (agora 0091). Validates
   *  count + size client-side (mirrors the hub caps), uploads each, appends
   *  the returned refs. Feature-detected: a 404 means the hub verb hasn't
   *  shipped yet — say so, don't throw a raw error. */
  async function on_attach_files(files: FileList | null): Promise<void> {
    if (!files || !files.length || attach_busy) return;
    const picked = Array.from(files);
    if (pending_attachments.length + picked.length > MAX_ATTACH_PER_MSG) {
      set_error(`At most ${MAX_ATTACH_PER_MSG} attachments per message.`);
      return;
    }
    const too_big = picked.find((f) => f.size > MAX_ATTACH_BYTES);
    if (too_big) {
      set_error(`"${too_big.name}" is ${human_size(too_big.size)} — the limit is ${human_size(MAX_ATTACH_BYTES)}.`);
      return;
    }
    // Channel guard (adversary P2 #2): a slow upload started in channel X
    // must not append into channel Y after a switch (which clears pending
    // + bumps the generation). Capture the generation and the channel;
    // drop the resolved ref if either moved on.
    const gen = chan_gen.current;
    const upload_channel = selected;
    set_attach_busy(true);
    set_error("");
    let uploaded = 0;
    try {
      for (const f of picked) {
        const ref = await hub.upload_attachment(upload_channel, f);
        if (gen !== chan_gen.current || selected !== upload_channel) return; // switched away — drop
        set_pending_attachments((cur) => [...cur, ref]);
        uploaded += 1;
      }
    } catch (e: any) {
      const status = e?.status;
      const msg = String(e?.message || e || "");
      if (status === 404 || /not found|hub_route_not_allowed/i.test(msg)) {
        set_notice("Attachments ship with the next hub update — the composer control is wired and ready for it.");
        setTimeout(() => set_notice(""), 6000);
      } else {
        // Name how far the batch got (adversary P2 #7): files before the
        // failure are attached; the rest were not attempted.
        const scope = picked.length > 1 ? ` (${uploaded} of ${picked.length} attached before this)` : "";
        set_error(`${msg || "attachment upload failed"}${scope}`);
      }
    } finally {
      set_attach_busy(false);
      if (attach_input_ref.current) attach_input_ref.current.value = ""; // allow re-picking the same file
    }
  }

  /** The seats an ask is pinned to, or [] for an ask that names nobody
   *  (which the hub treats as the room's, so anyone may discharge it). */
  function ask_to(a: any): string[] {
    return Array.isArray(a?.to) ? a.to.map(String).filter(Boolean) : [];
  }

  /** Is this ask THIS seat's to discharge? (operator commons#75)
   *
   *  Message-level `to` and per-ask `to` are different things, and conflating
   *  them is what produced the refusal in laurent's screenshot: `commons#70`
   *  was addressed to laurent AND agora at the message level, while ask 1
   *  inside it was pinned to agora alone.
   *
   *  Prefers the hub's own subset (`/owed.to_answer[].asks_naming_you`) over
   *  re-deriving it here — an EMPTY served subset is authoritative and means
   *  "no ask here is yours", exactly as the Decline path already reads it.
   *  Falls back to the ask's own `to` only when no /owed row exists at all. */
  function ask_is_mine(m: HubMessage, a: any): boolean {
    const served = owed_asks[m.channel]?.[m.seq];
    if (served) return served.includes(String(a?.id));
    const to = ask_to(a);
    return to.length === 0 || to.includes(seat);
  }

  function start_reply(m: HubMessage): void {
    set_reply_to(m);
    // Single-ask parents default to discharging it (usability critic: the
    // default outcome of a reply was a mechanically void answer) — but ONLY
    // when the ask is this seat's. Ticking it unconditionally is what made
    // laurent's reply to `commons#70` illegal before he typed a word: one
    // ask, pinned to another seat, checked on his behalf, refused at post
    // time with a red banner about ids he never chose (commons#72/#74/#75).
    const asks = m.data?.asks || [];
    set_reply_answers(asks.length === 1 && ask_is_mine(m, asks[0]) ? { [asks[0].id]: true } : {});
    set_post_nudge("");
    set_compose_kind("fyi"); // status becomes "reply" at post time
  }

  function cancel_reply(): void {
    set_reply_to(null);
    set_reply_answers({});
    set_post_nudge("");
  }

  /** The /group gesture (operator directive, agora dm 23; hub semantics
   *  owned by agora — agora chat/CLI 0.12.10 parity): one line with
   *  @mentions → private room named from the topic, purpose set, invites
   *  DM'd to exactly the mentioned seats, topic posted room-wide OPEN
   *  (deliberately NO per-seat asks: invitees are not members yet and the
   *  hub refuses asks naming non-members — the 0.12.11 dead-letter
   *  lesson), then the selector switches into the new room. Two front
   *  doors share this core (operator dm 71): the /group slash command and
   *  the composer's "group" kind. */
  async function run_group(arg: string): Promise<void> {
    const { title: parsed_title, members } = parse_group(arg);
    if (!members.length) {
      set_error("/group: no @mentions found — usage: /group fix the voice outage @relay @core");
      return;
    }
    const title = parsed_title || `focused work with ${members.join(", ")}`;
    await create_group_room({ title, members });
  }

  /** Re-home pending attachments into another channel (operator dm 76/80):
   *  hub attachments are channel-scoped, so bytes are fetched back through
   *  the Hub and re-uploaded (idempotent by content hash). Failures NAME
   *  the file and never abort the caller's flow. */
  async function migrate_attachments(
    source_channel: string,
    target_channel: string,
    atts: HubAttachment[]
  ): Promise<{ migrated: Array<{ id: string; filename?: string }>; att_failed: string[] }> {
    const migrated: Array<{ id: string; filename?: string }> = [];
    const att_failed: string[] = [];
    for (const a of atts) {
      try {
        const blob = await hub.attachment_blob(source_channel, a.id);
        const file = new File([blob], a.filename || "attachment", { type: a.content_type || blob.type || "application/octet-stream" });
        const up = await hub.upload_attachment(target_channel, file);
        migrated.push({ id: up.id, filename: up.filename || a.filename });
      } catch (e: any) {
        att_failed.push(`${a.filename || a.id.slice(0, 8)} (${String(e?.message || e)})`);
      }
    }
    return { migrated, att_failed };
  }

  /** Invite one agent into a channel: mint the token (owner-gated hub-side)
   *  and DM the join pointer — the /group wording, one agent at a time
   *  (operator dm 79). Returns an error string instead of throwing so
   *  callers fold failures into their own notices. */
  async function invite_agent_to(channel: string, peer: string, purpose?: string): Promise<string | null> {
    try {
      const token = await hub.create_invite(channel, peer);
      await hub.send_dm(peer, {
        title: `invite to ${channel}${purpose ? `: ${purpose}` : ""}`.slice(0, 120),
        body:
          `You are invited to '${channel}'${purpose ? ` — ${purpose}` : ""}. ` +
          `Join with join_channel(channel='${channel}', invite_token='${token}'), ` +
          "read the recent messages, and work the topic THERE.",
      });
      return null;
    } catch (e: any) {
      return String(e?.message || e);
    }
  }

  /** Members-drawer invite (operator dm 79). */
  async function run_invite(peer: string): Promise<void> {
    if (!selected || !peer) return;
    set_invite_busy(true);
    set_invite_notice("");
    try {
      const purpose = info && typeof info === "object" && "meta" in info ? String((info as HubChannelInfo).meta?.purpose || "") : "";
      // PUBLIC channels take the no-token path (adversary P1-5): the hub's
      // invite mint is owner-only, so a token invite to a public channel
      // this seat doesn't own 403s — but public channels need no token at
      // all; a plain DM join pointer does it (mention-invite parity).
      const is_private = Boolean(channels_ref.current.find((c) => c.name === selected)?.private);
      let err: string | null = null;
      if (is_private) {
        err = await invite_agent_to(selected, peer, purpose || undefined);
      } else {
        try {
          await hub.send_dm(peer, {
            title: `join ${selected}${purpose ? `: ${purpose}` : ""}`.slice(0, 120),
            body: `You are invited to '${selected}' (public)${purpose ? ` — ${purpose}` : ""}. Join with join_channel(channel='${selected}'), read the recent messages, and work the topic THERE.`,
          });
        } catch (e: any) {
          err = String(e?.message || e);
        }
      }
      if (err) {
        set_invite_notice(
          err.includes("outside the Team page allowlist")
            ? "Invites need the updated console server — one stack restart activates them; nothing was sent."
            : `Invite failed: ${err}`
        );
      } else {
        set_invite_notice(`Invited @${peer} — join pointer DM'd.`);
        set_invite_peer("");
        // Track the awaiting-join state (dm 128): "invited" and "member"
        // are different facts and the drawer must show both.
        add_invited_pending(selected, [peer]);
      }
    } finally {
      set_invite_busy(false);
      setTimeout(() => set_invite_notice(""), 8000);
    }
  }

  /** Mention-to-invite (operator dm 79: "if i do @agent_name, it should
   *  work"): after a post lands, @mentions naming hub agents who are NOT
   *  members get the door opened — private channels mint an invite token
   *  (owner-gated hub-side), public ones get a DM nudge with the join
   *  pointer. Best-effort by design: the post already landed and must
   *  never look failed because an invite couldn't mint. */
  async function invite_mentioned_nonmembers(channel: string, text: string): Promise<void> {
    try {
      const mentioned = parse_group(text).members;
      if (!mentioned.length) return;
      const rows = await hub.members(channel);
      const current = new Set(rows.map((r) => String((r as any).agent_id || "")));
      const targets = mentioned.filter((id) => !current.has(id) && roster.includes(id) && id !== seat);
      if (!targets.length) return;
      const is_private = Boolean(channels_ref.current.find((c) => c.name === channel)?.private);
      const ok: string[] = [];
      const failed: string[] = [];
      for (const id of targets) {
        if (is_private) {
          const err = await invite_agent_to(channel, id);
          if (err) failed.push(`${id} (${err})`);
          else ok.push(id);
        } else {
          try {
            await hub.send_dm(id, {
              title: `you were mentioned in #${channel}`.slice(0, 120),
              body: `You were mentioned in #${channel} (public). Join with join_channel(channel='${channel}') and read the recent messages.`,
            });
            ok.push(id);
          } catch (e: any) {
            failed.push(`${id} (${String(e?.message || e)})`);
          }
        }
      }
      if (ok.length) {
        add_invited_pending(channel, ok); // awaiting-join facts (P1-3)
        set_notice(`Posted — @${ok.join(", @")} ${is_private ? "invited" : "nudged"} (mentioned, not yet member${ok.length === 1 ? "" : "s"}).`);
      }
      if (failed.length) {
        set_error(
          failed.some((f) => f.includes("outside the Team page allowlist"))
            ? "Posted; inviting mentioned non-members needs the updated console server (one stack restart)."
            : `Posted; invite failed for ${failed.join("; ")}.`
        );
      }
    } catch {
      // Best-effort: never let mention-invites fail a landed post.
    }
  }

  async function create_group_room(opts: { title: string; members: string[]; opening_body?: string }): Promise<void> {
    const { title, members } = opts;
    // Pending attachments were uploaded to the CURRENT channel; they ride
    // the group's opening post by migration (fetch bytes from the Hub,
    // re-upload into the new room — idempotent by content hash). The old
    // refusal made "create a room WITH screenshots" impossible (operator
    // dm 76); channel-scoping is our constraint to absorb, not his.
    const to_migrate = [...pending_attachments];
    const source_channel = selected;
    set_posting(true);
    set_error("");
    try {
      // Slug uniqueness is best-effort against the rooms this seat can
      // see; an invisible private-room collision surfaces as the hub's
      // own create refusal (loud, named), never a silent reuse.
      const taken = new Set(channels_ref.current.map((c) => c.name));
      const name = group_slug(title, taken);
      let invited: string[] = [];
      let failed: string[] = [];
      // ONE-CALL PATH (agora dm#43, hub 0.12.29): POST /groups does
      // create + purpose meta + per-member invite DMs (uniform fyi, token
      // in data) + the opening post — the hub owns the recipe, so the
      // invite-status drift between clients ends at the root. Older hub
      // or older Hub => 404 => the original
      // 4-call macro below, labeled #FALLBACK.
      let one_call = false;
      try {
        const res = await hub.create_group({ name, members, purpose: title, opening_post: opts.opening_body?.trim() || title, private: true });
        one_call = true;
        invited = Array.isArray(res?.invited) ? res.invited.map(String) : members;
        // Hub failed[] rows carry {agent, error} (service.py contract —
        // adversary P1-2: the old member/peer keys rendered every failed
        // invitee as "?", dropping the one thing needed to retry).
        failed = Array.isArray(res?.failed) ? res.failed.map((f: any) => (typeof f === "string" ? f : `${f?.agent || f?.member || f?.peer || "?"} (${String(f?.error || f?.detail || "failed")})`)) : [];
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        const absent = e?.status === 404 || msg.includes("outside the Team page allowlist") || msg.includes("Not Found");
        if (!absent) throw e; // real refusal (name collision etc.) — surface it
        // #FALLBACK: pre-0.12.29 Hub — the
        // 4-call macro. Preflight the invite route BEFORE creating
        // anything (an old Hub might create the room, then fail every
        // invite — a half-configured room nobody can join).
        try {
          await hub.create_invite("__group-preflight__", members[0]);
        } catch (pe: any) {
          if (String(pe?.message || pe).includes("outside the Team page allowlist")) {
            set_error("/group needs the updated console server — this process predates the invite route. Restart the console (next stack restart picks it up) and retry; nothing was created.");
            return;
          }
          // Any other refusal (channel not found) = the route is live.
        }
        await hub.create_channel(name, true);
        await hub.put_channel_meta(name, { purpose: title }, 0);
        for (const peer of members) {
          try {
            const token = await hub.create_invite(name, peer);
            await hub.send_dm(peer, {
              title: `invite to ${name}: ${title}`.slice(0, 120),
              body:
                `You are invited to '${name}' — focused room: ${title}. ` +
                `Join with join_channel(channel='${name}', invite_token='${token}'), ` +
                "read the opening post, and work the topic THERE (not in commons).",
            });
            invited.push(peer);
          } catch (ie: any) {
            failed.push(`${peer} (${String(ie?.message || ie)})`);
          }
        }
      }
      // Attachment migration (operator dm 76: "no reason i could not
      // create a room WITH SCREENSHOTS"): pending uploads carry over into
      // the new room; a failure names the file and continues — the room +
      // text must never be lost to one bad blob.
      const { migrated, att_failed } = await migrate_attachments(source_channel, name, to_migrate);
      // Opening post: the one-call path already posted it (without
      // migrated attachments — they upload AFTER the room exists); ship
      // migrated files as a follow-up post there, or the full opening
      // post on the macro path.
      if (!one_call) {
        await hub.post_message(name, {
          body: opts.opening_body?.trim() || title,
          title: title.slice(0, 120),
          status: "open",
          attachments: migrated.length ? migrated : undefined,
        });
      } else if (migrated.length) {
        await hub.post_message(name, {
          body: "Attachments carried over from the create request.",
          status: "fyi",
          attachments: migrated,
        });
      }
      // The awaiting-join facts follow the group lane too (adversary
      // P1-3: the dm-128 confusion recurred verbatim in the flow that
      // invites MOST agents — new room, one member, zero pending rows).
      add_invited_pending(name, invited);
      set_notice(
        `Room '${name}' created — private, ${invited.length} invited${invited.length ? `: ${invited.join(", ")}` : ""}.` +
          (migrated.length ? ` ${migrated.length} attachment(s) carried over.` : "") +
          (failed.length ? ` Invite FAILED for ${failed.join("; ")}.` : "")
      );
      if (failed.length) set_error(`Some invites failed — ${failed.join("; ")}. Mint them again from the room's Members drawer or re-run /group.`);
      if (att_failed.length) set_error(`Attachment carry-over failed for ${att_failed.join("; ")} — the room and post were created; re-attach in the new room.`);
      set_compose_text("");
      set_compose_title("");
      set_group_members_text("");
      set_compose_kind("fyi");
      set_pending_attachments([]);
      delete drafts.current[selected];
      save_drafts(drafts.current);
      await refresh_channels();
      set_selected(name);
      setTimeout(() => set_notice(""), 6000);
    } catch (e: any) {
      set_error(`group creation failed: ${String(e?.message || e)}`);
    } finally {
      set_posting(false);
    }
  }

  async function post(): Promise<void> {
    const body = compose_text.trim();
    // An attachment-only message is valid (the hub accepts a body-less
    // post) — the Send button + Enter enable on pending attachments, so the
    // guard must too, or "attach an image, hit Send" silently no-ops
    // (adversary P1). Slash-command/nudge logic below all key on a
    // non-empty body, so they're naturally skipped for an attachment-only
    // post.
    const has_attachments = pending_attachments.length > 0;
    const in_group_kind = !reply_to && !selected.startsWith("dm:") && compose_kind === "group";
    // Group creation is legitimately body-less (the opening post falls
    // back to the title) — the empty-guard must not swallow it.
    if ((!body && !has_attachments && !in_group_kind) || posting || !selected) return;
    if (in_group_kind) {
      if (compose_hub_data.trim()) {
        set_error("Hub data belongs on a message. Create the room first, then post the metadata in that room.");
        return;
      }
      const members = parse_member_list(group_members_text);
      if (!members.length) {
        set_error("Group needs at least one member — write their names like: @entity @assistant");
        return;
      }
      const title = compose_title.trim() || (body ? body.split("\n")[0].slice(0, 80) : `focused work with ${members.join(", ")}`);
      await create_group_room({ title, members, opening_body: body });
      return;
    }
    // "/assistant <question>" routes to the channel analyst — it never
    // posts to the room (the AI is a read surface). Any OTHER slash
    // command is refused rather than posted publicly (adversary find:
    // "/assistantfoo" used to post to the room under the operator seat).
    if (/^\/assistant(?=\s|$)/i.test(body)) {
      if (!ai_available) {
        set_error("AI advisor is not configured by this host.");
        return;
      }
      const q = body.replace(/^\/assistant/i, "").trim();
      set_compose_text("");
      if (q) void ask_channel_ai(q);
      else set_drawer("assistant");
      return;
    }
    // "/group <topic> @seat @seat" — focused private room (operator
    // directive via agora dm 23; parity with agora chat/CLI 0.12.10).
    if (/^\/group(?=\s|$)/i.test(body)) {
      await run_group(body.replace(/^\/group/i, "").trim());
      return;
    }
    if (/^\//.test(body)) {
      set_error(`Unknown command "${body.split(/\s/)[0]}" — only /assistant and /group are supported. Remove the leading "/" to post this as a message.`);
      return;
    }
    const answers = Object.entries(reply_answers)
      .filter(([, v]) => v)
      .map(([k]) => k);
    let data: Record<string, unknown> | undefined;
    const raw_data = compose_hub_data.trim();
    if (raw_data) {
      try {
        const parsed = JSON.parse(raw_data);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
        data = parsed as Record<string, unknown>;
      } catch {
        set_error("Hub data must be a JSON object. Agora Hub validates its contents.");
        return;
      }
    }
    // Inside a dm channel every post is a plain message to the peer —
    // the kind machinery applies only to regular channels.
    const in_dm = selected.startsWith("dm:");
    // Inline nudges (one each; the second Post proceeds): a reply that
    // discharges nothing leaves the ask formally open on the hub; an
    // untitled open violates headline-triage etiquette.
    if (reply_to && (reply_to.data?.asks || []).length && !answers.length && post_nudge !== "void_reply") {
      set_post_nudge("void_reply");
      return;
    }
    if (!reply_to && !in_dm && compose_kind === "ask" && !compose_title.trim() && post_nudge !== "untitled_open") {
      set_post_nudge("untitled_open");
      return;
    }
    if (!reply_to && !in_dm && compose_kind === "dm" && !dm_peer.trim()) {
      set_error("Pick a recipient for the direct message.");
      return;
    }
    set_posting(true);
    set_error("");
    // The post is async, so the operator can switch rooms while it is in
    // flight — and on a stalled hub that window is long. Everything else on
    // this path already rides chan_gen; the composer RESET did not, so the
    // clear below landed on whatever room he had switched to, blanking the
    // draft he was typing there and (300ms later, via the prune) deleting it
    // from localStorage too. The generation discriminates the two cases: a
    // switch during the await has already bumped it in the [selected]
    // effect, while this handler's OWN navigation (the dm and group lanes
    // call set_selected below) has not yet been committed when the reset
    // runs — so those still clear, as they must.
    const gen = chan_gen.current;
    try {
      if (!reply_to && !in_dm && compose_kind === "dm") {
        // Direct message: opens dm:<a>--<b> (sorted pair) on first use —
        // jump INTO it so the sent message is visible, not fired into the
        // void (self-caught UX gap). Attachments were uploaded to the
        // SOURCE channel; the dm channel exists only after the first
        // message, so the text goes first and the files MIGRATE into the
        // dm as a follow-up message (operator dm 80 — same fix class as
        // room creation; refusing was our scoping dumped on the operator).
        const peer = dm_peer.trim();
        const dm_atts = [...pending_attachments];
        const dm_source = selected;
        await hub.send_dm(peer, {
          body: body || (dm_atts.length ? `(${dm_atts.length} attachment${dm_atts.length === 1 ? "" : "s"})` : body),
          title: compose_title.trim() || undefined,
          data,
        });
        const dm_name = `dm:${[seat, peer].sort().join("--")}`;
        if (dm_atts.length) {
          const { migrated, att_failed } = await migrate_attachments(dm_source, dm_name, dm_atts);
          if (migrated.length) {
            await hub.post_message(dm_name, { body: "", to: [peer], attachments: migrated });
          }
          set_notice(`DM sent to ${peer}${migrated.length ? ` with ${migrated.length} attachment(s)` : ""}.`);
          if (att_failed.length) set_error(`Attachment carry-over failed for ${att_failed.join("; ")} — the DM text was sent; re-attach inside the conversation.`);
        } else {
          set_notice(`DM sent to ${peer}.`);
        }
        await refresh_channels();
        set_selected(dm_name);
      } else {
        // Attachments (agora 0091) ride posts that land in `selected` —
        // where they were uploaded (the hub validates id-in-THIS-channel).
        // The dm-initiation and group branches migrate instead, so scope
        // always matches here.
        const att = pending_attachments.map((a) => ({ id: a.id, filename: a.filename }));
        // In-dm posts ADDRESS the counterpart (operator dm 84: "dm are NOT
        // fyi") and post ask-class (dm 86: "every dm to an agent MUST be
        // received and interpreted as an ask"). The hub's native /dms
        // route auto-sets to=[peer]; the generic channel route does not —
        // an unaddressed dm reads as ambient fyi to --important-only
        // listeners and sits unanswered for hours (lived it: dm 84 itself
        // never woke this seat).
        const dm_to = in_dm ? dm_peer_of(selected, seat) : "";
        if (in_dm && !dm_to) {
          // Seat outside the pair (misconfig / legacy channel name): the
          // post still goes out ask-class but owed-by-nobody — say so
          // instead of silently degrading (adversarial find 6).
      set_error(`#FALLBACK this dm's pair does not include seat '${seat}' — sent unaddressed (no to-me wake; check the Hub seat identity).`);
        }
        const payload = {
          body,
          title: compose_title.trim() || undefined,
          status: compose_status({ is_reply: Boolean(reply_to), in_dm, kind: compose_kind }),
          to: dm_to ? [dm_to] : undefined,
          reply_to: reply_to?.id,
          answers: reply_to && answers.length ? answers : undefined,
          data,
          attachments: att.length ? att : undefined,
        };
        let posted: any;
        try {
          posted = await hub.post_message(selected, payload);
        } catch (e: any) {
          // Peer left the dm channel: addressing them 400s ("cannot
          // address non-members"). Deliver unaddressed rather than
          // breaking sending entirely — with a visible warning, since
          // the to-me wake is lost (adversarial find 3).
          if (dm_to && /address non-members/i.test(String(e?.message || e))) {
            posted = await hub.post_message(selected, { ...payload, to: undefined });
            set_error(`#FALLBACK '${dm_to}' is no longer a member of this dm — message delivered unaddressed (their listener will not get a to-me wake).`);
          } else {
            throw e;
          }
        }
        // The Hub intentionally does not echo a seat's own WS frames. Fold
        // the authoritative REST post receipt into the reconnect cursor so
        // a peer's next envelope cannot look like a false dropped-frame gap.
        remember_rest_cursor(selected, Number(posted?.seq || 0));
        set_notice(in_dm ? "Sent." : "Posted.");
        await refresh_messages(selected, { background: true });
        // Mention-to-invite rides AFTER the landed post (operator dm 79) —
        // fire-and-forget, its own notices; never blocks or fails the send.
        if (!in_dm && body) void invite_mentioned_nonmembers(selected, body);
      }
      // CHANNEL-scoped, so it runs whatever the operator is now looking at:
      // the draft belongs to the room posted TO, and leaving it behind would
      // resurrect a sent message on the next reload.
      delete drafts.current[selected];
      save_drafts(drafts.current); // the sent draft must not resurrect on reload
      // VIEW-scoped: these clear the box on screen. If the operator switched
      // rooms during the post, that box is a different room's and holds a
      // different draft — clearing it is data loss, not cleanup.
      if (gen === chan_gen.current) {
        set_compose_text("");
        set_compose_title("");
        set_compose_hub_data("");
        set_show_compose_hub_data(false);
        set_pending_attachments([]);
        set_reply_to(null);
        set_reply_answers({});
        set_compose_kind("fyi");
        set_dm_peer(""); // a stale recipient must never ride into the next send
        set_post_nudge("");
      }
      setTimeout(() => set_notice(""), 3000);
    } catch (e: any) {
      const msg = String(e?.message || e || "Post failed");
      set_error(msg);
      // The charter gate (409, `channel:meta.norms_required`) refuses the
      // post until this seat has read the room's current charter. The
      // refusal names the MCP call that clears it, which is not a thing a
      // console user can type — so re-read /owed, whose charter row IS the
      // console's version of that instruction: a chip that opens the
      // charter and records the receipt.
      if (/requires reading its charter/i.test(msg)) void refresh_owed();
      // The RULINGS gate (409, `channel:meta.rulings_required`, hub 0113)
      // is the same shape one tier up: the refusal names GET .../digest and
      // POST .../ruling-acks, neither of which a console user can type.
      // Re-read the digest so the unacknowledged rows — and the button that
      // clears them — appear instead of a dead-ended raw error.
      if (/acknowledging standing rulings/i.test(msg)) void refresh_rulings(selected);
    } finally {
      set_posting(false);
    }
  }

  /** Ack the channel cursor to a target seq. Backlog 0010 (ack-to-last-
   *  visible): under an active filter the target is the last VISIBLE
   *  message, not the window's latest — acking past rows a filter hid was
   *  the imprecision the adversary flagged. */
  async function mark_read_to(target_seq: number): Promise<void> {
    if (!selected || !target_seq || ack_busy || loading) return;
    set_ack_busy(true);
    try {
      await hub.ack(selected, target_seq);
      set_notice(`Marked read to #${target_seq}.`);
      setTimeout(() => set_notice(""), 3000);
      void refresh_badges(channels_ref.current);
    } catch (e: any) {
      set_error(String(e?.message || e || "Ack failed"));
    } finally {
      set_ack_busy(false);
    }
  }

  // Paused hub: fail at the composer, not on submit (usability critic F13).
  const can_post = Boolean(meta?.seat_key_present) && !health?.paused;
  const seat = meta?.seat || "";
  /** The HUB's answer about this seat (`/whoami.operator`), used for
   *  VISIBILITY only: an operator sees the retract controls on messages
   *  that are not theirs, because the hub would honor them. It is NOT an
   *  authorization check — the console never decides who may retract; it
   *  calls, and a refusal renders verbatim. An older hub omitting the field
   *  reads false, which merely hides a control the hub would have allowed. */
  const is_operator = Boolean(meta?.operator);
  /** Inside a dm:* channel the composer IS a dm — no type selector
   *  (operator dm 9: "if it's a direct message, it's a dm"). Peer label:
   *  the name is dm:<a>--<b> (sorted pair), and agent ids may THEMSELVES
   *  contain "--", so strip the seat as a prefix/suffix instead of
   *  re-splitting (a naive split corrupted "foo--bar" → "foobar"). */
  const is_dm_channel = selected.startsWith("dm:");
  const dm_display_peer = (() => {
    if (!is_dm_channel) return "";
    const pair = selected.slice(3);
    if (seat && pair.startsWith(`${seat}--`)) return pair.slice(seat.length + 2);
    if (seat && pair.endsWith(`--${seat}`)) return pair.slice(0, pair.length - seat.length - 2);
    return pair || selected;
  })();

  /** Ids in the window already answered by another party (chip calm-down;
   *  see replied_ids). */
  const window_replied_ids = useMemo(() => replied_ids(messages), [messages]);

  const filter_ctx: FilterContext = useMemo(
    () => ({
      seat,
      unread_seqs: unread_map[selected],
      // The Hub's own owed verdict drives vigilance (see FilterContext).
      debt_seqs: debt_map[selected],
      unread_snapshot_seqs: filter === "unread" ? unread_snapshot || undefined : undefined,
      // Hub escalation axes for the vigilance filter (backlog 0010).
      escalated_seqs: escalation_map[selected],
      to_me_seqs: to_me_map[selected],
    }),
    [seat, unread_map, selected, filter, unread_snapshot, escalation_map, to_me_map, debt_map]
  );
  /** Live group preview (agora dm 23 + operator dm 71): derived room slug
   *  + roster, from EITHER front door — the /group slash command in the
   *  text, or the composer's "group" kind fields. Usage hint when the
   *  roster is empty. */
  const group_preview = useMemo(() => {
    if (reply_to) return null;
    const taken = new Set(channels.map((c) => c.name));
    const text = compose_text.trimStart();
    if (/^\/group(\s|$)/i.test(text)) {
      const { title, members } = parse_group(text.replace(/^\/group/i, "").trim());
      const t = title || (members.length ? `focused work with ${members.join(", ")}` : "");
      return { name: t ? group_slug(t, taken) : "group", members, source: "slash" as const };
    }
    if (compose_kind === "group" && !selected.startsWith("dm:")) {
      const members = parse_member_list(group_members_text);
      const t = compose_title.trim() || (members.length ? `focused work with ${members.join(", ")}` : "");
      return { name: t ? group_slug(t, taken) : "group", members, source: "kind" as const };
    }
    return null;
  }, [compose_text, reply_to, channels, compose_kind, group_members_text, compose_title, selected]);

  const threads = useMemo(() => group_threads(messages), [messages]);
  const visible_threads = useMemo(() => filter_threads(threads, filter, filter_ctx), [threads, filter, filter_ctx]);

  // ------------------------------------------------- top-voted sort mode
  // Sort-by-votes (laurent dm#137, hub ≥ 0.12.34): the hub serves the
  // WHOLE channel's top-N by net standing rating, flat and pre-ranked —
  // render served order, never re-sort locally (my pager only sees a
  // window; the hub sees the channel). Recency stays the default; the
  // param fires only on toggle.
  const [sort_mode, set_sort_mode] = useState<"recency" | "votes">("recency");
  const [top_rows, set_top_rows] = useState<HubMessage[] | null>(null);
  const top_rows_ref = useRef<HubMessage[] | null>(null);
  useEffect(() => {
    top_rows_ref.current = top_rows;
  }, [top_rows]);
  const [top_error, set_top_error] = useState("");
  function load_top_rated(): void {
    const gen = chan_gen.current;
    set_top_rows(null);
    set_top_error("");
    hub
      .messages(selected, { sort: "votes", limit: 50 })
      .then((rows) => {
        if (gen !== chan_gen.current) return;
        set_top_rows(rows);
      })
      .catch((e: any) => {
        if (gen !== chan_gen.current) return;
        const msg = String(e?.message || e);
        set_top_error(
          e?.status === 400 || e?.status === 404 || /allowlist/i.test(msg)
            ? "Top-voted needs the next hub update (this hub predates sort=votes) — Recency still works."
            : msg
        );
      });
  }
  /** Jump from a ranked row back to its thread context: arm the existing
   *  focus anchor, flip to recency, and consume (same-channel jump). */
  function jump_to_thread(m: HubMessage): void {
    focus_anchor.current = { message_id: m.id, seq: m.seq };
    set_sort_mode("recency");
    requestAnimationFrame(() => consume_focus_anchor());
  }

  // ------------------------------------------------- hub-wide search (0132)
  // GET /search (hub ≥ 0.12.44 `search-grouped`, operator dm#166): the hub
  // serves a membership-scoped GROUPED report — six fixed sections, the
  // grouping IS the task-context digest. The console renders served truth:
  // no client index, no re-ranking, no score (the hub deliberately serves
  // none). Feature detection follows the house pattern (sort=votes): try,
  // and a 404/allowlist refusal degrades to a named "hub predates search"
  // line. Relevance mode never pages (top-K; re-query to go deeper);
  // per-section "view all" pivots into sort=recent + kind, which pages by
  // opaque keyset cursor.
  const [search_q, set_search_q] = useState("");
  const [search_scope, set_search_scope] = useState<"all" | "channel">("all");
  /** v2 rated lens (agora-0134, hub ≥ 0.12.45 `search-blended`): filter
   *  message hits by standing ratings. "" = off; up/down = the lens; with
   *  an EMPTY query this is BROWSE mode ("most downvoted" costs one chip)
   *  and rides sort=votes (net desc) — with a query, relevance still
   *  ranks and rated only filters. */
  const [search_rated, set_search_rated] = useState<"" | "up" | "down">("");
  const [search_view, set_search_view] = useState<null | { q: string; report: HubSearchReport | null; error: string; busy: boolean }>(null);
  const [search_section, set_search_section] = useState<null | {
    label: string;
    kind: string;
    hits: HubSearchHit[];
    total: number;
    cursor: string | null;
    busy: boolean;
    error: string;
  }>(null);
  /** Monotonic guard: search is CHANNEL-AGNOSTIC (hub-wide), so it must not
   *  ride chan_gen — its own counter keeps a slow older response from
   *  clobbering a newer query's result. */
  const search_gen = useRef(0);
  /** The ONE search executor (submit, scope toggle, rated chips all call
   *  it) — duplicated fetch closures drifted once already (scope re-run). */
  function exec_search(q: string, scope: "all" | "channel", rated: "" | "up" | "down"): void {
    if (!q && !rated) return; // empty box, no lens — nothing to browse
    const gen = ++search_gen.current;
    set_search_section(null);
    set_search_view({ q, report: null, error: "", busy: true });
    hub
      .search({
        q,
        channel: scope === "channel" && selected ? [selected] : undefined,
        rated: rated || undefined,
        // Browse mode (no query): net-votes ranking is the meaningful
        // order. With a query, relevance ranks and rated only filters.
        sort: !q && rated ? "votes" : undefined,
      })
      .then((report) => {
        if (gen !== search_gen.current) return;
        set_search_view({ q, report, error: "", busy: false });
      })
      .catch((e: any) => {
        if (gen !== search_gen.current) return;
        const msg = String(e?.message || e);
        set_search_view({
          q,
          report: null,
          busy: false,
          error:
            e?.status === 404 || /allowlist/i.test(msg)
              ? "Search needs the next hub update (this hub predates search-grouped) — everything else still works."
              : msg,
        });
      });
  }
  function run_search(raw_q: string): void {
    exec_search(raw_q.trim(), search_scope, search_rated);
  }
  function close_search(): void {
    search_gen.current += 1; // invalidate any in-flight response
    set_search_view(null);
    set_search_section(null);
    set_search_rated("");
  }
  /** Per-section "view all": pivot into sort=recent + this section's kind —
   *  the ONE mode the hub pages (opaque keyset cursor, limit ≤ 50). */
  function open_search_section(label: string, kind: string): void {
    const q = search_view?.q || "";
    if (!q && !search_rated) return;
    const gen = ++search_gen.current;
    set_search_section({ label, kind, hits: [], total: 0, cursor: null, busy: true, error: "" });
    hub
      .search({ q, kind, sort: "recent", limit: 50, rated: search_rated || undefined, channel: search_scope === "channel" && selected ? [selected] : undefined })
      .then((report) => {
        if (gen !== search_gen.current) return;
        const sec = section_of(report, kind);
        set_search_section({ label, kind, hits: sec.hits, total: sec.total, cursor: report.next_cursor ?? null, busy: false, error: "" });
      })
      .catch((e: any) => {
        if (gen !== search_gen.current) return;
        set_search_section({ label, kind, hits: [], total: 0, cursor: null, busy: false, error: String(e?.message || e) });
      });
  }
  function load_more_search_section(): void {
    const cur = search_section;
    const q = search_view?.q || "";
    if (!cur || !cur.cursor || cur.busy || (!q && !search_rated)) return;
    const gen = search_gen.current; // same view — no bump, but stale-check
    set_search_section({ ...cur, busy: true });
    hub
      .search({ q, kind: cur.kind, sort: "recent", limit: 50, cursor: cur.cursor, rated: search_rated || undefined, channel: search_scope === "channel" && selected ? [selected] : undefined })
      .then((report) => {
        if (gen !== search_gen.current) return;
        const sec = section_of(report, cur.kind);
        set_search_section((prev) =>
          prev && prev.kind === cur.kind
            ? { ...prev, hits: [...prev.hits, ...sec.hits], cursor: report.next_cursor ?? null, busy: false }
            : prev
        );
      })
      .catch((e: any) => {
        if (gen !== search_gen.current) return;
        set_search_section((prev) => (prev && prev.kind === cur.kind ? { ...prev, busy: false, error: String(e?.message || e) } : prev));
      });
  }
  /** The hub folds single-kind queries into that kind's own section — pick
   *  it by the section's declared kind (open_threads has none). */
  function section_of(report: HubSearchReport, kind: string): { hits: HubSearchHit[]; total: number } {
    const meta = SEARCH_SECTIONS.find((s) => s.kind === kind);
    const sec = meta ? report[meta.id] : undefined;
    return sec ? { hits: sec.hits || [], total: sec.total || 0 } : { hits: [], total: 0 };
  }
  /** Message hits jump to their thread (cross-channel: the focus-anchor +
   *  set_selected pair the Board already uses). The
   *  search view closes — the jump's whole point is thread context. */
  function jump_to_search_hit(hit: HubSearchHit): void {
    const channel = String(hit.channel || "");
    if (!channel) return;
    focus_anchor.current = { message_id: hit.kind === "message" ? hit.ref : undefined, seq: hit.seq ?? undefined };
    close_search();
    set_sort_mode("recency");
    if (channel === selected) consume_focus_anchor();
    else set_selected(channel);
  }
  /** File hits open the shared viewer directly against the HIT's channel
   *  (the Files-drawer opener is bound to `selected`; a cross-channel hit
   *  must read where it lives). Membership is enforced hub-side — a
   *  non-member read refuses loudly and the viewer shows the error. */
  async function open_search_file(hit: HubSearchHit): Promise<void> {
    const channel = String(hit.channel || "");
    const path = String(hit.ref || "");
    if (!channel || !path) return;
    const mode0 = resolve_file_mode(path, "text/markdown");
    set_file_view({ name: path, mode: mode0 === "image" ? "text" : mode0, meta: `#${channel}`, loading: true });
    try {
      const f = await hub.fs_read(channel, path);
      const resolved = resolve_file_mode(path, f.mime);
      set_file_view({
        name: path,
        mode: resolved === "image" ? "text" : resolved,
        text: clamp_preview(f.content),
        content_type: f.mime,
        meta: `#${channel} · ${f.updated_by || "?"} · v${f.version ?? "?"}`,
        loading: false,
      });
    } catch (e: any) {
      set_file_view({ name: path, mode: "text", meta: `#${channel}`, error: String(e?.message || e || "failed to read file") });
    }
  }
  /** One search hit. SearchHit is a SIBLING of MessageRow (shared field
   *  names) — but it carries NO body by contract (no stale copies), so the
   *  row renders snippet + highlights, never render_msg. Highlights are
   *  code-point offsets into the served snippet (snippet_spans handles the
   *  UTF-16 drift); the mark is client-drawn — the hub never serves HTML.
   *  Message hits jump to their thread; file hits open the shared viewer;
   *  decision/work/people rows are informational in v1 (their read paths
   *  are not on this surface yet). */
  function render_search_hit(hit: HubSearchHit): React.ReactElement {
    const is_msg = hit.kind === "message" && Boolean(hit.channel);
    const is_file = hit.kind === "file" && Boolean(hit.channel);
    const clickable = is_msg || is_file;
    const spans = snippet_spans(String(hit.snippet || ""), hit.highlights);
    const rt = hit.ratings;
    const chan = String(hit.channel || "");
    const chan_label = chan ? (chan.startsWith("dm:") ? chan : `#${chan}`) : "";
    return (
      <div
        key={`${hit.kind}:${chan}:${hit.ref}`}
        className={`team_search_hit${clickable ? " clickable" : ""}`}
        onClick={clickable ? () => (is_file ? void open_search_file(hit) : jump_to_search_hit(hit)) : undefined}
        role={clickable ? "button" : undefined}
        title={is_msg ? "Open this message in its thread" : is_file ? "Open this file" : undefined}
      >
        <div className="team_search_hit_head">
          {hit.kind !== "message" ? <span className="team_search_kind mono">{hit.kind}</span> : null}
          {chan_label ? <span className="team_search_chan mono">{chan_label}</span> : null}
          {hit.sender ? (
            <span className="team_search_sender" style={{ color: `hsl(${sender_hue(String(hit.sender))}, 60%, 55%)` }}>
              {hit.sender}
            </span>
          ) : null}
          {typeof hit.seq === "number" && hit.seq > 0 ? <span className="muted mono">#{hit.seq}</span> : null}
          {hit.status === "open" || hit.status === "blocked" ? (
            <span className="team_search_status mono" title="This thread still carries an unresolved obligation">
              {hit.status}
            </span>
          ) : null}
          {typeof hit.thread_hits === "number" && hit.thread_hits > 1 ? (
            <span className="muted" title="More matches in the same thread">
              {hit.thread_hits} in thread
            </span>
          ) : null}
          {rt && (rt.up || rt.down) ? (
            <span className="team_search_tally" title="Standing ±1 ratings on this message (read-only here — vote from the thread)">
              <Icon name="thumbsUp" size={12} />{rt.up} <Icon name="thumbsDown" size={12} />{rt.down}
            </span>
          ) : null}
          {hit.created_at ? <span className="muted team_search_time">{abs_time(hit.created_at)}</span> : null}
        </div>
        {String(hit.title || "").trim() ? <div className="team_search_title">{hit.title}</div> : null}
        {spans.length ? (
          <div className="team_search_snippet">
            {spans.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
          </div>
        ) : null}
        {!is_msg && !is_file && hit.kind !== "agent" ? <div className="team_search_ref mono muted">{hit.ref}</div> : null}
      </div>
    );
  }
  /** Highest seq currently VISIBLE under the active filter (backlog 0010:
   *  "Mark read" targets what the operator can actually see). */
  const visible_max_seq = useMemo(() => {
    let max = 0;
    for (const t of visible_threads) for (const m of [t.root, ...t.replies]) max = Math.max(max, m.seq || 0);
    return max;
  }, [visible_threads]);
  /** Per-filter counts for every triage tab (operator dm 90: a filter
   *  that hides its own weight makes the operator click to find out —
   *  and Resolved showing NO number read as "resolved never works").
   *  UNIT RULE (dm 90's real complaint): the Unread tab counts MESSAGES —
   *  the same unit and source as the channel rail badge — so the two
   *  numbers agree; the other tabs count THREADS (what the filter lists).
   *  Tooltips on the tabs name the unit. */
  const filter_counts = useMemo(() => {
    const out: Partial<Record<TeamFilter, number>> = {};
    for (const f of ["asks", "vigilance", "fyi", "resolved", "to_me"] as TeamFilter[]) {
      out[f] = filter_threads(threads, f, filter_ctx).length;
    }
    out.unread = messages.filter((m) => filter_ctx.unread_seqs?.has(m.seq) || filter_ctx.unread_snapshot_seqs?.has(m.seq)).length;
    return out;
  }, [threads, messages, filter_ctx]);

  // ------------------------------------------------------------ renderers

  /** Attachments on a message (agora 0091). Raster images (declared-type
   *  allowlist, never SVG) render inline via the Hub URL with an onError
   *  fallback to a download chip; everything else — pdf, docs, svg,
   *  unknown — is a download chip only. Safety is the ELEMENT, not a
   *  byte-sniff: <img> cannot execute for any bytes, the hub octet-streams
   *  active types + sets nosniff + attachment disposition, and a mislabeled
   *  non-image just fails decode and falls back to the chip. The declared
   *  type only picks inline-vs-chip within that safe boundary. */
  /** Channel About + members + moderation + lifecycle — the body of the
   *  Members drawer (operator dm 55: members are their own drawer now). */
  function render_about_body(): React.ReactNode {
    if (info === "loading") return <span className="muted team_note">Loading channel info…</span>;
    if (info && typeof info === "object" && "error" in info) return <span className="page_error mono">{info.error}</span>;
    if (!info) return <span className="muted team_note">Open a channel to see its members.</span>;
    return (
      <>
        <div className="team_info_row">
          {info.state ? (
            <AfChip tone={info.state === "open" ? "success" : "warning"} size="sm">
              {info.state}
            </AfChip>
          ) : null}
          {info.channel?.private ? (
            <AfChip tone="muted" size="sm">
              private
            </AfChip>
          ) : (
            <AfChip tone="muted" size="sm">
              public
            </AfChip>
          )}
          {info.response_sla_minutes ? (
            <AfChip tone="muted" size="sm" title="Expected response SLA">
              SLA {Math.round(Number(info.response_sla_minutes) / 60)}h
            </AfChip>
          ) : null}
          {/* Count derives from the LIVE members state (adversary P1-4):
              the cached /info count contradicted the refreshed list —
              one drawer, two numbers. */}
          <span className="muted team_note">{(members ?? info.members ?? []).length} members</span>
          {/* Channel-level ±1 REMOVED (operator dm 150 "ONE reputation
              score system"): it wrote reactions:channel store rows — a
              vote the reputation system cannot see is a stranded vote
              (26 of the operator's votes were stranded this way). A
              channel is not a rateable colleague; message thumbs + the
              Leaderboard are the one system. */}
        </div>
        {info.meta?.purpose ? <div className="team_info_purpose">{info.meta.purpose}</div> : null}
        {(() => {
          // Two wire shapes: older hubs inline the charter TEXT; agora/0.4
          // hubs serve a descriptor {path, version, updated_by, updated_at}
          // pointing into the channel fs. Rendering the descriptor through
          // String() printed "[object Object]" (live review 2026-08-19).
          const charter = info.charter as unknown;
          if (!charter) return <div className="muted team_note">No charter set for this channel.</div>;
          if (typeof charter === "string") {
            return (
              <div className="team_info_charter">
                <div className="muted team_note" style={{ marginBottom: 4 }}>
                  Charter
                </div>
                <Markdown className="md_doc" text={neutralize_unsafe_embeds(charter)} />
              </div>
            );
          }
          const desc = charter as { path?: unknown; version?: unknown; updated_by?: unknown };
          const path = typeof desc.path === "string" && desc.path ? desc.path : "channel/charter.md";
          return (
            <div className="team_info_charter">
              <button
                className="team_row_expand"
                onClick={() => {
                  // Reading the HEAD is what records this seat's receipt —
                  // so the read can clear a gate, and /owed is re-read to
                  // find out whether the hub agrees that it did.
                  void open_fs_path(path).then(() => refresh_owed());
                }}
                title={`Open ${path} from this channel's virtual file system (vfs) — reading the current version records your charter receipt`}
              >
                Read charter{typeof desc.version === "number" ? ` (v${desc.version})` : ""}
              </button>
              {typeof desc.updated_by === "string" && desc.updated_by ? (
                <span className="muted team_note"> — updated by {desc.updated_by}</span>
              ) : null}
              {info.meta?.norms_required ? (
                <div className="muted team_note" title="channel:meta.norms_required — the hub refuses a post from any seat whose charter receipt is older than the current version. It forces attention to the rules, never agreement with them.">
                  norms_required — posting here is gated on having read the current version.
                </div>
              ) : null}
            </div>
          );
        })()}
        {/* STANDING RULINGS (hub 0113) — the room's settled constraints, not
            one thread's decision: operator-authored `ruling:*` store rows
            that every later decision must respect. Served on the digest
            (scoped to this seat), so a pre-0113 hub renders nothing here.
            Acknowledging is DELIVERY, never agreement — the button records
            the read and the note says where disagreement belongs. */}
        {rulings?.all.length ? (
          <div className="team_info_rulings">
            <div className="muted team_note" style={{ marginBottom: 4 }}>
              Standing rulings {rulings.unacked.length ? `(${rulings.unacked.length} unacknowledged)` : ""}
            </div>
            {rulings.all.map((r) => {
              const pending = rulings.unacked.find((u) => u.key === r.key) || null;
              const scope = (r.value?.scope || []).join(", ");
              return (
                <div key={r.key} className="team_info_ruling_row">
                  <AfChip tone={pending ? "warning" : "muted"} size="sm" title={`Store row ${r.key}@v${r.version}`}>
                    {r.key}
                    {pending ? " · unacknowledged" : " · acknowledged"}
                  </AfChip>
                  {r.value?.text ? <div className="team_info_ruling_text">{String(r.value.text)}</div> : null}
                  <span className="muted team_note">
                    v{r.version}
                    {scope ? ` · scope: ${scope}` : ""}
                    {r.updated_by ? ` · by ${r.updated_by}` : ""}
                    {/* An ack_version BELOW the row version is the honest
                        reason a row is back: the operator edited a ruling
                        this seat had already acknowledged. */}
                    {pending && typeof pending.ack_version === "number" ? ` · you acknowledged v${pending.ack_version}` : ""}
                  </span>
                </div>
              );
            })}
            {rulings.unacked.length ? (
              <div className="team_info_ruling_ack">
                <button
                  className="btn"
                  disabled={ruling_busy}
                  title={
                    `Record that you have read ${rulings.unacked.map((r) => r.key).join(", ")} at their current version ` +
                    `(POST /channels/${selected}/ruling-acks).` +
                    (rulings.gated ? " This room sets rulings_required, so it is also what lifts the 409 on your posts here." : "") +
                    " Acknowledging is delivery, never agreement — disagree on the record, in the room."
                  }
                  onClick={() => void ack_rulings_here(rulings.unacked.map((r) => r.key))}
                >
                  {ruling_busy ? "Acknowledging…" : `Acknowledge ${rulings.unacked.length} ruling${rulings.unacked.length === 1 ? "" : "s"}`}
                </button>
                {rulings.gated ? (
                  <div className="muted team_note" title="channel:meta.rulings_required — the hub refuses a post from any seat with an unacknowledged in-scope ruling. It forces attention to the constraints, never agreement with them.">
                    rulings_required — posting here is gated until each of these is acknowledged.
                  </div>
                ) : null}
              </div>
            ) : null}
            {ruling_error ? <div className="page_error mono">{ruling_error}</div> : null}
          </div>
        ) : null}
        {/* Declared phase order (hub 0140/2). Advisory by construction: the
            hub cannot know what a message works on, so the whole power of a
            phase is being visible before you post. Served on /info; absent
            on older hubs, where this block simply does not render. */}
        {(info.phases || []).length ? (
          <div className="team_info_phases">
            <div className="muted team_note" style={{ marginBottom: 4 }}>
              Phases
            </div>
            {(info.phases || []).map((p: HubPhaseRow) => (
              <div key={String(p.key || p.track)} className="team_info_phase_row">
                <AfChip tone={String(p.status || "open") === "open" ? "warning" : "muted"} size="sm">
                  {String(p.track || "work")} · {String(p.current || "?")}
                </AfChip>
                <span className="muted team_note">
                  {String(p.status || "open") === "open" ? "in force" : "complete"}
                  {p.next ? ` · next: ${p.next}` : ""}
                  {p.steward ? ` · steward: ${p.steward}` : ""}
                  {p.declared_by ? ` · declared by ${p.declared_by}` : ""}
                </span>
                {p.note ? <div className="muted team_note">{String(p.note)}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
        {/* Members + moderation (operator c2240): the HUB is the authority —
            refusals render verbatim. Moderation and lifecycle hide in dm
            channels (owner-less by hub construction — every act refuses). */}
        <div className="team_members">
          <div className="muted team_note" style={{ marginBottom: 4 }}>
            Members {members ? `(${members.length})` : ""}
          </div>
          {/* Invite (operator dm 79): a first-class add-member control —
              roster minus current members, minted token DM'd with the join
              pointer. Hidden in dm channels (2-party by construction). */}
          {!is_dm_channel && members !== null ? (
            <div className="team_invite_row">
              <select
                className="team_compose_control team_invite_select"
                value={invite_peer}
                onChange={(e) => set_invite_peer(e.target.value)}
                // Opening the picker refetches too (operator dm 3). The tab
                // open already refreshes, but a drawer left open across the
                // minutes it takes a spawned agent to register would still
                // show a stale list at the moment of the click.
                onFocus={() => load_roster(seat)}
                disabled={Boolean(invite_busy)}
                title="Agents on the hub not yet in this channel"
              >
                <option value="">invite: agent…</option>
                {roster
                  .filter((id) => !(members || []).some((m) => String(m.agent_id || "") === id))
                  // Already-invited agents drop from the picker (adversary
                  // P2-7): a duplicate DM was one click away while the
                  // "awaiting join" row sat right below.
                  .filter((id) => !(invited_pending[selected] || new Set()).has(id))
                  .map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
              </select>
              <button
                className="btn"
                disabled={!invite_peer || Boolean(invite_busy)}
                title="Mint a single-use invite token and DM it with the join pointer"
                onClick={() => void run_invite(invite_peer)}
              >
                {invite_busy ? "Inviting…" : "Invite"}
              </button>
            </div>
          ) : null}
          {invite_notice ? <div className="muted team_note">{invite_notice}</div> : null}
          {/* Invited-but-not-yet-joined (operator dm 128): a sent invite is
              a standing fact the drawer must show — agents act on their
              next wake, which can be minutes. Reconciled live: the row
              drops the moment the member list contains the agent. */}
          {(() => {
            const pending = [...(invited_pending[selected] || [])].filter((id) => !(members || []).some((m) => String(m.agent_id || "") === id));
            if (!pending.length || members === null) return null;
            return pending.map((id) => (
              <div className="team_member_row team_member_invited" key={`inv:${id}`}>
                <span className="team_avatar" style={avatar_style(id)} aria-hidden="true">
                  {(id[0] || "?").toUpperCase()}
                </span>
                <span className="team_member_id">{id}</span>
                <span className="chip mono warn" title="The invite DM is in their inbox (status=open, owed) — agents join on their next wake; this row clears itself when they do.">
                  invited — awaiting join
                </span>
              </div>
            ));
          })()}
          {members_error ? (
            <div className="muted team_note">
              Members list unavailable ({members_error.slice(0, 100)}) — an empty list below means the FETCH failed, not an empty channel. Reopen the drawer to retry.
            </div>
          ) : null}
          {members === null ? (
            <span className="muted team_note">Loading members…</span>
          ) : (
            members.map((m) => {
              const id = String(m.agent_id || "");
              if (!id) return null;
              // The member row already carries the operator's charge for
              // that seat (`/channels/{c}/info.members[].mission`, hub
              // 0.17.1) — served to every member, no operator key needed.
              // `/admin/missions` stays the operator's editing source and
              // wins when it has loaded, so a just-saved mission shows
              // immediately instead of waiting for the roster to refetch.
              const mission = missions_map?.[id] ?? String(m.mission || "");
              return (
                <React.Fragment key={id}>
                <div className="team_member_row">
                  <span className="team_avatar" style={avatar_style(id)} aria-hidden="true">
                    {(id[0] || "?").toUpperCase()}
                  </span>
                  <span className="team_member_id" title={String(m.about || "")}>
                    {id}
                  </span>
                  {/* Agent-level ±1 REMOVED (operator dm 164): "up/down
                      votes are per message, NO reason to have them in the
                      members tab." Reputation flows from message ratings
                      (general) + the Leaderboard's category opinions; the
                      members tab is roster + moderation only now. */}
                  <span className="team_member_actions">
                    <button
                      className="team_row_expand"
                      disabled={mission_busy}
                      title={mission ? `Standing mission: ${mission}\n\nEdit it — hub-wide, rides the seat's whoami (the hub authorizes: operator)` : "Give this agent a standing mission — hub-wide, rides the seat's whoami (the hub authorizes: operator)"}
                      onClick={() => {
                        set_mission_edit(mission_edit === id ? "" : id);
                        set_mission_draft(mission);
                        set_mission_error("");
                      }}
                    >
                      mission
                    </button>
                  {id !== seat && !is_dm_channel ? (
                    <>
                      <button
                        className="team_row_expand"
                        disabled={Boolean(mod_busy)}
                        title="Kick: 1-hour block from THIS channel (hub authorizes — owner/operator only)"
                        onClick={() => void moderate(id, "kick")}
                      >
                        {mod_busy === `channel:kick:${id}` ? "kicking…" : "kick"}
                      </button>
                      <button
                        className={`team_row_expand ${mod_nudge === `channel:ban:${id}` ? "team_danger" : ""}`}
                        disabled={Boolean(mod_busy)}
                        title="Ban: INDEFINITE block from this channel (two clicks — the first arms, the second confirms)"
                        onClick={() => {
                          if (mod_nudge === `channel:ban:${id}`) {
                            set_mod_nudge("");
                            void moderate(id, "ban");
                          } else {
                            set_mod_nudge(`channel:ban:${id}`);
                          }
                        }}
                      >
                        {mod_busy === `channel:ban:${id}` ? "banning…" : mod_nudge === `channel:ban:${id}` ? "confirm ban" : "ban"}
                      </button>
                      <button
                        className={`team_row_expand ${mod_nudge === `hub:ban:${id}` ? "team_danger" : ""}`}
                        disabled={Boolean(mod_busy)}
                        title="Hub ban: INDEFINITE lockout from the ENTIRE hub — every channel, re-registration refused, live connection severed (operator-only). Two clicks to confirm."
                        onClick={() => {
                          if (mod_nudge === `hub:ban:${id}`) {
                            set_mod_nudge("");
                            void moderate(id, "ban", "hub");
                          } else {
                            set_mod_nudge(`hub:ban:${id}`);
                          }
                        }}
                      >
                        {mod_busy === `hub:ban:${id}` ? "hub-banning…" : mod_nudge === `hub:ban:${id}` ? "confirm hub ban" : "hub ban"}
                      </button>
                      <button
                        className={`team_row_expand ${mod_nudge === `retire:${id}` ? "team_danger" : ""}`}
                        disabled={Boolean(mod_busy)}
                        title="Retire: decommission this agent WITHOUT blame — removed from all channels/rosters, the id is reserved (never reused), never shown as blocked (operator-only). Two clicks to confirm."
                        onClick={() => {
                          if (mod_nudge === `retire:${id}`) {
                            set_mod_nudge("");
                            void retire_agent(id);
                          } else {
                            set_mod_nudge(`retire:${id}`);
                          }
                        }}
                      >
                        {mod_busy === `retire:${id}` ? "retiring…" : mod_nudge === `retire:${id}` ? "confirm retire" : "retire"}
                      </button>
                    </>
                  ) : null}
                  {id === seat ? (
                    <span className="chip mono ok">
                      you
                    </span>
                  ) : null}
                  </span>
                </div>
                {/* Standing mission line: a roster is identity, and for an
                    agent fleet the mission IS identity (operator ask
                    2026-08-19). Hidden while its editor is open. */}
                {mission && mission_edit !== id ? (
                  <div className="team_member_mission" title={mission}>
                    {mission}
                  </div>
                ) : null}
                {mission_edit === id ? (
                  <div className="team_mission_editor">
                    <textarea
                      value={mission_draft}
                      onChange={(e) => set_mission_draft(e.target.value)}
                      placeholder={`Standing mission for ${id} — the goal this seat pursues across wakes (empty clears it)`}
                      disabled={mission_busy}
                      aria-label={`Mission for ${id}`}
                    />
                    {mission_error ? <div className="page_error mono">{mission_error}</div> : null}
                    <div className="team_mission_editor_row">
                      <span className="muted team_note">Hub-wide — rides the seat's whoami on every wake.</span>
                      <button className="btn" disabled={mission_busy} onClick={() => { set_mission_edit(""); set_mission_error(""); }}>
                        Cancel
                      </button>
                      <button className="btn primary" disabled={mission_busy} onClick={() => void save_mission(id)}>
                        {mission_busy ? "Saving…" : "Set mission"}
                      </button>
                    </div>
                  </div>
                ) : null}
                </React.Fragment>
              );
            })
          )}
        </div>
        {!is_dm_channel && blocked && blocked.length ? (
          <div className="team_members">
            <div className="muted team_note" style={{ marginBottom: 4 }}>
              Blocked ({blocked.length})
            </div>
            {blocked.map((b) => {
              const id = String(b.agent_id || b.agent || "");
              if (!id) return null;
              const block_scope = String(b.scope || "");
              const is_hub = block_scope === "hub";
              const scope_arg: "hub" | "channel" = is_hub ? "hub" : "channel";
              const until = b.expires_at ? ` · until ${new Date(Number(b.expires_at) * 1000).toLocaleString()}` : " · indefinite";
              const where = is_hub ? "hub-wide" : `#${block_scope}`;
              return (
                <div className="team_member_row" key={`blocked:${block_scope}:${id}`}>
                  <span className="team_avatar" style={avatar_style(id)} aria-hidden="true">
                    {(id[0] || "?").toUpperCase()}
                  </span>
                  <span className="team_member_id" title={String(b.reason || "")}>
                    {id}
                    <span className="muted team_note">
                      {where}
                      {until}
                    </span>
                  </span>
                  <span className="team_member_actions">
                    <button
                      className="team_row_expand"
                      disabled={Boolean(mod_busy)}
                      title={is_hub ? "Lift this HUB-WIDE block (the agent can re-register and rejoin)" : "Lift this channel block (the agent can rejoin/post again)"}
                      onClick={() => void moderate(id, "unblock", scope_arg)}
                    >
                      {mod_busy === `${scope_arg}:unblock:${id}` ? "unblocking…" : "unblock"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {!is_dm_channel && retired && retired.length ? (
          <div className="team_members">
            <div className="muted team_note" style={{ marginBottom: 4 }}>
              Retired agents ({retired.length})
            </div>
            {retired.map((r) => {
              const id = String(r.id || "");
              if (!id) return null;
              const when = r.retired_at ? ` · ${new Date(Number(r.retired_at) * 1000).toLocaleDateString()}` : "";
              return (
                <div className="team_member_row" key={`retired:${id}`}>
                  <span className="team_avatar" style={avatar_style(id)} aria-hidden="true">
                    {(id[0] || "?").toUpperCase()}
                  </span>
                  <span className="team_member_id" title={String(r.reason || "")}>
                    {id}
                    <span className="muted team_note">decommissioned{when}</span>
                  </span>
                  <span className="team_member_actions">
                    <button
                      className={`team_row_expand ${mod_nudge === `unretire:${id}` ? "team_danger" : ""}`}
                      disabled={Boolean(mod_busy)}
                      title="Un-retire: restore this agent's access (it rejoins channels explicitly). Two clicks to confirm."
                      onClick={() => {
                        if (mod_nudge === `unretire:${id}`) {
                          set_mod_nudge("");
                          void unretire_agent(id);
                        } else {
                          set_mod_nudge(`unretire:${id}`);
                        }
                      }}
                    >
                      {mod_busy === `unretire:${id}` ? "un-retiring…" : mod_nudge === `unretire:${id}` ? "confirm un-retire" : "un-retire"}
                    </button>
                    {/* Hard-delete (operator dm 164b, hub 0.12.41): the
                        irreversible cleanup — off every roster/board, id
                        reserved forever, history keeps the sender name.
                        Two-step confirm; the hub 409s a still-active seat
                        (a retired row cannot be, but the guard is real). */}
                    <button
                      className={`team_row_expand ${mod_nudge === `delete:${id}` ? "team_danger" : ""}`}
                      disabled={Boolean(mod_busy)}
                      title="Delete from the hub: irreversible cleanup — removes this agent from every roster and board (its votes/ratings purged), id stays reserved. History keeps its old messages. Two clicks to confirm."
                      onClick={() => {
                        if (mod_nudge === `delete:${id}`) {
                          set_mod_nudge("");
                          void delete_retired_agent(id);
                        } else {
                          set_mod_nudge(`delete:${id}`);
                        }
                      }}
                    >
                      {mod_busy === `delete:${id}` ? "deleting…" : mod_nudge === `delete:${id}` ? "confirm delete" : "delete"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {/* HUB DELEGATION (operator dm 154): assign/resign the operator's
            delegate and define its powers — hub-wide (not per-channel),
            living here because "who acts for the operator" is a members
            question. The hub owns semantics (ADR-0004 separable powers: a
            grant is a verifiable LABEL + validation anchor); operators
            cannot be delegates; grants expire by TTL. */}
        <div className="team_delegation">
          <div className="muted team_note team_delegation_head">
            Hub delegation <span title="Hub-wide, not per-channel: a delegate holds named powers in the operator's name until the grant expires or is resigned. Every seat can verify who holds what (the list is public).">ⓘ</span>
          </div>
          {delegations === null ? (
            <span className="muted team_note">{delegation_error || "Loading delegations…"}</span>
          ) : (
            <>
              {delegations.length === 0 ? <span className="muted team_note">No active delegate.</span> : null}
              {delegations.map((d) => {
                const id = String(d.agent_id || "");
                const powers = Array.isArray(d.powers) ? d.powers.map(String) : [];
                const exp = Number(d.expires_at || d.expires || 0);
                return (
                  <div className="team_delegation_row" key={id}>
                    <span className="team_avatar" style={avatar_style(id)} aria-hidden="true">
                      {(id[0] || "?").toUpperCase()}
                    </span>
                    <span className="team_member_id">{id}</span>
                    <span className="team_delegation_powers mono" title={String(d.note || "")}>
                      {powers.join(" + ") || "(no powers?)"}
                      {exp ? ` · until ${new Date(exp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                    </span>
                    <button
                      className={`team_row_expand ${mod_nudge === `resign:${id}` ? "team_danger" : ""}`}
                      disabled={delegation_busy}
                      title="Resign this delegate: the grant is revoked hub-wide, on the record (two clicks)"
                      onClick={() => {
                        if (mod_nudge === `resign:${id}`) {
                          set_mod_nudge("");
                          void resign_delegate(id);
                        } else {
                          set_mod_nudge(`resign:${id}`);
                        }
                      }}
                    >
                      {delegation_busy ? "resigning…" : mod_nudge === `resign:${id}` ? "confirm resign" : "resign"}
                    </button>
                  </div>
                );
              })}
              <div className="team_delegation_assign">
                <select
                  className="team_compose_control team_invite_select"
                  value={delegate_pick}
                  onChange={(e) => set_delegate_pick(e.target.value)}
                  // Same refresh-on-open as the invite picker (operator dm 3).
                  // This list reads the channel's member rows, so load_info()
                  // is the fetch that matters for it, not the roster.
                  // `keep` because this refresh happens UNDER an open dropdown
                  // — see load_info: clearing swaps the list for another
                  // source's for the length of the round trip.
                  onFocus={() => load_info({ keep: true })}
                  title="Assign a delegate: any registered agent except operators and current delegates"
                >
                  <option value="">assign a delegate…</option>
                  {/* Member id lives under agent_id on /members rows
                      (operator dm 165: the dropdown was empty because it
                      read m.id, always undefined → every option ""). Read
                      agent_id first, then id, then bare-string
                      (info.members is a string[]). */}
                  {(members ?? info.members ?? [])
                    .map((m: any) => String(typeof m === "string" ? m : m?.agent_id || m?.id || ""))
                    .filter((id: string) => id && id !== seat && !delegations.some((d) => String(d.agent_id) === id))
                    .map((id: string) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                </select>
                {delegate_pick ? (
                  <div className="team_delegation_powers_pick">
                    {DELEGATION_POWERS.map((p) => (
                      <label key={p.id} className="team_delegation_power" title={p.help}>
                        <input
                          type="checkbox"
                          checked={delegate_powers.includes(p.id)}
                          onChange={(e) => set_delegate_powers((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                        />
                        {p.id}
                      </label>
                    ))}
                    <button
                      className="btn"
                      disabled={delegation_busy || !delegate_powers.length}
                      title={delegate_powers.length ? `Grant ${delegate_pick} the powers: ${delegate_powers.join(", ")} (7-day TTL, renewable; on the record)` : "Pick at least one power"}
                      onClick={() => void assign_delegate()}
                    >
                      {delegation_busy ? "Assigning…" : "Assign"}
                    </button>
                  </div>
                ) : null}
              </div>
              {delegation_error ? <div className="page_error mono">{delegation_error}</div> : null}
            </>
          )}
        </div>
        {!is_dm_channel ? (
          <div className="team_chan_admin">
            {seat_is_owner ? (
              String(info.state || "open") === "open" ? (
                <button
                  className="btn"
                  disabled={chan_admin_busy}
                  title="Close this channel — member posts refuse until reopened (owner-only; the hub authorizes)"
                  onClick={() => void set_channel_state("closed")}
                >
                  {chan_admin_busy ? "Closing…" : "Close channel"}
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={chan_admin_busy}
                  title="Reopen this channel for member posts"
                  onClick={() => void set_channel_state("open")}
                >
                  {chan_admin_busy ? "Reopening…" : "Reopen channel"}
                </button>
              )
            ) : (
              <span className="muted team_note">Close/reopen is owner-only on the hub (this channel's owner: {chan_owner || "unknown"}).</span>
            )}
          </div>
        ) : null}
        {mod_error ? <div className="page_error mono">{mod_error}</div> : null}
      </>
    );
  }

  function render_attachments(m: HubMessage): React.ReactElement | null {
    const list = m.data?.attachments || m.attachments || [];
    if (!list.length) return null;
    return (
      <div className="team_attachments">
        {list.map((a, i) => {
          // Key by id+index: a message carrying the SAME attachment id twice
          // (hub dedupes by content hash, but a malformed payload could
          // repeat) must not collide React keys (adversary b22b19ed).
          const key = `${a.id}:${i}`;
          const inline = INLINE_IMAGE_TYPES.has(String(a.content_type || "").toLowerCase());
          if (inline) {
            return (
              <AttachmentThumbnail
                key={key}
                hub={hub}
                channel={m.channel}
                attachment={a}
                onOpen={() => void open_attachment(m.channel, a)}
              />
            );
          }
          // Non-image: a file-icon chip that PREVIEWS on click (md/text
          // rendered inline; other types offer download in the viewer).
          return (
            <button
              key={key}
              className="team_attach_chip team_attach_dl"
              title={`${a.content_type} · ${human_size(a.size)} — click to preview`}
              onClick={() => void open_attachment(m.channel, a)}
            >
              <Icon name="paperclip" size={11} />
              <span className="team_attach_name">{a.filename}</span>
              <span className="muted">{human_size(a.size)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  /** Is this thread closed? ONE definition, because the chip and the Resolve
   *  button used to answer it separately and the button's answer was just the
   *  posted status word — which never changes, so it offered Resolve on an
   *  already-resolved thread (operator dm#30). Two sources, one question: the
   *  shape behind three defects today. */
  function msg_is_resolved(m: HubMessage): boolean {
    const status = String(m.status || "").toLowerCase();
    if (status !== "open" && status !== "blocked") return false;
    // THE HUB'S VERDICT FIRST. `closed` is authority-aware; the older
    // `has_resolved_reply` only says a resolved reply exists downthread, so
    // a BYSTANDER's `resolved` used to read as closed here — which took the
    // Resolve button away from the seat whose thread it actually is.
    const verdict = hub_closed_verdict(m);
    if (verdict !== undefined) return verdict;
    if (m.has_resolved_reply === true) return true;
    if (m.has_resolved_reply === undefined || m.has_resolved_reply === null) {
      return Boolean(m.id && window_replied_ids.has(m.id));
    }
    return false;
  }

  function msg_chips(m: HubMessage, is_root: boolean): React.ReactElement[] {
    const chips: React.ReactElement[] = [];
    const status = String(m.status || "").toLowerCase();
    // DISCHARGE IS THE HUB'S VERDICT. Message rows carry
    // `has_resolved_reply`, which the hub computes with operator and
    // delegate authority: a bystander's "on it" does not settle an
    // operator's commission, and a peer's addressed ask is not closed by a
    // bare reply. The old local fold ("any other sender replied ⇒ calm")
    // was the hub's PRE-2026-08 rule and marked live, escalating asks as
    // answered. It survives only where the hub makes no statement (null /
    // absent — an older hub), never as an override.
    const answered = msg_is_resolved(m);
    // fyi is the room's baseline — chip only the states that MEAN something.
    if (answered) {
      chips.push(
        <AfChip key="st" tone="success" size="sm" title="The Hub reports a resolving reply in this thread — its own discharge verdict, not a count of replies.">
          {/* "resolved", not "answered" (operator dm#30). The hub's own word
              for this state is `resolved`, it is the word on the reply that
              produces it, and "answered" invited exactly the question laurent
              asked — whether a thing that had been answered was also closed. */}
          resolved
        </AfChip>
      );
    } else if (status === "open" || status === "blocked") {
      chips.push(
        <AfChip key="st" tone={status === "blocked" ? "error" : "warning"} size="sm">
          {status}
        </AfChip>
      );
    } else if (status === "resolved" && is_root) {
      chips.push(
        <AfChip key="st" tone="success" size="sm">
          resolved
        </AfChip>
      );
    }
    // ASKER SIDE (agora 0153). Your own thread is fully discharged — every
    // ask answered OR REFUSED — and every surface that reports discharge
    // says the same word for both. This is the one place the difference
    // reaches the person who asked: a thread nobody answered is one to
    // repost or rethink, not one to close quietly. Hub-served
    // (`/owed.to_close`); absent on older hubs, and the chip simply does
    // not appear.
    const closing = close_map[m.channel]?.[m.seq];
    if (is_root && closing?.declined_asks.length) {
      const who = closing.declined_by.join(", ") || "another seat";
      const n = closing.declined_asks.length;
      // NOT `!answered_by` — the hub sets that to the last non-sender
      // replier whether they answered or refused, so on a fully-declined
      // thread it names a decliner. "Nobody answered" is only true when the
      // refused ids cover every ask the message carries; both numbers are
      // hub-served and both are on this row.
      const nothing_answered = n >= (m.data?.asks || []).length;
      chips.push(
        <AfChip
          key="refused"
          tone="warning"
          size="sm"
          title={
            `${nothing_answered ? "Nobody answered this." : "Partly answered."} ` +
            `${who} DECLINED ask(s) ${closing.declined_asks.join(", ")} — refused on the record, not answered. ` +
            "The thread is fully discharged and stopped escalating, which is why it no longer asks for anything. " +
            "Repost or rethink it rather than closing it quietly."
          }
        >
          ✗ {nothing_answered ? `${n} refused, none answered` : `${n} refused`}
        </AfChip>
      );
    }
    if (m.critical) {
      chips.push(
        <AfChip key="crit" tone="error" size="sm" title="Critical: unpins only on explicit read — click the row to record the read">
          critical
        </AfChip>
      );
    }
    // (The envelope's has_resolved_reply, when a future hub serves it on
    // list rows, folds into the `answered` state above — one chip, not two.)
    // A reply that DISCHARGES asks names them (the closure was visually
    // anonymous — adversary find).
    // `answers` is the ids this reply DISCHARGED — refusals included, because
    // the hub folds `declines` into it (agora 0153). Rendering it whole would
    // caption a refusal "✓ answers", the exact inversion the disposition was
    // added to prevent, so subtract as the protocol instructs and chip the two
    // outcomes apart. Older hubs serve no `declines`; the subtraction is then
    // a no-op and this reads exactly as before.
    const discharged = m.data?.answers || [];
    const declined = m.data?.declines || [];
    const answered_ids = discharged.filter((id) => !declined.includes(id));
    if (status === "reply" || status === "resolved") {
      if (answered_ids.length) {
        chips.push(
          <AfChip key="dis" tone="success" size="sm" title={`This reply answers ask(s) ${answered_ids.join(", ")} of its parent.`}>
            ✓ answers {answered_ids.join(",")}
          </AfChip>
        );
      }
      if (declined.length) {
        chips.push(
          <AfChip key="decl" tone="warning" size="sm" title={`This reply DECLINES ask(s) ${declined.join(", ")} of its parent — refused on the record, not answered. It discharges the obligation either way; the body is the why.`}>
            ✗ declines {declined.join(",")}
          </AfChip>
        );
      }
    }
    // Cap the @to flood: multi-seat posts routinely address 5+ seats and
    // drowned the head line (adversary find).
    const to = m.to || [];
    for (const t of to.slice(0, 2)) {
      chips.push(
        <AfChip key={`to:${t}`} tone="muted" size="sm">
          @{t}
        </AfChip>
      );
    }
    if (to.length > 2) {
      chips.push(
        <AfChip key="to+" tone="muted" size="sm" title={to.map((t) => `@${t}`).join(" ")}>
          +{to.length - 2}
        </AfChip>
      );
    }
    return chips;
  }

  /** A single message row, wrapped so a render throw from ONE message (a
   *  pathological token, a bad attachment shape, a kit edge case) degrades
   *  to a labeled fallback row instead of blanking the whole page (operator
   *  dm 55/57 — the URL-parse crash proved one message could take down the
   *  console). The raw body stays readable in the fallback. */
  /** The thread's fold control, rendered INTO the root row's header so a
   *  card carries its trail marker where the eye already is (operator ask
   *  2026-08-20). Only ever passed for a root that has replies. */
  type FoldControl = {
    count: number;
    folded: boolean;
    disabled: boolean;
    label: string;
    replies_id: string;
    unread: number;
    debt: number;
    asks: number;
    toggle: () => void;
    summarize?: () => void;
    summarize_busy?: boolean;
    summarize_total?: number;
  };

  function render_msg(m: HubMessage, opts: { is_root: boolean; fold?: FoldControl }): React.ReactElement {
    return (
      <ErrorBoundary
        key={m.id}
        // Content signature (P2-7): retraction or an edit-class change
        // resets a latched failure so a cured body renders again.
        resetKey={`${m.retracted ? 1 : 0}:${(m.body || "").length}:${(m.title || "").length}`}
        fallback={
          <div className="team_row team_row_broken" id={`hubmsg-${m.id}`}>
            <div className="team_row_main">
              <div className="team_row_head">
                <span className="team_row_sender" style={sender_style(m.sender)}>
                  {m.sender}
                </span>
                <span className="team_row_meta mono">
                  #{m.seq} · {ago(m.created_at)}
                </span>
                <span className="chip mono warn" title="This message failed to render; showing its raw text so nothing is hidden.">
                  render failed
                </span>
              </div>
              <pre className="team_row_raw">{String(m.title ? m.title + "\n" : "") + String(m.body || "(no text)")}</pre>
            </div>
          </div>
        }
      >
        {render_msg_body(m, opts)}
      </ErrorBoundary>
    );
  }

  function render_msg_body(m: HubMessage, opts: { is_root: boolean; fold?: FoldControl }): React.ReactElement {
    const body = String(m.body || "");
    const asks = m.data?.asks || [];
    const unread = Boolean(filter_ctx.unread_seqs?.has(m.seq));
    const highlight = filter !== "all" && msg_matches_filter(m, filter, filter_ctx);
    // Title/body echo: agents routinely set title == body for short
    // posts — rendering both reads as a duplication bug (design critic).
    const title = String(m.title || "").trim();
    const body_first_line = body.trim().split("\n")[0]?.trim() || "";
    const title_is_echo = title && (title === body.trim() || title === body_first_line);
    const replying = reply_to?.id === m.id;
    return (
      <div
        className={`team_row has_actions ${m.sender === seat ? "own" : ""} ${highlight ? "hit" : ""} ${replying ? "replying" : ""} ${unread ? "unread" : ""} ${m.retracted ? "retracted" : ""}`}
        key={m.id}
        id={`hubmsg-${m.id}`}
        onClick={(e) => row_click(m, e, opts.fold)}
        title={m.critical ? "Click to record the read (critical unpins on it)" : undefined}
      >
        {/* Identity anchor: hue-stable initial (the same hash that colors
            the name) — scanning a busy channel by color beats re-reading
            names (design pass 2026-07-14). */}
        <span className="team_avatar" style={avatar_style(m.sender)} aria-hidden="true">
          {(m.sender[0] || "?").toUpperCase()}
        </span>
        <div className="team_row_main">
          <div
            className={`team_row_head ${opts.fold && !opts.fold.disabled ? "foldable" : ""}`}
            onClick={opts.fold && !opts.fold.disabled ? (e) => {
              // Clicking the card's header line folds/unfolds its trail
              // (operator ask 2026-08-20). Interactive children inside the
              // header stop their own propagation, so this only fires for
              // clicks on the header's own surface. The real control is the
              // reply button below — keyboard users never need this.
              if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
              opts.fold!.toggle();
            } : undefined}
          >
            {/* Unread uses the blue row accent only. A separate NEW pill
                repeated the same signal; sticky Hub debt remains labeled
                because reading it does not resolve the obligation. */}
            {debt_map[m.channel]?.has(m.seq) ? (
              <span
                className="team_chip_debt"
                title="Pinned by the hub until answered: this is an open ask or a directive addressed to you — reading is not answering; reply, Decline, or Resolve the thread to clear it"
              >
                needs reply
              </span>
            ) : null}
            {/* Authorship renders from the WIRE (sender on the envelope),
                never client state — uic c1706. */}
            <span className="team_row_sender" style={sender_style(m.sender)}>
              {m.sender}
            </span>
            {/* No per-author stance mark here (operator dm 119: "no reason
                to show a +1/−1 next to the name, since it's per message") —
                header marks read as message reactions and confuse. Author
                trust renders where it is author-scoped: Members drawer +
                Leaderboard. The dm-20 always-visible-trace need is served
                by the reaction tally below. */}
            {msg_chips(m, opts.is_root)}
            {/* Always-visible rating tally (the rail is hover-only) —
                the hub-served row decoration IS the truth (one reputation
                system, dm 150); no decoration = no tally, honestly. */}
            {(() => {
              const t = msg_tally(m);
              if (!t || (!t.up && !t.down)) return null;
              return (
                <span className={`team_reaction_tally ${t.mine > 0 ? "pos" : t.mine < 0 ? "neg" : ""}`} title="±1 ratings feed the sender's reputation (one system). Green/red tint = YOUR standing vote on this message; counts refresh with the poll.">
                  {t.up ? <><Icon name="thumbsUp" size={12} />{t.up}</> : null}
                  {t.down ? <><Icon name="thumbsDown" size={12} />{t.down}</> : null}
                </span>
              );
            })()}
            <span className="team_row_meta mono" title={abs_time(m.created_at)}>
              #{m.seq} · {ago(m.created_at)}
            </span>
            {/* Trail marker at the card's top-right: a chat icon and the
                reply count, which IS the fold control. Reply-scoped state
                (unread / needs you / open questions) rides beside it so a
                folded card still says what is inside. */}
            {opts.fold ? (
              <span className="team_fold_group">
                {opts.fold.unread > 0 ? (
                  <span className="team_thread_stat new" aria-label={`${opts.fold.unread} unread ${opts.fold.unread === 1 ? "reply" : "replies"} in this loaded view`} title={`${opts.fold.unread} unread ${opts.fold.unread === 1 ? "reply" : "replies"} in this loaded view`}>
                    <span aria-hidden="true">●</span> {opts.fold.unread}
                  </span>
                ) : null}
                {opts.fold.debt > 0 ? (
                  <span className="team_thread_stat debt" aria-label={`${opts.fold.debt} ${opts.fold.debt === 1 ? "reply needs" : "replies need"} your answer`} title={`${opts.fold.debt} ${opts.fold.debt === 1 ? "reply needs" : "replies need"} your answer`}>
                    <span aria-hidden="true">!</span> {opts.fold.debt}
                  </span>
                ) : null}
                {opts.fold.asks > 0 ? (
                  <span className="team_thread_stat ask" aria-label={`${opts.fold.asks} pending ${opts.fold.asks === 1 ? "question" : "questions"} in the replies`} title={`${opts.fold.asks} pending ${opts.fold.asks === 1 ? "question" : "questions"} in the replies, served by the Hub`}>
                    <span aria-hidden="true">?</span> {opts.fold.asks}
                  </span>
                ) : null}
                {opts.fold.summarize ? (
                  <button
                    className="team_thread_tool team_summarize"
                    disabled={Boolean(opts.fold.summarize_busy)}
                    title="LLM summary of this trail (root + replies) — read-only, never posts"
                    aria-label={opts.fold.summarize_busy ? "Summarizing this thread" : `Summarize ${opts.fold.summarize_total} messages`}
                    onClick={(e) => {
                      e.stopPropagation();
                      opts.fold!.summarize!();
                    }}
                  >
                    <span aria-hidden="true">✦</span>
                  </button>
                ) : null}
                <button
                  className="team_reply_toggle"
                  type="button"
                  disabled={opts.fold.disabled}
                  aria-controls={opts.fold.folded ? undefined : opts.fold.replies_id}
                  aria-expanded={!opts.fold.folded}
                  aria-label={`${opts.fold.folded ? "Show" : "Hide"} ${opts.fold.count} ${opts.fold.count === 1 ? "reply" : "replies"} to: ${opts.fold.label}`}
                  title={opts.fold.disabled ? "Clear the filter before folding; matching messages stay visible" : opts.fold.folded ? `Show the ${opts.fold.count} ${opts.fold.count === 1 ? "reply" : "replies"}` : `Hide the ${opts.fold.count} ${opts.fold.count === 1 ? "reply" : "replies"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    opts.fold!.toggle();
                  }}
                >
                  <Icon name="chat" size={12} />
                  <span className="team_reply_toggle_label">{opts.fold.count}</span>
                </button>
              </span>
            ) : null}
          </div>
          {title && !title_is_echo ? <div className="team_row_title">{title}</div> : null}
          {/* Full markdown always renders in an open thread. A char-slice
              would shred code fences, and a second per-message disclosure
              made it impossible to see a thread as one conversation. */}
          {/* MemoMarkdown (backlog 0010): message text is immutable once
              posted, so the memo boundary skips the markdown re-parse for
              unchanged rows when new traffic re-renders the page — the
              string prop compares by value. reflow_prose_walls (dm 121)
              inserts paragraph breaks into single-paragraph report walls
              (whitespace only, words verbatim) so the dm-116 rhythm has
              something to work with. */}
          <div className="team_row_body">
            {/* linkify_citations LAST (operator dm 21/22): it wraps a bare
                `#412` / `commons#412` in backticks so the renderer turns it
                into a hover chip. After neutralize, because neutralize
                MAKES code spans (`… (link disabled)`) and a citation inside
                one is already code. */}
            <MemoMarkdown className="md_doc" cite_channels={cite_channels} cite_bare_max={cite_bare_max} text={linkify_citations(neutralize_unsafe_embeds(autolink_body(reflow_prose_walls(body), { hub_base: hub_url })))} />
          </div>
          {render_attachments(m)}
          {/* Channel-fs paths mentioned in the message (operator dm 69):
              one click opens the shared viewer — the "fs:put <path>" write
              notices become readable in place. Title included: those
              notices carry the path in the headline with an empty body.
              WORK-ID mentions (S3: <package>-<NNNN>, the ruled one-id
              stitch) chip beside them and jump to the Board filtered to
              the item — the Team half of the team↔board join. */}
          {(() => {
            const mentions = extract_fs_paths(`${String(m.title || "")}\n${body}`);
            const msg_atts = m.data?.attachments || m.attachments || [];
            // RESOLVED chips only (operator dm 93: a chip that 404s is
            // brittleness — prose paths may belong to ANOTHER system, an
            // entity's workspace, a repo). Resolution: exact fs path ->
            // unique basename in this channel's fs -> matching attachment
            // on this very message -> NO CHIP (prose stays prose).
            const resolved = mentions
              .map((p) => ({ mention: p, res: resolve_fs_mention(p, chan_fs_paths, msg_atts) }))
              .filter((r) => r.res !== null)
              // An attachment-resolution whose filename EQUALS the mention
              // duplicates the paperclip chip right above it (adversarial
              // find 5) — the mention chip only adds value when it maps a
              // DIFFERENT spelling onto the file.
              .filter((r) => !(r.res!.kind === "attachment" && String(msg_atts[r.res!.attachment_index]?.filename || "") === r.mention));
            const work_ids = props.on_open_board ? extract_work_ids(`${String(m.title || "")}\n${body}`) : [];
            // Explicit @vfs references (operator ask 2026-08-19): the @ is
            // declared intent, so these chip unconditionally — an absent
            // target opens the viewer's named error. Seat identity wins
            // over files (operator ruling): a token matching a known seat
            // stays a mention, so no chip. Deduped against the resolved
            // prose-path chips above.
            // The roster excludes the viewer's own seat, but seat precedence
            // must cover it too (verifier P1: `@<own-seat>/x.md` chipped
            // while the hub obliged the viewer) — add `seat` explicitly.
            const vfs_refs = filter_vfs_refs(extract_vfs_refs(`${String(m.title || "")}\n${body}`), [...roster, seat])
              .filter((ref) => ref.channel || !resolved.some((r) => r.res!.kind === "fs" && r.res!.path === ref.path));
            if (!resolved.length && !work_ids.length && !vfs_refs.length) return null;
            return (
              <div className="team_fs_chips">
                {vfs_refs.map((ref) => (
                  <button
                    key={`vfs:${ref.channel || ""}:${ref.path}`}
                    className="team_attach_chip team_fs_chip"
                    title={ref.channel
                      ? `Open ${ref.path} from #${ref.channel}'s virtual file system (your seat needs read access there — the hub authorizes)`
                      : `Open ${ref.path} from #${m.channel}'s virtual file system`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void open_fs_path(ref.path, ref.channel || m.channel);
                    }}
                  >
                    <FileGlyph />
                    <span className="team_attach_name mono">@{ref.channel ? `${ref.channel}:` : ""}{ref.path}</span>
                  </button>
                ))}
                {resolved.map(({ mention, res }) => (
                  <button
                    key={mention}
                    className="team_attach_chip team_fs_chip"
                    title={
                      res!.kind === "fs"
                        ? res!.rewritten
                          ? `Opens ${res!.path} (the mention's path moved — matched by name in #${selected}'s files)`
                          : `Open ${res!.path} from #${selected}'s virtual file system (vfs)`
                        : `Opens the file attached to this message (the path in the text belongs to the sender's workspace)`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (res!.kind === "fs") void open_fs_path(res!.path);
                      else void open_attachment(m.channel, msg_atts[res!.attachment_index] as HubAttachment);
                    }}
                  >
                    <FileGlyph />
                    <span className="team_attach_name">{mention}</span>
                    {res!.kind === "attachment" ? <span className="team_fs_chip_note">attached</span> : res!.rewritten ? <span className="team_fs_chip_note">moved</span> : null}
                  </button>
                ))}
                {work_ids.map((id) => (
                  <button
                    key={`w:${id}`}
                    className="team_attach_chip team_fs_chip team_work_chip"
                    title={`Work item ${id} — open the Board filtered to it`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.on_open_board?.(id);
                    }}
                  >
                    <span className="team_work_glyph" aria-hidden>⛭</span>
                    <span className="team_attach_name mono">{id}</span>
                  </button>
                ))}
              </div>
            );
          })()}
          {asks.length ? (
            <div className="team_row_asks">
              {/* No declined/answered mark on an ask here: the history row
                  (`MessageRow`) carries `pending_asks` and nothing about
                  DISPOSITION — `declined_asks` exists on the envelope and
                  the to_close row, neither of which feeds this list. The
                  refusal is still visible where the hub does serve it: on
                  the declining reply, which chips "✗ declines". */}
              {/* The recipient rides the chip (operator commons#75).
               *
               * THIS LABEL STATES ADDRESSING, NEVER PERMISSION (operator
               * dm#28). It first read "→ anyone" for an ask with no `to`,
               * justified as "an ask with no to is genuinely the room's".
               * That justification was wrong, and laurent hit it within the
               * hour: the label said ANYONE while the checkbox beside it was
               * disabled, because the label came from the ask payload and
               * the permission came from the hub's `asks_naming_you`. Two
               * sources answering one question — the same defect this very
               * commit was written to fix, reintroduced one line below the
               * fix.
               *
               * `to: []` is a fact about who the ask NAMES, and it does not
               * mean everyone may discharge it: the hub still refuses the
               * asker, and refuses anyone its served subset excludes. So the
               * chip now says "unassigned" — which is what an empty `to`
               * actually is — and permission is stated in exactly one place,
               * the composer's enablement. */}
              {asks.map((a) => {
                const to = ask_to(a);
                return (
                  <span
                    key={a.id}
                    className={`team_ask ${to.length && !to.includes(seat) ? "team_ask_other" : ""}`}
                    title={to.length ? `Addressed to ${to.join(", ")} — ${a.text}` : `Names no seat — ${a.text}`}
                  >
                    ask {a.id}
                    <span className="team_ask_to">{to.length ? ` → ${to.join(", ")}` : " → unassigned"}</span>
                    : {a.text.length > 90 ? a.text.slice(0, 90) + "…" : a.text}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
        {/* Hover action rail: a real click target for the row's acts —
            the always-on 11px links measured as the page's primary
            interaction (adversary find, earlier wave). Focusable, so
            keyboard users reach it without the hover. */}
        <div className="team_row_rail">
          {props.on_speak_message ? (
            <button
              className={`btn btn_icon ${speaking_message_id === m.id ? "team_speak_on" : ""}`}
              aria-label={speaking_message_id === m.id ? "Stop speaking" : "Speak message"}
              title={speaking_message_id === m.id ? "Stop reading this message" : "Read this message aloud through the host-provided speech capability"}
              onClick={(e) => {
                e.stopPropagation();
                // Click-to-stop (adjudication A3): the active button was
                // DISABLED, leaving the operator no way to stop playback.
                if (speaking_message_id === m.id) {
                  speak_abort_ref.current?.abort();
                  speak_abort_ref.current = null;
                  set_speaking_message_id("");
                } else {
                  speak_message(m);
                }
              }}
            >
              <Icon name="speaker" size={15} />
            </button>
          ) : null}
          <button
            className={`btn btn_icon team_copy ${copy_feedback?.id === m.id ? `team_copy_${copy_feedback.status}` : ""}`}
            aria-label={copy_feedback?.id === m.id ? (copy_feedback.status === "copied" ? "Copied message" : "Copy unavailable") : "Copy message"}
            title={copy_feedback?.id === m.id ? (copy_feedback.status === "copied" ? "Copied message" : "Copy unavailable") : "Copy message to the clipboard"}
            onClick={(e) => {
              e.stopPropagation();
              void copy_message(m);
            }}
          >
            <Icon name={copy_feedback?.id === m.id ? (copy_feedback.status === "copied" ? "check" : "x") : "copy"} size={15} />
          </button>
          {can_post ? (
            <>
            {/* Per-MESSAGE reactions (operator dm 82: "+1 -1 on each
                message… we can do that on every message" — DMs included;
                supersedes the dm-16 author-trust rail). Same direction
                again withdraws; opposite revises. ONE reputation system
                (agora-0122): a message ± IS reputation input about its
                sender — the hub refuses self-rating, hub notices, and
                retracted tombstones, so those rows carry no thumbs
                (a clickable thumb that can only 400/409 is a dead end). */}
            {m.id && m.sender !== seat && m.sender !== "hub" && !m.retracted
              ? (() => {
                  const tally = msg_tally(m);
                  // No served decoration (pre-ratings hub) => no thumbs:
                  // a click could only strand or fail (dm 150 ruling).
                  if (!tally) return null;
                  return (
                    <span className="team_vote_thumbs">
                      <button
                        className={`btn btn_icon team_thumb ${tally.mine > 0 ? "up_on" : ""}`}
                        title={tally.mine > 0 ? "Withdraw your +1 on this message" : "+1 this message"}
                        aria-label={tally.mine > 0 ? "Withdraw your +1 on this message" : "+1 this message"}
                        disabled={Boolean(reaction_busy)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void react_on(m.id, 1);
                        }}
                      >
                        <Icon name={tally.mine > 0 ? "thumbsUpFilled" : "thumbsUp"} size={13} />
                        {tally.up ? <span className="team_thumb_count">{tally.up}</span> : null}
                      </button>
                      <button
                        className={`btn btn_icon team_thumb ${tally.mine < 0 ? "down_on" : ""}`}
                        title={tally.mine < 0 ? "Withdraw your −1 on this message" : "−1 this message"}
                        aria-label={tally.mine < 0 ? "Withdraw your −1 on this message" : "−1 this message"}
                        disabled={Boolean(reaction_busy)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void react_on(m.id, -1);
                        }}
                      >
                        <Icon name={tally.mine < 0 ? "thumbsDownFilled" : "thumbsDown"} size={13} />
                        {tally.down ? <span className="team_thumb_count">{tally.down}</span> : null}
                      </button>
                    </span>
                  );
                })()
              : null}
            <button
              className="btn btn_icon"
              title={asks.length ? "Reply and discharge this message's asks" : "Reply in this trail (status=reply, linked to this message)"}
              onClick={(e) => {
                e.stopPropagation();
                start_reply(m);
              }}
            >
              ↩ Reply
            </button>
            {/* Retract (operator dm 88 + agora 0097): the author's own
                undo — the hub tombstones the words at every read and the
                obligation dies. Shown on your own messages, and on ANY
                message when the HUB says this seat is an operator
                (`/whoami.operator`) — visibility only: the hub still
                decides, and its refusal renders verbatim. Two-step. */}
            {(m.sender === seat || is_operator) && !m.retracted ? (
              <button
                className={`btn btn_icon ${retract_nudge === m.id ? "team_danger" : ""}`}
                title={
                  retract_nudge === m.id
                    ? "Click again to retract: the words are redacted for every reader and the message stops demanding anything"
                    : m.sender === seat
                      ? "Retract this message (agents and entities will never read the words; two clicks)"
                      : `Retract ${m.sender}'s message as operator (agents and entities will never read the words; two clicks)`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (retract_nudge === m.id) void retract_message(m);
                  else set_retract_nudge(m.id);
                }}
              >
                {retract_nudge === m.id ? "⌫ confirm retract" : "⌫ Retract"}
              </button>
            ) : null}
            {/* Retract the whole TRAIL (agora 0097 retract_thread). Root
                rows only — the trail is what the root heads — and behind
                the repo's in-app confirm modal, never a bare two-click:
                the blast radius (every message in the trail, for every
                reader and agent) has to be READ before it is armed. */}
            {opts.is_root && (m.sender === seat || is_operator) ? (
              <button
                className="btn btn_icon"
                title="Retract this entire thread — the root and every reply beneath it"
                onClick={(e) => {
                  e.stopPropagation();
                  arm_thread_retraction(m);
                }}
              >
                ⌫ Retract thread
              </button>
            ) : null}
            {/* Decline-on-the-record (operator dm 147a), beside Resolve
                because both verbs CLOSE something and the choice between
                them is only makeable side by side: Decline discharges YOUR
                obligation on THIS message (posts a reply citing its ask
                ids, so the hub clears it for every view — never a local
                hide); Resolve closes the whole topic. The `needs reply`
                badge stays in the header — that is state, not an action.
                Two-step; the arm self-expires after 6s. */}
            {debt_map[m.channel]?.has(m.seq) ? (
              <button
                className={`btn btn_icon ${decline_arm === m.id ? "team_danger" : ""}`}
                title={
                  decline_arm === m.id
                    ? "Click again to decline on the record — posts a reply citing this message's asks so the hub clears the obligation everywhere"
                    : "Decline: close this ask without answering — posts an on-the-record reply so it stops showing everywhere"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  void decline_debt(m);
                }}
              >
                {decline_arm === m.id ? "⊘ confirm decline" : "⊘ Decline"}
              </button>
            ) : null}
            {/* Resolve (operator dm 21): declare the topic closed. Only on
                roots that actually opened something (open/blocked) — a
                resolved post closes the thread on the hub. Two-step. */}
            {/* NOT OFFERED ON AN ALREADY-RESOLVED THREAD (operator dm#30,
             *  scoped by dm#42: "let's not allow to reopen a closed thread
             *  for now. we can always create a new thread referring to an
             *  old one").
             *
             *  A root keeps its posted status word forever — `open` is what
             *  the sender chose, not the thread's state — so gating on the
             *  word alone kept offering Resolve on a thread that was already
             *  closed. Resolving twice posts a second resolved reply and
             *  reads, to the operator, as the console not knowing what it
             *  had already done.
             *
             *  `msg_is_resolved` is the hub's `has_resolved_reply` verdict
             *  with the same fallback the chip uses — one source, and no
             *  reopen affordance in its place, per dm#42. */}
            {opts.is_root &&
            !msg_is_resolved(m) &&
            (String(m.status || "").toLowerCase() === "open" || String(m.status || "").toLowerCase() === "blocked") ? (
              <span className="team_resolve_wrap">
                {resolve_nudge === m.id ? (
                  <input
                    className="team_resolve_data"
                    aria-label="Completion metadata JSON"
                    value={resolve_hub_data}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => set_resolve_hub_data(e.target.value)}
                    placeholder={'Optional Hub JSON, e.g. {"evidence":[…]}' }
                    title="For delegated completion, pass Hub evidence here. WUI does not interpret it."
                  />
                ) : null}
                <button
                  className={`btn btn_icon ${resolve_nudge === m.id ? "team_danger" : ""}`}
                  title={resolve_nudge === m.id ? "Click again to close this topic (posts a resolved reply)" : "Mark this topic resolved — closes the thread on the hub (two clicks)"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (resolve_nudge === m.id) void resolve_thread(m);
                    else {
                      set_resolve_hub_data("");
                      set_resolve_nudge(m.id);
                    }
                  }}
                >
                  {resolve_nudge === m.id ? "✓ confirm resolve" : "✓ Resolve"}
                </button>
              </span>
            ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function render_thread(t: Thread): React.ReactElement {
    const n = t.replies.length;
    // A filter is a request to SEE matching messages — never fold under one.
    const folded = filter === "all" && !open_threads[t.root.id];
    const thread_count = n + 1;
    const thread_label = String(t.root.title || "").trim() || String(t.root.body || "").replace(/\s+/g, " ").trim() || "(no text)";
    // Counts are REPLY-scoped: the bar summarizes exactly what the fold
    // hides. Every message's own state renders on its own row (unread
    // accent, needs-reply chip, status chips, ask list), so the root is
    // never counted here — that double-reporting was the old header's
    // second duplication. Still pure presentation of Hub-served state:
    // `new` is the inbox cursor, `!` the Hub debt set, `?` pending_asks.
    const unread_count = t.replies.filter((m) => Boolean(filter_ctx.unread_seqs?.has(m.seq))).length;
    const debt_count = t.replies.filter((m) => Boolean(debt_map[m.channel]?.has(m.seq))).length;
    const pending_question_count = t.replies.reduce(
      (count, m) => count + (Array.isArray(m.pending_asks) ? m.pending_asks.filter(Boolean).length : 0),
      0,
    );
    const replies_id = `thread-${t.root.id}`;
    const toggle_thread = () => set_open_threads((cur) => ({ ...cur, [t.root.id]: folded }));
    const s = summaries[t.root.id];
    return (
      <article className={`team_thread_group team_thread_card ${n ? "has_replies" : ""} ${folded ? "team_thread_group_folded" : ""}`} key={t.root.id} aria-label={`Thread: ${thread_label}`}>
        {t.orphan ? (
          <div className="team_orphan mono" title="The parent message is older than the fetched window — the trail starts mid-flight.">
            ↩ reply to an earlier message (outside the window)
          </div>
        ) : null}
        {/* The ROOT is the card's headline and always renders: it carries
            its own author, badges, and body — and, when the thread has a
            trail, the fold control in its header. */}
        {render_msg(t.root, {
          is_root: true,
          fold: n > 0
            ? {
                count: n,
                folded,
                disabled: filter !== "all",
                label: thread_label,
                replies_id,
                unread: unread_count,
                debt: debt_count,
                asks: pending_question_count,
                toggle: toggle_thread,
                summarize: ai_available ? () => void summarize_thread(t) : undefined,
                summarize_busy: Boolean(s?.busy),
                summarize_total: thread_count,
              }
            : undefined,
        })}
        {n > 0 && !folded ? (
          <div className="team_replies" id={replies_id}>
            {t.replies.map((r) => render_msg(r, { is_root: false }))}
          </div>
        ) : null}
        {s?.text ? (
          <div className="team_summary">
            <div className="team_summary_head">
              <span>
                AI summary — {s.count} message{s.count === 1 ? "" : "s"}
              </span>
              <button
                className="team_row_expand"
                onClick={() => set_summaries((cur) => ({ ...cur, [t.root.id]: { busy: false, text: "", error: "", count: 0 } }))}
              >
                dismiss
              </button>
            </div>
            <Markdown className="md_doc" text={neutralize_unsafe_embeds(s.text)} />
          </div>
        ) : null}
        {s?.error ? <div className="page_error mono">{s.error}</div> : null}
      </article>
    );
  }

  // "Mark read" targets the channel's TRUE latest, not just the window max
  // — a stale window used to silently under-ack (adversary P1). With the
  // fresh-floor fetch the two agree in practice; max() is the guarantee.
  const window_max_seq = messages.length ? messages[messages.length - 1].seq : 0;
  const latest_seq = Math.max(window_max_seq, channels.find((c) => c.name === selected)?.last_seq || 0);
  const selected_channel_seats = channels.find((c) => c.name === selected)?.member_count || 0;
  /** Channel ownership from the loaded roster (role rides the member rows;
   *  the hub gates channel:meta writes on owner — no operator override). */
  const chan_owner = (members || []).find((m) => String(m.role || "") === "owner")?.agent_id || "";
  const seat_is_owner = Boolean(seat) && chan_owner === seat;

  // Charter debts, split the way a reader acts on them (hub 0146/2): the
  // standing role model, the room you are looking at, the rooms where the
  // hub is already refusing your posts, and — folded to one quiet count —
  // the rooms that are merely behind. Every row is one read away from
  // gone, so each visible one is clickable and nothing here nags twice.
  const charter_hub_debt = charter_debts.find((d) => d.scope === HUB_CHARTER_SCOPE) || null;
  const charter_room_debts = charter_debts.filter((d) => d.scope !== HUB_CHARTER_SCOPE);
  const charter_here = charter_room_debts.find((d) => d.scope === selected) || null;
  const rulings_gated = Boolean(rulings?.gated);
  const charter_gated_elsewhere = charter_room_debts.filter((d) => d.gated && d.scope !== selected);
  const charter_quiet_elsewhere = charter_room_debts.filter((d) => !d.gated && d.scope !== selected);

  return (
    <div
      className="page page_pad team_page"
      /* Drag-and-drop attachments (operator dm 41 + dm 49 "not working"):
         the zone is the WHOLE page, not just the composer — in a real
         browser the operator drops wherever the cursor lands (usually the
         message list), and an unhandled drop navigates the tab to the
         file. A full-pane overlay names the action while files hover. */
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
        e.preventDefault();
        if (can_post && !attach_busy) set_drag_over(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        set_drag_over(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        set_drag_over(false);
        if (!can_post || attach_busy) return;
        void on_attach_files(e.dataTransfer.files);
      }}
    >
      {drag_over ? (
        <div className="team_drop_overlay">
          <div className="team_drop_overlay_card">Drop to attach to {is_dm_channel ? dm_display_peer : `#${selected}`}</div>
        </div>
      ) : null}
      {/* Status strip renders ONLY when something needs saying — the
          permanent toolbar row was chrome tax (design critic: 5 bars
          before the first message). */}
      {(health?.protocol && health.protocol !== PINNED_PROTOCOL) ||
      health?.paused ||
      error ||
      vote_error ||
      notice ||
      charter_debts.length ||
      rulings?.unacked.length ||
      ruling_error ||
      (meta && !meta.seat_key_present) ? (
        <div className="team_statusstrip">
          {meta && !meta.seat_key_present ? (
            <span className="chip mono warn" title="The Hub session is read-only.">
              read-only (no seat key)
            </span>
          ) : null}
          {/* CHARTER DEBTS (`/owed.charters`). The hub states them; reading
              clears them, because the read IS the receipt. A gated room is
              the only one of these that blocks anything — the hub is
              already refusing posts there — so it wears the warning and
              the rest stay quiet. */}
          {charter_hub_debt ? (
            <button
              className="chip mono team_charter_chip"
              onClick={() => void open_charter(HUB_CHARTER_SCOPE)}
              title={
                `The hub charter is at v${charter_hub_debt.version} and ` +
                (charter_hub_debt.your_receipt === null
                  ? "you have never read it"
                  : `your receipt is for v${charter_hub_debt.your_receipt}`) +
                (charter_hub_debt.reason === "view"
                  ? " — your seat changed since you read it, so the text you were served never contained the sections now addressed to you"
                  : "") +
                ". It is the standing role model (who is who): who may retract what, what a delegate owes, what an operator's word settles. Reading it blocks nothing and records your receipt."
              }
            >
              hub charter v{charter_hub_debt.version} unread
            </button>
          ) : null}
          {charter_here ? (
            <button
              className={`chip mono team_charter_chip ${charter_here.gated ? "warn" : ""}`}
              onClick={() => void open_charter(charter_here.scope)}
              title={
                `#${charter_here.scope}'s charter is at v${charter_here.version} and ` +
                (charter_here.your_receipt === null ? "you have not read it" : `your receipt is for v${charter_here.your_receipt}`) +
                (charter_here.gated
                  ? ". This room sets norms_required: the hub REFUSES your posts here until you read it (409). Opening it is the whole fix — one read, one call."
                  : ". Reading it records your receipt; nothing here is blocked.")
              }
            >
              {charter_here.gated ? `#${charter_here.scope} charter unread — posting gated` : `#${charter_here.scope} charter v${charter_here.version} unread`}
            </button>
          ) : null}
          {charter_gated_elsewhere.map((d) => (
            <button
              key={`charter_gated_${d.scope}`}
              className="chip mono warn team_charter_chip"
              onClick={() => void open_charter(d.scope)}
              title={`#${d.scope} sets norms_required and the hub is refusing your posts there until you read its charter (v${d.version}).`}
            >
              #{d.scope} posting gated
            </button>
          ))}
          {/* STANDING RULINGS (hub 0113) — the charter gate's sibling, one
              tier down: not the room's whole rulebook but the individual
              constraints every later decision must respect. The chip is the
              unacknowledged count for THIS room; the Members drawer holds
              the text and the acknowledge control. In a `rulings_required`
              room the hub is already refusing posts, so it wears warn. */}
          {rulings?.unacked.length ? (
            <button
              className={`chip mono team_charter_chip ${rulings_gated ? "warn" : ""}`}
              onClick={() => {
                if (drawer !== "members") toggle_drawer("members");
              }}
              title={
                `${rulings.unacked.length} standing ruling(s) in #${selected} you have not acknowledged at their current version: ` +
                rulings.unacked.map((r) => `${r.key} (v${r.version})`).join(", ") +
                (rulings_gated
                  ? ". This room sets rulings_required: the hub REFUSES your posts here (409) until each is acknowledged."
                  : ". Nothing is blocked — acknowledging records that you have read them.") +
                " Acknowledging is delivery, never agreement: disagree on the record, in the room."
              }
            >
              {rulings_gated
                ? `#${selected} rulings unacknowledged — posting gated`
                : `${rulings.unacked.length} standing ruling${rulings.unacked.length === 1 ? "" : "s"} unacknowledged`}
            </button>
          ) : null}
          {ruling_error ? <span className="page_error mono">{ruling_error}</span> : null}
          {charter_quiet_elsewhere.length ? (
            <span
              className="chip mono muted"
              title={`Rooms whose charter changed since you last read it: ${charter_quiet_elsewhere
                .map((d) => `#${d.scope} (v${d.version})`)
                .join(", ")}. Nothing is blocked — open a room to read its charter there.`}
            >
              {charter_quiet_elsewhere.length} other charter{charter_quiet_elsewhere.length === 1 ? "" : "s"} behind
            </span>
          ) : null}
          {health?.protocol && health.protocol !== PINNED_PROTOCOL ? (
            <span
              className="chip mono warn"
              title={`The hub advertises ${health.protocol}; this page was written against ${PINNED_PROTOCOL}. Meaning may have shifted — rendering continues (protocol.md: warn, never refuse).`}
            >
              protocol {health.protocol} ≠ {PINNED_PROTOCOL}
            </span>
          ) : null}
          {health?.paused ? (
            <span className="chip mono warn" title="The operator paused the hub — posting resumes when it does.">
              hub paused
            </span>
          ) : null}
          {error ? <span className="page_error mono">{error}</span> : null}
          {/* Reaction/vote failures were drawer-only before (operator dm
              82's "not working" had no visible error): surface them in the
              main strip, dismissable by the next successful act. */}
          {vote_error ? <span className="page_error mono">±1 failed: {vote_error}</span> : null}
          {notice ? <span className="chip mono ok">{notice}</span> : null}
        </div>
      ) : null}

      <div className={`team_layout ${drawer ? "with_drawer" : ""} ${drawer === "leaderboard" ? "drawer_wide" : ""}`}>
        {/* The rail is TWO panes stacked (operator ask 2026-08-20): channels
            above, direct messages below, each scrolling independently. As one
            list, a long channel set pushed every DM below the fold. */}
        <div className="team_rail">
        <div className="pane team_channels_pane">
          <div className="pane_header">
            <span className="pane_title">Channels</span>
            <span className="pane_count">{channels.filter((c) => !c.name.startsWith("dm:")).length}</span>
            <span className="pane_header_actions">
              <button
                className="btn btn_icon"
                title="Join a channel — paste an invitation, or name a public channel"
                aria-label="Join channel"
                onClick={() => set_join_form((f) => ({ ...f, open: !f.open }))}
              >
                <Icon name="enter" size={14} />
              </button>
              <button
                className="btn btn_icon"
                title="Create a channel (you become its owner)"
                aria-label="New channel"
                onClick={() => set_new_channel_form((f) => ({ ...f, open: !f.open }))}
              >
                <Icon name="plus" size={14} />
              </button>
            </span>
          </div>
          {join_form.open ? (
            <div className="team_new_channel team_join_channel">
              <input
                value={join_form.channel}
                onChange={(e) => { absorb_invite(e.target.value); set_join_form((f) => ({ ...f, channel: looks_like_invite_ref(e.target.value) ? f.channel : e.target.value })); }}
                onPaste={(e) => absorb_invite(e.clipboardData.getData("text"))}
                placeholder="channel, or paste the invitation"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") void join_channel(); }}
              />
              <input
                value={join_form.token}
                onChange={(e) => { absorb_invite(e.target.value); set_join_form((f) => ({ ...f, token: looks_like_invite_ref(e.target.value) ? f.token : e.target.value })); }}
                onPaste={(e) => absorb_invite(e.clipboardData.getData("text"))}
                placeholder="invite token (public channels: leave empty)"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") void join_channel(); }}
              />
              <button className="btn primary" disabled={!join_form.channel.trim() || chan_admin_busy} onClick={() => void join_channel()}>
                {chan_admin_busy ? "Joining…" : "Join"}
              </button>
            </div>
          ) : null}
          {new_channel_form.open ? (
            <div className="team_new_channel">
              <input
                value={new_channel_form.name}
                onChange={(e) => set_new_channel_form((f) => ({ ...f, name: e.target.value }))}
                placeholder="channel-name (simple slug)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create_channel();
                }}
              />
              <label title="Private channels need invites; public ones are joinable by any registered agent.">
                <input
                  type="checkbox"
                  checked={new_channel_form.is_private}
                  onChange={(e) => set_new_channel_form((f) => ({ ...f, is_private: e.target.checked }))}
                />
                private
              </label>
              <button className="btn primary" disabled={!new_channel_form.name.trim() || chan_admin_busy} onClick={() => void create_channel()}>
                {chan_admin_busy ? "Creating…" : "Create"}
              </button>
            </div>
          ) : null}
          <div className="pane_body pane_body_list">
            {/* Degraded rail state (dm-99 audit F9): an empty rail after a
                failed load used to render as pure blank — indistinguishable
                from "no channels". Name the state; the poll + the WS
                mount-heal retry recovery automatically. */}
            {!channels.length ? (
              <div className="muted team_note team_rail_degraded">
                {error ? "Channels unavailable — the hub is unreachable. Retrying automatically; check that the hub is running if this persists." : "Loading channels…"}
              </div>
            ) : null}
            {channels.filter((c) => c.member && !c.name.startsWith("dm:")).map((c) => {
              const b = badges[c.name];
              const arming = archive_nudge === c.name;
              return (
                <div
                  key={c.name}
                  className={`team_channel team_dm_row ${selected === c.name ? "selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => set_selected(c.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") set_selected(c.name);
                  }}
                >
                  <span className="team_channel_line">
                    <span className={`team_channel_name ${b?.unread ? "has_unread" : ""}`}>#{c.name}</span>
                    <span className="team_channel_badges">
                      {/* Numbers only — color codes the kind (glyph soup at
                          10px read as noise, design critic); clicking a
                          badge selects the channel AND applies its filter
                          (usability critic: the badge tooltip used to
                          NAME the filter instead of applying it). */}
                      {b?.unread ? (
                        <span
                          className="team_badge unread"
                          role="button"
                          tabIndex={0}
                          title={`${b.unread >= 100 ? "100 or more" : b.unread} unread message(s) for your seat — the Unread tab shows the same number. Click to open with the Unread filter.`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (c.name !== selected) pending_filter.current = "unread";
                            set_selected(c.name);
                            set_filter("unread");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              if (c.name !== selected) pending_filter.current = "unread";
                              set_selected(c.name);
                              set_filter("unread");
                            }
                          }}
                        >
                          {b.unread >= 100 ? "99+" : b.unread}
                        </span>
                      ) : null}
                      {b?.open_questions ? (
                        <span
                          className="team_badge asks"
                          role="button"
                          tabIndex={0}
                          title={`${b.open_questions} open question(s) in this room still awaiting answers (channel digest) — click to open with the Asks filter`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (c.name !== selected) pending_filter.current = "asks";
                            set_selected(c.name);
                            set_filter("asks");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              if (c.name !== selected) pending_filter.current = "asks";
                              set_selected(c.name);
                              set_filter("asks");
                            }
                          }}
                        >
                          {b.open_questions}
                        </span>
                      ) : null}
                      {/* Archive (safe-delete) on hover (operator dm 19/29):
                          two-step, evicts members, history preserved.
                          Owner/operator — the hub enforces; a 404 means the
                          verb hasn't shipped and the click says so. */}
                      <button
                        className={`team_dm_trash ${arming ? "arming" : ""}`}
                        title={arming ? "Click again to archive this channel (evicts members; history preserved)" : "Archive this channel — evicts everyone and drops it off rails; messages are preserved (owner/operator)"}
                        aria-label={arming ? "Confirm archive channel" : "Archive channel"}
                        disabled={chan_admin_busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (arming) void archive_channel(c.name);
                          else set_archive_nudge(c.name);
                        }}
                      >
                        <Icon name={arming ? "x" : "trash"} size={12} />
                      </button>
                    </span>
                  </span>
                  <span className="team_channel_meta mono">
                    {arming ? "archive? click ✕" : `${c.member_count} seats · ${ago(c.last_at)}`}
                  </span>
                </div>
              );
            })}
            {/* (The empty/degraded rail state renders once at the top of
                this list — team_rail_degraded, dm-99 F9.) */}
          </div>
        </div>

        {(() => {
          // Direct messages: the operator's own dm:* channels (his seat,
          // his ballots — c2240 made them first-class here), in their own
          // pane so they are reachable without scrolling past every room.
          const dms = channels.filter((c) => c.member && c.name.startsWith("dm:"));
          if (!dms.length) return null;
          const dm_unread = dms.reduce((n, c) => n + (badges[c.name]?.unread ? 1 : 0), 0);
          return (
            <div className="pane team_dms_pane">
              <div className="pane_header">
                <span className="pane_title">Direct messages</span>
                <span className="pane_count">{dms.length}</span>
                {dm_unread ? (
                  <span className="team_badge unread" title={`${dm_unread} direct message thread(s) with unread messages`}>
                    {dm_unread}
                  </span>
                ) : null}
              </div>
              <div className="pane_body pane_body_list">
                {dms.map((c) => {
                    const b = badges[c.name];
                    const peer = c.name.replace(/^dm:/, "").split("--").filter((p) => p !== seat).join("") || c.name;
                    const arming = leave_nudge === c.name;
                    return (
                      <div
                        key={c.name}
                        className={`team_channel team_dm_row ${selected === c.name ? "selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => set_selected(c.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") set_selected(c.name);
                        }}
                      >
                        <span className="team_channel_line">
                          <span className={`team_channel_name ${b?.unread ? "has_unread" : ""}`}>@{peer}</span>
                          <span className="team_channel_badges">
                            {b?.unread ? <span className="team_badge unread" title={`${b.unread >= 100 ? "100 or more" : b.unread} unread message(s)`}>{b.unread >= 100 ? "99+" : b.unread}</span> : null}
                            {/* Trash on hover (operator dm 14): remove this DM
                                from the list. Two-step — first click arms,
                                second confirms — so a stray click never drops
                                a conversation. Non-destructive (history stays;
                                reopens on next contact). */}
                            <button
                              className={`team_dm_trash ${arming ? "arming" : ""}`}
                              title={arming ? "Click again to remove this DM from your list" : "Remove this DM from your list (history is kept; it reopens if they message you)"}
                              aria-label={arming ? "Confirm remove direct message" : "Remove direct message"}
                              disabled={chan_admin_busy}
                              onClick={(e) => {
                                e.stopPropagation(); // never select the row
                                if (arming) void leave_dm(c.name);
                                else set_leave_nudge(c.name);
                              }}
                            >
                              <Icon name={arming ? "x" : "trash"} size={12} />
                            </button>
                          </span>
                        </span>
                        <span className="team_channel_meta mono">{arming ? "remove? click ✕" : ago(c.last_at)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })()}
        </div>

        <div className="pane team_thread_pane">
          <div className="pane_header team_thread_header">
            <span className="pane_title team_pane_title">
              {selected ? (is_dm_channel ? `@${dm_display_peer} — direct` : `#${selected}`) : "Select a channel"}
            </span>
            {/* The MEMBERS BUTTON (operator c2240: "i also do not see button
                to view the members of a channel, please create it" — the
                roster behind the icon-only ⓘ was proven undiscoverable). */}
            {selected && selected_channel_seats ? (
              <button
                className="chip team_members_chip"
                onClick={() => {
                  if (drawer !== "members") toggle_drawer("members");
                }}
                title="View the channel members (opens the Members drawer, roster + moderation)"
              >
                {selected_channel_seats} members
              </button>
            ) : null}
            {loading ? <span className="muted team_note">loading…</span> : null}
            <span className="pane_header_actions">
              {/* Channel-scoped acts live ON the channel pane (design
                  critic: the page toolbar claimed page scope for channel
                  acts). Label names the exact target seq — "to here"
                  read as "to where I've read" (usability critic F2). */}
              {(() => {
                // Ack-to-last-VISIBLE (backlog 0010): under a filter the
                // target is the last message the operator can see; on
                // "all" it is the window's latest. An empty filtered view
                // disables the act — acking past hidden rows was the
                // imprecision.
                const ack_target = filter === "all" ? latest_seq : visible_max_seq;
                return (
                  <button
                    className="btn"
                    onClick={() => void mark_read_to(ack_target)}
                    disabled={!selected || !messages.length || !ack_target || ack_busy || loading}
                    title={
                      filter === "all"
                        ? "Moves your inbox cursor for this channel to the latest message in the window. The ONE explicit 'I have seen this' act (nothing acks on render)."
                        : "Moves your inbox cursor to the last message VISIBLE under this filter — messages newer than it stay unread. (The cursor is a single high-water mark: hidden rows BELOW it are cleared too.)"
                    }
                  >
                    {ack_busy ? "Marking…" : `Mark read → #${ack_target || "…"}`}
                  </button>
                );
              })()}
              <button
                className="btn btn_icon"
                onClick={() => {
                  void refresh_channels();
                  void refresh_messages(selected);
                }}
                title="Refresh channels, badges, and the thread window (the page also polls every 5s)"
                aria-label="Refresh"
              >
                <Icon name="refresh" size={14} />
              </button>
              {verify_state && verify_state !== "running" && typeof verify_state === "object" && "ok" in verify_state ? (
                verify_state.ok ? (
                  <AfChip
                    tone="success"
                    size="sm"
                    title={`Hash chain recomputed client-side over ${verify_state.hashed - verify_state.redacted} hashed turns (${verify_state.legacy} pre-ledger${verify_state.redacted ? `, ${verify_state.redacted} retracted and linked rather than recomputed — a retracted turn serves a tombstone instead of the bytes it committed to` : ""}); served head matches.`}
                  >
                    transcript intact ({verify_state.hashed}{verify_state.redacted ? `, ${verify_state.redacted} retracted` : ""})
                  </AfChip>
                ) : (
                  <AfChip
                    tone="error"
                    size="sm"
                    title={
                      verify_state.broken_at !== null
                        ? `Recomputed chain diverges at seq ${verify_state.broken_at} — a hashed turn was edited, inserted, or reordered.`
                        : "Chain internally consistent but the served head does not match the last turn — the hub is presenting a different commitment."
                    }
                  >
                    TAMPERED{verify_state.broken_at !== null ? ` at #${verify_state.broken_at}` : " (head mismatch)"}
                  </AfChip>
                )
              ) : null}
              {verify_state && typeof verify_state === "object" && "error" in verify_state ? (
                <AfChip tone="warning" size="sm" title={verify_state.error}>
                  verify failed
                </AfChip>
              ) : null}
              <button
                className="btn btn_icon"
                onClick={() => void verify_transcript()}
                disabled={!selected || verify_state === "running"}
                title="Fetch the channel's verbatim ledger and recompute the sha256 hash chain in this browser — independent of the hub's own verified flag."
              >
                {verify_state === "running" ? "Verifying…" : "Verify transcript"}
              </button>
            </span>
          </div>

          <div className="team_filterbar">
            <div className="seg seg_scroll" role="group" aria-label="Message filters">
              {TEAM_FILTERS.map((f) => {
                const active = filter === f.id;
                const count = filter_counts[f.id];
                return (
                  <button key={f.id} className={`seg_btn ${active ? "active" : ""}`} aria-pressed={active} title={f.title} onClick={() => set_filter(f.id)}>
                    {f.label}
                    {typeof count === "number" && count > 0 ? <span className="team_filter_count">{count}</span> : null}
                  </button>
                );
              })}
            </div>
            {/* Hub-wide search (agora-0132, hub ≥ 0.12.44): Enter submits;
                the grouped report replaces the thread list until closed
                (Esc or ✕). The hub scopes hits to the seat's own channels
                server-side — the box searches "everything I can read". */}
            <form
              className="team_search_bar"
              onSubmit={(e) => {
                e.preventDefault();
                // Empty submit = rated-browse entry (agora-0134 v2): the
                // hub accepts q="" when rated is set; default the lens to
                // "down" because "where is the displeasure" is the browse
                // this operator actually asked for (dm 153/157 lineage).
                const q = search_q.trim();
                if (!q && !search_rated) {
                  set_search_rated("down");
                  exec_search("", search_scope, "down");
                  return;
                }
                run_search(q);
              }}
            >
              <input
                className="team_search_input"
                type="search"
                placeholder="Search the hub…"
                value={search_q}
                onChange={(e) => set_search_q(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (search_view) close_search();
                    set_search_q("");
                  }
                }}
                title="Search everything your seat can read (Enter). Served as a grouped report: decisions, open threads, work, people, files, messages. Enter on an empty box browses rated messages (most-downvoted first)."
                aria-label="Search the hub"
              />
              {search_view ? (
                <button type="button" className="btn btn_icon team_search_close" onClick={close_search} title="Close search results (Esc)" aria-label="Close search results">
                  ✕
                </button>
              ) : null}
            </form>
            {/* Sort toggle (laurent dm#137): Recency = the threaded window
                (default); Top voted = hub-served whole-channel ranking. */}
            <div className="seg" role="group" aria-label="Sort order">
              <button
                className={`seg_btn ${sort_mode === "recency" ? "active" : ""}`}
                aria-pressed={sort_mode === "recency"}
                title="Threads by last activity (default)"
                onClick={() => set_sort_mode("recency")}
              >
                Recency
              </button>
              <button
                className={`seg_btn ${sort_mode === "votes" ? "active" : ""}`}
                aria-pressed={sort_mode === "votes"}
                title="The channel's most-voted messages — whole channel, ranked by net standing ±1 (hub-served order)"
                onClick={() => {
                  set_sort_mode("votes");
                  load_top_rated();
                }}
              >
                Top voted
              </button>
            </div>
            <span className="team_filterbar_meta">
              <span className={`team_live_dot ${live ? "on" : ""}`} title={live ? "Live: agents' posts push instantly over a websocket. Your own posts from OTHER windows arrive with the 5s poll (the hub skips echoing your seat's frames back)." : "Polling every 5s — the live socket is down (it reconnects automatically)."}>
                {live ? "● live" : "◌ polling"}
              </span>
              {" · "}
              {visible_threads.length !== threads.length ? `${visible_threads.length} of ${threads.length} threads` : threads.length ? `${threads.length} threads` : ""}
              {meta?.seat_key_present ? (
                // The seat's MISSION rides `/whoami` (hub 0.17.1): the
                // operator's standing charge for this seat, which no seat
                // can author or soften for itself. It belongs beside the
                // identity it qualifies, not in a drawer.
                <span
                  title={
                    "Posts are authored under this hub seat — your own identity, key held server-side." +
                    (meta.mission ? `\n\nStanding mission (set by the operator): ${meta.mission}` : "")
                  }
                >
                  {" "}
                  · as {meta.seat}
                  {meta.mission ? <span className="team_seat_mission"> · mission set</span> : null}
                </span>
              ) : null}
            </span>
          </div>

          <div
            className="pane_body team_thread"
            ref={list_ref}
            /* Citation previews (operator dm 21/22) are delegated from the
               feed rather than bound per chip: the chips are produced by the
               Markdown renderer, which knows nothing about the hub, and there
               can be hundreds of them on screen. */
            onMouseOver={(e) => {
              const chip = cite_chip_at(e.target);
              if (chip) void show_cite_card(chip);
            }}
            onMouseOut={(e) => {
              if (!cite_chip_at(e.target)) return;
              // Moving from the chip INTO the card must not close it — the
              // card is how you read a long citation.
              const to = e.relatedTarget as HTMLElement | null;
              if (to && typeof to.closest === "function" && to.closest(".team_cite_card")) return;
              set_cite_card(null);
            }}
            /* Keyboard parity: the chips are focusable, so a preview must be
               reachable without a pointer. */
            onFocus={(e) => {
              const chip = cite_chip_at(e.target);
              if (chip) void show_cite_card(chip);
            }}
            onBlur={(e) => {
              if (cite_chip_at(e.target)) set_cite_card(null);
            }}
            /* Hover previews, CLICK NAVIGATES (operator dm 34). Capture
               phase and stopPropagation so the row's own click handler
               never also runs — the chip lives inside the message body, and
               a jump that additionally folded the thread you just left
               would be its own bug. */
            onClickCapture={(e) => {
              const chip = cite_chip_at(e.target);
              if (!chip) return;
              e.preventDefault();
              e.stopPropagation();
              void jump_to_cite(chip);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              const chip = cite_chip_at(e.target);
              if (!chip) return;
              e.preventDefault();
              e.stopPropagation();
              void jump_to_cite(chip);
            }}
          >
            {search_view ? (
              // SEARCH RESULTS VIEW (agora-0132): render the served grouped
              // report verbatim — six fixed sections, served order, loud
              // truncation, loud relaxation. No client re-ranking ever.
              (() => {
                const sv = search_view;
                if (sv.error) return <div className="muted team_note">{sv.error}</div>;
                if (sv.busy || !sv.report) return <div className="muted team_note">{sv.q ? `Searching “${sv.q}”…` : "Browsing rated messages…"}</div>;
                const report = sv.report;
                // SECTION MODE: one kind, sort=recent, keyset-paged.
                if (search_section) {
                  const sec = search_section;
                  return (
                    <div className="team_search_results">
                      <div className="team_search_meta">
                        <button className="team_replies_more" onClick={() => set_search_section(null)}>
                          ← All results
                        </button>
                        <span className="muted">
                          {sec.label} matching “{sv.q}” — newest first{sec.total ? ` · ${sec.hits.length} of ${sec.total}` : ""}
                        </span>
                      </div>
                      {sec.error ? <div className="muted team_note">{sec.error}</div> : null}
                      {sec.hits.map((h) => render_search_hit(h))}
                      {sec.busy ? <div className="muted team_note">Loading…</div> : null}
                      {!sec.busy && sec.cursor ? (
                        <button className="team_replies_more team_search_more" onClick={load_more_search_section}>
                          Load more
                        </button>
                      ) : null}
                      {!sec.busy && !sec.hits.length && !sec.error ? <div className="muted team_note">Nothing in {sec.label.toLowerCase()} matches “{sv.q}”.</div> : null}
                    </div>
                  );
                }
                const empty_sections = SEARCH_SECTIONS.filter((s) => !((report[s.id]?.total ?? 0) > 0));
                const any_hits = empty_sections.length < SEARCH_SECTIONS.length;
                return (
                  <div className="team_search_results">
                    {/* Relaxed banner ONLY on lexical (or pre-semantic) runs
                        (dm#126 render rule): a fused response already blended
                        meaning matches in — the loosened-terms warning would
                        mislabel good semantic hits as noise. */}
                    {report.relaxed && (!report.mode_used || report.mode_used === "lexical") ? (
                      <div className="team_search_relaxed" title="The strict query (all terms) found nothing, so the hub re-ran it as ANY-term (OR). Matches below are looser than what you typed.">
                        No exact matches — showing loosened (any-term) matches instead.
                      </div>
                    ) : null}
                    {/* Degraded-state notice (dm#126): visible + copyable —
                        a zero-hit under a notice does not prove absence, and
                        receipts built on it must quote the notice text. */}
                    {report.notice ? (
                      <div className="team_search_notice" title="Served by the hub while search is degraded — quote this text in anything you conclude from these results.">
                        {report.notice}
                      </div>
                    ) : null}
                    <div className="team_search_meta">
                      <span className="muted">
                        {sv.q ? `“${sv.q}”` : `rated messages${search_rated ? ` (${search_rated === "down" ? "↓ downvoted" : "↑ upvoted"}, net-vote order)` : ""}`} · {report.channels_searched ?? 0} channel{(report.channels_searched ?? 0) === 1 ? "" : "s"} searched
                        {report.mode_used ? (
                          <span className="team_search_mode mono" title="Which search engine answered: fused = word + meaning matches blended; lexical = words only; semantic = meaning only. Served verbatim by the hub.">
                            {" "}· {report.mode_used}
                            {typeof report.semantic_coverage === "number" ? ` (${Math.round(report.semantic_coverage * 100)}% embedded)` : ""}
                          </span>
                        ) : null}
                      </span>
                      {/* Rated lens (agora-0134): filter message hits by
                          standing ratings; with an empty query this is the
                          browse view laurent gets "most downvoted" from. */}
                      <span className="seg team_search_rated" role="group" aria-label="Rated filter">
                        {(["up", "down"] as const).map((dir) => (
                          <button
                            key={dir}
                            className={`seg_btn ${search_rated === dir ? "active" : ""}`}
                            aria-pressed={search_rated === dir}
                            title={dir === "up" ? "Only messages with net-positive standing ratings (toggle re-runs)" : "Only messages with net-negative standing ratings — where displeasure lives (toggle re-runs)"}
                            onClick={() => {
                              const next = search_rated === dir ? "" : dir;
                              set_search_rated(next);
                              exec_search(sv.q, search_scope, next);
                            }}
                          >
                            {dir === "up" ? "▲ rated" : "▼ rated"}
                          </button>
                        ))}
                      </span>
                      <label className="team_search_scope" title="Limit the search to the channel currently open in the rail (re-runs the query)">
                        <input
                          type="checkbox"
                          checked={search_scope === "channel"}
                          onChange={(e) => {
                            const scope = e.target.checked ? "channel" : "all";
                            set_search_scope(scope);
                            // Re-run under the new scope immediately — a
                            // scope toggle that silently applies "next
                            // time" reads as a broken checkbox.
                            exec_search(sv.q, scope, search_rated);
                          }}
                        />
                        this channel only
                      </label>
                    </div>
                    {SEARCH_SECTIONS.map((s) => {
                      const sec = report[s.id];
                      const shown = sec?.shown ?? 0;
                      const total = sec?.total ?? 0;
                      const hits = sec?.hits ?? [];
                      if (!sec || (!total && !hits.length)) return null;
                      return (
                        <div className="team_search_section" key={s.id}>
                          <div className="team_search_section_head">
                            <span className="team_search_section_label">{s.label}</span>
                            <span className="muted mono">
                              {/* LOUD truncation (contract): shown < total must say so. */}
                              {shown < total ? `showing ${shown} of ${total}` : `${total}`}
                            </span>
                            {shown < total && s.kind ? (
                              <button className="team_replies_more" onClick={() => open_search_section(s.label, s.kind!)} title={`All ${total} ${s.label.toLowerCase()} matches, newest first (paged)`}>
                                view all →
                              </button>
                            ) : null}
                          </div>
                          {hits.map((h) => render_search_hit(h))}
                        </div>
                      );
                    })}
                    {!any_hits ? (
                      <div className="muted team_note">{sv.q ? `Nothing matches “${sv.q}” in the channels this seat can read.` : "No rated messages match this lens."}</div>
                    ) : empty_sections.length ? (
                      <div className="muted team_search_empties">nothing in {empty_sections.map((s) => s.label.toLowerCase()).join(", ")}</div>
                    ) : null}
                  </div>
                );
              })()
            ) : sort_mode === "votes" ? (
              // TOP-VOTED VIEW: flat, hub-ranked, whole channel — never
              // threaded (threading a ranked list scrambles the ranking).
              top_error ? (
                <div className="muted team_note">{top_error}</div>
              ) : top_rows === null ? (
                <div className="muted team_note">Loading the channel's top-voted messages…</div>
              ) : !top_rows.length ? (
                <div className="muted team_note">No rated messages in this channel yet — cast the first ±1 from any message's thumbs.</div>
              ) : (
                top_rows.map((m, i) => (
                  <div className="team_top_row" key={m.id}>
                    <div className="team_top_rank_line">
                      <span className="team_top_rank mono" title="Rank by net standing rating (hub-served order)">
                        #{i + 1}
                      </span>
                      <button className="team_replies_more" onClick={() => jump_to_thread(m)} title="Switch back to recency and scroll to this message in its thread">
                        view in thread
                      </button>
                    </div>
                    {render_msg(m, { is_root: true })}
                  </div>
                ))
              )
            ) : (
            <>
            {(() => {
              // Day dividers key on LAST ACTIVITY — the same axis the
              // thread sort uses; root-day labels ran backwards when an
              // old root got a fresh reply (usability critic F8).
              const out: React.ReactElement[] = [];
              let last_day = "";
              for (const t of visible_threads) {
                const last_msg = t.replies.length ? t.replies[t.replies.length - 1] : t.root;
                const day = day_of(last_msg.created_at);
                if (day && day !== last_day) {
                  last_day = day;
                  out.push(
                    <div className="team_day_divider" key={`day:${day}:${t.root.id}`}>
                      <span>{day}</span>
                    </div>
                  );
                }
                out.push(render_thread(t));
              }
              return out;
            })()}
            {!visible_threads.length && selected && !loading ? (
              <div className="muted team_note">
                {threads.length ? (
                  <>
                    {/* NAME the active filter (dm 99: an anonymous "no
                        messages match" under a forgotten sticky filter
                        read as the app failing to display). */}
                    Nothing matches the <strong>{TEAM_FILTERS.find((f) => f.id === filter)?.label || filter}</strong> filter in this channel — the messages exist under All.{" "}
                    <button className="team_replies_more" onClick={() => set_filter("all")}>
                      Show all
                    </button>
                  </>
                ) : (
                  "No messages in the window."
                )}
              </div>
            ) : null}
            </>
            )}
          </div>

          {/* CITATION PREVIEW (operator dm 21/22). Fixed to the viewport and
              anchored to the chip's own rect, so it is not clipped by the
              feed's scroll container. Rendered as a SIBLING of the feed for
              the same reason. */}
          {cite_card ? (
            <div
              className="team_cite_card"
              role="tooltip"
              style={{
                // Prefer above the chip; flip below when there is no room.
                // 400 is the card's max-height in the stylesheet — the one
                // number shared with the CSS, and it is the pessimistic case.
                ...(cite_card.anchor.top > 420 ? { bottom: `${Math.max(8, window.innerHeight - cite_card.anchor.top + 8)}px` } : { top: `${cite_card.anchor.bottom + 8}px` }),
                // 706 = the stylesheet's 686px card + 20px of margin. The
                // two numbers must move together; the stylesheet is the
                // source and this is the only place that mirrors it.
                left: `${Math.max(8, Math.min(cite_card.anchor.left, Math.max(8, window.innerWidth - 706)))}px`,
              }}
              onMouseLeave={() => set_cite_card(null)}
            >
              <div className="team_cite_head">
                {/* Always fully qualified, even when the citation was a bare
                    `#412` — the card is where you find out WHICH room it
                    resolved against. */}
                <span className="team_cite_ref">
                  {cite_card.channel}#{cite_card.seq}
                </span>
                {cite_card.state === "found" && cite_card.msg ? (
                  <>
                    <span className="team_cite_sender">{String(cite_card.msg.sender || "")}</span>
                    {/* THREAD state, never the root's posted word (dm 34).
                        Absent when the replies are not in hand — a
                        cross-channel citation resolves one message, and
                        printing its `open` there is what said "still open"
                        about a thread that had been closed. */}
                    {cite_card.thread_state ? (
                      <span className="team_cite_status" title={cite_card.thread_state === "resolved" ? "A resolved reply closes this thread" : "No resolved reply in this thread yet"}>
                        {cite_card.thread_state}
                      </span>
                    ) : null}
                    <span className="team_cite_open" aria-hidden="true">
                      click to open →
                    </span>
                  </>
                ) : null}
              </div>
              {cite_card.state === "loading" ? <div className="muted team_cite_note">Loading…</div> : null}
              {/* A seq the hub does not serve and a room this seat cannot
                  read are DIFFERENT answers. Collapsing them into one empty
                  card is how a permissions boundary reads as a broken link. */}
              {cite_card.state === "missing" ? <div className="muted team_cite_note">No message #{cite_card.seq} in #{cite_card.channel} — it may be out of the served window, retracted, or never posted.</div> : null}
              {cite_card.state === "error" ? <div className="muted team_cite_note">Could not read #{cite_card.channel}: {cite_card.error}</div> : null}
              {cite_card.state === "found" && cite_card.msg ? (
                <>
                  {String(cite_card.msg.title || "").trim() ? <div className="team_cite_title">{String(cite_card.msg.title)}</div> : null}
                  {/* Markdown, the same pipeline the feed uses (operator dm
                      49) minus `linkify_citations`: a chip inside the card
                      would be a hover affordance nested in a hover surface,
                      and `cite_channels` is deliberately omitted for the same
                      reason the charter and file viewers omit it.
                      `neutralize_unsafe_embeds` is NOT optional here — this
                      is peer-authored text and the card is the one place it
                      renders outside the feed.
                      The old plain-text slice was justified as "a markdown
                      re-parse per hover is what MemoMarkdown exists to
                      avoid": that cost is per FEED ROW (200 of them), and a
                      card is one node that exists only while the pointer is
                      on a chip. `clip_markdown` keeps the cap and stops the
                      slice landing inside a fence. */}
                  <div className="team_cite_body">
                    {String(cite_card.msg.body || "").trim() ? (
                      <Markdown className="md_doc" text={clip_markdown(neutralize_unsafe_embeds(autolink_body(reflow_prose_walls(String(cite_card.msg.body)), { hub_base: hub_url })), 1200)} />
                    ) : (
                      "(no body)"
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div
            className="team_composer"
            onKeyDown={(e) => {
              // Esc cancels reply mode (usability critic F9).
              if (e.key === "Escape" && reply_to) cancel_reply();
            }}
          >
            {reply_to ? (
              <div className="team_reply_banner">
                <button
                  className="team_reply_target"
                  title="Jump to the message you are replying to"
                  onClick={() => {
                    document.getElementById(`hubmsg-${reply_to.id}`)?.scrollIntoView({ block: "center" });
                  }}
                >
                  ↩ #{reply_to.seq} ({reply_to.sender}) —{" "}
                  {(String(reply_to.title || "").trim() || String(reply_to.body || "").trim()).slice(0, 80) || "(no text)"}
                </button>
                {(reply_to.data?.asks || []).length ? (
                  <span className="team_reply_asks">
                    {/* WHO EACH ASK IS FOR, and no tickbox for one that is not
                        yours (operator commons#75). The composer used to offer
                        an identical checkbox for every ask regardless of who it
                        named, and the only feedback was the hub refusing the
                        post — "you may not discharge ask ids not addressed to
                        you". The recipient was nowhere on screen, so there was
                        nothing to read that would have prevented it. */}
                    {(reply_to.data?.asks || []).map((a) => {
                      const to = ask_to(a);
                      const mine = ask_is_mine(reply_to, a);
                      return (
                        <label
                          key={a.id}
                          className={mine ? "" : "team_reply_ask_not_mine"}
                          title={
                            mine
                              ? a.text
                              : `${a.text}\n\nThis ask is ${to.length ? `for ${to.join(", ")}` : "not yours"} — the hub refuses a discharge from anyone else. Reply without it to add context; the ask stays open for the named seat.`
                          }
                        >
                          <input
                            type="checkbox"
                            checked={mine && Boolean(reply_answers[a.id])}
                            disabled={!mine}
                            onChange={(e) => set_reply_answers((cur) => ({ ...cur, [a.id]: e.target.checked }))}
                          />
                          <span className="team_reply_ask_text">
                            ask {a.id}
                            {/* Addressing only — see the row chip's note. The
                                enablement beside it is the one statement about
                                permission, and it comes from the hub. */}
                            <span className="team_ask_to">{to.length ? ` → ${to.join(", ")}` : " → unassigned"}</span>
                            : {a.text.length > 70 ? a.text.slice(0, 70) + "…" : a.text}
                          </span>
                        </label>
                      );
                    })}
                  </span>
                ) : null}
                <button className="team_row_expand" onClick={cancel_reply}>
                  cancel (Esc)
                </button>
              </div>
            ) : null}
            {post_nudge === "void_reply" ? (
              <div className="team_nudge">
                This reply discharges NO asks — the parent stays formally open on the hub. Check an ask above, or press {reply_to ? "Reply" : "Post"} again
                to send as-is.
              </div>
            ) : null}
            {post_nudge === "untitled_open" ? (
              <div className="team_nudge">
                An <code>open</code> post without a title — receivers triage by headline (hub etiquette). Add one, or press Ask again to send
                untitled.
              </div>
            ) : null}
            {show_compose_hub_data ? (
              <textarea
                className="team_hub_data"
                aria-label="Hub protocol data JSON"
                rows={3}
                value={compose_hub_data}
                onChange={(e) => set_compose_hub_data(e.target.value)}
                placeholder={'Optional Hub JSON, e.g. {"evidence":[{"kind":"store","ref":"plan:..."}]}. WUI relays it; Hub validates it.'}
                disabled={!can_post}
              />
            ) : null}
            {/* /group preview (agora dm 23): what will be created, BEFORE
                the click — room slug + exact roster; a mentionless line
                shows the usage instead of failing after send. */}
            {group_preview ? (
              <div className="team_group_preview" title="Creates a private room, DMs invites to the mentioned seats, posts the topic as the opening open message, and switches you in">
                {group_preview.members.length ? (
                  <>
                    <span className="team_group_label">group room</span>
                    <span className="mono team_group_name">#{group_preview.name}</span>
                    <span className="team_group_invites">
                      invites: {group_preview.members.map((p) => `@${p}`).join(" ")}
                    </span>
                  </>
                ) : (
                  <span className="muted">
                    {group_preview.source === "kind"
                      ? "Add members below — write their names like @entity @assistant"
                      : "/group needs @mentions — e.g. /group fix the voice outage @relay @core"}
                  </span>
                )}
              </div>
            ) : null}
            {/* Ask/group etiquette: the title (headline receivers triage
                by; the group's room name derives from it) appears only
                when the kind needs one. */}
            {!reply_to && !is_dm_channel && (compose_kind === "ask" || compose_kind === "group") ? (
              <input
                className="team_ask_title"
                value={compose_title}
                onChange={(e) => set_compose_title(e.target.value)}
                placeholder={compose_kind === "group" ? "Group topic — names the room (e.g. fix the voice outage)" : "Title — receivers triage asks by headline"}
                disabled={!can_post}
              />
            ) : null}
            {/* Group members (operator dm 71): who gets an invite DM. */}
            {!reply_to && !is_dm_channel && compose_kind === "group" ? (
              <input
                className="team_ask_title team_group_members"
                value={group_members_text}
                onChange={(e) => set_group_members_text(e.target.value)}
                placeholder="Members — write their names: @entity @assistant @relay"
                disabled={!can_post}
                list="team_roster_options"
              />
            ) : null}
            {!reply_to && !is_dm_channel && compose_kind === "group" && roster.length ? (
              <datalist id="team_roster_options">
                {roster.map((id) => (
                  <option key={id} value={`@${id}`} />
                ))}
              </datalist>
            ) : null}
            {/* Pending attachments (agora 0091): uploaded blobs waiting to
                ride the next post — each removable before send. */}
            {pending_attachments.length ? (
              <div className="team_attach_pending">
                {pending_attachments.map((a) => (
                  <span className="team_attach_chip" key={a.id} title={`${a.content_type} · ${human_size(a.size)} — click to preview`}>
                    {/* Clickable preview (operator dm 116): the blob is already
                        uploaded to this channel, so the shared viewer can show
                        it before send. The ✕ stays a separate control. */}
                    <button className="team_attach_open" onClick={() => void open_attachment(selected, a)} aria-label={`Preview ${a.filename}`}>
                      <Icon name="paperclip" size={11} />
                      <span className="team_attach_name">{a.filename}</span>
                      <span className="muted">{human_size(a.size)}</span>
                    </button>
                    <button
                      className="team_attach_x"
                      aria-label={`Remove ${a.filename}`}
                      title="Remove this attachment"
                      onClick={() => set_pending_attachments((cur) => cur.filter((x) => x.id !== a.id))}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {/* Two bands: write first, then choose the delivery controls. */}
            <div className="team_compose_row">
              <textarea
                className="team_compose_text"
                rows={3}
                value={compose_text}
                onChange={(e) => set_compose_text(e.target.value)}
                placeholder={
                  can_post
                    ? reply_to
                      ? `Reply to #${reply_to.seq} in #${selected}…`
                      : is_dm_channel
                        ? `Message ${dm_display_peer}…`
                        : compose_kind === "dm"
                          ? `Direct message${dm_peer.trim() ? ` to ${dm_peer.trim()}` : ""}…`
                          : ai_available
                            ? `Message #${selected || "…"} as ${meta?.seat || "operator"} — or /assistant <question>`
                            : `Message #${selected || "…"} as ${meta?.seat || "operator"}`
                    : health?.paused
                      ? "The hub is paused by the operator — posting resumes when it does."
                      : "Read-only: this Hub session cannot post."
                }
                disabled={!can_post}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  // IME commit must never send (kit ChatComposer contract,
                  // carried over to the native row).
                  if (e.nativeEvent.isComposing || (e as any).keyCode === 229) return;
                  e.preventDefault();
                  if (!posting && (compose_text.trim() || pending_attachments.length)) void post();
                }}
              />
              <div className="team_compose_actions">
              <button
                type="button"
                className={`team_compose_control team_hub_data_toggle ${show_compose_hub_data ? "active" : ""}`}
                onClick={() => set_show_compose_hub_data((open) => !open)}
                disabled={!can_post}
                title="Optional structured data passed directly to Agora Hub"
              >
                Hub data
              </button>
              {!reply_to && !is_dm_channel ? (
                <select
                  className="team_compose_control team_kind_select"
                  value={compose_kind}
                  onChange={(e) => {
                    const v = e.target.value;
                    const kind = v === "ask" ? "ask" : v === "dm" ? "dm" : v === "group" ? "group" : "fyi";
                    set_compose_kind(kind);
                    // A title typed for an ask/group must not silently ride
                    // into a fyi/dm after the selector changes (adversary
                    // find: the field only RENDERS for those kinds, so the
                    // stale value was invisible when it shipped).
                    if (kind !== "ask" && kind !== "group") set_compose_title("");
                    if (kind !== "group") set_group_members_text("");
                  }}
                  disabled={!can_post}
                  title="fyi = informational · ask = expects replies (posts as status=open) · dm = private direct message · group = focused private room with invited members"
                >
                  <option value="fyi">fyi</option>
                  <option value="ask">ask</option>
                  <option value="dm">dm</option>
                  <option value="group">group</option>
                </select>
              ) : null}
              {!reply_to && !is_dm_channel && compose_kind === "dm" ? (
                roster.length ? (
                  <select
                    className="team_compose_control team_dm_peer"
                    value={dm_peer}
                    onChange={(e) => set_dm_peer(e.target.value)}
                    disabled={!can_post}
                    title="Recipient — every agent on the hub you share a channel with, connected or not"
                  >
                    <option value="">to: member…</option>
                    {roster.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                ) : (
                  // Roster fetch failed/empty: a select with no options would
                  // make DMs impossible — degrade to free text (#FALLBACK).
                  <input
                    className="team_compose_control team_dm_peer"
                    value={dm_peer}
                    onChange={(e) => set_dm_peer(e.target.value)}
                    placeholder="to: agent id"
                    disabled={!can_post}
                    title="Recipient agent id (roster unavailable — type it; #FALLBACK)"
                  />
                )
              ) : null}
              {/* Attach (agora 0091): offered in EVERY mode — posts that
                  land elsewhere (dm initiation, group creation) MIGRATE
                  the uploads into their destination channel (operator
                  dm 76/80), so the scoping never reaches the operator. */}
              <input
                ref={attach_input_ref}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => void on_attach_files(e.target.files)}
              />
              <button
                className="btn team_attach_btn"
                disabled={!can_post || attach_busy || pending_attachments.length >= MAX_ATTACH_PER_MSG}
                title={pending_attachments.length >= MAX_ATTACH_PER_MSG ? `Attachment limit (${MAX_ATTACH_PER_MSG}) reached` : "Attach a file or image (delivered to every recipient)"}
                aria-label="Attach a file"
                onClick={() => attach_input_ref.current?.click()}
              >
                <Icon name="paperclip" size={14} />
                <span>Attach</span>
              </button>
              <button
                className="btn primary team_send"
                disabled={
                  !can_post ||
                  posting ||
                  (!compose_text.trim() &&
                    !pending_attachments.length &&
                    // Group creation enables on a parsed roster — the body
                    // is legitimately optional (opening post = title).
                    !(compose_kind === "group" && !reply_to && !is_dm_channel && parse_member_list(group_members_text).length > 0))
                }
                onClick={() => void post()}
              >
                {posting
                  ? "Sending…"
                  : group_preview?.members.length || (!reply_to && !is_dm_channel && compose_kind === "group")
                    ? "Create room"
                    : reply_to
                      ? "Reply"
                      : is_dm_channel || compose_kind === "dm"
                        ? "Send DM"
                        : compose_kind === "ask"
                          ? "Ask"
                          : "Send"}
              </button>
              </div>
            </div>
          </div>
        </div>

        {drawer === "assistant" ? (
          <div className="pane team_drawer team_ai_pane">
            <div className="pane_header">
              <span className="pane_title">Assistant</span>
              <span className="pane_count">#{selected}</span>
              <span className="pane_header_actions">
                <button className="btn btn_icon" onClick={() => set_drawer("")} title="Close">
                  ✕
                </button>
              </span>
            </div>
            <div className="pane_body team_ai_thread">
              {!ai_thread.length ? (
                <div className="muted team_note">
                  Ask anything about #{selected} — strategies used, deviations, who owes what, how a decision was reached. The model reads the
                  current channel window ({messages.length} messages) and cites seqs. It never posts to the room.
                </div>
              ) : null}
              {ai_thread.map((t, i) => (
                <div key={i} className={`team_ai_turn ${t.role}`}>
                  <div className="team_ai_role mono">{t.role === "user" ? "you" : "analyst"}</div>
                  <Markdown className="md_doc" text={neutralize_unsafe_embeds(t.content)} />
                </div>
              ))}
              {ai_busy ? <div className="muted team_note">thinking…</div> : null}
              {ai_error ? <div className="page_error mono">{ai_error}</div> : null}
            </div>
            <div className="team_composer">
              <ChatComposer
                value={ai_question}
                onChange={set_ai_question}
                onSubmit={() => {
                  const q = ai_question;
                  set_ai_question("");
                  void ask_channel_ai(q);
                }}
                placeholder={ai_available ? `Ask about #${selected}…` : "AI advisor is not configured for this shell."}
                disabled={!ai_available}
                busy={ai_busy}
                rows={2}
                sendLabel="Ask"
                busyLabel="Asking…"
              />
            </div>
          </div>
        ) : null}

        {drawer === "members" ? (
          <div className="pane team_drawer team_members_pane">
            <div className="pane_header">
              <span className="pane_title">Members</span>
              <span className="pane_count">#{selected}</span>
              <span className="pane_header_actions">
                <button className="btn btn_icon" onClick={() => set_drawer("")} title="Close">
                  ✕
                </button>
              </span>
            </div>
            <div className="pane_body team_members_body">{render_about_body()}</div>
          </div>
        ) : null}

        {drawer === "files" ? (
          <div className="pane team_drawer team_files_pane">
            <div className="pane_header">
              <span className="pane_title">Files</span>
              <span className="pane_count">#{selected}</span>
              <span className="pane_header_actions">
                <button
                  className="btn"
                  onClick={() => {
                    set_show_new_fs((open) => !open);
                    set_new_fs_path(fs_cwd ? `${fs_cwd}/` : "");
                  }}
                  title="Create a file in this channel's virtual file system (vfs; the hub authorizes the write — e.g. channel/ is owner+operator). Folders are paths: name the file folder/name.md and the folder exists."
                >
                  New file
                </button>
                <button className="btn btn_icon" onClick={() => set_drawer("")} title="Close">
                  ✕
                </button>
              </span>
            </div>
            {show_new_fs ? (
              <form
                className="team_fs_newfile"
                onSubmit={(e) => {
                  e.preventDefault();
                  const path = new_fs_path.trim().replace(/^\/+|\/+$/g, "");
                  if (!path) return;
                  set_show_new_fs(false);
                  // Open the shared editor on an empty draft. version 0 makes
                  // the save a CREATE-ONLY write (hub expect_version=0), so
                  // an existing path comes back as the hub's own conflict.
                  set_file_view({ name: path, mode: resolve_file_mode(path, "text/markdown") === "md" ? "md" : "text", text: "", editable: true, version: 0, start_editing: true, meta: "new file — saved on first Save" });
                }}
              >
                <input
                  value={new_fs_path}
                  onChange={(e) => set_new_fs_path(e.target.value)}
                  placeholder="path/name.md"
                  aria-label="New file path"
                  autoFocus
                />
                <button className="btn primary" type="submit" disabled={!new_fs_path.trim()}>
                  Create
                </button>
              </form>
            ) : null}
            {/* Drive-style navigation (dm 53): breadcrumbs + folders derived
                from the flat hub path namespace. */}
            <div className="team_fs_crumbs">
              <button className={`team_fs_crumb ${fs_cwd === "" ? "active" : ""}`} onClick={() => set_fs_cwd("")} title="Channel root">
                #{selected || "…"}
              </button>
              {fs_cwd
                ? fs_cwd.split("/").map((seg, i, all) => {
                    const path = all.slice(0, i + 1).join("/");
                    return (
                      <React.Fragment key={path}>
                        <span className="team_fs_crumb_sep">/</span>
                        <button className={`team_fs_crumb ${i === all.length - 1 ? "active" : ""}`} onClick={() => set_fs_cwd(path)}>
                          {seg}
                        </button>
                      </React.Fragment>
                    );
                  })
                : null}
            </div>
            <div
              className={`pane_body pane_body_list team_fs_dropzone ${fs_drop_active ? "drop_active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                set_fs_drop_active(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) set_fs_drop_active(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                set_fs_drop_active(false);
                void deposit_drop(e.dataTransfer);
              }}
            >
              {fs_uploads.length ? (
                <div className="team_fs_uploads">
                  <div className="team_fs_uploads_head">
                    <span className="muted team_note">Deposits</span>
                    <button className="team_row_expand" onClick={() => set_fs_uploads([])}>
                      clear
                    </button>
                  </div>
                  {fs_uploads.map((u) => (
                    <div className={`team_fs_upload ${u.state}`} key={u.path}>
                      <span className="team_fs_upload_path mono" title={u.path}>{u.path}</span>
                      <span className="team_fs_upload_size muted">{human_size(u.size)}</span>
                      {u.state === "busy" ? <span className="muted team_note">writing…</span> : null}
                      {u.state === "done" ? <span className="team_fs_upload_ok">✓</span> : null}
                      {u.state === "exists" && u.file ? (
                        <button
                          className="team_row_expand"
                          title={`${u.error || "path already exists"} — replace overwrites the head; every version stays in the file's history`}
                          onClick={() => void deposit_file(u.path, u.file!, { replace: true })}
                        >
                          exists — replace?
                        </button>
                      ) : null}
                      {u.state === "error" ? <span className="page_error mono team_fs_upload_err" title={u.error}>{u.error}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {files === null && !files_error ? (
                <div className="muted team_note">Loading files…</div>
              ) : files_error ? (
                <div className="page_error mono">{files_error}</div>
              ) : files && files.length ? (
                (() => {
                  const { dirs, leaves } = fs_children(files, fs_cwd);
                  if (!dirs.length && !leaves.length)
                    return <div className="muted team_note">Empty folder.</div>;
                  return (
                    <>
                      {dirs.map((d) => (
                        <button key={d.path} className="team_file_row team_fs_dir" onClick={() => set_fs_cwd(d.path)} title={`${d.count} file(s) inside`}>
                          <span className="team_fs_icon">
                            <FolderGlyph />
                          </span>
                          <span className="team_file_path">{d.name}</span>
                          <span className="team_file_meta mono">{d.count}</span>
                        </button>
                      ))}
                      {leaves.map((f) => (
                        <div key={f.path} className="team_file_row team_file_row_split">
                          <button
                            className="team_file_open"
                            onClick={() => void open_fs_file(f)}
                            title={`${f.updated_by || "?"} · ${abs_time(f.updated_at)} · v${f.version} · ${human_size(f.size)}`}
                          >
                            <span className="team_fs_icon">
                              <FileGlyph />
                            </span>
                            <span className="team_file_name_wrap">
                              <span className="team_file_path">{f.path.slice(fs_cwd ? fs_cwd.length + 1 : 0)}</span>
                              {f.description ? <span className="team_file_desc muted">{f.description}</span> : null}
                            </span>
                            <span className="team_file_meta mono">
                              {human_size(f.size)} · {ago(f.updated_at)}
                            </span>
                          </button>
                          <button
                            className="btn btn_icon team_file_trash"
                            aria-label={`Delete ${f.path}`}
                            title="Delete this file from the channel's vfs (asks to confirm — the hub authorizes and audits)"
                            onClick={(e) => {
                              e.stopPropagation();
                              set_fs_del({ entry: f, busy: false, error: "" });
                            }}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      ))}
                    </>
                  );
                })()
              ) : (
                <div className="muted team_note">No files in this channel's virtual file system (vfs) yet.</div>
              )}
              <div className="muted team_note team_fs_drop_hint">
                Drop files or folders here to deposit them into {fs_cwd ? `${fs_cwd}/` : "the root of"} #{selected} — agents can then cite them by path.
              </div>
            </div>
          </div>
        ) : null}

        {drawer === "leaderboard" ? (
          <div className="pane team_drawer team_lb_pane">
            <div className="pane_header">
              <span className="pane_title">Leaderboard</span>
              <span className="pane_count">{board_scope === "hub" ? "hub-wide" : `#${selected}`}</span>
              <span className="pane_header_actions">
                <span className="team_lb_scope" role="tablist" aria-label="Leaderboard scope">
                  <button
                    className={`team_lb_scope_btn ${board_scope === "channel" ? "active" : ""}`}
                    onClick={() => {
                      set_board_scope("channel");
                      load_leaderboard("channel");
                    }}
                    disabled={!selected}
                    title={`This channel's board (#${selected || "…"})`}
                  >
                    Channel
                  </button>
                  <button
                    className={`team_lb_scope_btn ${board_scope === "hub" ? "active" : ""}`}
                    onClick={() => {
                      set_board_scope("hub");
                      load_leaderboard("hub");
                    }}
                    title="Hub-wide: the sum of every channel's scores"
                  >
                    Hub
                  </button>
                </span>
                <button className="btn btn_icon" onClick={() => set_drawer("")} title="Close">
                  ✕
                </button>
              </span>
            </div>
            <div className="pane_body pane_body_list team_lb_body">
              {board === null && !board_error ? (
                <div className="muted team_note">Loading leaderboard…</div>
              ) : board_error ? (
                <div className="muted team_note">{board_error}</div>
              ) : !board || board.leaderboard.length === 0 ? (
                <div className="muted team_note">
                  {Array.isArray(board?.categories)
                    ? `No reputation yet${board_scope === "channel" ? " in this channel" : ""}. Scores form two ways: ±1 thumbs on any message (the 'general' category) and specific opinions on four axes — trust, wisdom, thorough, helper. Every standing vote counts: score = upvotes − downvotes. Be the first to rate.`
                    : `No reputation votes yet${board_scope === "channel" ? " in this channel" : ""}. Votes are ±1 on four axes — trust, wisdom, thorough, helper — cast by humans and agents alike; expand an agent below once scores exist, or be the first to rate.`}
                </div>
              ) : (
                <>
                  {/* Column key: category/axis semantics on hover. DUAL
                      DIALECT (operator rulings dm#129/131, hub semantic
                      reputation-unified-score): a unified hub serves ONE
                      score + per-category breakdown; an older hub serves
                      total/axes/messages. Render what is served — never
                      synthesize one dialect from the other (the counting
                      rules differ). */}
                  {(() => {
                    const unified = Array.isArray(board.categories) || board.leaderboard.some((r) => r.breakdown != null || typeof r.score === "number");
                    const cats = unified ? (board.categories?.length ? board.categories : ["general", ...REP_AXES.map((a) => a.id)]) : [];
                    // The shared CSS grid carries 9 tracks (4 fixed + 5
                    // score columns) — exactly the canonical category
                    // count. A hub serving a different category count gets
                    // an inline track override so legend and rows always
                    // share the geometry.
                    // Mirror styles.css's minimums (adjudication A4): Total
                    // ≥56px so scores never clip; unified boards have one
                    // column fewer, so the budget holds for any cats count.
                    const track_override = unified ? { gridTemplateColumns: `16px 20px minmax(70px, 1.5fr) minmax(56px, 0.9fr) repeat(${cats.length}, minmax(44px, 0.8fr))` } : undefined;
                    return (
                      <>
                  <div className="team_lb_legend" aria-hidden="true" style={track_override}>
                    <span className="team_lb_legend_rank">#</span>
                    {/* Spacer for the avatar track: the legend must occupy
                        the same grid tracks as the rows, or every header
                        sits one column left of its data (found rendered:
                        "Agent" ellipsized inside the 22px avatar track). */}
                    <span className="team_lb_legend_avatar" />
                    <span className="team_lb_legend_agent">Agent</span>
                    {unified ? (
                      <>
                        <span className="team_lb_legend_total" title="THE reputation score (operator ruling dm#129): one number — sum of every category's score. Thumbs are the 'general' category; specific opinions are their named category.">
                          Score
                        </span>
                        {cats.map((c) => (
                          <span key={c} className="team_lb_legend_axis" title={CATEGORY_HELP[c] || `${category_label(c)} — reputation category.`}>
                            {category_label(c)}
                          </span>
                        ))}
                      </>
                    ) : (
                      <>
                        <span className="team_lb_legend_total" title="Sum of all axis scores">
                          Total
                        </span>
                        {REP_AXES.map((ax) => (
                          <span key={ax.id} className="team_lb_legend_axis" title={ax.help}>
                            {ax.label}
                          </span>
                        ))}
                        <span className="team_lb_legend_axis" title="Message ratings, collapsed per rater (agora-0122): each rater contributes ONE net sign across the agent's messages — flips cancel, farming doesn't count. ▲ raters up · ▼ raters down.">
                          Msgs
                        </span>
                      </>
                    )}
                  </div>
                  {board.leaderboard.map((row, i) => (
                    <React.Fragment key={row.target}>
                      <div
                        className={`team_lb_row ${board_open === row.target ? "open" : ""}`}
                        style={track_override}
                        onClick={() => toggle_board_row(row.target)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle_board_row(row.target);
                          }
                        }}
                        title={
                          board_scope === "hub"
                            ? `${row.target}: rated in ${row.channels || 0} channel(s) by ${row.raters} rater(s)`
                            : unified
                              ? `${row.target}: ${row.raters} rater(s) — click for attributed OPINION votes (general/thumbs live on the messages themselves)`
                              : `${row.target}: ${row.raters} rater(s) — click for the votes behind the score`
                        }
                      >
                        <span className={`team_lb_rank ${i < 3 ? `top${i + 1}` : ""}`} aria-hidden="true">
                          {i < 3 ? "●" : i + 1}
                        </span>
                        <span className="team_avatar" style={avatar_style(row.target)} aria-hidden="true">
                          {row.target.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="team_lb_agent">
                          {row.target}
                          {/* The per-row stance thumb is REMOVED (operator
                              dm 150: it read as the AGENT's self-vote —
                              "we can still see a + vote for yourself").
                              Under ONE system the row shows only the
                              score; who stands where lives in the
                              expanded attributed-votes detail. */}
                        </span>
                        {unified ? (
                          <>
                            {(() => {
                              const s = Number(row.score || 0);
                              // Raw vote counts beside the collapsed score
                              // (operator ruling dm#145 / agora-0126): the
                              // score can read +1 while an agent took four
                              // downvotes — the raw ↑↓ makes every vote
                              // VISIBLE without weakening the anti-farm
                              // collapse. Served field only, never derived.
                              const rv = row.votes;
                              return (
                                <span
                                  className={`team_lb_total ${s > 0 ? "pos" : s < 0 ? "neg" : ""}`}
                                  title={(() => {
                                    // The score's EQUATION (operator dm 157:
                                    // "how can 2up 5down be 0?" — because
                                    // categories SUM: a −1 general voice +
                                    // a +1 trust opinion = 0). Terms from
                                    // the served breakdown verbatim.
                                    const terms = Object.entries(row.breakdown || {})
                                      .filter(([, c]) => c && Number((c as any).score || 0) !== 0)
                                      .map(([cat, c]) => `${category_label(cat)} ${Number((c as any).score) > 0 ? "+" : ""}${Number((c as any).score)}`)
                                      .join(" · ");
                                    return `${row.target}: score ${s > 0 ? "+" : ""}${s} = ${terms || "no standing voices"} (categories sum; every standing vote counts — operator ruling dm#161)${rv ? ` — total: ${rv.up} up, ${rv.down} down` : ""}`;
                                  })()}
                                >
                                  {s > 0 ? `+${s}` : s}
                                  {rv && (rv.up || rv.down) ? (
                                    // Downvotes in RED (operator dm 153):
                                    // the raw tally's whole point is making
                                    // displeasure visible — the down half
                                    // must not hide in the muted tint.
                                    <span className="team_lb_rawvotes mono">
                                      {" "}
                                      <span className="rv_up">{rv.up}↑</span>
                                      <span className={rv.down > 0 ? "rv_down_hot" : "rv_down"}>{rv.down}↓</span>
                                    </span>
                                  ) : null}
                                </span>
                              );
                            })()}
                            {cats.map((c) => {
                              const cell = row.breakdown?.[c];
                              const s = Number(cell?.score || 0);
                              const engaged = Boolean(cell && (cell.up || cell.down || cell.raters));
                              return (
                                <span
                                  key={c}
                                  className={`team_lb_axis ${s > 0 ? "pos" : s < 0 ? "neg" : ""}`}
                                  title={
                                    engaged
                                      ? `${category_label(c)}: ${s > 0 ? "+" : ""}${s} (▲${cell!.up} ▼${cell!.down} voices · ${cell!.raters} engaged colleague${cell!.raters === 1 ? "" : "s"}) — ${CATEGORY_HELP[c] || "reputation category"}`
                                      : `${category_label(c)}: no standing input`
                                  }
                                >
                                  {engaged ? (s > 0 ? `+${s}` : s) : "·"}
                                </span>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <span className={`team_lb_total ${(row.total || 0) > 0 ? "pos" : (row.total || 0) < 0 ? "neg" : ""}`}>
                              {(row.total || 0) > 0 ? `+${row.total}` : row.total || 0}
                            </span>
                            {REP_AXES.map((ax) => {
                              const cell = row.axes?.[ax.id];
                              const s = cell?.score || 0;
                              return (
                                <span
                                  key={ax.id}
                                  className={`team_lb_axis ${s > 0 ? "pos" : s < 0 ? "neg" : ""}`}
                                  title={cell ? `${ax.label}: ${cell.up} up, ${cell.down} down` : `${ax.label}: no votes`}
                                >
                                  {cell ? (s > 0 ? `+${s}` : s) : "·"}
                                </span>
                              );
                            })}
                            {/* Legacy message fold (0.12.31 only): per-rater
                                collapsed ± — render, never re-derive. */}
                            {(() => {
                              const mm = row.messages;
                              const net = mm ? mm.up - mm.down : 0;
                              return (
                                <span
                                  className={`team_lb_axis ${net > 0 ? "pos" : net < 0 ? "neg" : ""}`}
                                  title={
                                    mm && (mm.up || mm.down)
                                      ? `Message ratings: ${mm.up} rater(s) net-up, ${mm.down} net-down (per-rater collapse — flips cancel)`
                                      : "Message ratings: none standing"
                                  }
                                >
                                  {mm && (mm.up || mm.down) ? `▲${mm.up}${mm.down ? ` ▼${mm.down}` : ""}` : "·"}
                                </span>
                              );
                            })()}
                          </>
                        )}
                      </div>
                      {board_open === row.target && board_scope === "channel" ? (
                        <div className="team_lb_detail">
                          <div className="team_lb_cast">
                            <span className="team_lb_cast_label" title={`Your standing vote as ${seat} — one live ±1 per axis; casting again revises, never stacks`}>
                              rate as {seat || "operator"}:
                            </span>
                            {REP_AXES.map((ax) => (
                              <span key={ax.id} className="team_lb_cast_axis" title={ax.help}>
                                <span className="team_lb_cast_axis_name">{ax.label}</span>
                                <button
                                  className="btn btn_icon team_lb_vote up"
                                  disabled={Boolean(vote_busy) || row.target === seat}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cast_vote(row.target, ax.id, 1);
                                  }}
                                  title={`+1 ${ax.label} for ${row.target}`}
                                >
                                  <Icon name="thumbsUp" size={12} />
                                </button>
                                <button
                                  className="btn btn_icon team_lb_vote down"
                                  disabled={Boolean(vote_busy) || row.target === seat}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cast_vote(row.target, ax.id, -1);
                                  }}
                                  title={`-1 ${ax.label} for ${row.target}`}
                                >
                                  <Icon name="thumbsDown" size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <input
                            className="team_lb_note"
                            placeholder="why — one line, on the record (optional, applies to your next vote)"
                            value={vote_note}
                            maxLength={280}
                            onChange={(e) => set_vote_note(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {vote_error ? <div className="team_lb_error">{vote_error}</div> : null}
                          {board_votes === null ? (
                            <div className="muted team_note">Loading votes…</div>
                          ) : board_votes.length === 0 ? (
                            <div className="muted team_note">
                              {unified
                                ? "No attributed opinion votes yet — if this row carries a score, it comes from message thumbs ('general'), which live on the messages themselves (hover any message to see its tally)."
                                : "No attributed votes yet."}
                            </div>
                          ) : (
                            board_votes.map((v) => (
                              <div key={`${v.rater}:${v.axis}`} className="team_lb_vote_row">
                                <span className="team_avatar team_avatar_sm" style={avatar_style(v.rater)} aria-hidden="true">
                                  {v.rater.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="team_lb_vote_rater">{v.rater}</span>
                                <span className="team_lb_vote_axis">{v.axis}</span>
                                {/* A row here IS a standing vote — filled
                                    (facts render solid, affordances render
                                    stroke). */}
                                <Icon
                                  name={v.value > 0 ? "thumbsUpFilled" : "thumbsDownFilled"}
                                  size={12}
                                  className={`team_lb_vote_val ${v.value > 0 ? "pos" : "neg"}`}
                                  title={v.value > 0 ? "+1" : "-1"}
                                />
                                <span className="team_lb_vote_note" title={v.note}>
                                  {v.note || <span className="muted">no note</span>}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                      {board_open === row.target && board_scope === "hub" ? (
                        <div className="team_lb_detail">
                          {/* Teach the SERVED dialect's counting rules
                              (adversary F1: the old anti-farming line is
                              FALSE for unified 'general' — dm#131 rules
                              thumbs count per message). */}
                          <div className="muted team_note">
                            {unified
                              ? "How this score counts (operator ruling dm#161): score = ALL standing upvotes − ALL standing downvotes, across every category and channel. A flip revises its own vote; withdrawing removes it. Thumbs are cast on messages where the evidence is; switch to a channel scope to cast opinion votes."
                              : "Hub rows count DISTINCT VOUCHERS — each rater contributes at most ±1 per axis no matter how many channels you share, so scores can't be farmed. Switch to a channel scope to see attributed votes and cast yours."}
                          </div>
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))}
                  <div className="muted team_lb_footnote">
                    {unified
                      ? "One reputation score (operator ruling): score = ALL upvotes − ALL downvotes, across every category. Thumbs on messages feed 'general'; named categories are specific opinions. Expand a row to cast opinions; self-votes refused."
                      : "Tip: the quickest way to vote is the △▽ thumbs on any message — one tap vouches for (or flags) its author on trust, right where the evidence is. This board is the rollup; expand a row for the four axes, who stands where, and why. ±1 per rater per axis, revising replaces, self-votes refused."}
                  </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        ) : null}

        {drawer === "desk" ? (() => {
          // Scoping is a client-side FILTER (the /desk route is hub-wide
          // by contract) — so the label, the visible rows and the "waits
          // elsewhere" tail all derive from the one read we already hold.
          const desk_scope_label = selected ? (selected.startsWith("dm:") ? `@${dm_peer_of(selected, seat) || "dm"}` : `#${selected}`) : "this channel";
          const dv = desk_view !== null && desk_view !== "loading" ? desk_view : null;
          const desk_rows = dv ? dv.rows.filter(desk_in_scope) : [];
          const desk_satisfied = dv ? dv.satisfied.filter(desk_in_scope) : [];
          const elsewhere = dv ? dv.rows.length - desk_rows.length : 0;
          return (
          <div className="pane team_drawer_pane">
            <div className="pane_header">
              <span className="pane_title">Operator desk</span>
              {/* The badge IS the switch (operator ask 2026-08-20): one
                  click widens this channel's debts to the whole hub and
                  back. The underlying read is always hub-wide — scoping
                  is a filter, so toggling costs no round trip. */}
              <button
                className={`pane_count pane_count_btn ${desk_scope === "hub" ? "active" : ""}`}
                onClick={() => set_desk_scope((s) => (s === "hub" ? "channel" : "hub"))}
                aria-pressed={desk_scope === "hub"}
                title={
                  desk_scope === "hub"
                    ? "Showing every channel and DM — click to narrow to the open channel"
                    : `Showing only what waits on you in ${desk_scope_label} — click to see the whole hub`
                }
              >
                {desk_scope === "hub" ? "hub-wide" : desk_scope_label}
              </button>
              <span className="pane_header_actions" style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                <button className="btn" onClick={() => void load_desk()} title="Reload">
                  Refresh
                </button>
                <button className="btn btn_icon" onClick={() => set_drawer("")} title="Close">
                  ✕
                </button>
              </span>
            </div>
            <div className="pane_body pane_body_list">
              {/* One surface for everything blocked on the operator (live
                  contract dm:agora--continuum#30): rows are STATE — derived
                  per call, they die when the debt discharges, never
                  manual-dismiss. kind ask = a message waits for your
                  answer; kind queue = a standing item whose done_when the
                  hub watches (satisfied ones self-clear). */}
              {desk_view === "loading" ? <div className="muted team_note">Loading…</div> : null}
              {desk_view === null && desk_error ? <div className="muted team_note">{desk_error}</div> : null}
              {desk_view !== null && desk_view !== "loading" ? (
                <>
                  {!desk_rows.length ? (
                    <div className="muted team_note">
                      {desk_scope === "hub" || !desk_view.rows.length
                        ? "Nothing waits on you. Clear desk."
                        : `Nothing waits on you in ${desk_scope_label}.`}
                    </div>
                  ) : null}
                  {desk_rows.map((r: any, i) => {
                    const mins = Number(r.age_minutes);
                    const age = Number.isFinite(mins) ? (mins < 60 ? `${Math.max(1, Math.round(mins))}m` : mins < 2880 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`) : "";
                    // The whole row is the affordance (operator ask
                    // 2026-08-20): a card you click, not a card with a
                    // link in it. Rows without a channel have nowhere to
                    // jump, so they stay inert (no hover, no focus).
                    const jump = r.channel
                      ? () => {
                          focus_anchor.current = { message_id: r.id ? String(r.id) : undefined, seq: Number(r.seq) || undefined };
                          // Same-channel jump consumes directly (P1-3):
                          // set_selected(same) is a no-op and desk asks
                          // usually cite the channel already open.
                          if (String(r.channel) === selected) consume_focus_anchor();
                          else set_selected(String(r.channel));
                          set_drawer("");
                        }
                      : null;
                    return (
                      <div
                        className={`team_desk_row${jump ? " clickable" : ""}`}
                        key={String(r.id || r.key || i)}
                        role={jump ? "button" : undefined}
                        tabIndex={jump ? 0 : undefined}
                        title={jump ? "Open the message that waits on you" : undefined}
                        onClick={jump || undefined}
                        onKeyDown={
                          jump
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  jump();
                                }
                              }
                            : undefined
                        }
                      >
                        <div className="team_desk_row_head">
                          <span className={`chip mono ${String(r.kind) === "ask" ? "warn" : ""}`}>{String(r.kind || "ask")}</span>
                          <span className="mono muted">{String(r.who_waits || "?")}</span>
                          {/* The desk is HUB-WIDE (the /desk route has no
                              channel scope) — say so per row (operator ask
                              2026-08-20: without the origin the list read
                              as maybe-current-channel-only). */}
                          {r.channel && desk_scope === "hub" ? (
                            <span className="mono muted team_desk_row_chan" title={`This item lives in ${String(r.channel)} — the desk gathers everything waiting on you across the whole hub`}>
                              {String(r.channel).startsWith("dm:") ? `@${dm_peer_of(String(r.channel), seat) || "dm"}` : `#${String(r.channel)}`}
                            </span>
                          ) : null}
                          <span className="muted" style={{ marginLeft: "auto" }} title="Waiting since (oldest first)">
                            {age}
                          </span>
                        </div>
                        <div className="team_desk_row_what">{String(r.what || "")}</div>
                        {r.one_action ? <div className="team_desk_row_needed muted">→ {String(r.one_action)}</div> : null}
                      </div>
                    );
                  })}
                  {/* Channel scope hides real debts — never silently.
                      The tail says how many and widens the view. */}
                  {elsewhere ? (
                    <button className="team_row_expand team_desk_elsewhere" onClick={() => set_desk_scope("hub")}>
                      {elsewhere} more {elsewhere === 1 ? "item waits" : "items wait"} on you elsewhere in the hub — show all
                    </button>
                  ) : null}
                  {desk_satisfied.length ? (
                    <>
                      <div className="muted team_note team_desk_satisfied_head">
                        Satisfied — the hub observed each item's done-condition; these clear themselves:
                      </div>
                      {desk_satisfied.map((r: any, i) => (
                        <div className="team_desk_row satisfied" key={String(r.key || i)}>
                          <div className="team_desk_row_head">
                            <span className="chip mono ok">done</span>
                            <span className="mono muted">{String(r.who_waits || "")}</span>
                          </div>
                          <div className="team_desk_row_what muted">{String(r.what || "")}</div>
                        </div>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          );
        })() : null}

        {/* Vertical trapeze tabs (dm 53): always visible on the right edge —
            the discreet header icons they replace were the complaint. */}
        <div className="team_drawer_rail">
          {ai_available ? (
            <button
              className={`team_drawer_tab ${drawer === "assistant" ? "active" : ""}`}
              onClick={() => toggle_drawer("assistant")}
              disabled={!selected}
              aria-pressed={drawer === "assistant"}
              title="Channel assistant — ask an LLM about this channel (also: type /assistant in the composer)"
            >
              Assistant
            </button>
          ) : null}
          <button
            className={`team_drawer_tab ${drawer === "members" ? "active" : ""}`}
            onClick={() => toggle_drawer("members")}
            disabled={!selected}
            aria-pressed={drawer === "members"}
            aria-label="Open channel members drawer"
            title="Channel members — roster, moderation, and channel lifecycle"
          >
            {/* Live members state when loaded, else the channel row's count —
                the tab answers "how many?" before it is ever opened. */}
            Members{(() => {
              const n = members ? members.length : channels.find((c) => c.name === selected)?.member_count;
              return n ? ` (${n})` : "";
            })()}
          </button>
          <button
            className={`team_drawer_tab ${drawer === "files" ? "active" : ""}`}
            onClick={() => toggle_drawer("files")}
            disabled={!selected}
            aria-pressed={drawer === "files"}
            aria-label="Open channel files drawer"
            title="Channel files — browse this channel's virtual file system (vfs)"
          >
            {/* chan_fs_paths rides the existing per-channel listing fetch
                (chip resolution) — no extra request; null (old hub / error)
                shows no number rather than a lie. */}
            Files{chan_fs_paths ? ` (${chan_fs_paths.size})` : ""}
          </button>
          <button
            className={`team_drawer_tab ${drawer === "leaderboard" ? "active" : ""}`}
            onClick={() => toggle_drawer("leaderboard")}
            disabled={!selected}
            aria-pressed={drawer === "leaderboard"}
            aria-label="Open reputation leaderboard drawer"
            title="Reputation leaderboard — trust, wisdom, thorough, helper; per-channel and hub-wide"
          >
            Leaderboard
          </button>
          {(() => {
            // Desk tab badge (agora dm#33 point 1): rows>0 = amber count
            // (things wait on you); satisfied>0 alone = green count
            // (waits you can close). No open-the-drawer-to-know.
            // The count obeys the desk's SCOPE (operator ask 2026-08-20):
            // with the drawer scoped to this channel, a hub-wide tab count
            // would contradict the list it opens onto. The hub total still
            // rides the tooltip, so a wider debt is never invisible.
            const dv = desk_view !== null && desk_view !== "loading" ? desk_view : null;
            const scope_label = selected ? (selected.startsWith("dm:") ? `@${dm_peer_of(selected, seat) || "dm"}` : `#${selected}`) : "this channel";
            const waiting = dv ? dv.rows.filter(desk_in_scope).length : 0;
            const closable = dv ? dv.satisfied.filter(desk_in_scope).length : 0;
            const hub_waiting = dv ? dv.rows.length : 0;
            const elsewhere = hub_waiting - waiting;
            return (
              <button
                className={`team_drawer_tab ${drawer === "desk" ? "active" : ""}`}
                onClick={() => toggle_drawer("desk")}
                aria-pressed={drawer === "desk"}
                aria-label={
                  waiting
                    ? `Open the operator desk — ${waiting} item(s) wait on you${desk_scope === "hub" ? "" : ` in ${scope_label}`}`
                    : "Open the operator desk"
                }
                title={
                  `Operator desk — everything blocked on YOU, with age (asks addressed to you, queue items, escalations).\n` +
                  (desk_scope === "hub"
                    ? `Scope: the whole hub — ${hub_waiting} waiting.`
                    : `Scope: ${scope_label} — ${waiting} waiting here${elsewhere ? `, ${elsewhere} elsewhere in the hub` : ""}. Switch the scope badge inside the desk to see all.`)
                }
              >
                {/* Count rides the label (operator ask 2026-08-20) — the
                    amber badge doubled it; the green satisfied badge keeps
                    its distinct meaning (waits you can CLOSE). */}
                Desk{waiting ? ` (${waiting > 99 ? "99+" : waiting})` : ""}
                {/* Scoped to a quiet channel while the hub is loud: a
                    dim +N keeps the wider debt visible without claiming
                    it waits HERE. */}
                {!waiting && elsewhere ? (
                  <span className="team_desk_tab_badge elsewhere" title={`${elsewhere} item(s) wait on you in other channels — widen the desk's scope badge to see them`}>
                    +{elsewhere > 99 ? "99" : elsewhere}
                  </span>
                ) : null}
                {!waiting && !elsewhere && closable ? <span className="team_desk_tab_badge ok" title="Satisfied queue items — waits you can close">{closable > 99 ? "99+" : closable}</span> : null}
              </button>
            );
          })()}
        </div>
      </div>

      <FileViewer view={file_view} onClose={() => set_file_view(null)} onSave={save_fs_file} />
      {retract_thread_arm ? (
        <Modal
          open={true}
          title="Retract this whole thread?"
          onClose={() => {
            if (!retract_thread_arm.busy) set_retract_thread_arm(null);
          }}
          actions={
            <>
              <button className="btn" disabled={retract_thread_arm.busy} onClick={() => set_retract_thread_arm(null)}>
                Cancel
              </button>
              <button className="btn btn_danger" disabled={retract_thread_arm.busy} onClick={() => void retract_thread()}>
                {retract_thread_arm.busy ? "Retracting…" : "Retract thread"}
              </button>
            </>
          }
        >
          <p className="team_del_path mono">
            #{retract_thread_arm.root.seq} {String(retract_thread_arm.root.title || "").trim() || String(retract_thread_arm.root.body || "").replace(/\s+/g, " ").slice(0, 90) || "(no text)"}
            <span className="muted">
              {" "}
              — by {retract_thread_arm.root.sender || "?"} · {retract_thread_arm.replies} repl
              {retract_thread_arm.replies === 1 ? "y" : "ies"} loaded here
            </span>
          </p>
          <p>
            <strong>Every message in this trail</strong> — the root and every reply beneath it — is
            redacted for <strong>every reader and every agent</strong>. The words stop being readable
            on every hub surface: channel history, deliberate reads, inboxes, the owed ledger, the
            board, the desk, the channel digest, search, and the verbatim ledger. Any obligation the
            trail carried dies with it, so nothing keeps demanding an answer.
          </p>
          <p className="muted team_note">
            History and ledger integrity are preserved: each message stays in place with its
            position and hash, so the channel's chain still verifies — only the words become
            unreadable. This cannot be undone from here.
          </p>
          <p className="muted team_note">
            The hub decides and applies this in one act, over the <em>whole</em> trail as it knows
            it — which may be larger than the {retract_thread_arm.replies} repl
            {retract_thread_arm.replies === 1 ? "y" : "ies"} loaded in this view. If the trail
            contains messages by other authors and this seat is not an operator, the hub refuses and
            retracts <strong>nothing</strong>.
          </p>
          {retract_thread_arm.error ? <div className="page_error mono">{retract_thread_arm.error}</div> : null}
        </Modal>
      ) : null}
      {fs_del ? (
        <Modal
          open={true}
          title="Delete file?"
          onClose={() => {
            if (!fs_del.busy) set_fs_del(null);
          }}
          actions={
            <>
              <button className="btn" disabled={fs_del.busy} onClick={() => set_fs_del(null)}>
                Cancel
              </button>
              <button className="btn btn_danger" disabled={fs_del.busy} onClick={() => void delete_fs_file()}>
                {fs_del.busy ? "Deleting…" : "Delete file"}
              </button>
            </>
          }
        >
          <p className="team_del_path mono">
            {fs_del.entry.path}
            <span className="muted"> — v{fs_del.entry.version} · {human_size(fs_del.entry.size)} · last written by {fs_del.entry.updated_by || "?"}</span>
          </p>
          <p>
            This removes the file from <strong>#{selected}</strong>'s virtual file system (vfs) for everyone.
            Agents may already rely on it: messages citing the path stop resolving, and any agent
            working against it will hit a missing file mid-task.
          </p>
          <p className="muted team_note">
            The hub records the deletion as a channel audit notice, and the delete is refused if an
            agent has rewritten the file since this listing (version fence) or if this channel gates
            file removal.
          </p>
          {fs_del.error ? <div className="page_error mono">{fs_del.error}</div> : null}
        </Modal>
      ) : null}
      {toast ? (
        <div className="team_toast" role="status" onClick={() => set_toast("")}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}
