import { describe, expect, it, vi } from 'vitest';

const generateText = vi.fn().mockResolvedValue('ok');

vi.mock('../../features/project/thunks/thunkUtils', () => ({
  loadAiProvider: vi.fn(() =>
    Promise.resolve({
      generateText,
    }),
  ),
}));

describe('aiApi lazy provider load', () => {
  it('loads aiProviderService only when mutation runs', async () => {
    const { loadAiProvider } = await import('../../features/project/thunks/thunkUtils');
    const { aiApi } = await import('../../app/aiApi');

    expect(loadAiProvider).not.toHaveBeenCalled();

    const store = (await import('@reduxjs/toolkit')).configureStore({
      reducer: { [aiApi.reducerPath]: aiApi.reducer },
      middleware: (gDM) => gDM().concat(aiApi.middleware),
    });

    await store.dispatch(
      aiApi.endpoints.generateText.initiate({
        prompt: 'hi',
        creativity: 'Balanced',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      }),
    );

    expect(loadAiProvider).toHaveBeenCalled();
    expect(generateText).toHaveBeenCalled();
  });
});
