/**
 * Evidence (never merged, #556): real Whisper transcription through the app's own path, not the Web Speech mic button.
 * VoiceControlPanel dictation → voiceCommandService (VAD coordinator → Whisper STT) → setVoiceTranscript → useVoiceDictation
 * → the manuscript textarea. Chromium plays a CI-generated WAV as the microphone (--use-file-for-fake-audio-capture).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from '../../helpers';

// The evidence workflow writes these (untracked) before the run; locally the tests skip.
const speechWav = resolve('.voice-fixtures/speech.wav');
const silenceWav = resolve('.voice-fixtures/silence.wav');
const fakeMic = (wav: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
];

async function downloadRealSttModel(page: Page): Promise<void> {
  await setFeatureFlags(page, { enableVoiceSupport: true, enableVoiceWasm: true });
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
  if ((await voiceToggle.getAttribute('aria-checked')) !== 'true') await voiceToggle.click();
  await page.getByTestId('voice-wasm-download-section').scrollIntoViewIfNeeded();
  await page
    .getByRole('button', { name: /Download STT|Whisper/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toBeHidden({ timeout: 220_000 });
}

async function dictateInto(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await clickNavItem(page, /Manuscript/i);
  const textarea = page.getByTestId('manuscript-editor-textarea').first();
  await expect(textarea).toBeVisible({ timeout: 20000 });
  await textarea.click();
  // The panel's buttons carry aria-pressed; the editor's Web Speech mic button does not.
  await page
    .getByRole('button', { name: /dictation/i, pressed: false })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /dictation/i, pressed: true }).first()).toBeVisible(
    {
      timeout: 10000,
    },
  );
  return textarea;
}

test.describe('Whisper real transcription (evidence, #556)', () => {
  test.setTimeout(360_000);

  test.describe('speech', () => {
    test.use({ launchOptions: { args: fakeMic(speechWav) } });
    test('transcribes generated speech into the manuscript', async ({ page }) => {
      test.skip(!existsSync(speechWav), 'no generated speech WAV');
      await downloadRealSttModel(page);
      const textarea = await dictateInto(page);
      await expect(textarea).toHaveValue(/hello|world|dictation|test/i, { timeout: 120_000 });
    });
  });

  test.describe('silence (negative control)', () => {
    test.use({ launchOptions: { args: fakeMic(silenceWav) } });
    test('inserts nothing while the microphone is silent', async ({ page }) => {
      test.skip(!existsSync(silenceWav), 'no generated silence WAV');
      await downloadRealSttModel(page);
      const textarea = await dictateInto(page);
      const before = await textarea.inputValue();
      await page.waitForTimeout(30_000);
      expect(await textarea.inputValue()).toBe(before);
    });
  });
});
