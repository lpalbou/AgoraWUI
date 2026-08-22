// @vitest-environment jsdom
//
// The fold region's GUARDS and COUNTS — the half a render test cannot reach.
//
// A mutation sweep of the fold region in src/ui/team_page.tsx (2026-08-22,
// 44 operator mutants) killed 26 and left 18 alive. The split was sharp and
// it was not about coverage: tests/compat/team_page.test.tsx points squarely
// at this code. Render-shaped tests kill STRUCTURE — what the DOM contains
// in the default fixture — and cannot kill a GUARD, because a guard's whole
// job is to do nothing in the common case. The fixture in which it is
// correct and the fixture in which it is deleted look identical.
//
// So every test here first drives the app into the state the branch
// discriminates (a live text selection, an active filter, a click on an
// interactive child, a busy summary, a reply that is unread but not owed),
// and several carry an explicit POSITIVE CONTROL: the same gesture without
// the guard's precondition, asserted to have the opposite effect. Without
// that control a "nothing happened" assertion passes when the gesture never
// landed at all — decoration wearing a test's clothes.
//
// THREE OF THE 18 ARE NOT KILLABLE BY A SINGLE-SITE MUTANT, and no test
// here claims them. They are mutually protective PAIRS — each invisible
// alone only because its partner is still in place:
//
//   RT06 (toggle NEGATES instead of assigning the captured `folded`)
//     ×  RC04 (row_click's `.team_row_head` double-fire guard removed)
//        Alone: a single toggle, so negate and assign agree. Together: the
//        header fires the toggle, the event bubbles to the card, the toggle
//        fires again — assign is idempotent, negate cancels itself, and the
//        header click becomes a no-op. The source comment at row_click says
//        this outright and calls itself not falsifiable; the sweep agreed.
//
//   FC14 (the header bar ignores its own interactive-child guard)
//     ×  FC16 (the summarize button stops propagating)
//        Alone: FC16's event still dies on row_click's button guard, and
//        FC14 never sees a button click because every button in the header
//        stops propagation first. Together: clicking Summarize folds the
//        thread. FC16 IS pinned below — by its other observable effect, the
//        read it must not record — so only FC14 is left unmeasured.
//
// Single-site mutation testing is structurally blind to a mutually
// protective pair. Recorded rather than papered over: a check written to
// "cover" RC04 or FC14 today could only be a check that cannot fail.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPage } from "../../src/ui/team_page";

const original_create_object_url = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const original_revoke_object_url = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:fold-guard-test" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (original_create_object_url) Object.defineProperty(URL, "createObjectURL", original_create_object_url);
  else delete (URL as any).createObjectURL;
  if (original_revoke_object_url) Object.defineProperty(URL, "revokeObjectURL", original_revoke_object_url);
  else delete (URL as any).revokeObjectURL;
});

const SEAT = "laurent";
const CHANNELS = [{ name: "commons", private: false, member: true, member_count: 3, last_seq: 20, last_at: 10 }];

type Opts = { messages?: any[]; inbox?: any[]; owed?: any };

