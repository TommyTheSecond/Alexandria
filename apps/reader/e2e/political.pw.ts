import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('political demo shows eleven real books and source disclosure',async({page})=>{
  await page.goto('/?collection=political#/');
  await expect(page.getByText('11 books',{exact:true})).toBeVisible();
  await expect(page.getByText(/Books have not passed the scanner or curator approval/)).toBeVisible();
  await page.getByLabel('Search title or author').fill('On Liberty');
  await expect(page.getByText('1 books',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'On Liberty',exact:true}).click();
  await expect(page.getByRole('heading',{name:'On Liberty',exact:true})).toBeVisible();
  await expect(page.getByText(/Inclusion in this political collection is not a claim/)).toBeVisible();
  await expect(page.getByRole('link',{name:'Public-domain source'})).toHaveAttribute('href',/^https:\/\/archive\.org\/details\//);
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:/Download PDF/}).click();
  const download=await event;
  expect(download.suggestedFilename()).toBe('on-liberty.pdf');
  const downloaded=await readFile((await download.path())!);
  const ledger=JSON.parse(await readFile('public/political/sources.json','utf8'));
  const entry=ledger.find((record:{slug:string})=>record.slug==='on-liberty');
  expect('0x'+createHash('sha256').update(downloaded).digest('hex')).toBe(entry.sha256);
});

test('all eleven source files match their manifest hashes',async()=>{
  const ledger=JSON.parse(await readFile('public/political/sources.json','utf8'));
  expect(ledger).toHaveLength(11);
  expect(new Set(ledger.map((record:{sha256:string})=>record.sha256)).size).toBe(11);
  for(const record of ledger){
    expect(record.editionYear).toBeLessThanOrEqual(1930);
    expect(record.firstPublishedYear).toBeLessThanOrEqual(1930);
    expect(record.deathYear).toBeLessThanOrEqual(1955);
    const bytes=await readFile(`public/political/${record.slug}.pdf`);
    expect(bytes.length).toBe(record.bytes);
    expect(bytes.length).toBeLessThanOrEqual(31457280);
    expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
    expect('0x'+createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
  }
});

