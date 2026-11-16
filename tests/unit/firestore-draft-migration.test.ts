import { describe, expect, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import type { DocumentReference } from '@medplum/fhirtypes';
import { draftValue, readDraft, writeDraft, clearDraft, type DraftScope } from '../../lib/fhir/consultation-draft';
import {
  EXPORT_FORMAT, KEY_SYSTEM, LEGACY_COLLECTION, MANIFEST_FORMAT, MIGRATED_SYSTEM, ROLLED_BACK_SYSTEM, PreconditionError,
  assertAllowedBaseUrl, draftKey, migrate, parseExport, rollback, sanitizeEntries, sourceHash, summarize, toExportRecord,
  type FhirClient, type LegacyDraft, type Manifest, type Resource,
} from '../../scripts/firestore-draft-migration/core';

// Fake data only: every id, name and value below is invented.
const CLINIC = 'fake-clinic-a';
const PATIENT = 'fake-patient-1';
const ENCOUNTER = 'fake-encounter-1';
const DOCTOR = 'fake-doctor-1';
const ACCOUNT = 'Organization/fake-clinic-a-account';
const LEGACY_ID = `profile-treatment-${PATIENT}-${ENCOUNTER}`;
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'fake-entry-1', tab: 'items', name: 'Fake Paracetamol 500mg', quantity: 2, unitPrice: 1.5, lineTotal: 3,
  dosage: '1 tab', createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '2026-11-01T02:00:00.000Z', ...over,
});
const legacy = (over: Partial<LegacyDraft> = {}): LegacyDraft => ({
  id: LEGACY_ID, draftId: LEGACY_ID, clinicId: CLINIC, patientId: PATIENT, consultationId: ENCOUNTER,
  entries: [entry()], createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '2026-11-01T02:00:00.000Z', ...over,
});

/** In-memory FHIR store with conditional create, version-pinned update and account inheritance from the patient. */
function fakeServer(options: { inheritAccounts?: boolean } = {}) {
  const store = new Map<string, Resource>();
  const writes: string[] = [];
  let version = 0;
  const put = (resource: Resource) => {
    const saved = structuredClone({ ...resource, meta: { ...resource.meta, versionId: `v${++version}` } });
    store.set(`${saved.resourceType}/${saved.id}`, saved);
    return structuredClone(saved);
  };
  const clinic = [{ system: 'clinic', value: CLINIC }];
  put({ resourceType: 'Patient', id: PATIENT, identifier: clinic, meta: { accounts: [{ reference: ACCOUNT }] } });
  put({ resourceType: 'Patient', id: 'fake-patient-b', identifier: [{ system: 'clinic', value: 'fake-clinic-b' }] });
  put({ resourceType: 'Practitioner', id: DOCTOR, active: true });
  put({ resourceType: 'Practitioner', id: 'fake-doctor-2', active: true });
  put({ resourceType: 'Practitioner', id: 'fake-doctor-left', active: false });
  put({ resourceType: 'Encounter', id: ENCOUNTER, identifier: clinic, subject: { reference: `Patient/${PATIENT}` },
    participant: [{ individual: { reference: `Practitioner/${DOCTOR}` } }] });
  const drafts = () => [...store.values()].filter(r => r.resourceType === 'DocumentReference');
  const client: FhirClient = {
    read: async (type, id) => structuredClone(store.get(`${type}/${id}`)),
    search: async (_type, params) => {
      const [system, value] = params.identifier.split('|');
      return structuredClone(drafts().filter(d => d.identifier?.some(i => i.system === system && i.value === value)));
    },
    create: async (resource, ifNoneExist) => {
      const existing = await client.search('DocumentReference', { identifier: ifNoneExist.replace('identifier=', '') });
      if (existing[0]) return existing[0];
      writes.push('create');
      const patient = store.get(resource.subject?.reference ?? '');
      return put({ ...resource, id: `fake-draft-${drafts().length + 1}`,
        meta: options.inheritAccounts === false ? {} : { accounts: patient?.meta?.accounts } });
    },
    update: async (resource, ifMatch) => {
      const current = store.get(`DocumentReference/${resource.id}`);
      if (!current || current.meta?.versionId !== ifMatch) throw new PreconditionError('version moved');
      writes.push('update');
      return put({ ...resource, meta: { ...current.meta } });
    },
  };
  /** The real application draft layer running against the same store, as the given practitioner. */
  const appScope = (practitioner = DOCTOR, over: Partial<DraftScope> = {}): DraftScope => ({
    clinicId: CLINIC, patientId: PATIENT, consultationId: ENCOUNTER, draftId: LEGACY_ID, practitioner: `Practitioner/${practitioner}`,
    medplum: {
      searchOne: async (_t: string, params: Record<string, string>) =>
        (await client.search('DocumentReference', { identifier: params.identifier }))[0],
      createResourceIfNoneExist: (resource: Resource, query: string) => client.create(resource, decodeURIComponent(query)),
      updateResource: (resource: Resource, o: { headers: Record<string, string> }) =>
        client.update(resource, o.headers['If-Match'].replace(/^W\/"|"$/g, '')),
    } as unknown as MedplumClient,
    ...over,
  });
  return { client, store, put, writes, drafts, appScope };
}
const run = (server: ReturnType<typeof fakeServer>, drafts: LegacyDraft[], over = {}) =>
  migrate(server.client, drafts, { clinicId: CLINIC, apply: true, ...over });
