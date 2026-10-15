import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
test.skip(!existsSync('public/samples/catalog.json'), 'Local sample collection is not installed');

test('real samples render, search and filter', async ({ page }) => {
  await page.goto('/?samples=1#/');
  await expect(page.getByText('2 books', { exact: true })).toBeVisible();
  await page.getByLabel('Search title or author').fill('Twain');
  await expect(page.getByRole('link', { name: 'Adventures of Huckleberry Finn', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: "Alice's Adventures in Wonderland", exact: true })).toHaveCount(0);
  await page.getByLabel('Search title or author').fill('');
  await page.getByRole('combobox', { name: 'Country', exact: true }).selectOption('CN');
  await expect(page.getByText('1 books', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: "Alice's Adventures in Wonderland", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ban history' })).toBeVisible();
});
for (const [id, filename] of [[1, 'alice.pdf'], [2, 'huckleberry-finn.pdf']] as const) {
  test(`real book ${id} downloads with matching SHA-256`, async ({ page }) => {
    await page.goto(`/?samples=1#/book/${id}`);
    if (id === 2) await expect(page.getByText('Under review. This book remains available.')).toBeVisible();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample PDF' }).click();
    const download = await event;
    expect(download.suggestedFilename()).toBe(filename);
    const saved = await readFile((await download.path())!);
    const original = await readFile(`public/samples/${filename}`);
    expect(createHash('sha256').update(saved).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
    await expect(page.getByRole('status')).toHaveText('Sample PDF verified and downloaded.');
  });
}
test('damaged download is blocked', async ({ page }) => {
  await page.route('**/samples/alice.pdf', route => route.fulfill({ contentType: 'text/html', body: '<html>gateway error</html>' }));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto('/?samples=1#/book/1');
  await page.getByRole('button', { name: 'Download sample PDF' }).click();
  await expect(page.getByRole('status')).toContainText('damaged');
  expect(downloads).toBe(0);
});
test('sample stays usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?samples=1#/book/1');
  await expect(page.getByRole('heading', { name: "Alice's Adventures in Wonderland" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/alice-mobile.png', fullPage: true });
});
