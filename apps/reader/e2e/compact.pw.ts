import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('collection uses compact cards without ASCII border lines',async({page})=>{
 const catalog=JSON.parse(await readFile('../../fixtures/catalog.json','utf8'));
 await page.route('**/catalog.json',route=>route.fulfill({json:catalog}));
 await page.route('**/config.json',route=>route.fulfill({json:{apiBase:''}}));
 await page.route(/^https:\/\/(api\.avax-test\.network|avalanche-fuji-c-chain-rpc\.publicnode\.com|avalanche-fuji\.drpc\.org)\//,route=>route.abort());
 await page.goto('/#/');
 const cards=page.locator('.book-card');
 await expect(cards).toHaveCount(3);
 await expect(cards.locator('.ascii-rule')).toHaveCount(0);
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:900});
  await expect(cards.first()).toBeVisible();
  const bounds=await cards.first().boundingBox();
  expect(bounds!.height).toBeLessThan(210);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.collection').screenshot({path:`test-results/compact-collection-${width}.png`});
 }
 await expect(page.locator('.header-library')).toBeVisible();
 await expect(page.locator('.athens-art')).toBeVisible();
 await page.getByRole('searchbox').fill('no books match this query');
 await expect(cards).toHaveCount(0);
 await page.getByRole('searchbox').fill('');
 await expect(cards).toHaveCount(3);
});
