/**
 * Visual regression — baseline PNGs live next to this spec (`*-snapshots/`).
 * Refresh: CI=true pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --project=chromium
 * Local shortcut: pnpm run test:vrt
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

// QNBS-v3: Skip in the main E2E job (PLAYWRIGHT_SKIP_VRT=true) — handled by the dedicated VRT job
// that serves the production dist build. Running against the dev server here would compare against
// production-build baselines and always mismatch on unrelated HMR/port differences.

// QNBS-v3: fully-qualified, VRT-local entry, deliberately bypassing the shared baseURL — every other e2e spec's page.goto('/') targets Vite's dev server (which serves at root regardless), while VRT's static server genuinely serves the app under this GH-Pages-style subpath, so scoping this here avoids any risk to the rest of the suite's navigation.
const APP_ENTRY = 'http://127.0.0.1:3000/WorldScript-Studio/';

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

  // QNBS-v3: proves the served page is actually WorldScript Studio before any screenshot — a static-file-server fallback (e.g. an http-server directory listing) has a visible <body> too, so a body-visibility check alone can't tell the two apart; waitForSpaReady's own landmarks (#sidebar/nav-mobile/welcome-portal) already can't exist on a listing page, and the title/text checks below are an independent second signal.
  async function assertRealAppLoaded(page: import('@playwright/test').Page) {
    await waitForSpaReady(page);
    await expect(page).not.toHaveTitle(/Index of/i);
    await expect(page.locator('body')).not.toContainText('Index of /');
  }

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

  // QNBS-v3: APP_ENTRY, not '/' — an absolute-path goto discards the shared baseURL's entire path per the URL spec, landing on the static server's bare root instead of the app (this was the root cause of every VRT baseline actually being an http-server directory listing).
  test('home / dashboard loads', async ({ page }) => {
    await page.goto(APP_ENTRY, { waitUntil: 'domcontentloaded' });
    await assertRealAppLoaded(page);
    await settle(page);
    await expect(page).toHaveScreenshot('home.png', opts);
  });

  // QNBS-v3: '#view=writer' was never a real route (no code in the app parses it) — reuses the same clickNavItem/ensureBlankProject navigation every other e2e spec already relies on, instead of a URL fragment the router never read. 'manuscript' and 'writer' are distinct views (types.ts's View union); the canonical nav match for the actual Writer/editor view used across the rest of this suite (writer.spec.ts et al.) is /AI Writing Studio|Writer/i, not /Manuscript/i.
  test('writer view loads', async ({ page }) => {
    await page.goto(APP_ENTRY, { waitUntil: 'domcontentloaded' });
    await assertRealAppLoaded(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    await settle(page);
    await expect(page).toHaveScreenshot('writer.png', opts);
  });

  test('characters view loads', async ({ page }) => {
    await page.goto(APP_ENTRY, { waitUntil: 'domcontentloaded' });
    await assertRealAppLoaded(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Characters/i);
    await settle(page);
    await expect(page).toHaveScreenshot('characters.png', opts);
  });

  test('settings view loads', async ({ page }) => {
    await page.goto(APP_ENTRY, { waitUntil: 'domcontentloaded' });
    await assertRealAppLoaded(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Settings/i);
    await settle(page);
    await expect(page).toHaveScreenshot('settings.png', opts);
  });
});
