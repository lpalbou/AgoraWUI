// Work-item id + rendered-state derivations (S3 of the unification build;
// vocabulary ruled by semantics as decision:work-item-vocabulary, S0).
//
// One spelling everywhere: <package>-<NNNN> — lowercase package directory
// name, hyphen, zero-padded 4-digit item number. Parse rule: split on the
// LAST hyphen, the tail must be all digits. '#'/':'/'/' forms were ruled
// out (URL fragment / store-key grammar / path-segment collisions).
//
// The RENDERED words (in-progress, in-review, and the staleness label) are
// continuum's owned closed set (S0 governance): each MUST be a pure
// derivation over file+claim+receipt — a rendered word is never stored,
// and a word that cannot be derived does not exist.

/** Backlog lifecycle directories — the AT-REST register (skill's set,
 *  unchanged by the unification; S0). */
export type BacklogKind = "proposed" | "planned" | "completed" | "deprecated";

/** A pointer claim row's value (S0: id + owner + started_at, NO status
 *  prose — nothing to go stale). `item`/`card` ride as optional pointers. */
export type WorkClaim = {
  owner: string;
  started_at?: string | number;
  item?: string;
  card?: string;
};

/** Parse a work id. Returns null unless the LAST-hyphen tail is all
 *  digits (the ruled grammar) — the head is the package name verbatim. */
export function parse_work_id(id: string): { package: string; num: string } | null {
  const s = String(id || "").trim();
  const at = s.lastIndexOf("-");
  if (at <= 0 || at === s.length - 1) return null;
  const head = s.slice(0, at);
  const tail = s.slice(at + 1);
  if (!/^[0-9]+$/.test(tail)) return null;
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(head)) return null;
  return { package: head, num: tail };
}

/** Derive the work id for a backlog ITEM FILE: leading digits of the
 *  filename (both NNNN_slug.md and NNN-slug.md conventions exist in the
 *  wild), zero-padded to 4 per the ruling. Null when the filename carries
 *  no leading number — such files simply have no id yet (additive
 *  migration: headers land on next touch). */
export function work_id_for_item(pkg: string, filename: string): string | null {
  const m = String(filename || "").match(/^(\d{1,4})[-_]/);
  if (!m || !pkg) return null;
  return `${pkg.toLowerCase()}-${m[1].padStart(4, "0")}`;
}

/** The claim-row store key for a work id (S0: claim:<id>). */
export function claim_key_for(id: string): string {
  return `claim:${id}`;
}

/** Basename of a work-row card path (dm 110 dedup key 2: filenames come
 *  from ONE authority — the file itself — on both sides of the join,
 *  where package spellings come from two and diverge). Tolerates ./
 *  prefixes and backslashes; empty in, empty out. */
export function basename_of_card_path(path: string | undefined | null): string {
  const p = String(path || "").replace(/\\/g, "/");
  const tail = p.split("/").filter(Boolean).pop() || "";
  return tail;
}

/** Parse a work-row card path into the drawer's (kind, filename) probe
 *  inputs: .../docs/backlog/<kind>/<file> → {kind, filename}. Null when
 *  the path carries no recognizable lifecycle directory. */
export function parse_card_path(path: string | undefined | null): { kind: "proposed" | "planned" | "completed" | "deprecated" | "recurrent"; filename: string } | null {
  const p = String(path || "").replace(/\\/g, "/");
  const m = p.match(/(?:^|\/)(proposed|planned|completed|deprecated|recurrent)\/([^/]+\.md)$/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as any, filename: m[2] };
}

/** Work ids mentioned in free text (Team-page linkification): candidate
 *  tokens validated through parse_work_id, deduped in order, capped so a
 *  pathological message cannot mint a chip wall. Requires the 4-digit
 *  tail AND a package head of >= 4 chars — prose shapes like "top-10",
 *  "utf-8", or "pre-0049" never qualify (live false positive, 2026-07-18);
 *  every real package name (agora, abstract*) clears the floor. */
const WORK_ID_TOKEN_RE = /\b([a-z][a-z0-9_.-]{3,60}-\d{4})\b/g;
const WORK_ID_CAP = 6;

export function extract_work_ids(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text || "").matchAll(WORK_ID_TOKEN_RE)) {
    const id = m[1];
    if (!parse_work_id(id)) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= WORK_ID_CAP) break;
  }
  return out;
}

/** RENDERED work state — the derivation IS the definition (S0 governance:
 *  continuum owns these words; they are computed, never stored).
 *  - "in-progress": a planned item with a LIVE pointer claim.
 *  - "in-review": receipts exist but the owner has not closed (the file
 *    still sits in planned/) — derivable only where receipt data is in
 *    hand (the /work drawer lane); column callers pass receipts=null to
 *    say "unknown", which never fabricates a review state.
 *  - otherwise the at-rest directory word stands. */
export function derive_work_state(
  kind: BacklogKind,
  claim: WorkClaim | null,
  receipts: number | null
): "proposed" | "planned" | "in-progress" | "in-review" | "completed" | "deprecated" {
  if (kind === "planned") {
    if (typeof receipts === "number" && receipts > 0) return "in-review";
    if (claim) return "in-progress";
  }
  return kind;
}

/** Staleness label for a live claim (the S4 render fold, v1): age since
 *  started_at, honestly labeled — the full file-unchanged predicate rides
 *  the drawer's /work data. Returns null under the threshold (a fresh
 *  claim is not stale) or when started_at is unparseable. */
export function claim_age_label(claim: WorkClaim, now_ms: number, stale_after_h = 24): { label: string; stale: boolean } | null {
  const raw = claim.started_at;
  if (raw === undefined || raw === null || raw === "") return null;
  let t: number;
  if (typeof raw === "number") t = raw > 1e12 ? raw : raw * 1000;
  else {
    const parsed = Date.parse(String(raw));
    if (Number.isNaN(parsed)) return null;
    t = parsed;
  }
  const h = Math.max(0, (now_ms - t) / 3_600_000);
  const label = h < 1 ? `claimed ${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `claimed ${Math.round(h)}h` : `claimed ${Math.round(h / 24)}d`;
  return { label, stale: h >= stale_after_h };
}
