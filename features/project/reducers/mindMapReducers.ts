import type { PayloadAction } from '@reduxjs/toolkit';
import type { MindMap, MindMapEdge, MindMapNode } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Mind-map reducer cases extracted from projectSlice — node/edge cascade preserved.
export const mindMapReducers = {
  addMindMap: (state: ProjectSliceState, action: PayloadAction<MindMap>) => {
    if (!state.data.mindMaps) state.data.mindMaps = [];
    state.data.mindMaps.push(action.payload);
  },
  updateMindMap: (
    state: ProjectSliceState,
    // QNBS-v3: id excluded — nested nodes/edges and other maps resolve by previous id, so an in-place
    // id change would break every lookup and desync entities still carrying the old mindMapId.
    action: PayloadAction<{
      id: string;
      changes: Partial<Omit<MindMap, 'nodes' | 'edges' | 'id'>>;
    }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.id);
    if (map) Object.assign(map, action.payload.changes);
  },
  deleteMindMap: (state: ProjectSliceState, action: PayloadAction<string>) => {
    state.data.mindMaps = (state.data.mindMaps ?? []).filter((m) => m.id !== action.payload);
  },
  addMindMapNode: (
    state: ProjectSliceState,
    action: PayloadAction<{ mapId: string; node: MindMapNode }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    if (map) map.nodes.push(action.payload.node);
  },
  updateMindMapNode: (
    state: ProjectSliceState,
    // QNBS-v3: node id excluded — edges keep sourceNodeId/targetNodeId pointers, so renaming a node
    // id in place would dangle every connected edge.
    action: PayloadAction<{
      mapId: string;
      nodeId: string;
      changes: Partial<Omit<MindMapNode, 'id'>>;
    }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    const node = map?.nodes.find((n) => n.id === action.payload.nodeId);
    if (node) Object.assign(node, action.payload.changes);
  },
  deleteMindMapNode: (
    state: ProjectSliceState,
    action: PayloadAction<{ mapId: string; nodeId: string }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    if (!map) return;
    map.nodes = map.nodes.filter((n) => n.id !== action.payload.nodeId);
    // QNBS-v3: cascade delete edges connected to removed node to prevent dangling references.
    map.edges = map.edges.filter(
      (e) => e.sourceNodeId !== action.payload.nodeId && e.targetNodeId !== action.payload.nodeId,
    );
  },
  addMindMapEdge: (
    state: ProjectSliceState,
    action: PayloadAction<{ mapId: string; edge: MindMapEdge }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    if (map) map.edges.push(action.payload.edge);
  },
  updateMindMapEdge: (
    state: ProjectSliceState,
    action: PayloadAction<{ mapId: string; edgeId: string; changes: Partial<MindMapEdge> }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    const edge = map?.edges.find((e) => e.id === action.payload.edgeId);
    if (edge) Object.assign(edge, action.payload.changes);
  },
  deleteMindMapEdge: (
    state: ProjectSliceState,
    action: PayloadAction<{ mapId: string; edgeId: string }>,
  ) => {
    const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
    if (map) map.edges = map.edges.filter((e) => e.id !== action.payload.edgeId);
  },
};
