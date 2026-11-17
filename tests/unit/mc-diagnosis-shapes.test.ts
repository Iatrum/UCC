import { describe, expect, test } from 'bun:test';
import { fillDocumentTemplate, mcDiagnosisBlock, mmcLine } from '../../lib/clinical-documents';
import { DEFAULT_MC_TEMPLATE } from '../../lib/document-templates';

// Task 415: adversarial template shapes for "MC diagnosis hidden by default".
const SECRET = 'Fake secret dx';
const data = { diagnosis: SECRET, doctorName: 'Dr Fake', patientName: 'Ali', mcDays: '2', diagnosisBlock: mcDiagnosisBlock(SECRET, true), mmcLine: mmcLine('1') };
const hide = (t: string) => fillDocumentTemplate(t, data, { rawKeys: ['diagnosisBlock', 'mmcLine'], hideMcDiagnosis: true });

describe('MC diagnosis never printed when hidden (all shapes)', () => {
  const shapes: Record<string, string> = {
    paragraph: '<p>Diagnosis: {{diagnosis}}</p>',
    strongLabel: '<p><strong>Diagnosis:</strong> {{diagnosis}}</p>',
    spanValue: '<p>Diagnosis: <span class="v">{{diagnosis}}</span></p>',
    div: '<div>Diagnosis: {{diagnosis}}</div>',
    listItem: '<ul><li>Diagnosis: {{diagnosis}}</li></ul>',
    tableRow: '<table><tr><td>Diagnosis</td><td>{{diagnosis}}</td></tr></table>',
    spaced: '<p>Diagnosis:   {{ diagnosis }}</p>',
    bareBr: '<div>Name {{patientName}}<br>Diagnosis: {{diagnosis}}<br>Days {{mcDays}}</div>',
    bare: 'Diagnosis: {{diagnosis}}',
    valueOnly: '<span>{{diagnosis}}</span>',
    multiline: '<p>\n  Diagnosis:\n  {{diagnosis}}\n</p>',
    upper: '<P>DIAGNOSIS: {{diagnosis}}</P>',
    heading: '<h3>Diagnosis</h3><p>{{diagnosis}}</p>',
    block: '<p>{{diagnosisBlock}}</p>',
    blockRaw: '{{diagnosisBlock}}',
    inAttribute: '<p title="{{diagnosis}}">x</p>',
    unclosed: '<p>Diagnosis: {{diagnosis}}',
  };
  for (const [name, html] of Object.entries(shapes)) {
    test(name, () => {
      const out = hide(`<div class="cert"><p>Keep {{doctorName}}</p>${html}</div>`);
      expect(out).not.toContain(SECRET);
      expect(out).toContain('Keep Dr Fake');
    });
  }
  test('default MC template: hidden vs opt-in', () => {
    expect(hide(DEFAULT_MC_TEMPLATE)).not.toContain(SECRET);
    expect(fillDocumentTemplate(DEFAULT_MC_TEMPLATE, data, { rawKeys: ['diagnosisBlock', 'mmcLine'] })).toContain(SECRET);
  });
});
