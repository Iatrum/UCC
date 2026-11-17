/**
 * Registration date for Patients.
 *
 * FHIR R4 Patient has no creation-date element and `_lastUpdated` changes on every edit,
 * so "new this month" needs a stored date. We stamp a `meta.tag` on create:
 *   { system: REGISTERED_TAG_SYSTEM, code: 'YYYY-MM-DD' }  (Asia/Kuala_Lumpur clinic calendar day, independent of server TZ)
 * `_tag` is a built-in Medplum token search parameter (comma = OR), so no custom
 * SearchParameter is needed. Updates in this codebase spread the existing resource, which
 * keeps meta.tag. Patients created before this change carry no tag; they are NOT counted
 * as new (we cannot know their registration date).
 */
export const REGISTERED_TAG_SYSTEM = 'https://ucc.emr/patient-registered';

/** Clinics operate in Malaysia; registration days are MYT (UTC+8, no DST), not server-local. */
export const CLINIC_TIME_ZONE = 'Asia/Kuala_Lumpur';

const MYT_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar parts of `d` as seen in Kuala Lumpur. */
function clinicDateParts(d: Date): { y: number; m: number; d: number } {
  const get = (t: string) => Number(MYT_PARTS.formatToParts(d).find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const p2 = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

/** YYYY-MM-DD of `d` in the clinic time zone. */
export function clinicYmd(d: Date): string {
  const c = clinicDateParts(d);
  return fmt(c.y, c.m, c.d);
}

export function withRegistrationTag<T extends object>(patient: T, now = new Date()): T {
  const meta = (patient as { meta?: { tag?: Array<{ system?: string; code?: string }> } }).meta;
  const existing = meta?.tag ?? [];
  if (existing.some((t) => t.system === REGISTERED_TAG_SYSTEM)) return patient;
  return {
    ...patient,
    meta: { ...meta, tag: [...existing, { system: REGISTERED_TAG_SYSTEM, code: clinicYmd(now) }] },
  };
}

/** `_tag` search value matching every clinic-local day of `now`'s month up to and including today. */
export function registeredThisMonthTagParam(now = new Date()): string {
  const c = clinicDateParts(now);
  const days: string[] = [];
  for (let d = 1; d <= c.d; d++) days.push(`${REGISTERED_TAG_SYSTEM}|${fmt(c.y, c.m, d)}`);
  return days.join(',');
}

/** Registration date from the tag, or undefined for legacy patients. */
export function getRegistrationDate(patient: { meta?: { tag?: Array<{ system?: string; code?: string }> } }): string | undefined {
  return patient.meta?.tag?.find((t) => t.system === REGISTERED_TAG_SYSTEM)?.code;
}
