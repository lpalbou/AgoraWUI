// @vitest-environment jsdom
//
// The composer draft store — the safety net under "not one keystroke lost".
//
// WHY THIS FILE EXISTS. On 2026-08-22 the operator reported the chat pane
// blanking and repopulating while he was typing into it. The cause was HMR
// remounting TeamPage (another seat writing to src/ under a live dev
// server), and the reason it cost him nothing is this feature: the in-flight
// draft is mirrored to localStorage, so a remount, a reload, a crash or a
// tab close restores what was in the box. That makes this the one region
// where a silent defect is measured in the operator's own typing.
//
// It had ZERO tests. Not thin ones — none: `grep -rn draft tests/` returned
// only the file-viewer's unrelated edit buffer.
//
// WHAT THE STATE MACHINE IS. Four writers, and they do not share a path:
//   * a 300ms debounce on [text, title, kind, selected] — the common case;
//   * the channel-switch effect, which PARKS the outgoing channel's draft
//     before the debounce could and RESTORES the incoming one;
//   * a synchronous flush on `pagehide`/`beforeunload` and on unmount, which
//     exists precisely because a debounce cannot run during a reload;
//   * the send path, which deletes the key so a sent draft cannot resurrect.
// Each is the only writer for its trigger, so each needs its own
// discriminating fixture. A test that types and waits exercises exactly one
// of the four and looks like coverage of all of them.
//
// THE CONTROL DISCIPLINE. The debounce makes "the value is in localStorage"
// a claim that comes true on its own after 300ms, which would let every
// flush test pass with its flush deleted. So the flush tests assert the
// NEGATIVE first — nothing written yet, inside the debounce window — and
// only then fire the event. Without that control they are decoration.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPage } from "../../src/ui/team_page";

/** The key the component owns. Read from the source's own constant would be
 *  better, but it is module-private; a mismatch here shows up as every test
 *  in the file failing at once, which is loud enough. */
const DRAFTS_KEY = "agora_wui_team_drafts_v1";
const SEAT = "laurent";
/** `commons` is the NEWEST — the page opens the newest readable channel, and
 *  every test here starts by assuming it landed there. */
const CHANNELS = [
  { name: "commons", private: false, member: true, member_count: 3, last_seq: 2, last_at: 20 },
  { name: "ops", private: true, member: true, member_count: 2, last_seq: 2, last_at: 10 },
];

const original_create_object_url = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:draft-test" });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  if (original_create_object_url) Object.defineProperty(URL, "createObjectURL", original_create_object_url);
  else delete (URL as any).createObjectURL;
});

type Opts = {
  /** Held open, the POST never resolves until you call the returned
   *  `release`. This is the only way to reach the states that exist only
   *  WHILE a post is in flight. */
  defer_post?: boolean;
};

type Stub = {
  fetch_mock: ReturnType<typeof vi.fn>;
  release_post: () => void;
  posts: () => Array<{ channel: string; body: any }>;
  dm_posts: () => Array<{ peer: string; body: any }>;
};

