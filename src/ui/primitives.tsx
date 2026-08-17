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
  thumbsUp: "△",
  thumbsUpFilled: "▲",
  thumbsDown: "▽",
  thumbsDownFilled: "▼",
  pause: "Ⅱ",
  refresh: "↻",
  speaker: "◖",
  copy: "⧉",
  plus: "+",
  x: "×",
  trash: "⌫",
};

/** Minimal local icon surface used by the extracted Team view.
 * It deliberately has no AbstractFramework dependency. */
export function Icon({ name, size = 14, className, title }: { name: string; size?: number; className?: string; title?: string }): React.ReactElement {
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
