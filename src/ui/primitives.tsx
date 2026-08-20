import type { PropsWithChildren } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AfChip({
  children,
  tone = "muted",
  size,
  title,
}: PropsWithChildren<{ tone?: "success" | "warning" | "error" | "muted"; size?: "sm"; title?: string }>): React.ReactElement {
  const tone_class = tone === "success" ? "ok" : tone === "warning" ? "warn" : tone === "error" ? "danger" : "muted";
  return <span className={`chip ${tone_class}${size === "sm" ? " chip_sm" : ""}`} title={title}>{children}</span>;
}

const glyph: Record<string, string> = {
  paperclip: "⌇",
  pause: "Ⅱ",
  refresh: "↻",
  speaker: "◖",
  copy: "⧉",
  check: "✓",
  plus: "+",
  x: "×",
  trash: "⌫",
};

/** Minimal local icon surface used by the extracted Team view.
 * It deliberately has no AbstractFramework dependency. */
export function Icon({ name, size = 14, className, title }: { name: string; size?: number; className?: string; title?: string }): React.ReactElement {
  if (name === "chat") {
    /* Speech bubble: the reply-trail marker on a thread card. Inline so it
       tints with currentColor and needs no icon package. */
    return (
      <span className={className} title={title} aria-hidden="true" style={{ display: "inline-flex", lineHeight: 1 }}>
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4v4l5.2-4H20a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
        </svg>
      </span>
    );
  }
  const thumb = name === "thumbsUp" || name === "thumbsUpFilled" || name === "thumbsDown" || name === "thumbsDownFilled";
  if (thumb) {
    const filled = name.endsWith("Filled");
    const down = name.startsWith("thumbsDown");
    /* Inline paths keep vote icons familiar, tintable, and independent of an
       icon package or a remote asset. */
    const path = filled
      ? "M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
      : "M21 8h-6.31l.95-4.57c.01-.11.02-.22.02-.34 0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2C23 9.9 22.1 8 21 8zm0 4-3 7H9V9l4.34-4.34L12.03 11H21v1zM1 9h4v12H1z";
    return (
      <span className={className} title={title} aria-hidden="true" style={{ display: "inline-flex", lineHeight: 1 }}>
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={down ? { transform: "rotate(180deg)" } : undefined}>
          <path d={path} />
        </svg>
      </span>
    );
  }
  return (
    <span className={className} title={title} aria-hidden="true" style={{ display: "inline-block", fontSize: size, lineHeight: 1 }}>
      {glyph[name] || "•"}
    </span>
  );
}

/** Sanitised Markdown. Peer-authored links and images are inert: WUI does
 * not make browser requests outside the direct Hub session. */
export function Markdown({ className, text }: { className?: string; text: string }): React.ReactElement {
  return (
    <div className={`pc-md ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <span className="md_external_disabled" title="Links in Hub messages are displayed but never opened by WUI">{children}</span>,
          img: ({ alt }) => <span className="md_media_blocked" aria-label={alt || "Blocked external image"}>[{alt || "image"}]</span>,
          // Agent reports carry real data tables. Each gets its own scroll
          // container so a wide table scrolls itself instead of forcing the
          // message column (and the page) sideways.
          table: ({ children }) => (
            <div className="md_table_wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ChatComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  rows?: number;
  sendLabel?: string;
  busyLabel?: string;
}): React.ReactElement {
  return (
    <div className="wui_chat_composer">
      <textarea
        value={props.value}
        rows={props.rows || 2}
        disabled={props.disabled || props.busy}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (props.value.trim() && !props.busy) props.onSubmit();
        }}
      />
      <button className="btn primary" disabled={props.disabled || props.busy || !props.value.trim()} onClick={props.onSubmit}>
        {props.busy ? props.busyLabel || "Working…" : props.sendLabel || "Send"}
      </button>
    </div>
  );
}