function stub_hub(opts: Opts = {}): Stub {
  let release: () => void = () => undefined;
  const gate = opts.defer_post
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();

  const fetch_mock = vi.fn(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url || "");
    const method = String(init?.method || "GET");
    if (url.includes("/whoami")) return new Response(JSON.stringify({ id: SEAT }), { status: 200 });
    if (url.includes("/healthz")) {
      return new Response(JSON.stringify({ ok: true, version: "0.17.0", protocol: "agora/0.4", paused: false }), { status: 200 });
    }
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
      return new Response(
        JSON.stringify({ channel: { name: "commons", private: false }, meta: {}, members: [SEAT, "core"], response_sla_minutes: 1440, state: "open", charter: null }),
        { status: 200 }
      );
    }
    if (url.includes("/channels") && url.includes("/members")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/blocks")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.match(/\/channels\/[^/]+\/fs$/)) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/channels") && url.includes("/messages") && method === "POST") {
      await gate;
      return new Response(JSON.stringify({ id: "posted", seq: 3 }), { status: 200 });
    }
    if (url.includes("/channels") && url.includes("/messages") && method === "GET") {
      const chan = /\/channels\/([^/]+)\/messages/.exec(url)?.[1] || "commons";
      return new Response(
        JSON.stringify([
          { id: `${chan}-m1`, seq: 1, channel: chan, sender: "core", status: "fyi", kind: "message", urgency: "inbox", created_at: 1, data: null, title: `${chan} topic`, body: "b", reply_to: null },
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith("/presence")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.endsWith("/channels")) return new Response(JSON.stringify(CHANNELS), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch_mock);

  return {
    fetch_mock,
    release_post: () => release(),
    posts: () =>
      fetch_mock.mock.calls
        .filter(([u, i]: any[]) => /\/channels\/[^/]+\/messages/.test(String(u)) && String(i?.method || "GET") === "POST")
        .map(([u, i]: any[]) => ({ channel: /\/channels\/([^/]+)\/messages/.exec(String(u))?.[1] || "", body: JSON.parse(String(i?.body || "{}")) })),
    dm_posts: () =>
      fetch_mock.mock.calls
        .filter(([u, i]: any[]) => /\/dms\/[^/]+\/messages/.test(String(u)) && String(i?.method || "GET") === "POST")
        .map(([u, i]: any[]) => ({ peer: decodeURIComponent(/\/dms\/([^/]+)\/messages/.exec(String(u))?.[1] || ""), body: JSON.parse(String(i?.body || "{}")) })),
  };
}

/** What is actually on disk, as the next page load would read it. */
function stored(): Record<string, { text: string; title: string; kind: string }> {
  const raw = window.localStorage.getItem(DRAFTS_KEY);
  return raw ? JSON.parse(raw) : {};
}

function composer(channel: string): HTMLTextAreaElement {
  return screen.getByPlaceholderText(new RegExp(`Message #${channel}`)) as HTMLTextAreaElement;
}

async function open_channel(name: string): Promise<void> {
  const row = Array.from(document.querySelectorAll(".team_channel")).find((el) => el.textContent?.includes(`#${name}`));
  if (!row) throw new Error(`no rail row for #${name} — the rail markup or the fixture changed`);
  fireEvent.click(row);
  await screen.findByPlaceholderText(new RegExp(`Message #${name}`));
}

/** Longer than the component's 300ms debounce, short enough to keep the
 *  suite quick. Used only where waiting IS the thing under test. */
const PAST_DEBOUNCE = { timeout: 1500 };

describe("the debounce writer — the common case", () => {
  it("mirrors the in-flight text to localStorage, keyed by channel", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    // CONTROL: nothing is stored before anything is typed, so the assertion
    // below cannot be satisfied by a pre-seeded or shared key.
    expect(stored()).toEqual({});

    fireEvent.change(composer("commons"), { target: { value: "half a sentence" } });
    await waitFor(() => expect(stored().commons?.text).toBe("half a sentence"), PAST_DEBOUNCE);
  });

  it("prunes the channel's key when the composer is emptied, rather than storing a blank", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "typed then thought better of it" } });
    await waitFor(() => expect(stored().commons).toBeTruthy(), PAST_DEBOUNCE);

    fireEvent.change(composer("commons"), { target: { value: "" } });
    // The key is GONE, not present-and-empty: an accumulating store of blank
    // channels is the thing the prune exists to prevent, and `{text:""}` is
    // truthy enough to defeat a `stored().commons` check on its own.
    await waitFor(() => expect(Object.keys(stored())).not.toContain("commons"), PAST_DEBOUNCE);
  });

  it("restores a stored draft into the composer on mount — the reload case, end to end", async () => {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ commons: { text: "survived the reload", title: "and its title", kind: "fyi" } }));
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);

    const box = await screen.findByPlaceholderText(/Message #commons/);
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe("survived the reload"));
  });
});

