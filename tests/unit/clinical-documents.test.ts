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

describe('diagnosis hiding is structural, not a single regex shape', () => {
  const D = 'Fake fever';
  const hide = (tpl: string) => fillDocumentTemplate(tpl, { diagnosis: D, doctorName: 'Dr Fake', patientName: 'Ali' }, { hideMcDiagnosis: true });
  const cases: Record<string, [string, string]> = {
    'nested label in strong': ['<div><p><strong>Diagnosis:</strong> {{diagnosis}}</p><b>{{doctorName}}</b></div>', '<div><b>Dr Fake</b></div>'],
    'uppercase tag + attrs + extra spaces': ['<P CLASS="a>b">  DIAGNOSIS :   {{ diagnosis }} </P><i>x</i>', '<i>x</i>'],
    'table row label/value cells': ['<table><tr><td>Name</td><td>{{patientName}}</td></tr><tr><td>Diagnosis</td><td>{{diagnosis}}</td></tr></table>', '<table><tr><td>Name</td><td>Ali</td></tr></table>'],
    'label and value in separate divs': ['<div><b>Diagnosis:</b></div><div>{{diagnosis}}</div><p>{{doctorName}}</p>', '<p>Dr Fake</p>'],
    'list item': ['<ul><li>Diagnosis: {{diagnosis}}</li><li>Other</li></ul>', '<ul><li>Other</li></ul>'],
    'self-closing br inside paragraph': ['<p>Diagnosis:<br/>{{diagnosis}}</p><p>ok</p>', '<p>ok</p>'],
    'html comment and attribute contain the placeholder': ['<!-- {{diagnosis}} --><p title="{{diagnosis}}">hi</p>', '<!--  --><p title="">hi</p>'],
  };
  for (const [name, [tpl, expected]] of Object.entries(cases)) {
    test(name, () => {
      const out = hide(tpl);
      expect(out).not.toContain(D);
      expect(out).toBe(expected);
    });
  }
  test('never deletes a large container or sibling content that merely holds the diagnosis inline', () => {
    const out = hide('<div class="body"><p>Patient {{patientName}} is unfit.</p>Diagnosis: {{diagnosis}} <p>Signed {{doctorName}}</p></div>');
    expect(out).toBe('<div class="body"><p>Patient Ali is unfit.</p> <p>Signed Dr Fake</p></div>');
  });
  test('keeps other cells in a row that also holds other data', () => {
    const out = hide('<table><tr><td>{{patientName}}</td><td>Diagnosis: {{diagnosis}}</td></tr></table>');
    expect(out).toBe('<table><tr><td>Ali</td></tr></table>');
  });
  test('value never appears even if the template shape is unrecognised or malformed', () => {
    for (const tpl of ['<p>Dx {{diagnosis}}', '{{diagnosis}}', '<span>{{diagnosis}}</span><', '<div><p>{{diagnosis}}</div></p>']) {
      expect(hide(tpl)).not.toContain(D);
    }
  });
  test('diagnosisBlock value is never filled when hidden, even if the caller supplied it', () => {
    const out = fillDocumentTemplate('<p>{{diagnosisBlock}}</p>', { diagnosisBlock: '<p>Diagnosis: Fake fever</p>' }, { rawKeys: ['diagnosisBlock'], hideMcDiagnosis: true });
    expect(out).not.toContain('Fake fever');
  });
  test('templates are untouched when diagnosis is shown', () => {
    expect(fillDocumentTemplate('<p>Diagnosis: {{diagnosis}}</p>', { diagnosis: D })).toBe('<p>Diagnosis: Fake fever</p>');
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
  test('does not assert absence when no meds / allergies are recorded', () => {
    const body = buildReferralBody({ diagnosis: 'URTI' });
    expect(body).toContain('Allergies:\nAllergies not documented');
    expect(body).toContain('see attached prescription');
    expect(body).not.toContain('None recorded');
    expect(body).not.toContain('No known');
  });
  test('includes medicines ordered in this consult', () => {
    const body = buildReferralBody({ diagnosis: 'URTI', orderedMedications: ['Paracetamol 500mg'] });
    expect(body).toContain('- Paracetamol 500mg (ordered in this consult)');
    expect(body).not.toContain('see attached prescription');
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
    expect(isSignedDocumentNote('{"kind":"time-chit"}')).toBe('time-chit');
    expect(isSignedDocumentNote('not json')).toBeNull();
    expect(isSignedDocumentNote(undefined)).toBeNull();
  });
});
