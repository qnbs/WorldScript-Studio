import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageToolMatch } from '../../services/languageToolService';

const mocks = vi.hoisted(() => ({
  language: 'en',
  enabled: true,
  baseUrl: 'http://localhost:8010',
  dictionary: [] as string[],
  manuscript: [{ id: 'sec1', content: 'She go home.' }] as Array<{ id: string; content: string }>,
  dispatch: vi.fn(),
  checkText: vi.fn(),
  applyMatchReplacement: vi.fn(),
  assertAllowed: vi.fn(),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        integrations: {
          languageToolEnabled: mocks.enabled,
          languageToolBaseUrl: mocks.baseUrl,
        },
        advancedEditor: { customDictionary: mocks.dictionary },
        privacy: { localStorageOnly: true },
      },
      project: { present: { data: { manuscript: mocks.manuscript } } },
    }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: mocks.language }),
}));

vi.mock('../../services/languageToolClient', () => ({
  assertLanguageToolAllowed: (...args: unknown[]) => mocks.assertAllowed(...args),
}));

vi.mock('../../services/languageToolService', () => ({
  checkText: mocks.checkText,
  applyMatchReplacement: mocks.applyMatchReplacement,
}));

import { useLanguageToolCheck } from '../../hooks/useLanguageToolCheck';

function ltMatch(over: Partial<LanguageToolMatch> = {}): LanguageToolMatch {
  return {
    offset: 4,
    length: 2,
    message: 'Agreement',
    shortMessage: 'Agreement',
    replacements: ['goes'],
    ruleId: 'AGREEMENT',
    category: 'GRAMMAR',
    categoryName: 'Grammar',
    matchedText: 'go',
    isSpelling: false,
    ...over,
  };
}

function checkSignal(): AbortSignal {
  const options = mocks.checkText.mock.calls.at(-1)?.[2] as { signal?: AbortSignal } | undefined;
  if (!options?.signal) throw new Error('checkText was not called with an abort signal');
  return options.signal;
}

describe('useLanguageToolCheck', () => {
  beforeEach(() => {
    mocks.language = 'en';
    mocks.enabled = true;
    mocks.baseUrl = 'http://localhost:8010';
    mocks.dictionary = [];
    mocks.manuscript = [{ id: 'sec1', content: 'She go home.' }];
    mocks.dispatch.mockReset();
    mocks.checkText.mockReset().mockResolvedValue({ matches: [ltMatch()], status: 'ok' });
    mocks.applyMatchReplacement.mockReset().mockReturnValue('She goes home.');
    mocks.assertAllowed.mockReset();
  });

  it('reports availability from locale + enabled flag', () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    expect(result.current.available).toBe(true);
    expect(result.current.unsupportedLocale).toBe(false);
  });

  it('flags an unsupported locale and check() short-circuits', async () => {
    mocks.language = 'ko';
    const { result } = renderHook(() => useLanguageToolCheck());
    expect(result.current.unsupportedLocale).toBe(true);
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.status).toBe('unsupported');
    expect(mocks.checkText).not.toHaveBeenCalled();
  });

  it('sets disabled when the privacy gate rejects', async () => {
    mocks.assertAllowed.mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.status).toBe('disabled');
    expect(mocks.checkText).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown section id', async () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('missing');
    });
    expect(mocks.checkText).not.toHaveBeenCalled();
  });

  it('surfaces offline and error statuses from the service', async () => {
    mocks.checkText.mockResolvedValue({ matches: [], status: 'offline' });
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.status).toBe('offline');

    mocks.checkText.mockResolvedValue({ matches: [], status: 'error' });
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.status).toBe('error');
  });

  // #1126: a check that started against one endpoint must not land after the endpoint changed.
  it('drops a running check when the endpoint changes', async () => {
    let resolveCheck: (value: { matches: LanguageToolMatch[]; status: string }) => void = () => {};
    mocks.checkText.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const { result, rerender } = renderHook(() => useLanguageToolCheck());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.check('sec1');
    });
    const signal = checkSignal();
    mocks.baseUrl = 'https://languagetool.example.org';
    rerender();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveCheck({ matches: [ltMatch()], status: 'ok' });
      await pending;
    });
    expect(result.current.matches).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('cancels a running check on unmount', () => {
    mocks.checkText.mockReturnValueOnce(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useLanguageToolCheck());
    act(() => {
      void result.current.check('sec1');
    });
    const signal = checkSignal();
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('stores matches on a successful check', async () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.status).toBe('ok');
    expect(result.current.matches).toHaveLength(1);
  });

  it('applies a suggestion → dispatches an update and re-checks', async () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    mocks.checkText.mockClear();
    act(() => {
      result.current.applySuggestion('sec1', ltMatch(), 'goes');
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.checkText).toHaveBeenCalledTimes(1)); // re-check
  });

  it('does not dispatch when the apply is a no-op (stale anchor)', () => {
    mocks.applyMatchReplacement.mockReturnValue('She go home.'); // unchanged
    const { result } = renderHook(() => useLanguageToolCheck());
    act(() => {
      result.current.applySuggestion('sec1', ltMatch(), 'goes');
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('adds a new word to the dictionary and drops its spelling matches', async () => {
    mocks.checkText.mockResolvedValue({
      matches: [ltMatch({ matchedText: 'Gandalf', isSpelling: true })],
      status: 'ok',
    });
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    act(() => {
      result.current.addToDictionary('Gandalf');
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(result.current.matches).toHaveLength(0);
  });

  it('does not persist a word already in the dictionary', () => {
    mocks.dictionary = ['gandalf'];
    const { result } = renderHook(() => useLanguageToolCheck());
    act(() => {
      result.current.addToDictionary('Gandalf');
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('ignores a blank dictionary word', () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    act(() => {
      result.current.addToDictionary('   ');
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('ignore() removes a single match; clear() resets', async () => {
    const { result } = renderHook(() => useLanguageToolCheck());
    await act(async () => {
      await result.current.check('sec1');
    });
    expect(result.current.matches).toHaveLength(1);
    act(() => {
      result.current.ignore(ltMatch());
    });
    expect(result.current.matches).toHaveLength(0);

    act(() => {
      result.current.clear();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.matches).toEqual([]);
  });
});
