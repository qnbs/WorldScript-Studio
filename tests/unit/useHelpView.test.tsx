import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHelpView } from '../../hooks/useHelpView';

const mockStreamAiHelpResponse = vi.fn<
  (
    ...args: [string, string, Record<string, unknown>, { onChunk: (chunk: string) => void }]
  ) => Promise<void>
>(async (_question, _creativity, _opts, callbacks) => {
  callbacks.onChunk('Hello from AI.');
});

const mockState = {
  settings: {
    aiCreativity: 'Balanced',
    advancedAi: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      maxTokens: 4096,
      ollamaBaseUrl: 'http://localhost:11434',
    },
  },
};

vi.mock('../../app/hooks', () => ({
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../services/aiProviderService', () => ({
  streamAiHelpResponse: (...args: Parameters<typeof mockStreamAiHelpResponse>) =>
    mockStreamAiHelpResponse(...args),
}));

describe('useHelpView', () => {
  beforeEach(() => {
    mockStreamAiHelpResponse.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a user prompt and appends AI chunks to chat history', async () => {
    const { result } = renderHook(() => useHelpView());

    act(() => {
      result.current.setUserInput('Hello AI');
    });

    await act(async () => {
      await result.current.handleAskAi();
    });

    expect(mockStreamAiHelpResponse).toHaveBeenCalledWith(
      'Hello AI',
      mockState.settings.aiCreativity,
      expect.objectContaining({ provider: 'gemini', model: 'gemini-2.5-flash' }),
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
    const lastHistoryItem = result.current.chatHistory[result.current.chatHistory.length - 1];
    expect(lastHistoryItem?.text).toContain('Hello from AI.');
    expect(result.current.isAiReplying).toBe(false);
  });

  it('shows an error message when AI fails', async () => {
    mockStreamAiHelpResponse.mockRejectedValueOnce(new Error('Service failed'));
    const { result } = renderHook(() => useHelpView());

    act(() => {
      result.current.setUserInput('Hello AI');
    });

    await act(async () => {
      await result.current.handleAskAi();
    });

    await waitFor(() => {
      const lastHistoryItem = result.current.chatHistory[result.current.chatHistory.length - 1];
      expect(lastHistoryItem?.text).toBe('Sorry, I encountered an error.');
    });
    expect(result.current.isAiReplying).toBe(false);
  });
});
