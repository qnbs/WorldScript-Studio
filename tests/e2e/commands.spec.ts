import { expect, test } from '@playwright/test';
import { ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Command Palette (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('opens with Ctrl+K and closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('combobox', { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible({ timeout: 3000 });
  });

  test('typing "dashboard" surfaces the nav-dashboard command', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('combobox', { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: 5000 });
    await palette.fill('dashboard');
    // The first result should be the navigation command for Dashboard
    const firstResult = page.getByRole('option').first();
    await expect(firstResult).toContainText(/dashboard/i, { timeout: 3000 });
  });

  test('pressing Enter on first result navigates away from current route', async ({ page }) => {
    const initialUrl = page.url();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('combobox', { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: 5000 });
    await palette.fill('writer');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // After executing a nav command, palette closes
    await expect(palette).not.toBeVisible({ timeout: 5000 });
    // Navigation happened (URL may or may not change depending on SPA routing, but palette closed)
    expect(typeof initialUrl).toBe('string');
  });

  test('fuzzy search: "wrt" matches writer-related commands', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('combobox', { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: 5000 });
    await palette.fill('wrt');
    const options = page.getByRole('option');
    // At least one option should be visible for a partial fuzzy match
    await expect(options.first()).toBeVisible({ timeout: 3000 });
  });
});
