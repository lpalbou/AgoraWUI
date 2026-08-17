// Render-time crash containment (operator dm 55/57: a single message with a
// pathological token blanked the ENTIRE Team page via an unguarded throw
// during render). Fixing the specific token is necessary but not sufficient —
// ANY future render throw (a markdown edge case, a bad attachment shape, a
// kit regression) would blank the page the same way. A React error boundary
// converts a throw in its subtree into a labeled fallback, so the blast
// radius is one row/panel, never the whole console.
import React from "react";

type Props = {
  children: React.ReactNode;
  /** Rendered instead of the crashed subtree. A function gets the error so
   *  callers can show context (e.g. "message #42 failed to render"). */
  fallback: React.ReactNode | ((error: Error) => React.ReactNode);
  /** Optional side-channel for logging (never throws itself). */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Content signature: when it CHANGES, a latched error resets and the
   *  subtree re-renders (wave adversary P2-7 — a retraction tombstoning a
   *  pathological body used to stay stuck on the failure fallback). */
  resetKey?: string | number;
};

type State = { error: Error | null; for_key?: string | number };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new resetKey means the content changed — drop the latched error
    // and try rendering again (the throw may have been cured).
    if (state.error && state.for_key !== undefined && props.resetKey !== state.for_key) {
      return { error: null, for_key: props.resetKey };
    }
    if (state.for_key !== props.resetKey && !state.error) return { for_key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      this.props.onError?.(error, info);
    } catch {
      // A logging failure must never re-throw out of the boundary.
    }
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? (fallback as (e: Error) => React.ReactNode)(error) : fallback;
    }
    return this.props.children;
  }
}
