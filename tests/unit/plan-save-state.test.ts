import { describe, expect, test } from 'bun:test';
import { planWriteOutcome, mergeUnsavedEntries } from '../../lib/plan-save-state';

describe('planWriteOutcome (composer never shows saved for a rejected save)', () => {
  test('only a successful 2xx body is saved', () => {
    expect(planWriteOutcome(true, { success: true, persistenceAvailable: true })).toBe('saved');
  });
  test('explicit persistenceAvailable:false is local-only, even on 503', () => {
    expect(planWriteOutcome(false, { success: false, persistenceAvailable: false })).toBe('local-only');
    expect(planWriteOutcome(true, { success: true, persistenceAvailable: false })).toBe('local-only');
  });
  test('rejections are failed, regardless of error text', () => {
    for (const error of ['Unable to detect a Project Id in the current environment', 'UNAUTHENTICATED', 'invalid authentication credentials', 'Draft changed in another window'])
      expect(planWriteOutcome(false, { success: false, error })).toBe('failed');
    expect(planWriteOutcome(false, {})).toBe('failed');
  });
  test('2xx without success:true, or a malformed body, is failed', () => {
    expect(planWriteOutcome(true, {})).toBe('failed');
    expect(planWriteOutcome(true, { success: 'yes' })).toBe('failed');
    for (const bad of [null, undefined, 'x', 3]) expect(planWriteOutcome(true, bad)).toBe('failed');
  });
});

describe('mergeUnsavedEntries (a failed item must not vanish when a later save succeeds)', () => {
  const e = (id: string, name = id) => ({ id, name });
  test('no failures: server plan verbatim', () => {
    expect(mergeUnsavedEntries([e('a')], [e('a'), e('b')], new Set())).toEqual([e('a')]);
  });
  test('failed add is re-appended after the server entries', () => {
    expect(mergeUnsavedEntries([e('b')], [e('a'), e('b')], new Set(['a']))).toEqual([e('b'), e('a')]);
  });
  test('failed edit keeps the local version', () => {
    expect(mergeUnsavedEntries([e('a', 'old')], [e('a', 'new')], new Set(['a']))).toEqual([e('a', 'new')]);
  });
  test('failed id no longer on screen (removed) is not resurrected', () => {
    expect(mergeUnsavedEntries([e('b')], [e('b')], new Set(['a']))).toEqual([e('b')]);
  });
});
