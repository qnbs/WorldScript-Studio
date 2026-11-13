/**
 * Locale keys for the voice errors the service and engines report as English text. QNBS-v3 (#1282): the presentation
 * translates a known error at the point it is shown or announced; any other message passes through unchanged.
 */
import { ConsentRequiredError, LOCAL_STT_UNAVAILABLE_MESSAGE } from './sttEngine';
import { NO_STT_ENGINE_MESSAGE, VOICE_INIT_FAILED_MESSAGE } from './voiceCommandService';
import { WEB_SPEECH_LOCAL_ONLY_MESSAGE } from './webSpeechConsent';

export const VOICE_ERROR_KEYS: ReadonlyMap<string, string> = new Map([
  [new ConsentRequiredError().message, 'voice.error.consentRequired'],
  [LOCAL_STT_UNAVAILABLE_MESSAGE, 'voice.error.localSttUnavailable'],
  [WEB_SPEECH_LOCAL_ONLY_MESSAGE, 'voice.error.webSpeechLocalOnly'],
  [NO_STT_ENGINE_MESSAGE, 'voice.error.noSttEngine'],
  [VOICE_INIT_FAILED_MESSAGE, 'voice.error.initFailed'],
]);

/** The message in the user's language when it is a known voice error; otherwise the message itself. */
export function localizeVoiceError(message: string, t: (key: string) => string): string {
  const key = VOICE_ERROR_KEYS.get(message);
  return key ? t(key) : message;
}
