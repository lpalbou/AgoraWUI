// The filter chips above the feed. A mutation sweep of src/lib/team_model.ts
// (2026-08-22) left five operator mutants alive in three of the arms —
// Unread's snapshot union, Asks's discharge reading, and Resolved's closure
// reading. They survived because the only thing exercising these arms was
// the UI test clicking the chips against one fixture: that kills whatever
// changes the rendered list for THAT data and nothing else.
//
// All three arms share one subject, which is why they share a file: each
// consumes a verdict the Hub computed and must not re-derive it from the
// status word. A settled ask keeps status=open; a closed thread's root
// keeps whatever status it was posted with.
import { describe, expect, it } from "vitest";

import type { HubMessage } from "../../src/lib/hub_client";
import { filter_threads, group_threads, msg_matches_filter } from "../../src/lib/team_model";

const SEAT = "agora-wui";

function msg(over: Partial<HubMessage> & { seq: number }): HubMessage {
  return {
    id: `m${over.seq}`,
    channel: "commons",
    sender: "laurent",
    kind: "message",
    status: "fyi",
    ...over,
  } as HubMessage;
}

describe("Unread — snapshot UNION live, so a message cannot vanish while you read it", () => {
  // Operator dm 63: clicking a message fired the read, the live unread set
  // shrank, and the thread disappeared from under him mid-read. The filter
  // matches the set as it was when the filter was ENTERED, unioned with the
  // live set — so a just-read message stays put until the filter is left,
  // while genuinely new arrivals still appear.
  const ctx = { seat: SEAT, unread_seqs: new Set([2, 3]), unread_snapshot_seqs: new Set([1, 2]) };

  it("keeps a message that was unread on entry but has since been read", () => {
    // Live-set-only would drop seq 1 the instant it was read. This is the
    // union's whole reason to exist.
    expect(msg_matches_filter(msg({ seq: 1 }), "unread", ctx)).toBe(true);
  });

  it("shows a message that arrived AFTER the filter was entered", () => {
    // Snapshot-only would hide seq 3, which is the opposite failure.
    expect(msg_matches_filter(msg({ seq: 3 }), "unread", ctx)).toBe(true);
  });

  it("matches one in both, and excludes one in neither", () => {
    expect(msg_matches_filter(msg({ seq: 2 }), "unread", ctx)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 9 }), "unread", ctx)).toBe(false);
  });

  it("has nothing to show when the context carries no unread sets at all", () => {
    expect(msg_matches_filter(msg({ seq: 1 }), "unread", { seat: SEAT })).toBe(false);
  });
});

describe("Asks — the Hub's discharge verdict, not the status word", () => {
  // A settled ask KEEPS status=open. The hub says it is done by emptying
  // pending_asks and setting has_resolved_reply. Reading the status alone
  // is how a discharged thread stays on the operator's Asks tab forever.
  it("lists an open message with asks still pending", () => {
    expect(msg_matches_filter(msg({ seq: 1, status: "open", pending_asks: ["1"] }), "asks", { seat: SEAT })).toBe(true);
  });

  it("drops an open message whose asks have all been answered", () => {
    // pending_asks: [] is the discharge. THIS is the case the sweep found
    // unguarded — `> 0` versus `>= 0` is one character and inverts it.
    expect(msg_matches_filter(msg({ seq: 2, status: "open", pending_asks: [] }), "asks", { seat: SEAT })).toBe(false);
  });

  it("drops an open message that already has a resolving reply", () => {
    expect(msg_matches_filter(msg({ seq: 3, status: "open", has_resolved_reply: true }), "asks", { seat: SEAT })).toBe(false);
  });

  it("keeps a blocked message, and falls back to the status when the Hub says nothing", () => {
    // Older Hub: no pending_asks field, so an open/blocked message is taken
    // at its word rather than silently dropped.
    expect(msg_matches_filter(msg({ seq: 4, status: "blocked", pending_asks: ["1"] }), "asks", { seat: SEAT })).toBe(true);
    expect(msg_matches_filter(msg({ seq: 5, status: "open" }), "asks", { seat: SEAT })).toBe(true);
  });

  it("never lists traffic that expects no answer", () => {
    expect(msg_matches_filter(msg({ seq: 6, status: "fyi" }), "asks", { seat: SEAT })).toBe(false);
    expect(msg_matches_filter(msg({ seq: 7, status: "reply" }), "asks", { seat: SEAT })).toBe(false);
  });
});

