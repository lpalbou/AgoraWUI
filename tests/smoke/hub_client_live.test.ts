// @vitest-environment node
// Deliberate opt-in mutation test for an ephemeral Agora Hub. It proves the
// WUI client uses the native direct routes with an existing in-memory key;
// normal `npm test` skips it to protect the user's running collaboration Hub.
import { describe, expect, it } from "vitest";

import { HubClient } from "../../src/lib/hub_client";

const url = process.env.AGORA_WUI_E2E_URL;
const key = process.env.AGORA_WUI_E2E_KEY;
const live = url && key ? it : it.skip;

describe("direct Hub client end-to-end", () => {
  live("authenticates, creates a channel, posts, and reads authoritative rows", async () => {
    const hub = new HubClient({ base_url: url!, bearer_token: key! });
    const me = await hub.meta();
    expect(me.seat).toBe("e2e-wui");

    const channel = `wui-e2e-${Date.now()}`;
    await hub.create_channel(channel, false);
    const attachment = await hub.upload_attachment(
      channel,
      new File(["direct attachment bytes"], "proof.txt", { type: "text/plain" }),
    );
    expect(await (await hub.attachment_blob(channel, attachment.id)).text()).toBe("direct attachment bytes");
    const posted = await hub.post_message(channel, {
      status: "fyi",
      title: "WUI direct-client verification",
      body: "authoritative Hub row",
      attachments: [{ id: attachment.id, filename: attachment.filename }],
    });
    const rows = await hub.messages(channel, { since: 0, limit: 20 });
    const expected_ws = new URL(url!);
    expected_ws.protocol = expected_ws.protocol === "https:" ? "wss:" : "ws:";
    expected_ws.pathname = `${expected_ws.pathname.replace(/\/+$/, "")}/ws`;
    expected_ws.searchParams.set("token", key!);

    expect(rows.some((row) => row.id === posted.id && row.body === "authoritative Hub row")).toBe(true);
    expect(hub.ws_url()).toBe(expected_ws.toString());
  });
});
