/** Pure helpers for the admin screens (Task 510). */

/** Trimmed env value, or null when unset/blank ("not configured"). */
export function configuredValue(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
}

/** Only http(s) URLs may be rendered as links. */
export function isHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Case-insensitive match of a query against any of the given fields. Empty query matches all. */
export function matchesSearch(query: string | undefined | null, fields: Array<string | null | undefined>): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Order-insensitive comparison of module id lists. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function assignedLabel(assigned: number, total: number): string {
  return `Assigned to a clinic: ${assigned} of ${total}`;
}
