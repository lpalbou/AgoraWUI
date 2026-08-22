// @vitest-environment jsdom
//
// The citation preview card (operator dm 21/22). Hovering a `#412` or
// `commons#412` in a message body shows the cited message without leaving
// the room you are reading.
//
// THREE LAYERS, AND THIS FILE OWNS THE SEAM BETWEEN THEM. The recogniser is
// pinned in citation_chips.test.ts as pure text. What can only be measured
// here is: does the Markdown renderer actually emit a chip for that text,
// does the feed's delegated handler find it, and does resolution ask the
// right source? Those are three different failures and each looks like
// "nothing happens on hover".
//
// WHAT THIS FILE CANNOT SEE. jsdom has no layout engine: every rect is
// zero-size, so WHERE the card lands — above vs below the chip, the
// left-edge clamp, whether it is clipped by the feed's scroll container —
// is unmeasurable here and is asserted nowhere. Said plainly rather than
// wrapped in a check that would pass either way.
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPage } from "../../src/ui/team_page";
import { Markdown } from "../../src/ui/primitives";

const SEAT = "laurent";
const CHANNELS = [
  { name: "commons", private: false, member: true, member_count: 3, last_seq: 9, last_at: 20 },
  { name: "webos", private: true, member: true, member_count: 2, last_seq: 9, last_at: 10 },
];

/** The message the feed opens on. Its body carries every citation shape the
 *  operator asked about. */
const FEED_BODY = [
  "answered at #7 already, and see webos#171 for the other half.",
  "",
  "#5 is the one nobody closed.",
  "",
  "```",
  "commons#999 inside a fence is code",
  "```",
  "",
  "routed to #commons instead.",
  "",
  "| Question | Evidence |",
  "| --- | --- |",
  "| Did it land? | `commons#7` — 3 passed |",
  "| Which change? | `optimize-code#103`, PR#103 |",
].join("\n");

const original_create_object_url = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:cite-test" });
  // jsdom has no scrollIntoView at all; without this the jump path throws
  // rather than failing an assertion, which reads as an unrelated crash.
  (Element.prototype as any).scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  if (original_create_object_url) Object.defineProperty(URL, "createObjectURL", original_create_object_url);
  else delete (URL as any).createObjectURL;
});

type Opts = {
  /** What `GET /channels/webos/messages` answers — the cross-channel lane. */
  webos?: "found" | "empty" | "forbidden";
  /** The hub's discharge verdict on that cross-channel row (agora-and-wui#11).
   *  Undefined leaves the field OFF the row entirely, which is what an older
   *  hub serves — the case the silence behaviour still has to cover. */
  webos_closed?: boolean | null;
};

