// The three functions behind the operator desk's own numbers — "N items
// wait on you", the escalation lane, and the "Needs vigilance" chip — had
// NO test pointing at them. A mutation sweep of src/lib/team_model.ts
// (2026-08-22) put debt_seqs_by_channel at 24/24 mutants surviving,
// escalated_seqs_by_channel at 6/6, and the vigilance predicate at 10/11:
// every operator instruction could have flipped and 194 tests stayed green.
//
// These are inbox-ENVELOPE classifiers, not message classifiers. The
// distinction is the whole subject: `to_me`, `addressed`, `escalated` and
// `effective_urgency` are the Hub's viewer-scoped verdicts and live only on
// /inbox rows. The rule this file pins is that the WUI CONSUMES those
// verdicts and re-derives them only when an older Hub omits them — a client
// that second-guesses a served verdict shows the operator a different debt
// list than the hub's own /owed.
import { describe, expect, it } from "vitest";

import type { HubMessage } from "../../src/lib/hub_client";
import { debt_seqs_by_channel, escalated_seqs_by_channel, msg_matches_filter, to_me_seqs_by_channel } from "../../src/lib/team_model";

const seqs = (r: Record<string, Set<number>>, c: string) => [...(r[c] ?? [])].sort((a, b) => a - b);

describe("debt_seqs_by_channel — which inbox rows a click cannot clear", () => {
  it("counts an open or blocked BROADCAST as owed by every member", () => {
    // addressed=false is the Hub saying "room-wide": nobody was singled
    // out, so it is on everyone's plate including this seat's.
    const rows = [
      { channel: "commons", seq: 10, status: "open", addressed: false },
      { channel: "commons", seq: 11, status: "blocked", addressed: false },
    ];
    expect(seqs(debt_seqs_by_channel(rows, "agora-wui"), "commons")).toEqual([10, 11]);
  });

  it("does NOT count an open row addressed to someone else", () => {
    // The row is open and it is in this seat's window, but the Hub picked a
    // different recipient. Counting it would put another seat's obligation
    // on this operator's desk — the failure this classifier exists to avoid.
    const rows = [{ channel: "commons", seq: 12, status: "open", addressed: true, to: ["agora-tui"], to_me: false }];
    expect(debt_seqs_by_channel(rows, "agora-wui").commons).toBeUndefined();
  });

  it("counts an addressed reply or fyi — the 0102 directives a read cannot discharge", () => {
    // These clear only on YOUR reply or an authoritative closure. The same
    // status word unaddressed is ordinary traffic (next case).
    const rows = [
      { channel: "commons", seq: 20, status: "reply", to_me: true },
      { channel: "commons", seq: 21, status: "fyi", to_me: true },
    ];
    expect(seqs(debt_seqs_by_channel(rows, "agora-wui"), "commons")).toEqual([20, 21]);
  });

  it("does NOT count an unaddressed reply or fyi", () => {
    const rows = [
      { channel: "commons", seq: 22, status: "reply", to_me: false },
      { channel: "commons", seq: 23, status: "fyi", addressed: false },
      { channel: "commons", seq: 24, status: "resolved", to_me: true },
    ];
    // A resolved row is not a debt whoever it names — it is the closure.
    expect(debt_seqs_by_channel(rows, "agora-wui").commons).toBeUndefined();
  });

  it("obeys a served to_me=false even when the stored `to` list names this seat", () => {
    // The Hub's routing verdict OUTRANKS the raw address list: a reply may
    // name you in `to` while the Hub has already settled that the duty sits
    // elsewhere. Re-deriving from `to` here is exactly the second-guess that
    // makes the console disagree with /owed.
    const rows = [{ channel: "commons", seq: 30, status: "reply", to: ["agora-wui"], to_me: false }];
    expect(debt_seqs_by_channel(rows, "agora-wui").commons).toBeUndefined();
  });

  it("counts a served to_me=true even when no `to` list exists — routed delegate duty", () => {
    // The case the raw list CANNOT express: hub-routed operator work, with
    // `to` intentionally absent. The fallback must not be reached.
    const rows = [{ channel: "commons", seq: 31, status: "reply", to_me: true }];
    expect(seqs(debt_seqs_by_channel(rows, "agora-wui"), "commons")).toEqual([31]);
  });

  it("falls back to the raw `to` list only when the Hub omits to_me", () => {
    // Older Hub: no verdict served, so the address list is all there is.
    const legacy = [
      { channel: "commons", seq: 40, status: "reply", to: ["agora-wui"] },
      { channel: "commons", seq: 41, status: "reply", to: ["agora-tui"] },
      { channel: "commons", seq: 42, status: "reply" },
      { channel: "commons", seq: 43, status: "open", to: [] },
    ];
    // 40 is addressed to this seat; 41 is someone else's; 42 carries no list
    // at all and is ordinary traffic; 43 is an open with an EMPTY list, which
    // is what a broadcast looks like before `addressed` existed.
    expect(seqs(debt_seqs_by_channel(legacy, "agora-wui"), "commons")).toEqual([40, 43]);
  });

  it("treats an addressed row with no `to` list as addressed, not as a broadcast", () => {
    // addressed=true and to_me=false together mean "singled out, not you".
    // Reading the missing `to` as "nobody named → broadcast" would hand this
    // seat a duty the Hub explicitly routed away from it.
    const rows = [{ channel: "commons", seq: 50, status: "open", addressed: true, to_me: false }];
    expect(debt_seqs_by_channel(rows, "agora-wui").commons).toBeUndefined();
  });

  it("drops rows with no channel or no numeric seq, and keeps channels apart", () => {
    // A debt the row cannot point at is unusable: the console navigates by
    // (channel, seq). Both halves of the guard are load-bearing.
    const rows = [
      { channel: "", seq: 60, status: "open", addressed: false },
      { channel: "commons", status: "open", addressed: false },
      { channel: "commons", seq: Number.NaN, status: "open", addressed: false },
      { channel: "commons", seq: 61, status: "open", addressed: false },
      { channel: "webos", seq: 61, status: "open", addressed: false },
    ];
    const out = debt_seqs_by_channel(rows, "agora-wui");
    expect(Object.keys(out).sort()).toEqual(["commons", "webos"]);
    expect(seqs(out, "commons")).toEqual([61]);
    expect(seqs(out, "webos")).toEqual([61]);
  });
});

