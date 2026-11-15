// ── Error classification ────────────────────────────────────────────────────

/**
 * Maps low-level fetch / auth errors to clear, user-facing messages.
 * Distinguishes network/server issues from wrong credentials so the UI can
 * show the right guidance instead of a single "Invalid email or password."
 */
export function classifyAuthError(error: unknown): Error {
  const msg =
    error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();

  // Anchor on the code prefix so e.g. a "429" inside an unrelated message is
  // not mistaken for a rate limit. HTTP-status / phrase fallbacks stay for raw errors.
  const isCoded = /^AUTH_[A-Z_]+/.test(msg);
  if (
    lower.startsWith('auth_rate_limited') ||
    (!isCoded && (/\b429\b/.test(msg) || lower.includes('too many requests')))
  ) {
    const retrySeconds = msg.match(/^AUTH_RATE_LIMITED:(\d+):/i);
    const seconds = retrySeconds ? Math.min(600, Math.max(1, Number(retrySeconds[1]))) : 60;
    return new Error(`AUTH_RATE_LIMITED:${seconds}: Too many sign-in attempts.`);
  }

  if (lower.includes('auth_unavailable')) {
    return new Error('AUTH_UNAVAILABLE: The sign-in server is busy or unavailable. Please try again shortly.');
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('cors')
  ) {
    return new Error(
      'AUTH_NETWORK: Unable to reach the authentication server. ' +
      'Check your internet connection or contact support.'
    );
  }

  if (
    lower.startsWith('auth_credentials') ||
    (!isCoded && (
      lower.includes('401') ||
      lower.includes('invalid') ||
      lower.includes('unauthorized') ||
      lower.includes('bad credentials') ||
      lower.includes('incorrect password')
    ))
  ) {
    return new Error('AUTH_CREDENTIALS: Incorrect email or password. Please try again.');
  }

  if (
    lower.includes('auth_clinic_required') ||
    lower.includes('auth_clinic_forbidden') ||
    lower.includes('not assigned to clinic') ||
    lower.includes('multiple clinics')
  ) {
    return new Error(
      'AUTH_CLINIC: This account must sign in from the correct clinic subdomain.'
    );
  }

  if (lower.includes('auth_forbidden')) {
    return new Error(
      'AUTH_FORBIDDEN: Your account does not have access to this area.'
    );
  }

  if (lower.includes('no access token')) {
    return new Error(
      'AUTH_CONFIG: Login completed but no session was created. ' +
      'This is usually a server configuration issue — please contact support.'
    );
  }

  return new Error(`AUTH_UNKNOWN: ${msg || 'An unexpected error occurred. Please try again.'}`);
}

