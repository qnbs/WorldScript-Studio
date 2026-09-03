import { expect, test } from '@playwright/test';
import { ensureBlankProject, ensureWelcomePortalEntry, waitForMainChrome } from './helpers';

const isCI = process.env['CI'] === 'true';

// QNBS-v3: proves ensureWelcomePortalEntry's contract (portal reached, locale-independent) holds from every startup shape waitForSpaReady() accepts, including its own internal-reload race.
test.describe('WelcomePortal entry precondition (CI-only)', () => {
  test.beforeEach(() => {
    test.skip(!isCI, 'CI-only E2E suite');
  });

  test('reaches the entry point on a fresh WelcomePortal boot', async ({ page }) => {
    await page.goto('/');
    await ensureWelcomePortalEntry(page);
    await expect(page.getByTestId('welcome-portal')).toBeVisible();
  });

  test('reaches the entry point when a non-English language is already persisted', async ({
    page,
  }) => {
    // QNBS-v3: the helper's contract is locale-independent portal-reached, not English — assert the stable testid, not the translated button label.
    await page.addInitScript(() => localStorage.setItem('worldscript-language', 'es'));
    await page.goto('/');
    await ensureWelcomePortalEntry(page);
    await expect(page.getByTestId('welcome-portal')).toBeVisible();
  });

  test('reaches the entry point from an already-mounted main shell with a persisted project', async ({
    page,
  }) => {
    await page.goto('/');
    await ensureBlankProject(page);
    // QNBS-v3: waits for the debounced autosave to land so this scenario specifically exercises the full Settings/Factory Reset fallback, which does normalize to English as an implementation detail.
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

  test('reaches the entry point via the recovery flow with a persisted non-English language, on Mobile Chrome and desktop alike', async ({
    page,
  }) => {
    // QNBS-v3: a fresh boot lands on the portal regardless of locale — this combines a persisted main-chrome project with a non-English language so a mobile "More"-button locale regression actually fails, on every project including Mobile Chrome.
    await page.goto('/');
    await ensureBlankProject(page);
    await expect(page.getByText(/All changes saved/i)).toBeVisible({ timeout: 10000 });
    await page.addInitScript(() => localStorage.setItem('worldscript-language', 'es'));
    await page.reload();
    await waitForMainChrome(page);
    // QNBS-v3: asserts the applied locale, not just the persisted seed — a broken addInitScript or a failed es bundle load could otherwise pass this test vacuously in English.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await ensureWelcomePortalEntry(page);
    await expect(page.getByTestId('welcome-portal')).toBeVisible();
  });

  test('reaches the entry point when its own internal reload can race a pending autosave', async ({
    page,
  }) => {
    // QNBS-v3: deliberately does not wait for "All changes saved" — the helper's own English-normalization reload can race the pending debounced save either way, and it must end in the portal regardless.
    await page.goto('/');
    await ensureBlankProject(page);
    await ensureWelcomePortalEntry(page);
    await expect(page.getByTestId('welcome-portal')).toBeVisible();
  });
});
