// IS THIS THREAD SETTLED? One question, and until now four call sites
// answered it from a field that answers a DIFFERENT one.
//
// `has_resolved_reply` says a resolving reply EXISTS downthread. It is not
// the closure verdict: a BYSTANDER posting `resolved` sets it and closes
// nothing (agora ADR-0003, stated by the hub seat at agora-and-wui#11). The
// hub's own authority-aware `_discharge` computation now rides every message
// row as `closed` / `closed_by`, so the console can render the verdict
// instead of approximating it.
//
// What that mistake actually cost, and what these tests pin:
//   - the Asks lens DROPPED a live ask the moment any bystander replied
//     `resolved` — the ask still needed an answer and stopped being listed;
//   - the Resolved lens FILED that same thread as closed;
//   - vigilance's fallback went quiet on it;
//   - and `msg_is_resolved` took the Resolve button away from the seat whose
//     thread it was, so the one seat entitled to close it could not.
//
// The three-state contract matters as much as the happy path. `closed: null`
// means the hub made NO STATEMENT — a retracted row, or a hub older than the
// field — and must never be read as "open". Every arm therefore keeps an
// explicit legacy fallback, and the fallback's own over-reporting is pinned
// here too, so nobody later "fixes" it into silence.
import { describe, expect, it } from "vitest";

import type { HubMessage } from "../../src/lib/hub_client";
import { hub_closed_verdict, msg_matches_filter, msg_thread_closed } from "../../src/lib/team_model";

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

/** The exact shape the defect needed: the hub says NOT closed, while a
 *  bystander's resolved reply has set has_resolved_reply. Before the fix
 *  every arm below read the second field and got the wrong answer. */
function bystander_resolved(seq: number, over: Partial<HubMessage> = {}): HubMessage {
  return msg({ seq, status: "open", closed: false, has_resolved_reply: true, ...over });
}

describe("hub_closed_verdict — three states, and null is not 'open'", () => {
  it("reports the hub's true and false verdicts as themselves", () => {
    expect(hub_closed_verdict(msg({ seq: 1, closed: true }))).toBe(true);
    expect(hub_closed_verdict(msg({ seq: 2, closed: false }))).toBe(false);
  });

  it("reports NO STATEMENT for null, for undefined, and for a row that omits the field", () => {
    // A hub older than the field and a retracted row both land here. Reading
    // either as a verdict is the bug this tri-state exists to prevent.
    expect(hub_closed_verdict(msg({ seq: 3, closed: null }))).toBeUndefined();
    expect(hub_closed_verdict(msg({ seq: 4, closed: undefined }))).toBeUndefined();
    expect(hub_closed_verdict(msg({ seq: 5 }))).toBeUndefined();
  });

  it("never consults has_resolved_reply — the two fields answer different questions", () => {
    // If the verdict ever starts falling through to the legacy flag, these
    // go red. That fallthrough is precisely the defect.
    expect(hub_closed_verdict(msg({ seq: 6, closed: false, has_resolved_reply: true }))).toBe(false);
    expect(hub_closed_verdict(msg({ seq: 7, has_resolved_reply: true }))).toBeUndefined();
  });
});

describe("msg_thread_closed — the verdict wins; the legacy flag is only the fallback", () => {
  it("takes the hub's verdict over the legacy flag in BOTH directions", () => {
    // The direction that mattered in the field: bystander sets the flag, hub
    // says not closed.
    expect(msg_thread_closed(bystander_resolved(1))).toBe(false);
    // And the reverse, so this is a real preference rather than a hard-coded
    // false: hub says closed while the flag is absent.
    expect(msg_thread_closed(msg({ seq: 2, status: "open", closed: true }))).toBe(true);
  });

  it("falls back to the legacy flag ONLY when the hub makes no statement", () => {
    expect(msg_thread_closed(msg({ seq: 3, status: "open", has_resolved_reply: true }))).toBe(true);
    expect(msg_thread_closed(msg({ seq: 4, status: "open", has_resolved_reply: false }))).toBe(false);
    expect(msg_thread_closed(msg({ seq: 5, status: "open", closed: null, has_resolved_reply: true }))).toBe(true);
  });

  it("is false when neither field says anything", () => {
    expect(msg_thread_closed(msg({ seq: 6, status: "open" }))).toBe(false);
  });
});

