// Base domain (used for smoke/auth tests)
export const EMR_URL = process.env.EMR_URL || "https://iatrum.com";

// Medplum admin UI
export const MEDPLUM_UI_URL = process.env.MEDPLUM_UI_URL || "";

// Medplum admin credentials
export const ADMIN_EMAIL = process.env.MEDPLUM_ADMIN_EMAIL || "";
export const ADMIN_PASSWORD = process.env.MEDPLUM_ADMIN_PASSWORD || "";

// ── Clinic-specific ─────────────────────────────────────────────────────────

export const DEMO_CLINIC_URL =
  process.env.CLINIC_URL || process.env.EMR_CLINIC_URL || "https://demo.drhidayat.com";

export const DEMO_CLINIC_EMAIL =
  process.env.DEMO_CLINIC_EMAIL || "";

export const DEMO_CLINIC_PASSWORD =
  process.env.DEMO_CLINIC_PASSWORD || "";

// All clinic users (for credential smoke tests)
export const CLINIC_USERS = [
  {
    email: DEMO_CLINIC_EMAIL,
    password: DEMO_CLINIC_PASSWORD,
    label: "Demo Admin",
  },
  {
    email: "apex-group-admin@iatrum.com",
    password: process.env.CLINIC_USER_PASSWORD || "",
    label: "Apex Group Admin",
  },
  {
    email: "beacon-group-admin@iatrum.com",
    password: process.env.CLINIC_USER_PASSWORD || "",
    label: "Beacon Group Admin",
  },
];

export function missingEnvVars(vars: Record<string, string>): string[] {
  return Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}