describe("the channel-switch writer — park and restore", () => {
  it("parks the outgoing draft and restores the incoming one, both directions", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "for the commons" } });
    await open_channel("ops");

    // Parked on the way out, and the new channel's box is EMPTY rather than
    // carrying the previous room's text — the "one global draft silently
    // retargeted" failure the per-channel store exists to prevent.
    expect(stored().commons?.text).toBe("for the commons");
    expect(composer("ops").value).toBe("");

    fireEvent.change(composer("ops"), { target: { value: "for ops only" } });
    await open_channel("commons");

    expect(stored().ops?.text).toBe("for ops only");
    await waitFor(() => expect(composer("commons").value).toBe("for the commons"));
  });

  it("parks synchronously on the switch — not on the debounce that the switch cancels", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "typed and immediately abandoned" } });
    // CONTROL: still inside the 300ms window, so the debounce has NOT run.
    // This is what makes the assertion after the switch attributable to the
    // park and not to the timer firing on its own.
    expect(stored().commons).toBeUndefined();

    await open_channel("ops");
    expect(stored().commons?.text).toBe("typed and immediately abandoned");
  });

  it("drops the outgoing key when its composer was left empty", async () => {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ commons: { text: "stale", title: "", kind: "fyi" } }));
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);
    await waitFor(() => expect(composer("commons").value).toBe("stale"));

    fireEvent.change(composer("commons"), { target: { value: "" } });
    await open_channel("ops");
    expect(Object.keys(stored())).not.toContain("commons");
  });
});

describe("the synchronous flush — what a debounce cannot do during a reload", () => {
  it("pagehide writes the keystrokes typed inside the debounce window", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "last words before the reload" } });
    // CONTROL, and the whole point of the test: the debounce has not fired,
    // so if the flush listener were removed this would still be undefined
    // one line later. Asserting only the post-pagehide state would pass on
    // a 300ms timer with no flush at all.
    expect(stored().commons).toBeUndefined();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(stored().commons?.text).toBe("last words before the reload");
  });

  it("beforeunload flushes too — the reload path that never fires pagehide", async () => {
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "closing the tab" } });
    expect(stored().commons).toBeUndefined();

    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(stored().commons?.text).toBe("closing the tab");
  });

  it("unmount flushes — an in-app page hop cancels the debounce, and must not eat the text", async () => {
    stub_hub();
    const view = render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "typed on the way to the Board tab" } });
    expect(stored().commons).toBeUndefined();

    view.unmount();
    expect(stored().commons?.text).toBe("typed on the way to the Board tab");
  });

  it("a flush with nothing typed prunes rather than writing an empty row", async () => {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ commons: { text: "was there", title: "", kind: "fyi" } }));
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);
    await waitFor(() => expect(composer("commons").value).toBe("was there"));

    fireEvent.change(composer("commons"), { target: { value: "" } });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(Object.keys(stored())).not.toContain("commons");
  });
});

describe("corrupt storage — the load path must not take the page down with it", () => {
  it("starts empty on unparseable JSON instead of throwing during the first render", async () => {
    window.localStorage.setItem(DRAFTS_KEY, "{not json at all");
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);

    // Rendering at all IS the assertion — load_drafts runs in a useRef
    // initialiser, so a throw there is an unmounted white page, not a
    // degraded composer.
    const box = await screen.findByPlaceholderText(/Message #commons/);
    expect((box as HTMLTextAreaElement).value).toBe("");
    // And the store still works afterwards: a corrupt read must not leave
    // the writer poisoned.
    fireEvent.change(box, { target: { value: "still typeable" } });
    await waitFor(() => expect(stored().commons?.text).toBe("still typeable"), PAST_DEBOUNCE);
  });

  it("survives a JSON scalar where an object was expected", async () => {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify("a string, not a map"));
    stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    const box = await screen.findByPlaceholderText(/Message #commons/);
    expect((box as HTMLTextAreaElement).value).toBe("");
  });
});

