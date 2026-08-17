// Browser-safe reader for a cache file explicitly selected by the person at
// the keyboard. It mirrors the public Agora key-cache shape used by native
// clients, but never reads a filesystem path itself and never persists keys.

export type CachedAgoraSeat = {
  hub_url: string;
  seat: string;
  bearer_token: string;
};

function split_cache_key(key: string): { hub_url: string; seat: string } | null {
  const marker = key.lastIndexOf("::");
  if (marker <= 0 || marker === key.length - 2) return null;
  const hub_url = key.slice(0, marker).replace(/\/+$/, "");
  const seat = key.slice(marker + 2).trim();
  if (!hub_url || !seat) return null;
  return { hub_url, seat };
}

/** Parse only the documented `{"<hub-url>::<seat>": "agora_..."}` cache
 * entries. Invalid or unfamiliar rows are ignored rather than guessed. */
export function parse_agora_key_cache(text: string): CachedAgoraSeat[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid Agora key-cache JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("That file does not contain Agora seat keys.");
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .flatMap(([key, value]) => {
      const parsed = split_cache_key(key);
      const bearer_token = typeof value === "string" ? value.trim() : "";
      return parsed && bearer_token ? [{ ...parsed, bearer_token }] : [];
    });
  if (!entries.length) throw new Error("No Agora seat keys were found in that file.");
  return entries;
}
