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
  /** When true, Writer AI tools use hybrid RAG context (v1.8). */
  useRagContext: boolean;
  lastRagChunkCount: number;
  // QNBS-v3: PR4 — transparency: a preview of the RAG chunks injected into the last AI request.
  lastRagChunks: RagChunkPreview[];
  // QNBS-v3 (#713): the project incarnation the CURRENT generationHistory entry was generated for -- this state is global Redux (unlike Manuscript view's local hook state), so it survives a Writer-view unmount/remount and must carry its own origin identity for handleAccept to verify against.
  generatedForProjectIdentity: string | null;
}

/** A display-safe summary of a retrieved RAG chunk (no full text payload kept in Redux). */
export interface RagChunkPreview {
  sectionId: string;
  chunkIndex: number;
  score: number;
  snippet: string;
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
  useRagContext: true,
  lastRagChunkCount: 0,
  lastRagChunks: [],
  generatedForProjectIdentity: null,
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
    // QNBS-v3 (#713): captures the project incarnation this generation targets -- handleAccept checks it later, since the async generation may outlive a project switch.
    startLoading: (state, action: PayloadAction<string | null>) => {
      state.isLoading = true;
      state.generatedForProjectIdentity = action.payload;
    },
    stopLoading: (state) => {
      state.isLoading = false;
    },
    // QNBS-v3 (#713): this slice is global Redux (unlike Manuscript view's local hook state), so it survives a Writer-view unmount/remount -- a project switch must invalidate it explicitly rather than relying on the component's own lifecycle.
    invalidateForProjectChange: (state) => {
      state.isLoading = false;
      state.generationHistory = [];
      state.activeHistoryIndex = -1;
      state.resultStream = '';
      state.generatedForProjectIdentity = null;
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
    // Streaming live preview: chunks are appended incrementally
    appendResultStream: (state, action: PayloadAction<string>) => {
      state.resultStream += action.payload;
    },
    clearResultStream: (state) => {
      state.resultStream = '';
    },
    setUseRagContext: (state, action: PayloadAction<boolean>) => {
      state.useRagContext = action.payload;
    },
    setLastRagChunkCount: (state, action: PayloadAction<number>) => {
      state.lastRagChunkCount = action.payload;
    },
    // QNBS-v3: PR4 — store chunk previews + count together so the inspector and badge stay in sync.
    setLastRagChunks: (state, action: PayloadAction<RagChunkPreview[]>) => {
      state.lastRagChunks = action.payload;
      state.lastRagChunkCount = action.payload.length;
    },
  },
});

export const writerActions = writerSlice.actions;
export default writerSlice.reducer;
