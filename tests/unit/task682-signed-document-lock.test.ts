import { describe, expect, test } from 'bun:test';
import { assertTimeChitMutationAllowed } from '../../lib/fhir/time-chit-guard';
import { documentKind, buildSignedDocumentNote } from '../../lib/orders/signed-document-note';
import { signedDocumentKind, signedDocumentMutationError, isSignedDocumentNote } from '../../lib/clinical-documents';
import { isTimeChitProcedure, timeChitError, timeChitHours } from '../../lib/time-chit';

const chit = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: 'time-chit', tcDate: '2026-05-23', tcTimeIn: '09:00', tcTimeOut: '10:30', tcHours: '1.5', tcDoctorName: 'Dr A', ...over });
const mc = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: 'mc', mcDays: '2', mcDoctorName: 'Dr A', ...over });
const lockErr = 'Signed documents cannot be edited or deleted. Void the document and issue a new one.';

describe('Task 682: Time Chit guard (409 lock, clinic scope)', () => {
  test('no Time Chit anywhere: passes even without clinic scope', async () => {
    await expect(assertTimeChitMutationAllowed([{ notes: mc() }], [{ notes: 'x' }], null)).resolves.toBeUndefined();
  });

  test('deleting/replacing an EXISTING Time Chit with no incoming one still requires clinic scope (403)', async () => {
    await expect(assertTimeChitMutationAllowed([], [{ notes: chit() }], undefined)).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(assertTimeChitMutationAllowed([], [{ notes: chit() }], '')).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(assertTimeChitMutationAllowed([], [{ notes: chit() }], 'clinic-a')).resolves.toBeUndefined();
  });

  test.each([
    ['unparseable JSON', 'not json'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON string', '"x"'],
  ])('incoming Time Chit with %s is a 409', async (_n, notes) => {
    const err = await assertTimeChitMutationAllowed([{ procedureId: 'letter-time-chit', notes }], [], 'c').catch(e => e);
    expect(err.name).toBe('ConflictError');
  });

  test('invalid details are 409 with the validation message', async () => {
    const bad = (o: Record<string, unknown>) => assertTimeChitMutationAllowed([{ notes: chit(o) }], [], 'c').catch(e => e);
    expect((await bad({ tcDate: '2026-02-30' })).message).toBe('Enter a valid attendance date.');
    expect((await bad({ tcTimeOut: '08:00' })).message).toBe('Time out must be after time in on the same day.');
    expect((await bad({ tcDoctorName: '   ' })).message).toBe("Enter the doctor's name.");
    expect((await bad({ tcDoctorName: 5 })).name).toBe('ConflictError');
  });

  test('client-supplied tcHours and kind are overwritten server-side; other fields preserved', async () => {
    const proc = { procedureId: 'letter-time-chit', notes: JSON.stringify({ tcDate: '2026-05-23', tcTimeIn: '09:00', tcTimeOut: '09:45', tcHours: '999', tcDoctorName: 'Dr A', extra: 'keep' }) };
    await assertTimeChitMutationAllowed([proc], [], 'c');
    expect(JSON.parse(proc.notes)).toMatchObject({ kind: 'time-chit', tcHours: '0.75', extra: 'keep', tcDoctorName: 'Dr A' });
  });

  test('every incoming Time Chit is validated, not only the first; non Time Chit docs are untouched', async () => {
    const mcProc = { notes: mc() };
    const before = mcProc.notes;
    const err = await assertTimeChitMutationAllowed([{ notes: chit() }, mcProc, { notes: chit({ tcTimeIn: '25:00' }) }], [], 'c').catch(e => e);
    expect(err.name).toBe('ConflictError');
    await assertTimeChitMutationAllowed([mcProc, { notes: chit() }], [], 'c');
    expect(mcProc.notes).toBe(before);
  });

  test('an existing Time Chit alone triggers the guard, and incoming MC alone does not validate as a chit', async () => {
    await expect(assertTimeChitMutationAllowed([{ notes: mc() }], [{ procedureId: 'letter-time-chit', notes: '' }], null)).rejects.toMatchObject({ name: 'ForbiddenError' });
  });
});

describe('Task 682: time-chit helpers', () => {
  test('timeChitHours rounds to 2dp and rejects malformed / equal / reversed times', () => {
    expect(timeChitHours('09:00', '09:20')).toBe('0.33');
    expect(timeChitHours('00:00', '23:59')).toBe('23.98');
    expect(timeChitHours('09:00', '09:00')).toBeNull();
    expect(timeChitHours('9:00', '10:00')).toBeNull();
    expect(timeChitHours('09:60', '10:00')).toBeNull();
    expect(timeChitHours('09:00', '24:00')).toBeNull();
    expect(timeChitHours('', '')).toBeNull();
  });
  test('timeChitError: missing fields and non-string doctor', () => {
    expect(timeChitError({})).toBe('Enter a valid attendance date.');
    expect(timeChitError({ tcDate: '2026-1-1' })).toBe('Enter a valid attendance date.');
    expect(timeChitError({ tcDate: '2024-02-29', tcTimeIn: '09:00', tcTimeOut: '10:00', tcDoctorName: 'Dr' })).toBeNull();
    expect(timeChitError({ tcDate: '2025-02-29', tcTimeIn: '09:00', tcTimeOut: '10:00', tcDoctorName: 'Dr' })).toBe('Enter a valid attendance date.');
    expect(timeChitError({ tcDate: '2026-05-23', tcTimeIn: '09:00', tcTimeOut: '10:00' })).toBe("Enter the doctor's name.");
  });
  test('isTimeChitProcedure: by id, by note kind, never for other kinds / empty / garbage', () => {
    expect(isTimeChitProcedure({ procedureId: 'letter-time-chit' })).toBe(true);
    expect(isTimeChitProcedure({ notes: chit() })).toBe(true);
    expect(isTimeChitProcedure({ notes: mc() })).toBe(false);
    expect(isTimeChitProcedure({})).toBe(false);
    expect(isTimeChitProcedure({ notes: '{' })).toBe(false);
  });
});

describe('Task 682: signedDocumentMutationError (locking) edge cases', () => {
  test('key order of the stored JSON does not matter for "unchanged"', () => {
    const stored = JSON.stringify({ kind: 'mc', mcDays: '2', nested: { a: 1, b: [1, { x: 1, y: 2 }] } });
    const resent = JSON.stringify({ nested: { b: [1, { y: 2, x: 1 }], a: 1 }, mcDays: '2', kind: 'mc' });
    expect(signedDocumentMutationError([{ notes: stored }], [{ notes: resent }])).toBeNull();
  });

  test('empty existing list, or only unsigned / unparseable existing notes, never lock', () => {
    expect(signedDocumentMutationError([], [])).toBeNull();
    expect(signedDocumentMutationError([{ notes: 'free text' }, { notes: null }, { notes: JSON.stringify({ kind: 'other' }) }, { notes: '[]' }], [])).toBeNull();
  });

  test('deleting every signed document (empty replacement) is refused', () => {
    expect(signedDocumentMutationError([{ notes: chit() }], [])).toBe(lockErr);
    expect(signedDocumentMutationError([{ notes: JSON.stringify({ kind: 'referral', referralTo: 'X' }) }], [])).toBe(lockErr);
  });

  test('two identical stored documents need two identical incoming ones (no double matching)', () => {
    expect(signedDocumentMutationError([{ notes: mc() }, { notes: mc() }], [{ notes: mc() }])).toBe(lockErr);
    expect(signedDocumentMutationError([{ notes: mc() }, { notes: mc() }], [{ notes: mc() }, { notes: mc() }])).toBeNull();
  });

  test('changing the kind, or editing any single field of a referral, is refused', () => {
    const ref = JSON.stringify({ kind: 'referral', referralTo: 'Hosp A', referralContent: 'x' });
    expect(signedDocumentMutationError([{ notes: ref }], [{ notes: JSON.stringify({ kind: 'referral', referralTo: 'Hosp B', referralContent: 'x' }) }])).toBe(lockErr);
    expect(signedDocumentMutationError([{ notes: ref }], [{ notes: JSON.stringify({ kind: 'mc', referralTo: 'Hosp A', referralContent: 'x' }) }])).toBe(lockErr);
  });

  test('void: allowed with or without a reason; needs a non-empty voidedAt string; other edits during void refused', () => {
    const base = { kind: 'referral', referralTo: 'H' };
    const existing = [{ notes: JSON.stringify(base) }];
    const v = (o: Record<string, unknown>) => signedDocumentMutationError(existing, [{ notes: JSON.stringify({ ...base, ...o }) }]);
    expect(v({ status: 'voided', voidedAt: '2026-05-23T01:00:00Z' })).toBeNull();
    expect(v({ status: 'voided', voidedAt: '2026-05-23T01:00:00Z', voidReason: 'typo' })).toBeNull();
    expect(v({ status: 'voided' })).toBe(lockErr);
    expect(v({ status: 'voided', voidedAt: '' })).toBe(lockErr);
    expect(v({ status: 'voided', voidedAt: 123 })).toBe(lockErr);
    expect(v({ status: 'voided', voidedAt: 'x', referralTo: 'Other' })).toBe(lockErr);
    expect(v({ status: 'cancelled', voidedAt: 'x' })).toBe(lockErr);
  });

  test('a document that was already voided cannot be re-voided / altered but can be resent unchanged', () => {
    const voided = JSON.stringify({ kind: 'mc', status: 'voided', voidedAt: 'a', voidReason: 'r' });
    expect(signedDocumentMutationError([{ notes: voided }], [{ notes: voided }])).toBeNull();
    expect(signedDocumentMutationError([{ notes: voided }], [{ notes: JSON.stringify({ kind: 'mc', status: 'voided', voidedAt: 'b', voidReason: 'r' }) }])).toBe(lockErr);
    expect(signedDocumentMutationError([{ notes: voided }], [])).toBe(lockErr);
  });

  test('voiding plus reissuing a new document in one replacement is allowed', () => {
    const old = chit();
    const voided = chit({ status: 'voided', voidedAt: '2026-05-23T02:00:00Z' });
    expect(signedDocumentMutationError([{ notes: old }], [{ notes: voided }, { notes: chit({ tcTimeOut: '11:00', tcHours: '2' }) }])).toBeNull();
  });
});

describe('Task 682: kind detection', () => {
  test('isSignedDocumentNote handles null/empty/unknown/garbage', () => {
    expect(isSignedDocumentNote(null)).toBeNull();
    expect(isSignedDocumentNote('')).toBeNull();
    expect(isSignedDocumentNote('{bad')).toBeNull();
    expect(isSignedDocumentNote(JSON.stringify({ kind: 'prescription' }))).toBeNull();
    expect(isSignedDocumentNote(JSON.stringify(null))).toBeNull();
    expect(isSignedDocumentNote(chit())).toBe('time-chit');
  });

  test('signedDocumentKind: note wins over name; falls back to id/name when note is unparseable', () => {
    expect(signedDocumentKind({ notes: mc(), procedureId: 'letter-time-chit' })).toBe('mc');
    expect(signedDocumentKind({ notes: '{', procedureId: 'letter-time-chit' })).toBe('time-chit');
    expect(signedDocumentKind({ name: 'Time Chit' })).toBe('time-chit');
    expect(signedDocumentKind({ procedureId: 'letter-mc' })).toBe('mc');
    expect(signedDocumentKind({ name: 'Medical Certificate' })).toBe('mc');
    expect(signedDocumentKind({ name: 'MC' })).toBe('mc');
    expect(signedDocumentKind({ procedureId: 'letter-referral' })).toBe('referral');
    expect(signedDocumentKind({ name: 'Referral letter' })).toBe('referral');
    expect(signedDocumentKind({ name: 'Mcdonald checkup' })).toBeNull();
    expect(signedDocumentKind({})).toBeNull();
    expect(signedDocumentKind({ notes: null, procedureId: null, name: null })).toBeNull();
  });

  test('documentKind: meta.kind beats id; time-chit checked before mc before referral', () => {
    expect(documentKind({ id: 'x', name: 'x', meta: { kind: 'referral' } })).toBe('referral');
    expect(documentKind({ id: 'letter-mc', name: 'x', meta: { kind: 'time-chit' } })).toBe('time-chit');
    expect(documentKind({ id: 'letter-referral', name: 'x' })).toBe('referral');
    expect(documentKind({ id: 'letter-mc', name: 'x' })).toBe('mc');
    expect(documentKind({ id: 'other', name: 'x', meta: { kind: 'lab' } })).toBeNull();
  });
});

describe('Task 682: buildSignedDocumentNote', () => {
  test('non-document entries keep the plain instruction (undefined when none)', () => {
    expect(buildSignedDocumentNote({ name: 'Paracetamol', instruction: 'bd' } as any)).toBe('bd');
    expect(buildSignedDocumentNote({ name: 'Paracetamol' } as any)).toBeUndefined();
  });

  test('document entries serialise to JSON with the kind, defaults and every field', () => {
    const note = JSON.parse(buildSignedDocumentNote({ name: 'Referral', catalogRef: 'letter-referral', meta: { referralTo: 'H', referralDoctorName: 'Dr', referralDoctorMmc: '123', referralDiagnosis: 'd', referralContent: 'c' } } as any)!);
    expect(note).toMatchObject({ kind: 'referral', status: 'completed', title: 'Referral', instruction: '', referralTo: 'H', referralDoctorMmc: '123', mcDays: '', tcDate: '' });
    expect(isSignedDocumentNote(JSON.stringify(note))).toBe('referral');
  });

  test('keeps documentStatus, MC and Time Chit fields', () => {
    const mcNote = JSON.parse(buildSignedDocumentNote({ name: 'MC', catalogRef: 'letter-mc', instruction: 'rest', meta: { documentStatus: 'draft', mcDays: '3', mcIncludeDiagnosis: 'true', mcStartDate: '2026-05-23' } } as any)!);
    expect(mcNote).toMatchObject({ kind: 'mc', status: 'draft', instruction: 'rest', mcDays: '3', mcIncludeDiagnosis: 'true', mcStartDate: '2026-05-23' });
    const tc = JSON.parse(buildSignedDocumentNote({ name: 'TC', catalogRef: 'letter-time-chit', meta: { tcDate: '2026-05-23', tcTimeIn: '09:00', tcTimeOut: '10:00', tcDoctorName: 'Dr', tcDoctorMmc: '9' } } as any)!);
    expect(tc).toMatchObject({ kind: 'time-chit', tcTimeIn: '09:00', tcDoctorMmc: '9' });
  });

  test('a freshly built chit note re-sent unchanged is not a lock violation (round trip)', () => {
    const note = buildSignedDocumentNote({ name: 'TC', catalogRef: 'letter-time-chit', meta: { tcDate: '2026-05-23', tcTimeIn: '09:00', tcTimeOut: '10:00', tcHours: '1', tcDoctorName: 'Dr' } } as any)!;
    expect(signedDocumentMutationError([{ notes: note }], [{ notes: note }])).toBeNull();
  });
});
