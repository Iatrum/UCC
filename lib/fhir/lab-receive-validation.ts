import type { LabResult } from './lab-constants';

/**
 * Input validation for POST /api/labs/receive (Task 566).
 * Pure (no I/O) so it is unit-testable. Returns a clear message for the first problem found.
 * FHIR R4 Observation.status is 1..1 (required, no default), so a missing status is a 400, not a guess.
 */
export const LAB_RESULT_STATUSES = ['preliminary', 'final', 'corrected', 'cancelled'] as const;
export const LAB_RESULT_INTERPRETATIONS = ['normal', 'high', 'low', 'critical'] as const;

export type LabReceiveValidation =
  | { ok: true; results: LabResult[] }
  | { ok: false; error: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function validateLabReceiveResults(raw: unknown): LabReceiveValidation {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'results array is required and must not be empty' };
  }
  const results: LabResult[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    const at = `results[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, error: `${at} must be an object` };
    }
    if (!isNonEmptyString(r.testCode)) return { ok: false, error: `${at}.testCode is required (non-empty string)` };
    if (!isNonEmptyString(r.testName)) return { ok: false, error: `${at}.testName is required (non-empty string)` };
    const v = r.value;
    const valueOk = (typeof v === 'number' && Number.isFinite(v)) || isNonEmptyString(v);
    if (!valueOk) return { ok: false, error: `${at}.value is required (finite number or non-empty string)` };
    if (r.status === undefined || r.status === null || r.status === '') {
      return { ok: false, error: `${at}.status is required (one of: ${LAB_RESULT_STATUSES.join(', ')})` };
    }
    if (!(LAB_RESULT_STATUSES as readonly unknown[]).includes(r.status)) {
      return { ok: false, error: `${at}.status must be one of: ${LAB_RESULT_STATUSES.join(', ')}` };
    }
    if (r.interpretation !== undefined && r.interpretation !== null &&
        !(LAB_RESULT_INTERPRETATIONS as readonly unknown[]).includes(r.interpretation)) {
      return { ok: false, error: `${at}.interpretation must be one of: ${LAB_RESULT_INTERPRETATIONS.join(', ')}` };
    }
    for (const k of ['unit', 'referenceRange'] as const) {
      if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') {
        return { ok: false, error: `${at}.${k} must be a string` };
      }
    }
    // JSON cannot carry a Date: accept an ISO string and convert (service calls performedAt.toISOString()).
    let performedAt: Date | undefined;
    if (r.performedAt !== undefined && r.performedAt !== null) {
      const d = new Date(r.performedAt as string);
      if (typeof r.performedAt !== 'string' || Number.isNaN(d.getTime())) {
        return { ok: false, error: `${at}.performedAt must be an ISO 8601 date-time string` };
      }
      performedAt = d;
    }
    results.push({
      testCode: r.testCode.trim(),
      testName: r.testName.trim(),
      value: typeof v === 'string' ? v : (v as number),
      unit: (r.unit as string | undefined) ?? undefined,
      referenceRange: (r.referenceRange as string | undefined) ?? undefined,
      interpretation: (r.interpretation as LabResult['interpretation']) ?? undefined,
      status: r.status as LabResult['status'],
      performedAt,
    });
  }
  return { ok: true, results };
}
