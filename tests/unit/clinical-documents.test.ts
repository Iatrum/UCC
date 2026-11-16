import { describe, expect, test } from 'bun:test';
import {
  buildReferralBody, fillDocumentTemplate, isSignedDocumentNote, mcDiagnosisBlock, mcDiagnosisVisible, mmcLine,
} from '../../lib/clinical-documents';
import { DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE } from '../../lib/document-templates';

const mcData = (include: boolean) => ({
  clinicName: 'Fake Clinic', patientName: 'Ali Fake', diagnosis: include ? 'Fake fever' : '', doctorName: 'Dr Fake',
  mmcLine: mmcLine('12345'), diagnosisBlock: mcDiagnosisBlock('Fake fever', include),
});

describe('MC document', () => {
  test('diagnosis is hidden by default and only shown on explicit opt-in', () => {
    expect(mcDiagnosisVisible({})).toBe(false);
    expect(mcDiagnosisVisible({ mcIncludeDiagnosis: '' })).toBe(false);
    expect(mcDiagnosisVisible({ mcIncludeDiagnosis: 'true' })).toBe(true);
    const hidden = fillDocumentTemplate(DEFAULT_MC_TEMPLATE, mcData(false), { rawKeys: ['mmcLine', 'diagnosisBlock'], hideMcDiagnosis: true });
    expect(hidden).not.toContain('Fake fever');
    expect(hidden).not.toContain('Diagnosis:');
    const shown = fillDocumentTemplate(DEFAULT_MC_TEMPLATE, mcData(true), { rawKeys: ['mmcLine', 'diagnosisBlock'] });
    expect(shown).toContain('Diagnosis: Fake fever');
  });
  test('legacy custom template with hard-coded Diagnosis line is stripped when hidden', () => {
    const legacy = '<div><p class="x">Diagnosis: {{diagnosis}}</p><b>{{doctorName}}</b></div>';
    expect(fillDocumentTemplate(legacy, mcData(false), { hideMcDiagnosis: true })).toBe('<div><b>Dr Fake</b></div>');
  });
  test('MMC number and doctor name are printed; empty MMC prints nothing', () => {
    const out = fillDocumentTemplate(DEFAULT_MC_TEMPLATE, mcData(false), { rawKeys: ['mmcLine', 'diagnosisBlock'] });
    expect(out).toContain('MMC No: 12345');
    expect(out).toContain('Dr Fake');
    expect(mmcLine('  ')).toBe('');
    expect(mmcLine(undefined)).toBe('');
  });
  test('values are HTML-escaped', () => {
    expect(fillDocumentTemplate('{{a}}', { a: '<script>x</script>' })).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(mmcLine('<b>1')).toBe('MMC No: &lt;b&gt;1');
  });
});

describe('referral letter', () => {
  test('default body pulls visit summary, current meds and allergies', () => {
    const body = buildReferralBody({
      patientName: 'Ali Fake', visitDate: '16 Nov 2026', clinicalSummary: 'Cough 3 days', diagnosis: 'URTI',
      medications: ['Paracetamol 500mg', ' '], allergies: ['Penicillin'],
    });
    expect(body).toContain('Ali Fake');
    expect(body).toContain('Cough 3 days');
    expect(body).toContain('- Paracetamol 500mg');
    expect(body).toContain('Allergies:\nPenicillin');
  });
  test('states explicitly when no meds / allergies are recorded', () => {
    const body = buildReferralBody({ diagnosis: 'URTI' });
    expect(body).toContain('None recorded');
    expect(body).toContain('No known drug allergies recorded');
  });
  test('empty input falls back to prompt text', () => {
    expect(buildReferralBody({})).toStartWith('Please include');
  });
  test('referral template shows doctor and MMC, body stays unescaped HTML only for raw key', () => {
    const out = fillDocumentTemplate(DEFAULT_REFERRAL_TEMPLATE,
      { referralFrom: 'Dr Fake', mmcLine: mmcLine('999'), referralBody: '<p>ok</p>', referralTo: '<i>H</i>' },
      { rawKeys: ['referralBody', 'mmcLine'] });
    expect(out).toContain('MMC No: 999');
    expect(out).toContain('<p>ok</p>');
    expect(out).toContain('&lt;i&gt;H&lt;/i&gt;');
  });
});

describe('document note detection (drives provenance)', () => {
  test('detects only mc / referral JSON notes', () => {
    expect(isSignedDocumentNote('{"kind":"mc"}')).toBe('mc');
    expect(isSignedDocumentNote('{"kind":"referral"}')).toBe('referral');
    expect(isSignedDocumentNote('{"kind":"time-chit"}')).toBeNull();
    expect(isSignedDocumentNote('not json')).toBeNull();
    expect(isSignedDocumentNote(undefined)).toBeNull();
  });
});
