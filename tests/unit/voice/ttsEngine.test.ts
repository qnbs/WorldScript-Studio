import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtsEngine, WebSpeechTtsEngine } from '../../../services/voice/ttsEngine';

describe('WebSpeechTtsEngine', () => {
  let engine: WebSpeechTtsEngine;
  let mockSpeak: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engine = new WebSpeechTtsEngine();
    mockSpeak = vi.fn();

    const mockSynthesis = {
      getVoices: vi.fn(() => [{ default: true, name: 'Default Voice' }]),
      speak: mockSpeak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };

    // QNBS-v3: Use a plain function for the constructor so `new` works.
    let activeUtterance: {
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
    } | null = null;

    const MockUtteranceCtor = vi.fn(() => {
      activeUtterance = { onend: null, onerror: null };
      return activeUtterance;
    }) as unknown as new (
      _text: string,
    ) => {
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      rate: number;
      volume: number;
      pitch: number;
      lang: string;
      voice: { default: boolean; name: string } | undefined;
    };

    vi.stubGlobal('window', {
      speechSynthesis: mockSynthesis,
      SpeechSynthesisUtterance: MockUtteranceCtor,
    });

    // Expose active utterance for tests to trigger callbacks
    (
      globalThis as unknown as { __ttsActiveUtterance: typeof activeUtterance }
    ).__ttsActiveUtterance = activeUtterance;
  });

  it('reports availability when speechSynthesis exists', async () => {
    expect(await engine.isAvailable()).toBe(true);
  });

  it('initializes by pre-loading voices', async () => {
    await engine.initialize();
    expect(window.speechSynthesis.getVoices).toHaveBeenCalled();
  });

  it('speaks an utterance and resolves on end', async () => {
    const speakPromise = engine.speak({ text: 'Hello world', rate: 1.2, volume: 0.8 });

    // Trigger end callback on the utterance that was passed to speak()
    const utteranceArg = mockSpeak.mock.calls[0]![0] as {
      onend: (() => void) | null;
    };
    utteranceArg.onend?.();

    await expect(speakPromise).resolves.toBeUndefined();
  });

  it('rejects on speech error', async () => {
    const speakPromise = engine.speak({ text: 'Hello world' });

    const utteranceArg = mockSpeak.mock.calls[0]![0] as {
      onerror: ((event: { error: string }) => void) | null;
    };
    utteranceArg.onerror?.({ error: 'network' });

    await expect(speakPromise).rejects.toThrow('TTS error: network');
  });

  it('rejects when speechSynthesis is unavailable', async () => {
    vi.stubGlobal('window', { speechSynthesis: undefined });

    await expect(engine.speak({ text: 'Hello' })).rejects.toThrow('Speech synthesis not available');
  });

  it('cancels current speech', () => {
    engine.cancel();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('pauses and resumes speech', () => {
    engine.pause();
    expect(window.speechSynthesis.pause).toHaveBeenCalled();

    engine.resume();
    expect(window.speechSynthesis.resume).toHaveBeenCalled();
  });

  it('disposes and cancels', async () => {
    await engine.dispose();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });
});

describe('createTtsEngine', () => {
  beforeEach(() => {
    const MockUtteranceCtor = vi.fn(() => ({ onend: null, onerror: null })) as unknown as new (
      _text: string,
    ) => unknown;

    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: vi.fn(() => []),
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
      SpeechSynthesisUtterance: MockUtteranceCtor,
    });
  });

  it('selects webSpeech engine by default', async () => {
    const engine = await createTtsEngine();
    expect(engine.id).toBe('webSpeech');
  });

  it('falls back when preferred engine is unavailable', async () => {
    const engine = await createTtsEngine({ preferredEngine: 'kokoro' });
    expect(engine.id).toBe('webSpeech');
  });
});
