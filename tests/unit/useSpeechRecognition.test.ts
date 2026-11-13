import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStoreRef } from '../../app/storeRef';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { registerWebSpeechConsentPrompt } from '../../services/voice/webSpeechConsent';

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

/** Installs a SpeechRecognition stand-in and returns how often recognition was started. */
function installSpeechRecognition() {
  const started = { count: 0 };
  function speechRecognitionConstructor(this: Record<string, unknown>) {
    this['continuous'] = false;
    this['interimResults'] = false;
    this['lang'] = '';
    this['onresult'] = null;
    this['onend'] = null;
    this['onerror'] = null;
    this['start'] = () => {
      started.count += 1;
    };
    this['stop'] = vi.fn();
  }
  (window as { SpeechRecognition?: unknown }).SpeechRecognition = speechRecognitionConstructor;
  return started;
}

/** A store reference that holds only the Web Speech consent; `grant` flips it like the dialog does. */
function consentStore(granted: boolean) {
  const voice = { webSpeechConsentGranted: granted };
  appStoreRef.current = {
    getState: () => ({ settings: { voice } }),
    dispatch: vi.fn(),
  } as unknown as typeof appStoreRef.current;
  return {
    grant: () => {
      voice.webSpeechConsentGranted = true;
    },
  };
}

type ConsentStore = ReturnType<typeof consentStore>;
type Prompt = ((store: ConsentStore) => Promise<boolean>) | undefined;

describe('useSpeechRecognition (with mocked SpeechRecognition)', () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
    appStoreRef.current = null;
  });

  /** Renders the hook with the stored consent and the consent dialog given, starts it, and reports the outcome. */
  async function start(granted: boolean, prompt: Prompt, via: 'start' | 'toggle' = 'start') {
    const started = installSpeechRecognition();
    const store = consentStore(granted);
    const ask = vi.fn(async () => (prompt ? prompt(store) : false));
    if (prompt) unregister = registerWebSpeechConsentPrompt(ask);
    const { result } = renderHook(() => useSpeechRecognition());
    await act(async () => {
      if (via === 'toggle') result.current.toggleListening();
      else await result.current.startListening();
    });
    return {
      started: started.count,
      listening: result.current.isListening,
      asked: ask.mock.calls.length,
    };
  }

  const grantInDialog: Prompt = async (store) => {
    store.grant();
    return true;
  };

  // #1261: the editor mic started Web Speech, which sends audio to the browser vendor, without any consent check.
  it.each([
    ['a stored consent starts at once', true, undefined, { started: 1, listening: true, asked: 0 }],
    [
      'without consent and no dialog nothing starts',
      false,
      undefined,
      { started: 0, listening: false, asked: 0 },
    ],
    [
      'a declined dialog starts nothing',
      false,
      async () => false,
      { started: 0, listening: false, asked: 1 },
    ],
    [
      'granting consent in the dialog starts recognition',
      false,
      grantInDialog,
      { started: 1, listening: true, asked: 1 },
    ],
    [
      'a yes that was not stored starts nothing',
      false,
      async () => true,
      { started: 0, listening: false, asked: 1 },
    ],
  ] as const)('%s', async (_name, granted, prompt, expected) => {
    expect(await start(granted, prompt)).toEqual(expected);
  });

  // The dictation control goes away, or its owner stops it (the command palette closes), while the consent dialog is open.
  it.each(['unmounts', 'is stopped'] as const)(
    'a start still waiting for consent when the control %s never starts recognition',
    async (end) => {
      const started = installSpeechRecognition();
      const store = consentStore(false);
      let answer: (granted: boolean) => void = () => {};
      unregister = registerWebSpeechConsentPrompt(
        () => new Promise<boolean>((resolve) => (answer = resolve)),
      );
      const { result, unmount } = renderHook(() => useSpeechRecognition());
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.startListening();
      });
      if (end === 'unmounts') unmount();
      else act(() => result.current.stopListening());
      store.grant();
      answer(true);
      await act(async () => {
        await pending;
      });
      expect(started.count).toBe(0);
      expect(result.current.isListening).toBe(false);
    },
  );

  it('the mic toggle asks for consent the same way', async () => {
    expect(await start(false, async () => false, 'toggle')).toEqual({
      started: 0,
      listening: false,
      asked: 1,
    });
  });
});
