import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { imagingOrderEntryMode } from '../../lib/imaging/order-entry';

test('X-ray module on: only the Treatment panel orders (accession); off: generic form stays', () => {
  expect(imagingOrderEntryMode(true)).toBe('treatment-panel-only');
  expect(imagingOrderEntryMode(false)).toBe('generic-form');
});

test('labs-imaging route gates the stale order form on the pacs module', () => {
  const src = readFileSync('app/(routes)/patients/[id]/labs-imaging/page.tsx', 'utf8');
  expect(src).toContain("isModuleEnabledForClinic('pacs'");
  expect(src).toContain("orderMode === 'treatment-panel-only'");
});

test('study card truncates accession with a tooltip and keeps buttons inside the card', () => {
  const src = readFileSync('components/imaging/imaging-results-view.tsx', 'utf8');
  expect(src).toContain('title={study.study.accessionNumber}');
  expect(src).toMatch(/truncate font-medium/);
  expect(src).toContain('col-span-full min-w-0');
  expect(src).toContain('max-w-full');
});
