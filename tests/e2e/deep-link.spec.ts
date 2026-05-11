/**
 * Deep links (?view=) align with PWA manifest shortcuts and sidebar ids.
 */
import { expect, test } from '@playwright/test';
import { ensureBlankProject, selectEnglish, sidebar, waitForSpaReady } from './helpers';

test.describe('Deep links', () => {
  test('view=manuscript keeps manuscript nav active after onboarding', async ({ page }) => {
    // Desktop sidebar (#sidebar) is md:+ ; mobile tab bar uses the same aria-current pattern.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?view=manuscript');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await expect(
      sidebar(page)
        .getByRole('button', { name: /Manuscript/i })
        .first(),
    ).toHaveAttribute('aria-current', 'page', { timeout: 15000 });
  });
});
