import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

function source_files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return source_files(full);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

describe("package boundary", () => {
  it("has no AbstractFramework, mock-server, or legacy proxy runtime", () => {
    const source = source_files(join(ROOT, "src")).map((file) => readFileSync(file, "utf8")).join("\n");
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    // The package is published under the @abstractframework scope, but must not
    // depend on any AbstractFramework runtime package.
    const dependency_names = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"]
      .flatMap((field) => Object.keys(manifest[field] || {}));

    expect(source).not.toMatch(/@abstractframework\//);
    expect(source).not.toMatch(/abstractcontinuum/i);
    expect(source).not.toMatch(/\/api\/hub/);
    expect(dependency_names.filter((name) => name.startsWith("@abstractframework/"))).toEqual([]);
    expect(existsSync(join(ROOT, "examples", "mock_standalone_server.py"))).toBe(false);
    expect(existsSync(join(ROOT, "examples", "standalone_proxy_server.py"))).toBe(false);
  });

  it("identifies itself to the hub at the version it actually is", () => {
    // `X-Agora-Client` is the hub's version handshake: a client that does
    // not send it is served a synthetic "your tooling is stale" notice, and
    // one that sends a stale VERSION tells the hub something false about
    // which fields it can render. It drifted a release behind once already;
    // this makes the drift fail here instead of on the wire.
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const client = readFileSync(join(ROOT, "src", "lib", "hub_client.ts"), "utf8");
    expect(client).toContain(`AGORA_WUI_CLIENT_HEADER = "agora-wui/${manifest.version}"`);
  });
});
