// @vitest-environment node
//
// THE LEDGER VERIFIER HAD NO TESTS OF ITS OWN. `src/lib/hub_ledger.ts` decides
// whether the WUI shows a channel's transcript as verified, and the only test
// file that imported it did so incidentally, through a UI pin. A mutation
// sweep of the module measured the gap rather than guessing at it: 42 operator
// mutants, 22 of them surviving the ENTIRE suite — including the chain-break
// detector and the head-mismatch check, either of which can be inverted while
// every test stays green. A verifier that cannot fail is not a verifier.
//
// TWO ORACLES, AND THE DISTINCTION IS THE WHOLE POINT.
//
// 1. verify_ledger's LOGIC is testable against itself: build a real chain with
//    turn_hash, then tamper it. Round-tripping proves the detector fires.
//
// 2. canonical_json and py_float_repr are NOT. Their correctness is defined by
//    byte-for-byte agreement with the Python hub's `json.dumps(sort_keys=True,
//    separators=(",",":"), ensure_ascii=True)` and CPython's `repr(float)`. A
//    round-trip test would pass just as happily against a mutant that changed
//    the hash CONSISTENTLY on both sides — self-consistency is not agreement.
//    So every case below asserts a literal string taken from the Python
//    behaviour the module's own docstrings name, never from what the code
//    currently returns.
import { describe, expect, it } from "vitest";

import { CanonicalFloat, canonical_json, py_float_repr, turn_hash, verify_ledger } from "../../src/lib/hub_ledger";
import type { LedgerResponse, LedgerTurn } from "../../src/lib/hub_ledger";

const CHANNEL = "commons";

function turn(seq: number, over: Partial<LedgerTurn> = {}): LedgerTurn {
  return {
    seq,
    id: `m${seq}`,
    sender: "agora-wui",
    kind: "message",
    status: "fyi",
    title: `title ${seq}`,
    body: `body ${seq}`,
    reply_to: null,
    created_at: 1787000000 + seq,
    hash: null,
    ...over,
  } as LedgerTurn;
}

/** Build a correctly-chained ledger, hashes computed the way the Hub would. */
async function chain(turns: LedgerTurn[]): Promise<LedgerResponse> {
  let prev = "";
  const out: LedgerTurn[] = [];
  for (const t of turns) {
    const hash = await turn_hash(prev, t, CHANNEL);
    out.push({ ...t, hash });
    prev = hash;
  }
  return { channel: CHANNEL, count: out.length, head: out[out.length - 1]?.hash ?? "", turns: out };
}

describe("verify_ledger detects what it exists to detect", () => {
  it("accepts an intact chain", async () => {
    const v = await verify_ledger(await chain([turn(1), turn(2), turn(3)]));
    expect(v).toMatchObject({ ok: true, broken_at: null, head_mismatch: false, hashed: 3, legacy: 0, redacted: 0 });
  });

  it("names the seq where a body was edited after hashing", async () => {
    const led = await chain([turn(1), turn(2), turn(3)]);
    led.turns[1] = { ...led.turns[1], body: "tampered" };
    const v = await verify_ledger(led);
    expect(v.ok).toBe(false);
    expect(v.broken_at).toBe(2);
  });

  it("catches a head that does not match the chain it serves", async () => {
    // Every leaf verifies, but the head is somebody else's. Without the
    // head check a served-head swap is invisible.
    const led = await chain([turn(1), turn(2)]);
    led.head = "0".repeat(64);
    const v = await verify_ledger(led);
    expect(v.head_mismatch).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.broken_at).toBeNull();
  });

  it("treats an unhashed row AFTER a hashed one as a break", async () => {
    // The rule the code states: unhashed rows are legitimate only BEFORE the
    // first hashed turn. This is the direction that matters — a hole punched
    // mid-chain must not read as legacy data.
    const led = await chain([turn(1), turn(2)]);
    led.turns.push(turn(3, { hash: null }));
    led.head = led.turns[1].hash!;
    const v = await verify_ledger(led);
    expect(v.broken_at).toBe(3);
    expect(v.ok).toBe(false);
  });

  it("accepts unhashed rows BEFORE the first hashed one as legacy", async () => {
    // The opposite direction, and it is what stops the rule above from being
    // satisfiable by a verifier that simply always reports a break.
    const tail = await chain([turn(2), turn(3)]);
    const led: LedgerResponse = {
      channel: CHANNEL,
      count: 3,
      head: tail.head,
      turns: [turn(1, { hash: null }), ...tail.turns],
    };
    const v = await verify_ledger(led);
    expect(v).toMatchObject({ ok: true, broken_at: null, legacy: 1, hashed: 2 });
  });

  it("does not call a retracted turn tampering", async () => {
    // Rule 5: a tombstone cannot be recomputed. Reporting TAMPERED here would
    // tell an operator their transcript was edited when an author unsaid a line.
    const led = await chain([turn(1), turn(2)]);
    led.turns[1] = { ...led.turns[1], retracted: true, body: "", title: "" };
    led.head = led.turns[1].hash!;
    const v = await verify_ledger(led);
    expect(v).toMatchObject({ ok: true, broken_at: null, redacted: 1, hashed: 2 });
  });
});

