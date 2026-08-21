// The two OPT-IN posting gates the hub refuses a post with — the charter
// gate (`channel:meta.norms_required`) and the rulings gate
// (`channel:meta.rulings_required`, hub 0113) — are 409s whose text names an
// API call, not a thing a console user can type. The console recovers from
// each by matching the refusal and re-reading the surface that clears it, so
// the recovery is only as good as those two patterns still matching what the
// hub actually raises.
//
// This is a SEAM test, and it is written to fail loudly: the literal strings
// below are copied from agorahub `src/agora/hub/service.py`
// (`_require_rulings_ack`, and the charter gate it mirrors). Delete either
// recovery branch in team_page.tsx and this goes red. A hub that rewords a
// refusal makes it go red too — which is the point, because the console
// would otherwise dead-end on a raw error with no way out.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const TEAM_PAGE = readFileSync(resolve(__dirname, "../../src/ui/team_page.tsx"), "utf8");

/** Pull the regex literal out of a `if (/…/i.test(msg)) …` recovery branch,
 *  by the recovery call it makes — so the test reads the SHIPPED pattern
 *  rather than a copy of it that could drift. */
function recovery_pattern(recovery_call: string): RegExp {
  const m = TEAM_PAGE.match(new RegExp(String.raw`if \(/([^/]+)/i\.test\(msg\)\) void ${recovery_call}`));
  if (!m) throw new Error(`no post-failure recovery branch calling ${recovery_call} in team_page.tsx`);
  return new RegExp(m[1], "i");
}

describe("posting-gate recovery matches the hub's refusals", () => {
  it("recognises the rulings gate (409) and re-reads the digest", () => {
    // service.py _require_rulings_ack, verbatim shape.
    const refusal =
      "this channel requires acknowledging standing rulings first: GET /channels/commons/digest " +
      "(see unacknowledged_rulings), then POST /channels/commons/ruling-acks — pending: ruling:no-external-assets";
    expect(recovery_pattern(String.raw`refresh_rulings\(selected\)`).test(refusal)).toBe(true);
  });

  it("recognises a rulings refusal that names more pending rows than it lists", () => {
    const refusal =
      "this channel requires acknowledging standing rulings first: GET /channels/commons/digest " +
      "(see unacknowledged_rulings), then POST /channels/commons/ruling-acks — pending: " +
      "ruling:a, ruling:b, ruling:c, ruling:d, ruling:e (+2 more)";
    expect(recovery_pattern(String.raw`refresh_rulings\(selected\)`).test(refusal)).toBe(true);
  });

  it("keeps the charter gate on its own recovery — the two are different reads", () => {
    const charter_refusal = "this channel requires reading its charter first: read_charter(channel='commons')";
    const rulings = recovery_pattern(String.raw`refresh_rulings\(selected\)`);
    const charter = recovery_pattern(String.raw`refresh_owed\(\)`);
    expect(charter.test(charter_refusal)).toBe(true);
    // Crossed wires would send a gated seat to the surface that cannot clear
    // its gate — the failure mode this pair of assertions exists to catch.
    expect(rulings.test(charter_refusal)).toBe(false);
    expect(charter.test("this channel requires acknowledging standing rulings first")).toBe(false);
  });

  it("does not fire on an unrelated post failure", () => {
    const rulings = recovery_pattern(String.raw`refresh_rulings\(selected\)`);
    expect(rulings.test("rate limited: slow down")).toBe(false);
    expect(rulings.test("agent is not a member of 'commons'")).toBe(false);
  });
});
