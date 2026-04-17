import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTTS } from '../../hooks/useTTS';

describe('useTTS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports supported when speechSynthesis is available', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.isSupported).toBe(true);
  });

  it('starts speaking when speak() is called', () => {
    let capturedUtt: SpeechSynthesisUtterance | null = null;
    vi.spyOn(window.speechSynthesis, 'speak').mockImplementation((utt) => {
      capturedUtt = utt;
      // Simulate browser triggering onstart immediately
      if (utt.onstart) utt.onstart(new Event('start') as SpeechSynthesisEvent);
    });

    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak('Hallo Welt', 'de-DE');
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalled();
    expect(capturedUtt).not.toBeNull();
    expect(result.current.isSpeaking).toBe(true);
  });

  it('stops speaking when stop() is called', () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak('Hallo', 'de-DE');
    });

    act(() => {
      result.current.stop();
    });

    // cancel() is called multiple times (in speak(), stop(), and cleanup effect)
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('speaks with correct text and language', () => {
    const { result } = renderHook(() => useTTS());
    const captured: SpeechSynthesisUtterance[] = [];

    vi.spyOn(window.speechSynthesis, 'speak').mockImplementation((utt) => {
      captured.push(utt);
    });

    act(() => {
      result.current.speak('Test text', 'en-US');
    });

    expect(captured[0]?.text).toBe('Test text');
    expect(captured[0]?.lang).toBe('en-US');
  });
});