describe("py_float_repr reproduces CPython repr(float), not JS String()", () => {
  // Each expectation is CPython's output. Where JS diverges is noted, because
  // that divergence IS the ledger bug this function exists to prevent.
  const CASES: Array<[number, string, string?]> = [
    [0, "0.0", "JS String(0) is '0'"],
    [-0, "-0.0", "JS String(-0) is '0' — the sign is lost"],
    [1, "1.0", "JS String(1) is '1' — no trailing .0"],
    [100, "100.0"],
    [0.1, "0.1"],
    [1234.5, "1234.5"],
    [-2.5, "-2.5"],
    [1e15, "1000000000000000.0", "decpt 16 is still fixed notation"],
    [1e16, "1e+16", "JS only goes exponential past 1e21"],
    [1e-4, "0.0001", "decpt -3 is still fixed"],
    [1e-5, "1e-05", "JS gives '0.00001'; note the 2-digit exponent"],
    [1.5e-7, "1.5e-07", "JS gives '1.5e-7' — one exponent digit"],
  ];
  for (const [input, expected, why] of CASES) {
    it(`${Object.is(input, -0) ? "-0" : input} -> ${expected}${why ? ` (${why})` : ""}`, () => {
      expect(py_float_repr(input)).toBe(expected);
    });
  }

  it("refuses a non-finite value rather than inventing a repr", () => {
    expect(() => py_float_repr(NaN)).toThrow();
    expect(() => py_float_repr(Infinity)).toThrow();
  });
});

describe("canonical_json matches Python json.dumps, byte for byte", () => {
  it("renders booleans and null as Python does", () => {
    expect(canonical_json(true)).toBe("true");
    expect(canonical_json(false)).toBe("false");
    expect(canonical_json(null)).toBe("null");
  });

  it("keeps integers as ints and forces floats through the float repr", () => {
    expect(canonical_json(5)).toBe("5");
    expect(canonical_json(-0)).toBe("-0.0");
    expect(canonical_json(2.5)).toBe("2.5");
    // A float-typed field (a ledger timestamp) keeps its .0 even when integral.
    expect(canonical_json(new CanonicalFloat(3))).toBe("3.0");
  });

  it("escapes exactly the characters Python escapes", () => {
    expect(canonical_json('a"b')).toBe('"a\\"b"');
    expect(canonical_json("a\\b")).toBe('"a\\\\b"');
    expect(canonical_json("\b")).toBe('"\\b"');
    expect(canonical_json("\t")).toBe('"\\t"');
    expect(canonical_json("\n")).toBe('"\\n"');
    expect(canonical_json("\f")).toBe('"\\f"');
    expect(canonical_json("\r")).toBe('"\\r"');
  });

  it("escapes control characters and every non-ASCII code unit", () => {
    // ensure_ascii=True. The two halves are separate branches of one
    // condition, so both directions are posed.
    expect(canonical_json("")).toBe('"\\u0001"');
    expect(canonical_json("é")).toBe('"\\u00e9"');
    // ...and a plain printable ASCII char must NOT be escaped, or the check
    // above would pass against a function that escapes everything.
    expect(canonical_json("A~ ")).toBe('"A~ "');
  });

  it("sorts object keys and uses Python's compact separators", () => {
    expect(canonical_json({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonical_json([1, "x", true])).toBe('[1,"x",true]');
  });
});
