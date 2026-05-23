/**
 * Visual regression — baseline PNGs live next to this spec (`*-snapshots/`).
 * Refresh: CI=true pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --project=chromium
 * Local shortcut: pnpm run test:vrt
 */
import { expect, test } from '@playwright/test';

// QNBS-v3: Only Desktop Chromium baselines — Mobile would duplicate PNG sets and increase flakiness.
test.describe('Visual regression', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async (_fixture, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop 1280×720 baseline only (see playwright.config projects)',
    );
  });

  async function settle(page: import('@playwright/test').Page) {
    await page.waitForLoadState('load');
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    });
    // Short rAF flush so CSS transitions settle before the screenshot.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }

  const opts = {
    maxDiffPixels: 12_000,
    maxDiffPixelRatio: 0.06,
    animations: 'disabled' as const,
    timeout: 30_000,
  };

  test('home / dashboard loads', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await settle(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveScreenshot('home.png', opts);
  });

  test('writer view loads', async ({ page }) => {
    await page.goto('/#view=writer', { waitUntil: 'domcontentloaded' });
    await settle(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveScreenshot('writer.png', opts);
  });

  test('characters view loads', async ({ page }) => {
    await page.goto('/#view=characters', { waitUntil: 'domcontentloaded' });
    await settle(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveScreenshot('characters.png', opts);
  });

  test('settings view loads', async ({ page }) => {
    await page.goto('/#view=settings', { waitUntil: 'domcontentloaded' });
    await settle(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveScreenshot('settings.png', opts);
  });
});
