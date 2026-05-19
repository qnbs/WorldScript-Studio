// QNBS-v3: Plot-Board viewport/connection state is ephemeral — kept in localStorage,
//          NOT in the undo-able projectSlice, so pan/zoom don't pollute undo history.
import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PlotConnection, PlotConnectionType, Subplot } from '../../types';

export type PlotBoardMode = 'swimlane' | 'canvas' | 'timeline';

const subplotAdapter = createEntityAdapter<Subplot>();

export interface PlotBoardState {
  activeMode: PlotBoardMode;
  zoom: number;
  panX: number;
  panY: number;
  subplots: ReturnType<typeof subplotAdapter.getInitialState>;
  connections: PlotConnection[];
  /** User-overridden tension score per scene (sectionId → 0–10). Auto-computed otherwise. */
  tensionOverrides: Record<string, number>;
  selectedConnectionId: string | null;
  isDrawingConnection: boolean;
  drawFromSectionId: string | null;
  activeSubplotFilter: string | null;
  /** When true, dragged cards snap to 8px grid. */
  snapToGrid: boolean;
}

const STORAGE_KEY = 'storycraft-plot-board';

const defaultState: PlotBoardState = {
  activeMode: 'swimlane',
  zoom: 1,
  panX: 0,
  panY: 0,
  subplots: subplotAdapter.getInitialState(),
  connections: [],
  tensionOverrides: {},
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

    // ── Subplots ─────────────────────────────────────────────────────────────
    addSubplot(state, action: PayloadAction<Subplot>) {
      subplotAdapter.addOne(state.subplots, action.payload);
    },
    updateSubplot(state, action: PayloadAction<{ id: string; changes: Partial<Subplot> }>) {
      subplotAdapter.updateOne(state.subplots, action.payload);
    },
    deleteSubplot(state, action: PayloadAction<string>) {
      subplotAdapter.removeOne(state.subplots, action.payload);
      // Clear filter if deleted subplot was active
      if (state.activeSubplotFilter === action.payload) {
        state.activeSubplotFilter = null;
      }
      // Remove deleted subplot reference from connections
      for (const conn of state.connections) {
        if (conn.subplotId === action.payload) {
          // exactOptionalPropertyTypes: delete is the correct way to clear an optional property
          delete conn.subplotId;
        }
      }
    },
    assignSectionToSubplot(state, action: PayloadAction<{ sectionId: string; subplotId: string }>) {
      const { sectionId, subplotId } = action.payload;
      const subplot = state.subplots.entities[subplotId];
      if (!subplot) return;
      if (!subplot.sectionIds.includes(sectionId)) {
        subplotAdapter.updateOne(state.subplots, {
          id: subplotId,
          changes: { sectionIds: [...subplot.sectionIds, sectionId] },
        });
      }
    },
    removeSectionFromSubplot(
      state,
      action: PayloadAction<{ sectionId: string; subplotId: string }>,
    ) {
      const { sectionId, subplotId } = action.payload;
      const subplot = state.subplots.entities[subplotId];
      if (!subplot) return;
      subplotAdapter.updateOne(state.subplots, {
        id: subplotId,
        changes: { sectionIds: subplot.sectionIds.filter((id) => id !== sectionId) },
      });
    },
    setActiveSubplotFilter(state, action: PayloadAction<string | null>) {
      state.activeSubplotFilter = action.payload;
    },

    // ── Connections ───────────────────────────────────────────────────────────
    addConnection(state, action: PayloadAction<PlotConnection>) {
      // Prevent duplicate connections between same pair in same direction
      const exists = state.connections.some(
        (c) =>
          c.fromSectionId === action.payload.fromSectionId &&
          c.toSectionId === action.payload.toSectionId,
      );
      if (!exists) {
        state.connections.push(action.payload);
      }
    },
    updateConnection(
      state,
      action: PayloadAction<{ id: string; changes: Partial<Omit<PlotConnection, 'id'>> }>,
    ) {
      const conn = state.connections.find((c) => c.id === action.payload.id);
      if (conn) Object.assign(conn, action.payload.changes);
    },
    removeConnection(state, action: PayloadAction<string>) {
      state.connections = state.connections.filter((c) => c.id !== action.payload);
      if (state.selectedConnectionId === action.payload) {
        state.selectedConnectionId = null;
      }
    },
    removeConnectionsForSection(state, action: PayloadAction<string>) {
      state.connections = state.connections.filter(
        (c) => c.fromSectionId !== action.payload && c.toSectionId !== action.payload,
      );
    },
    setSelectedConnection(state, action: PayloadAction<string | null>) {
      state.selectedConnectionId = action.payload;
    },

    // ── Draw mode ────────────────────────────────────────────────────────────
    startDrawConnection(state, action: PayloadAction<string>) {
      state.isDrawingConnection = true;
      state.drawFromSectionId = action.payload;
    },
    cancelDrawConnection(state) {
      state.isDrawingConnection = false;
      state.drawFromSectionId = null;
    },
    finishDrawConnection(
      state,
      action: PayloadAction<{ toSectionId: string; type: PlotConnectionType; newId: string }>,
    ) {
      if (!state.drawFromSectionId) return;
      const { toSectionId, type, newId } = action.payload;
      if (toSectionId === state.drawFromSectionId) {
        // Self-loop not allowed
        state.isDrawingConnection = false;
        state.drawFromSectionId = null;
        return;
      }
      const exists = state.connections.some(
        (c) => c.fromSectionId === state.drawFromSectionId && c.toSectionId === toSectionId,
      );
      if (!exists) {
        state.connections.push({
          id: newId,
          fromSectionId: state.drawFromSectionId,
          toSectionId,
          type,
        });
      }
      state.isDrawingConnection = false;
      state.drawFromSectionId = null;
    },

    // ── Tension overrides ────────────────────────────────────────────────────
    setTensionOverride(state, action: PayloadAction<{ sectionId: string; score: number }>) {
      const { sectionId, score } = action.payload;
      state.tensionOverrides[sectionId] = Math.min(10, Math.max(0, score));
    },
    clearTensionOverride(state, action: PayloadAction<string>) {
      delete state.tensionOverrides[action.payload];
    },
    clearAllTensionOverrides(state) {
      state.tensionOverrides = {};
    },
  },
});

export const plotBoardActions = plotBoardSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────
const subplotSelectors = subplotAdapter.getSelectors();

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
export const selectConnections = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.connections;
export const selectSelectedConnectionId = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.selectedConnectionId;
export const selectIsDrawingConnection = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.isDrawingConnection;
export const selectDrawFromSectionId = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.drawFromSectionId;
export const selectTensionOverrides = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.tensionOverrides;
export const selectActiveSubplotFilter = (state: { plotBoard: PlotBoardState }) =>
  state.plotBoard.activeSubplotFilter;
export const selectAllSubplots = (state: { plotBoard: PlotBoardState }) =>
  subplotSelectors.selectAll(state.plotBoard.subplots);
export const selectSubplotById = (id: string) => (state: { plotBoard: PlotBoardState }) =>
  subplotSelectors.selectById(state.plotBoard.subplots, id);

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
