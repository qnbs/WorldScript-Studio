import { describe, expect, it } from 'vitest';
import {
  sttEngineChoice,
  sttEngineUnderEco,
  ttsEngineChoice,
} from '../../../services/voice/engineChoice';

// #1261/#556: the settings stored 'wasm' for "Local WASM model (offline)"; no engine has that id.
describe('voice engine choice', () => {
  it('reads the legacy local choice as the local engine of each kind', () => {
    expect(sttEngineChoice('wasm')).toBe('whisper');
    expect(ttsEngineChoice('wasm')).toBe('kokoro');
  });

  it('keeps every real engine id as stored', () => {
    for (const id of ['auto', 'whisper', 'webSpeech'] as const)
      expect(sttEngineChoice(id)).toBe(id);
    for (const id of ['auto', 'kokoro', 'piper', 'webSpeech'] as const) {
      expect(ttsEngineChoice(id)).toBe(id);
    }
  });

  it('reads an unknown or missing value as auto, never as a cloud engine', () => {
    for (const stored of ['cloud', '', undefined, null, 3]) {
      expect(sttEngineChoice(stored)).toBe('auto');
      expect(ttsEngineChoice(stored)).toBe('auto');
    }
  });

  it('does not accept an engine id of the other kind', () => {
    expect(sttEngineChoice('kokoro')).toBe('auto');
    expect(ttsEngineChoice('whisper')).toBe('auto');
  });
});

// #1261: Eco Mode may trade the local engine for Web Speech only when the user left the choice on auto.
describe('voice engine choice under Eco Mode', () => {
  it('keeps an explicit choice and turns only auto into Web Speech', () => {
    expect(sttEngineUnderEco('whisper', true)).toBe('whisper');
    expect(sttEngineUnderEco('webSpeech', true)).toBe('webSpeech');
    expect(sttEngineUnderEco('auto', true)).toBe('webSpeech');
    expect(sttEngineUnderEco('auto', false)).toBe('auto');
  });
});
