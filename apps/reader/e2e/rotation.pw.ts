import { test, expect } from '@playwright/test';

test('scroll changes the 3D view and scrolling back restores it', async ({ page }) => {
  await page.goto('/?samples=1#/');
  const canvas=page.getByTestId('header-library-model');
  await expect(canvas).toHaveAttribute('data-frame','0');
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => canvas.getAttribute('data-frame')).not.toBe('0');
  const rotated=await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL());
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(canvas).toHaveAttribute('data-frame','0');
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL())).not.toBe(rotated);
});

test('reduced motion keeps the static header model and painting', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?samples=1#/');
  await expect(page.getByTestId('library-art').locator('pre')).toBeVisible();
  await expect(page.getByTestId('header-library-model')).toBeHidden();
});