function stub_hub(opts: Opts = {}): ReturnType<typeof vi.fn> {
  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    const method = String(init?.method || "GET");
    if (url.includes("/whoami")) return new Response(JSON.stringify({ id: SEAT }), { status: 200 });
    if (url.includes("/healthz")) {
      return new Response(JSON.stringify({ ok: true, version: "0.17.0", protocol: "agora/0.4", paused: false }), { status: 200 });
    }
    if (url.includes("/inbox/ack")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.includes("/inbox")) return new Response(JSON.stringify(opts.inbox ?? []), { status: 200 });
    if (url.includes("/owed")) {
      // Debt is the HUB's verdict (`/owed.to_answer`), never re-derived from
      // envelope shape — so a debt fixture is an /owed fixture.
      return new Response(JSON.stringify(opts.owed ?? { to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
    }
    if (url.includes("/search")) {
      const empty = { hits: [], shown: 0, total: 0 };
      return new Response(
        JSON.stringify({ decisions: empty, open_threads: empty, work: empty, people: empty, files: empty, messages: empty, relaxed: false, channels_searched: 0, next_cursor: null, computed_at: 1 }),
        { status: 200 }
      );
    }
    if (url.includes("/digest")) return new Response(JSON.stringify({ channel: "commons", counts: { open_questions: 0 } }), { status: 200 });
    if (url.includes("/channels") && url.includes("/info")) {
      return new Response(
        JSON.stringify({ channel: { name: "commons", private: false }, meta: {}, members: [SEAT, "core", "gateway"], response_sla_minutes: 1440, state: "open", charter: null }),
        { status: 200 }
      );
    }
    if (url.includes("/channels") && url.includes("/members")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/blocks")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.match(/\/channels\/[^/]+\/fs$/)) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/attachments/")) return new Response("zip bytes", { status: 200 });
    if (url.includes("/channels") && url.includes("/messages") && method === "GET") {
      return new Response(JSON.stringify(opts.messages ?? []), { status: 200 });
    }
    if (url.endsWith("/presence")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.endsWith("/channels")) return new Response(JSON.stringify(CHANNELS), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch_mock);
  return fetch_mock;
}

const base = { channel: "commons", kind: "message", urgency: "inbox", created_at: 1, data: null };

/** Root + one reply, both titled so either can be found by text. */
function simple_thread(over: { root?: any; reply?: any } = {}): any[] {
  return [
    { ...base, id: "root", seq: 1, sender: "core", status: "open", title: "root topic", body: "root body", reply_to: null, ...over.root },
    { ...base, id: "r1", seq: 2, sender: "gateway", status: "reply", title: "child topic", body: "reply body", reply_to: "root", ...over.reply },
  ];
}

/** The fold state as the DOM reports it: the trail is rendered, or it is
 *  not. Deliberately not the toggle's aria-expanded — that is a label about
 *  the state, and these tests are about the state itself. */
function trail_open(): boolean {
  return document.querySelector(".team_replies") !== null;
}

function root_title_el(): HTMLElement {
  const el = document.querySelector(".team_thread_card .team_row_title") as HTMLElement | null;
  if (!el) throw new Error("no root title element — the fixture or the row layout changed");
  return el;
}

function fold_toggle(): HTMLButtonElement {
  const el = document.querySelector(".team_reply_toggle") as HTMLButtonElement | null;
  if (!el) throw new Error("no fold toggle — the fixture root has no replies, or the control moved");
  return el;
}

function ack_posts(fetch_mock: ReturnType<typeof vi.fn>): number {
  return fetch_mock.mock.calls.filter(([url, init]: any[]) => String(url).includes("/inbox/ack") && String(init?.method || "GET") === "POST").length;
}

/** A text selection the operator is in the middle of making. jsdom's own
 *  getSelection always reports collapsed, so the guard's precondition is
 *  unreachable without this. */
function stub_live_selection(): void {
  vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as any);
}

describe("row_click guards — the card is a fold target, except when it must not be", () => {
  it("does not fold under a click that ends a text selection (and the same click folds without one)", async () => {
    stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");
    expect(trail_open()).toBe(false);

    // POSITIVE CONTROL FIRST, so "nothing happened" below cannot be the
    // click failing to land: with no selection, this exact element opens it.
    fireEvent.click(root_title_el());
    await waitFor(() => expect(trail_open()).toBe(true));
    fireEvent.click(root_title_el());
    await waitFor(() => expect(trail_open()).toBe(false));

    // Now the guarded case. Selecting text inside a card ends with mouseup
    // on that card; treating it as a click collapses what you just selected.
    stub_live_selection();
    fireEvent.click(root_title_el());
    await act(async () => undefined);
    expect(trail_open()).toBe(false);
  });

  it("records no read either, when the click was the end of a selection", async () => {
    const fetch_mock = stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");
    const before = ack_posts(fetch_mock);

    stub_live_selection();
    fireEvent.click(root_title_el());
    await act(async () => undefined);
    expect(ack_posts(fetch_mock)).toBe(before);

    // Control: the identical click with a collapsed selection DOES record
    // the read. fire_read is idempotent per message id, so this also proves
    // the assertion above was not passing on an already-fired row.
    vi.restoreAllMocks();
    fireEvent.click(root_title_el());
    await waitFor(() => expect(ack_posts(fetch_mock)).toBeGreaterThan(before));
  });

  it("keeps the fold state you will return to when a card is clicked under a filter", async () => {
    // Under a filter the card is not foldable — `folded` is forced false so
    // matching messages stay visible, and the control is disabled. The
    // damage a missing guard does is therefore INVISIBLE while the filter is
    // on: it writes open_threads[root] = false behind the live view, and the
    // thread you left open snaps shut when you clear the filter.
    stub_hub({ messages: simple_thread({ root: { status: "fyi", title: "quiet root" }, reply: { status: "open", title: "the open reply" } }) });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("quiet root");

    fireEvent.click(fold_toggle());
    await waitFor(() => expect(trail_open()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /^Asks/ }));
    await screen.findByText("the open reply");
    fireEvent.click(root_title_el());
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    await act(async () => undefined);
    expect(trail_open()).toBe(true);
  });

  it("does not fold when an interactive child outside the header is clicked", async () => {
    // The attachment chip is the live instance of this: it is a real
    // <button>, it sits in `.team_attachments` — which is NOT in row_click's
    // element exclusion list — and it does not stop propagation. The only
    // thing standing between "preview this file" and "collapse the thread I
    // am reading" is the interactive-child guard.
    stub_hub({
      messages: simple_thread({
        root: { data: { attachments: [{ id: "att1", filename: "capture.zip", content_type: "application/zip", size: 2048 }] } },
      }),
    });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");

    fireEvent.click(fold_toggle());
    await waitFor(() => expect(trail_open()).toBe(true));

    const chip = document.querySelector(".team_attach_chip") as HTMLElement | null;
    expect(chip, "no attachment chip rendered — the fixture no longer exercises the guard").not.toBeNull();
    await act(async () => {
      fireEvent.click(chip!);
    });
    expect(trail_open()).toBe(true);
  });
});

