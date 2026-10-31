import { NextResponse } from 'next/server';
import { isUnauthenticated, OperationOutcomeError } from '@medplum/core';

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
 * Thrown when an authenticated user lacks the required permissions.
 * Route handlers should catch this and return 403, not 500.
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Host / session is missing clinic scope (subdomain or clinic cookie).
 * Not an authentication failure — user may be signed in on localhost or apex.
 */
export class ClinicContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinicContextError';
  }
}

export class ConflictError extends Error {
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, options?: { code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'ConflictError';
    this.code = options?.code;
    this.details = options?.details;
  }
}

/**
 * Medplum re-checks ProjectMembership.active on every authenticated request
 * (see .ai/research/task6e-deactivate.md) and rejects with an OperationOutcome
 * whose issue details read "Profile not active" / "Project not active". That's
 * a 400 `invalid` from Medplum's own API, but from our app's perspective it's
 * an auth failure, not a server bug — map it to 401 with a clear message.
 */
const MEDPLUM_INACTIVE_REASON = /^(Profile|Project) not active$/;

function isAccountInactiveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as {
    message?: unknown;
    outcome?: { issue?: { details?: { text?: unknown }; diagnostics?: unknown }[] };
  };

  if (MEDPLUM_INACTIVE_REASON.test(String(maybeError.message ?? ""))) {
    return true;
  }

  return Boolean(
    maybeError.outcome?.issue?.some(
      (issue) =>
        MEDPLUM_INACTIVE_REASON.test(String(issue.details?.text ?? "")) ||
        MEDPLUM_INACTIVE_REASON.test(String(issue.diagnostics ?? ""))
    )
  );
}

function isForbiddenLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    outcome?: { id?: unknown; issue?: { code?: unknown }[] };
  };

  if (maybeError.status === 403 || maybeError.statusCode === 403) {
    return true;
  }

  if (maybeError.outcome?.id === 'forbidden') {
    return true;
  }

  if (maybeError.outcome?.issue?.some((issue) => issue.code === 'forbidden')) {
    return true;
  }

  return typeof maybeError.message === 'string' && maybeError.message.toLowerCase() === 'forbidden';
}

/**
 * Maps a caught error to the correct HTTP response.
 *
 * - AuthError      → 401  (client should re-authenticate)
 * - ForbiddenError → 403  (authenticated but not allowed)
 * - Medplum 403    → 403  (raw OperationOutcome/authz failure)
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

  if (error instanceof AuthError || (error instanceof OperationOutcomeError && isUnauthenticated(error.outcome))) {
    console.warn(`${label} Auth failure:`, error.message);
    return NextResponse.json(
      { error: 'Authentication required. Please log in.' },
      { status: 401 }
    );
  }

  if (error instanceof ForbiddenError) {
    console.warn(`${label} Forbidden:`, error.message);
    return NextResponse.json(
      { error: 'You do not have permission to perform this action.' },
      { status: 403 }
    );
  }

  if (isAccountInactiveError(error)) {
    console.warn(`${label} Account deactivated:`, error);
    return NextResponse.json(
      { error: 'Your account has been deactivated. Contact an administrator.' },
      { status: 401 }
    );
  }

  if (isForbiddenLikeError(error)) {
    console.warn(`${label} Forbidden:`, error);
    return NextResponse.json(
      { error: 'You do not have permission to perform this action.' },
      { status: 403 }
    );
  }

  if (error instanceof ClinicContextError) {
    console.warn(`${label} Clinic context:`, error.message);
    return NextResponse.json(
      {
        error: error.message,
        code: 'NO_CLINIC_CONTEXT',
      },
      { status: 400 }
    );
  }

  if (error instanceof ConflictError) {
    console.warn(`${label} Conflict:`, error.message, error.details ?? {});
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ?? {}),
      },
      { status: 409 }
    );
  }

  console.error(`${label} Unhandled error:`, error);
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  return NextResponse.json({ error: message }, { status: 500 });
}
