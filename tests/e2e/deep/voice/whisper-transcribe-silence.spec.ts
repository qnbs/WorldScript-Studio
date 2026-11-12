import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { dictateInto, downloadRealSttModel, fakeMic, silenceWav } from './whisperTranscribeFlow';

// Evidence (never merged, #556); see whisperTranscribeFlow.ts for the path under test.
test.use({ launchOptions: { args: fakeMic(silenceWav) } });
test.setTimeout(360_000);

test('inserts nothing while the microphone is silent', async ({ page }) => {
  test.skip(!existsSync(silenceWav), 'no generated silence WAV');
  await downloadRealSttModel(page);
  const textarea = await dictateInto(page);
  const before = await textarea.inputValue();
  await page.waitForTimeout(30_000);
  expect(await textarea.inputValue()).toBe(before);
});