describe("to_me_seqs_by_channel — the same served-verdict rule, on the sibling classifier", () => {
  // Identical shape to the debt classifier and identically unguarded: this
  // is the set the @me chip and the row cue read.
  it("takes the Hub's to_me verdict", () => {
    const rows = [{ channel: "commons", seq: 80, to_me: true }];
    expect(seqs(to_me_seqs_by_channel(rows, "agora-wui"), "commons")).toEqual([80]);
  });

  it("obeys a served to_me=false even when `to` names this seat", () => {
    // The routing verdict outranks the address list here exactly as it does
    // for debts — otherwise the @me chip and the Hub disagree about whose
    // message it is.
    const rows = [{ channel: "commons", seq: 81, to_me: false, to: ["agora-wui"] }];
    expect(to_me_seqs_by_channel(rows, "agora-wui").commons).toBeUndefined();
  });

  it("falls back to the raw `to` list only when the Hub omits the verdict", () => {
    const legacy = [
      { channel: "commons", seq: 82, to: ["agora-wui"] },
      { channel: "commons", seq: 83, to: ["agora-tui"] },
      { channel: "commons", seq: 84 },
    ];
    expect(seqs(to_me_seqs_by_channel(legacy, "agora-wui"), "commons")).toEqual([82]);
  });

  it("drops rows with no channel or no numeric seq", () => {
    const rows = [
      { channel: "", seq: 85, to_me: true },
      { channel: "commons", to_me: true },
      { channel: "commons", seq: 86, to_me: true },
    ];
    const out = to_me_seqs_by_channel(rows, "agora-wui");
    expect(Object.keys(out)).toEqual(["commons"]);
    expect(seqs(out, "commons")).toEqual([86]);
  });
});

