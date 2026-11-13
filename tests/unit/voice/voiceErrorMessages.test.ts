import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_STT_UNAVAILABLE_MESSAGE } from '../../../services/voice/sttEngine';
import { localizeVoiceError, VOICE_ERROR_KEYS } from '../../../services/voice/voiceErrorMessages';
import { WEB_SPEECH_LOCAL_ONLY_MESSAGE } from '../../../services/voice/webSpeechConsent';

const localesDir = join(process.cwd(), 'locales');
const locales = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const common = (locale: string) =>
  JSON.parse(readFileSync(join(localesDir, locale, 'common.json'), 'utf8')) as Record<
    string,
    string
  >;

// #1282: voice errors reached users in English only; each known one now has a key in every locale.
describe('voice error messages', () => {
  it.each(locales)(
    '%s has every voice error key, and the announcement keeps its placeholder',
    (locale) => {
      const strings = common(locale);
      for (const key of [...VOICE_ERROR_KEYS.values(), 'voice.error.announce']) {
        expect(strings[key], `${locale} ${key}`).toBeTruthy();
      }
      expect(strings['voice.error.announce']).toContain('{{message}}');
    },
  );

  it('translates a known error and passes any other message through', () => {
    const t = (key: string) => `t:${key}`;
    expect(localizeVoiceError(LOCAL_STT_UNAVAILABLE_MESSAGE, t)).toBe(
      't:voice.error.localSttUnavailable',
    );
    expect(localizeVoiceError(WEB_SPEECH_LOCAL_ONLY_MESSAGE, t)).toBe(
      't:voice.error.webSpeechLocalOnly',
    );
    expect(localizeVoiceError('Speech recognition error: network', t)).toBe(
      'Speech recognition error: network',
    );
  });

  it('the English locale says exactly what the service reports for the reasons it names', () => {
    const en = common('en');
    expect(en['voice.error.webSpeechLocalOnly']).toBe(WEB_SPEECH_LOCAL_ONLY_MESSAGE);
    expect(en['voice.error.localSttUnavailable']).toBe(LOCAL_STT_UNAVAILABLE_MESSAGE);
  });
});
