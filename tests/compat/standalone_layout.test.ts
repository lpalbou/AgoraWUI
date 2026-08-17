import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(import.meta.dirname, "../../src/ui/styles.css"), "utf8");

describe("standalone Team layout", () => {
  it("gives TeamPage a bounded flex parent so the message pane can scroll", () => {
    expect(styles).toMatch(/\.wui_app\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*display:\s*flex;/s);
  });
});
