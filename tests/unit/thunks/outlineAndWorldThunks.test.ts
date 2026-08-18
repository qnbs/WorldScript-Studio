import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: localStorageOnly defaults true in settingsReducer — bypass the cloud-AI gate so thunks can run.
vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

// Must be mocked before imports
vi.mock('../../../features/project/thunks/thunkUtils', () => ({
  loadAiProvider: vi.fn(),
  loadPrompts: vi.fn(),
  buildAiOptions: vi.fn().mockReturnValue({ provider: 'gemini' }),
  buildAiCreativity: vi.fn().mockReturnValue('Balanced'),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    saveImage: vi.fn(),
  },
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
import {
  generateWorldImageThunk,
  generateWorldProfileThunk,
  regenerateWorldFieldThunk,
  uploadWorldImageThunk,
} from '../../../features/project/thunks/worldThunks';
import settingsReducer from '../../../features/settings/settingsSlice';
import statusReducer from '../../../features/status/statusSlice';
import versionControlReducer from '../../../features/versionControl/versionControlSlice';
import writerReducer from '../../../features/writer/writerSlice';
import { storageService } from '../../../services/storageService';

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
const mockGenerateText = vi.fn();
const mockGenerateImage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // QNBS-v3: partial module mock — cast to avoid requiring every export of the full module
  vi.mocked(loadPrompts).mockResolvedValue({ getPrompts: mockGetPrompts } as never);
  vi.mocked(loadAiProvider).mockResolvedValue({
    generateJson: mockGenerateJson,
    generateText: mockGenerateText,
    generateImage: mockGenerateImage,
    streamText: vi.fn(),
  } as never);
  mockGetPrompts.mockReturnValue({ prompt: 'test-prompt', schema: {} });
  mockGenerateJson.mockResolvedValue([]);
  vi.mocked(storageService.saveImage).mockResolvedValue(undefined);
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

// QNBS-v3: regenerateWorldFieldThunk/generateWorldImageThunk were only mocked out in hook tests, never actually exercised — these protect the fulfilled payload, prompt args, persistence call, and rejection path.
describe('regenerateWorldFieldThunk', () => {
  const world = {
    id: 'w1',
    name: 'Eldoria',
    description: 'Old description',
    geography: '',
    magicSystem: '',
    culture: '',
    notes: '',
    timeline: [],
    locations: [],
  };

  it('dispatches fulfilled with { field, value }', async () => {
    mockGenerateText.mockResolvedValueOnce('New description text');
    const store = makeStore();
    const action = await store.dispatch(
      regenerateWorldFieldThunk({ world, field: 'description', lang: 'en' }),
    );

    expect(action.type).toBe('project/regenerateWorldField/fulfilled');
    const payload = (action as { payload: { field: string; value: string } }).payload;
    expect(payload.field).toBe('description');
    expect(payload.value).toBe('New description text');
  });

  it('passes the world and field to getPrompts', async () => {
    mockGenerateText.mockResolvedValueOnce('value');
    const store = makeStore();
    await store.dispatch(regenerateWorldFieldThunk({ world, field: 'description', lang: 'de' }));

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'regenerateWorldField',
      expect.objectContaining({ world, field: 'description', lang: 'de' }),
    );
  });

  it('rejects on AI error', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('AI down'));
    const store = makeStore();
    const action = await store.dispatch(
      regenerateWorldFieldThunk({ world, field: 'description', lang: 'en' }),
    );

    expect(action.type).toBe('project/regenerateWorldField/rejected');
  });
});

describe('generateWorldImageThunk', () => {
  it('dispatches fulfilled with worldId', async () => {
    mockGenerateImage.mockResolvedValueOnce('worldimagebase64');
    const store = makeStore();
    const action = await store.dispatch(
      generateWorldImageThunk({ worldId: 'w1', description: 'A misty forest', lang: 'en' }),
    );

    expect(action.type).toBe('project/generateWorldImage/fulfilled');
    expect((action as { payload: { worldId: string } }).payload.worldId).toBe('w1');
  });

  it('saves the generated image via storageService', async () => {
    mockGenerateImage.mockResolvedValueOnce('worldimagedata');
    const store = makeStore();
    await store.dispatch(
      generateWorldImageThunk({ worldId: 'w42', description: 'A volcanic wasteland', lang: 'en' }),
    );

    expect(storageService.saveImage).toHaveBeenCalledWith('w42', 'worldimagedata');
  });

  it('rejects on AI error', async () => {
    mockGenerateImage.mockRejectedValueOnce(new Error('generation failed'));
    const store = makeStore();
    const action = await store.dispatch(
      generateWorldImageThunk({ worldId: 'w1', description: 'A sunken city', lang: 'en' }),
    );

    expect(action.type).toBe('project/generateWorldImage/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });
});

// QNBS-v3: FileReader error/abort and storageService.saveImage-rejection coverage prevents the upload thunk's Promise from hanging forever on any terminal failure path.
describe('uploadWorldImageThunk', () => {
  it('reads file as a MIME-preserving data URL', async () => {
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA';
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: fakeDataUrl, configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onload === 'function')
          this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['fake image data'], 'atlas.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w99', file }));

    expect(action.type).toBe('project/uploadWorldImage/fulfilled');
    expect(storageService.saveImage).toHaveBeenCalledWith('w99', fakeDataUrl);
  });

  it('rejects when the FileReader errors', async () => {
    const readerError = new Error('read failed');
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'error', { value: readerError, configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onerror === 'function')
          this.onerror(new ProgressEvent('error') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['data'], 'broken.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w1', file }));

    expect(action.type).toBe('project/uploadWorldImage/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  // QNBS-v3: covers the `reader.error ?? new Error(...)` fallback branch — a browser could fire onerror with a null/undefined reader.error, which must still reject instead of leaving the upload thunk pending.
  it('rejects with a fallback error when the FileReader errors without a reader.error', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'error', { value: null, configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onerror === 'function')
          this.onerror(new ProgressEvent('error') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['data'], 'broken.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w8', file }));

    expect(action.type).toBe('project/uploadWorldImage/rejected');
    expect((action as { error: { message?: string } }).error.message).toBe(
      'FileReader failed to read the file',
    );
  });

  it('rejects when the FileReader is aborted', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      void Promise.resolve().then(() => {
        if (typeof this.onabort === 'function')
          this.onabort(new ProgressEvent('abort') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['data'], 'aborted.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w3', file }));

    expect(action.type).toBe('project/uploadWorldImage/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  it('rejects when onload fires but reader.result is not a string', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: null, configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onload === 'function')
          this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['data'], 'weird.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w4', file }));

    expect(action.type).toBe('project/uploadWorldImage/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  it('rejects (does not hang) when storageService.saveImage fails', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', {
        value: 'data:image/png;base64,abc',
        configurable: true,
      });
      void Promise.resolve().then(() => {
        if (typeof this.onload === 'function')
          this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    });
    vi.mocked(storageService.saveImage).mockRejectedValueOnce(new Error('disk full'));

    const store = makeStore();
    const file = new File(['data'], 'atlas.png', { type: 'image/png' });
    const action = await store.dispatch(uploadWorldImageThunk({ worldId: 'w2', file }));

    expect(action.type).toBe('project/uploadWorldImage/rejected');
  });
});
