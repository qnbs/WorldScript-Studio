import type { EntityState, PayloadAction } from '@reduxjs/toolkit';
import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { RootState } from '../../app/store';
import {
  type AIRequestOptions,
  generateImage,
  generateJson,
  generateText,
  streamText,
} from '../../services/aiProviderService';
import { getPrompts } from '../../services/geminiService';
import { storageService } from '../../services/storageService';
import type {
  Character,
  CharacterRelationship,
  CustomTemplateParams,
  OutlineGenerationParams,
  OutlineSection,
  StorySection,
  World,
  WritingGoal,
  WritingSession,
} from '../../types';
import { createDeduplicatedThunk } from './aiThunkUtils';

// --- Entity Adapters ---
export const charactersAdapter = createEntityAdapter<Character>();

export const worldsAdapter = createEntityAdapter<World>();

// --- Initial State ---
export interface ProjectData {
  id?: string;
  title: string;
  logline: string;
  author?: string;
  characters: EntityState<Character, string>;
  worlds: EntityState<World, string>;
  outline: OutlineSection[];
  manuscript: StorySection[];
  relationships?: CharacterRelationship[];
  projectGoals?: {
    totalWordCount: number;
    targetDate: string | null;
  };
  writingHistory?: {
    date: string; // YYYY-MM-DD
    words: number;
  }[];
  writingSessions?: WritingSession[];
  writingGoals?: WritingGoal[];
  sceneBoardLayout?: { [sectionId: string]: { x: number; y: number } };
}

// Helper interface for importing legacy or current formats
interface ImportedProjectData {
  title: string;
  logline: string;
  characters: Character[] | { ids: string[]; entities: Record<string, Character> };
  worlds: World[] | { ids: string[]; entities: Record<string, World> };
  outline?: OutlineSection[];
  manuscript?: StorySection[];
  projectGoals?: ProjectData['projectGoals'];
  writingHistory?: ProjectData['writingHistory'];
}

const initialState: { data: ProjectData } = {
  data: {
    id: 'default',
    title: '',
    logline: '',
    characters: charactersAdapter.getInitialState(),
    worlds: worldsAdapter.getInitialState(),
    outline: [],
    manuscript: [],
    projectGoals: {
      totalWordCount: 50000,
      targetDate: null,
    },
    writingHistory: [],
  },
};

// --- Async Thunks ---
const buildAiOptions = (state: RootState): AIRequestOptions => ({
  provider: state.settings.advancedAi.provider,
  model: state.settings.advancedAi.model,
  temperature: state.settings.advancedAi.temperature,
  maxTokens: state.settings.advancedAi.maxTokens,
  ollamaBaseUrl: state.settings.advancedAi.ollamaBaseUrl,
});

export const generateLoglineSuggestionsThunk = createDeduplicatedThunk(
  'project/generateLogline',
  async (lang: string, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);

    const { prompt, schema } = getPrompts('logline', { project, lang });
    registerDuplicateRequest(prompt, 'logline');
    const response = await generateJson<string[]>(prompt, creativity, schema!, aiOptions, signal);
    return response;
  },
);

export const importProjectThunk = createAsyncThunk('project/importProject', async (file: File) => {
  const text = await file.text();
  const projectData = JSON.parse(text) as ImportedProjectData;

  const charactersState = charactersAdapter.getInitialState();
  const worldsState = worldsAdapter.getInitialState();

  const charactersToSet: Character[] = [];
  const worldsToSet: World[] = [];

  let characterArray: (Character & { avatarBase64?: string })[] = [];
  if (Array.isArray(projectData.characters)) {
    characterArray = projectData.characters;
  } else if (
    projectData.characters &&
    'ids' in projectData.characters &&
    'entities' in projectData.characters
  ) {
    const { ids, entities } = projectData.characters;
    characterArray = ids
      .map((id: string) => entities[id])
      .filter((item): item is Character & { avatarBase64?: string } => Boolean(item));
  }

  for (const char of characterArray) {
    const newChar = { ...char };
    if (newChar.avatarBase64) {
      await storageService.saveImage(newChar.id, newChar.avatarBase64);
      newChar.hasAvatar = true;
      delete newChar.avatarBase64;
    }
    charactersToSet.push(newChar);
  }
  charactersAdapter.setAll(charactersState, charactersToSet);

  let worldArray: (World & { ambianceImageBase64?: string })[] = [];
  if (Array.isArray(projectData.worlds)) {
    worldArray = projectData.worlds;
  } else if (
    projectData.worlds &&
    'ids' in projectData.worlds &&
    'entities' in projectData.worlds
  ) {
    const { ids, entities } = projectData.worlds;
    worldArray = ids
      .map((id: string) => entities[id])
      .filter((item): item is World & { ambianceImageBase64?: string } => Boolean(item));
  }

  for (const world of worldArray) {
    const newWorld = { ...world };
    if (newWorld.ambianceImageBase64) {
      await storageService.saveImage(newWorld.id, newWorld.ambianceImageBase64);
      newWorld.hasAmbianceImage = true;
      delete newWorld.ambianceImageBase64;
    }
    worldsToSet.push(newWorld);
  }
  worldsAdapter.setAll(worldsState, worldsToSet);

  return {
    title: projectData.title,
    logline: projectData.logline,
    characters: charactersState,
    worlds: worldsState,
    outline: projectData.outline || [],
    manuscript: projectData.manuscript || [],
    projectGoals: projectData.projectGoals || initialState.data.projectGoals,
    writingHistory: projectData.writingHistory || [],
  } as ProjectData;
});

