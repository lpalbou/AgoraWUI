import { describe, expect, it } from "vitest";

import { parse_agora_key_cache } from "../../src/lib/seat_key_cache";

describe("existing Agora key cache import", () => {
  it("reads documented cache rows without persisting or inventing a seat", () => {
    expect(parse_agora_key_cache(JSON.stringify({
      "http://127.0.0.1:8765::laurent": "agora_local_key",
      "https://hub.example.test/::remote": "agora_remote_key",
      "not-a-cache-row": 42,
    }))).toEqual([
      { hub_url: "http://127.0.0.1:8765", seat: "laurent", bearer_token: "agora_local_key" },
      { hub_url: "https://hub.example.test", seat: "remote", bearer_token: "agora_remote_key" },
    ]);
  });

  it("fails loudly for malformed or empty cache files", () => {
    expect(() => parse_agora_key_cache("not json")).toThrow(/valid Agora key-cache JSON/i);
    expect(() => parse_agora_key_cache("{}")).toThrow(/No Agora seat keys/i);
  });
});
