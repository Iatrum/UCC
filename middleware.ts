import { NextRequest, NextResponse } from "next/server";
import { CLINIC_COOKIE, IS_ADMIN_COOKIE } from "@/lib/server/cookie-constants";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || "";

type SubdomainContext =
  | { type: "admin" }
  | { type: "clinic"; clinicId: string }
  | { type: "none" };

function deriveContext(host: string | null): SubdomainContext {
  if (!host) return { type: "none" };
  if (host.startsWith("localhost") || /^\d{1,3}(\.\d{1,3}){3}/.test(host)) {
    return { type: "none" };
  }

  const bare = host.split(":")[0];
  const parts = bare.split(".");
  if (parts.length < 3) return { type: "none" };

  const [sub, ...rest] = parts;
  if (BASE_DOMAIN && rest.join(".") !== BASE_DOMAIN) return { type: "none" };

  if (sub === "admin") return { type: "admin" };
  if (["www", "app", "auth"].includes(sub)) return { type: "none" };
  return { type: "clinic", clinicId: sub };
}

export function middleware(req: NextRequest) {
  const context = deriveContext(req.headers.get("host"));
  const { pathname } = req.nextUrl;

  // ── Admin subdomain ─────────────────────────────────────────
  if (context.type === "admin") {
    // Rewrite clean URLs: admin.drhidayat.com/clinics → /admin/clinics
    // Skip rewriting if already under /admin, /login, /api, or static paths
    const shouldRewrite =
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/_next");

    const url = req.nextUrl.clone();
    if (shouldRewrite) {
      url.pathname = pathname === "/" ? "/admin" : "/admin" + pathname;
    }

    const res = shouldRewrite
      ? NextResponse.rewrite(url)
      : NextResponse.next();

    res.cookies.set(IS_ADMIN_COOKIE, "true", {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }

  // ── Clinic subdomain ─────────────────────────────────────────
  if (context.type === "clinic") {
    const res = NextResponse.next();
    const existing = req.cookies.get(CLINIC_COOKIE)?.value;
    if (existing !== context.clinicId) {
      res.cookies.set(CLINIC_COOKIE, context.clinicId, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      });
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|static|favicon.ico|manifest.json).*)"],
};
