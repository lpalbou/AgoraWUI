// Shared file viewer for the Team page (operator dm 35): previews a channel
// virtual file system (vfs) file OR a message attachment inline — markdown rendered
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
  /** Owning channel for vfs-sourced views. Cross-channel `@channel:path`
   *  references open (and save) against THIS channel, never the one the
   *  reader happens to have selected. */
  channel?: string;
  /** Channel-fs version at read time — rides the save as expect_version so
   *  a concurrent agent write surfaces as the hub's own 409, never a silent
   *  overwrite. */
  version?: number;
  /** True when the full content is in `text` (a clamped oversize preview
   *  must never round-trip through an editor). */
  editable?: boolean;
  /** Open directly in the editor (the Files drawer's new-file flow). */
  start_editing?: boolean;
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

export function FileViewer({ view, onClose, onSave }: {
  view: FileView | null;
  onClose: () => void;
  /** When set, md/text fs files gain an Edit mode; the handler performs the
   *  hub write (throwing surfaces the hub's refusal verbatim in place, with
   *  the draft preserved). Absent for attachments — message payloads are
   *  immutable. */
  onSave?: (text: string) => Promise<void>;
}): React.ReactElement | null {
  const [editing, set_editing] = React.useState(false);
  const [draft, set_draft] = React.useState("");
  const [save_busy, set_save_busy] = React.useState(false);
  const [save_error, set_save_error] = React.useState("");
  // Reset editor state when the viewed file changes (path or version).
  const view_key = view ? `${view.name}@${view.version ?? "?"}` : "";
  React.useEffect(() => {
    set_editing(Boolean(view?.start_editing));
    set_draft(view?.text || "");
    set_save_busy(false);
    set_save_error("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view_key, Boolean(view)]);
  if (!view) return null;
  const can_edit = Boolean(onSave) && Boolean(view.editable) && !view.loading && !view.error && (view.mode === "md" || view.mode === "text");
  const download_link = view.url ? (
    <a className="btn primary" href={view.url} target="_blank" rel="noreferrer" download>
      Download {view.name}
    </a>
  ) : null;
  async function save(): Promise<void> {
    if (!onSave) return;
    set_save_busy(true);
    set_save_error("");
    try {
      await onSave(draft);
      set_editing(false);
    } catch (e: any) {
      // The hub's refusal (403 policy, 409 version conflict) verbatim —
      // the draft stays so a conflict never eats the operator's writing.
      set_save_error(String(e?.message || e || "save failed"));
    } finally {
      set_save_busy(false);
    }
  }
  if (editing) {
    return (
      <Modal open={true} title={`${view.name} — editing`} onClose={onClose} variant="default">
        {view.meta ? <div className="muted team_note" style={{ marginBottom: 8 }}>{view.meta}</div> : null}
        <textarea
          className="team_fileedit_text mono"
          value={draft}
          onChange={(e) => set_draft(e.target.value)}
          disabled={save_busy}
          aria-label={`Edit ${view.name}`}
          spellCheck={false}
        />
        {save_error ? <div className="page_error mono">{save_error}</div> : null}
        <div className="team_fileedit_actions">
          <button className="btn" disabled={save_busy} onClick={() => { set_editing(false); set_save_error(""); }}>
            Cancel
          </button>
          <button className="btn primary" disabled={save_busy} onClick={() => void save()}>
            {save_busy ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={true} title={view.name} onClose={onClose} variant="default">
      {view.meta || can_edit ? (
        <div className="team_fileview_head">
          {view.meta ? <span className="muted team_note">{view.meta}</span> : <span />}
          {can_edit ? (
            <button className="btn" onClick={() => { set_draft(view.text || ""); set_editing(true); }} title="Edit this file in place — saved through the hub's versioned write (concurrent edits surface as a version conflict, never a silent overwrite)">
              Edit
            </button>
          ) : null}
        </div>
      ) : null}
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
