import { NextResponse } from 'next/server';

/**
 * Thrown when a request lacks valid authentication.
 * Route handlers should catch this and return 401, not 500.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Maps a caught error to the correct HTTP response.
 *
 * - AuthError      → 401  (client should re-authenticate)
 * - Any other      → 500  (unexpected server failure)
 *
 * Always logs the error server-side so it is visible in logs without
 * leaking internal details to callers.
 */
export function handleRouteError(
  error: unknown,
  context?: string
): NextResponse {
  const label = context ? `[${context}]` : '';

  if (error instanceof AuthError) {
    console.warn(`${label} Auth failure:`, error.message);
    return NextResponse.json(
      { error: 'Authentication required. Please log in.' },
      { status: 401 }
    );
  }

  console.error(`${label} Unhandled error:`, error);
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  return NextResponse.json({ error: message }, { status: 500 });
}
