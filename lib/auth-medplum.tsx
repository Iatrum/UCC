"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { MedplumClient } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';

const MEDPLUM_BASE_URL = process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103';
const MEDPLUM_CLIENT_ID = process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID || '';
const MEDPLUM_PROJECT_ID = process.env.NEXT_PUBLIC_MEDPLUM_PROJECT_ID || '';

interface MedplumAuthContextType {
  medplum: MedplumClient;
  profile: Resource | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  clinicId: string | null;
  signIn: (email: string, password: string) => Promise<{ isAdmin: boolean }>;
  signOut: () => Promise<void>;
  getAccessToken: () => string | undefined;
  setClinicId: (clinicId: string | null) => Promise<void>;
}

const MedplumAuthContext = createContext<MedplumAuthContextType | null>(null);

export function MedplumAuthProvider({ children }: { children: React.ReactNode }) {
  const [medplum] = useState(() => new MedplumClient({
    baseUrl: MEDPLUM_BASE_URL,
    clientId: MEDPLUM_CLIENT_ID || undefined,
    onUnauthenticated: () => {
      setProfile(null);
      setIsAdmin(false);
    },
  }));

  const [profile, setProfile] = useState<Resource | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicIdState] = useState<string | null>(null);

  const persistClinicId = async (nextClinicId: string | null) => {
    setClinicIdState(nextClinicId);
    try {
      const accessToken = medplum.getAccessToken();
      await fetch('/api/auth/medplum-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, clinicId: nextClinicId }),
      });
    } catch (error) {
      console.warn('Warning: Failed to persist clinicId to session cookie:', error);
    }
  };

  // Keep the server-side session cookie in sync with the client-side access
  // token. MedplumClient manages its own token refresh via localStorage; when
  // it refreshes (typically at ~55 min for a 1-hour token), we need to push
  // the new token back to the httpOnly cookie so server routes keep working.
  useEffect(() => {
    const syncServerCookie = async () => {
      const token = medplum.getAccessToken();
      if (!token) return;
      try {
        await fetch('/api/auth/medplum-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token }),
        });
      } catch {
        // Non-fatal — cookie will eventually expire naturally
      }
    };

    // Sync immediately on mount (picks up any token that was refreshed while
    // the tab was in the background)
    syncServerCookie();

    // Re-sync every 10 minutes so the server cookie is always within 10
    // minutes of the latest client-side token.
    const syncInterval = setInterval(syncServerCookie, 10 * 60 * 1000);
    return () => clearInterval(syncInterval);
  }, [medplum]);

  // Restore session from MedplumClient internal storage on mount
  useEffect(() => {
    // Read clinic from cookie (set by middleware)
    const clinicCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('medplum-clinic='))
      ?.split('=')[1];
    if (clinicCookie) setClinicIdState(decodeURIComponent(clinicCookie));

    // MedplumClient persists its own session via @medplum:* localStorage keys
    medplum.getProfileAsync()
      .then(async (p) => {
        if (p) {
          setProfile(p as Resource);
          try {
            const me = await medplum.get('auth/me');
            setIsAdmin(me?.membership?.admin === true);
          } catch {
            setIsAdmin(false);
          }
        }
      })
      .catch(() => {
        setProfile(null);
        setIsAdmin(false);
      })
      .finally(() => setLoading(false));
  }, [medplum]);

  const signIn = async (email: string, password: string): Promise<{ isAdmin: boolean }> => {
    try {
      const loginResponse = await medplum.startLogin({
        email,
        password,
        projectId: MEDPLUM_PROJECT_ID || undefined,
      });

      if (loginResponse?.code && !medplum.getAccessToken()) {
        await medplum.processCode(loginResponse.code);
      }

      try {
        const maybeProfile = await medplum.getProfileAsync();
        if (maybeProfile) setProfile(maybeProfile as Resource);
      } catch {
        setProfile(null);
      }

      const accessToken = medplum.getAccessToken();
      if (!accessToken) throw new Error('Login succeeded but no access token was returned');

      // Check admin status
      let adminStatus = false;
      try {
        const me = await medplum.get('auth/me');
        adminStatus = me?.membership?.admin === true;
        setIsAdmin(adminStatus);
      } catch {
        setIsAdmin(false);
      }

      // Persist to server-side session cookie (shared across subdomains via COOKIE_DOMAIN)
      await fetch('/api/auth/medplum-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });

      return { isAdmin: adminStatus };
    } catch (error: any) {
      throw classifyAuthError(error);
    }
  };

  const signOut = async () => {
    try {
      medplum.signOut();
      setProfile(null);
      setIsAdmin(false);
      setClinicIdState(null);
      await fetch('/api/auth/medplum-session', { method: 'DELETE' });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const getAccessToken = () => medplum.getAccessToken();

  const value: MedplumAuthContextType = {
    medplum,
    profile,
    loading,
    isAuthenticated: profile !== null,
    isAdmin,
    clinicId,
    signIn,
    signOut,
    getAccessToken,
    setClinicId: persistClinicId,
  };

  return (
    <MedplumAuthContext.Provider value={value}>
      {children}
    </MedplumAuthContext.Provider>
  );
}

// ── Error classification ────────────────────────────────────────────────────

/**
 * Maps low-level fetch / Medplum errors to clear, user-facing messages.
 * Distinguishes network/CORS issues from wrong credentials so the UI can
 * show the right guidance instead of a single "Invalid email or password."
 */
function classifyAuthError(error: unknown): Error {
  const msg =
    error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();

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
    lower.includes('401') ||
    lower.includes('invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('bad credentials') ||
    lower.includes('incorrect password')
  ) {
    return new Error('AUTH_CREDENTIALS: Incorrect email or password. Please try again.');
  }

  if (lower.includes('no access token')) {
    return new Error(
      'AUTH_CONFIG: Login completed but no session was created. ' +
      'This is usually a server configuration issue — please contact support.'
    );
  }

  return new Error(`AUTH_UNKNOWN: ${msg || 'An unexpected error occurred. Please try again.'}`);
}

export function useMedplumAuth() {
  const context = useContext(MedplumAuthContext);
  if (!context) {
    throw new Error('useMedplumAuth must be used within MedplumAuthProvider');
  }
  return context;
}

export function useClinic() {
  const { clinicId, setClinicId } = useMedplumAuth();
  return { clinicId, setClinicId };
}