describe("Asks — a bystander's `resolved` must not delist an ask that still needs one", () => {
  const ctx = { seat: SEAT };

  it("KEEPS a live ask the hub has not closed, even with a resolved reply downthread", () => {
    // The defect: `if (m.has_resolved_reply === true) return false` dropped
    // this row. The ask was still owed and stopped being listed.
    expect(msg_matches_filter(bystander_resolved(1, { pending_asks: ["1"] }), "asks", ctx)).toBe(true);
  });

  it("still delists an ask the hub reports CLOSED", () => {
    // The arm must not become "always true" — that would trade one wrong
    // answer for another.
    expect(msg_matches_filter(msg({ seq: 2, status: "open", closed: true, pending_asks: ["1"] }), "asks", ctx)).toBe(false);
  });

  it("still delists on an empty pending_asks even when the thread is open", () => {
    expect(msg_matches_filter(msg({ seq: 3, status: "open", closed: false, pending_asks: [] }), "asks", ctx)).toBe(false);
  });

  it("preserves the older-hub reading when the hub serves no verdict", () => {
    expect(msg_matches_filter(msg({ seq: 4, status: "open", has_resolved_reply: true }), "asks", ctx)).toBe(false);
    expect(msg_matches_filter(msg({ seq: 5, status: "open", has_resolved_reply: false }), "asks", ctx)).toBe(true);
  });

  it("ignores all of it for a status that was never an ask", () => {
    expect(msg_matches_filter(msg({ seq: 6, status: "fyi", closed: false }), "asks", ctx)).toBe(false);
  });
});

describe("Resolved — the lens shows what the HUB closed, not what someone replied", () => {
  const ctx = { seat: SEAT };

  it("does NOT file a bystander-resolved thread as closed", () => {
    expect(msg_matches_filter(bystander_resolved(1), "resolved", ctx)).toBe(false);
  });

  it("files a thread the hub reports closed", () => {
    expect(msg_matches_filter(msg({ seq: 2, status: "open", closed: true }), "resolved", ctx)).toBe(true);
  });

  it("still files a root POSTED resolved, which is closed by construction", () => {
    // This arm is independent of the verdict and must survive the change.
    expect(msg_matches_filter(msg({ seq: 3, status: "resolved" }), "resolved", ctx)).toBe(true);
  });

  it("preserves the older-hub reading when the hub serves no verdict", () => {
    expect(msg_matches_filter(msg({ seq: 4, status: "open", has_resolved_reply: true }), "resolved", ctx)).toBe(true);
    expect(msg_matches_filter(msg({ seq: 5, status: "open", has_resolved_reply: false }), "resolved", ctx)).toBe(false);
  });
});

describe("Vigilance — its fallback reads the verdict too", () => {
  // Vigilance prefers the hub's /owed debt set; the status-based branch below
  // runs only when that is absent. It had the same misreading one level down,
  // so a bystander's `resolved` made a live obligation stop looking urgent.
  const ctx = { seat: SEAT };

  it("stays vigilant on an open thread the hub has not closed", () => {
    expect(msg_matches_filter(bystander_resolved(1), "vigilance", ctx)).toBe(true);
  });

  it("goes quiet once the hub reports it closed", () => {
    expect(msg_matches_filter(msg({ seq: 2, status: "open", closed: true }), "vigilance", ctx)).toBe(false);
  });

  it("still defers to the hub's own debt set when one is served", () => {
    // debt_seqs is the authoritative branch and must keep winning outright:
    // a row the hub calls closed is still vigilant if /owed lists it.
    const owed = { seat: SEAT, debt_seqs: new Set([3]) };
    expect(msg_matches_filter(msg({ seq: 3, status: "open", closed: true }), "vigilance", owed)).toBe(true);
  });

  it("preserves the older-hub reading when the hub serves no verdict", () => {
    expect(msg_matches_filter(msg({ seq: 4, status: "open", has_resolved_reply: true }), "vigilance", ctx)).toBe(false);
    expect(msg_matches_filter(msg({ seq: 5, status: "open", has_resolved_reply: false }), "vigilance", ctx)).toBe(true);
  });
});
