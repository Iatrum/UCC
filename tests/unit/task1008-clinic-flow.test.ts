import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import type { Encounter } from '@medplum/fhirtypes';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LabOrderForm } from '../../components/labs/lab-order-form';
import { buildSavedConsultation, saveConsultationToMedplum } from '../../lib/fhir/consultation-service';
import { getPatientFromMedplum, savePatientToMedplum } from '../../lib/fhir/patient-service';
import { completeQueueVisit, saveTriageEncounter } from '../../lib/fhir/triage-service';
import { startLabResultUpdates } from '../../lib/poct/live-results';
import { addTreatmentCatalogEntry, type TreatmentPlanEntry } from '../../lib/treatment-plan';
import { makeFake } from './helpers/fake-medplum';

const clinic = 'clinic-a';
const clinicTag = [{ system: 'clinic', value: clinic }];
const patientRef = 'Patient/fake-patient';
const fakePatient = { resourceType: 'Patient', id: 'fake-patient', identifier: clinicTag, name: [{ text: 'Fake Patient' }] };
const extension = 'https://ucc.emr/triage-encounter';
const status = (visit: Encounter) => visit.extension?.find((x) => x.url === extension)?.extension?.find((x) => x.url === 'queueStatus')?.valueString;

function fakeClient(initial: unknown[] = []) {
  const db = makeFake([
    fakePatient,
    { resourceType: 'Organization', id: clinic, identifier: clinicTag },
    ...initial,
  ]);
  const lookup = db.searchResources;
  db.searchResources = async (type, params) => {
    const query = new URLSearchParams(typeof params === 'string' ? params : params as Record<string, string>);
    if (query.getAll('identifier').some((id) => /^(nric|ic)\|/.test(id))) return [];
    const matches = await lookup(type, { ...Object.fromEntries(query), _count: '100' });
    params = Object.fromEntries(query);
    return matches.filter((resource) => {
      return (!params.subject || resource.subject?.reference === params.subject) &&
        (!params._id || resource.id === params._id) &&
        (!params.status || params.status.split(',').includes(resource.status)) &&
        (!params.patient || resource.patient?.reference === params.patient) &&
        (!params._compartment || resource.meta?.accounts?.some((a: { reference: string }) => a.reference === params._compartment));
    }).sort((a, b) => params._sort === '-date' ? String(b.period?.start).localeCompare(String(a.period?.start)) : 0);
  };
  Object.assign(db, { async *searchResourcePages() { yield []; } });
  return { db, client: db as unknown as MedplumClient };
}

describe('check-in, signing and checkout', () => {
  test('closes the linked visit and a same-day re-check-in survives an old checkout retry', async () => {
    const { client } = fakeClient();
    const triage = { triageLevel: 3 as const, chiefComplaint: 'Fake intake complaint', vitalSigns: {} };
    const first = await saveTriageEncounter(fakePatient.id, triage, client, clinic);
    const id = await saveConsultationToMedplum({
      patientId: fakePatient.id, chiefComplaint: '<p>Fake SOAP</p>', diagnosis: 'Fake diagnosis',
      idempotencyKey: 'fake-sign-1008',
    }, { id: fakePatient.id, name: 'Fake Patient' }, clinic, client);

    const consultation = await client.readResource('Encounter', id);
    expect(consultation.partOf?.reference).toBe(`Encounter/${first}`);
    const chart = buildSavedConsultation(consultation, [], [{
      resourceType: 'Observation', status: 'final', code: { text: 'Chief Complaint' }, valueString: '<p>Fake SOAP</p>',
    }], [], []);
    expect(chart.checkInComplaint).toBe(triage.chiefComplaint);
    expect(chart.chiefComplaint).toBe('<p>Fake SOAP</p>');
    expect(status(await client.readResource('Encounter', first))).toBe('meds_and_bills');

    await completeQueueVisit(client, clinic, fakePatient.id, id);
    const finished = await client.readResource('Encounter', first);
    expect(status(finished)).toBe('completed');
    expect(finished.period?.end).toBeTruthy();
    const second = await saveTriageEncounter(fakePatient.id, { ...triage, chiefComplaint: 'Fake second visit' }, client, clinic);
    expect(second).not.toBe(first);

    await completeQueueVisit(client, clinic, fakePatient.id, id);
    expect(status(await client.readResource('Encounter', second))).toBe('waiting');
    expect((await client.readResource('Encounter', first)).period?.end).toBe(finished.period?.end);
  });

  test('legacy checkout skips any visit that started after consultation signing', async () => {
    const makeVisit = (id: string, start: string) => ({
      resourceType: 'Encounter', id, subject: { reference: patientRef }, identifier: clinicTag,
      status: 'finished', period: { start },
      extension: [{ url: extension, extension: [{ url: 'queueStatus', valueString: 'meds_and_bills' }] }],
    });
    const { client } = fakeClient([
      makeVisit('first', '2026-11-26T01:00:00Z'),
      makeVisit('second', '2026-11-26T03:00:00Z'),
      { resourceType: 'Encounter', id: 'legacy', subject: { reference: patientRef }, identifier: clinicTag,
        status: 'finished', period: { start: '2026-11-26T02:00:00Z' } },
    ]);
    await completeQueueVisit(client, clinic, fakePatient.id, 'legacy');
    expect(status(await client.readResource('Encounter', 'first'))).toBe('completed');
    expect(status(await client.readResource('Encounter', 'second'))).toBe('meds_and_bills');
  });
});

