// Hub citations — the `#412` / `commons#412` cross-references the fleet
// writes constantly — become hover chips (operator dm 21/22: "when there is
// a #XXX ... a mouseover card showing the message"; dm 22: "ideally it
// should also work with reference to message on other channel").
//
// THIS FILE IS THE RECOGNISER'S CONTRACT, and the recogniser is the half
// that can go wrong quietly. A missed citation is a chip the operator does
// not get; a FALSE citation is worse — it turns ordinary prose into a
// clickable-looking control that resolves to nothing, and it does it inside
// other people's messages. So most of what is pinned here is what must NOT
// match.
import { describe, expect, it } from "vitest";

import { linkify_citations, parse_citation } from "../../src/lib/team_model";

describe("parse_citation — the token grammar", () => {
  it("reads a bare seq as 'this channel', which the parser refuses to guess", () => {
    expect(parse_citation("#412")).toEqual({ channel: "", seq: 412 });
  });

  it("reads channel#seq", () => {
    expect(parse_citation("commons#412")).toEqual({ channel: "commons", seq: 412 });
  });

  it("reads a DM room, colons and double dashes included", () => {
    // The room laurent and this seat are talking in is literally named
    // `dm:agora-wui--laurent`. A grammar that cannot express it would make
    // dm 22 ("reference to message on other channel") half-work.
    expect(parse_citation("dm:agora-wui--laurent#20")).toEqual({ channel: "dm:agora-wui--laurent", seq: 20 });
    expect(parse_citation("hub-notice-delivery#7")).toEqual({ channel: "hub-notice-delivery", seq: 7 });
  });

  it("is anchored: prose that merely CONTAINS a citation is not one", () => {
    // This is what stops a whole code span of prose from becoming a chip.
    expect(parse_citation("see commons#412 for the detail")).toBeNull();
    expect(parse_citation("commons#412.")).toBeNull();
  });

  it("rejects the non-seqs", () => {
    expect(parse_citation("#0")).toBeNull(); // the hub numbers from 1
    expect(parse_citation("#0412")).toBeNull(); // a leading zero is formatting, not a ref
    expect(parse_citation("#")).toBeNull();
    expect(parse_citation("#abc")).toBeNull();
    expect(parse_citation("commons")).toBeNull();
    expect(parse_citation("#commons")).toBeNull();
    expect(parse_citation("")).toBeNull();
    expect(parse_citation("#12345678901")).toBeNull(); // 11 digits — not a seq
  });

  it("tolerates surrounding whitespace, since the renderer hands it code-span text", () => {
    expect(parse_citation("  commons#412 ")).toEqual({ channel: "commons", seq: 412 });
  });
});

describe("linkify_citations — what becomes a chip", () => {
  it("wraps a bare citation in prose", () => {
    expect(linkify_citations("answered at #412 already")).toBe("answered at `#412` already");
  });

  it("wraps a cross-channel citation", () => {
    expect(linkify_citations("see commons#77 and webos#171")).toBe("see `commons#77` and `webos#171`");
  });

  it("wraps at the very start of the text, where there is no preceding character", () => {
    expect(linkify_citations("#412 is the one")).toBe("`#412` is the one");
  });

  it("wraps adjacent citations separated only by punctuation", () => {
    expect(linkify_citations("(#5), (#6)")).toBe("(`#5`), (`#6`)");
  });
});

describe("linkify_citations — what must NOT become a chip", () => {
  it("leaves markdown headings alone", () => {
    // A heading is `#` + SPACE, so it never had digits attached; the case
    // that would break is `#4` at line start, which IS a citation.
    const text = "# The shape\n\n## Four instances\n\ntext";
    expect(linkify_citations(text)).toBe(text);
  });

  it("leaves a channel mention with no seq alone", () => {
    expect(linkify_citations("routed to #commons instead")).toBe("routed to #commons instead");
  });

  it("leaves URL fragments alone", () => {
    // The live pipeline runs autolink_body first, which already backticks
    // URLs — but this must hold on its own, because a rule that only works
    // because of its neighbour breaks when the neighbour moves.
    expect(linkify_citations("https://example.dev/spec#12")).toBe("https://example.dev/spec#12");
    expect(linkify_citations("https://example.dev#12")).toBe("https://example.dev#12");
  });

  it("leaves fenced code alone", () => {
    const text = "before\n\n```\ncommons#77 stays code\n```\n\nafter #5";
    expect(linkify_citations(text)).toBe("before\n\n```\ncommons#77 stays code\n```\n\nafter `#5`");
  });

  it("leaves an inline code span alone — including one that is ALREADY a citation", () => {
    // Not an omission: the rules tell agents to write citations in
    // backticks, and the renderer recognises that span directly. Wrapping
    // it again would produce ``#412`` and render as a literal backtick.
    expect(linkify_citations("cite it as `commons#412` please")).toBe("cite it as `commons#412` please");
  });

  it("is idempotent — a second pass adds nothing", () => {
    const once = linkify_citations("answered at #412 and commons#77");
    expect(linkify_citations(once)).toBe(once);
  });

  it("leaves a rejected seq shape untouched rather than half-wrapping it", () => {
    // `#0412` matches the coarse scan and is then refused by the grammar.
    // The failure mode this pins: emitting a backtick pair around text the
    // renderer will not recognise, i.e. silently restyling prose as code.
    expect(linkify_citations("build #0412 failed")).toBe("build #0412 failed");
    expect(linkify_citations("issue #0 filed")).toBe("issue #0 filed");
  });

  it("returns the input unchanged when there is no `#` + digit at all — the cheap path", () => {
    const text = "no citations here, only #commons and a # heading";
    expect(linkify_citations(text)).toBe(text);
  });
});
