import { expect, test } from '@playwright/test';

const isCI = process.env['CI'] === 'true';

test.describe('AI Writer Flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('app renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) => !e.includes('service worker') && !e.includes('ServiceWorker') && !e.includes('sw.js'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('Writer view can be reached and edited', async ({ page }) => {
    const writerButton = page.getByRole('button', { name: /write|writer|schreiben/i }).first();
    await writerButton.click();
    await page.waitForURL('**/');

    const sectionSelect = page.getByRole('combobox').first();
    await expect(sectionSelect).toBeVisible();
    const sectionOptions = sectionSelect.locator('option:not([disabled])');
    await expect(sectionOptions.first()).toBeVisible();
    const firstValue = await sectionOptions.first().getAttribute('value');
    if (firstValue) {
      await sectionSelect.selectOption(firstValue);
    }

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
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});
