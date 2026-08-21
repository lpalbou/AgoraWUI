// @vitest-environment jsdom
//
// Team page pins: trust affordances (protocol pin, answered chips, About
// pane), the 2026-07-14 redesign (thread grouping in the DOM, category
// filters), and the AI lanes' read-only contract (/assistant routes to
// the analyst and NEVER posts to the room).
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HubClient } from "../../src/lib/hub_client";
import { TeamPage } from "../../src/ui/team_page";

const original_create_object_url = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const original_revoke_object_url = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
let object_url_sequence = 0;

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => `blob:agora-wui-test-${++object_url_sequence}` });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (original_create_object_url) Object.defineProperty(URL, "createObjectURL", original_create_object_url);
  else delete (URL as any).createObjectURL;
  if (original_revoke_object_url) Object.defineProperty(URL, "revokeObjectURL", original_revoke_object_url);
  else delete (URL as any).revokeObjectURL;
});

type StubOpts = {
  protocol?: string;
  paused?: boolean;
  messages?: any[];
  info?: any;
  inbox?: any[];
  digest_counts?: Record<string, number>;
  members?: any[];
  blocks?: any[];
  channels?: any[];
  files?: any[];
  retired?: any[];
  owed?: any;
  search?: any;
  /** `/whoami` — identity plus the hub's own answers about this seat:
   *  `mission` (the operator's standing charge) and the `hub_charter`
   *  pointer. Default keeps the pre-0.17 shape so every existing pin still
   *  describes a hub that serves neither. */
  whoami?: any;
  /** `GET /charter` — the hub charter in this seat's view. Reading it is
   *  what records the receipt, so a test asserting the read is asserting
   *  the debt-clearing act itself. */
  charter?: any;
  /** Status + body for POST /channels/{c}/messages, so the charter gate's
   *  409 refusal can be exercised. */
  post_refusal?: { status: number; detail: string };
};

function stub_hub(opts: StubOpts = {}): ReturnType<typeof vi.fn> {
  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    if (url.includes("/whoami")) {
      return new Response(JSON.stringify(opts.whoami ?? { id: "laurent" }), { status: 200 });
    }
    // HUB-scope charter only (`/charter`, `/charter?full=true`) — a room's
    // charter is a channel-fs read and must fall through to that branch.
    if (/\/charter(\?|$)/.test(url)) {
      if (!opts.charter) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
      return new Response(JSON.stringify(opts.charter), { status: 200 });
    }
    if (url.includes("/healthz")) {
      return new Response(JSON.stringify({ ok: true, version: "0.14.0", protocol: opts.protocol ?? "agora/0.4", paused: opts.paused ?? false }), { status: 200 });
    }
    if (url.includes("/inbox")) {
      return new Response(JSON.stringify(opts.inbox ?? []), { status: 200 });
    }
    if (url.includes("/owed")) {
      return new Response(JSON.stringify(opts.owed ?? { to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
    }
    if (url.includes("/search")) {
      const empty = { hits: [], shown: 0, total: 0 };
      return new Response(
        JSON.stringify(
          opts.search ?? { decisions: empty, open_threads: empty, work: empty, people: empty, files: empty, messages: empty, relaxed: false, channels_searched: 0, next_cursor: null, computed_at: 1 }
        ),
        { status: 200 }
      );
    }
    if (url.includes("/digest")) {
      const channel = decodeURIComponent(url.split("/channels/")[1].split("/digest")[0]);
      return new Response(JSON.stringify({ channel, counts: { open_questions: opts.digest_counts?.[channel] ?? 0 } }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/info")) {
      return new Response(
        JSON.stringify(
          opts.info ?? { channel: { name: "commons", private: false }, meta: { purpose: "cross-package commons" }, members: ["a", "b"], response_sla_minutes: 1440, state: "open", charter: null }
        ),
        { status: 200 }
      );
    }
    if (url.includes("/channels") && url.includes("/members")) {
      return new Response(JSON.stringify(opts.members ?? []), { status: 200 });
    }
    if (url.includes("/blocks")) {
      return new Response(JSON.stringify(opts.blocks ?? []), { status: 200 });
    }
    if (url.includes("/hub/blocks")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/messages") && String(init?.method || "GET") === "GET") {
      return new Response(JSON.stringify(opts.messages ?? []), { status: 200 });
    }
    if (opts.post_refusal && url.includes("/channels") && url.endsWith("/messages") && String(init?.method || "GET") === "POST") {
      return new Response(JSON.stringify({ detail: opts.post_refusal.detail }), { status: opts.post_refusal.status });
    }
    if (url.includes("/channels") && url.endsWith("/leave") && String(init?.method || "GET") === "POST") {
      return new Response(JSON.stringify({ left: true }), { status: 200 });
    }
    if (url.includes("/channels") && url.endsWith("/archive")) {
      // Hub verb not shipped yet (agora 0090) — feature-detect on 404.
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    }
    if (url.endsWith("/agents/retired")) {
      return new Response(JSON.stringify(opts.retired ?? []), { status: 200 });
    }
    if (url.includes("/agents/") && url.endsWith("/retire")) {
      // Hub verb not shipped yet (agora 0089) — feature-detect on 404.
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    }
    if (url.match(/\/channels\/[^/]+\/fs$/)) {
      return new Response(JSON.stringify(opts.files ?? []), { status: 200 });
    }
    if (url.match(/\/channels\/[^/]+\/fs\//)) {
      if (String(init?.method || "GET") === "DELETE") {
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ path: "plans/x.md", content: "# Plan\n\nhello **world**", mime: "text/markdown", version: 2, updated_by: "flow", updated_at: 1 }), { status: 200 });
    }
    if (url.endsWith("/channels")) {
      return new Response(JSON.stringify(opts.channels ?? [{ name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: Date.now() / 1000 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch_mock);
  return fetch_mock;
}

function make_advisor(reply = "the summary") {
  return vi.fn(async () => reply);
}

function render_page(props: Partial<React.ComponentProps<typeof TeamPage>> = {}): void {
  render(<TeamPage advisor={make_advisor()} {...props} />);
}

describe("member-scoped channel selection", () => {
  it("opens the newest readable channel and omits public rooms the seat cannot read", async () => {
    const fetch_mock = stub_hub({
      channels: [
        { name: "optimize-code", private: false, member: false, member_count: 6, last_seq: 80, last_at: 20 },
        { name: "agora-wui-work", private: false, member: true, member_count: 7, last_seq: 40, last_at: 10 },
      ],
    });
    render_page();

    await screen.findByText((_, element) => Boolean(element?.className?.includes?.("team_pane_title") && element.textContent === "#agora-wui-work"));
    expect(screen.queryByText("#optimize-code")).toBeNull();
    await waitFor(() => {
      expect(fetch_mock.mock.calls.some(([url]: any[]) => String(url).includes("/channels/agora-wui-work/messages"))).toBe(true);
      expect(fetch_mock.mock.calls.some(([url]: any[]) => String(url).includes("/channels/optimize-code/messages"))).toBe(false);
    });
  });
});

describe("native WebSocket subscribe/catch-up", () => {
  it("subscribes member channels, carries cursors across membership changes, and reconnects from a gap", async () => {
    const channels = [{ name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: 10 }];
    stub_hub({
      channels,
      messages: [{ id: "m10", channel: "commons", seq: 10, sender: "peer", status: "fyi", body: "known cursor" }],
    });

    class FakeSocket {
      static readonly OPEN = 1;
      static instances: FakeSocket[] = [];
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      sent: string[] = [];

      constructor(readonly url: string) {
        FakeSocket.instances.push(this);
      }

      send(data: string): void {
        this.sent.push(data);
      }

      open(): void {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.(new Event("open"));
      }

      receive(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
      }

      close(): void {
        this.readyState = 3;
        this.onclose?.({} as CloseEvent);
      }

      subscribe_frames(): Array<{ type?: string; channels?: string[]; since?: Record<string, number> }> {
        return this.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "subscribe");
      }
    }

    vi.stubGlobal("WebSocket", FakeSocket);
    const hub = new HubClient({
      base_url: "http://127.0.0.1:8765",
      bearer_token: "existing-seat-key",
    });
    render(<TeamPage advisor={make_advisor()} hub={hub} />);

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    await act(async () => {
      socket.open();
    });
    await waitFor(() => {
      expect(socket.subscribe_frames().some((frame) => frame.channels?.join(",") === "commons")).toBe(true);
    });

    channels.push({ name: "dm:laurent--peer", private: true, member: true, member_count: 2, last_seq: 42, last_at: 11 });
    await act(async () => {
      socket.receive({ type: "envelope", envelope: { channel: "dm:laurent--peer", seq: 42 } });
    });
    await waitFor(() => {
      const membership_update = socket.subscribe_frames().find((frame) => frame.channels?.includes("dm:laurent--peer"));
      expect(membership_update?.channels).toEqual(["commons", "dm:laurent--peer"]);
      expect(membership_update?.since?.["dm:laurent--peer"]).toBe(42);
    });

    vi.useFakeTimers();
    await act(async () => {
      // Seq 11 was dropped. Do not advance to 12; reconnect from the last
      // contiguous REST/live cursor so the Hub replays the missing range.
      socket.receive({ type: "envelope", envelope: { channel: "commons", seq: 12 } });
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    const reconnected = FakeSocket.instances[1];
    await act(async () => {
      reconnected.open();
    });
    const reconnect_frame = reconnected.subscribe_frames().find((frame) => frame.channels?.includes("dm:laurent--peer"));
    expect(reconnect_frame?.since?.commons).toBe(10);
    expect(reconnect_frame?.since?.["dm:laurent--peer"]).toBe(42);
  });
});

describe("hub-wide search (agora-0132, hub ≥ 0.12.44)", () => {
  const empty = { hits: [], shown: 0, total: 0 };
  const report = (over: Record<string, any> = {}) => ({
    decisions: empty,
    open_threads: empty,
    work: empty,
    people: empty,
    files: empty,
    messages: empty,
    relaxed: false,
    channels_searched: 3,
    next_cursor: null,
    computed_at: 1,
    ...over,
  });

  it("submits the query to GET /search and renders served sections with client-drawn marks", async () => {
    const fetch_mock = stub_hub({
      search: report({
        messages: {
          hits: [
            {
              kind: "message",
              channel: "commons",
              ref: "01MSG",
              seq: 7,
              sender: "agora",
              status: "open",
              created_at: 1,
              snippet: "the kelp rollout",
              highlights: [[4, 4]],
              ratings: { up: 2, down: 0, mine: 0 },
            },
          ],
          shown: 1,
          total: 1,
        },
      }),
    });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "kelp" } });
    fireEvent.submit(input.closest("form")!);
    // The verb fired with the query.
    await waitFor(() => {
      const calls = fetch_mock.mock.calls.filter(([u]: any[]) => String(u).includes("/search"));
      expect(calls.length).toBeGreaterThan(0);
      expect(String(calls[0][0])).toContain("q=kelp");
    });
    // Section header + the served hit with a client-drawn <mark>.
    await screen.findByText("Messages");
    const mark = await screen.findByText((_, el) => el?.tagName === "MARK" && el.textContent === "kelp");
    expect(mark).toBeTruthy();
    // No body is served — the row shows the snippet, the sender, the tally.
    await screen.findByText("agora");
    await screen.findByText((_, el) => Boolean(el?.className?.includes?.("team_search_tally") && el.textContent === "2 0" && el.querySelectorAll("svg").length === 2));
  });

  it("renders the LOUD relaxation banner when the hub loosened the query", async () => {
    stub_hub({ search: report({ relaxed: true }) });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "who approved the kelp anyway" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText(/No exact matches — showing loosened/);
  });

  it("semantic adoption (dm#126): fused mode SUPPRESSES the relaxed banner, renders the mode chip + coverage + copyable notice", async () => {
    stub_hub({
      search: report({
        relaxed: true, // fused already compensated — banner must NOT show
        mode_used: "fused",
        semantic_coverage: 0.62,
        notice: "semantic index filling: 62% embedded — zero-hits are not proof of absence",
      }),
    });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "kelp" } });
    fireEvent.submit(input.closest("form")!);
    // Notice renders visibly; mode chip carries verbatim mode + coverage %.
    await screen.findByText(/semantic index filling: 62% embedded/);
    await screen.findByText((_, el) => Boolean(el?.className?.includes?.("team_search_mode") && el.textContent?.includes("fused") && el.textContent?.includes("62% embedded")));
    expect(screen.queryByText(/No exact matches — showing loosened/)).toBeNull();
  });

  it("semantic adoption: lexical mode keeps the relaxed banner (and absent mode_used stays backward-compatible)", async () => {
    stub_hub({ search: report({ relaxed: true, mode_used: "lexical", notice: null }) });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "kelp" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText(/No exact matches — showing loosened/);
    expect(screen.queryByText(/team_search_notice/)).toBeNull();
  });

  it("truncated sections say 'showing N of M' and 'view all' pivots into recent+kind paging", async () => {
    const fetch_mock = stub_hub({
      search: report({
        messages: {
          hits: [{ kind: "message", channel: "commons", ref: "01A", seq: 1, sender: "a", created_at: 1, snippet: "kelp one", highlights: [] }],
          shown: 1,
          total: 20,
        },
      }),
    });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "kelp" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("showing 1 of 20"); // LOUD truncation (contract)
    fireEvent.click(await screen.findByText("view all →"));
    await waitFor(() => {
      const pivot = fetch_mock.mock.calls.find(([u]: any[]) => String(u).includes("kind=message") && String(u).includes("sort=recent"));
      expect(pivot).toBeTruthy();
      expect(String(pivot![0])).toContain("limit=50");
    });
  });

  it("rated lens (v2, agora-0134): the ▼ chip re-runs with rated=down, and empty-box Enter browses most-downvoted", async () => {
    const fetch_mock = stub_hub({
      search: report({
        messages: {
          hits: [{ kind: "message", channel: "commons", ref: "01D", seq: 2, sender: "b", created_at: 1, snippet: "downvoted row", highlights: [], ratings: { up: 0, down: 3, mine: 0 } }],
          shown: 1,
          total: 1,
        },
      }),
    });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    // Empty-box Enter = browse mode: rated defaults to "down", q empty,
    // sort=votes (net order) — the "where is the displeasure" view.
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      const browse = fetch_mock.mock.calls.find(([u]: any[]) => String(u).includes("/search") && String(u).includes("rated=down"));
      expect(browse).toBeTruthy();
      const url = String(browse![0]);
      expect(url).toContain("q=&"); // empty query rides the wire
      expect(url).toContain("sort=votes");
    });
    // The lens chip is active and the meta line names browse mode.
    await screen.findByText(/rated messages/);
    // Toggling ▲ re-runs with rated=up.
    fireEvent.click(await screen.findByText("▲ rated"));
    await waitFor(() => {
      expect(fetch_mock.mock.calls.some(([u]: any[]) => String(u).includes("rated=up"))).toBe(true);
    });
  });

  it("clicking a message hit closes the search view (jump to thread context)", async () => {
    stub_hub({
      search: report({
        messages: {
          hits: [{ kind: "message", channel: "commons", ref: "01HIT", seq: 3, sender: "a", created_at: 1, snippet: "kelp row", highlights: [] }],
          shown: 1,
          total: 1,
        },
      }),
    });
    render_page();
    const input = await screen.findByPlaceholderText("Search the hub…");
    fireEvent.change(input, { target: { value: "kelp" } });
    fireEvent.submit(input.closest("form")!);
    const hit = await screen.findByText((_, el) => Boolean(el?.className?.includes?.("team_search_hit") && el.textContent?.includes("kelp row")));
    fireEvent.click(hit);
    await waitFor(() => {
      expect(screen.queryByText("Messages")).toBeNull(); // results view gone
    });
  });
});

describe("message ratings — ONE reputation system (operator dm 150)", () => {
  const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };

  it("renders the served tally decoration and casts through the RATING VERB on thumb click (no store writes anywhere)", async () => {
    const fetch_mock = stub_hub({
      messages: [
        { ...base, id: "01AAA", seq: 1, sender: "agora", status: "fyi", body: "rated row", ratings: { up: 2, down: 1, mine: 0 } },
      ],
    });
    render_page();
    // Served decoration renders as the always-visible tally (one span,
    // multiple text nodes — match on the composed content).
    await screen.findByText((_, el) => Boolean(el && el.className?.includes?.("team_reaction_tally") && el.textContent === "21" && el.querySelectorAll("svg").length === 2));
    // Click the +1 thumb on the (foreign) row's hover rail.
    const up_btn = await screen.findByTitle("+1 this message");
    fireEvent.click(up_btn);
    await waitFor(() => {
      const rating_calls = fetch_mock.mock.calls.filter(([u, init]: any[]) => String(u).includes("/rating") && String(init?.method) === "PUT");
      expect(rating_calls.length).toBe(1);
      expect(String(rating_calls[0][0])).toContain("/messages/01AAA/rating");
    });
    // The stranding machine is dead: NO store write may ever fire.
    const store_writes = fetch_mock.mock.calls.filter(([u, init]: any[]) => String(u).includes("/store/") && String(init?.method) === "PUT");
    expect(store_writes.length).toBe(0);
  });

  it("hides tallies and thumbs on undecorated rows (pre-ratings hub) — no fallback lane exists", async () => {
    stub_hub({
      messages: [{ ...base, id: "01BBB", seq: 2, sender: "agora", status: "fyi", body: "undecorated row" }],
    });
    render_page();
    await screen.findByText("undecorated row");
    expect(screen.queryByTitle("+1 this message")).toBeNull();
    expect(document.querySelector(".team_reaction_tally")).toBeNull();
  });

  it("withdraw: clicking my own standing direction DELETEs the rating", async () => {
    const fetch_mock = stub_hub({
      messages: [
        { ...base, id: "01CCC", seq: 3, sender: "agora", status: "fyi", body: "my upvoted row", ratings: { up: 1, down: 0, mine: 1 } },
      ],
    });
    render_page();
    const up_btn = await screen.findByTitle("Withdraw your +1 on this message");
    fireEvent.click(up_btn);
    await waitFor(() => {
      const del_calls = fetch_mock.mock.calls.filter(([u, init]: any[]) => String(u).includes("/messages/01CCC/rating") && String(init?.method) === "DELETE");
      expect(del_calls.length).toBe(1);
    });
  });
});

