import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSttEngine, WebSpeechSttEngine } from '../../../services/voice/sttEngine';
import type { SttResult } from '../../../services/voice/voiceTypes';

function createMockRecognition() {
  return {
    continuous: false,
    interimResults: false,
    lang: '',
    onresult: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe('WebSpeechSttEngine', () => {
  let engine: WebSpeechSttEngine;

  beforeEach(() => {
    engine = new WebSpeechSttEngine();
  });

  it('reports availability based on browser support', async () => {
    vi.stubGlobal('window', {
      SpeechRecognition: vi.fn(),
    });
    expect(await engine.isAvailable()).toBe(true);
  });

  it('initializes without errors', async () => {
    await expect(engine.initialize()).resolves.toBeUndefined();
  });

  it('starts recognition and routes results', async () => {
    const mockRecognition = createMockRecognition();

    // QNBS-v3: Use a plain function (not arrow) so it works with `new`.
    const MockCtor = vi.fn(() => mockRecognition) as unknown as new () => ReturnType<
      typeof createMockRecognition
    >;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    const onResult = vi.fn();
    const onError = vi.fn();

    await engine.start(onResult, onError);

    expect(mockRecognition.start).toHaveBeenCalled();
    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.interimResults).toBe(true);

    // Simulate final result
    const lastResult = [
      {
        transcript: 'hello world',
        confidence: 0.95,
      },
    ] as unknown as SpeechRecognitionAlternative;
    Object.defineProperty(lastResult, 'isFinal', { value: true });

    const resultEvent = {
      results: [lastResult],
    } as unknown as SpeechRecognitionEvent;
    mockRecognition.onresult?.(resultEvent);

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining<SttResult>({
        transcript: 'hello world',
        confidence: 0.95,
        isFinal: true,
      }),
    );
  });

  it('ignores no-speech and aborted errors', async () => {
    const mockRecognition = createMockRecognition();
    const MockCtor = vi.fn(() => mockRecognition) as unknown as new () => ReturnType<
      typeof createMockRecognition
    >;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    const onError = vi.fn();
    await engine.start(vi.fn(), onError);

    mockRecognition.onerror?.({ error: 'no-speech' });
    expect(onError).not.toHaveBeenCalled();

    mockRecognition.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('auto-restarts on unexpected end', async () => {
    const mockRecognition = createMockRecognition();
    const MockCtor = vi.fn(() => mockRecognition) as unknown as new () => ReturnType<
      typeof createMockRecognition
    >;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    await engine.start(vi.fn(), vi.fn());
    mockRecognition.onend?.();

    expect(mockRecognition.start).toHaveBeenCalledTimes(2);
  });

  it('stops recognition gracefully', async () => {
    const mockRecognition = createMockRecognition();
    const MockCtor = vi.fn(() => mockRecognition) as unknown as new () => ReturnType<
      typeof createMockRecognition
    >;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    await engine.start(vi.fn(), vi.fn());
    await engine.stop();

    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it('disposes and cleans up', async () => {
    await expect(engine.dispose()).resolves.toBeUndefined();
  });
});

describe('createSttEngine', () => {
  beforeEach(() => {
    const MockCtor = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      continuous: false,
      interimResults: false,
      lang: '',
      onresult: null,
      onerror: null,
      onend: null,
    })) as unknown as new () => unknown;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });
  });

  it('selects webSpeech engine by default', async () => {
    const engine = await createSttEngine();
    expect(engine.id).toBe('webSpeech');
  });

  it('falls back when preferred engine is unavailable', async () => {
    const engine = await createSttEngine({ preferredEngine: 'whisper' });
    expect(engine.id).toBe('webSpeech');
  });
});
