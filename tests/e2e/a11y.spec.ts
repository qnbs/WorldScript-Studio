/**
 * Automated axe checks on critical routes (runs in CI with Playwright webServer).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

async function assertNoSeriousViolations(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, `${label}: ${JSON.stringify(serious, null, 2)}`).toHaveLength(0);
}

test.describe('Accessibility (axe)', () => {
  // QNBS-v3: emulate prefers-reduced-motion so component animations (e.g. WelcomePortal's
  // fade-in) settle instantly. Without this, axe samples blended mid-animation colors and
  // reports phantom color-contrast failures. page.emulateMedia is well-typed (test.use()
  // rejects reducedMotion in this Playwright version). Scoped here so VRT baselines (captured
  // without reduced motion) stay untouched.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('welcome / home has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    // QNBS-v3: waitForSpaReady instead of domcontentloaded — avoids "Execution context was
    // destroyed" when axe runs while React / i18n init triggers an in-page navigation.
    await waitForSpaReady(page);
    await assertNoSeriousViolations(page, 'welcome');
  });

  test('settings accessibility hub has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await ensureBlankProject(page);
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Accessibility|Barrierefreiheit/i }).click();
    await expect(
      page.getByRole('heading', {
        name: /Accessibility Settings|Barrierefreiheitseinstellungen/i,
      }),
    ).toBeVisible({
      timeout: 15000,
    });
    await assertNoSeriousViolations(page, 'settings-accessibility');
  });

  test('command palette open has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    // QNBS-v3: command-palette-trigger is hidden sm:block (invisible on Mobile Chrome <640px);
    // fall back to Ctrl+K keyboard shortcut which works on all viewports
    const trigger = page.locator('[data-tour="command-palette-trigger"]');
    if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await trigger.click();
    } else {
      await page.keyboard.press('Control+k');
    }
    await expect(page.locator('#command-palette-listbox')).toBeVisible({ timeout: 15000 });
    await assertNoSeriousViolations(page, 'command-palette');
    await page.keyboard.press('Escape');
  });

  test('writer version control panel has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    // QNBS-v3: getByRole — ARIA excludes display:none elements; works for both mobile + desktop VC buttons
    await page.getByRole('button', { name: /Versions/i }).click();
    await expect(page.locator('#version-control-heading')).toBeVisible({ timeout: 15000 });
    await assertNoSeriousViolations(page, 'writer-version-control');
    await page.keyboard.press('Escape');
  });

  test('characters view has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Characters/i);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await assertNoSeriousViolations(page, 'characters-view');
  });

  test('world view has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /World Building/i);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await assertNoSeriousViolations(page, 'world-view');
  });

  test('plot board has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Scene Board/i);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await assertNoSeriousViolations(page, 'plot-board');
  });

  test('help view has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Help/i);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await assertNoSeriousViolations(page, 'help-view');
  });

  // QNBS-v3: Validate dark sepia ("Candlelit Manuscript") contrast tokens.
  // Emulate dark color scheme so getSystemThemePreference() → 'dark'; the default
  // appearancePreset:'sepia' in settingsSlice triggers .dark-theme.appearance-sepia,
  // exercising the new token set (primary 14.7:1, muted 5.3:1 on worst-case bg).
  test('dark sepia theme has no serious axe violations', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    // Confirm dark-theme + appearance-sepia are both applied before running axe
    await page.waitForFunction(
      () =>
        document.body.classList.contains('dark-theme') &&
        document.body.classList.contains('appearance-sepia'),
      { timeout: 8000 },
    );
    await assertNoSeriousViolations(page, 'dark-sepia-home');
    // Also test settings panel (most token-dense view)
    await clickNavItem(page, /Settings/i);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await assertNoSeriousViolations(page, 'dark-sepia-settings');
  });
});
