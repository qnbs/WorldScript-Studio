import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: localStorageOnly defaults true in settingsReducer — bypass the cloud-AI gate so thunks can run.
vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../features/project/thunks/thunkUtils', () => ({
  loadAiProvider: vi.fn(),
  buildAiOptions: vi.fn().mockReturnValue({ provider: 'gemini' }),
  buildAiCreativity: vi.fn().mockReturnValue('Balanced'),
}));

vi.mock('../../../services/ragPromptAssembly', () => ({
  assembleRAGPrompt: vi.fn(),
}));

import featureFlagsReducer from '../../../features/featureFlags/featureFlagsSlice';
import projectReducer from '../../../features/project/projectSlice';
import { suggestNextBeatThunk } from '../../../features/project/thunks/plotBoardAiThunks';
import { loadAiProvider } from '../../../features/project/thunks/thunkUtils';
import settingsReducer from '../../../features/settings/settingsSlice';
import { assembleRAGPrompt } from '../../../services/ragPromptAssembly';

const mockAssemble = vi.mocked(assembleRAGPrompt);
const mockLoadAiProvider = vi.mocked(loadAiProvider);
const mockGenerateJson = vi.fn();

function makeStore() {
  return configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      featureFlags: featureFlagsReducer,
    },
  });
}

const twoChunks = [
  { score: 0.9, text: 'Context A.', sectionId: 's1', chunkIndex: 0, indexedAt: 0 },
  { score: 0.8, text: 'Context B.', sectionId: 's2', chunkIndex: 0, indexedAt: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAssemble.mockResolvedValue({
    prompt: 'Suggest the next story beat.',
    chunks: twoChunks,
    estimatedTokens: 120,
    ragUsed: true,
  });
  mockLoadAiProvider.mockResolvedValue({ generateJson: mockGenerateJson } as never);
  mockGenerateJson.mockResolvedValue({
    beats: [
      {
        title: 'Inciting Incident',
        description: 'Hero discovers the map.',
        suggestedPosition: 'Act 1',
        rationale: 'Sets the story in motion.',
      },
    ],
  });
});

describe('suggestNextBeatThunk', () => {
  it('fulfills with beats array and ragChunkCount', async () => {
    const store = makeStore();
    const result = await store.dispatch(
      suggestNextBeatThunk({
        plotSummary: 'Hero finds a map.',
        selectedSectionIds: ['s1'],
        lang: 'en',
      }),
    );
    expect(result.type).toBe('project/suggestNextBeat/fulfilled');
    const payload = (result as { payload: { beats: unknown[]; ragChunkCount: number } }).payload;
    expect(payload.beats).toHaveLength(1);
    expect(payload.beats[0]).toMatchObject({ title: 'Inciting Incident' });
    expect(payload.ragChunkCount).toBe(2);
  });

  it('calls assembleRAGPrompt with plotSuggestion task and correct context', async () => {
    const store = makeStore();
    await store.dispatch(
      suggestNextBeatThunk({
        plotSummary: 'Hero meets the mentor.',
        selectedSectionIds: [],
        lang: 'de',
      }),
    );
    expect(mockAssemble).toHaveBeenCalledWith(
      'plotSuggestion',
      expect.objectContaining({
        projectId: 'default',
        plotSummary: 'Hero meets the mentor.',
        lang: 'de',
      }),
      expect.objectContaining({ topK: 8, useRag: true, maxTokens: 6000 }),
    );
  });

  it('returns empty beats when generateJson yields null beats', async () => {
    mockGenerateJson.mockResolvedValue({ beats: null });
    const store = makeStore();
    const result = await store.dispatch(
      suggestNextBeatThunk({ plotSummary: 'Test.', selectedSectionIds: [], lang: 'en' }),
    );
    expect(result.type).toBe('project/suggestNextBeat/fulfilled');
    const payload = (result as { payload: { beats: unknown[] } }).payload;
    expect(payload.beats).toEqual([]);
  });

  it('reflects chunk count from assembled prompt in ragChunkCount', async () => {
    const threeChunks = [
      { score: 0.9, text: 'a', sectionId: 's1', chunkIndex: 0, indexedAt: 0 },
      { score: 0.8, text: 'b', sectionId: 's2', chunkIndex: 0, indexedAt: 0 },
      { score: 0.7, text: 'c', sectionId: 's3', chunkIndex: 0, indexedAt: 0 },
    ];
    mockAssemble.mockResolvedValue({
      prompt: 'prompt',
      chunks: threeChunks,
      estimatedTokens: 200,
      ragUsed: true,
    });
    const store = makeStore();
    const result = await store.dispatch(
      suggestNextBeatThunk({ plotSummary: 'Test.', selectedSectionIds: ['s1', 's2'], lang: 'fr' }),
    );
    const payload = (result as { payload: { ragChunkCount: number } }).payload;
    expect(payload.ragChunkCount).toBe(3);
  });

  it('rejects when assembleRAGPrompt throws', async () => {
    mockAssemble.mockRejectedValue(new Error('RAG index offline'));
    const store = makeStore();
    const result = await store.dispatch(
      suggestNextBeatThunk({ plotSummary: 'Test.', selectedSectionIds: [], lang: 'en' }),
    );
    expect(result.type).toBe('project/suggestNextBeat/rejected');
  });

  it('rejects when generateJson throws', async () => {
    mockGenerateJson.mockRejectedValue(new Error('AI provider unavailable'));
    const store = makeStore();
    const result = await store.dispatch(
      suggestNextBeatThunk({ plotSummary: 'Test.', selectedSectionIds: [], lang: 'en' }),
    );
    expect(result.type).toBe('project/suggestNextBeat/rejected');
  });

  it('passes duckDbEnabled flag from featureFlags slice to assembleRAGPrompt', async () => {
    const store = makeStore();
    await store.dispatch(
      suggestNextBeatThunk({ plotSummary: 'Test.', selectedSectionIds: [], lang: 'it' }),
    );
    // QNBS-v3: featureFlags.enableDuckDbAnalytics defaults to false — confirm it reaches assembleRAGPrompt.
    expect(mockAssemble).toHaveBeenCalledWith(
      'plotSuggestion',
      expect.any(Object),
      expect.objectContaining({ duckDbEnabled: false }),
    );
  });
});
