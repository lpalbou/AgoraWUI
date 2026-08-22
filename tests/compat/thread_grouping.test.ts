// group_threads is the layer under every thread-shape bug the operator
// reported on 2026-08-22 — what is a root, what is a reply, which trail a
// message belongs to, and what order the trails appear in. A mutation sweep
// that morning put it at 13 of 15 operator mutants SURVIVING the full suite:
// the only thing pointing at it was one retraction test that grouped a
// fixture and looked at the filter's output, which kills the mutants that
// change what is on screen in that one fixture and nothing else.
//
// The two mutants this file deliberately does NOT kill are named at the
// bottom, with the reason — they sit on a tiebreak that cannot be reached.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { HubMessage } from "../../src/lib/hub_client";
import { group_threads } from "../../src/lib/team_model";

function msg(seq: number, reply_to?: string): HubMessage {
  return {
    id: `m${seq}`,
    channel: "commons",
    seq,
    sender: "laurent",
    kind: "message",
    status: "fyi",
    reply_to: reply_to ?? null,
  } as HubMessage;
}

/** Read a numeric literal out of a source file, or throw NAMING what is
 *  missing. A reader that returns a default when the constant is gone would
 *  keep every assertion below green while measuring nothing — the exact
 *  failure this file exists to correct. */
function literal_from(path: string, name: string): number {
  const src = readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`${name} not found in ${path} — the constant this test measures against is gone, not zero`);
  return Number(m[1]);
}

