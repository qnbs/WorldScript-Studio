/**
 * Evidence (never merged, #556): real Whisper transcription through the app's own path, not the Web Speech mic button.
 * VoiceControlPanel dictation → voiceCommandService (VAD coordinator → Whisper STT) → setVoiceTranscript → useVoiceDictation
 * → the manuscript textarea. Chromium plays a CI-generated WAV as the microphone (--use-file-for-fake-audio-capture).
 */
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from '../../helpers';

// The evidence workflow writes these (untracked) before the run; locally the tests skip.
export const speechWav = resolve('.voice-fixtures/speech.wav');
export const silenceWav = resolve('.voice-fixtures/silence.wav');
export const fakeMic = (wav: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
];

export async function downloadRealSttModel(page: Page): Promise<void> {
  // Mirror the app's voice logs and errors into the job log, so a dictation that never starts says why.
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || /voice|stt|whisper|vad|dictation/i.test(text)) {
      console.log(`[browser:${message.type()}] ${text.slice(0, 400)}`);
    }
  });
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

export async function dictateInto(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await clickNavItem(page, /Manuscript/i);
  const textarea = page.getByTestId('manuscript-editor-textarea').first();
  await expect(textarea).toBeVisible({ timeout: 20000 });
  await textarea.click();
  // The voice panel is the region "Voice Control"; the editor's own mic buttons use the Web Speech API instead.
  const panel = page.getByRole('region', { name: 'Voice Control' });
  await panel.getByRole('button', { name: /Start dictation/i }).click();
  await expect(page.getByRole('status', { name: /Voice status/i })).not.toHaveText(/inactive/i, {
    timeout: 30_000,
  });
  return textarea;
}
