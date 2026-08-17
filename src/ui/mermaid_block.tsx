// Lazy mermaid diagram renderer (iteration-3: the pathway graph must be
// SEEN, not read as source). The library loads on first use only — the
// main bundle stays clean; a load/parse failure degrades to the fenced
// source with a labeled note, never a blank or a crash (ErrorBoundary
// class: one bad diagram must not take the viewer down).
import React, { useEffect, useRef, useState } from "react";

let mermaid_ready: Promise<any> | null = null;

function load_mermaid(): Promise<any> {
  if (!mermaid_ready) {
    mermaid_ready = import("mermaid").then((mod) => {
      const m = (mod as any).default || mod;
      // securityLevel strict: peer-authored graph text must not inject
      // HTML/click handlers through labels (same posture as the kit's
      // sanitizing Markdown).
      m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
      return m;
    });
  }
  return mermaid_ready;
}

let seq = 0;

export function MermaidBlock(props: { text: string }): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, set_error] = useState("");

  useEffect(() => {
    let alive = true;
    set_error("");
    load_mermaid()
      .then(async (m) => {
        const id = `af_mermaid_${(seq += 1)}`;
        const { svg } = await m.render(id, props.text);
        if (alive && host.current) host.current.innerHTML = svg;
      })
      .catch((e: any) => {
        if (alive) set_error(String(e?.message || e || "mermaid render failed"));
      });
    return () => {
      alive = false;
    };
  }, [props.text]);

  if (error) {
    return (
      <div className="team_mermaid_error">
        <div className="muted team_note">#FALLBACK diagram did not render ({error.slice(0, 120)}) — source below:</div>
        <pre className="team_mermaid_src">{props.text}</pre>
      </div>
    );
  }
  return <div className="team_mermaid" ref={host} />;
}
