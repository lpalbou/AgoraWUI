// Mirror the root project documents into the VitePress site so the repo keeps a
// single source of truth. Generated pages are not committed.
import { readFileSync, writeFileSync } from "node:fs";

const pages = [
  { src: "CHANGELOG.md", out: "docs/changelog.md" },
  { src: "CONTRIBUTING.md", out: "docs/contributing.md" },
  { src: "SECURITY.md", out: "docs/security.md" },
];

for (const page of pages) {
  const body = readFileSync(page.src, "utf8");
  const banner = `<!-- Generated from ${page.src} by scripts/sync-docs.mjs. Edit that file instead. -->\n\n`;
  writeFileSync(page.out, banner + body);
  console.log(`synced ${page.src} -> ${page.out}`);
}
