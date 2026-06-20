import type { PayloadAction } from '@reduxjs/toolkit';
import type { PlotConnection, PlotConnectionType, Subplot } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Plot/scene-board reducer cases extracted from projectSlice — connections, subplots,
// tension overrides, and scene-board layout are undo-able story content (live under project.data).
export const plotReducers = {
  // --- Scene Board ---
  updateSceneBoardLayout: (
    state: ProjectSliceState,
    action: PayloadAction<{ [sectionId: string]: { x: number; y: number } }>,
  ) => {
    state.data.sceneBoardLayout = {
      ...state.data.sceneBoardLayout,
      ...action.payload,
    };
  },
  // --- Plot Connections (undo-able story content) ---
  addPlotConnection: (state: ProjectSliceState, action: PayloadAction<PlotConnection>) => {
    if (!state.data.plotConnections) state.data.plotConnections = [];
    const exists = state.data.plotConnections.some(
      (c) =>
        c.fromSectionId === action.payload.fromSectionId &&
        c.toSectionId === action.payload.toSectionId,
    );
    if (!exists) state.data.plotConnections.push(action.payload);
  },
  updatePlotConnection: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; changes: Partial<Omit<PlotConnection, 'id'>> }>,
  ) => {
    const conn = state.data.plotConnections?.find((c) => c.id === action.payload.id);
    if (conn) Object.assign(conn, action.payload.changes);
  },
  removePlotConnection: (state: ProjectSliceState, action: PayloadAction<string>) => {
    if (!state.data.plotConnections) return;
    state.data.plotConnections = state.data.plotConnections.filter((c) => c.id !== action.payload);
  },
  removePlotConnectionsForSection: (state: ProjectSliceState, action: PayloadAction<string>) => {
    if (!state.data.plotConnections) return;
    state.data.plotConnections = state.data.plotConnections.filter(
      (c) => c.fromSectionId !== action.payload && c.toSectionId !== action.payload,
    );
  },
  // --- Plot Subplots (undo-able story content) ---
  addPlotSubplot: (state: ProjectSliceState, action: PayloadAction<Subplot>) => {
    if (!state.data.plotSubplots) state.data.plotSubplots = [];
    state.data.plotSubplots.push(action.payload);
  },
  updatePlotSubplot: (
    state: ProjectSliceState,
    // QNBS-v3: id excluded — plotConnections[].subplotId references it; a patched id would silently
    // sever every connection's linkage to the subplot.
    action: PayloadAction<{ id: string; changes: Partial<Omit<Subplot, 'id'>> }>,
  ) => {
    const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.id);
    if (subplot) Object.assign(subplot, action.payload.changes);
  },
  deletePlotSubplot: (state: ProjectSliceState, action: PayloadAction<string>) => {
    if (!state.data.plotSubplots) return;
    state.data.plotSubplots = state.data.plotSubplots.filter((s) => s.id !== action.payload);
    // Remove subplot reference from connections
    if (state.data.plotConnections) {
      for (const conn of state.data.plotConnections) {
        if (conn.subplotId === action.payload) delete conn.subplotId;
      }
    }
  },
  assignSectionToPlotSubplot: (
    state: ProjectSliceState,
    action: PayloadAction<{ sectionId: string; subplotId: string }>,
  ) => {
    const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.subplotId);
    if (subplot && !subplot.sectionIds.includes(action.payload.sectionId)) {
      subplot.sectionIds.push(action.payload.sectionId);
    }
  },
  removeSectionFromPlotSubplot: (
    state: ProjectSliceState,
    action: PayloadAction<{ sectionId: string; subplotId: string }>,
  ) => {
    const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.subplotId);
    if (subplot) {
      subplot.sectionIds = subplot.sectionIds.filter((id) => id !== action.payload.sectionId);
    }
  },
  // --- Plot Tension Overrides (undo-able story content) ---
  setPlotTensionOverride: (
    state: ProjectSliceState,
    action: PayloadAction<{ sectionId: string; score: number }>,
  ) => {
    if (!state.data.plotTensionOverrides) state.data.plotTensionOverrides = {};
    state.data.plotTensionOverrides[action.payload.sectionId] = Math.min(
      10,
      Math.max(0, action.payload.score),
    );
  },
  clearPlotTensionOverride: (state: ProjectSliceState, action: PayloadAction<string>) => {
    if (state.data.plotTensionOverrides) delete state.data.plotTensionOverrides[action.payload];
  },
  clearAllPlotTensionOverrides: (state: ProjectSliceState) => {
    state.data.plotTensionOverrides = {};
  },
  // QNBS-v3: Finish draw creates connection in projectSlice so it's undo-able.
  finishPlotDrawConnection: (
    state: ProjectSliceState,
    action: PayloadAction<{
      fromSectionId: string;
      toSectionId: string;
      type: PlotConnectionType;
      newId: string;
    }>,
  ) => {
    const { fromSectionId, toSectionId, type, newId } = action.payload;
    if (fromSectionId === toSectionId) return; // no self-loops
    if (!state.data.plotConnections) state.data.plotConnections = [];
    const exists = state.data.plotConnections.some(
      (c) => c.fromSectionId === fromSectionId && c.toSectionId === toSectionId,
    );
    if (!exists) {
      state.data.plotConnections.push({ id: newId, fromSectionId, toSectionId, type });
    }
  },
};