describe("read-state presentation", () => {
  const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
  it("does not render an ambiguous missed badge for a read===false audit row", async () => {
    stub_hub({
      messages: [{ ...base, id: "01SWEPT", seq: 5, sender: "agora", status: "fyi", body: "swept by the burst cursor", read: false }],
      inbox: [], // no unread envelope → cursor already advanced past it
    });
    render_page();
    await screen.findByText("swept by the burst cursor");
    expect(screen.queryByText("missed?")).toBeNull();
  });
});

describe("attention stays in the tab system", () => {
  it("does not duplicate waiting answers or vigilance as top-of-thread rails", async () => {
    stub_hub({
      owed: {
        to_consume: [
          { channel: "dm:agora--laurent", answer_id: "01ANS", answer_seq: 42, answered_by: "agora", title: "delegate UI status", your_asks: ["delegate UI status"] },
        ],
        to_answer: [],
        counts: { to_consume: 1 },
      },
      messages: [{ id: "01OPEN", channel: "commons", seq: 1, sender: "agora", kind: "message", status: "open", urgency: "inbox", title: "needs an answer", body: "needs an answer", data: { asks: [{ id: "1", text: "answer" }] }, reply_to: null }],
    });
    render_page();
    await screen.findByText("needs an answer");
    expect(screen.queryByText(/answers? to your question.*waiting/i)).toBeNull();
    expect(screen.queryByText(/threads? need vigilance/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^Asks/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Needs vigilance/ })).toBeTruthy();
  });
});

