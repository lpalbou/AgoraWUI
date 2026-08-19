// @vfs reference syntax (operator ask 2026-08-19): `@folder/file` = the
// message's own channel's virtual file system (vfs); `@channel:folder/file`
// = another channel's. Disambiguation from seat mentions follows the hub's
// seat-identity precedence ruling: a token matching a registered seat id is
// a mention even written `@seat/...` or `@seat:...`; only tokens matching
// no known seat read as vfs references (filter_vfs_refs, roster-side).
import { describe, expect, it } from "vitest";

import { extract_vfs_refs, filter_vfs_refs } from "../../src/lib/team_model";

describe("@vfs references", () => {
  it("extracts in-channel and cross-channel references", () => {
    const text = "see @plans/q3.md and @agora-wui-work:assets/logo.png for details";
    expect(extract_vfs_refs(text)).toEqual([
      { channel: undefined, path: "plans/q3.md" },
      { channel: "agora-wui-work", path: "assets/logo.png" },
    ]);
  });

  it("requires a folder segment for the in-channel form (bare @name.md is an @seat-typo shape, not a ref)", () => {
    expect(extract_vfs_refs("ping @docs.md")).toEqual([]);
    expect(extract_vfs_refs("read @chan:readme.md")).toEqual([{ channel: "chan", path: "readme.md" }]);
  });

  it("never reads seat mentions or times as references", () => {
    expect(extract_vfs_refs("thanks @laurent and @code-tui — meet at 8:30")).toEqual([]);
  });

  it("requires an extension so version strings and slash prose stay prose", () => {
    expect(extract_vfs_refs("either/or and @v1/2 splits")).toEqual([]);
    expect(extract_vfs_refs("grab @data/set.csv now")).toEqual([{ channel: undefined, path: "data/set.csv" }]);
  });

  it("dedupes and caps", () => {
    const many = Array.from({ length: 20 }, (_, i) => `@f/x${i}.md`).join(" ") + " @f/x0.md";
    expect(extract_vfs_refs(many)).toHaveLength(8);
  });

  it("keeps refs out of email-ish and mid-word contexts", () => {
    expect(extract_vfs_refs("mail user@host/inbox.md ok")).toEqual([]);
    expect(extract_vfs_refs("(@notes/today.md)")).toEqual([{ channel: undefined, path: "notes/today.md" }]);
  });

  it("seat identity wins over files (operator ruling): known-seat tokens never chip", () => {
    const refs = extract_vfs_refs("@code/notes.md then @code:plans/x.md then @plans/q3.md");
    expect(filter_vfs_refs(refs, ["code", "laurent"])).toEqual([{ channel: undefined, path: "plans/q3.md" }]);
    // No seats known (roster unavailable): refs pass through unchanged.
    expect(filter_vfs_refs(refs, [])).toHaveLength(3);
  });

  it("matches seats case-insensitively, like the hub's lowercased candidates", () => {
    const refs = extract_vfs_refs("@Code/notes.md and @CODE:plans/x.md");
    expect(filter_vfs_refs(refs, ["code"])).toEqual([]);
  });

  it("covers the viewer's own seat when included by the caller (verifier P1)", () => {
    const refs = extract_vfs_refs("@laurent/notes.md");
    expect(filter_vfs_refs(refs, ["core", "laurent"])).toEqual([]);
  });
});
