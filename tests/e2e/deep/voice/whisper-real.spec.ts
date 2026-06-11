/**
 * E2E (deep, NIGHTLY, non-blocking): Whisper WASM STT — REAL model download + pipeline init.
 *
 * QNBS-v3: P1-2 — Complements the deterministic whisper-stt.spec.ts (which mocks inference).
 * This suite uses NO test seam: it downloads the real `Xenova/whisper-tiny.en` weights via
 * @huggingface/transformers and initializes the real pipeline, validating that the production
 * model path works against the live CDN. It is slow + network-dependent, so it runs only in the
 * nightly `voice-nightly.yml` workflow, gated by RUN_REAL_VOICE_E2E=1, and never blocks PRs.
 *
 * Follow-up (needs a committed speech fixture): drive real transcription by feeding a WAV via the
 * Chromium flag `--use-file-for-fake-audio-capture=<fixture.wav>` and asserting a tolerant
 * substring match on the transcript. Tracked in TODO.md (P1-2 remaining).
 */
import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from '../../helpers';

const runReal = process.env['RUN_REAL_VOICE_E2E'] === '1';

test.describe('Whisper real model download (nightly)', () => {
  // Real weight download + pipeline init is slow; give it room.
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    test.skip(!runReal, 'Set RUN_REAL_VOICE_E2E=1 to run the real-inference nightly suite');
    await setFeatureFlags(page, { enableVoiceSupport: true, enableVoiceWasm: true });
  });

  test('downloads the real Whisper model and the modal completes', async ({ page }) => {
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);

    await clickNavItem(page, /Settings/i);
    await page.getByRole('button', { name: /Voice.*Speech|Sprache/i }).click();
    const voiceToggle = page
      .getByRole('switch', { name: /Enable voice|Voice commands|Sprachbefehle/i })
      .first();
    await expect(voiceToggle).toBeVisible({ timeout: 10000 });
    if ((await voiceToggle.getAttribute('aria-checked')) !== 'true') {
      await voiceToggle.click();
    }

    await page.getByTestId('voice-wasm-download-section').scrollIntoViewIfNeeded();
    await page
      .getByRole('button', { name: /Download STT|Whisper/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // Real download + pipeline init succeeds → the modal closes (wasmModelsReady dispatched).
    await expect(dialog).toBeHidden({ timeout: 220_000 });
  });
});
