import { test, expect } from '@playwright/test';

// Task 380 regression: missing purchase-order id is a 404 (was 500); admin subdomain redirect has no /admin/admin.
test('purchases: unknown id returns 404, not 500', async ({ request }) => {
  const r = await request.get('/api/purchases?id=task380-does-not-exist');
  expect(r.status()).toBe(404);
});

test('inventory: unknown id returns 404 and bad stock returns 400', async ({ request }) => {
  expect((await request.get('/api/inventory?id=task380-does-not-exist')).status()).toBe(404);
  expect((await request.patch('/api/inventory', { data: { medicationId: 'x', stock: -1 } })).status()).toBe(400);
});
