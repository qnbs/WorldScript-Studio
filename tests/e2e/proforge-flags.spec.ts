/**
 * E2E: ProForge pipeline — smoke tests with enableProForge flag explicitly set.
 *
 * QNBS-v3: Classic "feature-flag coverage illusion" fix — the flag is on by default since v1.21,
 * but explicitly seeding it here makes intent clear and guards against future default changes.
 * Tests only the UI scaffold (toggle, panel heading, empty state); no AI calls are made.
 */
import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('ProForge Pipeline (feature-flag explicit)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    // QNBS-v3: Seed the flag before app JS loads so the Writer panel renders the ProForge toggle.
    await setFeatureFlags(page, { enableProForge: true });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /AI Writing Studio|Writer/i);
  });

  test('ProForge toggle button is present in Writer view', async ({ page }) => {
    // Desktop viewport — the ProForge button is hidden on mobile
    const btn = page.getByTestId('writer-proforge-btn-desktop');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', /Activate ProForge Pipeline/i);
  });

  test('clicking ProForge toggle activates the pipeline dashboard', async ({ page }) => {
    const btn = page.getByTestId('writer-proforge-btn-desktop');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    // Pipeline dashboard heading must appear
    await expect(page.getByRole('heading', { name: /Ultimate Author Pipeline/i })).toBeVisible({
      timeout: 10000,
    });
    // Toggle reflects active state
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('ProForge empty state renders when no run is active', async ({ page }) => {
    const btn = page.getByTestId('writer-proforge-btn-desktop');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    // Empty-state copy confirms the pipeline is ready and waiting, not errored
    await expect(page.getByText(/Your manuscript, refined\.|refined/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test('disabling ProForge flag hides the toggle', async ({ page }) => {
    // Override to OFF after first load — do a second navigation to re-init Redux
    await page.evaluate(() => {
      try {
        localStorage.setItem('storycraft-feature-flags', JSON.stringify({ enableProForge: false }));
      } catch {
        /* ignore */
      }
    });
    await page.reload();
    await waitForSpaReady(page);
    await clickNavItem(page, /AI Writing Studio|Writer/i);

    const btn = page.getByTestId('writer-proforge-btn-desktop');
    await expect(btn).not.toBeVisible({ timeout: 5000 });
  });
});