const manifestOf = (entries: Manifest['entries']): Manifest => ({ format: MANIFEST_FORMAT, clinicId: CLINIC, createdAt: 'fake', entries });

describe('legacy Firestore draft migration: mapping', () => {
  test('dry-run is the default and writes nothing', async () => {
    const server = fakeServer();
    const result = await migrate(server.client, [legacy()], { clinicId: CLINIC });
    expect(result.outcomes[0]).toMatchObject({ action: 'create', reason: 'new', applied: false });
    expect(server.writes).toEqual([]);
    expect(result.manifest).toEqual([]);
  });

  test('a migrated draft is read back by the real application draft layer for the encounter practitioner only', async () => {
    const server = fakeServer();
    const result = await run(server, [legacy()]);
    expect(result.outcomes[0]).toMatchObject({ action: 'create', applied: true });
    const doc = await readDraft(server.appScope());
    expect(doc?.docStatus).toBe('preliminary');
    expect(doc?.date).toBe('2026-11-01T02:00:00.000Z');
    expect(doc?.context?.encounter?.[0].reference).toBe(`Encounter/${ENCOUNTER}`);
    expect(draftValue<any[]>(doc, [])).toEqual([entry()]);
    // Another doctor in the same clinic derives a different key and sees no draft.
    expect(await readDraft(server.appScope('fake-doctor-2'))).toBeUndefined();
    expect(server.drafts()[0].meta?.accounts).toEqual([{ reference: ACCOUNT }]);
  });

  test('key derivation matches the application for visit and pending drafts', async () => {
    for (const consultationId of [ENCOUNTER, undefined]) {
      const server = fakeServer();
      const scope = server.appScope(DOCTOR, { consultationId });
      const written = await writeDraft(scope, []);
      expect(written.identifier).toContainEqual({ system: KEY_SYSTEM,
        value: draftKey(CLINIC, `Practitioner/${DOCTOR}`, PATIENT, consultationId, LEGACY_ID) });
    }
  });

  test('pending drafts have no derivable owner and need the operator owners file', async () => {
    const pendingId = `profile-treatment-${PATIENT}-pending`;
    const pending = legacy({ id: pendingId, draftId: pendingId, consultationId: undefined });
    const server = fakeServer();
    expect((await run(server, [pending])).outcomes[0]).toMatchObject({ action: 'skip', reason: 'owner-unresolved' });
    expect((await run(server, [pending], { owners: { [pendingId]: 'fake-doctor-left' } })).outcomes[0].reason).toBe('owner-missing-or-inactive');
    expect((await run(server, [pending], { owners: { [pendingId]: '../etc' } })).outcomes[0].reason).toBe('invalid-owner-map-entry');
    expect((await run(server, [pending], { owners: { [pendingId]: 'fake-doctor-2' } })).outcomes[0]).toMatchObject({ action: 'create', applied: true });
    const doc = await readDraft(server.appScope('fake-doctor-2', { draftId: pendingId, consultationId: undefined }));
    expect(draftValue<any[]>(doc, [])).toHaveLength(1);
    expect(doc?.context).toBeUndefined();
  });

  test('entries are reduced to known fields, totals recomputed, malformed entries refuse the whole draft', () => {
    const clean = sanitizeEntries([entry({ lineTotal: 999, secret: 'dropped', meta: { kind: 'poct', code: 'fake' } })], 'fake-now');
    expect(clean).toEqual([{ ...entry(), meta: { kind: 'poct', code: 'fake' } }]);
    expect(sanitizeEntries([entry({ createdAt: undefined, updatedAt: 5 })], 'fake-now')?.[0]).toMatchObject({ createdAt: 'fake-now', updatedAt: 'fake-now' });
    for (const bad of [{ tab: 'labs' }, { name: ' ' }, { quantity: -1 }, { unitPrice: '2' }, { id: '' }, { dosage: 5 }, { meta: { nested: {} } }, { quantity: Infinity }]) {
      expect(sanitizeEntries([entry(bad)], 'fake-now')).toBeUndefined();
    }
    expect(sanitizeEntries([entry(), entry()], 'fake-now')).toBeUndefined(); // duplicate entry ids
    expect(sanitizeEntries('nope', 'fake-now')).toBeUndefined();
  });
});

