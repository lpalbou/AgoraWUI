// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGORA_WUI_CLIENT_HEADER, HubClient } from "../../src/lib/hub_client";

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
    expect(new Headers(seen_init!.headers).get("X-Agora-Client")).toBe(AGORA_WUI_CLIENT_HEADER);
    expect(seen_init!.credentials).toBe("same-origin");
  });

  it("derives the Hub's documented browser WebSocket lane from the in-memory seat key", () => {
    expect(new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "ephemeral-test-token" }).ws_url())
      .toBe("ws://127.0.0.1:8765/ws?token=ephemeral-test-token");
    expect(new HubClient({ base_url: "https://hub.example.test", bearer_token: "with spaces" }).ws_url())
      .toBe("wss://hub.example.test/ws?token=with+spaces");
    expect(new HubClient({ base_url: "https://hub.example.test" }).ws_url()).toBeNull();
  });

  it("forwards opaque Hub protocol data unchanged", async () => {
    let posted: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const hub = new HubClient({ bearer_token: "existing-key" });
    await hub.post_message("commons", {
      body: "completion",
      status: "resolved",
      data: { evidence: [{ kind: "store", ref: "plan:wui-audit" }], consumes: ["commons#1"] },
    });
    expect(posted.data).toEqual({ evidence: [{ kind: "store", ref: "plan:wui-audit" }], consumes: ["commons#1"] });
  });

  it("uses the native attachment path", () => {
    const client = new HubClient({ base_url: "http://127.0.0.1:8765" });
    expect(client.attachment_url("team alpha", "blob_123")).toBe("http://127.0.0.1:8765/channels/team%20alpha/attachments/blob_123");
  });

  it("fetches attachment bytes through the authenticated Hub client", async () => {
    let seen_init: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen_init = init;
      return new Response("attachment", { status: 200, headers: { "Content-Type": "text/plain" } });
    }));
    const blob = await new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" })
      .attachment_blob("commons", "blob_123");
    expect(await blob.text()).toBe("attachment");
    expect(new Headers(seen_init!.headers).get("Authorization")).toBe("Bearer existing-key");
    expect(new Headers(seen_init!.headers).get("X-Agora-Client")).toBe(AGORA_WUI_CLIENT_HEADER);
  });
});
