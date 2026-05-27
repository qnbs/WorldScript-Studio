import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: localStorageOnly defaults true in settingsReducer — bypass the cloud-AI gate so thunks can run.
vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

// Must be mocked before any imports that use them
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
import projectReducer from '../../../features/project/projectSlice';
import {
  generateCharacterPortraitThunk,
  generateCharacterProfileThunk,
  regenerateCharacterFieldThunk,
  uploadCharacterImageThunk,
} from '../../../features/project/thunks/characterThunks';
import { loadAiProvider, loadPrompts } from '../../../features/project/thunks/thunkUtils';
import {
  generateLoglineSuggestionsThunk,
  generateSceneImageThunk,
  generateSynopsisThunk,
  proofreadTextThunk,
  streamGenerationThunk,
} from '../../../features/project/thunks/writingThunks';
import settingsReducer from '../../../features/settings/settingsSlice';
import statusReducer from '../../../features/status/statusSlice';
import versionControlReducer from '../../../features/versionControl/versionControlSlice';
import writerReducer from '../../../features/writer/writerSlice';
import { storageService } from '../../../services/storageService';

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
const mockGenerateText = vi.fn();
const mockGenerateJson = vi.fn();
const mockGenerateImage = vi.fn();
const mockStreamText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(loadPrompts).mockResolvedValue({ getPrompts: mockGetPrompts } as never);
  vi.mocked(loadAiProvider).mockResolvedValue({
    generateText: mockGenerateText,
    generateJson: mockGenerateJson,
    generateImage: mockGenerateImage,
    streamText: mockStreamText,
  } as never);
  vi.mocked(storageService.saveImage).mockResolvedValue(undefined);
  mockGetPrompts.mockReturnValue({ prompt: 'test-prompt', schema: { type: 'array' } });
});

// ---------------------------------------------------------------------------
// generateLoglineSuggestionsThunk
// ---------------------------------------------------------------------------
describe('generateLoglineSuggestionsThunk', () => {
  it('dispatches fulfilled action with string array from generateJson', async () => {
    mockGenerateJson.mockResolvedValue(['Logline one', 'Logline two']);

    const store = makeStore();
    const action = await store.dispatch(generateLoglineSuggestionsThunk('en'));

    expect(action.type).toBe('project/generateLogline/fulfilled');
    expect((action as { payload: string[] }).payload).toEqual(['Logline one', 'Logline two']);
  });

  it('calls loadAiProvider and loadPrompts', async () => {
    mockGenerateJson.mockResolvedValue([]);

    const store = makeStore();
    await store.dispatch(generateLoglineSuggestionsThunk('en'));

    expect(loadAiProvider).toHaveBeenCalled();
    expect(loadPrompts).toHaveBeenCalled();
  });

  it('dispatches rejected action when generateJson throws', async () => {
    mockGenerateJson.mockRejectedValue(new Error('AI unavailable'));

    const store = makeStore();
    const action = await store.dispatch(generateLoglineSuggestionsThunk('en'));

    expect(action.type).toBe('project/generateLogline/rejected');
  });
});

// ---------------------------------------------------------------------------
// generateSynopsisThunk
// ---------------------------------------------------------------------------
describe('generateSynopsisThunk', () => {
  it('dispatches fulfilled action with text from generateText', async () => {
    mockGenerateText.mockResolvedValue('A story about courage.');

    const store = makeStore();
    const action = await store.dispatch(generateSynopsisThunk('en'));

    expect(action.type).toBe('project/generateSynopsis/fulfilled');
    expect((action as { payload: string }).payload).toBe('A story about courage.');
  });

  it('uses generateText not generateJson', async () => {
    mockGenerateText.mockResolvedValue('synopsis text');

    const store = makeStore();
    await store.dispatch(generateSynopsisThunk('de'));

    expect(mockGenerateText).toHaveBeenCalled();
    expect(mockGenerateJson).not.toHaveBeenCalled();
  });

  it('dispatches rejected when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('Network error'));

    const store = makeStore();
    const action = await store.dispatch(generateSynopsisThunk('en'));

    expect(action.type).toBe('project/generateSynopsis/rejected');
  });
});

// ---------------------------------------------------------------------------
// proofreadTextThunk
// ---------------------------------------------------------------------------
describe('proofreadTextThunk', () => {
  it('dispatches fulfilled with suggestion array', async () => {
    const suggestions = [{ original: 'teh', suggestion: 'the', explanation: 'typo' }];
    mockGenerateJson.mockResolvedValue(suggestions);

    const store = makeStore();
    const action = await store.dispatch(proofreadTextThunk({ text: 'teh cat', lang: 'en' }));

    expect(action.type).toBe('project/proofreadText/fulfilled');
    expect((action as { payload: typeof suggestions }).payload).toEqual(suggestions);
  });

  it('calls getPrompts with the text and lang arguments', async () => {
    mockGenerateJson.mockResolvedValue([]);

    const store = makeStore();
    await store.dispatch(proofreadTextThunk({ text: 'Hello world', lang: 'de' }));

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'proofread',
      expect.objectContaining({ text: 'Hello world', lang: 'de' }),
    );
  });
});