describe("the send writer — a sent draft must not resurrect", () => {
  it("deletes the channel's draft once the post lands", async () => {
    const hub = stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "this one actually goes out" } });
    await waitFor(() => expect(stored().commons?.text).toBe("this one actually goes out"), PAST_DEBOUNCE);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(hub.posts()).toHaveLength(1));
    expect(hub.posts()[0].channel).toBe("commons");
    await waitFor(() => expect(Object.keys(stored())).not.toContain("commons"), PAST_DEBOUNCE);
  });

  it("does not wipe the OTHER channel's draft when the operator switches while a post is in flight", async () => {
    // The state this pins exists only WHILE a post is unresolved, which is
    // why the fixture holds the POST open. Every other actor on this path
    // (refresh_messages, the rail correction, the read cursor) is guarded by
    // the chan_gen generation counter; the composer reset was the one that
    // was not, so a slow hub — the operator's has stalled before — turned a
    // channel switch into silent loss of the draft he switched TO.
    const hub = stub_hub({ defer_post: true });
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    fireEvent.change(composer("commons"), { target: { value: "the message being sent" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(hub.posts()).toHaveLength(1));

    // Switch away while it hangs, and type into the room switched to.
    await open_channel("ops");
    fireEvent.change(composer("ops"), { target: { value: "a second draft, typed while the first is in flight" } });
    await waitFor(() => expect(stored().ops?.text).toBe("a second draft, typed while the first is in flight"), PAST_DEBOUNCE);

    // Now the commons post lands.
    await act(async () => {
      hub.release_post();
      await Promise.resolve();
    });

    // On screen: what the operator is looking at and still typing.
    await waitFor(() => expect(composer("ops").value).toBe("a second draft, typed while the first is in flight"));
    // And on disk, past the debounce the reset would have triggered — the
    // screen alone is not enough, because an emptied box prunes the key 300ms
    // later and the loss only becomes permanent then.
    await new Promise((r) => setTimeout(r, 500));
    expect(stored().ops?.text).toBe("a second draft, typed while the first is in flight");
    // The SENT channel's draft is still correctly cleared — the fix must not
    // buy safety by skipping the cleanup it was there to do.
    expect(Object.keys(stored())).not.toContain("commons");
  });

  it("still clears the RECIPIENT when the send itself navigates — the dm lane", async () => {
    // THE CONTROL ON MY OWN GUARD. The guard keys on chan_gen, and the dm
    // lane calls set_selected on its way out — a deliberate navigation by
    // this same handler, which must not be mistaken for the operator
    // switching rooms, or the fix trades a rare data loss for a reset that
    // never runs.
    //
    // The obvious version of this test — "the textarea is empty afterwards"
    // — is DECORATION, and I only know that because I wrote it and mutated
    // the guard to `if (false)`: it stayed GREEN. The channel-switch effect
    // restores the destination's draft on arrival, so the box comes back
    // empty whether the reset ran or not. Two writers, one observable.
    //
    // `dm_peer` is the one piece of composer state the reset clears and the
    // switch does not touch (grep: set_dm_peer has exactly one non-onChange
    // caller). Its source comment says why it matters — "a stale recipient
    // must never ride into the next send" — so this asserts the documented
    // consequence rather than a symptom two writers share.
    const hub = stub_hub();
    render(<TeamPage advisor={vi.fn(async () => "s")} />);
    await screen.findByPlaceholderText(/Message #commons/);

    const pick_dm = () => fireEvent.change(document.querySelector(".team_kind_select") as HTMLSelectElement, { target: { value: "dm" } });
    const peer_control = () => document.querySelector(".team_dm_peer") as HTMLInputElement | HTMLSelectElement | null;

    pick_dm();
    const peer = peer_control();
    if (!peer) throw new Error("no dm recipient control — the composer layout changed");
    fireEvent.change(peer, { target: { value: "core" } });
    fireEvent.change(document.querySelector("textarea.team_compose_text") as HTMLTextAreaElement, { target: { value: "a private word" } });

    // The button relabels with the kind — "Send DM" here, which is itself
    // the confirmation that the selector change took.
    fireEvent.click(screen.getByRole("button", { name: "Send DM" }));
    // The dm door is its own endpoint (`/dms/<peer>/messages`), not a channel
    // post — so this asserts against the URL the client actually calls.
    await waitFor(() => expect(hub.dm_posts()).toHaveLength(1));
    expect(hub.dm_posts()[0].peer).toBe("core");

    // Back to a regular room, where the recipient control is rendered again.
    await open_channel("commons");
    pick_dm();
    await waitFor(() => expect(peer_control()?.value).toBe(""));
  });
});
