import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import app_config from "../../vite.config.app";

// `--seat` is read by vite.config.app.ts from argv, so the contract that
// matters is that function's own output: what a page would open with, and
// what it refuses to reach for. Asserting on the config keeps this in the
// default suite instead of behind an 11-second build.
const KEY = "agora_test_sentinel_key";
const HUB = "http://hub.invalid:9999";

const REAL_ARGV = process.argv;

function config_with(args: string[], command: "build" | "serve" = "build"): any {
  process.argv = ["node", "vite", ...args];
  // `defineConfig` returns the function it was given; call it as Vite would.
  return (app_config as any)({ command, mode: command === "build" ? "production" : "development" });
}

function define_with(args: string[], command: "build" | "serve" = "build"): Record<string, string> {
  return config_with(args, command).define as Record<string, string>;
}

afterEach(() => {
  process.argv = REAL_ARGV;
});

describe("preset seat key", () => {
  it("opens with nothing when no seat key is given", () => {
    const define = define_with([]);
    expect(define.__AGORA_PRESET_SEAT_KEY__).toBe('""');
    expect(define.__AGORA_PRESET_HUB_URL__).toBe('""');
  });

  it("takes the key it was handed", () => {
    const define = define_with(["--seat", KEY, "--hub", HUB]);
    expect(define.__AGORA_PRESET_SEAT_KEY__).toBe(JSON.stringify(KEY));
    expect(define.__AGORA_PRESET_HUB_URL__).toBe(JSON.stringify(HUB));
  });

  it("accepts --flag=value as well as --flag value", () => {
    const define = define_with([`--seat=${KEY}`, `--hub=${HUB}`]);
    expect(define.__AGORA_PRESET_SEAT_KEY__).toBe(JSON.stringify(KEY));
    expect(define.__AGORA_PRESET_HUB_URL__).toBe(JSON.stringify(HUB));
  });

  it("never turns a seat name into a key from the key cache", () => {
    // The property this file exists for: naming a seat must not make the
    // build reach into `~/.agora/keys.json` — or any cache — and authenticate
    // as a seat whose secret nobody supplied. A name is used verbatim, which
    // the Hub then refuses, and the page falls back to its connection card.
    const cache_dir = mkdtempSync(join(tmpdir(), "agora-wui-keys-"));
    const cache = join(cache_dir, "keys.json");
    writeFileSync(cache, JSON.stringify({ [`${HUB}::laurent`]: KEY }));
    process.env.HOME = cache_dir;

    const define = define_with(["--seat", "laurent", "--keys", cache]);
    expect(define.__AGORA_PRESET_SEAT_KEY__).toBe('"laurent"');
    expect(define.__AGORA_PRESET_SEAT_KEY__).not.toContain(KEY);
  });

  it("reads no seat key from the environment", () => {
    process.env.AGORA_WUI_SEAT_KEY = KEY;
    try {
      expect(define_with([]).__AGORA_PRESET_SEAT_KEY__).toBe('""');
    } finally {
      delete process.env.AGORA_WUI_SEAT_KEY;
    }
  });

  it("gives the dev server the same preset it would build", () => {
    const define = define_with(["--seat", KEY], "serve");
    expect(define.__AGORA_PRESET_SEAT_KEY__).toBe(JSON.stringify(KEY));
  });
});

describe("dev-server Hub proxy", () => {
  it("carries an absolute Hub on the dev origin so the browser stays same-origin", () => {
    const config = config_with(["--hub", "http://127.0.0.1:8760"], "serve");
    // The page is pointed at its own origin; a cross-origin call to a Hub
    // that never allowed this origin is refused by the browser before it is
    // sent, which no code in the page can answer for.
    expect(config.define.__AGORA_PRESET_HUB_URL__).toBe('"/hub"');
    const proxy = config.server.proxy["/hub"];
    expect(proxy.target).toBe("http://127.0.0.1:8760");
    expect(proxy.ws).toBe(true);
    expect(proxy.rewrite("/hub/whoami")).toBe("/whoami");
    expect(proxy.rewrite("/hub")).toBe("/");
  });

  it("leaves a build calling the Hub directly, with no proxy anywhere", () => {
    const config = config_with(["--hub", "http://127.0.0.1:8760"], "build");
    expect(config.define.__AGORA_PRESET_HUB_URL__).toBe('"http://127.0.0.1:8760"');
    expect(config.server?.proxy).toBeUndefined();
  });

  it("passes a relative Hub through untouched — it is already same-origin", () => {
    const config = config_with(["--hub", "/relay"], "serve");
    expect(config.define.__AGORA_PRESET_HUB_URL__).toBe('"/relay"');
    expect(config.server?.proxy).toBeUndefined();
  });

  it("adds no proxy when no Hub is named", () => {
    expect(config_with([], "serve").server?.proxy).toBeUndefined();
  });
});
