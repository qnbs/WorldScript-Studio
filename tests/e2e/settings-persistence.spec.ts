/**
 * QNBS-v3 (#332/D1): the desktop (Tauri) build never read persisted state back at cold boot —
 * every save routed through the Tauri-aware `storageService`, but the boot-time hydration path
 * read raw IndexedDB unconditionally, so every desktop launch loaded as a brand-new user. The fix
 * (`services/appBootstrap.ts`) is unit-tested directly for the `isTauriRuntime()` branch selection
 * (mock-based, since CI has no packaged-desktop-build job). This spec instead exercises the
 * REAL Redux → listenerMiddleware → storageService → reload → boot-hydration round trip end to
 * end on the web-build CI runner, which shares the same Redux/listener/storageService chain — it
 * does not, and cannot, verify the Tauri filesystem branch itself; that remains an open item per
 * docs/ISSUES-332-333-PERFORMANCE-LEDGER.md until a packaged `.deb` is measured.
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
    // QNBS-v3: settings autosave is debounced (~1s, app/listenerMiddleware.ts) — give it time to
    // land before reloading, or the reload could race the write and read back the pre-toggle value.
    await page.waitForTimeout(1500);

    await page.reload();
    await waitForSpaReady(page);
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Accessibility|Barrierefreiheit/i }).click();

    const toggleAfterReload = page.getByRole('switch', { name: 'Reduce transparency effects' });
    await expect(toggleAfterReload).toBeVisible({ timeout: 15000 });
    await expect(toggleAfterReload).toHaveAttribute('aria-checked', 'true');
    // QNBS-v3: App.tsx's body-class effect (index.css's worldscript-reduced-transparency rule)
    // confirms the persisted setting actually reached Redux state, not just the toggle's own UI state.
    await expect(page.locator('body')).toHaveClass(/worldscript-reduced-transparency/);
  });
});
