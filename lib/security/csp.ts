/**
 * Content-Security-Policy builder (Task 631). Pure: callers pass env + nonce so it is unit-testable.
 * Used by proxy.ts, which sets a per-request nonce (Next.js 16 CSP guide). The root layout already
 * reads headers(), so every page is dynamically rendered and the nonce adds no render cost.
 * No 'strict-dynamic': that would ignore the host allowlist and block the Vercel Live widget, which
 * Vercel injects on previews without a nonce.
 */
export type CspEnv = Record<string, string | undefined>;

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function list(value: string | undefined): string[] {
  return (value || "")
    .split(/[\s,]+/)
    .map((s) => origin(s.trim()))
    .filter((s): s is string => Boolean(s));
}

const FIREBASE_HOSTS = [
  "https://firebasestorage.googleapis.com",
  "https://storage.googleapis.com",
  "https://firestore.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://www.googleapis.com",
];

const uniq = (xs: Array<string | null>) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

export function buildCsp(nonce: string, env: CspEnv): string {
  const isProd = env.NODE_ENV === "production";
  const medplum = origin(env.NEXT_PUBLIC_MEDPLUM_BASE_URL) || "http://localhost:8103";
  const medplumWs = medplum.replace(/^http/, "ws");
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ? origin(`https://${env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`) : null;
  // Optional extras for storage hosts that Medplum redirects Binary downloads to (e.g. S3/GCS/CDN).
  const extra = list(env.CSP_EXTRA_HOSTS);

  const connect = uniq([
    "'self'",
    medplum,
    medplumWs,
    ...FIREBASE_HOSTS,
    authDomain,
    "https://vercel.live",
    "wss://ws-us3.pusher.com",
    "https://va.vercel-scripts.com",
    ...extra,
    // Dev-only default Medplum port; never in production builds.
    isProd ? null : "http://localhost:8103",
    "data:",
    "blob:",
  ]);

  const img = uniq([
    "'self'",
    "data:",
    "blob:",
    medplum,
    "https://firebasestorage.googleapis.com",
    "https://storage.googleapis.com",
    "https://*.googleusercontent.com",
    "https://vercel.live",
    "https://vercel.com",
    ...extra,
  ]);

  const script = uniq([
    "'self'",
    `'nonce-${nonce}'`,
    // react-pdf's yoga layout engine; far narrower than 'unsafe-eval'.
    "'wasm-unsafe-eval'",
    // React dev tooling reconstructs stacks with eval (not needed in production).
    isProd ? null : "'unsafe-eval'",
    "https://vercel.live",
    "https://va.vercel-scripts.com",
  ]);

  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    // Inline style attributes (React style props, tiptap) cannot carry nonces.
    "style-src 'self' 'unsafe-inline' https://vercel.live",
    `img-src ${img.join(" ")}`,
    "font-src 'self' data: https://vercel.live https://assets.vercel.com",
    `connect-src ${connect.join(" ")}`,
    "frame-src 'self' blob: data: https://vercel.live",
    "child-src 'self' blob: data: https://vercel.live",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}
