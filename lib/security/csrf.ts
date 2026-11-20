/** CSRF defence for state-changing App Router API requests. */
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
  protocol: string;
  /** Extra allowed origins, comma separated (scheme://host[:port]); from CSRF_ALLOWED_ORIGINS. */
  extraAllowedOrigins?: string | null;
};

export function isCsrfExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function parseHttpOrigin(value: string, allowDefaultPort = false): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const normalized = value.toLowerCase();
    if (parsed.origin === normalized) return parsed;
    if (allowDefaultPort && !parsed.port && normalized === `${parsed.origin}:${defaultPort(parsed.protocol)}`) return parsed;
    return null;
  } catch {
    return null;
  }
}

function matchesRequestOrigin(source: URL, input: CsrfInput): boolean {
  const host = input.headers.get("host")?.toLowerCase();
  if (source.protocol !== input.protocol) return false;
  if (source.host === host) return true;
  return !source.port && host === `${source.hostname}:${defaultPort(source.protocol)}`;
}

function isExplicitlyAllowed(source: URL, list?: string | null): boolean {
  return (list ?? "").split(",").some((entry) => parseHttpOrigin(entry.trim(), true)?.origin === source.origin);
}

/** Returns null when allowed, otherwise a short reason (never echo header values back). */
export function checkCsrf(input: CsrfInput): string | null {
  const method = input.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;
  // Collapse repeated slashes so `//api/x` cannot dodge the prefix test while still routing to /api/x.
  const pathname = input.pathname.replace(/\/{2,}/g, "/");
  if (!(pathname === "/api" || pathname.startsWith("/api/")) || isCsrfExemptPath(pathname)) return null;

  const origin = input.headers.get("origin");
  const site = input.headers.get("sec-fetch-site");
  if (origin !== null) {
    const source = parseHttpOrigin(origin);
    if (!source) return "invalid_origin";
    if (isExplicitlyAllowed(source, input.extraAllowedOrigins)) return null;
    if (site !== null && site !== "same-origin") return "cross_site_fetch";
    return matchesRequestOrigin(source, input) ? null : "cross_origin";
  }

  if (site === "same-origin") return null;
  if (site !== null) return "cross_site_fetch";

  // Headerless API clients can send requests that require a browser CORS preflight
  // across origins. Protected API routes do not allow cross-origin preflights.
  if (method === "PUT" || method === "PATCH" || method === "DELETE") return null;
  if (method === "POST" && input.headers.get("content-type")?.toLowerCase() === "application/json") return null;
  return "missing_origin";
}