describe('legacy Firestore draft migration: refusals', () => {
  const cases: [string, Partial<LegacyDraft>, string][] = [
    ['cleared draft', { entries: [] }, 'empty'],
    ['missing entries', { entries: undefined }, 'empty'],
    ['draft of another clinic', { clinicId: 'fake-clinic-b' }, 'other-clinic'],
    ['patient of another clinic', { id: 'profile-treatment-fake-patient-b-pending', draftId: undefined, patientId: 'fake-patient-b', consultationId: undefined }, 'patient-clinic-mismatch'],
    ['no clinic field and patient elsewhere', { id: 'profile-treatment-fake-patient-b-pending', draftId: undefined, clinicId: undefined, patientId: 'fake-patient-b', consultationId: undefined }, 'other-clinic'],
    ['old consultation-<id> key no screen reads', { id: `consultation-${ENCOUNTER}`, draftId: undefined }, 'unreachable-draft-id'],
    ['old patient-<id> key', { id: `patient-${PATIENT}`, draftId: undefined }, 'unreachable-draft-id'],
    ['draftId field disagrees with document id', { draftId: 'something-else' }, 'inconsistent-draft-id'],
    ['consultation field disagrees with id', { consultationId: 'fake-encounter-9' }, 'inconsistent-consultation'],
    ['unsafe patient id', { patientId: 'x/../y' }, 'invalid-patient-id'],
    ['unknown patient', { id: 'profile-treatment-fake-gone-pending', draftId: undefined, patientId: 'fake-gone', consultationId: undefined }, 'patient-missing'],
    ['unknown encounter', { id: `profile-treatment-${PATIENT}-fake-enc-gone`, draftId: undefined, consultationId: undefined }, 'encounter-missing'],
    ['malformed entry', { entries: [entry({ tab: 'bogus' })] }, 'invalid-entries'],
  ];
  for (const [name, over, reason] of cases) {
    test(`${name} -> ${reason}`, async () => {
      const server = fakeServer();
      const result = await run(server, [legacy(over)]);
      expect(result.outcomes[0]).toMatchObject({ action: 'skip', reason });
      expect(server.writes).toEqual([]);
    });
  }

  test('encounter of another patient or clinic, and missing or multiple practitioners', async () => {
    const check = async (encounter: Partial<Resource>, reason: string, owners?: Record<string, string>) => {
      const server = fakeServer();
      server.put({ ...server.store.get(`Encounter/${ENCOUNTER}`)!, ...encounter });
      const result = await run(server, [legacy()], { owners });
      expect(result.outcomes[0].reason).toBe(reason);
      return server;
    };
    await check({ subject: { reference: 'Patient/fake-patient-b' } }, 'encounter-patient-mismatch');
    await check({ identifier: [{ system: 'clinic', value: 'fake-clinic-b' }] }, 'encounter-clinic-mismatch');
    await check({ identifier: [] }, 'encounter-clinic-mismatch');
    await check({ participant: [] }, 'owner-unresolved');
    await check({ participant: [{ individual: { reference: 'RelatedPerson/fake-relative' } }] }, 'owner-unresolved');
    const two = [{ individual: { reference: `Practitioner/${DOCTOR}` } }, { individual: { reference: 'Practitioner/fake-doctor-2' } }];
    await check({ participant: two }, 'owner-ambiguous');
    const server = await check({ participant: two }, 'new', { [LEGACY_ID]: 'fake-doctor-2' });
    expect(server.drafts()[0].author).toEqual([{ reference: 'Practitioner/fake-doctor-2' }]);
  });

  test('encounter without a practitioner: last-writer fallback is opt-in and otherwise only a reviewed candidate', async () => {
    const setup = (author?: string) => {
      const server = fakeServer();
      const encounter = server.store.get(`Encounter/${ENCOUNTER}`)!;
      server.put({ ...encounter, participant: undefined, meta: { ...encounter.meta, author: author ? { reference: author } : undefined } });
      return server;
    };
    const plain = await run(setup(`Practitioner/${DOCTOR}`), [legacy()]);
    expect(plain.outcomes[0]).toMatchObject({ action: 'skip', reason: 'owner-unresolved', candidateOwner: DOCTOR });
    const server = setup(`Practitioner/${DOCTOR}`);
    const opted = await run(server, [legacy()], { ownerFromEncounterAuthor: true });
    expect(opted.outcomes[0]).toMatchObject({ action: 'create', applied: true, ownerSource: 'encounter-author' });
    expect(draftValue<any[]>(await readDraft(server.appScope()), [])).toHaveLength(1);
    // A server-side writer (ClientApplication) is never an owner.
    const bot = await run(setup('ClientApplication/fake-app'), [legacy()], { ownerFromEncounterAuthor: true });
    expect(bot.outcomes[0]).toMatchObject({ action: 'skip', reason: 'owner-unresolved' });
    expect(bot.outcomes[0].candidateOwner).toBeUndefined();
    // The owners file and an Encounter participant both take precedence over the fallback.
    const mapped = setup(`Practitioner/${DOCTOR}`);
    expect((await run(mapped, [legacy()], { ownerFromEncounterAuthor: true, owners: { [LEGACY_ID]: 'fake-doctor-2' } })).outcomes[0].ownerSource).toBe('owners-file');
    expect(mapped.drafts()[0].author).toEqual([{ reference: 'Practitioner/fake-doctor-2' }]);
    expect((await run(fakeServer(), [legacy()], { ownerFromEncounterAuthor: true })).outcomes[0].ownerSource).toBe('encounter-participant');
  });

  test('--since skips older and undated drafts; --limit caps writes', async () => {
    const since = new Date('2026-11-10T00:00:00Z');
    const server = fakeServer();
    expect((await run(server, [legacy()], { since })).outcomes[0].reason).toBe('older-than-since');
    expect((await run(server, [legacy({ updatedAt: undefined })], { since })).outcomes[0].reason).toBe('no-timestamp');
    expect((await run(server, [legacy({ updatedAt: '2026-11-12T00:00:00Z' })], { since })).outcomes[0].applied).toBe(true);
    const other = fakeServer();
    const pendingId = `profile-treatment-${PATIENT}-pending`;
    const limited = await run(other, [legacy(), legacy({ id: pendingId, draftId: pendingId, consultationId: undefined }), legacy()],
      { limit: 1, owners: { [pendingId]: DOCTOR } });
    expect(limited.outcomes.map(o => o.reason)).toEqual(['new', 'limit-reached', 'duplicate-in-export']);
    expect(other.writes).toEqual(['create']);
  });
});