describe("escalated_seqs_by_channel — the lane the Hub raised, not one the client guessed", () => {
  it("takes an explicit escalation whatever the lane says", () => {
    const rows = [{ channel: "commons", seq: 70, escalated: true, effective_urgency: "inbox" }];
    expect(seqs(escalated_seqs_by_channel(rows), "commons")).toEqual([70]);
  });

  it("takes an interrupt lane even when the row was never escalated", () => {
    // Two independent routes in: posted AT interrupt, or escalated INTO it.
    const rows = [{ channel: "commons", seq: 71, escalated: false, effective_urgency: "interrupt" }];
    expect(seqs(escalated_seqs_by_channel(rows), "commons")).toEqual([71]);
  });

  it("leaves ordinary rows alone", () => {
    const rows = [
      { channel: "commons", seq: 72, escalated: false, effective_urgency: "inbox" },
      { channel: "commons", seq: 73, effective_urgency: "next_turn" },
      { channel: "commons", seq: 74 },
    ];
    expect(escalated_seqs_by_channel(rows).commons).toBeUndefined();
  });

  it("drops rows with no channel or no numeric seq", () => {
    const rows = [
      { channel: "", seq: 75, escalated: true },
      { channel: "commons", escalated: true },
      { channel: "commons", seq: 76, escalated: true },
    ];
    const out = escalated_seqs_by_channel(rows);
    expect(Object.keys(out)).toEqual(["commons"]);
    expect(seqs(out, "commons")).toEqual([76]);
  });
});

// --------------------------------------------------------------- vigilance

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

/** Every axis quiet: nothing in the context, nothing on the message. */
const QUIET = { seat: SEAT };

describe("the vigilance predicate — four independent axes, each sufficient alone", () => {
  it("says nothing needs vigilance when every axis is quiet", () => {
    // The negative case is the one that makes the positives mean something:
    // a predicate that is always true would pass all four tests below.
    expect(msg_matches_filter(msg({ seq: 1, status: "fyi" }), "vigilance", QUIET)).toBe(false);
    expect(msg_matches_filter(msg({ seq: 2, status: "resolved" }), "vigilance", QUIET)).toBe(false);
  });

  it("axis 1 — an unanswered ask, taken from the Hub's own /owed verdict", () => {
    const ctx = { seat: SEAT, debt_seqs: new Set([3]) };
    // Status is fyi: the row qualifies on the SERVED verdict alone, which is
    // the point — the Hub settles discharge with rules a client cannot see.
    expect(msg_matches_filter(msg({ seq: 3, status: "fyi" }), "vigilance", ctx)).toBe(true);
    // And a status=open message the Hub does NOT list as owed stays out.
    // Re-deriving from the status word here would resurrect settled asks.
    expect(msg_matches_filter(msg({ seq: 4, status: "open" }), "vigilance", ctx)).toBe(false);
  });

  it("axis 1 fallback — no served verdict, so open/blocked minus a resolving reply", () => {
    expect(msg_matches_filter(msg({ seq: 5, status: "open" }), "vigilance", QUIET)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 6, status: "blocked" }), "vigilance", QUIET)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 7, status: "open", has_resolved_reply: true }), "vigilance", QUIET)).toBe(false);
    expect(msg_matches_filter(msg({ seq: 8, status: "open", has_resolved_reply: false }), "vigilance", QUIET)).toBe(true);
  });

  it("axis 2 — a critical message, whatever its status", () => {
    expect(msg_matches_filter(msg({ seq: 9, status: "fyi", critical: true }), "vigilance", QUIET)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 10, status: "fyi", critical: false }), "vigilance", QUIET)).toBe(false);
  });

  it("axis 3 — addressed to this seat, by the stored list or by the Hub's cue", () => {
    expect(msg_matches_filter(msg({ seq: 11, status: "fyi", to: [SEAT] }), "vigilance", QUIET)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 12, status: "fyi", to: ["agora-tui"] }), "vigilance", QUIET)).toBe(false);
    // The Hub cue covers routed duties the stored list cannot express.
    const ctx = { seat: SEAT, to_me_seqs: new Set([13]) };
    expect(msg_matches_filter(msg({ seq: 13, status: "fyi", to: [] }), "vigilance", ctx)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 14, status: "fyi", to: [] }), "vigilance", ctx)).toBe(false);
  });

  it("axis 4 — escalated by the Hub, which is invisible on the message itself", () => {
    const ctx = { seat: SEAT, escalated_seqs: new Set([15]) };
    expect(msg_matches_filter(msg({ seq: 15, status: "fyi" }), "vigilance", ctx)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 16, status: "fyi" }), "vigilance", ctx)).toBe(false);
  });

  it("a retracted row leaves vigilance even while every axis still points at it", () => {
    // The retraction's whole point: nothing demands attention for the words
    // anymore. This is the one gate that overrides all four axes.
    const ctx = { seat: SEAT, debt_seqs: new Set([17]), escalated_seqs: new Set([17]) };
    const m = msg({ seq: 17, status: "open", critical: true, to: [SEAT], retracted: true });
    expect(msg_matches_filter(m, "vigilance", ctx)).toBe(false);
  });
});
