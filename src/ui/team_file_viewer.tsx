// Shared file viewer for the Team page (operator dm 35): previews a channel
// virtual-filesystem file OR a message attachment inline — markdown rendered
// via the kit (proper md), plain text in a scroll box, raster images inline,
// and a download link for anything else. One modal, two callers (the Files
// browser and the attachment chips) so the render behavior never drifts.
//
// SAFETY: render decisions mirror the message-attachment stack — markdown
// goes through the kit's sanitizing Markdown component, images use <img>
// (which cannot execute for any bytes) on the ALLOWLISTED raster types only,
// and everything else is a download link, never inline HTML. No path renders
// untrusted content into an executable context.
import React from "react";

import { Markdown } from "./primitives";

import { split_markdown_segments } from "../lib/markdown_segments";
import { MermaidBlock } from "./mermaid_block";

import { Modal } from "./modal";
import { neutralize_unsafe_embeds } from "../lib/team_model";

/** What the viewer is showing. `text` is set for md/text files (fetched
 *  content); `url` is set for binary attachments (Hub fetch URL). */
export type FileView = {
  name: string;
  /** "md" | "text" | "image" | "download" — the resolved render mode. */
  mode: "md" | "text" | "image" | "download";
  text?: string;
  url?: string;
  content_type?: string;
  size?: number;
  loading?: boolean;
  error?: string;
  /** Provenance line (author · date · version) for fs files. */
  meta?: string;
};

const RASTER = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Resolve the render mode from a filename + declared content-type. Markdown
 *  by extension (the fs store is text/markdown by default); raster images by
 *  the allowlist; other text-ish types as plain text; everything else a
 *  download. Never trusts a declared type into an executable render. */
export function resolve_file_mode(name: string, content_type?: string): FileView["mode"] {
  const ext = name.toLowerCase().split(".").pop() || "";
  const ct = String(content_type || "").toLowerCase();
  if (ext === "md" || ext === "markdown" || ct === "text/markdown") return "md";
  if (RASTER.has(ct)) return "image";
  // Text-ish: text/* (except html/xml which are active — download those),
  // plus common code/data extensions the fs store holds.
  const text_ext = new Set(["txt", "json", "yaml", "yml", "csv", "log", "ts", "tsx", "js", "py", "sh", "toml", "ini", "env"]);
  const active = ct.includes("html") || ct.includes("xml") || ct.includes("svg");
  if (!active && (ct.startsWith("text/") || text_ext.has(ext))) return "text";
  return "download";
}

/** Inline raster preview with a graceful failure path (security adversary
 *  P2: a raster-declared attachment whose bytes fail to decode used to show
 *  a bare broken-image icon with no way to get the file). Keyed by url from
 *  the caller so the failed state resets when the viewed file changes. */
function ImagePreview({ url, name }: { url: string; name: string }): React.ReactElement {
  const [failed, set_failed] = React.useState(false);
  if (failed) {
    return (
      <div className="team_fileview_dl">
        <p className="muted team_note">The image failed to decode in the browser — the bytes may be corrupt or mistyped.</p>
        <a className="btn primary" href={url} target="_blank" rel="noreferrer" download>
          Download {name}
        </a>
      </div>
    );
  }
  return <img className="team_fileview_img" src={url} alt={name} onError={() => set_failed(true)} />;
}

export function FileViewer({ view, onClose }: { view: FileView | null; onClose: () => void }): React.ReactElement | null {
  if (!view) return null;
  const download_link = view.url ? (
    <a className="btn primary" href={view.url} target="_blank" rel="noreferrer" download>
      Download {view.name}
    </a>
  ) : null;
  return (
    <Modal open={true} title={view.name} onClose={onClose} variant="default">
      {view.meta ? <div className="muted team_note" style={{ marginBottom: 8 }}>{view.meta}</div> : null}
      {view.loading ? (
        <div className="muted team_note">Loading…</div>
      ) : view.error ? (
        // Errors still offer the file when a fetch URL exists (e.g. the
        // oversize-preview refusal names the reason AND hands over the bytes).
        <div className="team_fileview_dl">
          <div className="page_error mono">{view.error}</div>
          {download_link}
        </div>
      ) : view.mode === "md" ? (
        <div className="team_fileview_md">
          {/* Untrusted content (md attachments + fs files): defang same-origin
              embed smuggles like the message sinks do (adversary b22b19ed
              P2 — this sink was previously unguarded). */}
          {/* Mermaid fences render as DIAGRAMS (iteration-3: the pathway
              graph must be seen); prose segments keep the kit's
              sanitizing renderer. */}
          {split_markdown_segments(view.text || "").map((seg, i) =>
            seg.kind === "mermaid" ? <MermaidBlock key={i} text={seg.text} /> : <Markdown key={i} className="md_doc" text={neutralize_unsafe_embeds(seg.text)} />
          )}
        </div>
      ) : view.mode === "text" ? (
        <pre className="team_fileview_text">{view.text || ""}</pre>
      ) : view.mode === "image" && view.url ? (
        <ImagePreview key={view.url} url={view.url} name={view.name} />
      ) : (
        <div className="team_fileview_dl">
          <p className="muted team_note">
            Inline preview isn't available for this file type{view.content_type ? ` (${view.content_type})` : ""}.
          </p>
          {download_link}
        </div>
      )}
    </Modal>
  );
}
