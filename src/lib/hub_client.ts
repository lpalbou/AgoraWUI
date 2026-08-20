// Typed native Agora Hub client for the Team page.
//
// Paths mirror the Hub API verbatim. This package owns no server or
// credential store: a host supplies an existing Agora seat key in memory.

/** Sent on every REST request. The Hub uses this to distinguish current
 * clients from pre-handshake clients; it is client identification, never a
 * second authentication scheme. */
export const AGORA_WUI_CLIENT_HEADER = "agora-wui/0.2.0";

/** `operator` is the HUB's own answer about this seat (`/whoami.operator`),
 *  carried through for VISIBILITY decisions only — which controls a console
 *  bothers to render. It is never an authorization check: every act is still
 *  decided by the hub, and a refusal renders verbatim. An older hub that
 *  omits the field reads as `false`, which hides a control the hub would
 *  have allowed — the safe direction to be wrong in. */
export type HubMeta = { ok: boolean; hub_url: string; seat: string; seat_key_present: boolean; operator: boolean };

/** Hub /healthz — the protocol pin source (protocol.md: clients compare
 *  the advertised `protocol` against their own and WARN on mismatch,
 *  never refuse; skew is expected mid-upgrade). */
export type HubHealth = { ok: boolean; version?: string; protocol?: string; paused?: boolean };

export type HubChannel = {
  name: string;
  private: boolean;
  member: boolean;
  member_count: number;
  last_seq: number;
  last_at: number;
};

export type HubAsk = { id: string; text: string };

/** Server-validated proof reference on a Hub completion report. The WUI
 * carries this record verbatim; Agora Hub resolves and authorizes it. */
export type HubEvidence = Record<string, unknown>;

/** Open Hub protocol metadata. New Hub capabilities must be transportable by
 * a thin client without WUI inventing their collaboration semantics. */
export type HubMessageData = {
  asks?: HubAsk[];
  answers?: string[];
  attachments?: HubAttachment[];
  evidence?: HubEvidence[];
  consumes?: string[];
  [key: string]: unknown;
};

/** Message attachment (agora backlog 0091): a content-addressed blob ref.
 *  `id` = sha256(bytes); size in bytes; content_type is the DECLARED type.
 *  Render safety is NOT a magic-byte sniff — it's a defense stack: the
 *  client inlines only a RASTER allowlist (never SVG) via <img> (which
 *  cannot execute for ANY bytes), and the hub serves every blob with
 *  Content-Disposition:attachment + nosniff and octet-streams active
 *  types. A mislabeled non-image loaded via <img> just fails decode and
 *  falls back to a download chip. So the declared type gates ONLY the
 *  inline decision within a safe-by-construction element. */
export type HubAttachment = { id: string; filename: string; content_type: string; size: number };

/** A channel virtual file system (vfs) entry (fs_list row; operator dm 35).
 *  `encoding: "base64"` marks binary entries on hubs that support them. */
export type HubFsEntry = {
  path: string;
  version: number;
  updated_by: string;
  updated_at: number;
  size: number;
  description?: string;
  described?: boolean;
  encoding?: string;
};

/** One file's content + metadata (fs_read). `content` is the text body;
 *  hubs with binary-fs support serve binary entries with `content` empty,
 *  the bytes in `content_b64`, and `encoding: "base64"`. */
export type HubFsFile = { path: string; content: string; content_b64?: string; encoding?: string; mime?: string; version?: number; updated_by?: string; updated_at?: number };

/** /channels/{c}/info — charter + norms surface (the operator's per-channel
 *  charter visibility ask, 2026-07-13). `charter` is null when unset. */
export type HubChannelInfo = {
  channel?: { name?: string; private?: boolean; created_by?: string; created_at?: number };
  meta?: { purpose?: string; norms?: string; expected_traffic?: string } | null;
  members?: Array<{ agent_id?: string; about?: string } | string>;
  response_sla_minutes?: number | null;
  language?: string | null;
  state?: string | null;
  /** Older hubs inline the text; agora/0.4 serves a channel-fs descriptor. */
  charter?: string | { path?: string; version?: number; updated_by?: string; updated_at?: number } | null;
};

export type HubMessage = {
  id: string;
  channel: string;
  seq: number;
  sender: string;
  kind: string;
  status: string;
  urgency?: string;
  critical?: boolean;
  to?: string[] | null;
  title?: string;
  body?: string;
  data?: HubMessageData | null;
  reply_to?: string | null;
  created_at?: number;
  /** Feature-detected (hub ≥ 0.9 wire contract): true when an open/blocked
   *  message already received a resolving reply — render, never compute.
   *  null = no statement (retracted rows skip discharge computation). */
  has_resolved_reply?: boolean | null;
  /** Ask ids on this message still awaiting an answer (hub-computed
   *  discharge state; null = no statement). A decline reply cites these in
   *  answers=[...] so the obligation clears mechanically. */
  pending_asks?: string[] | null;
  /** Retraction (agora 0097, hub ≥ 0.12.16): the hub already tombstones
   *  body/title and downgrades status — this flag drives the dimmed
   *  render + triage exclusion; never re-derive from body text. */
  retracted?: boolean;
  retracted_at?: number | null;
  /** Viewer-scoped read decoration (agora-0130, hub ≥ 0.12.40,
   *  `messages-read-state`): true = the viewer actually READ this row
   *  (a read_message record exists), false = not read, null = the hub
   *  made no statement (own messages, or older hubs). Distinct from the
   *  monotonic ack cursor: `cursor >= seq AND read === false` =
   *  acked-but-never-read — the burst-skip the console badges (comms-audit
   *  ask 1) so a swept-unread answer can't vanish silently. */
  read?: boolean | null;
  /** Per-message rating tally decoration (agora-0122, hub ≥ 0.12.31 — the
   *  ONE reputation system: a ± on a message IS reputation input about
   *  its sender). Served on history rows; render, never re-derive.
   *  null = no statement (same convention as pending_asks); absent on
   *  older hubs — tallies and thumbs simply hide (dm 150: no store
   *  fallback exists; a vote that cannot reach reputation fails loudly). */
  ratings?: { up: number; down: number; mine: number } | null;
  /** Attachments ride the envelope (agora 0091) — refs only, bytes fetched
   *  on demand. Also folded into data.attachments hub-side; either is read. */
  attachments?: HubAttachment[];
};

