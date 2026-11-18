/**
 * Shape checks for identifiers that end up inside Medplum search strings (Task 645).
 *
 * FHIR search treats `,` as OR and `|` as the system/code separator, so an unvalidated
 * value such as `mine,clinic|other` turns `identifier=clinic|<id>` into a two-clinic query.
 * The clinic id can come from the client-writable clinic cookie, so it is checked once,
 * centrally, before it is used for scoping. Ids that fail are never escaped or "cleaned":
 * the request is refused.
 */

/** Clinic subdomain or Organization id: starts alphanumeric, then letters, digits, `.` or `-`. */
const CLINIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;

/** FHIR R4 `id` datatype: `[A-Za-z0-9\-\.]{1,64}`. */
const FHIR_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;

export function isValidClinicId(value: unknown): value is string {
  return typeof value === 'string' && CLINIC_ID_PATTERN.test(value);
}

export function isSafeFhirId(value: unknown): value is string {
  return typeof value === 'string' && FHIR_ID_PATTERN.test(value);
}
