// Independent agora ledger verification (Team page "Verify transcript" —
// the designer's 0.9.0 fact 3, adopted c1725; claim:continuum-team-page-slice2).
//
// Reimplements the canonicalization from AgoraHub docs/protocol.md
// ("Verbatim ledger", agora/0.3) exactly as scripts/verify_ledger.py does:
//   hash = sha256(prev_hash + "\n" + canonical(hashed fields))
// where canonical = JSON with sorted keys, compact separators, and
// ASCII-only escaping. INDEPENDENCE is the point: this module recomputes
// every hash from the served turns and never trusts the hub's own
// `verified` flag. Cross-language parity is test-pinned against a
// Python-computed vector (hub_ledger.test.ts).

export type LedgerTurn = {
  id: string;
  seq: number;
  sender: string;
  kind: string;
  status: string;
  urgency: string;
  critical: number | boolean;
  downgraded: number | boolean;
  to: string[];
  title: string;
  body: string;
  data: unknown;
  reply_to: string | null;
  created_at: number;
  hash: string | null;
};

export type LedgerResponse = { channel: string; count: number; head: string; turns: LedgerTurn[] };

export type LedgerVerdict = {
  ok: boolean;
  /** First seq whose recomputed hash diverges (or an unhashed row after a
   *  hashed one — legitimate only as pre-ledger history). */
  broken_at: number | null;
  /** Chain internally consistent but the served head is not the last
   *  hashed turn's hash. */
  head_mismatch: boolean;
  computed_head: string;
  hashed: number;
  legacy: number;
};

/** The 15 hashed fields of a turn (protocol.md rule 1). Anything else the
 *  response may carry one day is ignored. */
const HASHED_FIELDS = [
  "id", "channel", "seq", "sender", "kind", "status", "urgency",
  "critical", "downgraded", "to", "title", "body", "data",
  "reply_to", "created_at",
] as const;

/** Python json.dumps(..., ensure_ascii=True) string escaping: every
 *  non-ASCII code unit becomes \uXXXX (surrogate pairs stay as two
 *  escapes, matching Python's UTF-16-style output for astral chars). */
function ascii_json_string(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20 || code > 0x7e) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

/** A number that MUST canonicalize as a Python float even when its value
 *  is integral (agora canonicalization.json / agora-0118): Python's
 *  `json.dumps(2.0)` is `"2.0"` while JS `String(2.0)` is `"2"`. A float
 *  field (a ledger `created_at` timestamp; a JSON literal written with a
 *  `.`/`e`) is wrapped so `canonical_json` emits Python-repr bytes and the
 *  recomputed hash matches the hub's — the integral-float divergence was
 *  the highest-severity cross-language drift, and an unwrapped verifier
 *  read INTACT chains as TAMPERED. */
export class CanonicalFloat {
  constructor(public readonly value: number) {}
}

/** Reproduce CPython's `repr(float)` byte-for-byte (the json.dumps float
 *  form): shortest round-trip digits, fixed notation when the decimal
 *  point sits in (-4, 16], else exponential with a sign and >=2-digit
 *  exponent; integral values keep a trailing `.0`; -0.0 preserved. This
 *  is where JS `String`/`toString` diverges (no `.0`, exponent only past
 *  1e21, `1e-7` not `1e-07`), which is exactly the ledger bug. */
