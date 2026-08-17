// Split markdown into prose / mermaid segments (iteration-3 support: the
// cognitive-pathway graph lands as a mermaid block in a commons-fs .md —
// laurent must SEE the graph, not its source; c3201 names a rendering the
// operator can see as the deliverable's bar).
//
// Pure and conservative: only fenced blocks whose info string is exactly
// `mermaid` (case-insensitive, optional trailing whitespace) split out;
// everything else stays prose for the kit's sanitizing Markdown renderer.
// An unterminated mermaid fence renders as PROSE (never feed half a block
// to a diagram engine).

export type MdSegment = { kind: "md" | "mermaid"; text: string };

const FENCE_OPEN_RE = /^(```+|~~~+)\s*mermaid\s*$/i;

export function split_markdown_segments(text: string): MdSegment[] {
  const lines = String(text || "").split("\n");
  const out: MdSegment[] = [];
  let prose: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    // Find the matching close fence (same char, at least as long).
    const fence = open[1];
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trimEnd();
      if (t.startsWith(fence[0].repeat(3)) && /^(`{3,}|~{3,})\s*$/.test(t) && t[0] === fence[0]) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      // Unterminated: keep as prose verbatim.
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    if (prose.length) {
      out.push({ kind: "md", text: prose.join("\n") });
      prose = [];
    }
    out.push({ kind: "mermaid", text: lines.slice(i + 1, close).join("\n") });
    i = close + 1;
  }
  if (prose.length) out.push({ kind: "md", text: prose.join("\n") });
  return out;
}
