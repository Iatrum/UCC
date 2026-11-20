import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { orderProcedureStatus } from '../../lib/fhir/order-procedure-status';

describe('Task 704: ordered Lab/Imaging billing Procedures are not "completed" at Sign', () => {
  test('Lab/Imaging order lines are "preparation" (FHIR R4: not yet started)', () => {
    expect(orderProcedureStatus({ name: 'Imaging: Chest X-ray (DX)' })).toBe('preparation');
    expect(orderProcedureStatus({ name: 'Lab: Full blood count' })).toBe('preparation');
    expect(orderProcedureStatus({ name: ' imaging: Ultrasound' })).toBe('preparation');
  });
  test('performed-at-sign items stay "completed" (checkout totals unchanged)', () => {
    for (const name of ['Consultation', 'Wound dressing', 'Medical Certificate', 'Time Chit', 'Laboratory fee', 'X-ray review', '', undefined])
      expect(orderProcedureStatus({ name })).toBe('completed');
  });
  test('both create and replace paths in consultation-service use the helper, never a hard-coded status', () => {
    const src = readFileSync('lib/fhir/consultation-service.ts', 'utf8');
    const procBlocks = src.split("resourceType: 'Procedure'").slice(1).map((b) => b.slice(0, 400));
    expect(procBlocks.length).toBe(2);
    for (const b of procBlocks) { expect(b).toContain('status: orderProcedureStatus(proc)'); expect(b).not.toContain("status: 'completed'"); }
  });
});
