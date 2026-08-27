import { expect, test } from '@playwright/test';
import { ensureBlankProject, ensureWelcomePortalEntry } from './helpers';

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
    await page.reload();
    await ensureWelcomePortalEntry(page);
    await expect(page.getByRole('button', { name: /Start a New Project/i })).toBeVisible();
  });
});