describe("TeamPage trust affordances", () => {
  it("renders no protocol warning when the hub matches the pin", async () => {
    stub_hub({ protocol: "agora/0.4" });
    render_page();
    await screen.findByText(/as laurent/);
    expect(screen.queryByText(/protocol .* ≠/)).toBeNull();
  });

  it("warns (never refuses) on a protocol mismatch and surfaces hub paused", async () => {
    stub_hub({ protocol: "agora/0.3", paused: true });
    render_page();
    await screen.findByText("protocol agora/0.3 ≠ agora/0.4");
    await screen.findByText("hub paused");
    expect((await screen.findAllByText("#commons")).length).toBeGreaterThan(0);
  });

  it("contains a render throw to one row instead of blanking the page (operator dm 55/57 — the URL crash class)", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    stub_hub({
      messages: [
        // A long body carrying a URL-shaped-but-unparseable token: this was
        // the exact crash. Even after the token fix, the boundary must keep
        // ANY future render throw from taking down the whole thread.
        { ...base, id: "bad", seq: 1, sender: "flow", status: "fyi", body: "see https://…/pic.png " + "x".repeat(500) },
        { ...base, id: "ok", seq: 2, sender: "core", status: "fyi", body: "a healthy neighbor message" },
      ],
    });
    render_page();
    // The healthy sibling still renders — the page did NOT blank.
    await screen.findByText("a healthy neighbor message");
    // The pathological token no longer throws; it renders inline as text.
    // (If a future regression throws, the boundary shows "render failed"
    // and the raw body — either way the page survives.)
    expect(screen.queryByText("a healthy neighbor message")).toBeTruthy();
  });

  it("renders the answered chip only from the wire field on open/blocked", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    stub_hub({
      messages: [
        { ...base, id: "m1", seq: 1, sender: "core", status: "open", title: "with field", body: "x", has_resolved_reply: true },
        { ...base, id: "m2", seq: 2, sender: "core", status: "open", title: "without field", body: "y" },
        { ...base, id: "m3", seq: 3, sender: "core", status: "fyi", title: "fyi with field", body: "z", has_resolved_reply: true },
      ],
    });
    render_page();
    await screen.findByText("with field");
    expect(screen.getAllByText("answered")).toHaveLength(1);
  });

  it("vfs delete: the trash arms an IN-APP confirm naming the agent risk; confirm sends the CAS DELETE (operator ask 2026-08-19)", async () => {
    const fetch_mock = stub_hub({ files: [{ path: "notes.md", version: 3, updated_by: "flow", updated_at: 1, size: 12 }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel files drawer" }));
    await screen.findByText("notes.md");
    const del_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[1]?.method || "GET") === "DELETE" && String(c[0]).includes("/fs/")).length;
    fireEvent.click(screen.getByRole("button", { name: "Delete notes.md" }));
    // Arming is not deleting: the modal explains the blast radius first.
    await screen.findByText("Delete file?");
    expect(screen.getByText(/Agents may already rely on it/)).toBeTruthy();
    expect(del_calls()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(del_calls()).toBe(1));
    // The delete is fenced on the version the user was LOOKING at.
    const call = fetch_mock.mock.calls.find((c) => String(c[1]?.method || "") === "DELETE")!;
    expect(String(call[0])).toContain("/channels/commons/fs/notes.md?expect_version=3");
    await waitFor(() => expect(screen.queryByText("Delete file?")).toBeNull());
  });

  it("vfs delete cancel leaves the file untouched", async () => {
    const fetch_mock = stub_hub({ files: [{ path: "notes.md", version: 3, updated_by: "flow", updated_at: 1, size: 12 }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel files drawer" }));
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByRole("button", { name: "Delete notes.md" }));
    await screen.findByText("Delete file?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Delete file?")).toBeNull());
    expect(fetch_mock.mock.calls.filter((c) => String(c[1]?.method || "GET") === "DELETE").length).toBe(0);
  });

  it("Members drawer opens on explicit click, fetches fresh /info on EVERY open, and names the missing charter", async () => {
    // Members served consistently with info.members (P1-4: the header
    // count derives from the LIVE members state, not the info snapshot).
    const fetch_mock = stub_hub({ members: [{ agent_id: "a" }, { agent_id: "b" }] });
    render_page();
    await screen.findAllByText("#commons");
    const info_calls = () => fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/info")).length;
    expect(info_calls()).toBe(0);
    // The Members drawer (operator dm 55) replaces the old About icon.
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("cross-package commons");
    await screen.findByText("No charter set for this channel.");
    expect(screen.getByText("2 members")).toBeTruthy();
    expect(info_calls()).toBe(1);
    // Close then reopen: FRESH fetch (operator dm 128 — the cached
    // snapshot rendered an agent who had since joined as absent; opening
    // the drawer is an explicit "show me the members NOW" act).
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("cross-package commons");
    expect(info_calls()).toBe(2);
  });

  it("delegate dropdown surfaces member agents by agent_id (operator dm 165: it was empty)", async () => {
    stub_hub({ members: [{ agent_id: "framework" }, { agent_id: "runtime" }, { agent_id: "laurent", role: "owner" }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("Hub delegation");
    // The assign dropdown lists members by agent_id (was empty when it
    // read m.id) — framework + runtime as options, the operator (laurent,
    // the signed-in seat) excluded.
    const opts = await screen.findAllByRole("option");
    const labels = opts.map((o) => o.textContent);
    expect(labels).toContain("framework");
    expect(labels).toContain("runtime");
  });

  it("does NOT render per-agent ±1 vote thumbs in the Members drawer (operator dm 164)", async () => {
    stub_hub({ members: [{ agent_id: "framework" }, { agent_id: "runtime" }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("Hub delegation");
    expect(screen.queryByTitle(/Vouch for/)).toBeNull();
    expect(screen.queryByText("you:")).toBeNull();
  });
});

describe("TeamPage moderation (operator dm 12: remove from a channel OR the hub)", () => {
  it("hub-ban is a two-step confirm that calls POST /hub/blocks", async () => {
    const fetch_mock = stub_hub({ members: [{ agent_id: "laurent", role: "owner" }, { agent_id: "spammer" }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    // The member's channel + hub moderation acts render.
    const hub_ban = await screen.findByRole("button", { name: "hub ban" });
    const hub_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/hub/blocks") && String(c[1]?.method || "GET") === "POST").length;
    // First click ARMS (no request), second CONFIRMS.
    fireEvent.click(hub_ban);
    expect(hub_calls()).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "confirm hub ban" }));
    await waitFor(() => expect(hub_calls()).toBe(1));
    const post = fetch_mock.mock.calls.find((c) => String(c[0]).includes("/hub/blocks") && String(c[1]?.method || "GET") === "POST");
    const body = JSON.parse(String(post?.[1]?.body || "{}"));
    expect(body.agent).toBe("spammer");
    expect(body.seconds).toBeUndefined(); // indefinite = ban
  });

  it("Resolve on an open root is a two-step confirm that posts status=resolved with reply_to (operator dm 21)", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [{ ...base, id: "m1", seq: 5, sender: "core", status: "open", title: "an open question", body: "please decide" }],
    });
    render_page();
    await screen.findByText("an open question");
    const resolve_calls = () =>
      fetch_mock.mock.calls.filter((c) => {
        if (!String(c[0]).includes("/messages") || String(c[1]?.method || "GET") !== "POST") return false;
        try {
          return JSON.parse(String(c[1]?.body || "{}")).status === "resolved";
        } catch {
          return false;
        }
      });
    // First Resolve click ARMS; the confirm posts.
    fireEvent.click(screen.getByRole("button", { name: "✓ Resolve" }));
    expect(resolve_calls().length).toBe(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Completion metadata JSON" }), {
      target: { value: '{"evidence":[{"kind":"store","ref":"plan:wui-audit"}]}' },
    });
    fireEvent.click(await screen.findByRole("button", { name: "✓ confirm resolve" }));
    await waitFor(() => expect(resolve_calls().length).toBe(1));
    const body = JSON.parse(String(resolve_calls()[0]?.[1]?.body || "{}"));
    expect(body.status).toBe("resolved");
    expect(body.reply_to).toBe("m1");
    expect(body.data).toEqual({ evidence: [{ kind: "store", ref: "plan:wui-audit" }] });
  });

  it("Resolve posts no discharge field and re-reads /owed instead of waiting out the badge cadence", async () => {
    // Closing the topic used to leave `/owed.to_answer` untouched: the row
    // chipped "answered" while still wearing "needs reply", because the
    // resolved reply named no ask ids and `debt_map` only re-reads on the
    // badge cadence (30s). Both halves are asserted here.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [
        { ...base, id: "m1", seq: 5, sender: "core", status: "open", title: "an open question", body: "please decide", to: ["laurent"], pending_asks: ["1"] },
      ],
      owed: { to_answer: [{ channel: "commons", seq: 5 }], to_consume: [], waiting_on: [], counts: { to_answer: 1, to_consume: 0 } },
    });
    render_page();
    await screen.findByText("an open question");
    await screen.findByText("needs reply");
    const owed_calls = () => fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/owed"));
    const before_owed = owed_calls().length;
    const resolve_calls = () =>
      fetch_mock.mock.calls.filter((c) => {
        if (!String(c[0]).includes("/messages") || String(c[1]?.method || "GET") !== "POST") return false;
        try {
          return JSON.parse(String(c[1]?.body || "{}")).status === "resolved";
        } catch {
          return false;
        }
      });
    fireEvent.click(screen.getByRole("button", { name: "✓ Resolve" }));
    fireEvent.click(await screen.findByRole("button", { name: "✓ confirm resolve" }));
    await waitFor(() => expect(resolve_calls().length).toBe(1));
    const body = JSON.parse(String(resolve_calls()[0]?.[1]?.body || "{}"));
    expect(body.status).toBe("resolved");
    // A closure carries NO discharge field. `_validate_answers` refuses a
    // reply that discharges the asks of a parent you wrote — which is the
    // most common Resolve there is — and refuses an ask addressed to
    // another seat, with no operator exemption. Resolving is not answering.
    expect(body.answers).toBeUndefined();
    expect(body.declines).toBeUndefined();
    // The pill is the HUB's verdict, so the console re-reads /owed instead
    // of dropping it: a resolve is authoritative only from the asker or an
    // operator, and guessing wrong leaves no way to put the pill back.
    await waitFor(() => expect(owed_calls().length).toBeGreaterThan(before_owed));
  });

  it("Decline is a two-step confirm posting a reply that declines the pending asks", async () => {
    // Both closure verbs live on ONE surface (operator ask 2026-08-20):
    // Decline discharges the obligation on this message, Resolve closes
    // the topic. The `needs reply` BADGE stays in the header — state, not
    // an action.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [
        { ...base, id: "m1", seq: 5, sender: "core", status: "open", title: "an open question", body: "please decide", to: ["laurent"], pending_asks: ["1", "2"] },
      ],
      owed: { to_answer: [{ channel: "commons", seq: 5 }], to_consume: [], waiting_on: [], counts: { to_answer: 1, to_consume: 0 } },
    });
    render_page();
    await screen.findByText("an open question");
    const decline_calls = () =>
      fetch_mock.mock.calls.filter((c) => {
        if (!String(c[0]).includes("/messages") || String(c[1]?.method || "GET") !== "POST") return false;
        try {
          return Array.isArray(JSON.parse(String(c[1]?.body || "{}")).answers);
        } catch {
          return false;
        }
      });
    // Two-step, same idiom as Retract/Resolve next to it.
    fireEvent.click(screen.getByRole("button", { name: "⊘ Decline" }));
    expect(decline_calls().length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "⊘ confirm decline" }));
    await waitFor(() => expect(decline_calls().length).toBe(1));
    const body = JSON.parse(String(decline_calls()[0]?.[1]?.body || "{}"));
    expect(body.status).toBe("reply");
    expect(body.reply_to).toBe("m1");
    expect(body.answers).toEqual(["1", "2"]);
  });

  it("Decline names only the asks the hub says are THIS seat's, not the message's whole pending set", async () => {
    // A root canvassing two seats carries both asks in `pending_asks`. The
    // hub refuses a discharge naming an ask addressed to someone else ("you
    // may not discharge ask ids not addressed to you") and the WHOLE
    // Decline fails with it — so re-deriving the list from the message is
    // not a cosmetic shortcut, it breaks the action. `/owed` already serves
    // the per-seat subset as `asks_naming_you`; use it.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [
        {
          ...base, id: "m1", seq: 5, sender: "core", status: "open", title: "canvass", body: "two seats",
          to: ["laurent", "continuum"], pending_asks: ["1", "2"],
          data: { asks: [{ id: "1", text: "for laurent", to: ["laurent"] }, { id: "2", text: "for continuum", to: ["continuum"] }] },
        },
      ],
      owed: {
        to_answer: [{ channel: "commons", id: "m1", seq: 5, sender: "core", asks_naming_you: ["1"], pending_asks: ["1", "2"] }],
        to_consume: [], waiting_on: [], counts: { to_answer: 1, to_consume: 0 },
      },
    });
    render_page();
    await screen.findByText("canvass");
    const decline_calls = () =>
      fetch_mock.mock.calls.filter((c) => {
        if (!String(c[0]).includes("/messages") || String(c[1]?.method || "GET") !== "POST") return false;
        try {
          return Array.isArray(JSON.parse(String(c[1]?.body || "{}")).declines);
        } catch {
          return false;
        }
      });
    fireEvent.click(await screen.findByRole("button", { name: "⊘ Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "⊘ confirm decline" }));
    await waitFor(() => expect(decline_calls().length).toBe(1));
    const body = JSON.parse(String(decline_calls()[0]?.[1]?.body || "{}"));
    // Ask 2 is continuum's. Naming it would take the whole Decline down.
    expect(body.declines).toEqual(["1"]);
    expect(body.answers).toEqual(["1"]);
  });

  it("Decline sends NO discharge field when the hub says no ask here is this seat's", async () => {
    // The hub keeps a to_answer row whenever the seat is in `to`, even when
    // every per-ask `to` names someone else — `asks_naming_you` is then an
    // explicit []. Naming the other seat's ids would 400 and take the whole
    // Decline with it; a plain reply is what clears a directive debt.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [
        {
          ...base, id: "m1", seq: 5, sender: "core", status: "open", title: "not for me", body: "q",
          to: ["laurent", "continuum"], pending_asks: ["1", "2"],
          data: { asks: [{ id: "1", text: "for continuum", to: ["continuum"] }, { id: "2", text: "also continuum", to: ["continuum"] }] },
        },
      ],
      owed: {
        to_answer: [{ channel: "commons", id: "m1", seq: 5, sender: "core", asks_naming_you: [], pending_asks: ["1", "2"] }],
        to_consume: [], waiting_on: [], counts: { to_answer: 1, to_consume: 0 },
      },
    });
    render_page();
    await screen.findByText("not for me");
    const replies = () =>
      fetch_mock.mock.calls.filter((c) => {
        if (!String(c[0]).includes("/messages") || String(c[1]?.method || "GET") !== "POST") return false;
        try {
          return JSON.parse(String(c[1]?.body || "{}")).status === "reply";
        } catch {
          return false;
        }
      });
    fireEvent.click(await screen.findByRole("button", { name: "⊘ Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "⊘ confirm decline" }));
    await waitFor(() => expect(replies().length).toBe(1));
    const body = JSON.parse(String(replies()[0]?.[1]?.body || "{}"));
    expect(body.answers).toBeUndefined();
    expect(body.declines).toBeUndefined();
    expect(body.reply_to).toBe("m1");
  });

  it("the ASKER's own fully-refused thread says so, instead of reading as settled", async () => {
    // A thread every seat declined is DISCHARGED: it stops escalating and
    // stops asking for anything, exactly like an answered one. /owed.to_close
    // is the asker's durable row, and since 0153 it names the refusers. This
    // is the only surface that tells the person who asked that nobody
    // actually answered.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    stub_hub({
      messages: [
        {
          ...base, id: "mine", seq: 7, sender: "laurent", status: "open", title: "my question", body: "q",
          pending_asks: [], data: { asks: [{ id: "1", text: "take it" }, { id: "2", text: "or review it" }] },
        },
      ],
      owed: {
        to_answer: [], to_consume: [], waiting_on: [],
        // `answered_by` is the last non-sender replier whether they answered
        // or REFUSED — verified against a live hub, which reports
        // answered_by="continuum" on a thread continuum declined. Treating a
        // populated answered_by as proof of an answer understates the row.
        to_close: [{ channel: "commons", id: "mine", seq: 7, title: "my question", answered_by: "continuum", declined_asks: ["1", "2"], declined_by: ["continuum", "core"] }],
        counts: { to_answer: 0, to_consume: 0 },
      },
    });
    render_page();
    await screen.findByText("my question");
    const chip = await screen.findByText("✗ 2 refused, none answered");
    expect(chip.getAttribute("title")).toContain("Nobody answered this.");
    expect(chip.getAttribute("title")).toContain("continuum, core");
  });

  it("an older hub serving no to_close shows the asker no refusal chip", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    stub_hub({
      messages: [
        { ...base, id: "mine", seq: 7, sender: "laurent", status: "open", title: "my question", body: "q", pending_asks: [] },
      ],
      owed: { to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } },
    });
    render_page();
    await screen.findByText("my question");
    expect(screen.queryByText(/refused/)).toBeNull();
  });

  it("a declining reply chips ✗ declines and is NOT credited as an answer (agora 0153)", async () => {
    // The hub folds `declines` INTO `answers` and keeps the refused subset,
    // so `answers` alone counts refusals as discharges — rendering it whole
    // captioned a refusal "✓ answers", the exact inversion the disposition
    // exists to prevent. The protocol's instruction to a reader that wants
    // *answered* is to subtract; this asserts the console does.
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    stub_hub({
      messages: [
        { ...base, id: "root", seq: 1, sender: "core", status: "open", title: "two asks", body: "q", data: { asks: [{ id: "1", text: "first" }, { id: "2", text: "second" }] } },
        // Answered 1, refused 2. `answers` carries BOTH — that is the hub's
        // stored shape, not a client mistake.
        { ...base, id: "r1", seq: 2, sender: "laurent", status: "reply", title: "", body: "one yes one no", reply_to: "root", data: { answers: ["1", "2"], declines: ["2"] } },
      ],
    });
    render_page();
    await screen.findByText("two asks");
    fireEvent.click(screen.getByRole("button", { name: /^Show 1 reply/ }));
    await screen.findByText("one yes one no");
    // Credited for what it answered, and only that.
    await screen.findByText("✓ answers 1");
    await screen.findByText("✗ declines 2");
    expect(screen.queryByText("✓ answers 1,2")).toBeNull();
  });

  it("an older hub serving no declines renders exactly as before (no subtraction, nothing marked)", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    stub_hub({
      messages: [
        { ...base, id: "root", seq: 1, sender: "core", status: "open", title: "one ask", body: "q", data: { asks: [{ id: "1", text: "do it" }] } },
        { ...base, id: "r1", seq: 2, sender: "laurent", status: "reply", title: "", body: "done", reply_to: "root", data: { answers: ["1"] } },
      ],
    });
    render_page();
    await screen.findByText("one ask");
    fireEvent.click(screen.getByRole("button", { name: /^Show 1 reply/ }));
    await screen.findByText("done");
    await screen.findByText("✓ answers 1");
    expect(screen.queryByText(/declines/)).toBeNull();
  });

  it("a DM row's trash is a two-step confirm that calls POST /leave (operator dm 14)", async () => {
    const now = Date.now() / 1000;
    const fetch_mock = stub_hub({
      channels: [
        { name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: now },
        { name: "dm:continuum--laurent", private: true, member: true, member_count: 2, last_seq: 3, last_at: now },
      ],
    });
    render_page();
    // The DM rail row for the peer renders.
    await screen.findByText("@continuum");
    const leave_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/leave") && String(c[1]?.method || "GET") === "POST").length;
    // First trash click ARMS (no request), the confirm click leaves.
    fireEvent.click(screen.getByRole("button", { name: "Remove direct message" }));
    expect(leave_calls()).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm remove direct message" }));
    await waitFor(() => expect(leave_calls()).toBe(1));
    const call = fetch_mock.mock.calls.find((c) => String(c[0]).includes("/leave"));
    expect(String(call?.[0])).toContain("dm%3Acontinuum--laurent");
  });

  it("a channel row's archive trash is wired + feature-detects the unshipped hub verb (operator dm 19/29)", async () => {
    const now = Date.now() / 1000;
    const fetch_mock = stub_hub({
      channels: [{ name: "playground", private: false, member: true, member_count: 4, last_seq: 8, last_at: now }],
    });
    render_page();
    await screen.findByRole("button", { name: "Archive channel" });
    const archive_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/archive") && String(c[1]?.method || "GET") === "POST");
    // First trash click ARMS, the confirm calls POST /archive.
    fireEvent.click(screen.getByRole("button", { name: "Archive channel" }));
    expect(archive_calls().length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm archive channel" }));
    await waitFor(() => expect(archive_calls().length).toBe(1));
    // The 404 (verb not shipped) surfaces the wired-and-ready notice, not a raw error.
    await screen.findByText(/ships with the next hub update/i);
  });

  it("posts an attachment-only message (no text) instead of silently no-oping (adversary P1)", async () => {
    const fetch_mock = stub_hub({});
    render_page();
    await screen.findAllByText("#commons");
    // Simulate an uploaded pending attachment by driving an upload response,
    // then a post with empty text must still hit POST /messages carrying it.
    // Directly exercise the post path: the Send button enables on a pending
    // attachment; here we assert the guard no longer refuses an empty body.
    // (The pending state is internal; we verify via the post payload shape
    // through the composer once a file is attached.)
    // Attach a file: stub the upload route to return a ref.
    const file = new File([new Uint8Array([1, 2, 3])], "note.png", { type: "image/png" });
    // The upload route is stubbed to 200 with a ref.
    (fetch_mock as any).mockImplementation(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      if (url.includes("/attachments") && String(init?.method || "GET") === "POST") {
        return new Response(JSON.stringify({ id: "sha-note", filename: "note.png", content_type: "image/png", size: 3 }), { status: 200 });
      }
      if (url.includes("/whoami")) return new Response(JSON.stringify({ id: "laurent" }), { status: 200 });
      if (url.includes("/healthz")) return new Response(JSON.stringify({ ok: true, protocol: "agora/0.3", paused: false }), { status: 200 });
      if (url.includes("/inbox")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/digest")) return new Response(JSON.stringify({ counts: {} }), { status: 200 });
      if (url.includes("/messages") && String(init?.method || "GET") === "GET") return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith("/channels")) return new Response(JSON.stringify([{ name: "commons", private: false, member: true, member_count: 2, last_seq: 1, last_at: Date.now() / 1000 }]), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    // Chip appears once uploaded.
    await screen.findByText("note.png");
    const posts = () =>
      (fetch_mock as any).mock.calls.filter((c: any) => String(c[0]).includes("/channels/commons/messages") && String(c[1]?.method || "GET") === "POST");
    // Send with NO text — must post (not silently no-op).
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(posts().length).toBe(1));
    const body = JSON.parse(String(posts()[0]?.[1]?.body || "{}"));
    expect(body.attachments).toEqual([{ id: "sha-note", filename: "note.png" }]);
  });

  it("renders a delivered image attachment inline and a non-image as a download chip (agora 0091)", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    stub_hub({
      messages: [
        {
          ...base,
          id: "ma",
          seq: 1,
          sender: "core",
          status: "fyi",
          title: "with files",
          body: "see attached",
          data: {
            attachments: [
              { id: "sha-img", filename: "diagram.png", content_type: "image/png", size: 4096 },
              { id: "sha-pdf", filename: "spec.pdf", content_type: "application/pdf", size: 20480 },
            ],
          },
        },
      ],
    });
    render_page();
    await screen.findByText("with files");
    // Image → inline <img> backed by a temporary URL after authenticated
    // direct-Hub byte fetch; no browser subresource bypasses the client.
    const img = (await screen.findByAltText("diagram.png")) as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("blob:agora-wui-test-");
    // Non-image → preview chip (button), never inline.
    const chip = await screen.findByTitle(/application\/pdf .* click to preview/);
    expect(chip.tagName).toBe("BUTTON");
    expect(screen.queryByAltText("spec.pdf")).toBeNull();
  });

  it("retire is a two-step confirm calling POST /agents/{id}/retire, feature-detected (agora 0089)", async () => {
    const fetch_mock = stub_hub({ members: [{ agent_id: "laurent", role: "owner" }, { agent_id: "decommissioned-bot" }] });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    const retire = await screen.findByRole("button", { name: "retire" });
    const retire_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/agents/decommissioned-bot/retire") && String(c[1]?.method || "GET") === "POST");
    fireEvent.click(retire);
    expect(retire_calls().length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "confirm retire" }));
    await waitFor(() => expect(retire_calls().length).toBe(1));
    // 404 (verb not shipped) → wired-and-ready notice, never a raw error.
    await screen.findByText(/ships with the next hub update/i);
  });

  it("renders a Retired-agents section with a two-step un-retire (agora 0.12.0)", async () => {
    const fetch_mock = stub_hub({
      members: [{ agent_id: "laurent", role: "owner" }],
      retired: [{ id: "oldbot", reason: "decommissioned", retired_at: 1_700_000_000 }],
    });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("oldbot");
    const unretire = await screen.findByRole("button", { name: "un-retire" });
    const unretire_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/agents/oldbot/retire") && String(c[1]?.method || "GET") === "DELETE");
    fireEvent.click(unretire);
    expect(unretire_calls().length).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "confirm un-retire" }));
    await waitFor(() => expect(unretire_calls().length).toBe(1));
  });

  it("browses the channel virtual file system (vfs) via the Files drawer — Drive-style folders (operator dm 35/53)", async () => {
    stub_hub({
      files: [{ path: "plans/x.md", version: 2, updated_by: "flow", updated_at: 1, size: 128, description: "the plan" }],
    });
    render_page();
    await screen.findAllByText("#commons");
    // The trapeze tab is the entry (dm 53: the header icon was "too discreet").
    fireEvent.click(screen.getByRole("button", { name: "Open channel files drawer" }));
    // Drive semantics: the root shows the derived FOLDER, not the flat path.
    const folder = await screen.findByText("plans");
    expect(screen.queryByText("plans/x.md")).toBeNull();
    fireEvent.click(folder);
    // Inside the folder: the file under its LEAF name + description.
    const row = await screen.findByText("x.md");
    expect(screen.getByText("the plan")).toBeTruthy();
    // Click → fs_read → viewer renders the markdown (heading text present).
    fireEvent.click(row);
    await screen.findByText("Plan"); // md h1 rendered by the kit
    expect(screen.getByText("world")).toBeTruthy(); // bold span rendered
  });

  it("previews a markdown attachment inline instead of only downloading (operator dm 35)", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, reply_to: null };
    const fetch_mock = stub_hub({
      messages: [
        {
          ...base,
          id: "md1",
          seq: 1,
          sender: "core",
          status: "fyi",
          title: "doc",
          body: "see the notes",
          data: { attachments: [{ id: "sha-notes", filename: "notes.md", content_type: "text/markdown", size: 40 }] },
        },
      ],
    });
    // The attachment fetch (for md preview) returns markdown text.
    (fetch_mock as any).mockImplementation(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      if (url.includes("/attachments/sha-notes")) return new Response("## Notes\n\ninline **preview** works", { status: 200, headers: { "Content-Type": "text/markdown" } });
      if (url.includes("/whoami")) return new Response(JSON.stringify({ id: "laurent" }), { status: 200 });
      if (url.includes("/healthz")) return new Response(JSON.stringify({ ok: true, protocol: "agora/0.3", paused: false }), { status: 200 });
      if (url.includes("/inbox")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/digest")) return new Response(JSON.stringify({ counts: {} }), { status: 200 });
      if (url.includes("/messages") && String(init?.method || "GET") === "GET")
        return new Response(JSON.stringify([{ ...base, id: "md1", seq: 1, sender: "core", status: "fyi", title: "doc", body: "see the notes", data: { attachments: [{ id: "sha-notes", filename: "notes.md", content_type: "text/markdown", size: 40 }] } }]), { status: 200 });
      if (url.endsWith("/channels")) return new Response(JSON.stringify([{ name: "commons", private: false, member: true, member_count: 2, last_seq: 1, last_at: Date.now() / 1000 }]), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render_page();
    // The md attachment renders as a clickable chip (not an inline img).
    const chip = await screen.findByTitle(/text\/markdown .* click to preview/);
    fireEvent.click(chip);
    await screen.findByText("Notes"); // md h2 rendered in the viewer
    expect(screen.getByText("preview")).toBeTruthy();
  });

  it("renders a Blocked section with a scope-aware unblock for a hub-wide block", async () => {
    stub_hub({
      members: [{ agent_id: "laurent", role: "owner" }],
      blocks: [{ agent_id: "spammer", scope: "hub", reason: "abuse", expires_at: null }],
    });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("hub-wide · indefinite");
    expect(screen.getByRole("button", { name: "unblock" })).toBeTruthy();
  });

  it("opens from cached last_seq without waiting for a slow /channels refresh", async () => {
    const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
    const now = Date.now() / 1000;
    let channel_calls = 0;
    let resolve_slow_channels: ((value: Response) => void) | null = null;
    const fetch_mock = vi.fn(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      if (url.includes("/whoami")) {
        return new Response(JSON.stringify({ id: "laurent" }), { status: 200 });
      }
      if (url.includes("/healthz")) {
        return new Response(JSON.stringify({ ok: true, version: "0.10.0", protocol: "agora/0.3", paused: false }), { status: 200 });
      }
      if (url.includes("/inbox")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/owed")) {
        return new Response(JSON.stringify({ to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
      }
      if (url.includes("/digest")) {
        return new Response(JSON.stringify({ channel: "commons", counts: { open_questions: 0 } }), { status: 200 });
      }
      if (url.includes("/channels/commons/messages") && String(init?.method || "GET") === "GET") {
        return new Response(JSON.stringify([{ ...base, id: "m1", seq: 399, sender: "agora", status: "fyi", body: "fast row" }]), { status: 200 });
      }
      if (url.endsWith("/channels")) {
        channel_calls += 1;
        if (channel_calls === 1) {
          return new Response(JSON.stringify([{ name: "commons", private: false, member: true, member_count: 2, last_seq: 400, last_at: now }]), { status: 200 });
        }
        return await new Promise<Response>((resolve) => {
          resolve_slow_channels = resolve;
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch_mock);
    render_page();
    await screen.findByText("fast row");
    await waitFor(() => expect(screen.queryByText("loading…")).toBeNull());
    expect(channel_calls).toBeGreaterThanOrEqual(2);
    expect(resolve_slow_channels).not.toBeNull();
    (resolve_slow_channels as ((response: Response) => void) | null)?.(new Response(JSON.stringify([{ name: "commons", private: false, member: true, member_count: 2, last_seq: 400, last_at: now }]), { status: 200 }));
  });
});

describe("TeamPage threading + filters (2026-07-14 redesign)", () => {
  const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null };

  it("uses the Hub's viewer-scoped to_me verdict for debt and @me routing", async () => {
    stub_hub({
      messages: [
        { ...base, id: "other-debt", seq: 1, sender: "core", status: "open", title: "for someone else", body: "x", to: ["other"], reply_to: null },
        { ...base, id: "delegate-debt", seq: 2, sender: "laurent", status: "open", title: "delegated to this seat", body: "y", to: [], reply_to: null },
      ],
      inbox: [
        { channel: "commons", seq: 1, status: "open", addressed: true, to_me: false },
        { channel: "commons", seq: 2, status: "open", addressed: false, to_me: true },
      ],
      // Debt is the HUB's verdict (/owed.to_answer), not a shape the client
      // re-derives from the envelope.
      owed: { to_answer: [{ channel: "commons", seq: 2 }], to_consume: [], waiting_on: [], counts: { to_answer: 1, to_consume: 0 } },
    });
    render_page();
    await screen.findByText("delegated to this seat");
    await screen.findByText("needs reply");
    expect(screen.getAllByText("needs reply")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^@me/ }));
    await screen.findByText("delegated to this seat");
    expect(screen.queryByText("for someone else")).toBeNull();
  });

  it("never invents a debt the Hub does not hold — a peer's reply to your own message is not 'needs reply'", async () => {
    // Live case (dm:continuum--laurent#209): a peer replied to laurent's
    // own ask, addressed to laurent. The hub exempts it ("your debt for an
    // answer is CONSUMPTION, not another reply") and leaves it out of
    // /owed.to_answer — but a client-side `status=reply && to_me` rule
    // cannot see the exemption and painted NEEDS REPLY on it.
    stub_hub({
      messages: [
        { ...base, id: "my-ask", seq: 175, sender: "laurent", status: "open", title: "my question", body: "q", to: ["continuum"], reply_to: null },
        { ...base, id: "their-answer", seq: 209, sender: "continuum", status: "reply", title: "investigation reopened", body: "a", to: ["laurent"], reply_to: "my-ask" },
      ],
      inbox: [{ channel: "commons", seq: 209, sender: "continuum", status: "reply", addressed: true, to_me: true }],
      owed: { to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } },
    });
    render_page();
    await screen.findByText("my question");
    fireEvent.click(screen.getByRole("button", { name: /^Show 1 reply/ }));
    await screen.findByText("investigation reopened");
    expect(screen.queryByText("needs reply")).toBeNull();
    expect(screen.queryByRole("button", { name: "⊘ Decline" })).toBeNull();
  });

  it("takes discharge from the Hub, not from replies visible in the window", async () => {
    // The Hub computes discharge with operator/delegate authority: a
    // bystander's "on it" does not settle an operator's commission. The old
    // local fold ("any other sender replied ⇒ answered") contradicted it on
    // 30 live messages, painting escalating asks as handled.
    stub_hub({
      messages: [
        { ...base, id: "cmd", seq: 1, sender: "laurent", status: "open", title: "five requirements", body: "do it", reply_to: null, has_resolved_reply: false },
        { ...base, id: "ack", seq: 2, sender: "core", status: "reply", title: "on it", body: "starting", reply_to: "cmd" },
      ],
    });
    render_page();
    await screen.findByText("five requirements");
    // The Hub says NOT resolved, so no answered chip — regardless of the reply.
    expect(screen.queryByText("answered")).toBeNull();
  });

  it("still calms an ask when the Hub makes no statement (older hub)", async () => {
    stub_hub({
      messages: [
        { ...base, id: "old", seq: 1, sender: "core", status: "open", title: "legacy ask", body: "q", reply_to: null, has_resolved_reply: null },
        { ...base, id: "oldr", seq: 2, sender: "gateway", status: "reply", title: "an answer", body: "a", reply_to: "old" },
      ],
    });
    render_page();
    await screen.findByText("legacy ask");
    await screen.findByText("answered");
  });

  it("groups replies under their root and counts threads, not messages", async () => {
    stub_hub({
      messages: [
        { ...base, id: "m1", seq: 1, sender: "core", status: "open", title: "root ask", body: "a", reply_to: null },
        { ...base, id: "m2", seq: 2, sender: "gateway", status: "reply", title: "the answer", body: "b", reply_to: "m1" },
        { ...base, id: "m3", seq: 3, sender: "uic", status: "fyi", title: "separate", body: "c", reply_to: null },
      ],
    });
    render_page();
    await screen.findByText("root ask");
    // 3 messages → 2 threads (the reply folded under its root).
    await screen.findByText(/2 threads/); // live-dot span shares the meta element
    // Threads open FOLDED: the reply lives behind its root's fold bar.
    expect(screen.queryByText("the answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 reply to: root ask" }));
    expect(screen.getByText("the answer")).toBeTruthy();
  });

  it("folds the REPLIES only — the root stays the card's headline, never repeated above it", async () => {
    stub_hub({
      messages: [
        { ...base, id: "fold-root", seq: 1, sender: "core", status: "open", title: "parent topic", body: "root body", reply_to: null },
        { ...base, id: "fold-reply", seq: 2, sender: "gateway", status: "reply", title: "child topic", body: "reply body", reply_to: "fold-root" },
      ],
    });
    render_page();
    await screen.findByText("parent topic");
    // DEFAULT IS FOLDED: a channel opens as a scannable list of roots.
    // The root's title/body appear exactly ONCE — the old card header
    // repeated the same sentence directly above the root row.
    expect(screen.getAllByText("parent topic")).toHaveLength(1);
    expect(screen.getAllByText("root body")).toHaveLength(1);
    expect(screen.queryByText("child topic")).toBeNull();
    expect(screen.queryByText("reply body")).toBeNull();
    const collapsed = screen.getByRole("button", { name: "Show 1 reply to: parent topic" });
    // Visible label is the chat icon + count; the full sentence is the
    // accessible name, so screen readers still get "Show 1 reply to: …".
    expect(collapsed.textContent).toContain("1");
    expect(collapsed.querySelector("svg")).toBeTruthy();
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
    expect(collapsed.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(collapsed);
    await screen.findByText("child topic");
    expect(screen.getByText("reply body")).toBeTruthy();
    // Folding again hides the replies and leaves the ROOT untouched.
    const open_control = screen.getByRole("button", { name: "Hide 1 reply to: parent topic" });
    expect(open_control.getAttribute("aria-controls")).toBe("thread-fold-root");
    fireEvent.click(open_control);
    expect(screen.queryByText("child topic")).toBeNull();
    expect(screen.getByText("parent topic")).toBeTruthy();
    expect(screen.getByText("root body")).toBeTruthy();
  });

  it("opens a channel with every thread folded — roots only, replies behind their bars", async () => {
    stub_hub({
      messages: [
        { ...base, id: "a", seq: 1, sender: "core", status: "open", title: "topic A", body: "body A", reply_to: null },
        { ...base, id: "a1", seq: 2, sender: "gateway", status: "reply", title: "reply A1", body: "trail A1", reply_to: "a" },
        { ...base, id: "b", seq: 3, sender: "uic", status: "fyi", title: "topic B", body: "body B", reply_to: null },
        { ...base, id: "b1", seq: 4, sender: "core", status: "reply", title: "reply B1", body: "trail B1", reply_to: "b" },
      ],
    });
    render_page();
    await screen.findByText("topic A");
    // Every ROOT is readable; no trail is.
    expect(screen.getByText("topic B")).toBeTruthy();
    expect(screen.queryByText("reply A1")).toBeNull();
    expect(screen.queryByText("reply B1")).toBeNull();
    expect(document.querySelectorAll(".team_replies")).toHaveLength(0);
    expect(document.querySelectorAll(".team_fold_group")).toHaveLength(2);
    // Opening one trail leaves the other folded.
    fireEvent.click(screen.getByRole("button", { name: "Show 1 reply to: topic A" }));
    await screen.findByText("reply A1");
    expect(screen.queryByText("reply B1")).toBeNull();
  });

  it("keeps matching messages visible under a filter instead of folding them", async () => {
    stub_hub({
      messages: [
        { ...base, id: "f", seq: 1, sender: "core", status: "fyi", title: "quiet root", body: "root", reply_to: null },
        { ...base, id: "f1", seq: 2, sender: "gateway", status: "open", title: "the open reply", body: "trail", reply_to: "f" },
      ],
    });
    render_page();
    await screen.findByText("quiet root");
    expect(screen.queryByText("the open reply")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Asks/ }));
    // A filter is a request to SEE matches — the trail must not stay folded.
    await screen.findByText("the open reply");
  });

  it("never paints the viewer's own message as unread, in the row or the counts", async () => {
    // The hub pins an open broadcast obligation to every member — its
    // AUTHOR included. That envelope is not "unread" for the author.
    stub_hub({
      messages: [
        { ...base, id: "mine", seq: 175, sender: "laurent", status: "open", title: "Iterate and improve code-tui", body: "run REALISTIC scenario", reply_to: null },
        { ...base, id: "theirs", seq: 176, sender: "code-tui", status: "reply", title: "on it", body: "starting now", reply_to: "mine" },
      ],
      inbox: [
        { channel: "commons", seq: 175, sender: "laurent", status: "open", addressed: false, to_me: false },
        { channel: "commons", seq: 176, sender: "code-tui", status: "reply", addressed: false, to_me: false },
      ],
    });
    render_page();
    await screen.findByText("Iterate and improve code-tui");
    // The author's own root carries no unread accent...
    await waitFor(() => expect(screen.getByRole("button", { name: /^Unread/ }).textContent).toContain("1"));
    const own_row = document.getElementById("hubmsg-mine");
    expect(own_row?.className).toContain("own");
    expect(own_row?.className).not.toContain("unread");
    // ...and the counts agree on the one real unread message, never two.
    expect(screen.getByLabelText("1 unread reply in this loaded view")).toBeTruthy();
    // Opening the trail: the peer's reply IS unread.
    fireEvent.click(screen.getByRole("button", { name: /^Show 1 reply/ }));
    await screen.findByText("starting now");
    expect(document.getElementById("hubmsg-theirs")?.className).toContain("unread");
  });

  it("splits the rail into a channels pane and a direct-messages pane that scroll separately", async () => {
    stub_hub({
      channels: [
        { name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: 3 },
        { name: "optimize-code", private: false, member: true, member_count: 6, last_seq: 8, last_at: 2 },
        { name: "dm:code-tui--laurent", private: true, member: true, member_count: 2, last_seq: 4, last_at: 1 },
      ],
    });
    render_page();
    await screen.findAllByText("#commons");
    const rooms = document.querySelector(".team_channels_pane")!;
    const dms = document.querySelector(".team_dms_pane")!;
    expect(rooms).toBeTruthy();
    expect(dms).toBeTruthy();
    // Each pane owns its own scroll container, so a long room list can
    // never push direct messages below the fold.
    expect(rooms.querySelector(".pane_body")).toBeTruthy();
    expect(dms.querySelector(".pane_body")).toBeTruthy();
    // Rooms live in the rooms pane, DMs in the DM pane — never mixed.
    expect(rooms.textContent).toContain("#optimize-code");
    expect(rooms.textContent).not.toContain("@code-tui");
    expect(dms.textContent).toContain("@code-tui");
    expect(dms.textContent).not.toContain("#optimize-code");
  });

  it("shows no direct-messages pane when the seat has no DMs", async () => {
    stub_hub({
      channels: [{ name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: 3 }],
    });
    render_page();
    await screen.findAllByText("#commons");
    expect(document.querySelector(".team_dms_pane")).toBeNull();
    expect(document.querySelector(".team_channels_pane")).toBeTruthy();
  });

  it("folds and unfolds when the card's header line is clicked", async () => {
    stub_hub({
      messages: [
        { ...base, id: "hdr-root", seq: 1, sender: "core", status: "open", title: "header topic", body: "root body", reply_to: null },
        { ...base, id: "hdr-reply", seq: 2, sender: "gateway", status: "reply", title: "child topic", body: "reply body", reply_to: "hdr-root" },
      ],
    });
    render_page();
    await screen.findByText("header topic");
    const head = document.querySelector(".team_row_head.foldable")!;
    expect(head).toBeTruthy();
    expect(screen.queryByText("child topic")).toBeNull();
    fireEvent.click(head);
    await screen.findByText("child topic");
    fireEvent.click(head);
    expect(screen.queryByText("child topic")).toBeNull();
  });

  it("does not fold when a control inside the header is clicked", async () => {
    stub_hub({
      messages: [
        { ...base, id: "btn-root", seq: 1, sender: "core", status: "open", title: "button topic", body: "root body", reply_to: null },
        { ...base, id: "btn-reply", seq: 2, sender: "gateway", status: "reply", title: "child topic", body: "reply body", reply_to: "btn-root" },
      ],
    });
    render_page();
    await screen.findByText("button topic");
    // Open via the real control, then click it again: one toggle per click,
    // never two (the header handler must not double-fire through it).
    const toggle = screen.getByRole("button", { name: /^Show 1 reply/ });
    fireEvent.click(toggle);
    await screen.findByText("child topic");
    fireEvent.click(screen.getByRole("button", { name: /^Hide 1 reply/ }));
    expect(screen.queryByText("child topic")).toBeNull();
  });

  it("gives a reply-less root no fold bar at all", async () => {
    stub_hub({
      messages: [{ ...base, id: "solo", seq: 1, sender: "core", status: "fyi", title: "standalone", body: "no replies", reply_to: null }],
    });
    render_page();
    await screen.findByText("standalone");
    // No trail, no marker: a reply-less root carries no fold control.
    expect(document.querySelector(".team_fold_group")).toBeNull();
    expect(document.querySelector(".team_row_head.foldable")).toBeNull();
  });

  it("renders separate thread cards with only Hub-derived header badges", async () => {
    stub_hub({
      messages: [
        { ...base, id: "card-root", seq: 1, sender: "core", status: "open", title: "needs a decision", body: "root", pending_asks: ["1"], read: false, reply_to: null },
        { ...base, id: "card-reply", seq: 2, sender: "gateway", status: "reply", title: "answer", body: "reply", pending_asks: ["2", "3"], read: false, reply_to: "card-root" },
        { ...base, id: "card-other", seq: 3, sender: "uic", status: "fyi", title: "separate unit", body: "other", reply_to: null },
      ],
      inbox: [{ channel: "commons", seq: 2, status: "reply", addressed: false, to_me: false }],
    });
    render_page();
    await screen.findByText("needs a decision");
    expect(document.querySelectorAll("article.team_thread_card")).toHaveLength(2);
    // Bar counts are REPLY-scoped — they summarize exactly what the fold
    // hides. The root's own pending ask shows on the root row, so the
    // question count here is the reply's two, not the thread's three.
    expect(screen.getByRole("button", { name: "Show 1 reply to: needs a decision" })).toBeTruthy();
    expect(screen.getByLabelText("1 unread reply in this loaded view")).toBeTruthy();
    expect(screen.getByLabelText("2 pending questions in the replies")).toBeTruthy();
    expect(screen.getByTitle("1 unread reply in this loaded view")).toBeTruthy();
    expect(screen.queryByText("missed?")).toBeNull();
    expect(document.querySelector(".team_chip_new")).toBeNull();
  });

  it("keeps message actions in the keyboard-reachable bottom-right rail", async () => {
    stub_hub({
      messages: [{ ...base, id: "rail-root", seq: 1, sender: "core", status: "open", title: "actionable", body: "actionable", reply_to: null, ratings: { up: 0, down: 0, mine: 0 } }],
    });
    render_page();
    await screen.findByText("actionable");
    const rail = document.querySelector(".team_row_rail");
    expect(rail).toBeTruthy();
    expect(screen.getByRole("button", { name: "+1 this message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "−1 this message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "↩ Reply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Speak message" })).toBeNull();
  });

  it("keeps copy local and delegates speech only to an explicit host capability", async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    const speak = vi.fn(async () => undefined);
    stub_hub({
      messages: [{ ...base, id: "speak-root", seq: 1, sender: "core", status: "fyi", title: "Speech title", body: "Speech body", reply_to: null }],
    });
    render_page({ on_speak_message: speak });
    await screen.findByText("Speech title");

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("Speech title\n\nSpeech body"));
    expect(screen.getByRole("button", { name: "Copied message" })).toBeTruthy();
    expect(screen.queryByText("Copied message #1.")).toBeNull();
    expect(document.querySelector(".team_statusstrip")?.textContent ?? "").not.toContain("Copied message");

    fireEvent.click(screen.getByRole("button", { name: "Speak message" }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    const [message, signal] = speak.mock.calls[0] as unknown as [Record<string, unknown>, AbortSignal];
    expect(message).toEqual({ id: "speak-root", channel: "commons", seq: 1, sender: "core", title: "Speech title", body: "Speech body" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("renders peer Markdown links and images without browser network elements", async () => {
    stub_hub({
      messages: [{ ...base, id: "inert-markdown", seq: 1, sender: "core", status: "fyi", title: "untrusted markup", body: "![tracker](https://evil.example/pixel.png) and [guide](https://evil.example/guide)", reply_to: null }],
    });
    render_page();
    await screen.findByText("untrusted markup");
    const body = document.querySelector("#hubmsg-inert-markdown .team_row_body");
    expect(body?.querySelector("img")).toBeNull();
    expect(body?.querySelector("a")).toBeNull();
    expect(body?.textContent).toContain("link disabled");
  });

  it("puts the writing field before the delivery controls in the two-band composer", async () => {
    stub_hub();
    render_page();
    await screen.findAllByText("#commons");
    const composer = document.querySelector(".team_compose_row");
    expect(composer?.firstElementChild?.classList.contains("team_compose_text")).toBe(true);
    expect(composer?.querySelector(".team_compose_actions .team_attach_btn")).toBeTruthy();
    expect(composer?.querySelector(".team_send")).toBeTruthy();
    const text = composer?.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: "x".repeat(20_000) } });
    expect(text.style.height).toBe("");
  });

  it("emits native Markdown lists under the message text", async () => {
    stub_hub({
      messages: [{ ...base, id: "list-root", seq: 1, sender: "core", status: "fyi", title: "list alignment", body: "Context.\n\n- first item\n- second item", reply_to: null }],
    });
    render_page();
    await screen.findByText("list alignment");
    expect(document.querySelector("#hubmsg-list-root .team_row_body ul > li")).toBeTruthy();
  });

  it("renders every loaded reply when a thread is open", async () => {
    stub_hub({
      messages: [
        { ...base, id: "root", seq: 1, sender: "core", status: "open", title: "topic", body: "root", reply_to: null },
        { ...base, id: "r1", seq: 2, sender: "a", status: "reply", title: "first", body: "first", reply_to: "root" },
        { ...base, id: "r2", seq: 3, sender: "b", status: "reply", title: "second", body: "second", reply_to: "root" },
        { ...base, id: "r3", seq: 4, sender: "c", status: "reply", title: "third", body: "third", reply_to: "root" },
        { ...base, id: "r4", seq: 5, sender: "d", status: "reply", title: "fourth", body: "fourth", reply_to: "root" },
      ],
    });
    render_page();
    await screen.findByText("topic");
    fireEvent.click(screen.getByRole("button", { name: "Show 4 replies to: topic" }));
    await screen.findByText("first");
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.getByText("third")).toBeTruthy();
    expect(screen.getByText("fourth")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show 2 earlier replies" })).toBeNull();
  });

  it("does not hide long message content behind a second disclosure", async () => {
    stub_hub({
      messages: [{ ...base, id: "long-root", seq: 1, sender: "core", status: "open", title: "long root", body: "x".repeat(600), reply_to: null }],
    });
    render_page();
    await screen.findByText("x".repeat(600));
    expect(screen.queryByRole("button", { name: "Show the full message" })).toBeNull();
  });

  it("filters by category at thread level (Asks keeps the trail; FYI hides it)", async () => {
    stub_hub({
      messages: [
        { ...base, id: "m1", seq: 1, sender: "core", status: "open", title: "the ask", body: "a", reply_to: null },
        { ...base, id: "m2", seq: 2, sender: "uic", status: "fyi", title: "the fyi", body: "b", reply_to: null },
      ],
    });
    render_page();
    await screen.findByText("the ask");
    fireEvent.click(screen.getByRole("button", { name: /^Asks/ }));
    await waitFor(() => expect(screen.queryByText("the fyi")).toBeNull());
    expect(screen.getByText("the ask")).toBeTruthy();
    // Name is a prefix match: tabs carry live counts now (dm 90), so the
    // accessible name may be "FYI 2".
    fireEvent.click(screen.getByRole("button", { name: /^FYI/ }));
    await screen.findByText("the fyi");
    expect(screen.queryByText("the ask")).toBeNull();
  });

  it("renders channel badges from the inbox and digest counts", async () => {
    stub_hub({
      inbox: [
        { channel: "commons", seq: 8 },
        { channel: "commons", seq: 9 },
        { channel: "commons", seq: 10 },
      ],
      digest_counts: { commons: 2 },
    });
    render_page();
    await screen.findByText("3"); // unread badge (numbers only, color codes the kind)
    await screen.findByText("2"); // open-questions badge (numbers only)
  });

  it("coalesces badge refreshes while one inbox/digest pass is still in flight", async () => {
    let release_first_inbox: ((value: Response) => void) | null = null;
    const inbox_calls = () =>
      fetch_mock.mock.calls.filter(([u]: any[]) => {
        const url = String(u);
        return url.includes("/inbox") && !url.includes("/inbox/ack");
      });
    const fetch_mock = vi.fn(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      if (url.includes("/whoami")) {
        return new Response(JSON.stringify({ id: "laurent" }), { status: 200 });
      }
      if (url.includes("/healthz")) {
        return new Response(JSON.stringify({ ok: true, version: "0.10.0", protocol: "agora/0.3", paused: false }), { status: 200 });
      }
      if (url.includes("/owed")) {
        return new Response(JSON.stringify({ to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
      }
      if (url.includes("/inbox")) {
        if (!release_first_inbox) {
          return await new Promise<Response>((resolve) => {
            release_first_inbox = resolve;
          });
        }
        return new Response(JSON.stringify([{ channel: "commons", seq: 9 }]), { status: 200 });
      }
      if (url.includes("/digest")) {
        return new Response(JSON.stringify({ channel: "commons", counts: { open_questions: 1 } }), { status: 200 });
      }
      if (url.includes("/channels") && url.includes("/messages/") && String(init?.method || "GET") === "GET") {
        return new Response(JSON.stringify([{ id: "m1", channel: "commons", seq: 1, sender: "agora", kind: "message", status: "fyi", body: "read me", created_at: 1 }]), { status: 200 });
      }
      if (url.includes("/inbox/ack")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/channels") && url.includes("/messages") && String(init?.method || "GET") === "GET") {
        return new Response(JSON.stringify([{ id: "m1", channel: "commons", seq: 1, sender: "agora", kind: "message", status: "fyi", body: "read me", created_at: 1 }]), { status: 200 });
      }
      if (url.endsWith("/channels")) {
        return new Response(JSON.stringify([{ name: "commons", private: false, member: true, member_count: 14, last_seq: 10, last_at: 1 }]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch_mock);

    render_page();
    await screen.findByText("read me");
    await waitFor(() => {
      expect(inbox_calls()).toHaveLength(1);
    });

    // Run the trailing read refresh deterministically. The first inbox
    // sweep is deliberately held open, so this refresh must QUEUE rather
    // than start a concurrent second request.
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("read me"));
    await vi.advanceTimersByTimeAsync(500);
    expect(inbox_calls()).toHaveLength(1);
    vi.useRealTimers();

    (release_first_inbox as ((response: Response) => void) | null)?.(new Response(JSON.stringify([{ channel: "commons", seq: 8 }]), { status: 200 }));
    await waitFor(() => {
      expect(inbox_calls()).toHaveLength(2);
    });
  });
});

describe("TeamPage reply + read affordances (adversary fold)", () => {
  const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null };

  it("Reply posts status=reply with reply_to and discharges checked asks", async () => {
    const fetch_mock = stub_hub({
      messages: [
        {
          ...base,
          id: "m1",
          seq: 1,
          sender: "core",
          status: "open",
          title: "the ask",
          body: "please confirm",
          reply_to: null,
          data: { asks: [{ id: "1", text: "confirm the cap?" }] },
        },
      ],
    });
    render_page();
    await screen.findByText("the ask");

    fireEvent.click(screen.getByRole("button", { name: "↩ Reply" }));
    await screen.findByText(/↩ #1 \(core\)/);
    // Single-ask parents DEFAULT to discharging their ask (usability
    // fold: an unchecked default made the likely outcome a mechanically
    // void reply).
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    const composer = screen.getByPlaceholderText(/Reply to #1/);
    fireEvent.change(composer, { target: { value: "confirmed, 24k" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => {
      const posts = fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/messages") && String(c[1]?.method || "GET") === "POST");
      expect(posts).toHaveLength(1);
      const body = JSON.parse(String(posts[0][1]?.body || "{}"));
      expect(body.status).toBe("reply");
      expect(body.reply_to).toBe("m1");
      expect(body.answers).toEqual(["1"]);
      expect(body.body).toBe("confirmed, 24k");
    });
  });

  it("refuses unknown slash commands instead of posting them publicly", async () => {
    const fetch_mock = stub_hub({
      messages: [{ ...base, id: "m1", seq: 1, sender: "core", status: "fyi", title: "t", body: "x", reply_to: null }],
    });
    render_page();
    await screen.findByText(/as laurent/);
    const composer = screen.getByPlaceholderText(/Message #commons/);
    fireEvent.change(composer, { target: { value: "/deploy now" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Unknown command "\/deploy"/);
    const posts = fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/messages") && String(c[1]?.method || "GET") === "POST");
    expect(posts).toHaveLength(0);
  });

  it("clicking a SHORT critical message records the read (read_message fires without an expand affordance)", async () => {
    const fetch_mock = stub_hub({
      messages: [{ ...base, id: "mcrit", seq: 1, sender: "core", status: "fyi", critical: true, title: "short critical", body: "act now", reply_to: null }],
    });
    render_page();
    const row = await screen.findByText("short critical");
    const read_calls = () => fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/messages/mcrit")).length;
    expect(read_calls()).toBe(0);
    fireEvent.click(row);
    await waitFor(() => expect(read_calls()).toBe(1));
    // Once per mount — a second click never re-fires.
    fireEvent.click(row);
    expect(read_calls()).toBe(1);
  });

  it("reading a message advances the cursor so the unread clears (operator dm 27)", async () => {
    const fetch_mock = stub_hub({
      messages: [{ ...base, id: "m9", seq: 9, sender: "core", status: "fyi", title: "a plain message", body: "hi", reply_to: null }],
    });
    render_page();
    const row = await screen.findByText("a plain message");
    const ack_calls = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/inbox/ack") && String(c[1]?.method || "GET") === "POST");
    // Rendering alone must NOT ack (c1696) — only the explicit click does.
    expect(ack_calls().length).toBe(0);
    fireEvent.click(row);
    await waitFor(() => expect(ack_calls().length).toBeGreaterThan(0));
    const body = JSON.parse(String(ack_calls()[0]?.[1]?.body || "{}"));
    expect(body.cursors?.commons).toBe(9);
  });
});

describe("TeamPage AI lanes (read-only contract)", () => {
  it("/assistant in the composer routes to the channel analyst and never posts to the room", async () => {
    const fetch_mock = stub_hub({
      messages: [{ channel: "commons", kind: "message", id: "m1", seq: 1, sender: "core", status: "fyi", title: "t", body: "hello", reply_to: null, created_at: 1, data: null }],
    });
    const advisor = make_advisor("analysis: all quiet");
    render(<TeamPage advisor={advisor} />);
    await screen.findByText(/as laurent/);

    const composer = screen.getByPlaceholderText(/Message #commons/);
    fireEvent.change(composer, { target: { value: "/assistant what happened here?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("analysis: all quiet");
    // The advisor ran; the hub post route never fired.
    expect(advisor).toHaveBeenCalledTimes(1);
    const posts = fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/messages") && String(c[1]?.method || "GET") === "POST");
    expect(posts).toHaveLength(0);
    // The question rode the channel transcript context.
    const q = String((advisor.mock.calls as unknown as Array<[string, unknown[]]>)[0]?.[0] || "");
    expect(q).toContain("what happened here?");
    expect(q).toContain("CHANNEL TRANSCRIPT");
  });

  it("thread AI summary calls the injected advisor and renders the reply inline", async () => {
    stub_hub({
      messages: [
        { channel: "commons", kind: "message", id: "m1", seq: 1, sender: "core", status: "open", title: "r", body: "x", reply_to: null, created_at: 1, data: null },
        { channel: "commons", kind: "message", id: "m2", seq: 2, sender: "uic", status: "reply", title: "a", body: "y", reply_to: "m1", created_at: 2, data: null },
      ],
    });
    const advisor = make_advisor("- decided: everything");
    render(<TeamPage advisor={advisor} />);
    await screen.findByText("r");
    fireEvent.click(screen.getByRole("button", { name: /Summarize/ }));
    await screen.findByText("decided: everything");
    expect(advisor).toHaveBeenCalledTimes(1);
  });

  it("hides AI affordances when no host advisor is provided", async () => {
    stub_hub({
      messages: [
        { channel: "commons", kind: "message", id: "m1", seq: 1, sender: "core", status: "open", title: "r", body: "x", reply_to: null, created_at: 1, data: null },
        { channel: "commons", kind: "message", id: "m2", seq: 2, sender: "uic", status: "reply", title: "a", body: "y", reply_to: "m1", created_at: 2, data: null },
      ],
    });
    render(<TeamPage />);
    await screen.findByText("r");
    expect(screen.queryByRole("button", { name: /Summarize/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
  });

  it("uses an injected advisor without a gateway client", async () => {
    stub_hub({
      messages: [
        { channel: "commons", kind: "message", id: "m1", seq: 1, sender: "core", status: "open", title: "r", body: "x", reply_to: null, created_at: 1, data: null },
        { channel: "commons", kind: "message", id: "m2", seq: 2, sender: "uic", status: "reply", title: "a", body: "y", reply_to: "m1", created_at: 2, data: null },
      ],
    });
    const advisor = vi.fn(async () => "- injected summary");
    render(<TeamPage advisor={advisor} />);
    await screen.findByText("r");
    fireEvent.click(screen.getByRole("button", { name: /Summarize/ }));
    await screen.findByText("injected summary");
    expect(advisor).toHaveBeenCalledTimes(1);
  });
});

describe("charters, missions and phases (agora 0146/0140; hub 0.17 wire contract)", () => {
  it("a gated room's charter debt is a chip whose click READS the charter and re-asks the hub", async () => {
    // `channel:meta.norms_required` makes the hub refuse this seat's posts
    // (409) until it has read the room's current charter. The read IS the
    // receipt, so the console's whole job is to make the read one click —
    // and then to ask the hub whether the debt cleared rather than
    // assuming a receipt it cannot mint.
    const fetch_mock = stub_hub({
      owed: {
        to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 },
        charters: [{ scope: "commons", version: 3, your_receipt: 1, gated: true, read_with: "read_charter(channel='commons')" }],
      },
    });
    render_page();
    const chip = await screen.findByRole("button", { name: "#commons charter unread — posting gated" });
    expect(chip.getAttribute("title")).toContain("REFUSES your posts here until you read it");
    const charter_reads = () =>
      fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/channels/commons/fs/channel/charter.md")).length;
    const owed_calls = () => fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/owed")).length;
    const before_owed = owed_calls();
    fireEvent.click(chip);
    await waitFor(() => expect(charter_reads()).toBe(1));
    await waitFor(() => expect(owed_calls()).toBeGreaterThan(before_owed));
  });

  it("the hub-scope debt reads GET /charter and says which sections it was not served", async () => {
    // The hub charter is served as this seat's VIEW — a token economy, not
    // an access boundary. A reader must never have to wonder whether they
    // were shown all of it, so the omission and the way out of it are
    // stated in the document the console renders.
    const fetch_mock = stub_hub({
      owed: {
        to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 },
        charters: [{ scope: "hub", version: 5, your_receipt: null, read_with: "read_charter() / GET /charter" }],
      },
      charter: {
        version: 5, scope: "hub", text: "# Hub charter\n\nWho is who.", view: ["member"], sliced: true,
        omitted: ["Owner", "Delegate"], read_all_with: "read_charter(full=True) / GET /charter?full=true",
        updated_by: "laurent", packaged: false,
      },
    });
    render_page();
    const chip = await screen.findByRole("button", { name: "hub charter v5 unread" });
    expect(chip.getAttribute("title")).toContain("you have never read it");
    fireEvent.click(chip);
    await screen.findByText("Who is who.");
    await screen.findByText(/Not shown: Owner, Delegate/);
    expect(fetch_mock.mock.calls.filter((c) => String(c[0]).endsWith("/charter")).length).toBe(1);
  });

  it("a hub serving no charters shows no charter surface at all", async () => {
    stub_hub({ owed: { to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } } });
    render_page();
    await screen.findAllByText("#commons");
    expect(screen.queryByText(/charter/i)).toBeNull();
  });

  it("a post the charter gate refuses re-reads /owed, so the fix appears where the refusal did", async () => {
    // The hub's refusal names `read_charter(channel='commons')` — an MCP
    // call no console user can type. /owed's charter row is the console's
    // version of that instruction.
    const fetch_mock = stub_hub({
      post_refusal: { status: 409, detail: "this channel requires reading its charter first: read_charter(channel='commons') (v3, at 'channel/charter.md'), then retry" },
    });
    render_page();
    await screen.findAllByText("#commons");
    const owed_calls = () => fetch_mock.mock.calls.filter((c) => String(c[0]).includes("/owed")).length;
    const box = await screen.findByPlaceholderText(/^Message #commons/);
    fireEvent.change(box, { target: { value: "hello" } });
    const before_owed = owed_calls();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/requires reading its charter first/);
    await waitFor(() => expect(owed_calls()).toBeGreaterThan(before_owed));
  });

  it("member missions come from the channel roster, which needs no operator key", async () => {
    // `/channels/{c}/info.members[].mission` is served to every member;
    // `/admin/missions` is operator-only. Reading the roster is why a
    // non-operator seat can see what its colleagues are FOR.
    stub_hub({
      members: [{ agent_id: "critic", mission: "argue the other side, always" }],
      info: {
        channel: { name: "commons", private: false }, meta: { purpose: "cross-package commons" },
        members: [{ agent_id: "critic", mission: "argue the other side, always" }],
        response_sla_minutes: 1440, state: "open", charter: null,
      },
    });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("argue the other side, always");
  });

  it("a room's declared phase order renders before you post into it", async () => {
    stub_hub({
      info: {
        channel: { name: "commons", private: false }, meta: { purpose: "cross-package commons" },
        members: [{ agent_id: "a" }], response_sla_minutes: null, state: "open", charter: null,
        phases: [{ channel: "commons", key: "phase:api", track: "api", current: "v3", status: "open", next: "v4", steward: "core", declared_by: "laurent" }],
      },
    });
    render_page();
    await screen.findAllByText("#commons");
    fireEvent.click(screen.getByRole("button", { name: "Open channel members drawer" }));
    await screen.findByText("Phases");
    await screen.findByText("api · v3");
    await screen.findByText(/next: v4/);
  });

  it("the seat's standing mission rides its identity, and an older hub simply has none", async () => {
    stub_hub({ whoami: { id: "laurent", mission: "hold the console's contract with the hub" } });
    render_page();
    const marker = await screen.findByText("· mission set");
    expect(marker.parentElement?.getAttribute("title")).toContain("hold the console's contract with the hub");
    cleanup();

    stub_hub();
    render_page();
    await screen.findAllByText("#commons");
    expect(screen.queryByText("· mission set")).toBeNull();
  });
});