describe("the fold control's buttons are not row clicks", () => {
  it("folding a thread records no read of its root", async () => {
    // The toggle lives inside the card, so without stopPropagation the card
    // handler runs too — and row_click fires the read BEFORE it reaches the
    // guard that would have ignored a button. Folding is navigation: it must
    // not silently discharge the unread state of a message you never opened.
    const fetch_mock = stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");
    const before = ack_posts(fetch_mock);

    fireEvent.click(fold_toggle());
    await waitFor(() => expect(trail_open()).toBe(true));
    expect(ack_posts(fetch_mock)).toBe(before);

    // Control: a click on the card's own surface does record it.
    fireEvent.click(root_title_el());
    await waitFor(() => expect(ack_posts(fetch_mock)).toBeGreaterThan(before));
  });

  it("summarizing a thread records no read of its root", async () => {
    const fetch_mock = stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={vi.fn(async () => "- summary")} />);
    await screen.findByText("root topic");
    const before = ack_posts(fetch_mock);
    fireEvent.click(fold_toggle());
    await waitFor(() => expect(trail_open()).toBe(true));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Summarize/ }));
    });
    await screen.findByText("summary");
    expect(ack_posts(fetch_mock)).toBe(before);
    // And it does not fold the thread out from under the summary it just
    // produced. This is the assertion that catches the FC14 × FC16 PAIR —
    // neither mutant alone reaches it, but both together make Summarize a
    // fold gesture, and then this goes red.
    expect(trail_open()).toBe(true);

    fireEvent.click(root_title_el());
    await waitFor(() => expect(ack_posts(fetch_mock)).toBeGreaterThan(before));
  });

  it("disables the summarize button while its summary is in flight", async () => {
    let release: (text: string) => void = () => undefined;
    const advisor = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={advisor} />);
    await screen.findByText("root topic");

    fireEvent.click(screen.getByRole("button", { name: /^Summarize/ }));
    const busy = await screen.findByRole("button", { name: "Summarizing this thread" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    // A second click while busy must not reach the advisor.
    fireEvent.click(busy);
    expect(advisor).toHaveBeenCalledTimes(1);

    await act(async () => {
      release("- done");
    });
  });
});

