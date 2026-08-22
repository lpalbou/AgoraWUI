import type { PropsWithChildren } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { parse_citation } from "../lib/team_model";

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
  enter: "→",
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
export function Markdown({
  className,
  text,
  cite_channels,
  cite_bare_max,
}: {
  className?: string;
  text: string;
  /** Rooms this seat can actually see, for citation chips (operator dm
   *  21/22). OMITTED means "no chips here" — the charter viewer, the summary
   *  pane and the file viewer render Markdown too, and a hover affordance
   *  with no handler behind it is a lie. Only the Team feed passes it.
   *
   *  It is also the false-positive gate. `word#digits` is a common shape in
   *  agent reports — `PR#103`, `optimize-code#103`, `issue#42` — and none of
   *  those are hub citations. Chipping only rooms that EXIST means a dead
   *  chip is impossible rather than merely unlikely. */
  cite_channels?: ReadonlySet<string>;
  /** The highest seq a BARE `#N` can name — the read room's own last message
   *  (operator dm 48). A bare citation means "the room you are reading", and
   *  that room was treated as always-chippable because it exists by
   *  construction. The ROOM does; the SEQ need not. Agents habitually write
   *  `#24` in one room meaning another (`dm#24` collapses to `#24` the moment
   *  the prose is quoted elsewhere), and every one of those became a dead red
   *  chip whose card then offered three guesses at the cause, none of them
   *  the real one. This is the same rule the named case has had since dm
   *  21/22 — a chip must not be able to be dead — finally applied to the bare
   *  case. Omitted means no ceiling, which is what every non-feed caller
   *  wants and is also the pre-dm-48 behaviour. */
  cite_bare_max?: number;
}): React.ReactElement {
  return (
    <div className={`pc-md ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children }) => <span className="md_external_disabled" title="Links in Hub messages are displayed but never opened by WUI">{children}</span>,
          img: ({ alt }) => <span className="md_media_blocked" aria-label={alt || "Blocked external image"}>[{alt || "image"}]</span>,
          // A code span whose WHOLE content is a hub citation becomes a chip
          // (operator dm 21/22): `commons#412`, `dm:a--b#7`, or a bare `#412`
          // for the room you are reading. The chip is a plain span carrying
          // the parsed pieces as data attributes — inert on its own; the
          // caller decides whether hovering it does anything.
          //
          // Anything else falls through to a normal <code>, INCLUDING every
          // fenced block: `className` is `language-*` there, and the anchored
          // token match rejects multi-line content regardless.
          code: ({ className: cls, children, ...rest }) => {
            const raw =
              cite_channels && !cls
                ? React.Children.toArray(children).every((c) => typeof c === "string" || typeof c === "number")
                  ? React.Children.toArray(children).join("")
                  : ""
                : "";
            const parsed = raw.length > 0 && raw.length <= 96 ? parse_citation(raw) : null;
            // A named room must be one this seat can see. A bare `#412` must
            // additionally be a seq the read room could HAVE — see
            // `cite_bare_max`; without a ceiling the bare case is chipped as
            // before.
            const in_range = parsed && (typeof cite_bare_max !== "number" || parsed.seq <= cite_bare_max);
            const cite = parsed && (parsed.channel ? cite_channels!.has(parsed.channel) : in_range) ? parsed : null;
            if (!cite) {
              return (
                <code className={cls} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <span
                className="md_cite"
                data-cite-channel={cite.channel}
                data-cite-seq={String(cite.seq)}
                tabIndex={0}
                role="button"
                title={cite.channel ? `Message #${cite.seq} in #${cite.channel} — hover for a preview` : `Message #${cite.seq} in this channel — hover for a preview`}
              >
                {raw}
              </span>
            );
          },
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
