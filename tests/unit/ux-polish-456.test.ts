import { expect, test } from 'bun:test';
import { formatItemCount, summarizeLowStock } from '../../lib/inventory/stock-summary';
import { registrationFieldSchemas as f } from '../../lib/patients/registration-schema';

const med = (name: string, stock: number, minimumStock = 10) => ({ name, stock, minimumStock });

test('order soon excludes out-of-stock so tiles do not double count', () => {
  const s = summarizeLowStock([med('A', 0), med('B', 3), med('C', 10), med('D', 50)]);
  expect(s.orderSoon.map((m) => m.name)).toEqual(['B', 'C']);
  expect(s.outOfStock.map((m) => m.name)).toEqual(['A']);
  expect(s.inStock).toBe(3);
});

test('banner shows first 5 names and a remainder count', () => {
  const items = Array.from({ length: 8 }, (_, i) => med(`M${i}`, 1));
  const s = summarizeLowStock(items);
  expect(s.bannerNames).toEqual(['M0', 'M1', 'M2', 'M3', 'M4']);
  expect(s.moreCount).toBe(3);
  expect(summarizeLowStock(items.slice(0, 5)).moreCount).toBe(0);
});

test('item wording', () => {
  expect(formatItemCount(1)).toBe('1 item');
  expect(formatItemCount(3)).toBe('3 items');
  expect(formatItemCount(0)).toBe('0 items');
});

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

test('gender: friendly message when missing or invalid', () => {
  expect(msg(f.gender.safeParse(undefined))).toBe('Select a gender');
  expect(msg(f.gender.safeParse('x'))).toBe('Select a gender');
  expect(f.gender.safeParse('female').success).toBe(true);
});

test('phone: empty gets its own message, malformed keeps the format message', () => {
  expect(msg(f.phone.safeParse(''))).toBe('Enter a contact number');
  expect(msg(f.phone.safeParse('123'))).toBe('Invalid phone number');
  expect(f.phone.safeParse('+60123456789').success).toBe(true);
});

test('date of birth is required and validated', () => {
  expect(f.dateOfBirth.safeParse('').success).toBe(false);
  expect(f.dateOfBirth.safeParse('1988-07-05').success).toBe(true);
});