describe('legacy Firestore draft migration: idempotency and clinician work', () => {
  test('a second apply changes nothing', async () => {
    const server = fakeServer();
    await run(server, [legacy()]);
    const before = structuredClone(server.drafts());
    const again = await run(server, [legacy()]);
    expect(again.outcomes[0]).toMatchObject({ action: 'skip', reason: 'already-migrated' });
    expect(again.manifest).toEqual([]);
    expect(server.drafts()).toEqual(before);
    expect(server.writes).toEqual(['create']);
  });

  test('a draft the clinician saved after rollout is never overwritten', async () => {
    const server = fakeServer();
    await writeDraft(server.appScope(), [entry({ name: 'Fake newer item' })]);
    expect((await run(server, [legacy()])).outcomes[0]).toMatchObject({ action: 'skip', reason: 'target-has-newer-draft' });
    expect(draftValue<any[]>(await readDraft(server.appScope()), [])[0].name).toBe('Fake newer item');
  });

  test('a draft the clinician cleared (sign or clear all) is not resurrected, before or after editing it', async () => {
    const server = fakeServer();
    await run(server, [legacy()]);
    await clearDraft(server.appScope()); // cleared while still carrying the migration marker
    expect((await run(server, [legacy()])).outcomes[0].reason).toBe('target-cleared-by-user');
    const edited = fakeServer();
    await run(edited, [legacy()]);
    await writeDraft(edited.appScope(), [entry({ name: 'Fake edit' })], await readDraft(edited.appScope()));
    expect((await run(edited, [legacy()])).outcomes[0].reason).toBe('target-has-newer-draft');
    await clearDraft(edited.appScope());
    expect((await run(edited, [legacy()])).outcomes[0].reason).toBe('target-cleared-by-user');
    expect(draftValue<any[]>(await readDraft(edited.appScope()), [])).toEqual([]);
  });

  test('a clinician saving between plan and write wins the conditional create', async () => {
    const server = fakeServer();
    const search = server.client.search;
    let raced = false;
    server.client.search = async (type, params) => {
      const found = await search(type, params);
      if (!raced) { raced = true; await writeDraft(server.appScope(), [entry({ name: 'Fake racing item' })]); }
      return found;
    };
    const result = await run(server, [legacy()]);
    expect(result.outcomes[0]).toMatchObject({ action: 'skip', reason: 'target-has-newer-draft' });
    expect(result.manifest).toEqual([]);
  });

  test('a document under the same key with a different author or patient is a conflict, not a target', async () => {
    const server = fakeServer();
    const key = draftKey(CLINIC, `Practitioner/${DOCTOR}`, PATIENT, ENCOUNTER, LEGACY_ID);
    server.put({ resourceType: 'DocumentReference', id: 'fake-odd', status: 'current', subject: { reference: `Patient/${PATIENT}` },
      author: [{ reference: 'Practitioner/fake-doctor-2' }], identifier: [{ system: 'clinic', value: CLINIC }, { system: KEY_SYSTEM, value: key }] });
    expect((await run(server, [legacy()])).outcomes[0].reason).toBe('target-conflict');
  });

  test('aborts and undoes the draft when the server does not place it in the patient clinic account', async () => {
    const server = fakeServer({ inheritAccounts: false });
    const second = `profile-treatment-${PATIENT}-pending`;
    const result = await run(server, [legacy(), legacy({ id: second, draftId: second, consultationId: undefined })], { owners: { [second]: DOCTOR } });
    expect(result.aborted).toBe('clinic-account-mismatch-undone');
    expect(result.outcomes).toHaveLength(1);
    expect(result.manifest).toEqual([]);
    expect(draftValue<any[]>(await readDraft(server.appScope()), [])).toEqual([]);
    expect(server.drafts()).toHaveLength(1);
  });
});

