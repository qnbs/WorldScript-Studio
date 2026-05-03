/**
 * Visual regression placeholders — enable when committing baseline screenshots.
 * Run locally: CI=true pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
 */
import { expect, test } from '@playwright/test';

test.describe.skip('Visual regression (baselines not in repo)', () => {
  test('home loads for screenshot baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});
