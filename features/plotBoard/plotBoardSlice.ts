// QNBS-v3: plotBoardSlice holds ONLY ephemeral viewport/UI state (zoom, pan, mode, draw state).
//          Story content (connections, subplots, tensionOverrides) lives in projectSlice
//          so those decisions are undo-able via redux-undo.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type PlotBoardMode = 'swimlane' | 'canvas' | 'timeline';

export interface PlotBoardState {
  activeMode: PlotBoardMode;
  zoom: number;
  panX: number;
  panY: number;
  selectedConnectionId: string | null;
  isDrawingConnection: boolean;
  drawFromSectionId: string | null;
  activeSubplotFilter: string | null;
  /** When true, dragged cards snap to 8px grid. */
  snapToGrid: boolean;
}

const STORAGE_KEY = 'worldscript-plot-board';

const defaultState: PlotBoardState = {
  activeMode: 'swimlane',
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedConnectionId: null,
  isDrawingConnection: false,
  drawFromSectionId: null,
  activeSubplotFilter: null,
  snapToGrid: false,
};

const loadState = (): PlotBoardState => {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<PlotBoardState>;
    return {
      ...defaultState,
      ...parsed,
      // Always reset drawing state on load — prevents stuck draw mode
      isDrawingConnection: false,
      drawFromSectionId: null,
      selectedConnectionId: null,
      // Clamp zoom to sane range in case of corrupt stored value
      zoom: Math.min(4, Math.max(0.25, parsed.zoom ?? 1)),
    };
  } catch {
    return defaultState;
  }
};

const plotBoardSlice = createSlice({
  name: 'plotBoard',
  initialState: loadState,
  reducers: {
    setActiveMode(state, action: PayloadAction<PlotBoardMode>) {
      state.activeMode = action.payload;
      // Exit draw mode when leaving canvas
      if (action.payload !== 'canvas') {
        state.isDrawingConnection = false;
        state.drawFromSectionId = null;
      }
    },

    // ── Viewport ──────────────────────────────────────────────────────────────
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
    setSnapToGrid(state, action: PayloadAction<boolean>) {
      state.snapToGrid = action.payload;
    },

    // ── Connection selection (UI state only) ─────────────────────────────────
    setSelectedConnection(state, action: PayloadAction<string | null>) {
      state.selectedConnectionId = action.payload;
    },

    // ── Draw mode (UI state only — actual connection created in projectSlice) ─
    startDrawConnection(state, action: PayloadAction<string>) {
      state.isDrawingConnection = true;
      state.drawFromSectionId = action.payload;
    },
    cancelDrawConnection(state) {
      state.isDrawingConnection = false;
      state.drawFromSectionId = null;
    },
    // QNBS-v3: finishDrawConnection now only clears draw UI state; connection is
    //          created via projectActions.finishPlotDrawConnection for undo support.
    finishDrawConnection(state) {
      state.isDrawingConnection = false;
      state.drawFromSectionId = null;
    },

    // ── Subplot filter (UI state — which subplot is highlighted on canvas) ────
    setActiveSubplotFilter(state, action: PayloadAction<string | null>) {
      state.activeSubplotFilter = action.payload;
    },
  },
});

export const plotBoardActions = plotBoardSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────
export const selectPlotBoard = (state: { plotBoard: PlotBoardState }) => state.plotBoard;
export const selectActiveMode = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.activeMode;
export const selectZoom = (state: { plotBoard: PlotBoardState }) => state.plotBoard.zoom;
export const selectPan = (state: { plotBoard: PlotBoardState }) => ({
  panX: state.plotBoard.panX,
  panY: state.plotBoard.panY,
});
export const selectSnapToGrid = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.snapToGrid;
export const selectSelectedConnectionId = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.selectedConnectionId;
export const selectIsDrawingConnection = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.isDrawingConnection;
export const selectDrawFromSectionId = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.drawFromSectionId;
export const selectActiveSubplotFilter = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.activeSubplotFilter;

// ── Persistence middleware ────────────────────────────────────────────────────
import type { Middleware } from '@reduxjs/toolkit';

export const plotBoardPersistenceMiddleware: Middleware<unknown, unknown> =
  (storeAPI) => (next) => (action) => {
    const result = next(action);
    const actionType = (action as { type?: string }).type;
    if (typeof actionType === 'string' && actionType.startsWith('plotBoard/')) {
      try {
        const state = storeAPI.getState() as { plotBoard: PlotBoardState };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plotBoard));
      } catch {
        // localStorage may be unavailable
      }
    }
    return result;
  };

export default plotBoardSlice.reducer;
