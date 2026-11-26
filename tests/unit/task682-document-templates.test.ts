import { describe, expect, mock, test } from 'bun:test';
import { getDefaultTemplate, getTemplate, saveTemplate } from '../../lib/fhir/document-template-service';
import { DEFAULT_MC_TEMPLATE, DEFAULT_REFERRAL_TEMPLATE, DEFAULT_TIME_CHIT_TEMPLATE, fillPreviewData } from '../../lib/document-templates';
import { buildReferralBody, fillDocumentTemplate, mcDiagnosisBlock, mmcLine, signatureName, escapeHtmlText } from '../../lib/clinical-documents';
import { createPatientDocument, deletePatientDocument, listPatientDocuments, updatePatientDocument } from '../../lib/fhir/document-service';
import { STORAGE_PATH_EXTENSION_URL } from '../../lib/fhir/structure-definitions';

const BASE = 'https://ucc.emr/document-template';
const org = (clinic: string, extension?: any[]) => ({ resourceType: 'Organization', id: `org-${clinic}`, identifier: [{ system: 'clinic', value: clinic }], extension });

describe('Task 682: per-clinic document templates (MC / Time Chit / referral)', () => {
  test('default per type', () => {
    expect(getDefaultTemplate('mc')).toBe(DEFAULT_MC_TEMPLATE);
    expect(getDefaultTemplate('referral')).toBe(DEFAULT_REFERRAL_TEMPLATE);
    expect(getDefaultTemplate('time-chit')).toBe(DEFAULT_TIME_CHIT_TEMPLATE);
  });

  test('getTemplate searches only the caller clinic organisation', async () => {
    const search = mock(async () => [org('clinic-a', [{ url: `${BASE}/mc`, valueString: '<p>A MC</p>' }])]);
    expect(await getTemplate('mc', 'clinic-a', { searchResources: search } as any)).toBe('<p>A MC</p>');
    expect(search.mock.calls[0]).toEqual(['Organization', { identifier: 'clinic|clinic-a', _count: '1' }]);
  });

  test('falls back to default: no org, no extension, other type extension, empty string, search error', async () => {
    const get = (res: any) => getTemplate('time-chit', 'c', { searchResources: async () => res } as any);
    expect(await get([])).toBe(DEFAULT_TIME_CHIT_TEMPLATE);
    expect(await get([org('c')])).toBe(DEFAULT_TIME_CHIT_TEMPLATE);
    expect(await get([org('c', [{ url: `${BASE}/mc`, valueString: '<p>mc</p>' }])])).toBe(DEFAULT_TIME_CHIT_TEMPLATE);
    expect(await get([org('c', [{ url: `${BASE}/time-chit`, valueString: '' }])])).toBe(DEFAULT_TIME_CHIT_TEMPLATE);
    const throwing = { searchResources: async () => { throw new Error('down'); } } as any;
    expect(await getTemplate('referral', 'c', throwing)).toBe(DEFAULT_REFERRAL_TEMPLATE);
  });

  test('saveTemplate replaces only its own extension and keeps the others', async () => {
    const existing = org('clinic-a', [{ url: `${BASE}/mc`, valueString: 'old' }, { url: `${BASE}/referral`, valueString: 'ref' }, { url: 'https://other', valueString: 'z' }]);
    const update = mock(async (r: any) => r);
    await saveTemplate('mc', '<p>new</p>', 'clinic-a', { searchResources: async () => [existing], updateResource: update } as any);
    const written = update.mock.calls[0][0] as any;
    expect(written.identifier).toEqual(existing.identifier);
    expect(written.extension.filter((e: any) => e.url === `${BASE}/mc`)).toEqual([{ url: `${BASE}/mc`, valueString: '<p>new</p>' }]);
    expect(written.extension.map((e: any) => e.url).sort()).toEqual([`${BASE}/mc`, `${BASE}/referral`, 'https://other'].sort());
  });

  test('saveTemplate on an org with no extensions, and with no org (throws, writes nothing)', async () => {
    const update = mock(async (r: any) => r);
    await saveTemplate('time-chit', 'h', 'c', { searchResources: async () => [org('c')], updateResource: update } as any);
    expect((update.mock.calls[0][0] as any).extension).toEqual([{ url: `${BASE}/time-chit`, valueString: 'h' }]);
    const update2 = mock(async (r: any) => r);
    await expect(saveTemplate('mc', 'h', 'ghost', { searchResources: async () => [], updateResource: update2 } as any)).rejects.toThrow('Organization not found for clinic: ghost');
    expect(update2).not.toHaveBeenCalled();
  });
});

