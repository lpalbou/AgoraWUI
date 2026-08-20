// @vitest-environment jsdom
//
// Retraction surfaces (agora 0097). What is pinned here:
//   - Retract is offered on ANY message when the HUB says this seat is an
//     operator (`/whoami.operator`), and only on your own otherwise. The
//     flag drives VISIBILITY; the hub stays the only authority.
//   - The thread control lives on the ROOT row, opens the repo's in-app
//     confirm modal (never a browser confirm, never a bare two-click), and
//     states the blast radius plainly before it is armed.
//   - A hub refusal renders VERBATIM — the console never re-derives the
//     authorization rule and never falls back to a per-message loop.
//   - A fully retracted thread renders as tombstones and stops shouting.
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubClient } from "../../src/lib/hub_client";
import { TeamPage } from "../../src/ui/team_page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type Opts = { operator?: boolean; messages?: any[]; thread_response?: () => Response };

const CHANNELS = [{ name: "commons", private: false, member: true, member_count: 3, last_seq: 20, last_at: 10 }];

function stub_hub(opts: Opts = {}): ReturnType<typeof vi.fn> {
  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    const method = String(init?.method || "GET");
    if (url.includes("/whoami")) {
      return new Response(JSON.stringify({ id: "laurent", operator: opts.operator ?? false }), { status: 200 });
    }
    if (url.includes("/healthz")) {
      return new Response(JSON.stringify({ ok: true, version: "0.17.0", protocol: "agora/0.4", paused: false }), { status: 200 });
    }
    if (url.includes("/retract_thread")) {
      return opts.thread_response
        ? opts.thread_response()
        : new Response(JSON.stringify({ channel: "commons", root: "m1", count: 3, already_retracted: [], skipped_non_messages: [], messages: [] }), { status: 200 });
    }
    if (url.includes("/retract")) {
      return new Response(JSON.stringify({ id: "m1", retracted: true, body: "[retracted by laurent]" }), { status: 200 });
    }
    if (url.includes("/inbox")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/owed")) {
      return new Response(JSON.stringify({ to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
    }
    if (url.includes("/search")) {
      const empty = { hits: [], shown: 0, total: 0 };
      return new Response(JSON.stringify({ decisions: empty, open_threads: empty, work: empty, people: empty, files: empty, messages: empty, relaxed: false, channels_searched: 0, next_cursor: null, computed_at: 1 }), { status: 200 });
    }
    if (url.includes("/digest")) {
      return new Response(JSON.stringify({ channel: "commons", counts: { open_questions: 0 } }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/info")) {
      return new Response(JSON.stringify({ channel: { name: "commons", private: false }, meta: {}, members: ["laurent", "peer"], response_sla_minutes: 1440, state: "open", charter: null }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/members")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/blocks")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.match(/\/channels\/[^/]+\/fs$/)) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/channels") && url.includes("/messages") && method === "GET") {
      return new Response(JSON.stringify(opts.messages ?? []), { status: 200 });
    }
    if (url.endsWith("/channels")) return new Response(JSON.stringify(CHANNELS), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch_mock);
  return fetch_mock;
}

/** root by a PEER + one reply by the viewer's own seat. */
function mixed_thread(retracted = false): any[] {
  const stamp = retracted ? { retracted: true, title: "", body: "[retracted by laurent]", status: "fyi", data: null } : {};
  return [
    { id: "m1", channel: "commons", seq: 10, sender: "peer", status: retracted ? "fyi" : "open", title: "Deprecated plan", body: "the noisy words", created_at: 1, ...stamp },
    { id: "m2", channel: "commons", seq: 11, sender: "laurent", status: "reply", reply_to: "m1", title: "", body: "my own reply", created_at: 2, ...stamp },
    { id: "m3", channel: "commons", seq: 12, sender: "peer", status: "reply", reply_to: "m1", title: "", body: "peer follow-up", created_at: 3, ...stamp },
  ];
}

function render_page(): void {
  render(<TeamPage advisor={vi.fn(async () => "x")} />);
}

async function open_room(): Promise<void> {
  await screen.findByText((_, el) => Boolean(el?.className?.includes?.("team_pane_title") && el.textContent === "#commons"));
}

/** Thread cards fold their replies by default; the retraction controls of
 *  the replies only exist once the trail is on screen. */
async function unfold_thread(): Promise<void> {
  const toggle = await screen.findByLabelText(/^Show \d+ repl(y|ies) to:/);
  fireEvent.click(toggle);
}

// -- visibility is the hub's answer, never the console's rule -----------------

describe("Retract visibility follows /whoami.operator", () => {
  it("hides Retract on other seats' messages for a non-operator", async () => {
    stub_hub({ operator: false, messages: mixed_thread() });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");
    await unfold_thread();
    // Exactly one Retract control: the viewer's own reply (m2). The peer's
    // root and follow-up offer none.
    await waitFor(() => {
      expect(screen.getAllByTitle(/^Retract this message/)).toHaveLength(1);
    });
    expect(screen.queryByTitle(/Retract .*'s message as operator/)).toBeNull();
  });

  it("offers Retract on ANY message when the hub says the seat is an operator", async () => {
    stub_hub({ operator: true, messages: mixed_thread() });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");
    await unfold_thread();
    await waitFor(() => {
      // peer's root + peer's follow-up, labelled as an operator act.
      expect(screen.getAllByTitle(/Retract peer's message as operator/)).toHaveLength(2);
    });
    // The seat's own message still reads as its own undo, not an override.
    expect(screen.getAllByTitle(/^Retract this message/)).toHaveLength(1);
  });

  it("never offers Retract on an already-retracted row", async () => {
    stub_hub({ operator: true, messages: mixed_thread(true) });
    render_page();
    await open_room();
    await screen.findAllByText(/\[retracted by laurent\]/);
    await unfold_thread();
    expect(screen.queryByTitle(/^Retract this message/)).toBeNull();
    expect(screen.queryByTitle(/message as operator/)).toBeNull();
  });
});

// -- the thread control ------------------------------------------------------

describe("thread retraction", () => {
  it("lives on the root row only, and states the blast radius in an in-app modal", async () => {
    const fetch_mock = stub_hub({ operator: true, messages: mixed_thread() });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");

    const thread_buttons = await screen.findAllByTitle(/Retract this entire thread/);
    expect(thread_buttons).toHaveLength(1); // the root, not the two replies

    fireEvent.click(thread_buttons[0]);
    // No hub call is made on arming — the modal must be read first.
    expect(fetch_mock.mock.calls.some(([u]: any[]) => String(u).includes("/retract_thread"))).toBe(false);

    await screen.findByText("Retract this whole thread?");
    const modal = screen.getByText("Retract this whole thread?").closest("div[role], div") as HTMLElement;
    const copy = document.body.textContent || "";
    // The blast radius, stated plainly.
    expect(copy).toMatch(/every message in this trail/i);
    expect(copy).toMatch(/every reader and every agent/i);
    expect(copy).toMatch(/obligation .* dies/i);
    expect(copy).toMatch(/ledger integrity are preserved/i);
    expect(modal).toBeTruthy();

    fireEvent.click(screen.getByText("Retract thread"));
    await waitFor(() => {
      const call = fetch_mock.mock.calls.find(([u]: any[]) => String(u).includes("/retract_thread"));
      expect(call).toBeTruthy();
      expect(String(call?.[0])).toContain("/channels/commons/messages/m1/retract_thread");
      expect(String(call?.[1]?.method)).toBe("POST");
    });
    await screen.findByText(/3 messages now read as tombstones/i);
  });

  it("cancels without calling the hub", async () => {
    const fetch_mock = stub_hub({ operator: true, messages: mixed_thread() });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");
    fireEvent.click((await screen.findAllByTitle(/Retract this entire thread/))[0]);
    await screen.findByText("Retract this whole thread?");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Retract this whole thread?")).toBeNull());
    expect(fetch_mock.mock.calls.some(([u]: any[]) => String(u).includes("/retract_thread"))).toBe(false);
  });

  it("renders the hub's refusal VERBATIM and retracts nothing", async () => {
    const detail =
      "only the author (or an operator) can retract a message — this trail has 1 other author(s) (peer), so NOTHING was retracted. Retract your own messages one by one, or ask an operator to retract the thread.";
    const fetch_mock = stub_hub({
      operator: true, // visibility only; the HUB is what refuses here
      messages: mixed_thread(),
      thread_response: () => new Response(JSON.stringify({ detail }), { status: 403 }),
    });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");
    fireEvent.click((await screen.findAllByTitle(/Retract this entire thread/))[0]);
    await screen.findByText("Retract this whole thread?");
    fireEvent.click(screen.getByText("Retract thread"));

    await screen.findByText(new RegExp("so NOTHING was retracted"));
    // No client-side fallback loop: exactly one hub call, the thread verb.
    const retract_calls = fetch_mock.mock.calls.filter(([u]: any[]) => String(u).includes("/retract"));
    expect(retract_calls).toHaveLength(1);
    expect(String(retract_calls[0][0])).toContain("/retract_thread");
    // The modal stays open with the refusal — nothing pretends to have worked.
    expect(screen.queryByText("Retract this whole thread?")).not.toBeNull();
  });

  it("is hidden on a root a non-operator does not own", async () => {
    stub_hub({ operator: false, messages: mixed_thread() });
    render_page();
    await open_room();
    await screen.findByText("the noisy words");
    expect(screen.queryByTitle(/Retract this entire thread/)).toBeNull();
  });
});

// -- a fully retracted thread does not shout ---------------------------------

describe("a fully retracted thread", () => {
  it("renders every row as a dimmed tombstone and raises no attention state", async () => {
    stub_hub({ operator: true, messages: mixed_thread(true) });
    render_page();
    await open_room();
    await screen.findAllByText(/\[retracted by laurent\]/);
    await unfold_thread();
    const stones = await screen.findAllByText(/\[retracted by laurent\]/);
    expect(stones).toHaveLength(3);
    // Each row carries the tombstone class the stylesheet dims.
    for (const stone of stones) {
      expect(stone.closest(".team_row")?.className).toContain("retracted");
    }
    // Nothing in the trail still reads as an open obligation.
    expect(screen.queryByText("the noisy words")).toBeNull();
    expect(screen.queryByText("Deprecated plan")).toBeNull();
    expect(document.body.textContent || "").not.toMatch(/needs reply/i);
  });
});

// -- the client carries the flag, and never invents the rule -----------------

describe("HubClient", () => {
  it("carries /whoami.operator through meta() and posts the thread verb", async () => {
    const fetch_mock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/whoami")) return new Response(JSON.stringify({ id: "laurent", operator: true }), { status: 200 });
      return new Response(JSON.stringify({ count: 2 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch_mock);
    const client = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "k" });
    await expect(client.meta()).resolves.toMatchObject({ seat: "laurent", operator: true });
    await client.retract_thread("commons", "m1");
    const call = fetch_mock.mock.calls.find(([u]: any[]) => String(u).includes("/retract_thread"));
    expect(String(call?.[0])).toContain("/channels/commons/messages/m1/retract_thread");
    expect(String(call?.[1]?.method)).toBe("POST");
  });

  it("reads a hub without the operator field as non-operator (hide, never assume)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "laurent" }), { status: 200 })),
    );
    const client = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "k" });
    await expect(client.meta()).resolves.toMatchObject({ operator: false });
  });
});

// -- a fully retracted thread leaves every triage lens -------------------------

describe("a fully retracted thread and the filters", () => {
  it("stays only in All (and Unread while genuinely unread) — never in a triage lens", async () => {
    const { filter_threads, group_threads } = await import("../../src/lib/team_model");
    const threads = group_threads(mixed_thread(true) as any);
    expect(threads).toHaveLength(1);
    const ctx = { seat: "laurent", unread_seqs: new Set<number>(), unread_snapshot_seqs: new Set<number>() };
    expect(filter_threads(threads, "all", ctx)).toHaveLength(1);
    for (const lens of ["asks", "vigilance", "fyi", "resolved", "to_me"] as const) {
      expect(filter_threads(threads, lens, ctx)).toHaveLength(0);
    }
    // Unread only while the seat has genuinely not seen the tombstone.
    expect(filter_threads(threads, "unread", ctx)).toHaveLength(0);
    expect(filter_threads(threads, "unread", { ...ctx, unread_seqs: new Set([10]) })).toHaveLength(1);
  });
});

// -- the ledger verifier must not call a retraction a tamper ------------------

describe("ledger verification with retracted turns (protocol.md rule 5)", () => {
  it("links through a retracted turn, still catches a real tamper, and discloses the count", async () => {
    const { verify_ledger, turn_hash } = await import("../../src/lib/hub_ledger");
    const base = (seq: number, body: string) => ({
      id: `m${seq}`, seq, sender: "peer", kind: "message", status: "fyi", urgency: "inbox",
      critical: 0, downgraded: 0, to: [] as string[], title: "", body, data: null,
      reply_to: null, created_at: 1.5 + seq, hash: "",
    });
    const t1 = base(1, "first");
    const t2 = base(2, "retracted words");
    const t3 = base(3, "third");
    t1.hash = await turn_hash("", t1 as any, "commons");
    t2.hash = await turn_hash(t1.hash, t2 as any, "commons");
    t3.hash = await turn_hash(t2.hash, t3 as any, "commons");
    const head = t3.hash;

    // Intact chain, nothing retracted: the baseline verdict.
    const intact = await verify_ledger({ channel: "commons", count: 3, head, turns: [t1, t2, t3] as any });
    expect(intact.ok).toBe(true);
    expect(intact.redacted).toBe(0);

    // Now the hub redacts turn 2 in place (tombstone payload, hash kept).
    const stone = { ...t2, retracted: true, title: "", body: "[retracted by laurent]", status: "fyi", data: null };
    const with_stone = await verify_ledger({ channel: "commons", count: 3, head, turns: [t1, stone, t3] as any });
    expect(with_stone.ok).toBe(true);
    expect(with_stone.redacted).toBe(1);

    // A real tamper on a LIVE turn is still caught: the link-through is narrow.
    const tampered = { ...t3, body: "edited after the fact" };
    const caught = await verify_ledger({ channel: "commons", count: 3, head, turns: [t1, stone, tampered] as any });
    expect(caught.ok).toBe(false);
    expect(caught.broken_at).toBe(3);
  });
});
