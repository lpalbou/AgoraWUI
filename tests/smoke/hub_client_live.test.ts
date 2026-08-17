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
  live("opens the documented WebSocket subscribe lane with the existing seat key", async () => {
    const hub = new HubClient({ base_url: url!, bearer_token: key! });
    const channel = (await hub.channels()).find((row) => row.member);
    expect(channel).toBeTruthy();
    const socket_url = hub.ws_url();
    expect(socket_url).toBeTruthy();

    const socket = new WebSocket(socket_url!);
    const subscribed = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("timed out waiting for Agora Hub WS subscribe receipt"));
      }, 5000);
      socket.onopen = () => {
        // `last_seq` is an authoritative current snapshot for this read-only
        // transport probe; a real WUI session instead sends only its own
        // received cursors (covered by the TeamPage contract test).
        socket.send(JSON.stringify({ type: "subscribe", channels: [channel!.name], since: { [channel!.name]: channel!.last_seq } }));
      };
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data));
        if (frame?.type !== "subscribed") return;
        clearTimeout(timeout);
        socket.close();
        resolve(frame);
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Agora Hub rejected the direct WebSocket transport"));
      };
    });

    expect(subscribed.channels).toEqual([channel!.name]);
  });

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
