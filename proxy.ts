import { NextRequest, NextResponse } from 'next/server';

const CLINIC_COOKIE_NAME = 'medplum-clinic';
const SESSION_COOKIE_NAME = 'medplum-session';
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || ''; // e.g. example.com
const LANDING_PATH = process.env.NEXT_PUBLIC_LANDING_PATH || '/landing';
const AUTH_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true' || process.env.DISABLE_AUTH === 'true';
const PUBLIC_PATH_PREFIXES = ['/login', '/landing', '/api/'];

function deriveClinicFromHost(host: string | null): string | null {
  if (!host) return null;

  // For localhost/development, use default clinic ID from env or 'default'
  if (host.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(host)) {
    return process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
  }

  const parts = host.split(':')[0].split('.');
  if (parts.length < 3) return null; // no subdomain present

  const [subdomain, ...rest] = parts;

  // If BASE_DOMAIN is set, ensure the host matches it before trusting the subdomain
  if (BASE_DOMAIN) {
    const baseParts = BASE_DOMAIN.split('.');
    if (rest.join('.') !== baseParts.join('.')) {
      return null;
    }
  }

  // Ignore common non-clinic subdomains
  if (['www', 'app'].includes(subdomain)) return null;

  return subdomain;
}

function isBaseDomainHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0];

  if (hostname.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(hostname)) {
    return false;
  }

  if (BASE_DOMAIN) {
    return hostname === BASE_DOMAIN;
  }

  const parts = hostname.split('.');
  return parts.length === 2;
}

// Auth is intentionally open, but we still derive clinic from subdomain to scope requests.
export function proxy(req: NextRequest) {
  const host = req.headers.get('host');
  const clinicId = deriveClinicFromHost(host);
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublicPath = PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!clinicId && pathname === '/' && isBaseDomainHost(host)) {
    return NextResponse.redirect(new URL(LANDING_PATH, req.url));
  }

  if (clinicId && !AUTH_DISABLED && !hasSession && !isPublicPath) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.next();
  if (clinicId) {
    const existing = req.cookies.get(CLINIC_COOKIE_NAME)?.value;
    if (existing !== clinicId) {
      res.cookies.set(CLINIC_COOKIE_NAME, clinicId, {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
      });
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next|static|favicon.ico|manifest.json).*)'],
};

