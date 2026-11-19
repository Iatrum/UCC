import { test, expect, type Page } from '@playwright/test';

// Task 476 (UX #15): queue row "Mark as Complete" / "Remove from Queue" need confirmation. Mocked, fake data.
test.use({ trace: 'off' });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/queue', async (route) => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill(json({ patients: [{ id: 'fake-pat-q', fullName: 'Fake Queue Patient', nric: 'FAKE-1', queueStatus: 'waiting', queueNumber: 1 }] }));
    writes.push(`${m} ${route.request().postData() ?? ''}`);
    return route.fulfill(json({ success: true }));
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
  return writes;
}
const openMenu = (page: Page) => page.getByRole('row', { name: /Fake Queue Patient/ }).getByRole('button').click();

test('Mark as Complete asks first; Cancel sends nothing, confirm sends PATCH completed', async ({ page }) => {
  const writes = await setup(page);
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Mark as Complete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Fake Queue Patient');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Mark as Complete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark as Complete' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toContain('PATCH');
  expect(writes[0]).toContain('completed');
});

test('Remove from Queue asks first; Cancel sends nothing, confirm sends DELETE', async ({ page }) => {
  const writes = await setup(page);
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Remove from Queue' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  expect(writes).toHaveLength(0);
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Remove from Queue' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toContain('DELETE');
});
