/**
 * Static lab constants and shared types — no server dependencies.
 * Safe to import in both Server and Client Components.
 */

export const LAB_TESTS = {
  CBC: { code: '58410-2', display: 'Complete Blood Count (CBC) panel', system: 'http://loinc.org' },
  LFT: { code: '24325-3', display: 'Hepatic function (LFT) panel', system: 'http://loinc.org' },
} as const;

export type LabTestCode = keyof typeof LAB_TESTS;

export interface LabResult {
  testCode: string;
  testName: string;
  value: string | number;
  unit?: string;
  referenceRange?: string;
  interpretation?: 'normal' | 'high' | 'low' | 'critical';
  status: 'preliminary' | 'final' | 'corrected' | 'cancelled';
  performedAt?: Date;
}

export interface LabReportSummary {
  id: string;
  patientId: string;
  patientName?: string;
  encounterId?: string;
  status: 'registered' | 'partial' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled';
  orderedAt: Date;
  issuedAt?: Date;
  results: LabResult[];
  conclusion?: string;
  orderingPhysician?: string;
}

/** Verified LOINC definitions; specimen/method, LOINC and ranges to confirm per analyser. */
export const POCT_TESTS = [
  { code: '14743-9', name: 'Glucose (capillary)', unit: 'mmol/L', analyserType: 'glucose', unitPrice: 5 },
  { code: '4548-4', name: 'HbA1c', unit: '%', analyserType: 'hba1c', unitPrice: 40 },
  { code: '1988-5', name: 'CRP', unit: 'mg/L', analyserType: 'crp', unitPrice: 25 },
  { code: '718-7', name: 'Haemoglobin', unit: 'g/dL', analyserType: 'haemoglobin', unitPrice: 10 },
  { code: '24357-6', name: 'Urine dipstick', unit: 'per analyte', analyserType: 'urine', unitPrice: 10 },
].map((test) => ({ ...test, system: 'http://loinc.org', referenceRange: 'To confirm per analyser', confirmation: 'LOINC and ranges to confirm per analyser' }));

export interface PoctAnalyser {
  id: string;
  name: string;
  analyserType: string;
  online: boolean;
  lastHeartbeat?: string;
}
