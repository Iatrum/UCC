import type { InventoryMedicationData } from './inventory-service';

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryValidationError';
  }
}

function toNumber(value: unknown, field: string, opts: { integer: boolean }): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new InventoryValidationError(`${field} must be a non-negative number`);
  }
  if (opts.integer && !Number.isInteger(n)) {
    throw new InventoryValidationError(`${field} must be a whole number`);
  }
  return n;
}

function toText(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new InventoryValidationError(`${field} must be text`);
  return value;
}

/**
 * Validate and normalise inventory input. FHIR `valueInteger` rejects
 * fractional/NaN stock, which Medplum surfaces as an unhandled 500; reject it
 * up front as a 400 instead. When `partial` is true only supplied fields are
 * checked/returned (PATCH).
 */
export function parseInventoryInput(
  raw: unknown,
  opts: { partial: boolean }
): Partial<InventoryMedicationData> {
  if (!raw || typeof raw !== 'object') throw new InventoryValidationError('Request body must be an object');
  const d = raw as Record<string, unknown>;
  const out: Partial<InventoryMedicationData> = {};
  const has = (k: string) => d[k] !== undefined && d[k] !== null;

  if (!opts.partial || has('name')) {
    if (typeof d.name !== 'string' || !d.name.trim()) throw new InventoryValidationError('name is required');
    out.name = d.name.trim();
  }
  if (!opts.partial || has('strengths')) {
    if (!Array.isArray(d.strengths) || d.strengths.some((s) => typeof s !== 'string')) {
      throw new InventoryValidationError('strengths must be an array of text');
    }
    out.strengths = d.strengths as string[];
  }
  for (const key of ['stock', 'minimumStock'] as const) {
    if (has(key)) out[key] = toNumber(d[key], key, { integer: true });
    else if (!opts.partial) out[key] = 0;
  }
  if (has('unitPrice')) out.unitPrice = toNumber(d.unitPrice, 'unitPrice', { integer: false });
  else if (!opts.partial) out.unitPrice = 0;
  for (const key of ['category', 'dosageForm', 'unit', 'expiryDate'] as const) {
    if (has(key)) out[key] = toText(d[key], key);
    else if (!opts.partial) out[key] = key === 'unit' ? 'units' : '';
  }
  return out;
}
