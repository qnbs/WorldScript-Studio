import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../app/store';
import { charactersAdapter, worldsAdapter } from './projectSlice';

// --- Base Selectors ---
const selectProjectWithHistory = (state: RootState) => state.project;
export const selectProjectData = (state: RootState) => state.project.present?.data;

// --- Undo/Redo Selectors ---
export const selectCanUndo = createSelector(
  [selectProjectWithHistory],
  (project) => project.past.length > 0,
);

export const selectCanRedo = createSelector(
  [selectProjectWithHistory],
  (project) => project.future.length > 0,
);

// --- Character Selectors (from adapter) ---
const selectCharactersState = createSelector(
  [selectProjectData],
  (data) => data?.characters || charactersAdapter.getInitialState(),
);

export const {
  selectAll: selectAllCharacters,
  selectById: selectCharacterById,
  selectIds: selectCharacterIds,
  selectTotal: selectTotalCharacters,
} = charactersAdapter.getSelectors(selectCharactersState);

// --- World Selectors (from adapter) ---
const selectWorldsState = createSelector(
  [selectProjectData],
  (data) => data?.worlds || worldsAdapter.getInitialState(),
);

export const {
  selectAll: selectAllWorlds,
  selectById: selectWorldById,
  selectIds: selectWorldIds,
  selectTotal: selectTotalWorlds,
} = worldsAdapter.getSelectors(selectWorldsState);

// --- Manuscript & Outline Selectors ---
export const selectManuscript = createSelector(
  [selectProjectData],
  (data) => data?.manuscript || [],
);

export const selectOutline = createSelector([selectProjectData], (data) => data?.outline || []);

// --- Scene Board / Relationships ---
export const selectRelationships = createSelector(
  [selectProjectData],
  (data) => data?.relationships || [],
);

export const selectStorySections = createSelector(
  [selectProjectData],
  (data) => data?.manuscript || [],
);

// --- Writing History / Goals ---
export const selectWritingHistory = createSelector(
  [selectProjectData],
  (data) => data?.writingHistory || [],
);

export const selectProjectGoals = createSelector(
  [selectProjectData],
  (data) => data?.projectGoals ?? { totalWordCount: 50000, targetDate: null },
);

// --- Aggregated Stats (verhindert Neuberechnung bei jedem Render) ---
export const selectTotalWordCount = createSelector([selectManuscript], (manuscript) =>
  manuscript.reduce(
    (acc, s) => acc + (s.content?.trim().split(/\s+/).filter(Boolean).length ?? 0),
    0,
  ),
);

// Memoised character list for graph rendering
export const selectCharactersForGraph = createSelector(
  [selectAllCharacters, selectRelationships],
  (characters, relationships) => ({ characters, relationships }),
);

// --- Plot-Board v2 selectors (content lives in projectSlice for undo support) ---
export const selectPlotConnections = createSelector(
  [selectProjectData],
  (data) => data?.plotConnections ?? [],
);

export const selectPlotSubplots = createSelector(
  [selectProjectData],
  (data) => data?.plotSubplots ?? [],
);

export const selectPlotTensionOverrides = createSelector(
  [selectProjectData],
  (data) => data?.plotTensionOverrides ?? {},
);

// --- Project AI Preset ---
export const selectProjectAiPreset = createSelector([selectProjectData], (data) => data?.aiPreset);

// --- Story Objects & Groups ---
export const selectStoryObjects = createSelector(
  [selectProjectData],
  (data) => data?.storyObjects ?? [],
);

export const selectObjectGroups = createSelector(
  [selectProjectData],
  (data) => data?.objectGroups ?? [],
);

/** Factory: memoised selector that finds a StoryObject by id. */
export const makeSelectObjectById = () =>
  createSelector(
    [selectStoryObjects, (_state: RootState, objectId: string) => objectId],
    (objects, objectId) => objects.find((o) => o.id === objectId),
  );

// --- Mind Maps ---
export const selectMindMaps = createSelector([selectProjectData], (data) => data?.mindMaps ?? []);

/** Factory: memoised selector that finds a MindMap by id. */
export const makeSelectMindMapById = () =>
  createSelector([selectMindMaps, (_state: RootState, mapId: string) => mapId], (maps, mapId) =>
    maps.find((m) => m.id === mapId),
  );

export const selectCharacterInterviewsAll = createSelector(
  [selectProjectData],
  (data) => data?.characterInterviews ?? {},
);

/** Returns all interviews for a given characterId, memoised. */
export const makeSelectInterviewsByCharacter = () =>
  createSelector(
    [selectCharacterInterviewsAll, (_state: RootState, characterId: string) => characterId],
    (allInterviews, characterId) => allInterviews[characterId] ?? [],
  );

// --- Parameterised section selectors (factory pattern for per-instance memoisation) ---

/** Factory: creates a memoised selector that finds a section by id. */
export const makeSelectSectionById = () =>
  createSelector(
    [selectManuscript, (_state: RootState, sectionId: string) => sectionId],
    (manuscript, sectionId) => manuscript.find((s) => s.id === sectionId),
  );

/** Factory: creates a memoised selector that returns sections for a given act. */
export const makeSelectSectionsForAct = () =>
  createSelector(
    [selectManuscript, (_state: RootState, act: 1 | 2 | 3) => act],
    (manuscript, act) => manuscript.filter((s) => (s.act ?? 1) === act),
  );

export const selectManuscriptSectionCount = createSelector(
  [selectManuscript],
  (manuscript) => manuscript.length,
);

// --- Effective AI settings (preset overlay) ---

/** Active creativity level — project preset overrides global when enabled. */
export const selectEffectiveAiCreativity = (state: RootState) => {
  const preset = state.project.present?.data?.aiPreset;
  if (preset?.enabled && preset.creativity) return preset.creativity;
  return state.settings.aiCreativity;
};

/** Merged AI provider/model — project preset fields override global advancedAi when enabled. */
export const selectEffectiveAiOptions = createSelector(
  [
    (state: RootState) => state.settings.advancedAi,
    (state: RootState) => state.project.present?.data?.aiPreset,
  ],
  (advancedAi, preset) => {
    const use = preset?.enabled === true;
    return {
      provider: use && preset.provider ? preset.provider : advancedAi.provider,
      model: use && preset.model ? preset.model : advancedAi.model,
      temperature:
        use && preset.temperature !== undefined ? preset.temperature : advancedAi.temperature,
      maxTokens: use && preset.maxTokens !== undefined ? preset.maxTokens : advancedAi.maxTokens,
    };
  },
);

// --- Settings-derived selectors (re-render prevention) ---
export const selectTheme = (state: RootState) => state.settings.theme;
export const selectAiCreativity = (state: RootState) => state.settings.aiCreativity;
export const selectLanguage = (state: RootState) => state.settings.language;
export const selectEditorSettings = createSelector(
  (state: RootState) => state.settings,
  (s) => ({
    editorFont: s.editorFont,
    fontSize: s.fontSize,
    lineSpacing: s.lineSpacing,
    paragraphSpacing: s.paragraphSpacing,
    indentFirstLine: s.indentFirstLine,
  }),
);