function stub_hub(opts: Opts = {}) {
  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    const method = String(init?.method || "GET");
    if (url.includes("/whoami")) return new Response(JSON.stringify({ id: SEAT }), { status: 200 });
    if (url.includes("/healthz")) return new Response(JSON.stringify({ ok: true, version: "0.17.0", protocol: "agora/0.4", paused: false }), { status: 200 });
    if (url.includes("/inbox/ack")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.includes("/inbox")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/owed")) {
      return new Response(JSON.stringify({ to_answer: [], to_consume: [], waiting_on: [], counts: { to_answer: 0, to_consume: 0 } }), { status: 200 });
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
      return new Response(JSON.stringify({ channel: { name: "commons", private: false }, meta: {}, members: [SEAT, "core"], response_sla_minutes: 1440, state: "open", charter: null }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/members")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/blocks")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.match(/\/channels\/[^/]+\/fs$/)) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/channels") && url.includes("/messages") && method === "POST") return new Response(JSON.stringify({ id: "posted", seq: 10 }), { status: 200 });
    if (url.includes("/channels") && url.includes("/messages") && method === "GET") {
      const chan = /\/channels\/([^/]+)\/messages/.exec(url)?.[1] || "commons";
      if (chan === "webos") {
        if (opts.webos === "forbidden") return new Response(JSON.stringify({ detail: "not a member of webos" }), { status: 403 });
        if (opts.webos === "empty") return new Response(JSON.stringify([]), { status: 200 });
        return new Response(
          JSON.stringify([
            {
              id: "webos-171", seq: 171, channel: "webos", sender: "agora-tui", status: "open", kind: "message", urgency: "inbox", created_at: 5, data: null, title: "Ownership change", body: "the other half of the story", reply_to: null,
              ...("webos_closed" in opts ? { closed: opts.webos_closed } : {}),
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify([
          { id: "commons-5", seq: 5, channel: "commons", sender: "core", status: "open", kind: "message", urgency: "inbox", created_at: 0, data: null, title: "Never closed", body: "nobody resolved this one", reply_to: null },
          // Posted `open`, CLOSED by a resolved reply. The root keeps the
          // word "open" forever — which is the whole of operator dm 34.
          { id: "commons-7", seq: 7, channel: "commons", sender: "core", status: "open", kind: "message", urgency: "inbox", created_at: 1, data: null, title: "The earlier answer", body: "what #7 actually said", reply_to: null },
          { id: "commons-8", seq: 8, channel: "commons", sender: "agora", status: "resolved", kind: "message", urgency: "inbox", created_at: 2, data: null, title: "Closed it", body: "done", reply_to: "commons-7" },
          { id: "commons-9", seq: 9, channel: "commons", sender: "agora-wui", status: "fyi", kind: "message", urgency: "inbox", created_at: 2, data: null, title: "citation carrier", body: FEED_BODY, reply_to: null },
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/presence")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.endsWith("/channels")) return new Response(JSON.stringify(CHANNELS), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch_mock);
  return fetch_mock;
}

async function boot(): Promise<void> {
  render(<TeamPage advisor={vi.fn(async () => "s")} />);
  await screen.findByPlaceholderText(/Message #commons/);
  await screen.findByText(/citation carrier/);
}

function chips(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-cite-seq]")) as HTMLElement[];
}

function chip(label: string): HTMLElement {
  const hit = chips().find((el) => el.textContent === label);
  if (!hit) throw new Error(`no citation chip "${label}" — rendered: ${chips().map((c) => c.textContent).join(", ") || "(none)"}`);
  return hit;
}

/** The card, or null. Every assertion about the preview is scoped to it:
 *  the cited message is usually ALSO in the feed (that is the common case —
 *  a citation to the room you are reading), so an unscoped getByText would
 *  pass on the feed's copy whether or not the card rendered at all. */
function card(): HTMLElement | null {
  return document.querySelector(".team_cite_card");
}

async function find_card(): Promise<HTMLElement> {
  await waitFor(() => expect(card()).toBeTruthy());
  return card() as HTMLElement;
}

/** How many times the hub was asked for a channel's messages. The whole
 *  point of resolving from the loaded window is that this does NOT grow. */
function message_gets(fetch_mock: ReturnType<typeof stub_hub>, channel: string): number {
  return fetch_mock.mock.calls.filter(([u, i]: any[]) => new RegExp(`/channels/${channel}/messages`).test(String(u)) && String(i?.method || "GET") === "GET").length;
}

describe("the chip — what the renderer emits", () => {
  it("turns a bare seq and a cross-channel ref in prose into chips", async () => {
    stub_hub();
    await boot();
    expect(chip("#7").getAttribute("data-cite-channel")).toBe("");
    expect(chip("#7").getAttribute("data-cite-seq")).toBe("7");
    expect(chip("webos#171").getAttribute("data-cite-channel")).toBe("webos");
    expect(chip("webos#171").getAttribute("data-cite-seq")).toBe("171");
  });

  it("does NOT chip a citation inside a fenced code block, nor a channel mention", async () => {
    // The control the whole feature rests on: peer messages are full of
    // code, and a chip inside a fence would rewrite other people's snippets.
    stub_hub();
    await boot();
    const labels = chips().map((c) => c.textContent);
    expect(labels).not.toContain("commons#999");
    expect(labels).not.toContain("#commons");
    // ...and the fenced text is still ON SCREEN as code. Not chipping it by
    // accidentally dropping it would satisfy the line above.
    expect(screen.getByText(/commons#999 inside a fence is code/)).toBeTruthy();
  });

  it("is focusable, so the preview is reachable without a pointer", async () => {
    stub_hub();
    await boot();
    expect(chip("#7").getAttribute("tabindex")).toBe("0");
  });
});

describe("the chip — the false-positive gate", () => {
  // `word#digits` is a common shape in agent reports that has nothing to do
  // with the hub: PR#103, issue#42, optimize-code#103. Chipping those would
  // scatter dead controls through other people's messages, and each one
  // costs a hover and a request to discover it goes nowhere.
  it("does NOT chip a qualified ref naming a room that does not exist", async () => {
    stub_hub();
    await boot();
    const labels = chips().map((c) => c.textContent);
    expect(labels).toContain("webos#171"); // a real room, in the served list
    expect(labels).not.toContain("optimize-code#103");
    expect(labels).not.toContain("PR#103");
    // ...and the text is still there, unchipped, exactly as written.
    expect(screen.getByText(/optimize-code#103/)).toBeTruthy();
  });

  it("chips a citation inside a TABLE CELL, where agent reports actually put them", async () => {
    // This is the seam the change crossed: `Markdown` is shared, and its
    // table lane renders inline code too.
    stub_hub();
    await boot();
    const in_cell = chips().find((el) => el.closest("td"));
    expect(in_cell?.textContent).toBe("commons#7");
  });

  // OPERATOR dm 48: "we still have a lot of unresolved messages", with a
  // screenshot of `#24` chipped in #agora-and-wui — a room with 18 messages.
  // The reference was to a DM; the prose said `dm#24` in one place and a bare
  // `#24` in the next sentence, which is how agents write. The bare case was
  // exempt from the false-positive gate on the reasoning that the ROOM it
  // resolves against exists by construction. It does. The SEQ need not.
  it("does NOT chip a bare seq the read room cannot have — the dm-48 dead chip", async () => {
    // commons' last_seq is 9 and its window tops out at 9.
    stub_hub();
    await boot();

    const labels = chips().map((c) => c.textContent);
    expect(labels).toContain("#7"); // in range, still a chip
    expect(labels).not.toContain("#4242");
    // ...and the text survives verbatim, unchipped. Dropping it would satisfy
    // the line above just as well.
    expect(screen.getByText(/#4242 was still there/)).toBeTruthy();
  });

  it("still chips a bare seq EQUAL to the room's last message — the off-by-one control", async () => {
    // Without this, a ceiling implemented as `seq < max` passes the test
    // above and silently kills every citation to the newest message.
    stub_hub();
    await boot();

    expect(chips().map((c) => c.textContent)).toContain("#9");
  });

  it("applies the ceiling to the BARE case only — a named room keeps its chip", async () => {
    // `webos#171` names a room whose rail `last_seq` is 9. The ceiling is
    // about "the room you are reading" and must not leak into the named
    // lane, where the card's own fetch is the authority.
    stub_hub();
    await boot();

    expect(chips().map((c) => c.textContent)).toContain("webos#171");
  });

  it("renders NO chips at all where the caller passes no channel set", () => {
    // The charter viewer, the summary pane and the file viewer all use
    // `Markdown` and none of them has a hover handler. A chip there would be
    // an affordance with nothing behind it.
    const { container } = render(<Markdown className="md_doc" text="see `commons#7` and `#412`" />);
    expect(container.querySelectorAll("[data-cite-seq]")).toHaveLength(0);
    expect(container.querySelectorAll("code")).toHaveLength(2);
  });
});

describe("the card — resolution", () => {
  it("resolves a bare seq against the OPEN channel, from the loaded window, with no request", async () => {
    const fetch_mock = stub_hub();
    await boot();
    const before = message_gets(fetch_mock, "commons");

    fireEvent.mouseOver(chip("#7"));

    const c = await find_card();
    expect(within(c).getByText("The earlier answer")).toBeTruthy();
    expect(within(c).getByText("what #7 actually said")).toBeTruthy();
    // The card names the room a BARE citation resolved against — the answer
    // to "which #7 is this?".
    expect(within(c).getByText("commons#7")).toBeTruthy();
    expect(message_gets(fetch_mock, "commons")).toBe(before);
  });

  it("fetches a cross-channel citation — dm 22, the half a same-room lookup cannot do", async () => {
    const fetch_mock = stub_hub();
    await boot();
    expect(message_gets(fetch_mock, "webos")).toBe(0);

    fireEvent.mouseOver(chip("webos#171"));

    const c = await find_card();
    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    expect(within(card() as HTMLElement).getByText("the other half of the story")).toBeTruthy();
    expect(c).toBeTruthy();
    expect(message_gets(fetch_mock, "webos")).toBe(1);
    // Exactly the one message, not a window: `since = seq - 1, limit = 1`.
    const call = fetch_mock.mock.calls.find(([u]: any[]) => /\/channels\/webos\/messages/.test(String(u)));
    expect(String(call?.[0])).toContain("since=170");
    expect(String(call?.[0])).toContain("limit=1");
  });

  it("caches a hit — a second hover asks nothing", async () => {
    const fetch_mock = stub_hub();
    await boot();

    fireEvent.mouseOver(chip("webos#171"));
    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    fireEvent.mouseOut(chip("webos#171"));
    fireEvent.mouseOver(chip("webos#171"));
    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());

    expect(message_gets(fetch_mock, "webos")).toBe(1);
  });

  it("caches a MISS too — a dead citation must not re-ask on every hover", async () => {
    // The failure this pins is not correctness, it is a request storm: a
    // citation the hub has already said it cannot serve sits in a message
    // body forever, and the pointer crosses it every time the operator
    // reads that message. Cached as null, not merely "not cached".
    const fetch_mock = stub_hub({ webos: "empty" });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));
    await waitFor(() => expect(within(card() as HTMLElement).getByText(/No message #171/)).toBeTruthy());
    fireEvent.mouseOut(chip("webos#171"));
    fireEvent.mouseOver(chip("webos#171"));
    await waitFor(() => expect(within(card() as HTMLElement).getByText(/No message #171/)).toBeTruthy());

    expect(message_gets(fetch_mock, "webos")).toBe(1);
  });

  it("says 'no such message' when the hub serves nothing for that seq", async () => {
    stub_hub({ webos: "empty" });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText(/No message #171 in #webos/)).toBeTruthy());
  });

  it("says it could not READ the room, which is not the same answer", async () => {
    // A room this seat is not in and a seq that does not exist both produce
    // an empty card if you collapse them. One is a permissions boundary and
    // the operator needs to see it as one.
    stub_hub({ webos: "forbidden" });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText(/Could not read #webos/)).toBeTruthy());
    expect(within(card() as HTMLElement).queryByText(/No message #171/)).toBeNull();
  });
});

describe("the card — thread state, not the posted word (operator dm 34)", () => {
  it("says RESOLVED for a root closed by a reply, though the root still says open", async () => {
    // laurent: "it is funny that you say you closed a message... and on the
    // mouse over we see that it is still opened". `commons#7` is posted
    // `open` and closed by `#8`; the card must report the THREAD.
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#7"));

    const c = await find_card();
    expect(within(c).getByText("resolved")).toBeTruthy();
    expect(within(c).queryByText("open")).toBeNull();
  });

  it("says OPEN when nothing closed it", async () => {
    // The control: without this, a card that never renders a state at all
    // would satisfy the test above.
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#5"));

    const c = await find_card();
    expect(within(c).getByText("open")).toBeTruthy();
  });

  it("says NOTHING about state for a cross-channel citation, because the replies are not in hand", async () => {
    // One message resolved from another room cannot show its trail. The
    // honest answer is silence; printing its posted word is exactly the
    // defect this whole describe exists for.
    //
    // This fixture omits `closed` entirely, so it now pins the OLDER-HUB
    // case specifically: silence is still right when the hub makes no
    // statement. The two tests below cover the hub that does.
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    const c = card() as HTMLElement;
    expect(within(c).queryByText("open")).toBeNull();
    expect(within(c).queryByText("resolved")).toBeNull();
  });

  // The hub now decorates every message row with its own discharge verdict
  // (`closed`, agora-and-wui#11), so the cross-channel silence above is no
  // longer the best available answer — it was a limit of the wire, not a
  // principle. Reading the verdict is also the only way to be RIGHT here: a
  // card that fetched the trail itself would still count a bystander's
  // `resolved` as a closure, which the hub's authority-aware computation
  // does not.
  it("says RESOLVED cross-channel when the HUB says the thread is closed", async () => {
    stub_hub({ webos_closed: true });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    const c = card() as HTMLElement;
    expect(within(c).getByText("resolved")).toBeTruthy();
    expect(within(c).queryByText("open")).toBeNull();
  });

  it("says OPEN cross-channel when the hub says NOT closed — not silence, and not the posted word by luck", async () => {
    // The control for the test above. It also pins the distinction that
    // makes the tri-state worth having: `closed: false` is a statement and
    // must render, while an absent field must not — and both rows carry the
    // identical posted status word `open`, so nothing here can pass by
    // reading that.
    stub_hub({ webos_closed: false });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    const c = card() as HTMLElement;
    expect(within(c).getByText("open")).toBeTruthy();
    expect(within(c).queryByText("resolved")).toBeNull();
  });

  it("stays silent cross-channel on an explicit null verdict — a retracted row states nothing", async () => {
    // `null` is not `false`. The hub says so explicitly, and reading it as
    // "open" would put a live-looking state on a row the hub declined to
    // judge.
    stub_hub({ webos_closed: null });
    await boot();

    fireEvent.mouseOver(chip("webos#171"));

    await waitFor(() => expect(within(card() as HTMLElement).getByText("Ownership change")).toBeTruthy());
    const c = card() as HTMLElement;
    expect(within(c).queryByText("open")).toBeNull();
    expect(within(c).queryByText("resolved")).toBeNull();
  });
});

describe("the chip — click opens the cited message (operator dm 34)", () => {
  it("jumps to a same-channel message and marks it", async () => {
    stub_hub();
    await boot();

    fireEvent.click(chip("#7"));

    await waitFor(() => expect(document.getElementById("hubmsg-commons-7")?.classList.contains("hit")).toBe(true));
    // The preview gets out of the way of the thing you just opened.
    expect(card()).toBeNull();
  });

  it("switches channel for a cross-channel citation", async () => {
    stub_hub();
    await boot();
    expect(screen.getByPlaceholderText(/Message #commons/)).toBeTruthy();

    fireEvent.click(chip("webos#171"));

    await screen.findByPlaceholderText(/Message #webos/);
  });

});

// NOT TESTED, deliberately: "clicking a chip must not also fold the thread
// it sits in". I wrote that test, mutated the stopPropagation away, and it
// stayed GREEN — because `row_click` already returns early for any click
// inside `.team_row_body`, which is where every chip lives. The guard on the
// chip handler is belt-and-braces over a guard that is already load-bearing,
// so no fixture reachable from this feed can fail on it. Recorded here rather
// than kept as a check that cannot go red.

describe("the card — dismissal", () => {
  it("closes when the pointer leaves the chip", async () => {
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#7"));
    await find_card();

    fireEvent.mouseOut(chip("#7"));
    await waitFor(() => expect(card()).toBeNull());
  });

  it("does NOT close when the pointer moves from the chip INTO the card", async () => {
    // Without this the card is unreadable: any card big enough to be worth
    // showing is big enough that you move onto it.
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#7"));
    const c = await find_card();

    fireEvent.mouseOut(chip("#7"), { relatedTarget: c });

    expect(card()).toBeTruthy();
  });

  it("closes on Escape", async () => {
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#7"));
    await find_card();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(card()).toBeNull());
  });

  it("closes when the feed scrolls, because the anchor was a viewport coordinate", async () => {
    stub_hub();
    await boot();

    fireEvent.mouseOver(chip("#7"));
    await find_card();

    const feed = document.querySelector(".team_thread") as HTMLElement;
    fireEvent.scroll(feed);
    await waitFor(() => expect(card()).toBeNull());
  });
});
