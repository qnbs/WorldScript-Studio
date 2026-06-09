/**
 * E2E Deep Coverage: Feature-flag matrix — parametrized smoke tests.
 *
 * QNBS-v3: Iterates over the canonical testConfigurations from test-matrix.ts.
 * Each config runs a minimal "app boots and main chrome is visible" check.
 * This catches regressions where one flag combination causes a startup crash
 * or React error boundary activation that plain unit tests would miss.
 *
 * Think of this as a CI "canary" for every flag combination: if ANY config
 * causes the app to fail to mount, the whole test matrix fails before deeper
 * feature-specific tests even run.
 */
import { expect, test } from '@playwright/test';
import { testConfigurations } from '../config/test-matrix';
import { ensureBlankProject, selectEnglish, setFeatureFlags, waitForSpaReady } from '../helpers';

const isCI = process.env['CI'] === 'true';

// ---------------------------------------------------------------------------
// Parametrized: app mounts and sidebar is visible for every config
// ---------------------------------------------------------------------------

for (const config of testConfigurations) {
  test.describe(`[matrix:${config.name}] ${config.description}`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!isCI, 'CI-only deep-coverage suite');
      await setFeatureFlags(page, config.flags);
    });

    test('app mounts successfully and main chrome is visible', async ({ page }) => {
      await page.goto('/');
      await waitForSpaReady(page);
      await selectEnglish(page);
      await ensureBlankProject(page);

      // Main shell must be present — no error boundary, no blank screen.
      // QNBS-v3: nav-mobile is md:hidden on desktop; .first() on combined locator picks the hidden
      // element on desktop viewports — use viewport-aware selector.
      const isDesktop = (page.viewportSize()?.width ?? 1280) >= 768;
      await expect(page.locator(isDesktop ? '#sidebar' : '[data-tour="nav-mobile"]')).toBeVisible({
        timeout: 15000,
      });

      // QNBS-v3: No .catch() — a visible error boundary is a real regression, not a flake.
      await expect(
        page.getByRole('heading', { name: /Something went wrong|Error|Fehler/i }),
      ).not.toBeVisible({ timeout: 2000 });
    });
  });
}

// ---------------------------------------------------------------------------
// Parametrized: Settings view renders with no crash for every config
// ---------------------------------------------------------------------------

for (const config of testConfigurations) {
  test.describe(`[matrix:${config.name}] settings render — ${config.description}`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!isCI, 'CI-only deep-coverage suite');
      await setFeatureFlags(page, config.flags);
      await page.goto('/');
      await waitForSpaReady(page);
      await selectEnglish(page);
      await ensureBlankProject(page);
    });

    test('Settings view opens without crash', async ({ page }) => {
      const settingsBtn = page.getByRole('button', { name: /Settings|Einstellungen/i }).first();
      await settingsBtn.click();
      // The Settings heading must appear — confirms the view mounts
      await expect(
        page.getByRole('heading', { name: /Settings|Einstellungen/i }).first(),
      ).toBeVisible({ timeout: 10000 });
    });
  });
}
