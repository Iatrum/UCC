/**
 * Minimal HL7 v2 ORU^R01 (unsolicited observation result) encode/decode.
 *
 * Only the segments/fields the simulated analyser pipeline needs: MSH (header),
 * OBR (order — carries the placer order number so we can find the ServiceRequest),
 * OBX (one per result). No vendor profile is targeted; this is for the simulated
 * analyser only, so the contract is "buildOruMessage output round-trips through
 * parseOruMessage", verified by unit tests, not a specific manufacturer's spec.
 *
 * Segment terminator: \r (HL7 standard). Field separator: |. Component separator: ^.
 */

import type { LabResult } from '@/lib/fhir/lab-constants';

const FIELD = '|';
const COMPONENT = '^';
const SEGMENT_TERMINATOR = '\r';

export interface OruResult {
  testCode: string;
  testName: string;
  value: string | number;
  unit?: string;
  referenceRange?: string;
  /** HL7 Table 0078 Abnormal Flags subset: N normal, H high, L low, HH critical-high. */
  abnormalFlag?: 'N' | 'H' | 'L' | 'HH';
  /** HL7 Table 0085 Observation Result Status subset. */
  status?: 'F' | 'P' | 'C';
}

export interface OruMessage {
  /** Placer order number — the ServiceRequest id this result belongs to. */
  placerOrderNumber: string;
  messageControlId: string;
  producedAt: Date;
  results: OruResult[];
}

const INTERPRETATION_TO_FLAG: Record<NonNullable<LabResult['interpretation']>, OruResult['abnormalFlag']> = {
  normal: 'N',
  high: 'H',
  low: 'L',
  critical: 'HH',
};

const FLAG_TO_INTERPRETATION: Record<string, LabResult['interpretation']> = {
  N: 'normal',
  H: 'high',
  L: 'low',
  HH: 'critical',
  LL: 'critical',
  A: undefined,
};

const STATUS_TO_HL7: Record<LabResult['status'], OruResult['status']> = {
  final: 'F',
  preliminary: 'P',
  corrected: 'C',
  cancelled: 'F', // HL7 result-status has no direct "cancelled"; caller should not send one.
};

const HL7_STATUS_TO_LAB: Record<string, LabResult['status']> = {
  F: 'final',
  P: 'preliminary',
  C: 'corrected',
};

function hl7Timestamp(date: Date): string {
  // YYYYMMDDHHMMSS — strip every non-digit from the ISO string (handles the "T" and "." and "Z").
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** LabResult[] -> OruResult[], using the given interpretation->flag mapping. */
export function labResultsToOru(results: LabResult[]): OruResult[] {
  return results.map((r) => ({
    testCode: r.testCode,
    testName: r.testName,
    value: r.value,
    unit: r.unit,
    referenceRange: r.referenceRange,
    abnormalFlag: r.interpretation ? INTERPRETATION_TO_FLAG[r.interpretation] : undefined,
    status: STATUS_TO_HL7[r.status],
  }));
}

export function buildOruMessage(msg: OruMessage): string {
  const ts = hl7Timestamp(msg.producedAt);
  const segments = [
    ['MSH', `${COMPONENT}~\\&`, 'SIMANALYSER', 'UCC', 'UCC', 'UCC', ts, '', `ORU${COMPONENT}R01`, msg.messageControlId, 'P', '2.5.1'].join(FIELD),
    ['OBR', '1', msg.placerOrderNumber, '', '', '', ts].join(FIELD),
    ...msg.results.map((r, idx) => [
      'OBX',
      String(idx + 1),
      typeof r.value === 'number' ? 'NM' : 'ST',
      [r.testCode, r.testName, 'LN'].join(COMPONENT),
      '',
      String(r.value),
      r.unit || '',
      r.referenceRange || '',
      r.abnormalFlag || '',
      '',
      '',
      r.status || 'F',
    ].join(FIELD)),
  ];
  return segments.join(SEGMENT_TERMINATOR) + SEGMENT_TERMINATOR;
}

export function parseOruMessage(raw: string): OruMessage {
  const lines = raw.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const msh = lines.find((l) => l.startsWith('MSH'));
  const obr = lines.find((l) => l.startsWith('OBR'));
  if (!msh || !obr) throw new Error('Malformed HL7 ORU message: missing MSH or OBR segment');

  const mshFields = msh.split(FIELD);
  const messageControlId = mshFields[9] || '';
  const mshTimestamp = mshFields[6];

  const obrFields = obr.split(FIELD);
  const placerOrderNumber = obrFields[2];
  if (!placerOrderNumber) throw new Error('Malformed HL7 ORU message: OBR-2 (placer order number) is required');

  const results: OruResult[] = lines
    .filter((l) => l.startsWith('OBX'))
    .map((line) => {
      const f = line.split(FIELD);
      const [testCode, testName] = (f[3] || '').split(COMPONENT);
      const rawValue = f[5] || '';
      const value = f[2] === 'NM' && rawValue !== '' && !Number.isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;
      const statusCode = f[11];
      return {
        testCode: testCode || '',
        testName: testName || '',
        value,
        unit: f[6] || undefined,
        referenceRange: f[7] || undefined,
        abnormalFlag: (f[8] || undefined) as OruResult['abnormalFlag'],
        status: (statusCode as OruResult['status']) || 'F',
      };
    });

  return {
    placerOrderNumber,
    messageControlId,
    producedAt: parseHl7Timestamp(mshTimestamp) || new Date(),
    results,
  };
}

function parseHl7Timestamp(ts?: string): Date | undefined {
  if (!ts || !/^\d{8,14}$/.test(ts)) return undefined;
  const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || '00', mi = ts.slice(10, 12) || '00', s = ts.slice(12, 14) || '00';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** OruResult[] -> LabResult[] for handing off to receiveLabResults(). */
export function oruToLabResults(results: OruResult[]): LabResult[] {
  return results.map((r) => ({
    testCode: r.testCode,
    testName: r.testName,
    value: r.value,
    unit: r.unit,
    referenceRange: r.referenceRange,
    interpretation: r.abnormalFlag ? FLAG_TO_INTERPRETATION[r.abnormalFlag] : undefined,
    status: (r.status && HL7_STATUS_TO_LAB[r.status]) || 'final',
  }));
}
