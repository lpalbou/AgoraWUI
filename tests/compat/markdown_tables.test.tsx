// @vitest-environment jsdom
// Agent reports carry real data tables (metrics, evidence, comparisons).
// They must render as tables — header row, cells, and a scroll container of
// their own so a wide table never pushes the message column sideways.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "../../src/ui/primitives";

const TABLE = [
  "| Question | Measured answer | Evidence |",
  "| --- | --- | ---: |",
  "| Did runtime-owned code change? | Yes: 2 runtime test commands | `optimize-code#103` — 3 passed |",
  "| Numeric effect | dropped from 2 to 1 | -50% |",
].join("\n");

describe("markdown tables", () => {
  it("renders GFM tables with header cells and a scroll container", () => {
    const { container } = render(<Markdown className="md_doc" text={TABLE} />);
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    // Own scroll lane: the wrapper is what scrolls, not the page.
    expect(table!.parentElement?.className).toBe("md_table_wrap");
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("Measured answer")).toBeTruthy();
    expect(screen.getByText("Numeric effect")).toBeTruthy();
  });

  it("honors GFM column alignment so numeric columns stay right-aligned", () => {
    const { container } = render(<Markdown className="md_doc" text={TABLE} />);
    const last_header = container.querySelectorAll("thead th")[2] as HTMLElement;
    expect(last_header.style.textAlign || last_header.getAttribute("align")).toBe("right");
  });

  it("keeps inline code inside cells intact", () => {
    const { container } = render(<Markdown className="md_doc" text={TABLE} />);
    const code = container.querySelector("td code");
    expect(code?.textContent).toBe("optimize-code#103");
  });
});
