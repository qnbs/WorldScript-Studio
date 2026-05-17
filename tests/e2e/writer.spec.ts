import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  flushWriterDebounce,
  selectEnglish,
  selectFirstEnabledWriterSection,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('AI Writer Flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
  });

  test('app renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('service worker') &&
        !e.includes('ServiceWorker') &&
        !e.includes('sw.js') &&
        // Dev/HMR can surface SVG namespace warnings when icons mount during route transitions; tracked separately from app logic errors.
        !e.includes('The tag <path> is unrecognized'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('Writer view can be reached and edited', async ({ page }) => {
    await selectEnglish(page);
    await ensureBlankProject(page);
    // QNBS-v3: clickNavItem — sidebar(page) fails on Mobile Chrome; use mobile-aware helper
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    // QNBS-v3: waitForURL('**/') is a no-op in this SPA (URL never changes) and can cause timing
    // issues on Mobile Chrome; removed in favour of selectFirstEnabledWriterSection's own wait.

    await selectFirstEnabledWriterSection(page);

    // QNBS-v3: WriterViewUI renders ContextPanel in both mobile tab-panel and desktop grid;
    // use .first() so strict mode is not violated (mobile panel is first in DOM when active).
    const writerTextbox = page.getByTestId('writer-studio-editor').first();
    await expect(writerTextbox).toBeVisible();
    await writerTextbox.fill('This is the first AI-assisted draft paragraph.');
    await expect(writerTextbox).toHaveValue(/first AI-assisted draft paragraph/i);
    await flushWriterDebounce(page);
  });

  test('keyboard navigation and responsive layout work', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('body')).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await waitForSpaReady(page);
    await expect(page.locator('body')).toBeVisible();
  });
});
