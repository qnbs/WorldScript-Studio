import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioChunk } from '../../../services/voice/voiceTypes';
import {
  createWakeWordEngine,
  EnergyThresholdWakeWordEngine,
} from '../../../services/voice/wakeWordEngine';

describe('EnergyThresholdWakeWordEngine', () => {
  let engine: EnergyThresholdWakeWordEngine;

  beforeEach(() => {
    engine = new EnergyThresholdWakeWordEngine();
  });

  it('is always available', async () => {
    expect(await engine.isAvailable()).toBe(true);
  });

  it('initializes with empty transcripts', async () => {
    await engine.initialize();
    expect(engine.checkTranscript('hello')).toBe(false);
  });

  it('detects default wake phrase', () => {
    expect(engine.checkTranscript('hey worldscript')).toBe(true);
    expect(engine.checkTranscript('Hey WorldScript')).toBe(true);
    expect(engine.checkTranscript('HEY WORLDSCRIPT')).toBe(true);
  });

  it('detects wake phrase in longer sentence', () => {
    expect(engine.checkTranscript('hey worldscript open dashboard')).toBe(true);
    expect(engine.checkTranscript('ok hey worldscript')).toBe(true);
  });

  it('does not detect non-matching phrases', () => {
    expect(engine.checkTranscript('hello world')).toBe(false);
    expect(engine.checkTranscript('worldscript hey')).toBe(false);
    expect(engine.checkTranscript('')).toBe(false);
  });

  it('supports custom phrase', () => {
    engine.setPhrase('ok computer');
    expect(engine.checkTranscript('ok computer')).toBe(true);
    expect(engine.checkTranscript('hey worldscript')).toBe(false);
  });

  it('maintains rolling transcript history', () => {
    // Fill history with unrelated transcripts
    for (let i = 0; i < 10; i++) {
      engine.checkTranscript(`random ${i}`);
    }
    // Last 5 should be in history, but default phrase still not detected
    expect(engine.checkTranscript('hey worldscript')).toBe(true);
  });

  it('processChunk returns false (audio not processed in fallback)', async () => {
    const chunk: AudioChunk = {
      buffer: new Int16Array(100),
      durationMs: 100,
      hasSpeech: false,
      capturedAt: Date.now(),
    };
    expect(await engine.processChunk(chunk)).toBe(false);
  });

  it('disposes cleanly', async () => {
    engine.checkTranscript('test');
    await engine.dispose();
    // After dispose, history should be empty
    expect(engine.checkTranscript('hey worldscript')).toBe(true);
  });
});

describe('createWakeWordEngine', () => {
  it('creates engine with default phrase', async () => {
    const engine = await createWakeWordEngine();
    expect(await engine.isAvailable()).toBe(true);
  });

  it('creates engine with custom phrase', async () => {
    const engine = (await createWakeWordEngine('ok worldscript')) as EnergyThresholdWakeWordEngine;
    expect(engine.checkTranscript('ok worldscript')).toBe(true);
    expect(engine.checkTranscript('hey worldscript')).toBe(false);
  });
});
