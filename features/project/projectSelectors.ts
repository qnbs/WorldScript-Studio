import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../app/store';
import { charactersAdapter, worldsAdapter } from './projectSlice';

// --- Base Selectors ---
const selectProjectWithHistory = (state: RootState) => state.project;
export const selectProjectData = (state: RootState) => state.project.present?.data;

// --- Undo/Redo Selectors ---
export const selectCanUndo = createSelector(
  [selectProjectWithHistory],
  (project) => project.past.length > 0
);

export const selectCanRedo = createSelector(
  [selectProjectWithHistory],
  (project) => project.future.length > 0
);

// --- Character Selectors (from adapter) ---
const selectCharactersState = createSelector(
  [selectProjectData],
  (data) => data?.characters || charactersAdapter.getInitialState()
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
  (data) => data?.worlds || worldsAdapter.getInitialState()
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
  (data) => data?.manuscript || []
);

export const selectOutline = createSelector([selectProjectData], (data) => data?.outline || []);

// --- Scene Board / Relationships ---
export const selectRelationships = createSelector(
  [selectProjectData],
  (data) => data?.relationships || []
);

export const selectStorySections = createSelector(
  [selectProjectData],
  (data) => data?.manuscript || []
);

// --- Writing History / Goals ---
export const selectWritingHistory = createSelector(
  [selectProjectData],
  (data) => data?.writingHistory || []
);

export const selectProjectGoals = createSelector(
  [selectProjectData],
  (data) => data?.projectGoals ?? { totalWordCount: 50000, targetDate: null }
);

// --- Aggregated Stats (verhindert Neuberechnung bei jedem Render) ---
export const selectTotalWordCount = createSelector([selectManuscript], (manuscript) =>
  manuscript.reduce(
    (acc, s) => acc + (s.content?.trim().split(/\s+/).filter(Boolean).length ?? 0),
    0
  )
);

// Memoised character list for graph rendering
export const selectCharactersForGraph = createSelector(
  [selectAllCharacters, selectRelationships],
  (characters, relationships) => ({ characters, relationships })
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
  })
);
