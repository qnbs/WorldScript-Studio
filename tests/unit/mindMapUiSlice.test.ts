import { describe, expect, it } from 'vitest';
import mindMapUiReducer, { mindMapUiActions } from '../../features/mindMap/mindMapUiSlice';

const { setActiveMindMap, setZoom, setPan, resetViewport, setSelectedNode, setSelectedEdge } =
  mindMapUiActions;

const initial = mindMapUiReducer(undefined, { type: '@@INIT' });

describe('mindMapUiSlice', () => {
  it('sets active map and resets interactive state', () => {
    const state = mindMapUiReducer(initial, setActiveMindMap('map-1'));
    expect(state.activeMindMapId).toBe('map-1');
    expect(state.selectedNodeId).toBeNull();
    expect(state.isDrawingEdge).toBe(false);
  });

  it('clamps zoom to 0.25–4.0', () => {
    const tooLow = mindMapUiReducer(initial, setZoom(0.01));
    expect(tooLow.zoom).toBe(0.25);
    const tooHigh = mindMapUiReducer(initial, setZoom(99));
    expect(tooHigh.zoom).toBe(4);
    const valid = mindMapUiReducer(initial, setZoom(2));
    expect(valid.zoom).toBe(2);
  });

  it('sets pan coordinates', () => {
    const state = mindMapUiReducer(initial, setPan({ panX: 50, panY: -30 }));
    expect(state.panX).toBe(50);
    expect(state.panY).toBe(-30);
  });

  it('resetViewport restores zoom and pan to defaults', () => {
    let state = mindMapUiReducer(initial, setZoom(3));
    state = mindMapUiReducer(state, setPan({ panX: 200, panY: 100 }));
    state = mindMapUiReducer(state, resetViewport());
    expect(state.zoom).toBe(1);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });

  it('selecting a node clears the selected edge', () => {
    let state = mindMapUiReducer(initial, setSelectedEdge('edge-1'));
    state = mindMapUiReducer(state, setSelectedNode('node-1'));
    expect(state.selectedNodeId).toBe('node-1');
    expect(state.selectedEdgeId).toBeNull();
  });

  it('selecting an edge clears the selected node', () => {
    let state = mindMapUiReducer(initial, setSelectedNode('node-1'));
    state = mindMapUiReducer(state, setSelectedEdge('edge-1'));
    expect(state.selectedEdgeId).toBe('edge-1');
    expect(state.selectedNodeId).toBeNull();
  });
});
