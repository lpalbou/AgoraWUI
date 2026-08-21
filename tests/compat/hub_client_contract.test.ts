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

  it("uses a host-supplied socket URL verbatim and resolves relative REST bases", () => {
    // Relay-fronted embedding: the host owns route and auth — WUI appends
    // NOTHING (token-in-URL is exactly what such hosts forbid).
    expect(new HubClient({ base_url: "/proxy/prefix", bearer_token: "k", ws_url: "wss://host.example/relay/socket" }).ws_url())
      .toBe("wss://host.example/relay/socket");
    expect(new HubClient({ ws_url: "wss://host.example/relay/socket" }).ws_url())
      .toBe("wss://host.example/relay/socket");
    // A relative REST base with a real bearer still derives the Hub's
    // documented token lane against the page origin instead of nulling out.
    expect(new HubClient({ base_url: "/hub", bearer_token: "existing-key" }).ws_url())
      .toMatch(/^ws:\/\/[^/]+\/hub\/ws\?token=existing-key$/);
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

  it("writes channel-fs files through the hub's versioned PUT route", async () => {
    let seen_url = "";
    let seen_method = "";
    let posted: any;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen_url = String(input);
      seen_method = String(init?.method || "GET");
      posted = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ path: "notes/plan.md", version: 4 }), { status: 200 });
    }));
    const hub = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" });
    await hub.fs_put("team alpha", "notes/plan v2.md", { content: "# plan", expect_version: 3 });
    expect(seen_url).toBe("http://127.0.0.1:8765/channels/team%20alpha/fs/notes/plan%20v2.md");
    expect(seen_method).toBe("PUT");
    // expect_version rides the write verbatim: concurrency is the HUB's
    // contract (409 on mismatch), never a client-side guess.
    expect(posted).toEqual({ content: "# plan", expect_version: 3, mime: undefined, description: undefined });
  });

  it("deletes vfs files through the hub's CAS DELETE route", async () => {
    let seen_url = "";
    let seen_method = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen_url = String(input);
      seen_method = String(init?.method || "GET");
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }));
    const hub = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" });
    await expect(hub.fs_delete("team alpha", "notes/plan v2.md", 7)).resolves.toEqual({ deleted: true });
    expect(seen_method).toBe("DELETE");
    // expect_version rides as the hub's query param — the fence is the
    // HUB's contract (409 on mismatch), never a client-side guess.
    expect(seen_url).toBe("http://127.0.0.1:8765/channels/team%20alpha/fs/notes/plan%20v2.md?expect_version=7");
  });

  it("reads and sets standing missions on the hub's admin routes", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method || "GET"), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(calls.length === 1 ? [{ agent_id: "runtime", mission: "own the runtime" }] : { ok: true }), { status: 200 });
    }));
    const hub = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" });
    await expect(hub.missions()).resolves.toEqual([{ agent_id: "runtime", mission: "own the runtime" }]);
    await hub.set_mission("code tui", "harden the coder console");
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:8765/admin/missions", method: "GET" });
    expect(calls[1]).toMatchObject({
      url: "http://127.0.0.1:8765/admin/agents/code%20tui/mission",
      method: "PUT",
      body: { mission: "harden the coder console" },
    });
  });

  it("acknowledges standing rulings on the hub's ruling-acks route", async () => {
    // Hub 0113: the ONE call that clears a `rulings_required` room's 409.
    // Keys come from the digest's `unacknowledged_rulings`; the console
    // sends them verbatim and never filters the hub's refusals.
    let seen: { url: string; method: string; body: any } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), method: String(init?.method || "GET"), body: JSON.parse(String(init?.body || "{}")) };
      return new Response(JSON.stringify({ channel: "team alpha", agent_id: "wui-seat", acked: ["ruling:no-external-assets"] }), { status: 200 });
    }));
    const hub = new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" });
    await expect(hub.ack_rulings("team alpha", ["ruling:no-external-assets"])).resolves.toMatchObject({
      acked: ["ruling:no-external-assets"],
    });
    expect(seen!).toEqual({
      url: "http://127.0.0.1:8765/channels/team%20alpha/ruling-acks",
      method: "POST",
      body: { keys: ["ruling:no-external-assets"] },
    });
  });

  it("carries the digest's standing rulings through to the caller", async () => {
    // The gate is only actionable if the rows survive the client: `rulings`
    // (active, in scope) and `unacknowledged_rulings` (the gating subset,
    // each with the version this seat last acked).
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      channel: "commons",
      rulings: [{ key: "ruling:no-external-assets", value: { text: "no external assets", scope: ["*"], source_message_id: "01ABC", active: true }, version: 2, updated_by: "laurent" }],
      unacknowledged_rulings: [{ key: "ruling:no-external-assets", value: { text: "no external assets", scope: ["*"] }, version: 2, ack_version: 1 }],
      counts: { unacknowledged_rulings: 1, rulings: 1 },
    }), { status: 200 })));
    const digest = await new HubClient({ base_url: "http://127.0.0.1:8765", bearer_token: "existing-key" }).digest("commons");
    expect(digest.rulings?.[0]?.value?.text).toBe("no external assets");
    expect(digest.unacknowledged_rulings?.[0]).toMatchObject({ key: "ruling:no-external-assets", version: 2, ack_version: 1 });
    expect(digest.counts?.unacknowledged_rulings).toBe(1);
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
