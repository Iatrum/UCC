import { describe, expect, test } from 'bun:test';
import { addClinicDays, clinicToday, formatClinicDate, mcDaysLabel, mcEndDate, toClinicDate } from '../../lib/clinic-dates';
import { calcAge, renderDocumentHtml, withPrintCss } from '../../lib/document-render';
import { DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE, DEFAULT_TIME_CHIT_TEMPLATE } from '../../lib/document-templates';
import { signedDocumentKind, signedDocumentMutationError } from '../../lib/clinical-documents';

const org = { name: 'Fake Clinic', address: '1 Jalan Fake', phone: '03-0000', logoUrl: 'https://example.test/logo.png' };
const patient = { fullName: 'Ali Fake', nric: '900101-14-0000', dateOfBirth: '1990-03-05' };
const base = { patient, organization: org, issuedDate: '2026-11-10' };

describe('clinic dates (Asia/Kuala_Lumpur)', () => {
  test('00:30 MYT is the same MYT day even though UTC is still the day before', () => {
    const instant = new Date('2026-11-16T16:30:00Z'); // 00:30 on 17 Nov in Kuala Lumpur
    expect(instant.toISOString().slice(0, 10)).toBe('2026-11-16');
    expect(clinicToday(instant)).toBe('2026-11-17');
    expect(formatClinicDate(instant)).toBe('17 Nov 2026');
  });
  test('plain YYYY-MM-DD is a calendar day, never shifted by timezone', () => {
    expect(formatClinicDate('2026-11-17')).toBe('17 Nov 2026');
    expect(toClinicDate('2026-02-30')).toBeNull();
    expect(formatClinicDate('nope')).toBe('');
    expect(formatClinicDate(null)).toBe('');
  });
  test('MC end date and day arithmetic cross month/year boundaries', () => {
    expect(addClinicDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(mcEndDate('2026-12-30', 3)).toBe('01 Jan 2027');
    expect(mcEndDate('2026-11-17', 1)).toBe('17 Nov 2026');
    expect(mcEndDate('', 2)).toBe('');
  });
  test('day pluralisation', () => {
    expect(mcDaysLabel(1)).toBe('1 day');
    expect(mcDaysLabel('3')).toBe('3 days');
  });
  test('age uses clinic calendar', () => {
    expect(calcAge('1990-03-05', new Date('2026-03-04T04:00:00Z'))).toBe('35');
    expect(calcAge('1990-03-05', new Date('2026-03-05T04:00:00Z'))).toBe('36');
  });
});

describe('renderDocumentHtml: MC', () => {
  const details = { mcDays: '2', mcStartDate: '2026-11-10', mcDoctorName: 'Dr Fake', mcDoctorMmc: '12345', mcDiagnosis: 'Secret Dx' };
  test('fills DOB, MMC, logo, issue date (not today) and pluralised days; no leftover placeholders', () => {
    const html = renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details, ...base, now: new Date('2030-01-01T00:00:00Z') });
    expect(html).toContain('05 Mar 1990');
    expect(html).toContain('MMC No: 12345');
    expect(html).toContain('<img class="clinic-logo" src="https://example.test/logo.png"');
    expect(html).toContain('Date Issued: <strong>10 Nov 2026</strong>');
    expect(html).not.toContain('2030');
    expect(html).toContain('10 Nov 2026</strong> to');
    expect(html).toContain('11 Nov 2026');
    expect(html).toContain('(2 days)');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
  test('diagnosis hidden unless opted in', () => {
    expect(renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details, ...base })).not.toContain('Secret Dx');
    expect(renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details: { ...details, mcIncludeDiagnosis: 'true' }, ...base })).toContain('Secret Dx');
  });
  test('single day says "1 day"; unsafe logo url and html are not injected', () => {
    const html = renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details: { ...details, mcDays: '1', mcDoctorName: '<b>x</b>' }, ...base, organization: { ...org, logoUrl: 'javascript:alert(1)' } });
    expect(html).toContain('(1 day)');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<b>x</b>');
  });
  test('voided documents carry a VOID banner', () => {
    const html = renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details: { ...details, status: 'voided', voidedAt: '2026-11-11T02:00:00Z' }, ...base });
    expect(html).toContain('class="void-banner">VOID');
  });
});