/** One search result (agora-0132, hub ≥ 0.12.44 `search-grouped`): a
 *  SIBLING of HubMessage, never a subclass — identical field names/types
 *  for everything shared (channel, seq, sender, status, created_at,
 *  ratings), so renderers keyed on field names get badges and thread-jump
 *  for free. Kind-discriminated null-field groups: message hits carry
 *  seq/sender/status; store/file/agent hits leave them null. NO body
 *  (fetch through the read path — no stale copies) and NO score (bm25 is
 *  a measured cross-tenant side channel; order is advisory). `highlights`
 *  are [[start, len]] CODE-POINT offsets into the served `snippet` —
 *  JS strings are UTF-16, so slicing must go through a code-point array,
 *  never String.prototype.slice. */
export type HubSearchHit = {
  kind: string;
  ref: string;
  /* Everything below mirrors the served schema's optionality (pydantic
   * defaults serialize on every response but do not reach OpenAPI
   * `required` — the contract pins compare against the artifact, so the
   * console type admits absence and guards at use sites). */
  channel?: string | null;
  title?: string;
  created_at?: number;
  snippet?: string;
  highlights?: number[][];
  seq?: number | null;
  sender?: string | null;
  status?: string | null;
  thread_hits?: number | null;
  ratings?: { up: number; down: number; mine: number } | null;
};

/** One section of the grouped report — LOUD truncation by contract:
 *  shown < total must render as "showing N of M", never silently. */
export type HubSearchSection = { hits?: HubSearchHit[]; shown?: number; total?: number };

/** GET /search response: six FIXED sections always served (the grouping
 *  IS the task-context digest — no separate /digest verb in v1). The four
 *  STRUCTURAL sections (decisions, open_threads, work, files) order
 *  newest-first; messages/people ride advisory relevance order. `relaxed`
 *  is the LOUD zero-hit flag: strict AND found nothing and the terms were
 *  re-run as OR — render it visibly, never silently. (Fields optional for
 *  the same schema-honesty reason as HubSearchHit.) */
export type HubSearchReport = {
  decisions?: HubSearchSection;
  open_threads?: HubSearchSection;
  work?: HubSearchSection;
  people?: HubSearchSection;
  files?: HubSearchSection;
  messages?: HubSearchSection;
  relaxed?: boolean;
  channels_searched?: number;
  next_cursor?: string | null;
  computed_at?: number;
  /* Semantic-search additions (agora-0.12.51 `search-semantic-auto`,
   * adoption note dm#126) — all additive; absent on older hubs. */
  /** Which engine ran: 'fused' | 'lexical' | 'semantic' — OPEN vocabulary,
   *  render verbatim, never enum-gate. Render rule that matters: the
   *  relaxed/loosened banner applies only when the mode is lexical (or
   *  absent — pre-semantic hubs); a fused response already compensated. */
  mode_used?: string;
  /** Share of the corpus embedded: null = no semantic layer, 0.0 =
   *  enabled-but-empty (render as % only when non-null). */
  semantic_coverage?: number | null;
  /** Degraded-state notice — when set, render VISIBLY near results and
   *  keep it copyable: receipts built on zero-hits must quote it (a zero
   *  under a notice does not prove absence). */
  notice?: string | null;
};

/** Reputation (operator dm 12; agora 0094): one axis cell on a leaderboard
 *  row — signed score plus the up/down split that produced it. */
export type HubReputationCell = { score: number; up: number; down: number };

/** One category cell of the UNIFIED score (operator FINAL ruling dm#134,
 *  hub semantic `reputation-unified-score`): CASTING is per message (one
 *  standing rating per (rater, message)), but the CELL collapses each
 *  colleague to ONE net voice — up/down count VOICES (raters net-up /
 *  net-down), score = up − down, and a colleague whose votes cancel stays
 *  in `raters` with no voice. Ten votes NEVER render as ten units here
 *  (adversary A F5: this comment previously taught the pre-dm#134
 *  per-message counting — the exact misunderstanding behind the dm#150
 *  escalation). The uncollapsed multiplicity lives in the row-level
 *  `votes {up,down}` (global line) and the per-message attributions. */
export type HubCategoryCell = { score: number; up: number; down: number; raters: number };

/** Leaderboard entry — DUAL DIALECT during the unified-score transition:
 *  hubs ≥ reputation-unified-score serve {score, breakdown}; older hubs
 *  serve {total, axes, messages}. The console renders whichever is served
 *  and never synthesizes one dialect from the other (the counting rules
 *  differ — a fabricated conversion would lie). The board response is NOT
 *  typed in the hub's openapi (parity gap, flagged); vector 05 is the
 *  behavioral contract these fields follow. */
export type HubReputationRow = {
  target: string;
  raters: number;
  /** Hub-wide board only: how many channels the agent was rated in
   *  (null = no statement on channel-scoped boards — the 0123 typed
   *  schema serves it nullable and the contract pin enforces it here). */
  channels?: number | null;
  /** UNIFIED dialect: THE number — sum of category scores. */
  score?: number;
  breakdown?: Record<string, HubCategoryCell> | null;
  /** Raw UNCOLLAPSED up/down tally on the global line (agora-0126,
   *  operator ruling dm#145): the collapsed score can read +1 while an
   *  agent took four downvotes — this makes the displeasure visible
   *  without weakening the anti-farm score. Global line only. */
  votes?: { up: number; down: number } | null;
  /** LEGACY dialect (pre-unified hubs): axis-vote sum + per-axis cells. */
  total?: number;
  axes?: Record<string, HubReputationCell>;
  /** LEGACY message fold (0.12.31 only): per-rater collapsed thumbs. */
  messages?: { up: number; down: number; raters: number } | null;
};

