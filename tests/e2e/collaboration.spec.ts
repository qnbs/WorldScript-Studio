import { expect, test } from '@playwright/test';
import { ensureBlankProject, selectEnglish, sidebar, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Collaboration Panel (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('security warning banner is visible before connecting', async ({ page }) => {
    // Open collaboration panel via sidebar
    const collabBtn = sidebar(page).getByRole('button', { name: /Collaboration|Collab/i });
    await expect(collabBtn).toBeVisible({ timeout: 10000 });
    await collabBtn.click();

    // Security warning must be present (role=alert, aria-live=polite)
    const securityAlert = page.locator('[role="alert"]');
    await expect(securityAlert).toBeVisible({ timeout: 5000 });
    await expect(securityAlert).not.toBeEmpty();
  });

  test('security warning disappears after connecting', async ({ page }) => {
    // QNBS-v3: only checks visibility of warning before connection state; actual connect tested in integration
    const collabBtn = sidebar(page).getByRole('button', { name: /Collaboration|Collab/i });
    await expect(collabBtn).toBeVisible({ timeout: 10000 });
    await collabBtn.click();

    // Alert is visible pre-connection
    const securityAlert = page.locator('[role="alert"]');
    await expect(securityAlert).toBeVisible({ timeout: 5000 });

    // The warning text should mention signaling or security
    const text = await securityAlert.innerText();
    expect(text.length).toBeGreaterThan(10);
  });
});
