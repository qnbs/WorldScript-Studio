import { describe, expect, it } from 'vitest';
import { createVadEngine, WebRtcVadEngine } from '../../../services/voice/vadEngine';
import type { AudioChunk } from '../../../services/voice/voiceTypes';

function makeChunk(samples: number[], durationMs = 100): AudioChunk {
  const buffer = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    buffer[i] = samples[i]!;
  }
  return {
    buffer,
    durationMs,
    hasSpeech: false,
    capturedAt: Date.now(),
  };
}

describe('WebRtcVadEngine', () => {
  let engine: WebRtcVadEngine;

  it('is always available', async () => {
    engine = new WebRtcVadEngine();
    expect(await engine.isAvailable()).toBe(true);
  });

  it('initializes state', async () => {
    engine = new WebRtcVadEngine();
    await engine.initialize();
    const silentChunk = makeChunk(new Array(100).fill(0));
    // Silent chunks should not trigger speech
    for (let i = 0; i < 10; i++) {
      const result = await engine.processChunk(silentChunk);
      expect(result).toBeNull();
    }
  });

  it('detects speech after threshold frames', async () => {
    engine = new WebRtcVadEngine();
    // High amplitude samples (> threshold)
    const loudSamples = new Array(100).fill(10000);
    const loudChunk = makeChunk(loudSamples);

    // First 2 frames below minSpeechFrames should not trigger
    expect(await engine.processChunk(loudChunk)).toBeNull();
    expect(await engine.processChunk(loudChunk)).toBeNull();

    // Third frame should trigger speech start (minSpeechFrames = 3)
    const result = await engine.processChunk(loudChunk);
    expect(result).not.toBeNull();
    expect(result!.isSpeech).toBe(true);
  });

  it('detects silence end after threshold frames', async () => {
    engine = new WebRtcVadEngine();
    const loudSamples = new Array(100).fill(10000);
    const silentSamples = new Array(100).fill(0);

    // Establish speech
    const loudChunk = makeChunk(loudSamples);
    for (let i = 0; i < 3; i++) {
      await engine.processChunk(loudChunk);
    }

    // Now send silent chunks
    const silentChunk = makeChunk(silentSamples);
    await engine.processChunk(silentChunk);
    await engine.processChunk(silentChunk);
    await engine.processChunk(silentChunk);
    await engine.processChunk(silentChunk);

    // Fifth silent frame should trigger end (minSilenceFrames = 5)
    const endResult = await engine.processChunk(silentChunk);
    expect(endResult).not.toBeNull();
    expect(endResult!.isSpeech).toBe(false);
  });

  it('returns null during ongoing speech without state change', async () => {
    engine = new WebRtcVadEngine();
    const loudSamples = new Array(100).fill(10000);
    const loudChunk = makeChunk(loudSamples);

    // Trigger speech start
    await engine.processChunk(loudChunk);
    await engine.processChunk(loudChunk);
    const start = await engine.processChunk(loudChunk);
    expect(start).not.toBeNull();

    // Additional loud chunks should return null (no state change)
    expect(await engine.processChunk(loudChunk)).toBeNull();
    expect(await engine.processChunk(loudChunk)).toBeNull();
  });

  it('disposes cleanly', async () => {
    engine = new WebRtcVadEngine();
    await engine.dispose();
    expect(await engine.isAvailable()).toBe(true);
  });
});

describe('createVadEngine', () => {
  it('returns WebRtcVadEngine', async () => {
    const engine = await createVadEngine();
    expect(engine.name).toBe('WebRTC VAD (energy-based)');
  });
});
