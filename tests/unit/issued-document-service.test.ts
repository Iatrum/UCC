import { describe, expect, it } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import { belongsToClinic, documentDetails, documentProcedureStatus, prepareIssuedDocuments, renderIssuedDocument } from '../../lib/fhir/issued-document-service';

const context = { patientName: 'Fake <Patient>', ic: 'FAKE-IC', doctor: 'Dr Fake', clinic: 'Fake Clinic', address: 'Test Street', phone: '000', issuedAt: '2026-11-16T08:00:00Z' };
const mc = { kind: 'mc', mcDays: '2', mcStartDate: '2026-12-31', mcDiagnosis: '' };
const encounter = { resourceType: 'Encounter' as const, id: 'fake-visit', status: 'finished' as const, class: { code: 'AMB' }, identifier: [{ system: 'clinic', value: 'fake' }], subject: { reference: 'Patient/fake-patient' } };
const signer = { resourceType: 'Practitioner' as const, id: 'fake-doctor', name: [{ text: 'Dr Fake' }] };
const procedures = [{ name: 'MC', category: 'documents', notes: JSON.stringify(mc) }];
function client(clinic = 'fake') {
  return {
    readResource: async () => ({ resourceType: 'Patient', identifier: [{ system: 'clinic', value: clinic }, { system: 'nric', value: 'FAKE-IC' }], name: [{ text: 'Fake Patient' }] }),
    searchResources: async () => [{ resourceType: 'Organization', id: 'fake-org', name: 'Fake Clinic', identifier: [{ system: 'clinic', value: 'fake' }] }],
  } as unknown as MedplumClient;
}
describe('MC and referral issuance', () => {
  it('renders printable dates across a year boundary and keeps diagnosis optional', () => {
    const html = renderIssuedDocument(mc, context);
    expect(html).toContain('2027-01-01'); expect(html).not.toContain('Diagnosis');
    expect(html).toContain('Fake &lt;Patient&gt;'); expect(html).toContain('FAKE-IC'); expect(html).toContain('Dr Fake'); expect(html).toContain('Fake Clinic');
  });
  it('rejects invalid calendar dates and non-whole or excessive days', () => {
    for (const value of ['0', '-1', '1.5', '366', 'NaN']) expect(() => renderIssuedDocument({ ...mc, mcDays: value }, context)).toThrow();
    expect(() => renderIssuedDocument({ ...mc, mcStartDate: '2026-02-30' }, context)).toThrow();
  });
  it('escapes referral text and preserves multiline clinical content', () => {
    const html = renderIssuedDocument({ kind: 'referral', referralTo: 'Cardiology', referralDiagnosis: 'Reason', referralContent: 'Summary\nFindings\nTreatment <script>alert(1)</script>' }, context);
    expect(html).toContain('Cardiology'); expect(html).toContain('Findings<br>'); expect(html).not.toContain('<script>');
    expect(() => renderIssuedDocument({ kind: 'referral', referralTo: '', referralContent: '' }, context)).toThrow();
  });
  it('keeps unissued records in preparation regardless of old completed flags', () => {
    expect(documentProcedureStatus(JSON.stringify({ ...mc, status: 'completed' }))).toBe('preparation');
    expect(documentProcedureStatus(JSON.stringify({ ...mc, documentKey: 'key' }))).toBe('completed');
    expect(documentDetails('plain note')).toBeNull(); expect(documentProcedureStatus('plain note')).toBe('completed');
  });
  it('requires the exact clinic identifier', () => {
    expect(belongsToClinic(encounter, 'other')).toBe(false); expect(belongsToClinic(encounter, 'fake')).toBe(true);
  });
  it('creates final scoped linked snapshots and stable retry identifiers', async () => {
    const a = await prepareIssuedDocuments(client(), encounter, 'fake', procedures, signer);
    const b = await prepareIssuedDocuments(client(), encounter, 'fake', procedures, signer);
    expect(a.entries[0].request?.ifNoneExist).toBe(b.entries[0].request?.ifNoneExist);
    const doc = a.entries[0].resource as any;
    expect(doc.docStatus).toBe('final'); expect(doc.subject.reference).toBe('Patient/fake-patient');
    expect(doc.context.encounter[0].reference).toBe('Encounter/fake-visit'); expect(belongsToClinic(doc, 'fake')).toBe(true);
    expect(doc.author[0].reference).toBe('Practitioner/fake-doctor'); expect(doc.content[0].attachment.contentType).toBe('text/html');
    expect(JSON.parse(a.notes.get(0)!).status).toBe('issued');
  });
  it('does not issue drafts through ordinary edit paths', async () => {
    expect((await prepareIssuedDocuments(client(), encounter, 'fake', procedures)).entries).toHaveLength(0);
  });
  it('rejects cross-clinic patient, encounter, and unqualified signer before persistence', async () => {
    await expect(prepareIssuedDocuments(client('other'), encounter, 'fake', procedures, signer)).rejects.toThrow('patient');
    await expect(prepareIssuedDocuments(client(), encounter, 'other', procedures, signer)).rejects.toThrow('encounter');
    await expect(prepareIssuedDocuments(client(), encounter, 'fake', procedures, { resourceType: 'Patient', id: 'wrong' })).rejects.toThrow('practitioner');
  });
  it('rejects forged issued keys', async () => {
    await expect(prepareIssuedDocuments(client(), encounter, 'fake', [{ ...procedures[0], notes: JSON.stringify({ ...mc, documentKey: 'forged' }) }], signer)).rejects.toThrow('does not belong');
  });
});
