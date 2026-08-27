import { expect, test } from '@playwright/test';
import { ensureBlankProject, ensureWelcomePortalEntry, waitForMainChrome } from './helpers';

const isCI = process.env['CI'] === 'true';

// QNBS-v3: proves ensureWelcomePortalEntry reaches "Start a New Project" from both startup shapes waitForSpaReady() accepts.
test.describe('WelcomePortal entry precondition (CI-only)', () => {
  test.beforeEach(() => {
    test.skip(!isCI, 'CI-only E2E suite');
  });

  test('reaches the entry point on a fresh WelcomePortal boot', async ({ page }) => {
    await page.goto('/');
    await ensureWelcomePortalEntry(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).toBeVisible();
  });

  test('reaches the entry point from an already-mounted main shell with a persisted project', async ({
    page,
  }) => {
    await page.goto('/');
    await ensureBlankProject(page);
    // QNBS-v3: the 1s debounced autosave must genuinely land before reload or this scenario passes without ever exercising the Factory Reset fallback.
    await expect(page.getByText(/All changes saved|Alle Änderungen gespeichert/i)).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    // Prove this reload really landed back in the main shell, not a fresh WelcomePortal —
    // otherwise ensureWelcomePortalEntry's early-return branch would make the assertion below vacuous.
    await waitForMainChrome(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).not.toBeVisible();
    await ensureWelcomePortalEntry(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).toBeVisible();
  });
});
