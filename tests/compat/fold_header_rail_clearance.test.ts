// THE FOLD CONTROL AND THE ACTION RAIL MUST NOT SHARE PIXELS (operator dm 6).
//
// Reported live: on a folded thread the fold control could not be clicked.
// Cause was geometric, not logical — `.team_row_rail` is an absolutely
// positioned hover dock at the card's bottom-right, and a folded root row is
// short enough that its bottom-right IS the header's trailing edge, where the
// fold icons live. Since you must hover to reveal the rail, it was painted
// over the control every single time. Measured in a headless browser before
// the fix: overlap 22.7 x 9.5px, and elementFromPoint at the centre of the
// fold control returned the rail.
//
// Two rules keep them apart: `.team_row_head.foldable` carries `z-index: 3`
// above the rail's `2`, and foldable rows reserve a `min-height` tall enough
// that the two bands cannot meet. The browser measurement that confirmed both
// was a one-off harness, and jsdom cannot replace it: it has no layout engine,
// so every element there reports a zero-size rect and "these boxes do not
// intersect" is unmeasurable. A test shaped like that check would pass whether
// or not the fix works.
//
// What IS checkable without a browser is the arithmetic the fix rests on,
// because every number in it is a literal in the stylesheet. This re-derives
// the two band offsets from the parsed CSS and asserts they stay disjoint. It
// catches the regression that would actually happen — someone raising the
// rail's button height, its padding or its bottom offset, growing the header,
// or lowering the reserved strip — none of which any other test in this repo
// would notice.
//
// It does NOT prove the fix works in a browser; it proves the premise it was
// derived from still holds. The stacking backstop is asserted separately, and
// it is the half that survives if this arithmetic is ever outgrown.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import postcss, { type Rule, type Declaration } from "postcss";

const source = readFileSync(resolve(import.meta.dirname, "../../src/ui/team.css"), "utf8");
const sheet = postcss.parse(source, { from: "team.css" });

/** Rules matching `selector`. `within` picks the enclosing at-rule params, or
 *  top level when omitted — the distinction is load-bearing here: the coarse
 *  pointer block restates the rail buttons at 44px, and reading that copy
 *  would compute a band the fine-pointer layout never has. */
function rules_for(selector: string, within?: string): Rule[] {
  const found: Rule[] = [];
  sheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const parent = rule.parent;
    const at_params = parent && parent.type === "atrule" ? (parent as { params: string }).params : undefined;
    if (within === undefined ? at_params === undefined : at_params === within) found.push(rule);
  });
  return found;
}

/** Last declaration of `prop` on `selector` — last, because that is the one
 *  the cascade applies when a sheet sets a property twice. Throws when the
 *  rule or the declaration is absent rather than defaulting: a renamed
 *  selector must fail loudly, not silently measure zero and pass. */
function px(selector: string, prop: string, within?: string): number {
  const matches = rules_for(selector, within);
  if (matches.length === 0) throw new Error(`team.css: no rule for '${selector}'${within ? ` in @media ${within}` : ""}`);
  let raw: string | undefined;
  for (const rule of matches) {
    rule.walkDecls(prop, (decl: Declaration) => {
      raw = decl.value;
    });
  }
  if (raw === undefined) throw new Error(`team.css: '${selector}' declares no ${prop}`);
  const value = /^(-?[\d.]+)px$/.exec(raw.trim());
  if (!value) throw new Error(`team.css: '${selector}' ${prop} is '${raw}', not a px length this check can reason about`);
  return Number(value[1]);
}

/** A unitless integer declaration (`z-index`). Kept separate from `px` rather
 *  than relaxing that parser: a length that lost its unit is a real defect,
 *  and one reader accepting both would stop saying so. */
function unitless(selector: string, prop: string): number {
  const matches = rules_for(selector);
  if (matches.length === 0) throw new Error(`team.css: no rule for '${selector}'`);
  let raw: string | undefined;
  for (const rule of matches) {
    rule.walkDecls(prop, (decl: Declaration) => {
      raw = decl.value;
    });
  }
  if (raw === undefined) throw new Error(`team.css: '${selector}' declares no ${prop}`);
  const value = /^(-?\d+)$/.exec(raw.trim());
  if (!value) throw new Error(`team.css: '${selector}' ${prop} is '${raw}', not a plain integer`);
  return Number(value[1]);
}

/** Vertical component of a `padding`/`border` shorthand or longhand. */
function px_block(selector: string, prop: string, within?: string): number {
  const matches = rules_for(selector, within);
  let raw: string | undefined;
  for (const rule of matches) {
    rule.walkDecls(prop, (decl: Declaration) => {
      raw = decl.value;
    });
  }
  if (raw === undefined) throw new Error(`team.css: '${selector}' declares no ${prop}`);
  const first = /^(-?[\d.]+)px/.exec(raw.trim());
  if (!first) throw new Error(`team.css: '${selector}' ${prop} starts with '${raw}', not a px length`);
  return Number(first[1]);
}

