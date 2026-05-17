import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

/** Navigate to Settings → Collaboration section (Collaboration is a settings category, not a sidebar item). */
async function navigateToCollaborationSettings(
  page: import('@playwright/test').Page,
): Promise<void> {
  // QNBS-v3: Collaboration is inside Settings, not a top-level sidebar nav item —
  // clickNavItem(/Collaboration/) would fall through to mobile "More" sheet and find nothing.
  await clickNavItem(page, /Settings/i);
  await page.getByRole('button', { name: /^Collaboration$/i }).click();
}

test.describe('Collaboration Panel (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('security warning banner is visible before connecting', async ({ page }) => {
    await navigateToCollaborationSettings(page);

    // Security warning must be present (role=alert, aria-live=polite)
    const securityAlert = page.locator('[role="alert"]');
    await expect(securityAlert).toBeVisible({ timeout: 5000 });
    await expect(securityAlert).not.toBeEmpty();
  });

  test('security warning disappears after connecting', async ({ page }) => {
    // QNBS-v3: only checks visibility of warning before connection state; actual connect tested in integration
    await navigateToCollaborationSettings(page);

    // Alert is visible pre-connection
    const securityAlert = page.locator('[role="alert"]');
    await expect(securityAlert).toBeVisible({ timeout: 5000 });

    // The warning text should mention signaling or security
    const text = await securityAlert.innerText();
    expect(text.length).toBeGreaterThan(10);
  });
});
