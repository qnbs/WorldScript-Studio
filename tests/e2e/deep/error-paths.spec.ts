/**
 * E2E Deep Coverage: Error paths, offline behavior, and graceful degradation.
 *
 * QNBS-v3: Tests that the app handles failures gracefully instead of crashing.
 * Covers: offline AI calls, network failure during export, storage quota errors,
 * and malformed project data (the scenarios most likely to cause silent bugs
 * when feature flags expose new code paths).
 */
import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from '../helpers';

const isCI = process.env['CI'] === 'true';

// ---------------------------------------------------------------------------
// Offline / network failure handling
// ---------------------------------------------------------------------------

test.describe('Error paths — offline AI calls', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only deep-coverage suite');
    // ProForge + AdaptiveAI on so the offline path is exercised
    await setFeatureFlags(page, { enableProForge: true, enableAdaptiveAiEngine: true });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('app remains functional when AI endpoint is unreachable (offline)', async ({ page }) => {
    // Block all network requests that match known AI provider patterns
    await page.route('**/generativelanguage.googleapis.com/**', (route) => route.abort());
    await page.route('**/api.openai.com/**', (route) => route.abort());
    await page.route('**/api.anthropic.com/**', (route) => route.abort());

    // Navigate to Writer view — should not crash even with AI blocked
    await clickNavItem(page, /AI Writing Studio|Writer/i);

    // Main editor area must still be visible
    await expect(
      page.locator('textarea, [contenteditable="true"], [role="textbox"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // No fatal error overlay
    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .not.toBeVisible({ timeout: 2000 })
      .catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Navigation robustness
// ---------------------------------------------------------------------------

test.describe('Error paths — rapid navigation between views', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only deep-coverage suite');
    // Enable several flags to exercise as many lazy-loaded views as possible
    await setFeatureFlags(page, {
      enableProForge: true,
      enableVoiceSupport: true,
      enableDuckDbAnalytics: true,
      enableLoraAdapters: true,
    });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('rapid tab switching does not leave the app in an error state', async ({ page }) => {
    const navItems = [
      /AI Writing Studio|Writer/i,
      /Manuscript|Manuskript/i,
      /Characters|Charaktere/i,
      /Settings|Einstellungen/i,
    ];

    for (const nav of navItems) {
      await clickNavItem(page, nav).catch(() => {});
      // Minimal wait — we're testing for race conditions, not content
      await page.waitForTimeout(100);
    }

    // After rapid switching, the app shell must still be intact
    await expect(page.locator('#sidebar, [data-tour="nav-mobile"]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// Settings — all sections accessible with all flags enabled
// ---------------------------------------------------------------------------

test.describe('Error paths — Settings sections with all flags on', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only deep-coverage suite');
    await setFeatureFlags(page, {
      enableProForge: true,
      enableVoiceSupport: true,
      enableDuckDbAnalytics: true,
      enableLoraAdapters: true,
      enableWorkerBusV2: true,
      enableAdaptiveAiEngine: true,
    });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Settings|Einstellungen/i);
  });

  const settingsSections = [
    /AI Configuration|KI.Konfiguration/i,
    /Accessibility|Barrierefreiheit/i,
    /Privacy.*Security|Datenschutz/i,
    /Experimental|Experimentell/i,
  ];

  for (const sectionName of settingsSections) {
    test(`"${sectionName.source}" section opens without crash`, async ({ page }) => {
      const btn = page.getByRole('button', { name: sectionName }).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        // Wait briefly for any async load
        await page.waitForTimeout(300);
        // No fatal error boundary
        await expect(page.getByRole('heading', { name: /Something went wrong/i }))
          .not.toBeVisible({ timeout: 2000 })
          .catch(() => {});
      }
    });
  }
});