describe("Resolved — closure by either route, and only on the root", () => {
  it("matches a root posted resolved", () => {
    // Closed by construction, with no reply needed.
    expect(msg_matches_filter(msg({ seq: 1, status: "resolved" }), "resolved", { seat: SEAT })).toBe(true);
  });

  it("matches an open root the Hub says has a resolving reply", () => {
    // The other route in. Both are needed; either alone is half the filter.
    expect(msg_matches_filter(msg({ seq: 2, status: "open", has_resolved_reply: true }), "resolved", { seat: SEAT })).toBe(true);
  });

  it("does not match an open root that is still owed", () => {
    expect(msg_matches_filter(msg({ seq: 3, status: "open", has_resolved_reply: false }), "resolved", { seat: SEAT })).toBe(false);
    expect(msg_matches_filter(msg({ seq: 4, status: "fyi" }), "resolved", { seat: SEAT })).toBe(false);
  });

  it("does not file an open thread under Resolved because a BYSTANDER replied resolved", () => {
    // Closure is a property of the thread, so the filter reads the root
    // alone. Matching any reply's status word filed escalating threads
    // under Resolved because one onlooker answered with status=resolved.
    const threads = group_threads([
      msg({ seq: 1, status: "open", pending_asks: ["1"] }),
      msg({ seq: 2, status: "resolved", reply_to: "m1" }),
    ]);
    expect(filter_threads(threads, "resolved", { seat: SEAT })).toEqual([]);
    // ...and the same thread is still listed as an open ask, which is the
    // half that makes the exclusion above meaningful rather than merely a
    // filter that shows nothing.
    expect(filter_threads(threads, "asks", { seat: SEAT })).toHaveLength(1);
  });

  it("keeps a thread under Resolved when the ROOT itself carries the closure", () => {
    const threads = group_threads([
      msg({ seq: 1, status: "open", has_resolved_reply: true }),
      msg({ seq: 2, status: "reply", reply_to: "m1" }),
    ]);
    expect(filter_threads(threads, "resolved", { seat: SEAT })).toHaveLength(1);
  });
});

describe("Retracted rows leave every lens except All and Unread", () => {
  // agora 0097: the hub tombstones the words. All keeps it as a dimmed row
  // for transcript integrity, and Unread keeps it while genuinely unread so
  // the badge count stays locatable (reading the tombstone clears it).
  // Every triage lens drops it — nothing demands attention any more.
  const ctx = { seat: SEAT, unread_seqs: new Set([1]) };
  const gone = msg({ seq: 1, status: "open", critical: true, to: [SEAT], retracted: true, pending_asks: ["1"] });

  it("stays in All and in Unread", () => {
    expect(msg_matches_filter(gone, "all", ctx)).toBe(true);
    expect(msg_matches_filter(gone, "unread", ctx)).toBe(true);
  });

  it("leaves Asks, @me and Resolved even though each axis still points at it", () => {
    expect(msg_matches_filter(gone, "asks", ctx)).toBe(false);
    expect(msg_matches_filter(gone, "to_me", ctx)).toBe(false);
    expect(msg_matches_filter(gone, "resolved", ctx)).toBe(false);
  });

  it("drops out of Unread once read, unlike a live obligation", () => {
    expect(msg_matches_filter(gone, "unread", { seat: SEAT })).toBe(false);
  });
});
