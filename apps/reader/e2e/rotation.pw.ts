import { test, expect } from '@playwright/test';

test('Lady Justice replaces the lower artwork and stays static when scrolling', async ({page}) => {
 const animatedRequests:string[]=[];
 page.on('request', request=>{if(request.url().includes('library-turntable.bin'))animatedRequests.push(request.url());});
 await page.goto('/#/');
 const justice=page.getByRole('img',{name:'Lady Justice holding scales and a sword'});
 await expect(justice).toBeVisible();
 await expect(page.locator('.library-figure')).toContainText('LADY JUSTICE');
 await expect(page.locator('.site-header img, .site-header canvas')).toHaveCount(0);
 await expect(page.getByTestId('header-library-model')).toHaveCount(0);
 const before=await justice.evaluate(node=>getComputedStyle(node).transform);
 await page.evaluate(()=>window.scrollTo(0,900));
 await expect(justice).toHaveCSS('transform',before);
 expect(animatedRequests).toEqual([]);
});

test('Lady Justice fits mobile and both themes with reduced motion', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#/');
 for(const width of [1280,375]) {
  await page.setViewportSize({width,height:850});
  const justice=page.getByRole('img',{name:'Lady Justice holding scales and a sword'});
  await expect(justice).toBeVisible();
  await justice.evaluate(node => (node as HTMLImageElement).decode());
  expect(await justice.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.hero').screenshot({path:`test-results/lady-justice-${width}.png`});
 }
 await page.getByRole('button',{name:'Switch to dark mode'}).click();
 await expect(page.getByRole('img',{name:'Lady Justice holding scales and a sword'})).toBeVisible();
 await page.locator('.hero').screenshot({path:'test-results/lady-justice-dark.png'});
});
