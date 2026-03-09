import { NextRequest, NextResponse } from 'next/server';

const CLINIC_COOKIE_NAME = 'medplum-clinic';
const IS_ADMIN_COOKIE_NAME = 'medplum-is-admin';
const SESSION_COOKIE_NAME = 'medplum-session';
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || ''; // e.g. example.com
const LANDING_PATH = process.env.NEXT_PUBLIC_LANDING_PATH || '/landing';
const AUTH_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true' || process.env.DISABLE_AUTH === 'true';
const PUBLIC_PATH_PREFIXES = ['/login', '/landing', '/api/'];

type SubdomainContext =
  | { type: 'admin' }
  | { type: 'clinic'; clinicId: string }
  | { type: 'none' };

function deriveContext(host: string | null): SubdomainContext {
  if (!host) return { type: 'none' };

  // For localhost/development, use default clinic ID from env or 'default'
  if (host.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(host)) {
    return { type: 'clinic', clinicId: process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default' };
  }

  const parts = host.split(':')[0].split('.');
  if (parts.length < 3) return { type: 'none' }; // no subdomain present

  const [subdomain, ...rest] = parts;

  // If BASE_DOMAIN is set, ensure the host matches it before trusting the subdomain
  if (BASE_DOMAIN) {
    const baseParts = BASE_DOMAIN.split('.');
    if (rest.join('.') !== baseParts.join('.')) {
      return { type: 'none' };
    }
  }

  // Ignore common non-clinic subdomains
  if (subdomain === 'admin') return { type: 'admin' };
  if (['www', 'app', 'auth'].includes(subdomain)) return { type: 'none' };

  return { type: 'clinic', clinicId: subdomain };
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
  const context = deriveContext(host);
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublicPath = PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (context.type === 'admin') {
    const shouldRewrite =
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/login') &&
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/_next');

    const url = req.nextUrl.clone();
    if (shouldRewrite) {
      url.pathname = pathname === '/' ? '/admin' : '/admin' + pathname;
    }

    const res = shouldRewrite ? NextResponse.rewrite(url) : NextResponse.next();
    res.cookies.set(IS_ADMIN_COOKIE_NAME, 'true', {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
    return res;
  }

  if (context.type !== 'clinic' && pathname === '/' && isBaseDomainHost(host)) {
    return NextResponse.redirect(new URL(LANDING_PATH, req.url));
  }

  if (context.type === 'clinic' && !AUTH_DISABLED && !hasSession && !isPublicPath) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.next();
  if (context.type === 'clinic') {
    const existing = req.cookies.get(CLINIC_COOKIE_NAME)?.value;
    if (existing !== context.clinicId) {
      res.cookies.set(CLINIC_COOKIE_NAME, context.clinicId, {
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
