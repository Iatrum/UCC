import { expect, test } from 'bun:test';
import { lowStockBannerStatus } from '../../lib/inventory/stock-summary';

test('banner wording does not claim a threshold for out-of-stock only', () => {
  expect(lowStockBannerStatus(1, 0)).toBe('is out of stock.');
  expect(lowStockBannerStatus(3, 0)).toBe('are out of stock.');
});
test('banner wording for threshold and mixed cases', () => {
  expect(lowStockBannerStatus(0, 1)).toBe('is at or below the minimum stock threshold.');
  expect(lowStockBannerStatus(1, 1)).toBe('are out of stock or at or below the minimum stock threshold.');
});
test('banner wording plural and large-count edge cases', () => {
  expect(lowStockBannerStatus(0, 4)).toBe('are at or below the minimum stock threshold.');
  expect(lowStockBannerStatus(2, 1)).toBe('are out of stock or at or below the minimum stock threshold.');
});
