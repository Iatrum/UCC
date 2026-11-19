import { describe, expect, test } from 'bun:test';
import { getCatalogSearchState } from '../../lib/orders/catalog-search-state';

describe('getCatalogSearchState (Task 613)', () => {
  test('loading with a query and no results is loading, not empty', () => {
    expect(getCatalogSearchState({ loading: true, query: 'para', resultCount: 0 })).toBe('loading');
  });
  test('loaded with a query and no results is empty', () => {
    expect(getCatalogSearchState({ loading: false, query: 'para', resultCount: 0 })).toBe('empty');
  });
  test('whitespace-only query when loaded is idle', () => {
    expect(getCatalogSearchState({ loading: false, query: '   ', resultCount: 0 })).toBe('idle');
  });
  test('results win even while still loading (partial catalogs)', () => {
    expect(getCatalogSearchState({ loading: true, query: 'para', resultCount: 2 })).toBe('results');
  });
  test('loading with no query is still loading', () => {
    expect(getCatalogSearchState({ loading: true, query: '', resultCount: 0 })).toBe('loading');
  });
});
