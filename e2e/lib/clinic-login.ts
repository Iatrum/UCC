import type { APIRequestContext } from '@playwright/test';

export async function loginClinicContext(request: APIRequestContext, credentials: { email: string; password: string }) {
  try {
    return await request.post('/api/auth/login', { data: credentials, maxRedirects: 0 });
  } catch {
    throw new Error('Clinic login request failed.');
  }
}