// ---------------------------------------------------------------------------
// generateSceneImageThunk
// ---------------------------------------------------------------------------
describe('generateSceneImageThunk', () => {
  const payload = {
    sectionId: 'sec-1',
    sectionTitle: 'Chapter One',
    sectionContent: 'Once upon a time...',
    projectTitle: 'My Novel',
    lang: 'en',
  };

  it('dispatches fulfilled with imageKey and dataUrl', async () => {
    mockGenerateImage.mockResolvedValue('base64imagedata');

    const store = makeStore();
    const action = await store.dispatch(generateSceneImageThunk(payload));

    expect(action.type).toBe('project/generateSceneImage/fulfilled');
    const result = (action as { payload: { imageKey: string; dataUrl: string } }).payload;
    expect(result.imageKey).toBe('scene-sec-1');
  });

  it('calls storageService.saveImage with the generated base64', async () => {
    mockGenerateImage.mockResolvedValue('rawbase64');

    const store = makeStore();
    await store.dispatch(generateSceneImageThunk(payload));

    expect(storageService.saveImage).toHaveBeenCalledWith('scene-sec-1', 'rawbase64');
  });

  it('prefixes plain base64 with data:image/png;base64,', async () => {
    mockGenerateImage.mockResolvedValue('plainbase64data');

    const store = makeStore();
    const action = await store.dispatch(generateSceneImageThunk(payload));

    const result = (action as { payload: { imageKey: string; dataUrl: string } }).payload;
    expect(result.dataUrl).toBe('data:image/png;base64,plainbase64data');
  });

  it('does not double-prefix when base64 already contains data:image', async () => {
    mockGenerateImage.mockResolvedValue('data:image/png;base64,alreadyprefixed');

    const store = makeStore();
    const action = await store.dispatch(generateSceneImageThunk(payload));

    const result = (action as { payload: { imageKey: string; dataUrl: string } }).payload;
    expect(result.dataUrl).toBe('data:image/png;base64,alreadyprefixed');
  });
});

// ---------------------------------------------------------------------------
// streamGenerationThunk
// ---------------------------------------------------------------------------
describe('streamGenerationThunk', () => {
  it('dispatches fulfilled after streaming completes', async () => {
    mockStreamText.mockResolvedValue(undefined);

    const store = makeStore();
    const onChunk = vi.fn();
    const action = await store.dispatch(
      streamGenerationThunk({ prompt: 'Write a story', lang: 'en', onChunk }),
    );

    expect(action.type).toBe('project/streamGeneration/fulfilled');
  });

  it('calls streamText with the prompt and language suffix', async () => {
    mockStreamText.mockResolvedValue(undefined);

    const store = makeStore();
    const onChunk = vi.fn();
    await store.dispatch(
      streamGenerationThunk({ prompt: 'Continue this scene', lang: 'de', onChunk }),
    );

    expect(mockStreamText).toHaveBeenCalled();
    const callArgs = mockStreamText.mock.calls[0]!;
    // First arg is the full prompt — should include German language suffix
    expect(callArgs[0] as string).toContain('Continue this scene');
    expect(callArgs[0] as string).toContain('German');
  });

  it('passes onChunk callback through to streamText', async () => {
    mockStreamText.mockResolvedValue(undefined);

    const store = makeStore();
    const onChunk = vi.fn();
    await store.dispatch(streamGenerationThunk({ prompt: 'test', lang: 'en', onChunk }));

    // streamText is called with callbacks object containing onChunk
    const callArgs = mockStreamText.mock.calls[0]!;
    expect((callArgs[3] as { onChunk: typeof onChunk }).onChunk).toBe(onChunk);
  });
});

// ---------------------------------------------------------------------------
// generateCharacterProfileThunk
// ---------------------------------------------------------------------------
describe('generateCharacterProfileThunk', () => {
  it('dispatches fulfilled with character profile shape', async () => {
    const profile = { name: 'Alice', background: 'Hero', traits: ['brave'] };
    mockGenerateJson.mockResolvedValue(profile);

    const store = makeStore();
    const action = await store.dispatch(
      generateCharacterProfileThunk({ concept: 'brave hero', lang: 'en' }),
    );

    expect(action.type).toBe('project/generateCharacterProfile/fulfilled');
    expect((action as { payload: typeof profile }).payload).toEqual(profile);
  });

  it('calls getPrompts with characterProfile key, concept and lang', async () => {
    mockGenerateJson.mockResolvedValue({});

    const store = makeStore();
    await store.dispatch(generateCharacterProfileThunk({ concept: 'villain', lang: 'fr' }));

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'characterProfile',
      expect.objectContaining({ concept: 'villain', lang: 'fr' }),
    );
  });

  it('dispatches rejected when generateJson throws', async () => {
    mockGenerateJson.mockRejectedValue(new Error('API error'));

    const store = makeStore();
    const action = await store.dispatch(
      generateCharacterProfileThunk({ concept: 'hero', lang: 'en' }),
    );

    expect(action.type).toBe('project/generateCharacterProfile/rejected');
  });
});

