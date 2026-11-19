/**
 * CSRF defence for cookie-authenticated, state-changing API routes (Task 720).
 *
 * Browsers always attach `Origin` to cross-origin POST/PUT/PATCH/DELETE (OWASP CSRF cheat sheet:
 * "Verifying origin with standard headers"). SameSite=Lax alone is not enough here: clinics live on
 * sibling subdomains (and COOKIE_DOMAIN may be shared), which are same-SITE, so Lax cookies are still
 * sent from one clinic's page to another's API. This check rejects any mutating /api request whose
 * Origin (or, if absent, Sec-Fetch-Site) says it was not initiated by our own origin.
 *
 * Non-browser callers send neither header and are let through: they cannot ride a victim's cookies.
 * Pure + dependency-free so it can run in proxy.ts (edge-safe) and be unit tested.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Own non-cookie auth (device key, Twilio signature, bulk-export bearer secret): not CSRF-able, must not be broken. */
const EXEMPT_PREFIXES = [
  "/api/imaging/receive",
  "/api/imaging/report",
  "/api/labs/receive",
  "/api/pacs/orthanc/study",
  "/api/follow-up/twilio/status",
  "/api/export-to-medplum",
];

export type CsrfInput = {
  method: string;
  pathname: string;
  headers: Headers;
  /** Extra allowed origins, comma separated (scheme://host[:port]); from CSRF_ALLOWED_ORIGINS. */
  extraAllowedOrigins?: string | null;
};

export function isCsrfExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function requestHost(h: Headers): string | null {
  const xf = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (xf || h.get("host"))?.toLowerCase() || null;
}

function parseOrigins(list: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (list ?? "").split(",")) {
    const v = raw.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin.toLowerCase());
    } catch {
      /* ignore malformed entry */
    }
  }
  return out;
}

/** Returns null when allowed, otherwise a short reason (never echo header values back). */
export function checkCsrf(input: CsrfInput): string | null {
  const method = input.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;
  if (!input.pathname.startsWith("/api/") || isCsrfExemptPath(input.pathname)) return null;

  const origin = input.headers.get("origin");
  if (origin) {
    // "null" (sandboxed iframe, redirects, file://) is never one of ours.
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return "invalid_origin";
    }
    if (parsed.host.toLowerCase() === requestHost(input.headers)) return null;
    if (parseOrigins(input.extraAllowedOrigins).has(parsed.origin.toLowerCase())) return null;
    return "cross_origin";
  }

  // No Origin (some same-origin browser requests, or non-browser clients): use Fetch Metadata if present.
  const site = input.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "cross_site_fetch";
  return null;
}