export const restoreSnapshotThunk = createAsyncThunk(
  'project/restoreSnapshot',
  async (snapshotId: number) => {
    const data = await storageService.getSnapshotData(snapshotId);
    return data;
  },
);

export const generateCharacterProfileThunk = createDeduplicatedThunk(
  'project/generateCharacterProfile',
  async (
    { concept, lang }: { concept: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    // Pass thinking budget indirectly via prompt type config in geminiService
    const { prompt, schema } = getPrompts('characterProfile', {
      concept,
      lang,
    });
    registerDuplicateRequest(prompt, 'characterProfile');
    return await generateJson<Omit<Character, 'id'>>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const regenerateCharacterFieldThunk = createDeduplicatedThunk(
  'project/regenerateCharacterField',
  async (
    { character, field, lang }: { character: Character; field: keyof Character; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt } = getPrompts('regenerateCharacterField', {
      character,
      field,
      lang,
    });
    registerDuplicateRequest(prompt, 'regenerateCharacterField');
    const response = await generateText(prompt, state.settings.aiCreativity, aiOptions, signal);
    return { field, value: response };
  },
);

export const generateCharacterPortraitThunk = createDeduplicatedThunk(
  'project/generateCharacterPortrait',
  async (
    {
      characterId,
      description,
      style,
      lang,
    }: {
      characterId: string;
      description: string;
      style?: string;
      lang: string;
    },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const fullDescription = style ? `${description}. Style: ${style}` : description;
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt } = getPrompts('characterPortrait', {
      description: fullDescription,
      lang,
    });
    registerDuplicateRequest(prompt, 'characterPortrait');
    const base64 = await generateImage(prompt, aiOptions, signal);
    await storageService.saveImage(characterId, base64);
    return { characterId };
  },
);

export const uploadCharacterImageThunk = createAsyncThunk(
  'project/uploadCharacterImage',
  async ({ characterId, file }: { characterId: string; file: File }) => {
    return new Promise<{ characterId: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).replace(/^data:image\/\w+;base64,/, '');
        await storageService.saveImage(characterId, base64);
        resolve({ characterId });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
);

export const generateWorldProfileThunk = createDeduplicatedThunk(
  'project/generateWorldProfile',
  async (
    { concept, lang }: { concept: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('worldProfile', {
      concept,
      lang,
    });
    registerDuplicateRequest(prompt, 'worldProfile');
    return await generateJson<Omit<World, 'id'>>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const regenerateWorldFieldThunk = createDeduplicatedThunk(
  'project/regenerateWorldField',
  async (
    { world, field, lang }: { world: World; field: keyof World; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt } = getPrompts('regenerateWorldField', {
      world,
      field,
      lang,
    });
    registerDuplicateRequest(prompt, 'regenerateWorldField');
    const response = await generateText(prompt, state.settings.aiCreativity, aiOptions, signal);
    return { field, value: response };
  },
);

export const generateWorldImageThunk = createDeduplicatedThunk(
  'project/generateWorldImage',
  async (
    {
      worldId,
      description,
      lang,
    }: {
      worldId: string;
      description: string;
      lang: string;
    },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt } = getPrompts('worldImage', { description, lang });
    registerDuplicateRequest(prompt, 'worldImage');
    const base64 = await generateImage(prompt, aiOptions, signal);
    await storageService.saveImage(worldId, base64);
    return { worldId };
  },
);

export const uploadWorldImageThunk = createAsyncThunk(
  'project/uploadWorldImage',
  async ({ worldId, file }: { worldId: string; file: File }) => {
    return new Promise<{ worldId: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).replace(/^data:image\/\w+;base64,/, '');
        await storageService.saveImage(worldId, base64);
        resolve({ worldId });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
);

export const generateOutlineThunk = createDeduplicatedThunk(
  'project/generateOutline',
  async (params: OutlineGenerationParams, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('outline', params);
    registerDuplicateRequest(prompt, 'outline');
    return await generateJson<OutlineSection[]>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const regenerateOutlineSectionThunk = createDeduplicatedThunk(
  'project/regenerateOutlineSection',
  async (
    {
      allSections,
      sectionToIndex,
      lang,
    }: { allSections: OutlineSection[]; sectionToIndex: number; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('regenerateOutlineSection', {
      allSections,
      sectionToIndex,
      lang,
    });
    registerDuplicateRequest(prompt, 'regenerateOutlineSection');
    const response = await generateJson<OutlineSection>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
    return { index: sectionToIndex, newSection: response };
  },
);

export const personalizeTemplateThunk = createDeduplicatedThunk(
  'project/personalizeTemplate',
  async (
    { sections, concept, lang }: { sections: { title: string }[]; concept: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('personalizeTemplate', {
      sections,
      concept,
      lang,
    });
    registerDuplicateRequest(prompt, 'personalizeTemplate');
    return await generateJson<{ title: string; prompt: string }[]>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const generateCustomTemplateThunk = createDeduplicatedThunk(
  'project/generateCustomTemplate',
  async (params: CustomTemplateParams, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('customTemplate', params);
    registerDuplicateRequest(prompt, 'customTemplate');
    return await generateJson<{ title: string }[]>(
      prompt,
      state.settings.aiCreativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export const streamGenerationThunk = createDeduplicatedThunk(
  'project/streamGeneration',
  async (
    {
      prompt,
      lang,
      onChunk,
    }: {
      prompt: string;
      lang: string;
      onChunk: (chunk: string) => void;
    },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const aiOptions = buildAiOptions(state);
    const fullPrompt = `${prompt}\n\nRespond in ${lang === 'de' ? 'German' : 'English'}.`;
    registerDuplicateRequest(fullPrompt, 'streamGeneration');
    await streamText(fullPrompt, state.settings.aiCreativity, aiOptions, { onChunk }, signal);
  },
);

export const generateSynopsisThunk = createDeduplicatedThunk(
  'project/generateSynopsis',
  async (lang: string, { getState, signal, registerDuplicateRequest }) => {
    const state = getState() as RootState;
    const project = state.project.present.data;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);
    const { prompt } = getPrompts('synopsis', {
      project,
      lang,
    });
    registerDuplicateRequest(prompt, 'synopsis');
    return await generateText(prompt, creativity, aiOptions, signal);
  },
);

export const proofreadTextThunk = createDeduplicatedThunk(
  'project/proofreadText',
  async (
    { text, lang }: { text: string; lang: string },
    { getState, signal, registerDuplicateRequest },
  ) => {
    const state = getState() as RootState;
    const creativity = state.settings.aiCreativity;
    const aiOptions = buildAiOptions(state);
    const { prompt, schema } = getPrompts('proofread', {
      text,
      lang,
    });
    registerDuplicateRequest(prompt, 'proofread');
    return await generateJson<{ original: string; suggestion: string; explanation: string }[]>(
      prompt,
      creativity,
      schema!,
      aiOptions,
      signal,
    );
  },
);

export { createDeduplicatedThunk } from './aiThunkUtils';

// --- Slice Definition ---
const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    // --- Project Meta ---
    updateTitle: (state, action: PayloadAction<string>) => {
      state.data.title = action.payload;
    },
    updateLogline: (state, action: PayloadAction<string>) => {
      state.data.logline = action.payload;
    },
    updateProjectGoal: (
      state,
      action: PayloadAction<{
        key: 'totalWordCount' | 'targetDate';
        value: number | string | null;
      }>,
    ) => {
      if (state.data.projectGoals) {
        if (action.payload.key === 'totalWordCount') {
          state.data.projectGoals.totalWordCount = action.payload.value as number;
        } else if (action.payload.key === 'targetDate') {
          state.data.projectGoals.targetDate = action.payload.value as string | null;
        }
      }
    },
    resetProject: (state, action: PayloadAction<{ title: string; logline: string }>) => {
      state.data = {
        ...initialState.data,
        title: action.payload.title,
        logline: action.payload.logline,
        characters: charactersAdapter.getInitialState(),
        worlds: worldsAdapter.getInitialState(),
        manuscript: [{ id: `sec-${Date.now()}`, title: 'Chapter 1', content: '' }],
      };
    },
    // --- Characters ---
    addCharacter: (state, action: PayloadAction<Partial<Character> & { name: string }>) => {
      const newChar: Character = {
        id: uuidv4(),
        backstory: '',
        motivation: '',
        appearance: '',
        personalityTraits: '',
        flaws: '',
        notes: '',
        hasAvatar: false,
        characterArc: '',
        relationships: '',
        ...action.payload,
      };
      charactersAdapter.addOne(state.data.characters, newChar);
    },
    updateCharacter: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Character> }>,
    ) => {
      charactersAdapter.updateOne(state.data.characters, {
        id: action.payload.id,
        changes: action.payload.changes,
      });
    },
    deleteCharacter: (state, action: PayloadAction<string>) => {
      charactersAdapter.removeOne(state.data.characters, action.payload);
    },
    // --- Worlds ---
    addWorld: (state, action: PayloadAction<Partial<World> & { name: string }>) => {
      const newWorld: World = {
        id: uuidv4(),
        description: '',
        geography: '',
        magicSystem: '',
        culture: '',
        notes: '',
        hasAmbianceImage: false,
        timeline: [],
        locations: [],
        ...action.payload,
      };
      worldsAdapter.addOne(state.data.worlds, newWorld);
    },
    updateWorld: (state, action: PayloadAction<{ id: string; changes: Partial<World> }>) => {
      worldsAdapter.updateOne(state.data.worlds, {
        id: action.payload.id,
        changes: action.payload.changes,
      });
    },
    deleteWorld: (state, action: PayloadAction<string>) => {
      worldsAdapter.removeOne(state.data.worlds, action.payload);
    },
    // --- Outline ---
    setOutline: (state, action: PayloadAction<OutlineSection[]>) => {
      state.data.outline = action.payload;
    },
    // --- Manuscript ---
    setManuscript: (state, action: PayloadAction<StorySection[]>) => {
      state.data.manuscript = action.payload;
    },
    updateManuscriptSection: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<StorySection> }>,
    ) => {
      const index = state.data.manuscript.findIndex((s) => s.id === action.payload.id);
      if (index !== -1) {
        const section = state.data.manuscript[index];
        if (section) {
          Object.assign(section, action.payload.changes);
        }
      }
    },
    addManuscriptSection: (state, action: PayloadAction<{ title: string; index?: number }>) => {
      const newSection: StorySection = {
        id: uuidv4(),
        title: action.payload.title,
        content: '',
      };
      if (action.payload.index !== undefined) {
        state.data.manuscript.splice(action.payload.index, 0, newSection);
      } else {
        state.data.manuscript.push(newSection);
      }
    },
    deleteManuscriptSection: (state, action: PayloadAction<string>) => {
      state.data.manuscript = state.data.manuscript.filter((s) => s.id !== action.payload);
    },
    // --- Relationships ---
    addRelationship: (state, action: PayloadAction<CharacterRelationship>) => {
      if (!state.data.relationships) state.data.relationships = [];
      state.data.relationships.push(action.payload);
    },
    updateRelationship: (
      state,
      action: PayloadAction<{
        id: string;
        changes: Partial<CharacterRelationship>;
      }>,
    ) => {
      if (!state.data.relationships) state.data.relationships = [];
      const index = state.data.relationships.findIndex((r) => r.id === action.payload.id);
      if (index !== -1) {
        const relationship = state.data.relationships[index];
        if (relationship) {
          Object.assign(relationship, action.payload.changes);
        }
      }
    },
    deleteRelationship: (state, action: PayloadAction<string>) => {
      if (!state.data.relationships) state.data.relationships = [];
      state.data.relationships = state.data.relationships.filter((r) => r.id !== action.payload);
    },
    // --- Scene Board ---
    updateSceneBoardLayout: (
      state,
      action: PayloadAction<{ [sectionId: string]: { x: number; y: number } }>,
    ) => {
      state.data.sceneBoardLayout = {
        ...state.data.sceneBoardLayout,
        ...action.payload,
      };
    },
    // --- Writing Analytics ---
    addWritingSession: (state, action: PayloadAction<WritingSession>) => {
      if (!state.data.writingSessions) state.data.writingSessions = [];
      state.data.writingSessions.push(action.payload);
    },
    updateWritingGoal: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<WritingGoal> }>,
    ) => {
      if (!state.data.writingGoals) state.data.writingGoals = [];
      const index = state.data.writingGoals.findIndex((g) => g.id === action.payload.id);
      if (index !== -1) {
        const goal = state.data.writingGoals[index];
        if (goal) {
          Object.assign(goal, action.payload.changes);
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(importProjectThunk.fulfilled, (state, action) => {
        state.data = action.payload;
      })
      .addCase(restoreSnapshotThunk.fulfilled, (state, action) => {
        state.data = action.payload as ProjectData;
      })
      .addCase(generateCharacterPortraitThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(uploadCharacterImageThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(generateWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      })
      .addCase(uploadWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      });
  },
});

export const projectActions = projectSlice.actions;
export default projectSlice.reducer;
