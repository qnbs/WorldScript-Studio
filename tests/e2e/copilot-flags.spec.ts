/**
 * E2E: Global AI Copilot — smoke tests with enableGlobalCopilot flag explicitly seeded.
 *
 * QNBS-v3: Flag is on by default, but seeding it here makes intent explicit and guards against
 * future default changes (feature-flag coverage illusion). Tests only the UI scaffold (launcher
 * visible, panel opens/focus-traps, empty state, off-state hidden, heuristics-only toggle,
 * sidebar mode toggle); no AI calls are made.
 */
import { expect, test } from '@playwright/test';

import { ensureBlankProject, selectEnglish, setFeatureFlags, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Global AI Copilot (feature-flag explicit)', () => {
  test('launcher visible and panel opens when enabled', async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableGlobalCopilot: true });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    // QNBS-v3: the launcher mounts inside the main app shell, which only renders once the
    // WelcomePortal is dismissed (isPortalActive). Without a project the portal stays up and the
    // FAB is never in the DOM — create a blank project first so this asserts real behaviour.
    await ensureBlankProject(page);

    const launcher = page.getByRole('button', { name: /Open AI Copilot/i });
    await expect(launcher).toBeVisible({ timeout: 10000 });
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');

    await launcher.click();

    const dialog = page.getByRole('dialog', { name: /AI Copilot/i });
    await expect(dialog).toBeVisible();
    // Empty-state greeting + composer present.
    await expect(dialog.getByText(/I'm your Copilot/i)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Send$/i })).toBeVisible();

    // Close restores the launcher.
    await dialog.getByRole('button', { name: /Close AI Copilot/i }).click();
    await expect(launcher).toBeVisible();
  });

  test('launcher hidden when disabled', async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableGlobalCopilot: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    // QNBS-v3: enter the shell so this is a real off-state assertion (the portal hides the launcher
    // regardless of the flag, which would make this pass trivially).
    await ensureBlankProject(page);

    await expect(page.getByRole('button', { name: /Open AI Copilot/i })).toHaveCount(0);
  });

  test('heuristics-only toggle is accessible and toggleable', async ({ page }) => {
    // QNBS-v3: Phase 3 — guards that the Heuristics Only toggle renders and reflects state.
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableGlobalCopilot: true });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);

    await page.getByRole('button', { name: /Open AI Copilot/i }).click();
    const dialog = page.getByRole('dialog', { name: /AI Copilot/i });
    await expect(dialog).toBeVisible();

    // QNBS-v3: element has role="switch" + aria-checked (ARIA switch pattern, not button+aria-pressed)
    const toggle = dialog.getByRole('switch', { name: /Heuristics only/i });
    await expect(toggle).toBeVisible();
    // Default state: not checked.
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('sidebar mode toggle is present on desktop viewport', async ({ page }) => {
    // QNBS-v3: Phase 3 — guards sidebar/dialog toggle renders on md+ screens.
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableGlobalCopilot: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);

    await page.getByRole('button', { name: /Open AI Copilot/i }).click();
    const dialog = page.getByRole('dialog', { name: /AI Copilot/i });
    await expect(dialog).toBeVisible();

    // Mode toggle is visible on desktop; label is "Dock sidebar" in dialog mode.
    const modeBtn = dialog.getByRole('button', { name: /Dock sidebar/i });
    await expect(modeBtn).toBeVisible();
    await modeBtn.click();
    // After toggling to sidebar, label becomes "Float panel".
    await expect(dialog.getByRole('button', { name: /Float panel/i })).toBeVisible();
  });
});