describe('legacy Firestore draft migration: rollback', () => {
  test('rollback is dry-run by default, then clears exactly what was migrated, and is repeatable', async () => {
    const server = fakeServer();
    const { manifest } = await run(server, [legacy()]);
    const dry = await rollback(server.client, manifestOf(manifest), { clinicId: CLINIC });
    expect(dry[0]).toMatchObject({ action: 'rollback', applied: false });
    expect(draftValue<any[]>(await readDraft(server.appScope()), [])).toHaveLength(1);
    const done = await rollback(server.client, manifestOf(manifest), { clinicId: CLINIC, apply: true });
    expect(done[0]).toMatchObject({ action: 'rollback', applied: true });
    const doc = await readDraft(server.appScope());
    expect(doc?.status).toBe('superseded');
    expect(doc?.content[0].attachment.data).toBe('e30=');
    expect(draftValue<any[]>(doc, [])).toEqual([]);
    expect(doc?.identifier).toContainEqual({ system: ROLLED_BACK_SYSTEM, value: sourceHash(LEGACY_ID) });
    const again = await rollback(server.client, manifestOf(manifest), { clinicId: CLINIC, apply: true });
    expect(again[0]).toMatchObject({ action: 'skip', reason: 'already-rolled-back' });
  });

  test('rollback keeps drafts a clinician edited or cleared', async () => {
    const server = fakeServer();
    const { manifest } = await run(server, [legacy()]);
    await writeDraft(server.appScope(), [entry({ name: 'Fake edit' })], await readDraft(server.appScope()));
    const result = await rollback(server.client, manifestOf(manifest), { clinicId: CLINIC, apply: true });
    expect(result[0]).toMatchObject({ action: 'skip', reason: 'changed-by-clinician-kept' });
    expect(draftValue<any[]>(await readDraft(server.appScope()), [])[0].name).toBe('Fake edit');
    const cleared = fakeServer();
    const second = await run(cleared, [legacy()]);
    await clearDraft(cleared.appScope());
    expect((await rollback(cleared.client, manifestOf(second.manifest), { clinicId: CLINIC, apply: true }))[0].reason).toBe('changed-by-clinician-kept');
  });

  test('an edit landing during rollback wins (version precondition)', async () => {
    const server = fakeServer();
    const { manifest } = await run(server, [legacy()]);
    const update = server.client.update;
    server.client.update = async () => { throw new PreconditionError('version moved'); };
    expect((await rollback(server.client, manifestOf(manifest), { clinicId: CLINIC, apply: true }))[0].reason).toBe('changed-by-clinician-kept');
    server.client.update = update;
  });

  test('re-applying after a rollback restores the draft, and the clinician can use the rolled-back slot in between', async () => {
    const server = fakeServer();
    const first = await run(server, [legacy()]);
    await rollback(server.client, manifestOf(first.manifest), { clinicId: CLINIC, apply: true });
    const second = await run(server, [legacy()]);
    expect(second.outcomes[0]).toMatchObject({ action: 'restore', reason: 'previously-rolled-back', applied: true });
    const doc = await readDraft(server.appScope());
    expect(draftValue<any[]>(doc, [])).toEqual([entry()]);
    expect(doc?.identifier?.some(i => i.system === ROLLED_BACK_SYSTEM)).toBe(false);
    expect(doc?.identifier).toContainEqual({ system: MIGRATED_SYSTEM, value: sourceHash(LEGACY_ID) });
    expect(server.drafts()).toHaveLength(1);
    // Rolled back again, then the clinician starts a fresh draft in that slot: a later apply must leave it alone.
    await rollback(server.client, manifestOf(second.manifest), { clinicId: CLINIC, apply: true });
    await writeDraft(server.appScope(), [entry({ name: 'Fake fresh' })], await readDraft(server.appScope()));
    expect((await run(server, [legacy()])).outcomes[0].reason).toBe('target-has-newer-draft');
  });

  test('rollback refuses a foreign manifest and a document that is not the recorded draft', async () => {
    const server = fakeServer();
    const { manifest } = await run(server, [legacy()]);
    await expect(rollback(server.client, { ...manifestOf(manifest), clinicId: 'fake-clinic-b' }, { clinicId: CLINIC })).rejects.toThrow('different clinic');
    await expect(rollback(server.client, { ...manifestOf(manifest), format: 'x' }, { clinicId: CLINIC })).rejects.toThrow('manifest format');
    const forged = manifestOf([{ ...manifest[0], key: 'fake-other-key' }]);
    expect((await rollback(server.client, forged, { clinicId: CLINIC, apply: true }))[0]).toMatchObject({ action: 'error', reason: 'not-the-recorded-draft' });
    const gone = manifestOf([{ ...manifest[0], documentReferenceId: 'fake-missing' }]);
    expect((await rollback(server.client, gone, { clinicId: CLINIC, apply: true }))[0].reason).toBe('already-gone');
    expect(server.writes).toEqual(['create']);
  });
});

