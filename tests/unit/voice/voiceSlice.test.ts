import { describe, expect, it } from 'vitest';
import voiceSliceReducer, {
  appendVoiceTranscript,
  resetVoiceState,
  setDictationActive,
  setLastConfidence,
  setMicrophonePermission,
  setSttStatus,
  setVoiceError,
  setVoiceMode,
  setVoiceTranscript,
} from '../../../features/voice/voiceSlice';

describe('voiceSlice', () => {
  const initialState = voiceSliceReducer(undefined, { type: '@@INIT' });

  it('has correct initial state', () => {
    expect(initialState.mode).toBe('inactive');
    expect(initialState.transcript).toBe('');
    expect(initialState.processing).toBe(false);
    expect(initialState.microphonePermission).toBe('unknown');
  });

  it('sets voice mode', () => {
    const next = voiceSliceReducer(initialState, setVoiceMode('listening'));
    expect(next.mode).toBe('listening');
    expect(next.lastActivityAt).not.toBeNull();
  });

  it('sets transcript', () => {
    const next = voiceSliceReducer(initialState, setVoiceTranscript('hello world'));
    expect(next.transcript).toBe('hello world');
  });

  it('appends transcript', () => {
    const s1 = voiceSliceReducer(initialState, setVoiceTranscript('hello'));
    const s2 = voiceSliceReducer(s1, appendVoiceTranscript('world'));
    expect(s2.transcript).toBe('hello world');
  });

  it('handles dictation active', () => {
    const next = voiceSliceReducer(initialState, setDictationActive(true));
    expect(next.dictationActive).toBe(true);
    expect(next.mode).toBe('dictating');
  });

  it('resets state', () => {
    const s1 = voiceSliceReducer(initialState, setVoiceMode('listening'));
    const s2 = voiceSliceReducer(s1, resetVoiceState());
    expect(s2.mode).toBe('inactive');
    expect(s2.transcript).toBe('');
  });

  it('sets error and resets mode', () => {
    const s1 = voiceSliceReducer(initialState, setVoiceMode('listening'));
    const s2 = voiceSliceReducer(s1, setVoiceError('microphone denied'));
    expect(s2.error).toBe('microphone denied');
    expect(s2.mode).toBe('inactive');
  });

  it('sets confidence', () => {
    const next = voiceSliceReducer(initialState, setLastConfidence(0.95));
    expect(next.lastConfidence).toBe(0.95);
  });

  it('resets confidence when a fresh listening cycle starts', () => {
    const withConfidence = voiceSliceReducer(initialState, setLastConfidence(0.9));
    const listening = voiceSliceReducer(withConfidence, setVoiceMode('listening'));
    expect(listening.lastConfidence).toBe(0);
  });

  it('resets confidence when dictation starts (setDictationActive)', () => {
    const withConfidence = voiceSliceReducer(initialState, setLastConfidence(0.9));
    const dictating = voiceSliceReducer(withConfidence, setDictationActive(true));
    expect(dictating.lastConfidence).toBe(0);
    expect(dictating.mode).toBe('dictating');
  });

  it('keeps confidence when staying in the same mode', () => {
    const listening = voiceSliceReducer(initialState, setVoiceMode('listening'));
    const withConfidence = voiceSliceReducer(listening, setLastConfidence(0.8));
    // Re-dispatching the same mode must not wipe a confidence set mid-session.
    const same = voiceSliceReducer(withConfidence, setVoiceMode('listening'));
    expect(same.lastConfidence).toBe(0.8);
  });

  it('sets microphone permission', () => {
    const next = voiceSliceReducer(initialState, setMicrophonePermission('granted'));
    expect(next.microphonePermission).toBe('granted');
  });

  it('sets engine status', () => {
    const next = voiceSliceReducer(initialState, setSttStatus('ready'));
    expect(next.sttStatus).toBe('ready');
  });
});
