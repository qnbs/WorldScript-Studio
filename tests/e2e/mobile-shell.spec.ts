/**
 * Mobile viewport smoke — runs under Mobile Chrome project in CI (Pixel 5).
 */
import { expect, test } from '@playwright/test';
import { ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Mobile shell', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
  });

  test('bottom tab bar or sidebar is usable after blank project', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile Chrome', 'Mobile Chrome project only');
    await selectEnglish(page);
    await ensureBlankProject(page);
    const mobileTabs = page.locator('[data-tour="nav-mobile"]');
    const sidebar = page.locator('#sidebar');
    await expect(mobileTabs.or(sidebar).first()).toBeVisible({ timeout: 20000 });
  });
});
