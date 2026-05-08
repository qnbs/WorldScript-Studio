/**
 * Visual regression — baseline PNGs live next to this spec (`*-snapshots/`).
 * Refresh: CI=true pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --project=chromium
 */
import { expect, test } from '@playwright/test';

test.describe('Visual regression', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('home loads for screenshot baseline', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveScreenshot('home.png', {
      maxDiffPixels: 1500,
      animations: 'disabled',
      timeout: 30_000,
    });
  });
});