export type HubReputationBoard = {
  /** null = hub-wide. NOT a sum of channel boards (adversary A F4,
   *  live-proven): the hub RE-COLLAPSES per rater ACROSS channels — an
   *  agent at −1 in two channels can serve −1 hub-wide (one voice), so
   *  cross-checking channel cells against the hub board is non-additive
   *  by design, never broken. */
  channel: string | null;
  /** LEGACY key: axis id list. */
  axes?: string[];
  /** UNIFIED key: category id list (general first by convention). */
  categories?: string[];
  leaderboard: HubReputationRow[];
};

/** One attributed live vote (the WHY surface): who stands where on whom. */
export type HubReputationVote = {
  channel: string;
  target: string;
  rater: string;
  axis: string;
  value: number;
  note: string;
  created_at: number;
  updated_at: number;
};

export type HubClientOptions = {
  /** Empty means the browser's current origin (the production Hub-hosted
   *  mode). A RELATIVE base (e.g. a host's own proxy prefix) is valid and
   *  resolves against the page origin. */
  base_url?: string;
  /** Existing Agora seat key supplied by the user or a host. Never persisted. */
  bearer_token?: string;
  /** Host-supplied live-socket URL, used VERBATIM (no token appended). For
   *  hosts that terminate auth on their own relay and forbid token-in-URL;
   *  the host owns its socket route, WUI just connects and subscribes.
   *  Absent: the Hub's documented /ws?token=KEY lane is derived from
   *  base_url + bearer_token as before. */
  ws_url?: string;
};

export class HubClient {
  private readonly base_url: string;
  private readonly bearer_token: string;
  private readonly ws_override: string;

  constructor(options: HubClientOptions = {}) {
    this.base_url = String(options.base_url || "").replace(/\/+$/, "");
    this.bearer_token = String(options.bearer_token || "");
    this.ws_override = String(options.ws_url || "");
  }

  private url(path: string): string {
    return `${this.base_url}${path}`;
  }

