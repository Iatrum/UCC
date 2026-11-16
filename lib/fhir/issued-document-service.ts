import { createHash } from 'node:crypto';
import type { MedplumClient, ProfileResource } from '@medplum/core';
import type { BundleEntry, DocumentReference, Encounter, Patient, Procedure } from '@medplum/fhirtypes';

export const ISSUED_DOCUMENT_SYSTEM = 'https://ucc.emr/issued-document';
export type DocumentDetails = Record<string, string>;
export function documentDetails(notes?: string): DocumentDetails | null {
  try {
    const value = JSON.parse(notes || '{}');
    return value && (value.kind === 'mc' || value.kind === 'referral') ? value : null;
  } catch { return null; }
}
export function belongsToClinic(resource: { identifier?: { system?: string; value?: string }[] }, clinicId: string): boolean {
  return !!resource.identifier?.some(i => i.system === 'clinic' && i.value === clinicId);
}
function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function name(resource: { name?: Patient['name'] }): string {
  const n = resource.name?.[0];
  return n?.text || [...(n?.given || []), n?.family].filter(Boolean).join(' ');
}
export function renderIssuedDocument(details: DocumentDetails, context: {
  patientName: string; ic: string; doctor: string; clinic: string; address: string; phone: string; issuedAt: string;
}): string {
  const field = (label: string, value: string) => `<p><strong>${escape(label)}:</strong> ${escape(value).replace(/\r?\n/g, '<br>')}</p>`;
  let body: string;
  if (details.kind === 'mc') {
    const days = Number(details.mcDays);
    const start = new Date(`${details.mcStartDate}T00:00:00Z`);
    if (!Number.isInteger(days) || days < 1 || days > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(details.mcStartDate || '') || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== details.mcStartDate) {
      throw new Error('MC requires a valid start date and 1–365 whole days');
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);
    body = '<p>This patient is medically unfit for duty for the period below.</p>' + field('From', details.mcStartDate) + field('Through', end.toISOString().slice(0, 10)) + field('Days', String(days)) + (details.mcDiagnosis?.trim() ? field('Diagnosis', details.mcDiagnosis) : '');
  } else {
    if (!details.referralTo?.trim() || details.referralTo.includes('(Insert') || !details.referralContent?.trim() || details.referralContent === 'Please include any medical information you deem relevant for the referral') {
      throw new Error('Referral requires a recipient and clinical content');
    }
    body = field('To / department', details.referralTo) + (details.referralDiagnosis?.trim() ? field('Reason / diagnosis', details.referralDiagnosis) : '') + field('Reason, clinical summary, findings and treatment given', details.referralContent);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${details.kind === 'mc' ? 'Medical Certificate' : 'Referral Letter'}</title><style>@page{size:A4;margin:20mm}body{font:16px/1.6 Arial,sans-serif;max-width:760px;margin:32px auto;padding:16px;color:#111}h1{font-size:24px}p{overflow-wrap:anywhere}@media print{body{margin:0;padding:0}}</style></head><body><header><h2>${escape(context.clinic)}</h2><p>${escape(context.address)}<br>${escape(context.phone)}</p></header><h1>${details.kind === 'mc' ? 'Medical Certificate' : 'Referral Letter'}</h1>${field('Patient', context.patientName)}${field('IC / identification', context.ic)}${body}<footer>${field('Doctor', context.doctor)}${field('Issued', context.issuedAt.slice(0, 10))}<p>Signed and issued electronically.</p></footer></body></html>`;
}

/** Build document entries before changing any Procedure. All entries commit in one transaction. */
export async function prepareIssuedDocuments(client: MedplumClient, encounter: Encounter, clinicId: string,
  procedures: Array<{ notes?: string; category?: string; procedureId?: string; name: string }>, signer?: ProfileResource
): Promise<{ entries: BundleEntry[]; notes: Map<number, string> }> {
  const entries: BundleEntry[] = [];
  const notes = new Map<number, string>();
  const documents = procedures.map((p, index) => ({ p, index, d: p.category === 'documents' ? documentDetails(p.notes) : null })).filter(x => x.d);
  if (!signer || !documents.length) return { entries, notes };
  if (signer.resourceType !== 'Practitioner' || !signer.id || !name(signer)) throw new Error('A named practitioner must sign clinical documents');
  if (!belongsToClinic(encounter, clinicId) || !encounter.subject?.reference?.startsWith('Patient/')) throw new Error('Document encounter is outside clinic scope');
  const patient = await client.readResource('Patient', encounter.subject.reference.slice(8));
  if (!belongsToClinic(patient, clinicId)) throw new Error('Document patient is outside clinic scope');
  const clinics = await client.searchResources('Organization', { identifier: `clinic|${clinicId}`, _count: '2' });
  const clinic = clinics.find(c => belongsToClinic(c, clinicId));
  if (clinics.length !== 1 || !clinic?.name) throw new Error('A single named clinic is required to issue documents');
  const issuedAt = new Date().toISOString();
  for (const { p, index, d } of documents) {
    const details = d!;
    if (details.documentKey) {
      const existing = await client.searchResources('DocumentReference', {
        identifier: `${ISSUED_DOCUMENT_SYSTEM}|${details.documentKey}`, subject: encounter.subject.reference,
      });
      if (!existing.some(doc => belongsToClinic(doc, clinicId) && doc.context?.encounter?.some(e => e.reference === `Encounter/${encounter.id}`) && doc.docStatus === 'final')) {
        throw new Error('Issued document does not belong to this visit');
      }
      continue;
    }
    const key = createHash('sha256').update(JSON.stringify([clinicId, encounter.id, details.entryId || p.procedureId || index, details])).digest('hex');
    const html = renderIssuedDocument(details, {
      patientName: name(patient), ic: patient.identifier?.find(i => i.system !== 'clinic')?.value || '',
      doctor: name(signer), clinic: clinic.name!, address: (clinic.address || []).map(a => a.text || [...(a.line || []), a.city, a.state, a.postalCode].filter(Boolean).join(', ')).join('; '),
      phone: clinic.telecom?.find(t => t.system === 'phone')?.value || '', issuedAt,
    });
    const doc: DocumentReference = {
      resourceType: 'DocumentReference', status: 'current', docStatus: 'final',
      identifier: [{ system: 'clinic', value: clinicId }, { system: ISSUED_DOCUMENT_SYSTEM, value: key }],
      type: { coding: [{ system: ISSUED_DOCUMENT_SYSTEM, code: details.kind }], text: details.kind === 'mc' ? 'Medical Certificate' : 'Referral Letter' },
      subject: encounter.subject, context: { encounter: [{ reference: `Encounter/${encounter.id}` }] }, date: issuedAt,
      author: [{ reference: `Practitioner/${signer.id}`, display: name(signer) }], authenticator: { reference: `Practitioner/${signer.id}` },
      custodian: { reference: `Organization/${clinic.id}`, display: clinic.name },
      content: [{ attachment: { contentType: 'text/html', data: Buffer.from(html).toString('base64'), title: details.kind === 'mc' ? 'Medical Certificate' : 'Referral Letter', creation: issuedAt } }],
    };
    entries.push({ resource: doc, request: { method: 'POST', url: 'DocumentReference', ifNoneExist: `identifier=${encodeURIComponent(`${ISSUED_DOCUMENT_SYSTEM}|${key}`)}` } });
    notes.set(index, JSON.stringify({ ...details, status: 'issued', documentKey: key }));
  }
  return { entries, notes };
}

export function documentProcedureStatus(notes?: string): Procedure['status'] {
  const details = documentDetails(notes);
  return details ? (details.documentKey ? 'completed' : 'preparation') : 'completed';
}
