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

  test('reaches the entry point when a non-English language is already persisted', async ({
    page,
  }) => {
    // QNBS-v3: proves waitForSpaReady's stable welcome-portal selector survives a non-English boot, not just the translated button label.
    await page.addInitScript(() => localStorage.setItem('worldscript-language', 'es'));
    await page.goto('/');
    await expect(page.getByTestId('welcome-portal')).toBeVisible();
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
    // QNBS-v3: proves the reload landed in the main shell, not a fresh WelcomePortal, or the assertion below would be vacuous.
    await waitForMainChrome(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).not.toBeVisible();
    await ensureWelcomePortalEntry(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).toBeVisible();
  });
});
