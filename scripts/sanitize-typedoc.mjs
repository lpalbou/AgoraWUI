// VitePress compiles every Markdown page as a Vue SFC, so a literal angle
// bracket carried over from a JSDoc comment (for example `<img>` or
// `<package>-<NNNN>`) is parsed as an unclosed component and fails the build.
// Escape angle brackets in the TypeDoc output, outside fenced blocks and inline
// code spans where Markdown already renders them verbatim.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "docs/reference";

function markdown_files(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return markdown_files(full);
    return entry.endsWith(".md") ? [full] : [];
  });
}

function escape_segment(text) {
  return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sanitize_line(line) {
  // Split on inline-code spans, keeping the delimiters; escape only the rest.
  return line
    .split(/(`+[^`]*`+)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : escape_segment(segment)))
    .join("");
}

function sanitize(source) {
  let in_fence = false;
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        in_fence = !in_fence;
        return line;
      }
      return in_fence ? line : sanitize_line(line);
    })
    .join("\n");
}

let changed = 0;
for (const file of markdown_files(ROOT)) {
  const source = readFileSync(file, "utf8");
  const sanitized = sanitize(source);
  if (sanitized !== source) {
    writeFileSync(file, sanitized);
    changed += 1;
  }
}
console.log(`sanitized ${changed} generated reference page(s)`);
