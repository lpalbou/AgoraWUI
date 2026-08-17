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
    const manifest = readFileSync(join(ROOT, "package.json"), "utf8");

    expect(source).not.toMatch(/@abstractframework\//);
    expect(source).not.toMatch(/abstractcontinuum/i);
    expect(source).not.toMatch(/\/api\/hub/);
    expect(manifest).not.toMatch(/@abstractframework\//);
    expect(existsSync(join(ROOT, "examples", "mock_standalone_server.py"))).toBe(false);
    expect(existsSync(join(ROOT, "examples", "standalone_proxy_server.py"))).toBe(false);
  });
});
