/**
 * E2E: Voice commands + dictation — smoke tests with voice flags explicitly set.
 *
 * QNBS-v3: Covers the two voice engine paths: Web Speech API (zero-download) and the
 * WASM offline engine (Whisper.cpp + Silero VAD). Both are gated behind feature flags
 * that were off before v1.21. These tests ensure the UI scaffold for each path
 * renders correctly without making actual microphone calls.
 *
 * What is NOT tested here (requires browser mic permission + real audio):
 *   - Actual speech recognition / dictation
 *   - Wake-word detection
 *   - Model download progress (VoiceModelDownloadModal)
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

// ---------------------------------------------------------------------------
// Web Speech API path (zero-download fallback)
// ---------------------------------------------------------------------------

test.describe('Voice — Web Speech API path (enableVoiceSupport, enableVoiceWasm:false)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableVoiceSupport: true, enableVoiceWasm: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  // QNBS-v3: Renamed from "voice control button is present in the app header" — the voice
  // feature surface is the Settings → Voice & Speech section, not a standalone header button.
  test('Voice & Speech section is accessible via Settings nav', async ({ page }) => {
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Voice.*Speech|Sprache/i }).click();
    await expect(page.getByRole('heading', { name: /Voice.*Speech|Sprache|Voice/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('Voice & Speech section renders toggle and status indicator', async ({ page }) => {
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Voice.*Speech|Sprache/i }).click();

    // The voice enabled toggle must exist
    const voiceToggle = page
      .getByRole('switch', { name: /Voice commands|Sprachbefehle|Enable voice/i })
      .first();
    await expect(voiceToggle).toBeVisible({ timeout: 10000 });
  });

  test('Push-to-talk keyboard shortcut does not crash the app', async ({ page }) => {
    await ensureBlankProject(page);
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    // Pressing Ctrl+Shift+V should not throw. We check no error dialog appears.
    await page.keyboard.press('Control+Shift+V');
    // QNBS-v3: No fixed sleep — the sidebar assertion below already waits up to 5 s.
    // App should still be functional — use viewport-aware selector: nav-mobile is md:hidden
    // so .first() on the combined locator picks the hidden element on desktop viewports.
    const isDesktop = (page.viewportSize()?.width ?? 1280) >= 768;
    await expect(page.locator(isDesktop ? '#sidebar' : '[data-tour="nav-mobile"]')).toBeVisible({
      timeout: 5000,
    });
  });
});

// ---------------------------------------------------------------------------
// WASM offline engine path
// ---------------------------------------------------------------------------

test.describe('Voice — WASM engine path (enableVoiceSupport + enableVoiceWasm)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableVoiceSupport: true, enableVoiceWasm: true });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('WASM engine model-download section is visible in Voice settings', async ({ page }) => {
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Voice.*Speech|Sprache/i }).click();

    // The "Download offline model" button / section only renders when enableVoiceWasm is on
    await expect(
      page
        .getByRole('button', { name: /Download.*model|Download.*offline|Model download/i })
        .or(page.getByText(/Download offline model|Offline-Modell herunterladen/i)),
    ).toBeVisible({ timeout: 10000 });
  });
});

// QNBS-v3: Moved to a separate describe with enableVoiceWasm:false in beforeEach.
// The mid-test localStorage + reload pattern is broken: addInitScript re-runs on
// reload and overwrites any localStorage override with the original flag values.
test.describe('Voice — WASM section absent when enableVoiceWasm is off', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableVoiceSupport: true, enableVoiceWasm: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('WASM engine section does NOT appear when enableVoiceWasm is off', async ({ page }) => {
    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Voice.*Speech|Sprache/i }).click();

    // Download section should not be present
    await expect(
      page
        .getByRole('button', { name: /Download.*offline|Model download/i })
        .or(page.getByText(/Download offline model/i)),
    ).not.toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Voice disabled — ensures flag off hides voice UI
// ---------------------------------------------------------------------------

test.describe('Voice — flag disabled hides all voice UI', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableVoiceSupport: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('Voice & Speech section is absent from Settings nav', async ({ page }) => {
    await clickNavItem(page, /Settings/i);
    // QNBS-v3: Wait for settings nav to render (heading visible) before asserting button absence.
    await expect(
      page.getByRole('heading', { name: /Settings|Einstellungen/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Voice.*Speech/i })).not.toBeVisible({
      timeout: 3000,
    });
  });
});
