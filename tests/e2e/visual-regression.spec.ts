/**
 * Visual regression — baseline PNGs live next to this spec (`*-snapshots/`).
 * Refresh: CI=true pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --project=chromium
 * Local shortcut: pnpm run test:vrt
 */
import { expect, test } from '@playwright/test';

// QNBS-v3: Skip in the main E2E job (PLAYWRIGHT_SKIP_VRT=true) — handled by the dedicated VRT job
// that serves the production dist build. Running against the dev server here would compare against
// production-build baselines and always mismatch on unrelated HMR/port differences.
test.describe('Visual regression', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring for fixture args; no fixture needed here
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !!process.env['PLAYWRIGHT_SKIP_VRT'],
      'VRT handled by dedicated VRT job (PLAYWRIGHT_SKIP_VRT=true in e2e job)',
    );
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
