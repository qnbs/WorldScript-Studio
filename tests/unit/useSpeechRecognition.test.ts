import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

beforeEach(() => {
  // jsdom has no SpeechRecognition — ensure it's absent
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSpeechRecognition (no browser API available)', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.micError).toBeNull();
  });

  it('startListening is a no-op when SpeechRecognition is unavailable', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(result.current.micError).toBeNull();
  });

  it('stopListening is a no-op when not listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.stopListening();
    });
    expect(result.current.isListening).toBe(false);
  });

  it('toggleListening is a no-op when SpeechRecognition is unavailable', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.toggleListening();
    });
    expect(result.current.isListening).toBe(false);
  });

  it('setTranscript updates transcript directly', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.setTranscript('hello world');
    });
    expect(result.current.transcript).toBe('hello world');
  });
});

describe('useSpeechRecognition (with mocked SpeechRecognition)', () => {
  it('startListening sets isListening to true', () => {
    const started = { called: false };
    function MockSpeechRecognition(this: Record<string, unknown>) {
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onend = null;
      this.onerror = null;
      this.start = () => {
        started.called = true;
      };
      this.stop = vi.fn();
    }
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });

    expect(started.called).toBe(true);
    expect(result.current.isListening).toBe(true);
  });
});
