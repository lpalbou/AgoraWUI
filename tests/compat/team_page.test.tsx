// @vitest-environment jsdom
//
// Team page pins: trust affordances (protocol pin, answered chips, About
// pane), the 2026-07-14 redesign (thread grouping in the DOM, category
// filters), and the AI lanes' read-only contract (/assistant routes to
// the analyst and NEVER posts to the room).
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
};

function stub_hub(opts: StubOpts = {}): ReturnType<typeof vi.fn> {
  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    if (url.includes("/whoami")) {
      return new Response(JSON.stringify({ id: "laurent" }), { status: 200 });
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

function render_page(): void {
  render(<TeamPage advisor={make_advisor()} />);
}

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
    await screen.findByText((_, el) => Boolean(el?.className?.includes?.("team_search_tally") && el.textContent === "▲2 ▽0"));
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
    await screen.findByText((_, el) => Boolean(el && el.className?.includes?.("team_reaction_tally") && el.textContent === "▲2 ▼1"));
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
    expect(screen.queryByText(/▲/)).toBeNull();
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

describe("acked-but-never-read badge (comms-audit ask 1, agora-0130)", () => {
  const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null, reply_to: null };
  it("badges a swept-unread row (read===false, not in the unread set) as missed", async () => {
    stub_hub({
      messages: [{ ...base, id: "01SWEPT", seq: 5, sender: "agora", status: "fyi", body: "swept by the burst cursor", read: false }],
      inbox: [], // no unread envelope → cursor already advanced past it
    });
    render_page();
    await screen.findByText("swept by the burst cursor");
    await screen.findByText("missed?");
  });
  it("does NOT badge a genuinely-read row (read===true)", async () => {
    stub_hub({
      messages: [{ ...base, id: "01READ", seq: 6, sender: "agora", status: "fyi", body: "actually read", read: true }],
      inbox: [],
    });
    render_page();
    await screen.findByText("actually read");
    expect(screen.queryByText("missed?")).toBeNull();
  });
  it("does NOT badge on older hubs (read===null/absent)", async () => {
    stub_hub({
      messages: [{ ...base, id: "01OLD", seq: 7, sender: "agora", status: "fyi", body: "pre-0130 hub" }],
      inbox: [],
    });
    render_page();
    await screen.findByText("pre-0130 hub");
    expect(screen.queryByText("missed?")).toBeNull();
  });
});

describe("answers-waiting-on-you rail (comms-audit ask 2)", () => {
  it("renders to_consume as an always-visible rail with a jump link", async () => {
    stub_hub({
      owed: {
        to_consume: [
          { channel: "dm:agora--laurent", answer_id: "01ANS", answer_seq: 42, answered_by: "agora", title: "delegate UI status", your_asks: ["delegate UI status"] },
        ],
        to_answer: [],
        counts: { to_consume: 1 },
      },
    });
    render_page();
    await screen.findByText(/1 answer to your question is waiting/);
    await screen.findByText(/agora answered/);
  });

  it("shows nothing when to_consume is empty (feature-detected, no false rail)", async () => {
    stub_hub({ owed: { to_consume: [], to_answer: [] } });
    render_page();
    await screen.findByText(/as laurent/);
    expect(screen.queryByText(/answers? to your question/)).toBeNull();
  });

  it("dismiss-all clears the whole rail in one act and PERSISTS (operator dm 173: 148 items, one-at-a-time was unreadable)", async () => {
    localStorage.clear();
    const items = [1, 2, 3].map((n) => ({ channel: "commons", answer_id: `01A${n}`, answer_seq: n, answered_by: "agora", title: `answer ${n}` }));
    stub_hub({ owed: { to_consume: items, to_answer: [], counts: { to_consume: 3 } } });
    render_page();
    await screen.findByText(/3 answers to your questions are waiting/);
    fireEvent.click(screen.getByText("dismiss all"));
    await waitFor(() => expect(screen.queryByText(/answers to your questions are waiting/)).toBeNull());
    // Persistence: the dismissal map survives a remount (reload analogue).
    const stored = JSON.parse(localStorage.getItem("continuum_consume_dismissed_v1") || "{}");
    expect(Object.keys(stored).sort()).toEqual(["01A1", "01A2", "01A3"]);
    cleanup();
    render_page();
    await screen.findByText(/as laurent/);
    expect(screen.queryByText(/answers to your questions are waiting/)).toBeNull();
    localStorage.clear();
  });

  it("fold collapses the rail to a one-line count that keeps the FACT visible (fold hides the list, never the count)", async () => {
    localStorage.clear();
    stub_hub({
      owed: {
        to_consume: [{ channel: "commons", answer_id: "01F1", answer_seq: 9, answered_by: "flow", title: "folded row" }],
        to_answer: [],
        counts: { to_consume: 1 },
      },
    });
    render_page();
    await screen.findByText(/flow answered/);
    fireEvent.click(screen.getByText("fold"));
    // Folded: the count line stays, the per-item rows are gone, and the
    // unfold affordance is present.
    await screen.findByText(/1 answer to your question is waiting/);
    expect(screen.queryByText(/flow answered/)).toBeNull();
    fireEvent.click(screen.getByText("show"));
    await screen.findByText(/flow answered/);
    localStorage.clear();
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

  it("browses the channel virtual filesystem via the Files drawer — Drive-style folders (operator dm 35/53)", async () => {
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
    });
    render_page();
    await screen.findByText("delegated to this seat");
    await screen.findByText("needs reply");
    expect(screen.getAllByText("needs reply")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^@me/ }));
    await screen.findByText("delegated to this seat");
    expect(screen.queryByText("for someone else")).toBeNull();
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
    expect(screen.getByText("the answer")).toBeTruthy();
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
