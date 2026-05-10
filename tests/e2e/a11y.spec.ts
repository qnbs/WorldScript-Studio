/**
 * Automated axe checks on critical routes (runs in CI with Playwright webServer).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ensureBlankProject, sidebar } from './helpers';

async function assertNoSeriousViolations(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, `${label}: ${JSON.stringify(serious, null, 2)}`).toHaveLength(0);
}

test.describe('Accessibility (axe)', () => {
  test('welcome / home has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await assertNoSeriousViolations(page, 'welcome');
  });

  test('settings accessibility hub has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await ensureBlankProject(page);
    await sidebar(page)
      .getByRole('button', { name: /Settings/i })
      .click();
    await page.getByRole('button', { name: /Accessibility|Barrierefreiheit/i }).click();
    await expect(
      page.getByRole('heading', {
        name: /Accessibility Settings|Barrierefreiheitseinstellungen/i,
      }),
    ).toBeVisible({
      timeout: 15000,
    });
    await assertNoSeriousViolations(page, 'settings-accessibility');
  });
});