// ---------------------------------------------------------------------------
// regenerateCharacterFieldThunk
// ---------------------------------------------------------------------------
describe('regenerateCharacterFieldThunk', () => {
  const character = {
    id: 'c1',
    name: 'Alice',
    backstory: 'Old backstory',
    motivation: '',
    appearance: '',
    personalityTraits: '',
    flaws: '',
    notes: '',
    characterArc: '',
    relationships: '',
  };

  it('dispatches fulfilled with { field, value }', async () => {
    mockGenerateText.mockResolvedValue('New backstory text');

    const store = makeStore();
    const action = await store.dispatch(
      regenerateCharacterFieldThunk({ character, field: 'backstory', lang: 'en' }),
    );

    expect(action.type).toBe('project/regenerateCharacterField/fulfilled');
    const payload = (action as { payload: { field: string; value: string } }).payload;
    expect(payload.field).toBe('backstory');
    expect(payload.value).toBe('New backstory text');
  });

  it('passes the character and field to getPrompts', async () => {
    mockGenerateText.mockResolvedValue('value');

    const store = makeStore();
    await store.dispatch(
      regenerateCharacterFieldThunk({ character, field: 'backstory', lang: 'de' }),
    );

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'regenerateCharacterField',
      expect.objectContaining({ character, field: 'backstory', lang: 'de' }),
    );
  });
});

// ---------------------------------------------------------------------------
// generateCharacterPortraitThunk
// ---------------------------------------------------------------------------
describe('generateCharacterPortraitThunk', () => {
  it('dispatches fulfilled with characterId', async () => {
    mockGenerateImage.mockResolvedValue('portraitbase64');

    const store = makeStore();
    const action = await store.dispatch(
      generateCharacterPortraitThunk({
        characterId: 'c1',
        description: 'A tall warrior',
        lang: 'en',
      }),
    );

    expect(action.type).toBe('project/generateCharacterPortrait/fulfilled');
    expect((action as { payload: { characterId: string } }).payload.characterId).toBe('c1');
  });

  it('saves the portrait image via storageService', async () => {
    mockGenerateImage.mockResolvedValue('portraitdata');

    const store = makeStore();
    await store.dispatch(
      generateCharacterPortraitThunk({
        characterId: 'c42',
        description: 'Elderly wizard',
        lang: 'en',
      }),
    );

    expect(storageService.saveImage).toHaveBeenCalledWith('c42', 'portraitdata');
  });

  it('appends style to description when style is provided', async () => {
    mockGenerateImage.mockResolvedValue('stylePortrait');

    const store = makeStore();
    await store.dispatch(
      generateCharacterPortraitThunk({
        characterId: 'c1',
        description: 'Young archer',
        style: 'watercolor',
        lang: 'en',
      }),
    );

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'characterPortrait',
      expect.objectContaining({ description: 'Young archer. Style: watercolor' }),
    );
  });

  it('uses description as-is when no style provided', async () => {
    mockGenerateImage.mockResolvedValue('noStylePortrait');

    const store = makeStore();
    await store.dispatch(
      generateCharacterPortraitThunk({
        characterId: 'c1',
        description: 'Lone ranger',
        lang: 'en',
      }),
    );

    expect(mockGetPrompts).toHaveBeenCalledWith(
      'characterPortrait',
      expect.objectContaining({ description: 'Lone ranger' }),
    );
  });
});

// ---------------------------------------------------------------------------
// uploadCharacterImageThunk
// ---------------------------------------------------------------------------
describe('uploadCharacterImageThunk', () => {
  it('reads file as dataURL and saves base64 without prefix', async () => {
    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAA';
    const fakeDataUrl = `data:image/png;base64,${fakeBase64}`;

    // QNBS-v3: spy on FileReader prototype so jsdom's native class is replaced at the method level
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: fakeDataUrl, configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onloadend === 'function')
          this.onloadend(new ProgressEvent('loadend') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['fake image data'], 'portrait.png', { type: 'image/png' });
    const action = await store.dispatch(uploadCharacterImageThunk({ characterId: 'c99', file }));

    expect(action.type).toBe('project/uploadCharacterImage/fulfilled');
    expect(storageService.saveImage).toHaveBeenCalledWith('c99', fakeBase64);
  });

  it('dispatches fulfilled with characterId', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', {
        value: 'data:image/jpeg;base64,abc123',
        configurable: true,
      });
      void Promise.resolve().then(() => {
        if (typeof this.onloadend === 'function')
          this.onloadend(new ProgressEvent('loadend') as ProgressEvent<FileReader>);
      });
    });

    const store = makeStore();
    const file = new File(['data'], 'image.jpg', { type: 'image/jpeg' });
    const action = await store.dispatch(uploadCharacterImageThunk({ characterId: 'c7', file }));

    expect((action as { payload: { characterId: string } }).payload?.characterId).toBe('c7');
  });
});
