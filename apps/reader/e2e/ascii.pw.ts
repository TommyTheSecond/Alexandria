import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
test.skip(!existsSync('public/samples/catalog.json'), 'Local sample collection is not installed');

test('ASCII library is static, responsive, and keeps catalog usable', async ({ page }) => {
  await page.goto('/?samples=1#/');
  await expect(page.getByRole('heading', { name: 'A library without walls.' })).toBeVisible();
  await expect(page.getByTestId('library-art')).toBeVisible();
  expect((await page.getByTestId('library-art').textContent())!.length).toBeGreaterThan(20000);
  await expect(page.locator('.title-volume')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(241, 224, 197)');
  expect(await page.getByTestId('library-art').locator('span').count()).toBeGreaterThan(30);
  expect(await page.getByTestId('library-art').textContent()).toMatch(/^[\x20-\x7e\n]+$/);
  await expect(page.getByRole('link', { name: "Alice's Adventures in Wonderland", exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.screenshot({ path: 'test-results/ascii-dark.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.screenshot({ path: 'test-results/ascii-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ascii-mobile.png', fullPage: true });
});

test('all pages have no serious accessibility violations in either theme', async ({ page }) => {
  test.setTimeout(120000);
  for (const theme of ['light', 'dark']) {
    await page.goto('/?samples=1#/');
    await page.evaluate(value => { localStorage.setItem('alexandria-color-mode', value); }, theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const headings:Record<string,string>={'/':'A library without walls.','/book/1':"Alice's Adventures in Wonderland",'/upload':'Upload a book','/curate':'Curate submissions','/about':'About Alexandria'};
    for (const route of ['/', '/book/1', '/upload', '/curate', '/about']) {
      await page.evaluate(path => { location.hash=path; }, route);
      await expect(page.getByRole('heading',{name:headings[route],exact:true})).toBeVisible();
      // The ASCII engraving is a graphic with an accessible description, not
      // readable copy. Its shading intentionally spans low-contrast ink tones.
      const results = await new AxeBuilder({ page }).exclude('[data-testid="library-art"]').exclude('.header-art-row pre').analyze();
      expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), `${theme} ${route}`).toEqual([]);
    }
  }
});

test('shaded title and library model share one line on desktop and mobile', async ({ page }) => {
  await page.goto('/?samples=1#/');
  await expect(page.getByRole('heading', { name:'Alexandria', exact:true })).toBeVisible();
  const portrait=page.getByRole('img', {name:/ASCII model of the Library of Alexandria/});
  await expect(portrait).toBeVisible();
  for(const width of [1280,375]) {
    await page.setViewportSize({width,height:800});
    const title=await page.locator('.title-volume').boundingBox();
    const face=await portrait.boundingBox();
    expect(face!.x).toBeGreaterThanOrEqual(title!.x+title!.width);
    expect(Math.abs((title!.y+title!.height/2)-(face!.y+face!.height/2))).toBeLessThan(20);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:1280,height:800});
  await page.locator('.header-art-row').screenshot({path:'test-results/header-art.png'});
});