test('registration allergies round-trip through a clinic account and are isolated from foreign allergies', async () => {
  const { db, client } = fakeClient();
  db.onSetAccounts = (path) => {
    const key = path.replace('fhir/R4/', '').replace('/$set-accounts', '');
    const resource = db.db.get(key);
    if (resource) resource.meta.accounts = [{ reference: 'HealthcareService/hs-clinic-a' }];
  };
  const id = await savePatientToMedplum({
    fullName: 'Fake Allergy Patient', nric: '920301-14-9808', dateOfBirth: '1992-03-01',
    gender: 'male', phone: '0100001008', address: 'Fake address',
    medicalHistory: { allergies: [' Penicillin '], conditions: [], medications: [] },
  }, clinic, client);
  const allergy = [...db.db.values()].find((resource) => resource.resourceType === 'AllergyIntolerance');
  expect(allergy.identifier).toEqual(clinicTag);
  expect(allergy.patient.reference).toBe(`Patient/${id}`);
  db.db.set('AllergyIntolerance/foreign', { ...allergy, id: 'foreign', code: { text: 'Other clinic allergy' }, identifier: [{ system: 'clinic', value: 'clinic-b' }] });
  expect((await getPatientFromMedplum(id, clinic, client))?.medicalHistory?.allergies).toEqual(['Penicillin']);
});

test('repeated catalog clicks preserve the line id and clinical instructions while increasing quantity', () => {
  const initial: TreatmentPlanEntry = {
    id: 'first', catalogRef: 'p-1', tab: 'items', name: 'Fake item', dosage: 'QA fake',
    unitPrice: 2.5, quantity: 1, lineTotal: 2.5, createdAt: 'first', updatedAt: 'first',
  };
  const candidate = { ...initial, id: 'second', updatedAt: 'second' };
  const { entries, entry } = addTreatmentCatalogEntry([initial], candidate);
  expect(entries).toEqual([entry]);
  expect(entry).toMatchObject({ id: 'first', dosage: 'QA fake', quantity: 2, lineTotal: 5, updatedAt: 'second' });
  expect(addTreatmentCatalogEntry(entries, { ...candidate, catalogRef: 'p-2' }).entries).toHaveLength(2);
  expect(addTreatmentCatalogEntry([{ ...initial, tab: 'documents' }], { ...candidate, tab: 'documents' }).entries).toHaveLength(2);
});

test('ordinary lab order form labels the order as laboratory testing', () => {
  const html = renderToStaticMarkup(createElement(LabOrderForm, { patientId: 'fake-patient' }));
  expect(html).toContain('Select laboratory tests and specify the order priority.');
  expect(html).not.toContain('Point-of-Care Testing');
});

describe('lab subscription polling', () => {
  const fetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = fetch; });

  test('a quiet no-content response preserves displayed results and does not parse a binding', async () => {
    let settle!: () => void;
    const connected = new Promise<void>((resolve) => { settle = resolve; });
    const onResults = spyOn({ call() {} }, 'call');
    const onError = spyOn({ call() {} }, 'call');
    const response = new Response(null, { status: 204 });
    const parseBinding = spyOn(response, 'json');
    globalThis.fetch = (async (url: string) => url.includes('/subscription')
      ? response
      : Response.json({ reports: [], poctEnabled: true })) as typeof globalThis.fetch;
    const polling = startLabResultUpdates({
      patientId: 'fake-patient', onResults, onError, onLoaded() {}, onLiveStatus: (live) => {
        expect(live).toBe(false);
        settle();
      },
    });
    try {
      await connected;
      expect(onResults).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(parseBinding).not.toHaveBeenCalled();
    } finally {
      polling.stop();
    }
  });
});

test.each([
  ['app/(routes)/patients/new-v1/new-patient-form-v1.tsx', 'sonnerToast.success("Patient registered")'],
  ['components/triage/triage-form.tsx', 'sonnerToast.success(stayAfterSubmit ? "Check-in details saved" : "Check-in complete")'],
  ['app/(routes)/patients/[id]/patient-profile-workspace.tsx', 'sonnerToast.success("Consult signed")'],
  ['app/(routes)/orders/checkout/[consultationId]/checkout-client.tsx', 'toast.success("Visitation completed")'],
])('the success handler in %s calls the mounted Sonner toaster', async (file, call) => {
  const source = await Bun.file(new URL(`../../${file}`, import.meta.url)).text();
  expect(source).toMatch(/import \{ toast(?: as sonnerToast)? \} from "sonner"/);
  expect(source).toContain(call);
});
