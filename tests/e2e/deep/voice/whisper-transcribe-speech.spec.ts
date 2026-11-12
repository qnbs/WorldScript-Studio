import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { dictateInto, downloadRealSttModel, fakeMic, speechWav } from './whisperTranscribeFlow';

// Evidence (never merged, #556); see whisperTranscribeFlow.ts for the path under test.
test.use({ launchOptions: { args: fakeMic(speechWav) } });
test.setTimeout(360_000);

test('transcribes generated speech into the manuscript', async ({ page }) => {
  test.skip(!existsSync(speechWav), 'no generated speech WAV');
  await downloadRealSttModel(page);
  const textarea = await dictateInto(page);
  await expect(textarea).toHaveValue(/hello|world|dictation|test/i, { timeout: 120_000 });
  // The speech is synthetic (espeak-ng), so the evidence log may record exactly what Whisper wrote.
  await page.waitForTimeout(8_000);
  console.log(`[evidence] transcript: ${JSON.stringify(await textarea.inputValue())}`);
});
