/**
 * QNBS-v3 (#332/D1): exercises the real Redux→listenerMiddleware→storageService→reload→boot-hydration round trip on the web-build CI runner; cannot verify the Tauri filesystem branch itself (open per docs/ISSUES-332-333-PERFORMANCE-LEDGER.md until a packaged .deb is measured).
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

test.describe('Settings persistence round-trip', () => {
  test('a toggled accessibility setting survives a reload', async ({ page }) => {
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Accessibility|Barrierefreiheit/i }).click();

    const toggle = page.getByRole('switch', { name: 'Reduce transparency effects' });
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // QNBS-v3: settings autosave is debounced (~1s, listenerMiddleware.ts) — wait it out before reloading, matching flushWriterDebounce's established fixed-wait pattern in helpers.ts.
    await page.waitForTimeout(1500);

    await page.reload();
    await waitForSpaReady(page);
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Accessibility|Barrierefreiheit/i }).click();

    const toggleAfterReload = page.getByRole('switch', { name: 'Reduce transparency effects' });
    await expect(toggleAfterReload).toBeVisible({ timeout: 15000 });
    await expect(toggleAfterReload).toHaveAttribute('aria-checked', 'true');
    // QNBS-v3: the body-class effect (index.css's worldscript-reduced-transparency rule) confirms the setting reached Redux state, not just the toggle's own UI state.
    await expect(page.locator('body')).toHaveClass(/worldscript-reduced-transparency/);
  });
});
