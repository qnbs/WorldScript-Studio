// QNBS-v3: mindMapUiSlice holds ONLY ephemeral viewport/UI state — content lives in projectSlice.
import { createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';

export interface MindMapUiState {
  activeMindMapId: string | null;
  zoom: number; // 0.25–4.0
  panX: number;
  panY: number;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isDrawingEdge: boolean;
  drawFromNodeId: string | null;
  editingNodeId: string | null;
}

const STORAGE_KEY = 'worldscript-mind-map-ui';

const defaultState: MindMapUiState = {
  activeMindMapId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedNodeId: null,
  selectedEdgeId: null,
  isDrawingEdge: false,
  drawFromNodeId: null,
  editingNodeId: null,
};

const loadState = (): MindMapUiState => {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<MindMapUiState>;
    return {
      ...defaultState,
      ...parsed,
      // Always reset interactive state on load
      isDrawingEdge: false,
      drawFromNodeId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      editingNodeId: null,
      zoom: Math.min(4, Math.max(0.25, parsed.zoom ?? 1)),
    };
  } catch {
    return defaultState;
  }
};

const mindMapUiSlice = createSlice({
  name: 'mindMapUi',
  initialState: loadState,
  reducers: {
    setActiveMindMap(state, action: PayloadAction<string | null>) {
      state.activeMindMapId = action.payload;
      // Reset viewport interaction on map switch
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.isDrawingEdge = false;
      state.drawFromNodeId = null;
      state.editingNodeId = null;
    },
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = Math.min(4, Math.max(0.25, action.payload));
    },
    setPan(state, action: PayloadAction<{ panX: number; panY: number }>) {
      state.panX = action.payload.panX;
      state.panY = action.payload.panY;
    },
    resetViewport(state) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    },
    setSelectedNode(state, action: PayloadAction<string | null>) {
      state.selectedNodeId = action.payload;
      state.selectedEdgeId = null;
    },
    setSelectedEdge(state, action: PayloadAction<string | null>) {
      state.selectedEdgeId = action.payload;
      state.selectedNodeId = null;
    },
    startDrawEdge(state, action: PayloadAction<string>) {
      state.isDrawingEdge = true;
      state.drawFromNodeId = action.payload;
    },
    cancelDrawEdge(state) {
      state.isDrawingEdge = false;
      state.drawFromNodeId = null;
    },
    setEditingNode(state, action: PayloadAction<string | null>) {
      state.editingNodeId = action.payload;
    },
  },
});

export const mindMapUiActions = mindMapUiSlice.actions;

export const selectMindMapUi = (state: { mindMapUi: MindMapUiState }) => state.mindMapUi;
export const selectActiveMindMapId = (state: { mindMapUi: MindMapUiState }) =>
  state.mindMapUi.activeMindMapId;
export const selectMindMapZoom = (state: { mindMapUi: MindMapUiState }) => state.mindMapUi.zoom;
export const selectMindMapPan = (state: { mindMapUi: MindMapUiState }) => ({
  panX: state.mindMapUi.panX,
  panY: state.mindMapUi.panY,
});

export const mindMapUiPersistenceMiddleware: Middleware<unknown, unknown> =
  (storeAPI) => (next) => (action) => {
    const result = next(action);
    const actionType = (action as { type?: string }).type;

    if (typeof actionType === 'string' && actionType.startsWith('mindMapUi/')) {
      const state = storeAPI.getState() as { mindMapUi: MindMapUiState };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mindMapUi));
      } catch {
        // localStorage may be blocked
      }
    }

    return result;
  };

export default mindMapUiSlice.reducer;
