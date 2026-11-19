import { describe, expect, mock, test } from 'bun:test';
import {
  buildAppointmentReminderMessage, buildReviewRequestMessage, buildWhatsAppUrl, createFollowUp, deleteFollowUp,
  getAllFollowUps, markFollowUpOpened, normalizeWhatsAppPhone, renderFollowUpTemplate, updateFollowUpStatus,
  getFollowUpClinicId,
} from '../../lib/fhir/communication-service';
import { isFollowUpReminderTask, mapFollowUpToReminderTask, mapFollowUpsToReminderTasks, sortUnifiedTasks, mapBillingTaskToUnifiedTask } from '../../lib/fhir/task-reminder-service';

const CAT = 'https://ucc.emr/communication-category';
const comm = (id: string, clinic: string, extra: any = {}) => ({
  resourceType: 'Communication', id, status: 'preparation',
  identifier: [{ system: 'clinic', value: clinic }, ...(extra.identifier ?? [])],
  extension: [{ url: 'https://ucc.emr/communication/clinic-id', valueString: clinic }],
  category: [{ coding: [{ system: extra.catSystem ?? undefined, code: 'review-request' }] }],
  ...extra.rest,
});

describe('Task 682: follow-up clinic scoping (service layer)', () => {
  test('update / open / delete of another clinic or an untagged follow-up is a 404 and writes nothing', async () => {
    for (const stored of [comm('f1', 'clinic-b'), { resourceType: 'Communication', id: 'f1', status: 'preparation' }]) {
      const client: any = { readResource: mock(async () => stored), updateResource: mock(async (r: any) => r), deleteResource: mock(async () => {}) };
      await expect(updateFollowUpStatus(client, 'f1', 'completed', 'clinic-a')).rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(markFollowUpOpened(client, 'f1', 'clinic-a')).rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(deleteFollowUp(client, 'f1', 'clinic-a')).rejects.toMatchObject({ name: 'NotFoundError' });
      expect(client.updateResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    }
  });

  test('missing caller clinic is 403 (fail closed)', async () => {
    const client: any = { readResource: async () => comm('f1', 'clinic-a'), updateResource: mock(async (r: any) => r), deleteResource: mock(async () => {}) };
    await expect(deleteFollowUp(client, 'f1', undefined)).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(updateFollowUpStatus(client, 'f1', 'stopped')).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(client.deleteResource).not.toHaveBeenCalled();
  });

  test('own-clinic status transitions map delivery status and replace (not duplicate) extensions', async () => {
    const client: any = { readResource: async () => comm('f1', 'clinic-a'), updateResource: mock(async (r: any) => r) };
    const done = await updateFollowUpStatus(client, 'f1', 'completed', 'clinic-a');
    expect(done).toMatchObject({ status: 'completed', deliveryStatus: 'completed', clinicId: 'clinic-a' });
    expect(done.sentConfirmedAt).toBeTruthy();
    expect(client.updateResource.mock.calls[0][0].sent).toBeTruthy();
    const stopped = await updateFollowUpStatus(client, 'f1', 'stopped', 'clinic-a');
    expect(stopped.deliveryStatus).toBe('failed');
    const prep = await updateFollowUpStatus(client, 'f1', 'in-progress', 'clinic-a');
    expect(prep.deliveryStatus).toBe('pending');
    expect(client.updateResource.mock.calls[2][0].sent).toBeUndefined();
    const opened = await markFollowUpOpened(client, 'f1', 'clinic-a');
    expect(opened.deliveryStatus).toBe('opened');
    expect(opened.openedAt).toBeTruthy();
    const urls = client.updateResource.mock.calls[0][0].extension.map((e: any) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(getFollowUpClinicId(client.updateResource.mock.calls[0][0])).toBe('clinic-a');
  });

  test('getAllFollowUps searches by clinic identifier and drops non follow-up / foreign-extension rows', async () => {
    const good = comm('a', 'clinic-a', { catSystem: CAT });
    const foreignExt = comm('b', 'clinic-b', { catSystem: CAT });
    const notFollowUp = comm('c', 'clinic-a', { catSystem: 'other' });
    const search = mock(async () => [good, foreignExt, notFollowUp]);
    const out = await getAllFollowUps({ searchResources: search } as any, 'clinic-a');
    expect(search.mock.calls[0][1]).toMatchObject({ identifier: 'clinic|clinic-a' });
    expect(out.map(f => f.id)).toEqual(['a']);
    // without clinic: no identifier filter (admin-only callers)
    const all = await getAllFollowUps({ searchResources: mock(async () => [good, foreignExt]) } as any);
    expect(all.map(f => f.id)).toEqual(['a', 'b']);
  });

  test('createFollowUp: same source in ANOTHER clinic is not treated as a duplicate; same clinic is deduped', async () => {
    const sourceId = { system: 'https://ucc.emr/follow-up/source', value: 'checkout:C1' };
    const foreign = comm('x', 'clinic-b', { catSystem: CAT, identifier: [sourceId] });
    const created: any[] = [];
    const client: any = {
      searchResources: mock(async () => [foreign]),
      createResource: mock(async (r: any) => { created.push(r); return { ...r, id: 'new' }; }),
    };
    const input = { patientName: 'Test Patient', clinicId: 'clinic-a', type: 'review-request' as const, message: 'hi', sourceType: 'checkout' as const, sourceId: 'C1', deliveryMode: 'manual' as const };
    const f = await createFollowUp(client, input);
    expect(f.id).toBe('new');
    expect(created[0].identifier.some((i: any) => i.system === 'clinic' && i.value === 'clinic-a')).toBe(true);
    expect(getFollowUpClinicId(created[0])).toBe('clinic-a');
    // same clinic duplicate
    const own = comm('own', 'clinic-a', { catSystem: CAT, identifier: [sourceId] });
    const client2: any = { searchResources: async () => [foreign, own], createResource: mock(async (r: any) => r) };
    expect((await createFollowUp(client2, input)).id).toBe('own');
    expect(client2.createResource).not.toHaveBeenCalled();
  });

  test('createFollowUp without a source skips the dedupe search and omits empty optional extensions', async () => {
    const client: any = { searchResources: mock(async () => []), createResource: mock(async (r: any) => ({ ...r, id: 'n' })) };
    const f = await createFollowUp(client, { patientName: 'P', clinicId: 'c', type: 'appointment-reminder', message: 'm', deliveryMode: 'manual' });
    expect(client.searchResources).not.toHaveBeenCalled();
    expect(f).toMatchObject({ patientId: '', patientPhone: '', deliveryMode: 'manual', deliveryStatus: 'pending', clinicId: 'c' });
    expect(f.sourceId).toBeUndefined();
    expect(f.whatsappUrl).toBeUndefined();
  });

  test('createFollowUp with a patient from another clinic is refused before any search or write', async () => {
    const client: any = { searchResources: mock(async () => []), createResource: mock(async () => ({})), readResource: mock(async () => { throw new Error('boom'); }) };
    await expect(createFollowUp(client, { patientName: 'P', patientId: 'bad id!', clinicId: 'c', type: 'review-request', message: 'm' })).rejects.toBeDefined();
    expect(client.createResource).not.toHaveBeenCalled();
  });
});

describe('Task 682: follow-up message helpers', () => {
  test('phone normalisation', () => {
    expect(normalizeWhatsAppPhone(undefined)).toBe('');
    expect(normalizeWhatsAppPhone('  ')).toBe('');
    expect(normalizeWhatsAppPhone('012-345 6789')).toBe('60123456789');
    expect(normalizeWhatsAppPhone('+60 12-345 6789')).toBe('60123456789');
    expect(normalizeWhatsAppPhone('0060123456789')).toBe('60123456789');
    expect(normalizeWhatsAppPhone('60123456789')).toBe('60123456789');
    expect(normalizeWhatsAppPhone('+60+12')).toBe('6012');
  });
  test('whatsapp url encodes text, undefined without phone', () => {
    expect(buildWhatsAppUrl('', 'x')).toBeUndefined();
    expect(buildWhatsAppUrl('0123456789', 'a b&c')).toBe('https://wa.me/60123456789?text=a%20b%26c');
  });
  test('renderFollowUpTemplate tolerates spaces and blanks unknown keys', () => {
    expect(renderFollowUpTemplate('Hi {{ name }} {{missing}}!', { name: 'A' })).toBe('Hi A !');
  });
  test('review request: with/without URL, custom template needing a URL falls back, blank name -> there', () => {
    const withUrl = buildReviewRequestMessage('Aisha', 'https://g.page/r/x');
    expect(withUrl).toContain('Aisha');
    expect(withUrl).toContain('https://g.page/r/x');
    const noUrl = buildReviewRequestMessage('  ', '');
    expect(noUrl).toContain('there');
    expect(noUrl).not.toContain('{{');
    expect(noUrl).not.toContain('  ');
    expect(buildReviewRequestMessage('A', '', 'Hello {{patientName}} {{reviewUrl}}')).not.toBe('Hello A');
    expect(buildReviewRequestMessage('A', '', 'Hello {{patientName}}')).toBe('Hello A');
    expect(buildReviewRequestMessage('A', 'u', 'Hello {{patientName}} {{ reviewUrl }}')).toBe('Hello A u');
  });
  test('appointment reminder: invalid date echoed back, clinic suffix only when named', () => {
    expect(buildAppointmentReminderMessage({ patientName: 'A', appointmentDate: 'tomorrow-ish', template: '{{patientName}}|{{appointmentDate}}|{{clinicSuffix}}' })).toBe('A|tomorrow-ish|');
    expect(buildAppointmentReminderMessage({ patientName: ' ', appointmentDate: new Date('2026-05-23T02:00:00Z'), clinicName: ' Klinik X ', template: '{{patientName}}{{clinicSuffix}}' })).toBe('there at Klinik X');
  });
});

describe('Task 682: follow-up reminder tasks', () => {
  const NOW = new Date('2026-05-23T04:00:00Z');
  const base: any = { id: 'f', patientId: 'p1', patientName: 'Ali', patientPhone: '60123', type: 'appointment-reminder', message: 'msg', status: 'preparation', deliveryStatus: 'pending', dueDate: '2026-05-23T03:00:00Z', createdAt: '2026-05-20T00:00:00Z' };

  test('completed / delivered are never tasks even if phone is missing or failed', () => {
    expect(isFollowUpReminderTask({ ...base, status: 'completed', patientPhone: '' }, NOW)).toBe(false);
    expect(isFollowUpReminderTask({ ...base, deliveryStatus: 'delivered', patientPhone: '' }, NOW)).toBe(false);
    expect(isFollowUpReminderTask({ ...base, deliveryStatus: 'completed' }, NOW)).toBe(false);
  });
  test('not yet due and phone present: no task', () => {
    expect(mapFollowUpToReminderTask({ ...base, dueDate: '2026-05-23T05:00:00Z' }, NOW)).toBeNull();
    expect(mapFollowUpToReminderTask({ ...base, dueDate: undefined }, NOW)).toBeNull();
  });
  test('review request with no due date is due immediately; invalid due date never becomes due', () => {
    const t = mapFollowUpToReminderTask({ ...base, type: 'review-request', dueDate: undefined }, NOW)!;
    expect(t).toMatchObject({ kind: 'follow-up-due', status: 'due', title: 'Send review request', description: 'msg' });
    expect(mapFollowUpToReminderTask({ ...base, dueDate: 'garbage' }, NOW)).toBeNull();
  });
  test('due: kind/status/title/description/action/reference', () => {
    expect(mapFollowUpToReminderTask({ ...base, sourceType: 'appointment', sourceId: 'A1' }, NOW)).toMatchObject({
      kind: 'follow-up-due', status: 'due', title: 'Send appointment reminder', description: 'msg', actionHref: '/follow-up', reference: 'appointment:A1', patientId: 'p1', source: 'follow-up',
    });
    expect(mapFollowUpToReminderTask({ ...base, sourceId: 'A1' }, NOW)!.reference).toBe('source:A1');
  });
  test('missing phone blocks even when not due; failed wins over missing phone', () => {
    const blocked = mapFollowUpToReminderTask({ ...base, patientPhone: '', dueDate: '2027-01-01T00:00:00Z' }, NOW)!;
    expect(blocked).toMatchObject({ kind: 'follow-up-missing-phone', status: 'blocked', title: 'Add phone for appointment reminder', description: 'Patient phone number is missing.' });
    const failed = mapFollowUpToReminderTask({ ...base, patientPhone: '', deliveryStatus: 'failed', twilioError: 'bad number' }, NOW)!;
    expect(failed).toMatchObject({ kind: 'follow-up-failed', status: 'failed', description: 'bad number', providerError: 'bad number' });
    expect(mapFollowUpToReminderTask({ ...base, deliveryStatus: 'failed', dueDate: '2099-01-01T00:00:00Z' }, NOW)!.description).toBe('WhatsApp delivery failed.');
  });
  test('falls back to patient id / "-" for display and drops empty ids', () => {
    expect(mapFollowUpToReminderTask({ ...base, patientName: '' }, NOW)!.patient).toBe('p1');
    const anon = mapFollowUpToReminderTask({ ...base, patientName: '', patientId: '' }, NOW)!;
    expect(anon.patient).toBe('-');
    expect(anon.patientId).toBeUndefined();
  });
  test('mapFollowUpsToReminderTasks filters and sortUnifiedTasks orders by due then newest created, without mutating', () => {
    const list = mapFollowUpsToReminderTasks([{ ...base, id: 'a', dueDate: '2026-05-23T03:00:00Z' }, { ...base, id: 'skip', status: 'completed' }, { ...base, id: 'b', dueDate: '2026-05-22T03:00:00Z' }], NOW);
    expect(list.map(t => t.id)).toEqual(['a', 'b']);
    const input = [
      { id: 'late', dueDate: '2026-05-25T00:00:00Z' }, { id: 'nodue-old', createdAt: '2026-01-01' }, { id: 'nodue-new', createdAt: '2026-03-01' },
      { id: 'bad', dueDate: 'zzz', createdAt: '2025-01-01' }, { id: 'early', dueDate: '2026-05-21T00:00:00Z' },
    ] as any[];
    const copy = [...input];
    expect(sortUnifiedTasks(input).map(t => t.id)).toEqual(['nodue-new', 'nodue-old', 'bad', 'early', 'late']);
    expect(input).toEqual(copy);
  });
  test('billing task mapping: defaults, reference preference, patient id strip', () => {
    const t = mapBillingTaskToUnifiedTask({ resourceType: 'Task', id: 't1', intent: 'order', for: { reference: 'Patient/p9' }, focus: { reference: 'Encounter/e1' },
      extension: [{ url: 'https://ucc.emr/task/error-class', valueString: 'stock' }, { url: 'https://ucc.emr/task/consultation-id', valueString: 'c1' }] } as any);
    expect(t).toMatchObject({ status: 'requested', patient: 'Patient/p9', patientId: 'p9', description: 'stock', reference: 'c1', kind: 'billing-exception' });
    expect(mapBillingTaskToUnifiedTask({ resourceType: 'Task', intent: 'order', focus: { reference: 'Encounter/e1' } } as any)).toMatchObject({ id: '', patient: '-', reference: 'Encounter/e1' });
  });
});