describe('Task 682: template preview data', () => {
  test.each([['mc', DEFAULT_MC_TEMPLATE], ['referral', DEFAULT_REFERRAL_TEMPLATE], ['time-chit', DEFAULT_TIME_CHIT_TEMPLATE]])('%s default template previews with no leftover placeholders', (_k, tpl) => {
    expect(tpl).toContain('{{');
    const out = fillPreviewData(tpl);
    expect(out).not.toMatch(/\{\{\w+\}\}/);
    expect(out).toContain('Ahmad bin Abdullah');
  });
  test('time chit preview uses sample attendance values; unknown tokens are left untouched', () => {
    const out = fillPreviewData('{{tcTimeIn}}-{{tcTimeOut}} {{tcHours}} {{tcHoursLabel}} {{nope}}');
    expect(out).toBe('09:00-10:30 1.5 1.5 hours {{nope}}');
  });
  test('replaces every occurrence of a placeholder', () => {
    expect(fillPreviewData('{{doctorName}} / {{doctorName}}')).toBe('Dr. Demo Klinik / Dr. Demo Klinik');
  });
});

describe('Task 682: referral letter + shared document helpers', () => {
  test('referral body: each visit section included only when present; visit date / name defaults', () => {
    const body = buildReferralBody({ progressNote: 'improving', visitDate: '23 May 2026', medications: [' Metformin ', ' ', ''] });
    expect(body).toContain('Dear Doctor,');
    expect(body).toContain('Thank you for seeing this patient');
    expect(body).toContain('during the consultation on 23 May 2026');
    expect(body).toContain('Progress note:\nimproving');
    expect(body).toContain('- Metformin');
    expect(body).not.toContain('Clinical summary:');
    expect(body).not.toContain('Diagnosis:');
    expect(body).not.toContain('Additional notes:');
    expect(body).toContain('Allergies not documented');
    expect(buildReferralBody({ patientName: 'Siti', diagnosis: 'x' })).not.toContain('during the consultation');
    expect(buildReferralBody({ patientName: 'Siti', diagnosis: 'x' })).toContain('seeing Siti');
  });
  test('meds only or allergies only (no visit text) still builds a full letter, not the placeholder prompt', () => {
    expect(buildReferralBody({ allergies: ['Penicillin', ' '] })).toContain('Allergies:\nPenicillin');
    expect(buildReferralBody({ orderedMedications: ['Amoxicillin'] })).toContain('- Amoxicillin (ordered in this consult)');
    expect(buildReferralBody({ medications: [' '], allergies: [], orderedMedications: [] })).toBe('Please include any medical information you deem relevant for the referral');
  });
  test('current + ordered meds listed in that order', () => {
    const b = buildReferralBody({ medications: ['A'], orderedMedications: ['B'] });
    expect(b.indexOf('- A')).toBeLessThan(b.indexOf('- B (ordered'));
  });
  test('signature / MMC / diagnosis block helpers', () => {
    expect(signatureName('Dr A', '123')).toBe('Dr A (MMC 123)');
    expect(signatureName(' Dr A ', ' ')).toBe('Dr A');
    expect(signatureName(null, '9')).toBe('(MMC 9)');
    expect(signatureName()).toBe('');
    expect(mmcLine('<b>1</b>')).toBe('MMC No: &lt;b&gt;1&lt;/b&gt;');
    expect(mmcLine(null)).toBe('');
    expect(mcDiagnosisBlock('  ', true)).toBe('');
    expect(mcDiagnosisBlock('Flu <x>', false)).toBe('');
    expect(mcDiagnosisBlock('Flu <x>', true)).toBe('<p class="cert-para">Diagnosis: Flu &lt;x&gt;</p>');
    expect(escapeHtmlText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  test('fillDocumentTemplate: referral body is escaped unless raw; raw keys pass through; unknown tokens stay', () => {
    const tpl = '<p>{{referralBody}}</p><i>{{mmcLine}}</i>{{unknown}}';
    const out = fillDocumentTemplate(tpl, { referralBody: '<script>x</script>', mmcLine: 'MMC No: 1' }, { rawKeys: ['mmcLine'] });
    expect(out).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p><i>MMC No: 1</i>{{unknown}}');
  });
  test('fillDocumentTemplate does not re-expand placeholders inside substituted values', () => {
    const out = fillDocumentTemplate('{{a}} {{b}}', { a: '{{b}}', b: 'B' });
    expect(out).toBe('B B'); // documents current (sequential) behaviour
  });
});

describe('Task 682: DocumentReference service clinic scoping', () => {
  const ref = (clinic?: string, extra: any = {}) => ({
    resourceType: 'DocumentReference', id: 'd1', status: 'current', subject: { reference: 'Patient/p1' }, identifier: clinic ? [{ system: 'clinic', value: clinic }] : undefined,
    content: [{ attachment: { title: 'Old', url: 'u' } }, { attachment: { title: 'Second', url: 'u2' } }], ...extra,
  });
  test('update/delete: foreign or untagged is 404 and writes nothing; no clinic is 403', async () => {
    for (const stored of [ref('clinic-b'), ref(undefined)]) {
      const c: any = { readResource: async () => stored, updateResource: mock(async (r: any) => r), deleteResource: mock(async () => {}) };
      await expect(updatePatientDocument(c, 'd1', { title: 'T', clinicId: 'clinic-a' })).rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(deletePatientDocument(c, 'd1', 'clinic-a')).rejects.toMatchObject({ name: 'NotFoundError' });
      expect(c.updateResource).not.toHaveBeenCalled();
      expect(c.deleteResource).not.toHaveBeenCalled();
    }
    const c: any = { readResource: async () => ref('clinic-a'), updateResource: mock(async () => {}), deleteResource: mock(async () => {}) };
    await expect(updatePatientDocument(c, 'd1', { title: 'T' })).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(deletePatientDocument(c, 'd1')).rejects.toMatchObject({ name: 'ForbiddenError' });
  });
  test('update retitles only the first attachment and keeps the rest; empty title is a no-op rewrite', async () => {
    const c: any = { readResource: async () => ref('clinic-a'), updateResource: mock(async (r: any) => r) };
    await updatePatientDocument(c, 'd1', { title: 'New', clinicId: 'clinic-a' });
    const w = c.updateResource.mock.calls[0][0];
    expect(w.content.map((x: any) => x.attachment.title)).toEqual(['New', 'Second']);
    expect(w.identifier).toEqual([{ system: 'clinic', value: 'clinic-a' }]);
    await updatePatientDocument(c, 'd1', { title: '', clinicId: 'clinic-a' });
    expect(c.updateResource.mock.calls[1][0].content[0].attachment.title).toBe('Old');
  });
  test('delete of own clinic document deletes by id', async () => {
    const c: any = { readResource: async () => ref('clinic-a'), deleteResource: mock(async () => {}) };
    await deletePatientDocument(c, 'd1', 'clinic-a');
    expect(c.deleteResource).toHaveBeenCalledWith('DocumentReference', 'd1');
  });
  test('createPatientDocument without clinic context fails closed before any write', async () => {
    const c: any = { createResource: mock(async () => ({ id: 'x' })), readResource: mock(async () => ({})) };
    await expect(createPatientDocument(c, { patientId: 'p1', title: 't', url: 'u', contentType: 'application/pdf' })).rejects.toThrow('Forbidden');
    expect(c.createResource).not.toHaveBeenCalled();
  });
  test('listPatientDocuments maps fields, extracts storage path, drops url-less entries', async () => {
    const search = mock(async () => [
      ref('clinic-a', { id: 'a', date: '2026-05-01', author: [{ display: 'Dr A' }], extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: 'patients/p1/documents/x.pdf' }],
        content: [{ attachment: { url: 'https://f/x', title: 'X', contentType: 'application/pdf', size: 5, creation: '2026-05-02' } }] }),
      ref('clinic-a', { id: 'b', content: [{ attachment: { title: 'no url' } }] }),
      ref('clinic-a', { id: 'c', date: '2026-04-01', content: [{ attachment: { url: 'u' } }] }),
      ref('clinic-a', { id: 'd', content: [] }),
    ]);
    const out = await listPatientDocuments({ searchResources: search } as any, 'p1', 'clinic-a');
    expect(search.mock.calls[0][1]).toEqual({ subject: 'Patient/p1', identifier: 'clinic|clinic-a', _sort: '-date' });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'a', title: 'X', url: 'https://f/x', contentType: 'application/pdf', size: 5, uploadedAt: '2026-05-02', uploadedBy: 'Dr A', storagePath: 'patients/p1/documents/x.pdf' });
    expect(out[1]).toMatchObject({ id: 'c', title: 'Document', uploadedAt: '2026-04-01', storagePath: undefined });
  });
});