export function py_float_repr(x: number): string {
  if (!Number.isFinite(x)) throw new Error("py_float_repr: non-finite");
  if (Object.is(x, -0)) return "-0.0";
  if (x === 0) return "0.0";
  const neg = x < 0;
  const abs = Math.abs(x);
  // Shortest round-trip mantissa digits + base-10 exponent of the first
  // digit, via toExponential() (no arg = shortest unique representation).
  const exp_str = abs.toExponential();
  const m = exp_str.match(/^(\d)(?:\.(\d+))?e([+-]\d+)$/);
  if (!m) return (neg ? "-" : "") + String(abs); // unreachable for finite
  const digits = m[1] + (m[2] || "");
  const e = parseInt(m[3], 10);
  const decpt = e + 1; // decimal point position relative to `digits` start
  let body: string;
  if (decpt <= -4 || decpt > 16) {
    // Exponential: d[.rest]e±NN (min 2 exponent digits, always signed).
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
    const exp = decpt - 1;
    const es = (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
    body = `${mant}e${es}`;
  } else if (decpt <= 0) {
    body = "0." + "0".repeat(-decpt) + digits;
  } else if (decpt >= digits.length) {
    body = digits + "0".repeat(decpt - digits.length) + ".0";
  } else {
    body = digits.slice(0, decpt) + "." + digits.slice(decpt);
  }
  return (neg ? "-" : "") + body;
}

/** Canonical JSON matching Python's json.dumps(sort_keys=True,
 *  separators=(",",":"), ensure_ascii=True, allow_nan=False). Plain JS
 *  numbers render as integers when integral (Python int) else via the
 *  float repr; a `CanonicalFloat` forces the float repr even for integral
 *  values (a float-typed field like a ledger timestamp). Non-integral
 *  plain numbers and floats both route through py_float_repr so exponent
 *  and precision formatting match Python, not ECMA-262. */
export function canonical_json(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof CanonicalFloat) {
    if (!Number.isFinite(value.value)) throw new Error("canonical_json: non-finite number");
    return py_float_repr(value.value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical_json: non-finite number");
    // A bare integral number is a Python int (seq, counts); a bare
    // non-integral number is a float (Python repr). -0 is a float.
    if (Number.isInteger(value) && !Object.is(value, -0)) return String(value);
    return py_float_repr(value);
  }
  if (typeof value === "string") return ascii_json_string(value);
  if (Array.isArray(value)) return "[" + value.map(canonical_json).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return "{" + keys.map((k) => ascii_json_string(k) + ":" + canonical_json((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  throw new Error(`canonical_json: unsupported type ${typeof value}`);
}

async function sha256_hex(text: string): Promise<string> {
  // Browser path (secure contexts) and vitest/node both expose webcrypto.
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function turn_hash(prev_hash: string, turn: LedgerTurn, channel: string): Promise<string> {
  const fields: Record<string, unknown> = {};
  for (const k of HASHED_FIELDS) {
    if (k === "channel") continue;
    fields[k] = (turn as Record<string, unknown>)[k] ?? null;
  }
  fields["channel"] = channel;
  // created_at is a FLOAT field server-side (a Python timestamp) — an
  // integral value must still canonicalize as "2.0", not "2" (agora
  // canonicalization.json). JSON.parse collapsed the float-ness, so
  // re-assert it here; a null (absent) stays null.
  if (typeof fields["created_at"] === "number") {
    fields["created_at"] = new CanonicalFloat(fields["created_at"] as number);
  }
  return await sha256_hex(prev_hash + "\n" + canonical_json(fields));
}

/** Recompute the whole chain (protocol.md rule 4). Mirrors the reference
 *  verifier: walk the STORED chain like the hub does, report the first
 *  broken seq, and compare the served head against the last recomputed
 *  hash. */
export async function verify_ledger(ledger: LedgerResponse): Promise<LedgerVerdict> {
  const channel = ledger.channel;
  let prev = "";
  let hashed = 0;
  let legacy = 0;
  let broken_at: number | null = null;
  let computed_head = "";
  for (const turn of ledger.turns) {
    if (turn.hash === null || turn.hash === undefined) {
      // Unhashed rows are legitimate only BEFORE the first hashed turn.
      if (hashed > 0 && broken_at === null) broken_at = turn.seq;
      legacy += 1;
      prev = "";
      continue;
    }
    const expect = await turn_hash(prev, turn, channel);
    if (expect !== turn.hash && broken_at === null) broken_at = turn.seq;
    prev = turn.hash;
    computed_head = expect;
    hashed += 1;
  }
  const head_mismatch = broken_at === null && String(ledger.head || "") !== computed_head;
  return { ok: broken_at === null && !head_mismatch, broken_at, head_mismatch, computed_head, hashed, legacy };
}