describe('renderDocumentHtml: Time Chit and referral share letterhead, doctor and MMC', () => {
  const tc = { tcDate: '2026-11-10', tcTimeIn: '09:00', tcTimeOut: '10:30', tcHours: '1.5', tcDoctorName: 'Dr Fake', tcDoctorMmc: '777' };
  test('Time Chit has MMC, DOB, logo, issue date and no leftover placeholders', () => {
    const html = renderDocumentHtml({ kind: 'time-chit', template: DEFAULT_TIME_CHIT_TEMPLATE, details: tc, ...base });
    for (const needle of ['MMC No: 777', '05 Mar 1990', 'clinic-logo', 'Date Issued: <strong>10 Nov 2026</strong>', '1.5 hours', 'Fake Clinic']) expect(html).toContain(needle);
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
  test('Time Chit and MC use the same letterhead markup', () => {
    const mc = renderDocumentHtml({ kind: 'mc', template: DEFAULT_MC_TEMPLATE, details: { mcDays: '1' }, ...base });
    const t = renderDocumentHtml({ kind: 'time-chit', template: DEFAULT_TIME_CHIT_TEMPLATE, details: tc, ...base });
    const head = (h: string) => h.slice(h.indexOf('<div class="letterhead'), h.indexOf('<hr class="rule-thick"'));
    expect(head(t)).toBe(head(mc));
  });
  test('Time Chit escapes values and 1 hour is singular', () => {
    const html = renderDocumentHtml({ kind: 'time-chit', template: DEFAULT_TIME_CHIT_TEMPLATE, details: { ...tc, tcHours: '1', tcDoctorName: '<i>x</i>' }, ...base });
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('1 hour<');
  });
  test('referral signer is the doctor (+MMC), not the clinic', () => {
    const html = renderDocumentHtml({ kind: 'referral', template: DEFAULT_REFERRAL_TEMPLATE, details: { referralTo: 'Hosp', referralContent: 'Hi\n\nThere', referralDoctorName: 'Dr Fake', referralDoctorMmc: '42' }, ...base });
    expect(html).toContain('<div class="sig-name">Dr Fake</div>');
    expect(html).toContain('MMC No: 42');
    expect(html).toContain('Age: 36'.replace('36', String(calcAge('1990-03-05'))));
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('print CSS', () => {
  test('default templates no longer force 100vh; shared CSS adds A4 + print rules once', () => {
    for (const t of [DEFAULT_MC_TEMPLATE, DEFAULT_TIME_CHIT_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE]) expect(t).not.toContain('100vh');
    const once = withPrintCss('<html><head></head><body>x</body></html>');
    expect(once).toContain('@page { size: A4');
    expect(once).toContain('@media print');
    expect(withPrintCss(once)).toBe(once);
  });
  test('custom saved template with min-height is still overridden for print', () => {
    expect(withPrintCss('<head><style>body{min-height:100vh}</style></head>')).toContain('min-height: 0 !important');
  });
});

describe('signed document family', () => {
  test('time-chit detected even when notes fail to parse', () => {
    expect(signedDocumentKind({ procedureId: 'letter-time-chit', notes: 'bad' })).toBe('time-chit');
    expect(signedDocumentKind({ notes: '{"kind":"mc"}' })).toBe('mc');
    expect(signedDocumentKind({ name: 'Lab: CBC' })).toBeNull();
  });
  const mc = JSON.stringify({ kind: 'mc', mcDays: '1', status: 'completed' });
  test('unchanged signed docs and new reissues are allowed', () => {
    const reissue = JSON.stringify({ kind: 'mc', mcDays: '2', status: 'completed' });
    expect(signedDocumentMutationError([{ notes: mc }], [{ notes: mc }, { notes: reissue }, { notes: 'plain' }])).toBeNull();
    expect(signedDocumentMutationError([{ notes: mc }], [{ notes: JSON.stringify({ status: 'completed', mcDays: '1', kind: 'mc' }) }])).toBeNull();
  });
  test('edit or delete of a signed doc is refused', () => {
    expect(signedDocumentMutationError([{ notes: mc }], [])).not.toBeNull();
    expect(signedDocumentMutationError([{ notes: mc }], [{ notes: JSON.stringify({ kind: 'mc', mcDays: '9', status: 'completed' }) }])).not.toBeNull();
    const tcNote = JSON.stringify({ kind: 'time-chit', tcHours: '1' });
    expect(signedDocumentMutationError([{ notes: tcNote }], [])).not.toBeNull();
  });
  test('voiding keeps the record; editing while voiding or re-voiding is refused', () => {
    const voided = JSON.stringify({ kind: 'mc', mcDays: '1', status: 'voided', voidedAt: '2026-11-17T01:00:00Z', voidReason: 'typo' });
    expect(signedDocumentMutationError([{ notes: mc }], [{ notes: voided }])).toBeNull();
    const voidedAndEdited = JSON.stringify({ kind: 'mc', mcDays: '7', status: 'voided', voidedAt: 'x' });
    expect(signedDocumentMutationError([{ notes: mc }], [{ notes: voidedAndEdited }])).not.toBeNull();
    expect(signedDocumentMutationError([{ notes: voided }], [])).not.toBeNull();
    expect(signedDocumentMutationError([{ notes: voided }], [{ notes: voided }])).toBeNull();
  });
});