describe('legacy Firestore draft migration: export and guards', () => {
  test('Firestore documents become export records with ISO timestamps and only needed fields', () => {
    const timestamp = { toDate: () => new Date('2026-11-01T02:00:00Z') };
    const record = toExportRecord(LEGACY_ID, { draftId: LEGACY_ID, clinicId: CLINIC, patientId: PATIENT, consultationId: ENCOUNTER,
      entries: [entry()], summary: { total: 3 }, createdAt: timestamp, updatedAt: timestamp, unexpected: 'dropped' });
    expect(record).toEqual(legacy());
    expect(toExportRecord('x', { updatedAt: 'not a date' }).updatedAt).toBeUndefined();
  });

  test('export file must be complete and of the expected collection', () => {
    const file = { format: EXPORT_FORMAT, collection: LEGACY_COLLECTION, exportedAt: 'fake', count: 1, drafts: [legacy()] };
    expect(parseExport(file).drafts).toHaveLength(1);
    for (const bad of [{ ...file, count: 2 }, { ...file, format: 'other' }, { ...file, collection: 'consultations' }, { ...file, drafts: {} }, null]) {
      expect(() => parseExport(bad)).toThrow('Not a complete');
    }
  });

  test('only local dev Medplum unless the exact remote https host is named', () => {
    expect(assertAllowedBaseUrl('http://localhost:8113').host).toBe('localhost:8113');
    expect(assertAllowedBaseUrl('http://127.0.0.1:8113/').port).toBe('8113');
    expect(assertAllowedBaseUrl('https://fake-medplum.example', 'fake-medplum.example').hostname).toBe('fake-medplum.example');
    for (const [url, host] of [['https://fake-medplum.example', undefined], ['https://fake-medplum.example', 'other.example'],
      ['http://fake-medplum.example', 'fake-medplum.example'], ['http://localhost:9999', undefined],
      ['https://user:pw@fake-medplum.example', 'fake-medplum.example'], ['not a url', undefined]] as const) {
      expect(() => assertAllowedBaseUrl(url, host)).toThrow();
    }
  });

  test('summary counts by action and reason without identifiers', () => {
    expect(summarize([{ action: 'skip', reason: 'empty' }, { action: 'skip', reason: 'empty' }, { action: 'create', reason: 'new', applied: true }]))
      .toEqual({ 'create:new (written)': 1, 'skip:empty': 2 });
  });
});
