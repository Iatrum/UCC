import { NextRequest, NextResponse } from 'next/server';

const CLINIC_COOKIE_NAME = 'medplum-clinic';
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || ''; // e.g. example.com

function deriveClinicFromHost(host: string | null): string | null {
  if (!host) return null;

  // Ignore localhost and direct IPs
  if (host.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(host)) {
    return null;
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

// Auth is intentionally open, but we still derive clinic from subdomain to scope requests.
export function middleware(req: NextRequest) {
  const clinicId = deriveClinicFromHost(req.headers.get('host'));

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
