const SAFE_NEXT_BASE = "http://safe-next.invalid";

export function isAdminPath(path: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(path, SAFE_NEXT_BASE).pathname;
  } catch {
    return false;
  }
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function safeNext(path: string | null): string | undefined {
  if (!path || !path.startsWith("/") || /[\x00-\x1f\\]/.test(path)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(path, SAFE_NEXT_BASE);
  } catch {
    return undefined;
  }

  if (url.origin !== SAFE_NEXT_BASE) {
    return undefined;
  }

  if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) {
    return undefined;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export type LoginRedirectDecision =
  | { action: "stay" }
  | { action: "admin-notice" }
  | { action: "redirect"; url: string };

/**
 * Decide what the login page should do for an already-authenticated visitor.
 *
 * Loop guard: the server sends `?error=admin_required` when it rejected the
 * session for /admin. If the client still believes the user is an admin (e.g.
 * a transient `auth/me` failure on the server), redirecting back to /admin
 * would bounce forever, so we show the notice instead of navigating.
 */
export function decideLoginRedirect(args: {
  isAdmin: boolean;
  isClinicForbidden: boolean;
  isAdminRequired: boolean;
  next: string | undefined;
}): LoginRedirectDecision {
  if (args.isClinicForbidden) return { action: "stay" };
  const nextIsAdmin = !!args.next && isAdminPath(args.next);
  if (args.isAdminRequired) return { action: "admin-notice" };
  if (!args.isAdmin && nextIsAdmin) return { action: "admin-notice" };
  return { action: "redirect", url: args.next ?? (args.isAdmin ? "/admin" : "/dashboard") };
}
