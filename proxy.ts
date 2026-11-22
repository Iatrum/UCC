import { NextRequest, NextResponse } from "next/server";
import {
  adminPortalPath,
  deriveSubdomainContext,
  getHostFromNextRequest,
} from "@/lib/server/subdomain-host";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { checkCsrf } from "@/lib/security/csrf";

export function proxy(req: NextRequest) {
  const host = getHostFromNextRequest(req);
  const context = deriveSubdomainContext(host);
  const { pathname } = req.nextUrl;

  // ── Admin subdomain ─────────────────────────────────────────
  // Redirect admin.domain.com → domain.com/admin/* so the path-based URL
  // remains the single canonical entry point for the admin portal.
  if (context.type === "admin") {
    const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || "";
    if (BASE_DOMAIN) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.hostname = BASE_DOMAIN;
      redirectUrl.pathname = adminPortalPath(pathname);
      return NextResponse.redirect(redirectUrl, 308);
    }
  }

  // CSRF (Task 720): same-origin / allow-listed Origin only for mutating /api calls (device + webhook routes exempt).
  const csrf = checkCsrf({
    method: req.method,
    pathname,
    headers: req.headers,
    protocol: req.nextUrl.protocol,
    extraAllowedOrigins: process.env.CSRF_ALLOWED_ORIGINS,
  });
  if (csrf) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  // Per-request nonce CSP: Next.js reads the nonce from the request CSP header and stamps its scripts.
  const nonce = generateNonce();
  const csp = buildCsp(nonce, {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_MEDPLUM_BASE_URL: process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    CSP_EXTRA_HOSTS: process.env.CSP_EXTRA_HOSTS,
  });
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next|static|favicon.ico|manifest.json).*)"],
};
