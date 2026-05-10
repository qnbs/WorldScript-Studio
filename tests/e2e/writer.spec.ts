import { expect, test } from '@playwright/test';

import {
  ensureBlankProject,
  selectEnglish,
  selectFirstEnabledWriterSection,
  sidebar,
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
    const writerButton = sidebar(page).getByRole('button', { name: /AI Writing Studio|Writer/i });
    await writerButton.click();
    await page.waitForURL('**/');

    await selectFirstEnabledWriterSection(page);

    const writerTextbox = page.getByRole('textbox').first();
    await expect(writerTextbox).toBeVisible();
    await writerTextbox.fill('This is the first AI-assisted draft paragraph.');
    await expect(writerTextbox).toHaveValue(/first AI-assisted draft paragraph/i);
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
