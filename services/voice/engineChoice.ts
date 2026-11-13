/**
 * Engine choice — reads a stored voice engine preference as a real engine id.
 * The settings stored 'wasm' ("Local WASM model (offline)") in both selects, and no engine has that id: the STT
 * factory then picked Web Speech (cloud) and the TTS factory never tried Kokoro, so the offline choice was ignored.
 * QNBS-v3 (#1261/#556): the legacy 'wasm' now reads as the local engine the user chose.
 */

import type { VoiceSttEngine, VoiceTtsEngine } from '../../types';

const LEGACY_LOCAL_CHOICE = 'wasm';
const STT_ENGINES: readonly VoiceSttEngine[] = ['auto', 'whisper', 'webSpeech'];
const TTS_ENGINES: readonly VoiceTtsEngine[] = ['auto', 'kokoro', 'piper', 'webSpeech'];

/** The STT engine a stored preference asks for: the legacy local choice means Whisper, anything unknown means auto. */
export function sttEngineChoice(stored: unknown): VoiceSttEngine {
  if (stored === LEGACY_LOCAL_CHOICE) return 'whisper';
  return STT_ENGINES.find((engine) => engine === stored) ?? 'auto';
}

/**
 * The STT engine to use while Eco Mode saves power: only `auto` becomes Web Speech. An explicit on-device choice stays
 * on-device, because Web Speech can send the audio to the browser vendor (#1261).
 */
export function sttEngineUnderEco(choice: VoiceSttEngine, eco: boolean): VoiceSttEngine {
  return eco && choice === 'auto' ? 'webSpeech' : choice;
}

/** The TTS engine a stored preference asks for: the legacy local choice means Kokoro, anything unknown means auto. */
export function ttsEngineChoice(stored: unknown): VoiceTtsEngine {
  if (stored === LEGACY_LOCAL_CHOICE) return 'kokoro';
  return TTS_ENGINES.find((engine) => engine === stored) ?? 'auto';
}