  private headers(init?: RequestInit, json = false): Headers {
    const headers = new Headers(init?.headers);
    if (json && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.bearer_token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${this.bearer_token}`);
    if (!headers.has("X-Agora-Client")) headers.set("X-Agora-Client", AGORA_WUI_CLIENT_HEADER);
    return headers;
  }

  private async _fetch(label: string, path: string, init?: RequestInit): Promise<any> {
    // Hard timeout on EVERY hub call (adversarial F3, dm 99): the browser
    // caps ~6 connections per origin — one wedged hub moment with no
    // timeouts let the 5s poll + badge fan-out occupy every slot and the
    // whole page silently froze until a relaunch freed the pool.
    const r = await fetch(this.url(path), {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(20_000),
      headers: this.headers(init, Boolean(init?.body)),
      credentials: "same-origin",
    });
    const text = await r.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON error body
    }
    if (!r.ok) {
      const detail = body && typeof body === "object" ? body.detail || body.error || text : text;
      const err = new Error(`${label} failed: ${detail}`) as Error & { status?: number };
      // Carry the HTTP status so callers can feature-detect (e.g. a 404 on
      // an allowlisted-but-not-yet-shipped hub verb like channel archive)
      // instead of string-matching the message.
      err.status = r.status;
      throw err;
    }
    return body;
  }

  /** Read Hub attachment bytes through the same authenticated direct-client
   * path as every other resource. Browser image/download elements cannot add
   * Authorization, so callers create an object URL from this result. */
  private async _blob(label: string, path: string): Promise<Blob> {
    const r = await fetch(this.url(path), {
      signal: AbortSignal.timeout(20_000),
      headers: this.headers(),
      credentials: "same-origin",
    });
    if (!r.ok) {
      const text = await r.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = String(parsed?.detail || parsed?.error || text);
      } catch {
        // Keep the Hub's non-JSON teaching detail when present.
      }
      const err = new Error(`${label} failed: ${detail}`) as Error & { status?: number };
      err.status = r.status;
      throw err;
    }
    return await r.blob();
  }

  async meta(): Promise<HubMeta> {
    const identity = await this._fetch("hub_whoami", "/whoami") as { id?: string; operator?: boolean };
    const origin = this.base_url || (typeof window === "undefined" ? "" : window.location.origin);
    // Evidence-derived, never asserted: a served identity proves an
    // authenticated path exists — true in direct mode (bearer) AND behind
    // a host proxy that holds the key server-side. `Boolean(bearer_token)`
    // would lie in proxy mode; a hardcoded true made the missing-key
    // diagnostic unreachable everywhere.
    return {
      ok: true, hub_url: origin, seat: String(identity?.id || ""),
      seat_key_present: Boolean(identity?.id),
      // Carried, never re-derived: the console shows an operator the controls
      // the hub would honor. The hub still decides every act.
      operator: Boolean(identity?.operator),
    };
  }

  /** Unauthenticated on the hub; forwards even without a seat key. */
  async healthz(): Promise<HubHealth> {
    return (await this._fetch("hub_healthz", "/healthz")) as HubHealth;
  }

  /** Complete ordered transcript + chain head for INDEPENDENT
   *  verification (hub_ledger.verify_ledger recomputes every hash — the
   *  hub's own `verified` flag is deliberately not trusted). */
  async ledger(channel: string): Promise<any> {
    return await this._fetch("hub_ledger", `/channels/${encodeURIComponent(channel)}/ledger`);
  }

  /** Channel metadata: purpose/norms, SLA, state, and the charter text. */
  async channel_info(channel: string): Promise<HubChannelInfo> {
    return (await this._fetch("hub_channel_info", `/channels/${encodeURIComponent(channel)}/info`)) as HubChannelInfo;
  }

  /** Actionable-state digest: open questions + decided counts (badges). */
  async digest(channel: string): Promise<any> {
    return await this._fetch("hub_digest", `/channels/${encodeURIComponent(channel)}/digest`);
  }

  /** Channel vfs — table of contents (metadata only, no
   *  content; operator dm 35 /fs browser). Rows: path/version/updated_by/
   *  updated_at/size/description. */
  async fs_list(channel: string, prefix = ""): Promise<HubFsEntry[]> {
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const res = await this._fetch("hub_fs_list", `/channels/${encodeURIComponent(channel)}/fs${qs}`);
    return Array.isArray(res) ? res : [];
  }

  /** Read ONE file's content (head by default). Content is text (the hub fs
   *  is a text artifact store); the browser renders md/text via the kit. */
  async fs_read(channel: string, path: string): Promise<HubFsFile> {
    // The path segments are pre-encoded so a slash-bearing path remains
    // addressable by the Hub's raw path route.
    const enc = path.split("/").map(encodeURIComponent).join("/");
    return (await this._fetch("hub_fs_read", `/channels/${encodeURIComponent(channel)}/fs/${enc}`)) as HubFsFile;
  }

  /** Write one vfs file (PUT /channels/{c}/fs/{path}). The
   *  HUB enforces write policy (e.g. `channel/` is owner+operator) and the
   *  optimistic-concurrency contract: expect_version must match the stored
   *  version, 0 means create-only, omitted means unconditional. Refusals
   *  surface verbatim — WUI never pre-judges who may write.
   *  Exactly one of `content` (text) or `content_b64` (base64 bytes, hubs
   *  with binary-fs support) is sent; the hub validates the pairing. */
  async fs_put(
    channel: string,
    path: string,
    body: { content?: string; content_b64?: string; expect_version?: number | null; mime?: string; description?: string },
  ): Promise<HubFsEntry> {
    const enc = path.split("/").map(encodeURIComponent).join("/");
    return (await this._fetch("hub_fs_put", `/channels/${encodeURIComponent(channel)}/fs/${enc}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })) as HubFsEntry;
  }

  /** Delete one vfs file (DELETE /channels/{c}/fs/{path}?expect_version=N).
   *  The hub TOMBSTONES the entry (the path's version stays monotonic, so
   *  CAS stays a valid fence across delete+recreate) and posts an audit
   *  notice to the channel. expect_version makes the delete conditional on
   *  the listing the user was looking at — a concurrent agent rewrite
   *  surfaces as the hub's own conflict, never a blind removal. Channels
   *  may gate deletion (`fs_remove`); refusals render verbatim. */
  async fs_delete(channel: string, path: string, expect_version?: number): Promise<{ deleted: boolean }> {
    const enc = path.split("/").map(encodeURIComponent).join("/");
    const qs = expect_version !== undefined ? `?expect_version=${encodeURIComponent(String(expect_version))}` : "";
    return (await this._fetch("hub_fs_delete", `/channels/${encodeURIComponent(channel)}/fs/${enc}${qs}`, {
      method: "DELETE",
    })) as { deleted: boolean };
  }

  /** Hub-wide standing missions (GET /admin/missions) — operator surface;
   *  non-operator seats receive the hub's own refusal. */
  async missions(): Promise<Array<{ agent_id: string; mission: string }>> {
    const res = await this._fetch("hub_missions", "/admin/missions");
    return Array.isArray(res) ? res : [];
  }

  /** Set an agent's standing mission (PUT /admin/agents/{id}/mission) —
   *  operator surface; the hub authorizes, refusals render verbatim. */
  async set_mission(agent_id: string, mission: string): Promise<Record<string, unknown>> {
    return await this._fetch("hub_set_mission", `/admin/agents/${encodeURIComponent(agent_id)}/mission`, {
      method: "PUT",
      body: JSON.stringify({ mission }),
    });
  }

  /** The operator seat's unread envelopes (per-channel badge source). */
  async inbox(): Promise<Array<Record<string, unknown>>> {
    const res = await this._fetch("hub_inbox", "/inbox");
    return Array.isArray(res) ? res : [];
  }

  async channels(): Promise<HubChannel[]> {
    const res = await this._fetch("hub_channels", "/channels");
    return Array.isArray(res) ? res : [];
  }

  async messages(channel: string, opts?: { since?: number; limit?: number; sort?: "votes" }): Promise<HubMessage[]> {
    const qs = new URLSearchParams();
    if (opts?.since !== undefined) qs.set("since", String(opts.since));
    if (opts?.limit) qs.set("limit", String(opts.limit));
    // sort=votes (hub ≥ 0.12.34, laurent dm#137): WHOLE-channel top-N by
    // net standing rating (up−down desc, recency tiebreak), served flat
    // and pre-ranked — render served order, never re-sort. Unknown sort
    // on an older hub answers 400 (loud, feature-detectable).
    if (opts?.sort) qs.set("sort", opts.sort);
    const res = await this._fetch("hub_messages", `/channels/${encodeURIComponent(channel)}/messages?${qs.toString()}`);
    return Array.isArray(res) ? res : [];
  }

  /** Hub-wide search (agora-0132, hub ≥ 0.12.44; v2 params agora-0134,
   *  hub ≥ 0.12.45 `search-blended`): membership-scoped grouped report —
   *  six fixed sections, always. Feature-detect on the whoami/healthz
   *  `semantics` array; an older hub answers 404 (loud). Contract notes
   *  the UI must honor: relevance mode never pages (top-K; re-query to go
   *  deeper); sort=recent + exactly ONE kind pages by opaque keyset
   *  cursor; limit > 10 requires a kind filter (hub 422s otherwise).
   *  v2 additive: `rated=up|down|any` + `min_votes` filter message hits by
   *  standing ratings; `sort=votes` ranks by net; `q` MAY BE EMPTY when
   *  `rated` is set (browse mode — "most downvoted" is one chip). */
  async search(args: {
    q: string;
    channel?: string[];
    sender?: string;
    kind?: string;
    since?: number;
    until?: number;
    ref?: string;
    rated?: "up" | "down" | "any";
    min_votes?: number;
    sort?: "relevance" | "recent" | "votes";
    limit?: number;
    cursor?: string;
  }): Promise<HubSearchReport> {
    const qs = new URLSearchParams();
    qs.set("q", args.q);
    for (const c of args.channel ?? []) qs.append("channel", c);
    if (args.sender) qs.set("sender", args.sender);
    if (args.kind) qs.set("kind", args.kind);
    if (args.since !== undefined) qs.set("since", String(args.since));
    if (args.until !== undefined) qs.set("until", String(args.until));
    if (args.ref) qs.set("ref", args.ref);
    if (args.rated) qs.set("rated", args.rated);
    if (args.min_votes) qs.set("min_votes", String(args.min_votes));
    if (args.sort) qs.set("sort", args.sort);
    if (args.limit) qs.set("limit", String(args.limit));
    if (args.cursor) qs.set("cursor", args.cursor);
    return (await this._fetch("hub_search", `/search?${qs.toString()}`)) as HubSearchReport;
  }

  /** Single-message read — ALSO the hub's read_message record (critical
   *  messages unpin on this; agency rule 2). Called on explicit expand. */
  async read_message(channel: string, message_id: string): Promise<HubMessage | null> {
    // The live hub answers this route with a LIST of one row (adversary A
    // F6) and the single read carries NO ratings decoration — normalize to
    // the declared single-or-null so a future consumer can't read
    // `.ratings` off an array and wipe a decorated row.
    const res = await this._fetch("hub_read_message", `/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(message_id)}`);
    const row = Array.isArray(res) ? res[0] : res;
    return (row ?? null) as HubMessage | null;
  }

  async post_message(
    channel: string,
    args: {
      title?: string;
      body: string;
      status?: string;
      to?: string[];
      reply_to?: string;
      answers?: string[];
      /** Opaque Hub protocol metadata, validated solely by Agora Hub. */
      data?: Record<string, unknown>;
      /** Attachment refs (agora 0091): {id, filename?}; the hub validates
       *  each id exists in this channel and fills content_type+size. */
      attachments?: Array<{ id: string; filename?: string }>;
    }
  ): Promise<any> {
    return await this._fetch("hub_post", `/channels/${encodeURIComponent(channel)}/messages`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  /** Upload a blob (agora 0091): raw-bytes body, declared type in the
   *  Content-Type header, filename in the query. Returns the ref
   *  {id=sha256, filename, content_type, size}. Idempotent by content hash.
   *  Bypasses _fetch (that path forces JSON) — a direct raw-body POST. */
  async upload_attachment(channel: string, file: File): Promise<HubAttachment> {
    const url = this.url(`/channels/${encodeURIComponent(channel)}/attachments?filename=${encodeURIComponent(file.name)}`);
    const r = await fetch(url, {
      method: "POST",
      headers: this.headers({ headers: { "Content-Type": file.type || "application/octet-stream" } }),
      body: file,
      signal: AbortSignal.timeout(60_000), // uploads get more room
      credentials: "same-origin",
    });
    const text = await r.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON error body
    }
    if (!r.ok) {
      const detail = body && typeof body === "object" ? body.detail || body.error || text : text;
      const err = new Error(`upload failed: ${detail}`) as Error & { status?: number };
      err.status = r.status;
      throw err;
    }
    // A 2xx with no usable id is a broken response, not a success — pushing a
    // pending chip with an undefined id would only fail at post time with a
    // confusing hub rejection (adversary b22b19ed). Fail here, named.
    if (!body || typeof body !== "object" || !body.id) {
      throw new Error("upload returned no attachment id (unexpected hub response shape)");
    }
    return body as HubAttachment;
  }

  /** Hub attachment route. This is useful for diagnostics; browser UI code
   * must use attachment_blob() so it carries the existing seat key. */
  attachment_url(channel: string, id: string): string {
    return this.url(`/channels/${encodeURIComponent(channel)}/attachments/${encodeURIComponent(id)}`);
  }

  async attachment_blob(channel: string, id: string): Promise<Blob> {
    return await this._blob(
      "hub_attachment",
      `/channels/${encodeURIComponent(channel)}/attachments/${encodeURIComponent(id)}`,
    );
  }

  /** Cursor ack — EXPLICIT act only (agency rule 1: acking is "I have
   *  seen this"; a webui that acks on render silently discharges the
   *  operator's triage queue). */
  async ack(channel: string, seq: number): Promise<any> {
    return await this._fetch("hub_ack", "/inbox/ack", {
      method: "POST",
      body: JSON.stringify({ cursors: { [channel]: seq } }),
    });
  }

  /** Channel members (membership-gated hub-side). */
  async members(channel: string): Promise<Array<Record<string, unknown>>> {
    const res = await this._fetch("hub_members", `/channels/${encodeURIComponent(channel)}/members`);
    return Array.isArray(res) ? res : [];
  }

  /** Create a channel (caller becomes owner). */
  async create_channel(name: string, is_private: boolean): Promise<any> {
    return await this._fetch("hub_create_channel", "/channels", {
      method: "POST",
      body: JSON.stringify({ name, private: is_private }),
    });
  }

  /** Write channel:meta (owner/operator writable) — carries the FULL
   *  merged value; a closed channel refuses member posts. CAS via
   *  expect_version: a 409 means someone else edited meta first. */
  async put_channel_meta(channel: string, value: Record<string, unknown>, expect_version?: number): Promise<any> {
    const body: any = { value };
    if (typeof expect_version === "number") body.expect_version = expect_version;
    return await this._fetch("hub_channel_meta_put", `/channels/${encodeURIComponent(channel)}/store/${encodeURIComponent("channel:meta")}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async channel_meta(channel: string): Promise<any> {
    return await this._fetch("hub_channel_meta", `/channels/${encodeURIComponent(channel)}/store/${encodeURIComponent("channel:meta")}`);
  }

  /** Kick/ban from ONE channel (owner/operator; hub enforces authority).
   *  seconds omitted = indefinite (ban); short = kick with cool-off. */
  async block(channel: string, agent_id: string, opts?: { seconds?: number; reason?: string }): Promise<any> {
    return await this._fetch("hub_block", `/channels/${encodeURIComponent(channel)}/blocks`, {
      method: "POST",
      body: JSON.stringify({ agent: agent_id, seconds: opts?.seconds, reason: opts?.reason }),
    });
  }

  async unblock(channel: string, agent_id: string): Promise<any> {
    return await this._fetch("hub_unblock", `/channels/${encodeURIComponent(channel)}/blocks/${encodeURIComponent(agent_id)}`, {
      method: "DELETE",
    });
  }

  /** Hub-wide lockout (operator agents only — the hub refuses others).
   *  Removes the agent from the WHOLE hub: survives key loss (re-register
   *  refused) and severs a live WS (agora c2263). seconds omitted = ban. */
  async hub_block(agent_id: string, opts?: { seconds?: number; reason?: string }): Promise<any> {
    return await this._fetch("hub_hub_block", "/hub/blocks", {
      method: "POST",
      body: JSON.stringify({ agent: agent_id, seconds: opts?.seconds, reason: opts?.reason }),
    });
  }

  /** Lift a hub-wide block (operator agents only). */
  async hub_unblock(agent_id: string): Promise<any> {
    return await this._fetch("hub_hub_unblock", `/hub/blocks/${encodeURIComponent(agent_id)}`, {
      method: "DELETE",
    });
  }

  /** Leave a channel — removes the seat's OWN membership so the channel
   *  drops off the rail (operator dm 14: the DM trash icon). Non-punitive
   *  and non-destructive: history persists hub-side, and a dm reopens on
   *  next contact (the hub re-asserts membership when a message flows). */
  async leave(channel: string): Promise<any> {
    return await this._fetch("hub_leave", `/channels/${encodeURIComponent(channel)}/leave`, {
      method: "POST",
    });
  }

  /** Archive a channel (operator dm 19/29; agora backlog 0090): owner or
   *  operator; sets state=archived, EVICTS all members (drops off every
   *  rail), excludes it from channel lists, messages preserved (append-only
   *  — it is archive, never delete). Feature-detected caller-side: a 404
   *  means the hub verb hasn't shipped yet. */
  async archive(channel: string): Promise<any> {
    return await this._fetch("hub_archive", `/channels/${encodeURIComponent(channel)}/archive`, {
      method: "POST",
    });
  }

  /** Unarchive (operator-only; agora 0090): restores state + visibility;
   *  members are NOT restored (explicit rejoin/re-invite). */
  async unarchive(channel: string): Promise<any> {
    return await this._fetch("hub_unarchive", `/channels/${encodeURIComponent(channel)}/archive`, {
      method: "DELETE",
    });
  }

  /** Retire an agent (operator-only; agora 0089): neutral decommission —
   *  off all rosters/presence/DM candidates, id reserved forever, NEVER in
   *  the blocks list (this is not a ban). Feature-detected caller-side. */
  async retire_agent(agent_id: string, reason?: string): Promise<any> {
    return await this._fetch("hub_retire", `/agents/${encodeURIComponent(agent_id)}/retire`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  /** Un-retire an agent (operator-only): restores auth; the agent rejoins
   *  rooms explicitly (memberships not auto-restored). */
  async unretire_agent(agent_id: string): Promise<any> {
    return await this._fetch("hub_unretire", `/agents/${encodeURIComponent(agent_id)}/retire`, {
      method: "DELETE",
    });
  }

  /** Retired agents (operator-only; agora 0.12.0): the un-retire candidate
   *  list — retired agents are off every roster, so this dedicated route is
   *  the only enumeration. Rows: {id, reason, retired_at}. */
  async retired_agents(): Promise<Array<{ id?: string; reason?: string; retired_at?: number }>> {
    const res = await this._fetch("hub_retired", "/agents/retired");
    return Array.isArray(res) ? res : [];
  }

  /** HARD-DELETE a retired agent (operator dm 164b, hub 0.12.41,
   *  `agent-delete`): the irreversible SECOND step — the hub 409s while
   *  the agent is still active (retire first), then wipes it from every
   *  roster/board (votes+ratings purged) and reserves the id forever;
   *  history keeps the old sender name (rosters cleaned, archives not).
   *  404 on pre-0.12.41 hubs — the delete action feature-detects. */
  async delete_agent(agent_id: string): Promise<any> {
    return await this._fetch("hub_delete_agent", `/agents/${encodeURIComponent(agent_id)}`, {
      method: "DELETE",
    });
  }

  async list_blocks(scope?: string): Promise<Array<Record<string, unknown>>> {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    const res = await this._fetch("hub_blocks", `/blocks${qs}`);
    return Array.isArray(res) ? res : [];
  }

  /** Send a direct message (opens the dm channel on first use). */
  async send_dm(peer: string, args: { title?: string; body: string; status?: string; data?: Record<string, unknown> }): Promise<any> {
    // status defaults to OPEN (operator dm 86: every dm to an agent is an
    // ASK — it must land in the peer's owed block, not ambient fyi). The
    // hub's dm door auto-addresses to=[peer]; open makes it owed.
    return await this._fetch("hub_send_dm", `/dms/${encodeURIComponent(peer)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: args.body, title: args.title || undefined, status: args.status || "open", data: args.data }),
    });
  }

  /** Store keys of a channel (READ-ONLY; S3 board join). Rows carry
   *  {key, version, updated_by, updated_at} — values ride store_get, so
   *  the version is the cache key (re-fetch only what changed). */
  async store_keys(channel: string): Promise<Array<{ key: string; version: number; updated_by?: string; updated_at?: number }>> {
    const res = await this._fetch("hub_store_keys", `/channels/${encodeURIComponent(channel)}/store`);
    return Array.isArray(res) ? res : [];
  }

  /** One store row's value (READ-ONLY; claim:/decision:/reactions: rows). */
  async store_get(channel: string, key: string): Promise<{ key?: string; value?: unknown; version?: number } | null> {
    return (await this._fetch("hub_store_get", `/channels/${encodeURIComponent(channel)}/store/${encodeURIComponent(key)}`)) as any;
  }

  /* put_reaction is DELETED (operator dm 150 "one reputation score
   * system"): the reactions:* store convention stranded votes where
   * reputation could not see them. rate_message/unrate_message are the
   * only vote verbs. */

  /** Active hub delegations (operator dm 154; hub ADR-0004): a grant is a
   *  verifiable LABEL + validation anchor — {agent_id, powers[], expires,
   *  note}. Public list (every seat may verify who holds what). */
  async delegations(): Promise<Array<Record<string, any>>> {
    const res = await this._fetch("hub_delegations", "/delegations");
    return Array.isArray(res) ? res : [];
  }

  /** Grant/revise a delegation (operator-only admin surface). Powers must
   *  be a non-empty subset of
   *  the hub's vocabulary (ruling/operational/reporting/moderation —
   *  served errors name it); ttl defaults hub-side to 7 days. */
  async set_delegation(agent_id: string, powers: string[], opts?: { ttl_seconds?: number; note?: string }): Promise<any> {
    return await this._fetch("hub_set_delegation", "/admin/delegation", {
      method: "PUT",
      body: JSON.stringify({ agent_id, powers, ttl_seconds: opts?.ttl_seconds ?? null, note: opts?.note ?? "" }),
    });
  }

  /** Revoke a delegation (operator-only). */
  async revoke_delegation(agent_id: string): Promise<any> {
    return await this._fetch("hub_revoke_delegation", `/admin/delegation/${encodeURIComponent(agent_id)}`, {
      method: "DELETE",
    });
  }

  /** Retract a message (agora 0097, operator dm 88): author-only +
   *  operator override, idempotent. The hub tombstones body/title, nulls
   *  data, downgrades open->fyi (the obligation dies), and stamps
   *  retracted:true on every read. 404 on pre-0.12.16 hubs. */
  async retract_message(channel: string, message_id: string): Promise<any> {
    return await this._fetch("hub_retract", `/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(message_id)}/retract`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  /** Retract a message AND every reply beneath it (agora 0097 thread
   *  retraction), in ONE hub transaction. The hub walks the trail from its
   *  own rows — never from this console's loaded window — and applies the
   *  SAME authority rule per member: an operator may retract anyone's; a
   *  non-operator whose trail contains another author is refused 403 with
   *  NOTHING retracted. The console never pre-judges that: it calls, and
   *  renders whatever the hub answers. Returns {count, already_retracted,
   *  skipped_non_messages, messages}. 404 on hubs predating the verb. */
  async retract_thread(channel: string, message_id: string): Promise<any> {
    return await this._fetch("hub_retract_thread", `/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(message_id)}/retract_thread`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  /** Operator desk (contract dm:agora--continuum#26-30, LIVE hub 0.12.25):
   *  every debt blocked on the operator, STATE not log (derived per call,
   *  no cursor). Returns the full body — rows (kind ask|queue, oldest
   *  first), satisfied (queue rows whose done_when the hub observed —
   *  they self-clear), counts, viewer, computed_at. Operator-or-
   *  reporting-delegate only: other seats get 403; callers surface the
   *  refusal honestly. */
  async desk(): Promise<{
    computed_at?: number;
    viewer?: string;
    operators?: string[];
    rows: Array<Record<string, unknown>>;
    satisfied: Array<Record<string, unknown>>;
    counts?: { rows?: number; satisfied?: number };
  }> {
    const res = await this._fetch("hub_desk", "/desk");
    // Tolerate the pre-contract array shape (never shipped by a live hub,
    // but the drawer's tests exercise it) — normalize to the body shape.
    if (Array.isArray(res)) return { rows: res, satisfied: [] };
    return {
      ...res,
      rows: Array.isArray((res as any)?.rows) ? (res as any).rows : [],
      satisfied: Array.isArray((res as any)?.satisfied) ? (res as any).satisfied : [],
    };
  }

  /** The viewer's OWED report (comms-audit ask 2, hub OwedReport/0118):
   *  `to_consume` = answers to the viewer's OWN open asks not yet used
   *  (ConsumeRow: {channel, seq, answer_id, answer_seq, answered_by,
   *  title, your_asks}). The console signs as the operator, so this is
   *  laurent's own to_consume — rendered as a sticky "answers waiting on
   *  you" rail. 404 on pre-0.12.x hubs; the rail feature-detects and hides. */
  async owed(): Promise<{
    computed_at?: number;
    counts?: { to_answer?: number; to_consume?: number };
    to_answer?: Array<Record<string, unknown>>;
    to_consume?: Array<Record<string, unknown>>;
    waiting_on?: Array<Record<string, unknown>>;
  }> {
    const res = await this._fetch("hub_owed", "/owed");
    const obj = res && typeof res === "object" ? (res as any) : {};
    return {
      ...obj,
      to_answer: Array.isArray(obj.to_answer) ? obj.to_answer : [],
      to_consume: Array.isArray(obj.to_consume) ? obj.to_consume : [],
      waiting_on: Array.isArray(obj.waiting_on) ? obj.waiting_on : [],
    };
  }

  /** One-call group creation (agora dm#43, hub >= 0.12.29): create +
   *  purpose meta + per-member invite DMs (status=fyi, token in
   *  data.invite_token) + the opening open post — replaces the client-side
   *  4-call /group macro so invite-status drift ends at the root. 404 on
   *  older hubs/proxies — the caller falls back to the macro. */
  async create_group(opts: { name: string; members: string[]; purpose: string; opening_post?: string; private?: boolean }): Promise<{
    channel?: string;
    invited?: string[];
    failed?: Array<string | Record<string, unknown>>;
  }> {
    return await this._fetch("hub_create_group", "/groups", {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        members: opts.members,
        purpose: opts.purpose,
        opening_post: opts.opening_post || opts.purpose,
        private: opts.private !== false,
      }),
    });
  }

  /** Unified-backlog list (agora c3345, hub >= 0.12.19): every work:* row
   *  of a channel, parsed, one call. 404 on older hubs — callers fall
   *  back to the store listing. */
  async work_rows(channel: string): Promise<Array<Record<string, unknown>>> {
    const res = await this._fetch("hub_work_rows", `/channels/${encodeURIComponent(channel)}/work`);
    return Array.isArray(res) ? res : [];
  }

  /** Work-id activity index (agora 0093, S2): every claim, decision, and
   *  citing message for one work id across the seat's channels. 404/400
   *  on pre-0.12.12 hubs — callers feature-detect. */
  async work(item_id: string): Promise<{ item_id: string; claims?: any[]; decisions?: any[]; messages?: any[] } | null> {
    return (await this._fetch("hub_work", `/work/${encodeURIComponent(item_id)}`)) as any;
  }

  /** Mint a single-use invite token for a channel the seat owns (the
   *  /group flow, agora 0.12.10 parity). The token rides a DM to the
   *  invitee — never a URL. */
  async create_invite(channel: string, agent_id: string): Promise<string> {
    const res = await this._fetch("hub_create_invite", `/channels/${encodeURIComponent(channel)}/invites`, {
      method: "POST",
      body: JSON.stringify({ agent_id }),
    });
    const token = res && typeof res === "object" ? String(res.invite_token || "") : "";
    if (!token) throw new Error("invite mint returned no token (unexpected hub response shape)");
    return token;
  }

  /** Agent roster with reachability (one row per agent sharing a channel
   *  with the seat — connected or not); the DM recipient dropdown source. */
  async presence(): Promise<Array<{ agent_id?: string; state?: string }>> {
    const res = await this._fetch("hub_presence", "/presence");
    return Array.isArray(res) ? res : [];
  }

  /** Channel leaderboard (agora 0094). Feature-detect: a pre-0.12.7 hub
   *  404s — callers render "ships with the next hub update" off err.status. */
  async reputation(channel: string): Promise<HubReputationBoard> {
    return (await this._fetch(
      "hub_reputation",
      `/channels/${encodeURIComponent(channel)}/reputation`,
    )) as HubReputationBoard;
  }

  /** Hub-wide leaderboard: the sum of every channel's scores per agent. */
  async reputation_hub(): Promise<HubReputationBoard> {
    return (await this._fetch("hub_reputation_hub", "/reputation")) as HubReputationBoard;
  }

  /** The attributed live votes behind one agent's channel score. */
  async reputation_votes(channel: string, target: string): Promise<HubReputationVote[]> {
    const res = await this._fetch(
      "hub_reputation_votes",
      `/channels/${encodeURIComponent(channel)}/reputation/${encodeURIComponent(target)}/votes`,
    );
    return Array.isArray(res) ? res : [];
  }

  /** Rate a MESSAGE ±1 (agora-0122, hub ≥ 0.12.31): one standing rating
   *  per (rater, message) — PUT replaces (flip), DELETE withdraws; the
   *  rating IS reputation input about the message's sender (operator
   *  ruling dm#111: one store). Any refusal — 404 old hub included —
   *  surfaces to the caller verbatim; there is NO fallback store
   *  (dm 150: a vote reputation cannot see is a stranded vote). */
  async rate_message(channel: string, message_id: string, value: 1 | -1, note = ""): Promise<any> {
    const body = { value, note };
    return await this._fetch(
      "hub_rate_message",
      `/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(message_id)}/rating`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }

  /** Withdraw the seat's standing message rating (toggle-off). */
  async unrate_message(channel: string, message_id: string): Promise<any> {
    return await this._fetch(
      "hub_unrate_message",
      `/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(message_id)}/rating`,
      { method: "DELETE" },
    );
  }

  async rate(channel: string, target: string, axis: string, value: 1 | -1, note = ""): Promise<HubReputationVote> {
    return (await this._fetch(
      "hub_rate",
      `/channels/${encodeURIComponent(channel)}/reputation/${encodeURIComponent(target)}`,
      { method: "PUT", body: JSON.stringify({ axis, value, note }) },
    )) as HubReputationVote;
  }

  /** Withdraw the operator seat's live vote on (target, axis) — the
   *  toggle-off for an inline thumb. */
  async _delete_reputation(channel: string, target: string, axis: string): Promise<{ removed: number }> {
    return (await this._fetch(
      "hub_unrate",
      `/channels/${encodeURIComponent(channel)}/reputation/${encodeURIComponent(target)}?axis=${encodeURIComponent(axis)}`,
      { method: "DELETE" },
    )) as { removed: number };
  }

  /** Browser WebSocket constructors cannot set Authorization. Agora's native
   * browser lane is /ws?token=KEY, so derive that existing Hub endpoint from
   * the in-memory seat key. No WUI session, proxy, or minting is involved. */
  ws_url(): string | null {
    // A host-supplied socket URL wins, verbatim: the host owns its route
    // and its auth (e.g. a relay that forbids token-in-URL and attaches
    // the key server-side). WUI appends nothing.
    if (this.ws_override) return this.ws_override;
    const rest = this.base_url || (typeof window === "undefined" ? "" : window.location.origin);
    if (!rest || !this.bearer_token) return null;
    try {
      // Relative bases (a host's proxy prefix) resolve against the page
      // origin instead of throwing into the null branch.
      const url = new URL(rest, typeof window === "undefined" ? undefined : window.location.origin);
      if (url.protocol === "https:") url.protocol = "wss:";
      else if (url.protocol === "http:") url.protocol = "ws:";
      else return null;
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
      url.search = "";
      url.hash = "";
      url.searchParams.set("token", this.bearer_token);
      return url.toString();
    } catch {
      return null;
    }
  }
}
