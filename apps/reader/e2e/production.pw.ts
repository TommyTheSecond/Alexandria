import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('production reader falls back to a snapshot and saves only a verified PDF', async ({ page }) => {
  const catalog = JSON.parse(await readFile('../../fixtures/catalog.json', 'utf8'));
  const book = catalog.books[0];
  const pdf = await readFile('../../fixtures/pdfs/good.pdf');
  const pdfByCid = new Map([
    [catalog.books[0].pdfCid, pdf],
    [catalog.books[1].pdfCid, await readFile('../../fixtures/pdfs/good-2.pdf')],
    [catalog.books[2].pdfCid, await readFile('../../fixtures/pdfs/good-3.pdf')],
  ]);
  await page.route('**/catalog.json', route => route.fulfill({ json: catalog }));
  await page.route(/^https:\/\/(api\.avax-test\.network|avalanche-fuji-c-chain-rpc\.publicnode\.com|avalanche-fuji\.drpc\.org)\//,
    route => route.fulfill({ status: 503, body: 'RPC unavailable' }));
  await page.route('**/ipfs/**', route => route.fulfill({
    status: 200, body: route.request().url().startsWith('https://tense-peach-scallop.myfilebase.com/') ? '<html>gateway error</html>' : pdfByCid.get(route.request().url().split('/').pop()!)!,
    contentType: route.request().url().startsWith('https://tense-peach-scallop.myfilebase.com/') ? 'text/html' : 'application/pdf',
    headers: { 'access-control-allow-origin': '*' },
  }));

  await page.goto('/#/');
  await expect(page.getByText(/Showing saved catalog · data as of block 1/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: book.meta.title, exact: true }).click();
  const downloadEvent = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /Download PDF/ }).click();
  const download = await downloadEvent;
  const bytes = await readFile((await download.path())!);
  expect('0x' + createHash('sha256').update(bytes).digest('hex')).toBe(book.pdfSha256);
  await expect(page.getByRole('status').last()).toHaveText('PDF verified and downloaded.');
  await page.evaluate(() => { location.hash = '#/book/2'; });
  await expect(page.getByText('Under review. This book remains available.')).toBeVisible();
  const flaggedDownload = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /Download PDF/ }).click();
  const flaggedBytes = await readFile((await (await flaggedDownload).path())!);
  expect('0x' + createHash('sha256').update(flaggedBytes).digest('hex')).toBe(catalog.books[1].pdfSha256);
  await page.evaluate(() => { location.hash = '#/book/3'; });
  await expect(page.getByRole('heading', { name: catalog.books[2].meta.title })).toBeVisible();
});

test('upload form sends complete metadata through the SDK scanner request', async ({ page }) => {
  const pdf = await readFile('../../fixtures/pdfs/good.pdf');
  let sent: { title?: boolean; author?: boolean; pdf?: boolean } = {};
  await page.route('**/config.json', route => route.fulfill({ json: { apiBase: 'https://scanner.example/api' } }));
  await page.route('https://scanner.example/api/submit', async route => {
    const request = route.request();
    const body = request.postData() ?? '';
    sent = { title: body.includes('Fixture Book'), author: body.includes('Ada Fixture'),
      pdf: body.includes('filename="good.pdf"') && (request.postDataBuffer()?.length ?? 0) > pdf.length };
    await route.fulfill({ json: { report: { verdict: 'review' }, bookId: 7 }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/#/upload');
  await page.getByLabel('PDF (up to 30 MB)').setInputFiles({ name: 'good.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByLabel('Title').fill('Fixture Book');
  await page.getByLabel('Author', { exact: true }).fill('Ada Fixture');
  await page.getByLabel('Author death year, if known').fill('1920');
  await page.getByLabel('First publication year').fill('1900');
  await page.getByLabel('Public-domain source name').fill('Project Gutenberg');
  await page.getByLabel('Public-domain source URL').fill('https://www.gutenberg.org/ebooks/1');
  await page.getByLabel('Ban country (two-letter code)').fill('US');
  await page.getByLabel('Ban authority').fill('Fixture County Library Board');
  await page.getByLabel('Ban year').fill('1925');
  await page.getByLabel('Ban source URL').fill('https://example.org/ban');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status').last()).toContainText('Submitted as book #7');
  expect(sent).toEqual({ title: true, author: true, pdf: true });
});

test('scanner rejection shows failed checks and does not claim submission', async ({ page }) => {
  const pdf = await readFile('../../fixtures/pdfs/good.pdf');
  await page.route('**/config.json', route => route.fulfill({ json: { apiBase: 'https://scanner.example/api' } }));
  await page.route('https://scanner.example/api/submit', route => route.fulfill({
    status: 422,
    json: { report: { verdict: 'reject', checks: [{ id: 'pdf.active', passed: false,
      severity: 'reject', detail: 'active content' }] }, bookId: null },
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.goto('/#/upload');
  await page.getByLabel('PDF (up to 30 MB)').setInputFiles({ name: 'good.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByLabel('Title').fill('Fixture Book');
  await page.getByLabel('Author', { exact: true }).fill('Ada Fixture');
  await page.getByLabel('First publication year').fill('1900');
  await page.getByLabel('Public-domain source name').fill('Project Gutenberg');
  await page.getByLabel('Public-domain source URL').fill('https://www.gutenberg.org/ebooks/1');
  await page.getByLabel('Ban country (two-letter code)').fill('US');
  await page.getByLabel('Ban authority').fill('Fixture Board');
  await page.getByLabel('Ban year').fill('1925');
  await page.getByLabel('Ban source URL').fill('https://example.org/ban');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status').last()).toContainText('Rejected: pdf.active');
  await expect(page.getByRole('table')).toContainText('active content');
  await expect(page.getByText(/Submitted as book/)).toHaveCount(0);
});
