// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubClient } from "../../src/lib/hub_client";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("native Agora Hub transport", () => {
  it("uses the Hub's root routes and keeps an injected bearer in the request only", async () => {
    let seen_url = "";
    let seen_init: RequestInit | undefined;
    const fetch_mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen_url = String(input);
      seen_init = init;
      return new Response(JSON.stringify({ id: "wui-seat" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch_mock);

    const client = new HubClient({
      base_url: "http://127.0.0.1:8765/",
      bearer_token: "ephemeral-test-token",
    });
    await expect(client.meta()).resolves.toMatchObject({ seat: "wui-seat", hub_url: "http://127.0.0.1:8765" });

    expect(fetch_mock).toHaveBeenCalledTimes(1);
    expect(seen_url).toBe("http://127.0.0.1:8765/whoami");
    expect(new Headers(seen_init!.headers).get("Authorization")).toBe("Bearer ephemeral-test-token");
    expect(seen_init!.credentials).toBe("same-origin");
  });

  it("does not construct a bearer-bearing WebSocket URL", () => {
    expect(new HubClient({ bearer_token: "ephemeral-test-token" }).ws_url()).toBeNull();
    expect(new HubClient({ websocket_url: "wss://hub.example.test/events" }).ws_url()).toBe("wss://hub.example.test/events");
  });

  it("uses the native attachment path", () => {
    const client = new HubClient({ base_url: "http://127.0.0.1:8765" });
    expect(client.attachment_url("team alpha", "blob_123")).toBe("http://127.0.0.1:8765/channels/team%20alpha/attachments/blob_123");
  });
});
