// Memoized markdown boundary (backlog 0010, adversary P2: "when new traffic
// DOES arrive every row still re-renders — 200 markdown parses worst case").
//
// The Team page re-renders every row when ANY state changes (new message,
// badge tick, reaction). The row JSX itself is cheap; the markdown PARSE is
// the cost. Message text is immutable once posted (retraction swaps the
// body string — a prop change, so memo correctly re-renders), so a
// props-equality boundary around the parser turns an O(rows) parse storm
// into O(changed rows).
//
// Deliberately a separate module: team_page.tsx is 4k+ lines and this
// boundary needs its own render-count test (replace the parser, count
// invocations across parent re-renders).
import React from "react";

import { Markdown } from "./primitives";

export const MemoMarkdown = React.memo(Markdown);