const FINE = "not (pointer: coarse)";
const FOLDABLE_ROW = ".team_row.has_actions:has(> .team_row_main > .team_row_head.foldable)";

describe("a folded thread's header cannot be covered by the action rail", () => {
  it("the header band ends above the strip the rail reserves", () => {
    // Header band, measured from the top of the card.
    const row_padding_top = px_block(".team_row", "padding");
    const head_padding = px_block(".team_row_head.foldable", "padding");
    const head_border = px_block(".team_row_head.foldable", "border");
    const toggle_line = px(".team_reply_toggle", "min-height");
    const header_bottom = row_padding_top + toggle_line + head_padding * 2 + head_border * 2;

    // Rail band, measured from the bottom of the card.
    const rail_bottom = px(".team_row_rail", "bottom");
    const rail_padding = px_block(".team_row_rail", "padding");
    const rail_border = px_block(".team_row_rail", "border");
    const rail_button = px(".team_row_rail .btn", "height");
    const rail_height = rail_button + rail_padding * 2 + rail_border * 2;

    // The strip reserved so the two cannot meet.
    const reserved = px(FOLDABLE_ROW, "min-height", FINE);
    const rail_top = reserved - rail_bottom - rail_height;

    // Report the arithmetic on failure rather than `expected false to be
    // true`: the next reader needs to know WHICH number moved.
    expect(
      rail_top >= header_bottom,
      `header band ends at ${header_bottom}px, rail band starts at ${rail_top}px ` +
        `(reserved ${reserved}, rail ${rail_height} at bottom ${rail_bottom}) — they overlap by ` +
        `${header_bottom - rail_top}px, which is laurent's unclickable fold control`
    ).toBe(true);
  });

  it("the reserved strip keeps real clearance, not a rounding error", () => {
    // The header's line box grows with the reader's root font size while the
    // reserved strip is a fixed px value, so a clearance of 1-2px is not
    // clearance — it is the same bug one browser zoom away.
    const row_padding_top = px_block(".team_row", "padding");
    const head_padding = px_block(".team_row_head.foldable", "padding");
    const head_border = px_block(".team_row_head.foldable", "border");
    const toggle_line = px(".team_reply_toggle", "min-height");
    const header_bottom = row_padding_top + toggle_line + head_padding * 2 + head_border * 2;

    const rail_top =
      px(FOLDABLE_ROW, "min-height", FINE) -
      px(".team_row_rail", "bottom") -
      (px(".team_row_rail .btn", "height") + px_block(".team_row_rail", "padding") * 2 + px_block(".team_row_rail", "border") * 2);

    expect(rail_top - header_bottom).toBeGreaterThanOrEqual(6);
  });

  it("the header stacks above the rail, which is the half that survives a bad measurement", () => {
    // Falsified in the browser: with the reserved strip removed the boxes
    // overlap again and the click STILL lands on the fold control, because of
    // this ordering. The two halves are not redundant.
    expect(unitless(".team_row_head.foldable", "z-index")).toBeGreaterThan(unitless(".team_row_rail", "z-index"));
  });

  it("clamps the folded root only on cards that have a control to unclamp it", () => {
    // Operator dm 11: keyed on `.team_thread_group_folded` alone, this rule
    // truncated a reply-less message to four lines with nothing able to lift
    // it — `folded` is computed for every card, the fold control only when
    // there are replies. The `.has_replies` half is what keeps the clamp on
    // cards that can be unclamped; the DOM side of the seam (that reply-less
    // cards emit no `has_replies` and no control) is pinned in
    // team_page.test.tsx. Asserted on the SELECTOR because jsdom applies no
    // stylesheet, so the clamp itself is unobservable there.
    const clamp = [".team_thread_group_folded.has_replies > .team_row .team_row_body"];
    expect(rules_for(clamp[0])).toHaveLength(1);
    // And the unscoped form — the shape that caused the bug — must be gone.
    expect(rules_for(".team_thread_group_folded > .team_row .team_row_body")).toHaveLength(0);
  });

  it("reserves the strip only where the rail actually floats", () => {
    // Under a coarse pointer the rail becomes a static footer and needs no
    // reserved band; a min-height applied there would pad every card on touch
    // for nothing. Pinning the guard's scope so the fix cannot silently widen.
    expect(rules_for(FOLDABLE_ROW, FINE)).toHaveLength(1);
    expect(rules_for(FOLDABLE_ROW)).toHaveLength(0);
  });
});
