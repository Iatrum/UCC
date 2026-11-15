import { describe, expect, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import type { DocumentReference } from '@medplum/fhirtypes';
import { clearDraft, draftValue, readDraft, writeDraft, type DraftScope } from '../../lib/fhir/consultation-draft';

function fixture() {
  let doc: DocumentReference | undefined;
  const updates: any[] = [];
  const scope: DraftScope = {
    clinicId: 'fake-clinic-a', patientId: 'fake-patient', practitioner: 'Practitioner/fake-doctor', draftId: 'consult-note',
    medplum: {
      searchOne: async () => doc,
      createResourceIfNoneExist: async (resource: DocumentReference) => {
        doc = { ...resource, id: 'fake-draft', meta: { versionId: 'fake-v1' } }; return doc;
      },
      updateResource: async (resource: DocumentReference, options: unknown) => {
        updates.push({ resource, options }); doc = resource; return resource;
      },
    } as unknown as MedplumClient,
  };
  return { scope, updates, setDoc: (value: DocumentReference) => { doc = value; } };
}
describe('unsigned draft ownership and lifecycle', () => {
  test('every lookup rejects foreign clinic, patient and practitioner even if search returns a document', async () => {
    const { scope } = fixture();
    await writeDraft(scope, { clinicalNotes: 'Fake note' });
    for (const override of [{ clinicId: 'fake-other' }, { patientId: 'fake-other' }, { practitioner: 'Practitioner/fake-other' }, { draftId: 'other-draft' }]) {
      await expect(readDraft({ ...scope, ...override })).rejects.toThrow('Draft unavailable');
    }
  });
  test('edits and clear use version preconditions; cleared drafts never hydrate historical text', async () => {
    const { scope, updates } = fixture();
    const original = await writeDraft(scope, { clinicalNotes: 'Fake draft' });
    expect(original.identifier).toContainEqual({ system: 'clinic', value: scope.clinicId });
    await writeDraft(scope, { clinicalNotes: 'Fake edit' }, original);
    expect(updates[0].options.headers['If-Match']).toBe('W/"fake-v1"');
    await expect(clearDraft(scope, 'wrong-version')).rejects.toThrow('Draft changed');
    expect(updates).toHaveLength(1);
    await clearDraft(scope, 'fake-v1');
    expect(updates[1].options.headers['If-Match']).toBe('W/"fake-v1"');
    expect(draftValue(await readDraft(scope), { clinicalNotes: '' })).toEqual({ clinicalNotes: '' });
  });
});
