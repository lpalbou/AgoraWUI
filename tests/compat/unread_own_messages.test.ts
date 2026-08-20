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
