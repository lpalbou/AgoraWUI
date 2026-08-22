// A message you WROTE is read by definition. The Hub's inbox can still
// carry an envelope for it — an open broadcast obligation pins every
// member, its author included — but rendering that as "unread" is wrong.
// Both unread readers drop own-seat envelopes at the source so the channel
// badge, the Unread tab, the row accent, and the reply-bar counts agree.
import { describe, expect, it } from "vitest";

import { unread_by_channel, unread_seqs_by_channel } from "../../src/lib/team_model";

const inbox = [
  { channel: "commons", seq: 175, sender: "laurent" }, // the viewer's own root
  { channel: "commons", seq: 176, sender: "code-tui" },
  { channel: "commons", seq: 177, sender: "gateway" },
  { channel: "optimize-code", seq: 12, sender: "laurent" },
];

describe("own messages are never unread", () => {
  it("drops own-seat envelopes from the channel badge count", () => {
    expect(unread_by_channel(inbox, "laurent")).toEqual({ commons: 2 });
  });

  it("drops own-seat envelopes from the unread seq sets the rows and filters read", () => {
    const seqs = unread_seqs_by_channel(inbox, "laurent");
    expect([...(seqs.commons ?? [])].sort((a, b) => a - b)).toEqual([176, 177]);
    expect(seqs["optimize-code"]).toBeUndefined();
  });

  it("keeps every envelope when the seat is not known yet", () => {
    // A poll before /whoami resolves must not silently hide rows.
    expect(unread_by_channel(inbox)).toEqual({ commons: 3, "optimize-code": 1 });
    expect(unread_seqs_by_channel(inbox).commons.size).toBe(3);
  });

  it("still counts other seats' messages that share a seq across channels", () => {
    const rows = [
      { channel: "a", seq: 1, sender: "laurent" },
      { channel: "b", seq: 1, sender: "core" },
    ];
    expect(unread_by_channel(rows, "laurent")).toEqual({ b: 1 });
  });
});

describe("already-read obligations are not unread", () => {
  // The Hub re-pins obligations past the cursor so they cannot rot, and
  // marks each re-surface `redelivery: true`. Counting those as unread made
  // an obligation the operator had read reappear as new on every poll.
  const inbox = [
    { channel: "commons", seq: 10, sender: "core" },                       // genuinely new
    { channel: "commons", seq: 11, sender: "core", redelivery: true },     // read, still owed
    { channel: "commons", seq: 12, sender: "core", redelivery: false },
  ];

  it("excludes redelivered envelopes from the badge and the unread set", () => {
    expect(unread_by_channel(inbox, "laurent")).toEqual({ commons: 2 });
    expect([...unread_seqs_by_channel(inbox, "laurent").commons].sort((a, b) => a - b)).toEqual([10, 12]);
  });

  it("keeps envelopes from hubs that do not serve the field", () => {
    const legacy = [{ channel: "commons", seq: 10, sender: "core" }, { channel: "commons", seq: 11, sender: "core" }];
    expect(unread_by_channel(legacy, "laurent")).toEqual({ commons: 2 });
  });
});

describe("an unread seq the row cannot be found by is not an unread seq", () => {
  // The seq set drives navigation — the Unread filter, the row dots, the
  // jump-to-oldest-unread. An envelope with no numeric seq would land in
  // the set as NaN, which matches nothing and can never be cleared; one
  // with no channel would open a phantom "" channel beside the real ones.
  // Both halves of the guard were unmeasured until 2026-08-22.
  const rows = [
    { channel: "commons", seq: 10, sender: "core" },
    { channel: "commons", sender: "core" }, // synthetic notice, no seq
    { channel: "", seq: 11, sender: "core" },
  ];

  it("drops envelopes with no numeric seq, and never invents a channel", () => {
    const out = unread_seqs_by_channel(rows, "laurent");
    expect(Object.keys(out)).toEqual(["commons"]);
    expect([...out.commons]).toEqual([10]);
  });

  it("still COUNTS a seq-less envelope in the badge — a message is never hidden", () => {
    // Deliberately different from the seq set: the badge's job is "there is
    // something here", which survives a missing seq. Only the navigable set
    // needs a seq to point at. The two readers disagree on purpose.
    expect(unread_by_channel(rows, "laurent")).toEqual({ commons: 2 });
  });
});
