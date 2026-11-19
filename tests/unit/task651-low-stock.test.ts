import { expect, test } from 'bun:test';
import { hasThreshold, isLowStock, isOrderSoon, isOutOfStock, summarizeLowStock } from '../../lib/inventory/stock-summary';

const m = (stock: number, minimumStock: number, name = 'X') => ({ name, stock, minimumStock });

test('no threshold set never flags low', () => {
  expect(hasThreshold(m(0, 0))).toBe(false);
  expect(isLowStock(m(0, 0))).toBe(false);
  expect(isLowStock(m(5, 0))).toBe(false);
  expect(isOrderSoon(m(0, 0))).toBe(false);
  expect(isLowStock(m(3, Number.NaN))).toBe(false);
});

test('out of stock without threshold is still out of stock, not low', () => {
  expect(isOutOfStock(m(0, 0))).toBe(true);
  expect(isLowStock(m(0, 0))).toBe(false);
});

test('threshold set: low at or below, not above, not when empty', () => {
  expect(isLowStock(m(10, 10))).toBe(true);
  expect(isLowStock(m(4, 10))).toBe(true);
  expect(isLowStock(m(11, 10))).toBe(false);
  expect(isLowStock(m(0, 10))).toBe(false);
  expect(isLowStock(m(3, 10))).toBe(isOrderSoon(m(3, 10)));
});

test('summary tiles/banner ignore unthresholded items unless out of stock', () => {
  const s = summarizeLowStock([m(0, 0, 'A'), m(2, 0, 'B'), m(2, 5, 'C'), m(0, 5, 'D')]);
  expect(s.orderSoon.map((x) => x.name)).toEqual(['C']);
  expect(s.outOfStock.map((x) => x.name)).toEqual(['A', 'D']);
  expect(s.attention.map((x) => x.name)).toEqual(['A', 'D', 'C']);
});

test('edge matrix stock/min: 0/0, 0/5, 5/5, 6/5', () => {
  expect([isLowStock(m(0, 0)), isOutOfStock(m(0, 0))]).toEqual([false, true]);
  expect([isLowStock(m(0, 5)), isOutOfStock(m(0, 5))]).toEqual([false, true]);
  expect([isLowStock(m(5, 5)), isOutOfStock(m(5, 5))]).toEqual([true, false]);
  expect([isLowStock(m(6, 5)), isOutOfStock(m(6, 5))]).toEqual([false, false]);
});