describe("group_threads — what belongs to which trail", () => {
  it("collects replies under their root, in seq order, with the root excluded", () => {
    const threads = group_threads([msg(1), msg(2, "m1"), msg(3, "m1")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("m1");
    expect(threads[0].replies.map((r) => r.id)).toEqual(["m2", "m3"]);
    expect(threads[0].orphan).toBe(false);
    expect(threads[0].last_seq).toBe(3);
  });

  it("chains a reply-to-a-reply up to the OLDEST in-window ancestor", () => {
    // A trail is flat on screen: a reply four deep belongs to the same card
    // as a direct reply, not to a nested sub-thread.
    const threads = group_threads([msg(1), msg(2, "m1"), msg(3, "m2"), msg(4, "m3")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe("m1");
    expect(threads[0].replies.map((r) => r.id)).toEqual(["m2", "m3", "m4"]);
  });

  it("sorts replies by seq even when the window arrives out of order", () => {
    // The merge path appends fresh rows to a retained window, so the array
    // handed to this function is not guaranteed ordered.
    const threads = group_threads([msg(9, "m1"), msg(4, "m1"), msg(1), msg(7, "m4")]);
    expect(threads[0].replies.map((r) => r.seq)).toEqual([4, 7, 9]);
  });

  it("keeps separate roots as separate threads", () => {
    const threads = group_threads([msg(1), msg(2), msg(3, "m1")]);
    expect(threads.map((t) => t.root.id)).toEqual(["m2", "m1"]);
    expect(threads.map((t) => t.replies.length)).toEqual([0, 1]);
  });
});

describe("group_threads — the orphan label, which is a refusal to guess", () => {
  it("makes a reply whose parent left the window its own root, labeled orphan", () => {
    // m5 answers something older than the window floor. Silently promoting
    // it to a root would be indistinguishable from a real root; silently
    // attaching it to a nearby trail would be a lie about who said what.
    const threads = group_threads([msg(4), msg(5, "m-gone")]);
    expect(threads).toHaveLength(2);
    const orphan = threads.find((t) => t.root.id === "m5");
    expect(orphan?.orphan).toBe(true);
    expect(orphan?.replies).toEqual([]);
  });

  it("does not label an ordinary root as an orphan", () => {
    // The negative case: a predicate that always said `true` would satisfy
    // the test above on its own.
    const threads = group_threads([msg(1), msg(2, "m1")]);
    expect(threads[0].orphan).toBe(false);
  });

  it("does not label a thread orphan because one of its REPLIES is one", () => {
    // The flag describes the root's own provenance. An in-window root that
    // happens to collect a reply keeps a clean label.
    const threads = group_threads([msg(1), msg(2, "m1"), msg(3, "m-gone")]);
    expect(threads.find((t) => t.root.id === "m1")?.orphan).toBe(false);
    expect(threads.find((t) => t.root.id === "m3")?.orphan).toBe(true);
  });
});

describe("group_threads — order is LAST ACTIVITY, not root age", () => {
  // The operator's scroll anchor is the bottom of the feed. Ordering by root
  // seq made a fresh reply to an old root land off-screen above.
  const fixture = () => [
    msg(1), // T1 root — oldest root, freshest reply
    msg(2), // T3 root
    msg(8, "m2"), // T3 reply
    msg(20), // T2 standalone
    msg(25, "m1"), // T1 reply
  ];

  it("ranks a trail by its newest message, so a fresh reply sinks the whole trail", () => {
    const threads = group_threads(fixture());
    expect(threads.map((t) => t.root.id)).toEqual(["m2", "m20", "m1"]);
    expect(threads.map((t) => t.last_seq)).toEqual([8, 20, 25]);
  });

  it("gives a reply-less message its own seq as its last activity", () => {
    // m20 has no replies, so its position is its own seq — it must not sink
    // to the floor as if it had no activity at all.
    const threads = group_threads(fixture());
    expect(threads.find((t) => t.root.id === "m20")?.last_seq).toBe(20);
  });
});

describe("group_threads — the bounded walk, and the window it has to cover", () => {
  const PAGE_LIMIT = literal_from("src/ui/team_page.tsx", "PAGE_LIMIT");
  const MAX_CHAIN_HOPS = literal_from("src/lib/team_model.ts", "MAX_CHAIN_HOPS");

  /** The retained in-memory window, as team_page.tsx actually trims it. */
  const RETAINED = (() => {
    const src = readFileSync(resolve(import.meta.dirname, "../../src/ui/team_page.tsx"), "utf8");
    const m = src.match(/merged\.slice\(merged\.length - PAGE_LIMIT \* (\d+)\)/);
    if (!m) throw new Error("the PAGE_LIMIT * N window trim in team_page.tsx is gone — this test can no longer size the window it is checking");
    return PAGE_LIMIT * Number(m[1]);
  })();

  const chain = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? msg(1) : msg(i + 1, `m${i}`)));

  it("covers a chain as long as the window the page actually retains", () => {
    // THE SEAM, and it is tighter than the source comment admits: the walk
    // is capped at MAX_CHAIN_HOPS, the page keeps PAGE_LIMIT * N messages,
    // and a chain filling that window needs RETAINED - 1 hops. Raise the
    // retention or lower the cap and a fully in-window trail silently
    // splits in two — no error, no warning, just a thread that is suddenly
    // two threads. This assertion is what turns that into a red test.
    expect(MAX_CHAIN_HOPS).toBeGreaterThanOrEqual(RETAINED - 1);
    const threads = group_threads(chain(RETAINED));
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(RETAINED - 1);
  });

  it("degrades past the cap by splitting — and DUPLICATES the split points", () => {
    // Beyond the cap the walk stops early and the message roots itself at
    // the deepest ancestor it reached: a chain of L messages yields
    // 1 + (L - 1 - MAX_CHAIN_HOPS) trails. Pinning that exact count is what
    // stops the cap drifting by one and taking the window seam above with
    // it.
    //
    // The second assertion is the part nothing documented and I did not
    // predict: each truncation root ALSO remains a reply inside the deep
    // trail, because it is still within MAX_CHAIN_HOPS of the real root. So
    // it renders twice. Nothing is lost — the distinct set is complete —
    // but the row count exceeds the message count by exactly the number of
    // splits. Recorded as behaviour rather than smoothed over: it is
    // unreachable while the seam above holds, and it is what would appear
    // on screen the moment that seam breaks.
    const over = 3;
    const length = MAX_CHAIN_HOPS + 1 + over;
    const threads = group_threads(chain(length));
    expect(threads).toHaveLength(over + 1);

    const rows = threads.flatMap((t) => [t.root.id, ...t.replies.map((r) => r.id)]);
    expect(new Set(rows).size).toBe(length);
    expect(rows).toHaveLength(length + over);
  });

  it("terminates on a reply cycle in the wire data, and renders both sides", () => {
    // A cycle is not something the hub emits; the guarantee under test is
    // that malformed wire data cannot hang the feed. What it DOES produce
    // is worth stating rather than glossing: each message resolves to the
    // other as its root, so both appear — twice over, once as a root and
    // once as a reply. Bounded and visible beats a silent drop.
    const a = { ...msg(1), reply_to: "m2" } as HubMessage;
    const b = { ...msg(2), reply_to: "m1" } as HubMessage;
    const threads = group_threads([a, b]);
    expect(threads).toHaveLength(2);
    const ids = new Set(threads.flatMap((t) => [t.root.id, ...t.replies.map((r) => r.id)]));
    expect([...ids].sort()).toEqual(["m1", "m2"]);
  });
});

// ------------------------------------------------------------------------
// MEASURED, NOT KILLED. Two mutants in the final sort survive this file and
// will keep surviving: the `(a.root.seq || 0)` and `(b.root.seq || 0)`
// readers in the equal-last_seq tiebreak.
//
// They survive because the tiebreak cannot change the order. Threads are
// created while walking the window in ascending seq, so the Map's insertion
// order is already ascending by root seq, and sort is stable — the tiebreak
// only ever re-affirms the order the threads were already in. Reaching a
// case where it decides something needs a duplicate seq AND a reply whose
// seq is lower than its own root's, neither of which a hub emits.
//
// The honest conclusion is that the tiebreak is dead code, not that this
// file is missing two tests. Writing a fixture out of impossible data to
// turn the number green would be decoration, which is the thing this whole
// sweep exists to find.
