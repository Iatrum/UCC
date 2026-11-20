// Task 712: one idempotency key per Sign attempt. A retry after a slow/timed-out response (or a double
// click) re-sends the SAME key, so the server reuses the consultation it already created. The key is bound
// to the signed content: if the doctor edits the note after a failure, a fresh key is used (new content
// must not be silently dropped). Kept in sessionStorage so a page reload mid-retry keeps the key.

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "ucc.signAttempt.";

function defaultStore(): KeyStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function newKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`.padEnd(8, "0");
}

function fingerprint(...parts: string[]): string {
  let h = 5381;
  for (const ch of parts.join("\u0000")) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

export function signAttemptKey(patientId: string, notes: string, diagnosis: string, store: KeyStore | null = defaultStore()): string {
  const fp = fingerprint(notes, diagnosis);
  const slot = `${PREFIX}${patientId}`;
  try {
    const saved = JSON.parse(store?.getItem(slot) ?? "null") as { key?: string; fp?: string } | null;
    if (saved?.key && saved.fp === fp) return saved.key;
  } catch { /* fall through to a new key */ }
  const key = newKey();
  try { store?.setItem(slot, JSON.stringify({ key, fp })); } catch { /* storage unavailable: in-flight guard still applies */ }
  return key;
}

export function clearSignAttemptKey(patientId: string, store: KeyStore | null = defaultStore()): void {
  try { store?.removeItem(`${PREFIX}${patientId}`); } catch { /* ignore */ }
}
