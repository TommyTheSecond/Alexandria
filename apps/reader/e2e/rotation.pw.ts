import { test, expect } from '@playwright/test';

test('static ASCII Lady Justice sits beside the title and the library rotates below', async ({page})=>{
 await page.goto('/#/');
 const justice=page.getByRole('img',{name:'Lady Justice in shaded black-and-white ASCII, holding scales and a sword'});
 await expect(justice).toBeVisible();
 await expect(page.locator('.site-header canvas')).toHaveCount(0);
 const drawing=await justice.textContent();
 expect(drawing?.trim().length).toBeGreaterThan(2000);
 const model=page.locator('.library-figure').getByTestId('header-library-model');
 await expect(model).toHaveAttribute('data-frame','0');
 await page.evaluate(()=>window.scrollTo(0,900));
 await expect.poll(()=>model.getAttribute('data-frame')).not.toBe('0');
 expect(await justice.textContent()).toBe(drawing);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(model).toHaveAttribute('data-frame','0');
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:900});
  const title=await page.locator('.title-volume').boundingBox();
  const figure=await justice.boundingBox();
  expect(figure!.x).toBeGreaterThanOrEqual(title!.x+title!.width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.site-header').screenshot({path:`test-results/justice-header-${width}.png`});
  await page.locator('.hero').screenshot({path:`test-results/rotating-library-${width}.png`});
 }
 await page.getByRole('button',{name:'Switch to dark mode'}).click();
 await page.locator('.site-header').screenshot({path:'test-results/justice-header-dark.png'});
});

test('the lower library has a static fallback for reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#/');
 await expect(page.locator('.library-figure pre')).toBeVisible();
 await expect(page.getByTestId('header-library-model')).toBeHidden();
 await expect(page.locator('.header-justice pre')).toBeVisible();
});
