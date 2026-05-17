import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must be mocked before imports
vi.mock('../../../features/project/thunks/thunkUtils', () => ({
  loadAiProvider: vi.fn(),
  loadPrompts: vi.fn(),
  buildAiOptions: vi.fn().mockReturnValue({ provider: 'gemini' }),
}));

import featureFlagsReducer from '../../../features/featureFlags/featureFlagsSlice';
import projectReducer, { projectActions } from '../../../features/project/projectSlice';
import {
  generateCustomTemplateThunk,
  generateOutlineThunk,
  personalizeTemplateThunk,
  regenerateOutlineSectionThunk,
} from '../../../features/project/thunks/outlineThunks';
import { loadAiProvider, loadPrompts } from '../../../features/project/thunks/thunkUtils';
import { generateWorldProfileThunk } from '../../../features/project/thunks/worldThunks';
import settingsReducer from '../../../features/settings/settingsSlice';
import statusReducer from '../../../features/status/statusSlice';
import versionControlReducer from '../../../features/versionControl/versionControlSlice';
import writerReducer from '../../../features/writer/writerSlice';

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeStore() {
  return configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      status: statusReducer,
      writer: writerReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
    },
  });
}

const mockGetPrompts = vi.fn();
const mockGenerateJson = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // QNBS-v3: partial module mock — cast to avoid requiring every export of the full module
  vi.mocked(loadPrompts).mockResolvedValue({ getPrompts: mockGetPrompts } as never);
  vi.mocked(loadAiProvider).mockResolvedValue({
    generateJson: mockGenerateJson,
    generateText: vi.fn(),
    generateImage: vi.fn(),
    streamText: vi.fn(),
  } as never);
  mockGetPrompts.mockReturnValue({ prompt: 'test-prompt', schema: {} });
  mockGenerateJson.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Outline thunks
// ---------------------------------------------------------------------------

describe('generateOutlineThunk', () => {
  it('fulfills with the AI response', async () => {
    mockGenerateJson.mockResolvedValueOnce([{ id: 'o1', title: 'Ch1' }]);
    const store = makeStore();
    const result = await store.dispatch(
      generateOutlineThunk({ genre: 'fantasy', lang: 'en', title: 'Test' } as never),
    );
    expect(result.type).toBe('project/generateOutline/fulfilled');
    expect((result as { payload: unknown[] }).payload).toHaveLength(1);
  });

  it('rejects on AI error', async () => {
    mockGenerateJson.mockRejectedValueOnce(new Error('AI down'));
    const store = makeStore();
    const result = await store.dispatch(
      generateOutlineThunk({ genre: 'fantasy', lang: 'en', title: 'T' } as never),
    );
    expect(result.type).toBe('project/generateOutline/rejected');
  });
});

describe('regenerateOutlineSectionThunk', () => {
  it('fulfills with index and new section', async () => {
    mockGenerateJson.mockResolvedValueOnce({ id: 'o2', title: 'New Ch' });
    const store = makeStore();
    const result = await store.dispatch(
      regenerateOutlineSectionThunk({
        allSections: [{ id: 'o1', title: 'Old', description: '' }],
        sectionToIndex: 0,
        lang: 'en',
      }),
    );
    expect(result.type).toBe('project/regenerateOutlineSection/fulfilled');
    const payload = (result as { payload: { index: number } }).payload;
    expect(payload.index).toBe(0);
  });
});

describe('personalizeTemplateThunk', () => {
  it('fulfills with AI response', async () => {
    mockGenerateJson.mockResolvedValueOnce([{ title: 'Ch 1', prompt: '' }]);
    const store = makeStore();
    const result = await store.dispatch(
      personalizeTemplateThunk({
        sections: [{ title: 'Intro' }],
        concept: 'A dragon story',
        lang: 'en',
      }),
    );
    expect(result.type).toBe('project/personalizeTemplate/fulfilled');
  });
});

describe('generateCustomTemplateThunk', () => {
  it('fulfills with titles array', async () => {
    mockGenerateJson.mockResolvedValueOnce([{ title: 'Ch A' }]);
    const store = makeStore();
    const result = await store.dispatch(
      generateCustomTemplateThunk({ concept: 'sci-fi', lang: 'en', chapterCount: 5 } as never),
    );
    expect(result.type).toBe('project/generateCustomTemplate/fulfilled');
  });
});

// ---------------------------------------------------------------------------
// World thunks
// ---------------------------------------------------------------------------

describe('projectActions.addWorld', () => {
  it('adds a world to the project', () => {
    const store = makeStore();
    const before = store.getState().project.present.data.worlds.ids.length;
    store.dispatch(projectActions.addWorld({ name: 'Middle Earth' }));
    const after = store.getState().project.present.data.worlds.ids.length;
    expect(after).toBe(before + 1);
  });
});

describe('projectActions.deleteWorld', () => {
  it('removes a world from the project', () => {
    const store = makeStore();
    store.dispatch(projectActions.addWorld({ name: 'Narnia' }));
    const ids = store.getState().project.present.data.worlds.ids;
    const id = ids[ids.length - 1] as string;
    store.dispatch(projectActions.deleteWorld(id));
    const afterIds = store.getState().project.present.data.worlds.ids;
    expect(afterIds.includes(id)).toBe(false);
  });
});

describe('generateWorldProfileThunk', () => {
  it('fulfills with AI-generated world data', async () => {
    mockGenerateJson.mockResolvedValueOnce({ name: 'Eldoria', description: 'A magical realm' });
    const store = makeStore();
    const result = await store.dispatch(
      generateWorldProfileThunk({ concept: 'magic forest', lang: 'en' }),
    );
    expect(result.type).toBe('project/generateWorldProfile/fulfilled');
  });

  it('rejects on AI error', async () => {
    mockGenerateJson.mockRejectedValueOnce(new Error('network error'));
    const store = makeStore();
    const result = await store.dispatch(
      generateWorldProfileThunk({ concept: 'space', lang: 'en' }),
    );
    expect(result.type).toBe('project/generateWorldProfile/rejected');
  });
});
