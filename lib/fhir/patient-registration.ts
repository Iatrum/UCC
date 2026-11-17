/**
 * Registration date for Patients.
 *
 * FHIR R4 Patient has no creation-date element and `_lastUpdated` changes on every edit,
 * so "new this month" needs a stored date. We stamp a `meta.tag` on create:
 *   { system: REGISTERED_TAG_SYSTEM, code: 'YYYY-MM-DD' }  (server-local calendar day)
 * `_tag` is a built-in Medplum token search parameter (comma = OR), so no custom
 * SearchParameter is needed. Updates in this codebase spread the existing resource, which
 * keeps meta.tag. Patients created before this change carry no tag; they are NOT counted
 * as new (we cannot know their registration date).
 */
export const REGISTERED_TAG_SYSTEM = 'https://ucc.emr/patient-registered';

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function withRegistrationTag<T extends object>(patient: T, now = new Date()): T {
  const meta = (patient as { meta?: { tag?: Array<{ system?: string; code?: string }> } }).meta;
  const existing = meta?.tag ?? [];
  if (existing.some((t) => t.system === REGISTERED_TAG_SYSTEM)) return patient;
  return {
    ...patient,
    meta: { ...meta, tag: [...existing, { system: REGISTERED_TAG_SYSTEM, code: ymd(now) }] },
  };
}

/** `_tag` search value matching every day of `now`'s month up to and including today. */
export function registeredThisMonthTagParam(now = new Date()): string {
  const days: string[] = [];
  for (let d = 1; d <= now.getDate(); d++) {
    days.push(`${REGISTERED_TAG_SYSTEM}|${ymd(new Date(now.getFullYear(), now.getMonth(), d))}`);
  }
  return days.join(',');
}

/** Registration date from the tag, or undefined for legacy patients. */
export function getRegistrationDate(patient: { meta?: { tag?: Array<{ system?: string; code?: string }> } }): string | undefined {
  return patient.meta?.tag?.find((t) => t.system === REGISTERED_TAG_SYSTEM)?.code;
}