describe("the fold control under a filter", () => {
  const filtered = () => simple_thread({ root: { status: "fyi", title: "quiet root" }, reply: { status: "open", title: "the open reply" } });

  it("disables the toggle, because there is no fold to perform", async () => {
    stub_hub({ messages: filtered() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("quiet root");
    expect(fold_toggle().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Asks/ }));
    await screen.findByText("the open reply");
    expect(fold_toggle().disabled).toBe(true);
  });

  it("makes the header bar inert too, not merely unmarked", async () => {
    // `.foldable` coming off the header is a CLASS change — it says the bar
    // no longer looks clickable. Whether it still IS clickable is a separate
    // question, and the answer only shows up after the filter clears.
    stub_hub({ messages: filtered() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("quiet root");

    fireEvent.click(fold_toggle());
    await waitFor(() => expect(trail_open()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /^Asks/ }));
    await screen.findByText("the open reply");
    const head = document.querySelector(".team_thread_card .team_row_head") as HTMLElement;
    expect(head.classList.contains("foldable")).toBe(false);
    fireEvent.click(head);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    await act(async () => undefined);
    expect(trail_open()).toBe(true);
  });
});

describe("the fold bar's counts are reply-scoped and state-derived", () => {
  // Root and reply r1 are both unread AND both hub debts; r2 is neither.
  // Every count therefore has three ways to be wrong — count the replies
  // instead of the unread ones, include the root, or collapse to zero — and
  // each produces a different number here.
  const two_replies = [
    { ...base, id: "root", seq: 1, sender: "core", status: "open", title: "root topic", body: "root body", reply_to: null },
    { ...base, id: "r1", seq: 2, sender: "gateway", status: "open", title: "first reply", body: "a", reply_to: "root" },
    { ...base, id: "r2", seq: 3, sender: "gateway", status: "reply", title: "second reply", body: "b", reply_to: "root" },
  ];
  const inbox = [
    { channel: "commons", seq: 1, sender: "core", status: "open", addressed: true, to_me: true },
    { channel: "commons", seq: 2, sender: "gateway", status: "open", addressed: true, to_me: true },
  ];
  // The hub owes this seat an answer on the root AND on r1 — so a debt count
  // that forgot to be reply-scoped would read 2 here, not 1.
  const owed = {
    to_answer: [
      { channel: "commons", seq: 1 },
      { channel: "commons", seq: 2 },
    ],
    to_consume: [],
    waiting_on: [],
    counts: { to_answer: 2, to_consume: 0 },
  };

  function stat(kind: "new" | "debt" | "ask"): HTMLElement | null {
    return document.querySelector(`.team_thread_stat.${kind}`);
  }

  it("counts the unread REPLIES — not every reply, and not the root", async () => {
    stub_hub({ messages: two_replies, inbox });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");

    await waitFor(() => expect(stat("new")).not.toBeNull());
    expect(stat("new")!.getAttribute("aria-label")).toBe("1 unread reply in this loaded view");
    expect(stat("new")!.textContent).toContain("1");
  });

  it("counts the owed REPLIES from the hub's debt set", async () => {
    stub_hub({ messages: two_replies, inbox, owed });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");

    await waitFor(() => expect(stat("debt")).not.toBeNull());
    expect(stat("debt")!.getAttribute("aria-label")).toBe("1 reply needs your answer");
  });

  it("counts the pending asks the hub reports on the replies", async () => {
    stub_hub({
      messages: [
        two_replies[0],
        { ...two_replies[1], pending_asks: ["1", "2"] },
        two_replies[2],
      ],
      inbox,
    });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");

    await waitFor(() => expect(stat("ask")).not.toBeNull());
    expect(stat("ask")!.getAttribute("aria-label")).toBe("2 pending questions in the replies");
  });

  it("renders NO chip at zero — an absent state is absent, never a ● 0", async () => {
    // The negative half. Three separate conditionals, each of which reads
    // identically to its `>= 0` twin in every fixture that has some of the
    // thing. The three assertions above are this one's positive controls:
    // together they say the selectors are live and the chips can appear.
    stub_hub({ messages: simple_thread() });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");
    await waitFor(() => expect(document.querySelector(".team_fold_group")).not.toBeNull());

    expect(stat("new")).toBeNull();
    expect(stat("debt")).toBeNull();
    expect(stat("ask")).toBeNull();
    expect(document.querySelectorAll(".team_thread_stat")).toHaveLength(0);
  });

  it("offers to summarize the WHOLE trail, root included", async () => {
    stub_hub({ messages: two_replies });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText("root topic");
    // 2 replies + the root = 3. The fold count beside it stays reply-scoped
    // at 2, which is the distinction: one control hides replies, the other
    // reads the conversation.
    expect(screen.getByRole("button", { name: "Summarize 3 messages" })).toBeTruthy();
    expect(fold_toggle().getAttribute("aria-label")).toBe("Show 2 replies to: root topic");
  });

  it("labels a title-less thread by its body, so the control still says what it opens", async () => {
    stub_hub({ messages: simple_thread({ root: { title: "", body: "a long dm   with   ragged\nspacing" } }) });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByText(/a long dm/);

    // Whitespace-collapsed, because the label rides an aria-label and a
    // title attribute where a newline is not a line break.
    expect(fold_toggle().getAttribute("aria-label")).toBe("Show 1 reply to: a long dm with ragged spacing");
    expect(document.querySelector(".team_thread_card")!.getAttribute("aria-label")).toBe("Thread: a long dm with ragged spacing");
  });
});
