import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(import.meta.dirname, "../../src/ui/styles.css"), "utf8");

describe("standalone Team layout", () => {
  it("gives TeamPage a bounded flex parent so the message pane can scroll", () => {
    expect(styles).toMatch(/\.wui_app\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*display:\s*flex;/s);
  });

  it("keeps the composer fixed and gives native Markdown lists a clear gutter", () => {
    expect(styles).toMatch(/\.team_compose_text\s*\{[^}]*height:\s*92px;[^}]*min-height:\s*92px;[^}]*max-height:\s*92px;/s);
    expect(styles).toMatch(/\.team_compose_actions\s*\{[^}]*display:\s*flex;/s);
    expect(styles).toMatch(/\.md_doc ul,\s*\.md_doc ol\s*\{[^}]*padding-inline-start:\s*16px;/s);
  });
});
