import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type { Character } from '../../types';

export type WriterTool =
  | 'continue'
  | 'improve'
  | 'changeTone'
  | 'dialogue'
  | 'brainstorm'
  | 'synopsis'
  | 'grammarCheck'
  | 'imagePrompt'
  | 'critic'
  | 'plotholes'
  | 'consistency';

export interface WriterState {
  activeTool: WriterTool;
  selection: { start: number; end: number; text: string };
  dialogueCharacters: Character[];
  scenario: string;
  brainstormContext: string;
  tone: string;
  style: string;
  isLoading: boolean;
  generationHistory: string[];
  activeHistoryIndex: number;
  resultStream: string;
  selectedSectionId: string | null;
}

const initialState: WriterState = {
  activeTool: 'continue',
  selection: { start: 0, end: 0, text: '' },
  dialogueCharacters: [],
  scenario: '',
  brainstormContext: '',
  tone: '',
  style: '',
  isLoading: false,
  generationHistory: [],
  activeHistoryIndex: -1,
  resultStream: '',
  selectedSectionId: null,
};

const writerSlice = createSlice({
  name: 'writer',
  initialState,
  reducers: {
    setActiveTool: (state, action: PayloadAction<WriterTool>) => {
      state.activeTool = action.payload;
      state.generationHistory = [];
      state.activeHistoryIndex = -1;
    },
    setSelection: (state, action: PayloadAction<{ start: number; end: number; text: string }>) => {
      state.selection = action.payload;
    },
    toggleDialogueCharacter: (state, action: PayloadAction<Character>) => {
      const index = state.dialogueCharacters.findIndex((c) => c.id === action.payload.id);
      if (index > -1) {
        state.dialogueCharacters.splice(index, 1);
      } else {
        state.dialogueCharacters.push(action.payload);
      }
    },
    setScenario: (state, action: PayloadAction<string>) => {
      state.scenario = action.payload;
    },
    setBrainstormContext: (state, action: PayloadAction<string>) => {
      state.brainstormContext = action.payload;
    },
    setTone: (state, action: PayloadAction<string>) => {
      state.tone = action.payload;
    },
    setStyle: (state, action: PayloadAction<string>) => {
      state.style = action.payload;
    },
    startLoading: (state) => {
      state.isLoading = true;
    },
    stopLoading: (state) => {
      state.isLoading = false;
    },
    addHistory: (state, action: PayloadAction<string>) => {
      state.generationHistory = [action.payload, ...state.generationHistory].slice(0, 50);
      state.activeHistoryIndex = 0;
    },
    clearHistory: (state) => {
      state.generationHistory = [];
      state.activeHistoryIndex = -1;
    },
    navigateHistory: (state, action: PayloadAction<'prev' | 'next'>) => {
      if (action.payload === 'prev' && state.activeHistoryIndex > 0) {
        state.activeHistoryIndex--;
      }
      if (
        action.payload === 'next' &&
        state.activeHistoryIndex < state.generationHistory.length - 1
      ) {
        state.activeHistoryIndex++;
      }
    },
    updateCurrentHistoryItem: (state, action: PayloadAction<string>) => {
      if (state.activeHistoryIndex > -1) {
        state.generationHistory[state.activeHistoryIndex] = action.payload;
      }
    },
    setSelectedSectionId: (state, action: PayloadAction<string | null>) => {
      state.selectedSectionId = action.payload;
      // Also reset selection when section changes
      state.selection = { start: 0, end: 0, text: '' };
    },
    // Streaming Live-Preview: chunks werden inkrementell angehängt
    appendResultStream: (state, action: PayloadAction<string>) => {
      state.resultStream += action.payload;
    },
    clearResultStream: (state) => {
      state.resultStream = '';
    },
  },
});

export const writerActions = writerSlice.actions;
export default writerSlice.reducer;
