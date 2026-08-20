// The library build never parses the stylesheets (they are copied, not
// bundled), so a CSS syntax error only surfaces in the standalone page's
// postcss chain — found live: a comment containing `*/` inside prose
// terminated early and broke the dev server. Parse every shipped sheet
// with the same parser vite uses so the failure class is caught here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import postcss from "postcss";

describe("shipped stylesheets parse as valid CSS", () => {
  for (const name of ["theme.css", "team.css", "styles.css"]) {
    it(`src/ui/${name}`, () => {
      const source = readFileSync(resolve(import.meta.dirname, `../../src/ui/${name}`), "utf8");
      expect(() => postcss.parse(source, { from: name })).not.toThrow();
    });
  }
});
