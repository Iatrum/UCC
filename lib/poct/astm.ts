/**
 * Minimal ASTM E1394-97 (LIS low-level protocol) record encode/decode.
 *
 * Only the record types/fields the simulated analyser pipeline needs: H (header),
 * O (order — carries the placer order number so we can find the ServiceRequest),
 * R (one per result), L (terminator). Same scope note as hl7.ts: this targets no
 * specific vendor profile, it's for the simulated analyser only; round-trip unit
 * tests (build -> parse -> same data) are the correctness check.
 *
 * Field separator: |. Component separator: ^. Record terminator: \r (per spec).
 */

import type { LabResult } from '@/lib/fhir/lab-constants';

const FIELD = '|';
const COMPONENT = '^';
const RECORD_TERMINATOR = '\r';

export interface AstmResult {
  testCode: string;
  testName: string;
  value: string | number;
  unit?: string;
  referenceRange?: string;
  /** Same abnormal-flag subset as hl7.ts: N normal, H high, L low, HH critical. */
  abnormalFlag?: 'N' | 'H' | 'L' | 'HH';
  /** ASTM result status subset: F final, P preliminary, C corrected. */
  status?: 'F' | 'P' | 'C';
}

export interface AstmMessage {
  /** Placer order number — the ServiceRequest id this result belongs to. */
  placerOrderNumber: string;
  producedAt: Date;
  results: AstmResult[];
}

const INTERPRETATION_TO_FLAG: Record<NonNullable<LabResult['interpretation']>, AstmResult['abnormalFlag']> = {
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
};

const STATUS_TO_ASTM: Record<LabResult['status'], AstmResult['status']> = {
  final: 'F',
  preliminary: 'P',
  corrected: 'C',
  cancelled: 'F', // ASTM result status has no direct "cancelled"; caller should not send one.
};

const ASTM_STATUS_TO_LAB: Record<string, LabResult['status']> = {
  F: 'final',
  P: 'preliminary',
  C: 'corrected',
};

function astmTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

export function labResultsToAstm(results: LabResult[]): AstmResult[] {
  return results.map((r) => ({
    testCode: r.testCode,
    testName: r.testName,
    value: r.value,
    unit: r.unit,
    referenceRange: r.referenceRange,
    abnormalFlag: r.interpretation ? INTERPRETATION_TO_FLAG[r.interpretation] : undefined,
    status: STATUS_TO_ASTM[r.status],
  }));
}

export function buildAstmResult(msg: AstmMessage): string {
  const ts = astmTimestamp(msg.producedAt);
  const records = [
    ['H', `${COMPONENT}\\&`, '', '', 'SIMANALYSER', '', '', '', '', '', '', 'P', 'E1394-97', ts].join(FIELD),
    `O${FIELD}1${FIELD}${msg.placerOrderNumber}`,
    ...msg.results.map((r, idx) => [
      'R',
      String(idx + 1),
      `${COMPONENT}${COMPONENT}${COMPONENT}${r.testCode}${COMPONENT}${r.testName}`,
      String(r.value),
      r.unit || '',
      r.referenceRange || '',
      r.abnormalFlag || '',
      '',
      r.status || 'F',
      '',
      '',
      ts,
    ].join(FIELD)),
    ['L', '1', 'N'].join(FIELD),
  ];
  return records.join(RECORD_TERMINATOR) + RECORD_TERMINATOR;
}

export function parseAstmResult(raw: string): AstmMessage {
  const lines = raw.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const order = lines.find((l) => l.startsWith('O|'));
  if (!order) throw new Error('Malformed ASTM message: missing O (order) record');

  const orderFields = order.split(FIELD);
  const placerOrderNumber = orderFields[2];
  if (!placerOrderNumber) throw new Error('Malformed ASTM message: O-3 (placer order number) is required');

  let producedAt: Date | undefined;
  const results: AstmResult[] = lines
    .filter((l) => l.startsWith('R|'))
    .map((line) => {
      const f = line.split(FIELD);
      const components = (f[2] || '').split(COMPONENT);
      const testCode = components[3] || '';
      const testName = components[4] || '';
      const rawValue = f[3] || '';
      const value = rawValue !== '' && !Number.isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;
      const ts = parseAstmTimestamp(f[11]);
      if (ts) producedAt = ts;
      return {
        testCode,
        testName,
        value,
        unit: f[4] || undefined,
        referenceRange: f[5] || undefined,
        abnormalFlag: (f[6] || undefined) as AstmResult['abnormalFlag'],
        status: (f[8] as AstmResult['status']) || 'F',
      };
    });

  return { placerOrderNumber, producedAt: producedAt || new Date(), results };
}

function parseAstmTimestamp(ts?: string): Date | undefined {
  if (!ts || !/^\d{8,14}$/.test(ts)) return undefined;
  const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || '00', mi = ts.slice(10, 12) || '00', s = ts.slice(12, 14) || '00';
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** AstmResult[] -> LabResult[] for handing off to receiveLabResults(). */
export function astmToLabResults(results: AstmResult[]): LabResult[] {
  return results.map((r) => ({
    testCode: r.testCode,
    testName: r.testName,
    value: r.value,
    unit: r.unit,
    referenceRange: r.referenceRange,
    interpretation: r.abnormalFlag ? FLAG_TO_INTERPRETATION[r.abnormalFlag] : undefined,
    status: (r.status && ASTM_STATUS_TO_LAB[r.status]) || 'final',
  }));
}
