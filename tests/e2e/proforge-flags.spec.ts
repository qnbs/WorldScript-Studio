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
    // QNBS-v3: Desktop and Mobile Chrome both run in CI. Pick the correct button by viewport
    // because writer-proforge-btn-desktop is md:hidden on mobile (Pixel 5 = 393px wide).
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    const btnTestId =
      viewportWidth < 768 ? 'writer-proforge-btn-mobile' : 'writer-proforge-btn-desktop';
    const btn = page.getByTestId(btnTestId);
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', /Activate ProForge Pipeline/i);
  });

  test('clicking ProForge toggle activates the pipeline dashboard', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    const isMobile = viewportWidth < 768;
    const btn = page.getByTestId(
      isMobile ? 'writer-proforge-btn-mobile' : 'writer-proforge-btn-desktop',
    );
    await expect(btn).toBeVisible({ timeout: 10000 });
    // On mobile, the tools tab must be active before clicking the toggle
    if (isMobile) {
      await page.getByTestId('writer-tab-tools').click();
    }
    await btn.click();

    // Pipeline dashboard heading must appear
    await expect(page.getByRole('heading', { name: /Ultimate Author Pipeline/i })).toBeVisible({
      timeout: 10000,
    });
    // Toggle reflects active state
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('ProForge empty state renders when no run is active', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    const isMobile = viewportWidth < 768;
    const btn = page.getByTestId(
      isMobile ? 'writer-proforge-btn-mobile' : 'writer-proforge-btn-desktop',
    );
    await expect(btn).toBeVisible({ timeout: 10000 });
    if (isMobile) {
      await page.getByTestId('writer-tab-tools').click();
    }
    await btn.click();

    // QNBS-v3: ProForgeDashboard renders in both the desktop grid and the CSS-hidden mobile panel
    // (md:hidden). .first() picked the hidden mobile instance on Desktop Chrome.
    // .filter({ visible: true }) resolves to the only visible instance regardless of viewport.
    await expect(page.getByTestId('proforge-empty-state').filter({ visible: true })).toBeVisible({
      timeout: 10000,
    });
  });
});

// QNBS-v3: Moved to a separate describe so its beforeEach seeds enableProForge:false.
// Putting this test inside the enableProForge:true group and doing a mid-test localStorage
// override + reload is broken: addInitScript re-runs on reload and overwrites the override.
test.describe('ProForge Pipeline — flag disabled', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableProForge: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('disabling ProForge flag hides the toggle', async ({ page }) => {
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    // Both desktop and mobile buttons must be absent
    await expect(page.getByTestId('writer-proforge-btn-desktop')).not.toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId('writer-proforge-btn-mobile')).not.toBeVisible({
      timeout: 5000,
    });
  });
});
