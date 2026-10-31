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
