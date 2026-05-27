/**
 * Tests for hooks/useMindMapView.ts
 * QNBS-v3: Covers CRUD for maps/nodes/edges, viewport controls, form state.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const MOCK_MAP = {
  id: 'map-1',
  projectId: '',
  name: 'Test Map',
  nodes: [],
  edges: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mockMindMaps = [MOCK_MAP];
let mockActiveMindMapId: string | null = 'map-1';
let mockZoom = 1;
let mockPan = { panX: 0, panY: 0 };
let mockUi = { selectedNodeId: null as string | null, selectedEdgeId: null as string | null };

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelectorShallow: (selector: (s: unknown) => unknown) =>
    selector({
      mindMapUi: {
        activeMindMapId: mockActiveMindMapId,
        zoom: mockZoom,
        panX: mockPan.panX,
        panY: mockPan.panY,
        selectedNodeId: mockUi.selectedNodeId,
        selectedEdgeId: mockUi.selectedEdgeId,
      },
      project: { present: { data: { mindMaps: mockMindMaps } } },
    }),
}));

vi.mock('../../../features/mindMap/mindMapUiSlice', () => ({
  mindMapUiActions: {
    setActiveMindMap: vi.fn((id) => ({ type: 'mindMapUi/setActiveMindMap', payload: id })),
    setPan: vi.fn((p) => ({ type: 'mindMapUi/setPan', payload: p })),
    setSelectedEdge: vi.fn((id) => ({ type: 'mindMapUi/setSelectedEdge', payload: id })),
    setSelectedNode: vi.fn((id) => ({ type: 'mindMapUi/setSelectedNode', payload: id })),
    setZoom: vi.fn((z) => ({ type: 'mindMapUi/setZoom', payload: z })),
    resetViewport: vi.fn(() => ({ type: 'mindMapUi/resetViewport' })),
  },
  selectActiveMindMapId: (s: { mindMapUi: { activeMindMapId: string | null } }) =>
    s.mindMapUi.activeMindMapId,
  selectMindMapZoom: (s: { mindMapUi: { zoom: number } }) => s.mindMapUi.zoom,
  selectMindMapPan: (s: { mindMapUi: { panX: number; panY: number } }) => s.mindMapUi,
  selectMindMapUi: (s: { mindMapUi: typeof mockUi }) => s.mindMapUi,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectMindMaps: (s: { project: { present: { data: { mindMaps: typeof mockMindMaps } } } }) =>
    s.project.present.data.mindMaps,
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    addMindMap: vi.fn((m) => ({ type: 'project/addMindMap', payload: m })),
    updateMindMap: vi.fn((p) => ({ type: 'project/updateMindMap', payload: p })),
    deleteMindMap: vi.fn((id) => ({ type: 'project/deleteMindMap', payload: id })),
    addMindMapNode: vi.fn((p) => ({ type: 'project/addMindMapNode', payload: p })),
    updateMindMapNode: vi.fn((p) => ({ type: 'project/updateMindMapNode', payload: p })),
    deleteMindMapNode: vi.fn((p) => ({ type: 'project/deleteMindMapNode', payload: p })),
    addMindMapEdge: vi.fn((p) => ({ type: 'project/addMindMapEdge', payload: p })),
    updateMindMapEdge: vi.fn((p) => ({ type: 'project/updateMindMapEdge', payload: p })),
    deleteMindMapEdge: vi.fn((p) => ({ type: 'project/deleteMindMapEdge', payload: p })),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { mindMapUiActions } from '../../../features/mindMap/mindMapUiSlice';
import { projectActions } from '../../../features/project/projectSlice';
import { useMindMapView } from '../../../hooks/useMindMapView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMindMapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMindMaps = [{ ...MOCK_MAP }];
    mockActiveMindMapId = 'map-1';
    mockZoom = 1;
    mockPan = { panX: 0, panY: 0 };
    mockUi = { selectedNodeId: null, selectedEdgeId: null };
  });

  it('returns activeMindMap based on activeMindMapId', () => {
    const { result } = renderHook(() => useMindMapView());
    expect(result.current.activeMindMap?.id).toBe('map-1');
  });

  it('returns undefined activeMindMap when activeMindMapId is null', () => {
    mockActiveMindMapId = null;
    const { result } = renderHook(() => useMindMapView());
    expect(result.current.activeMindMap).toBeUndefined();
  });

  describe('map form', () => {
    it('opens new map form', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenNewMapForm());
      expect(result.current.isMapFormOpen).toBe(true);
      expect(result.current.editingMapId).toBeNull();
    });

    it('opens edit map form with the correct id', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenEditMapForm('map-1'));
      expect(result.current.isMapFormOpen).toBe(true);
      expect(result.current.editingMapId).toBe('map-1');
    });

    it('closes map form', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenNewMapForm());
      act(() => result.current.handleCloseMapForm());
      expect(result.current.isMapFormOpen).toBe(false);
    });

    it('dispatches addMindMap when saving a new map', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenNewMapForm());
      act(() => result.current.handleSaveMap({ name: 'New Map' }));
      expect(projectActions.addMindMap).toHaveBeenCalled();
      expect(mindMapUiActions.setActiveMindMap).toHaveBeenCalled();
      expect(result.current.isMapFormOpen).toBe(false);
    });

    it('dispatches updateMindMap when saving an existing map', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenEditMapForm('map-1'));
      act(() => result.current.handleSaveMap({ name: 'Updated Map' }));
      expect(projectActions.updateMindMap).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'map-1',
          changes: expect.objectContaining({ name: 'Updated Map' }),
        }),
      );
    });

    it('dispatches deleteMindMap and clears activeMindMapId when deleting active map', () => {
      mockActiveMindMapId = 'map-1';
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleDeleteMap('map-1'));
      expect(projectActions.deleteMindMap).toHaveBeenCalledWith('map-1');
      expect(mindMapUiActions.setActiveMindMap).toHaveBeenCalledWith(null);
    });
  });

  describe('handleSelectMap', () => {
    it('dispatches setActiveMindMap', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleSelectMap('map-2'));
      expect(mindMapUiActions.setActiveMindMap).toHaveBeenCalledWith('map-2');
    });
  });

  describe('node operations', () => {
    it('dispatches addMindMapNode with correct structure', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => {
        result.current.handleAddNode({
          label: 'Hero',
          type: 'free',
          position: { x: 100, y: 200 },
          color: '#ff0000',
          shape: 'circle',
        });
      });
      expect(projectActions.addMindMapNode).toHaveBeenCalledWith(
        expect.objectContaining({
          mapId: 'map-1',
          node: expect.objectContaining({ label: 'Hero', mindMapId: 'map-1' }),
        }),
      );
    });

    it('does not dispatch addMindMapNode when no active map', () => {
      mockActiveMindMapId = null;
      const { result } = renderHook(() => useMindMapView());
      act(() => {
        result.current.handleAddNode({
          label: 'Hero',
          type: 'free',
          position: { x: 0, y: 0 },
          color: '#000',
          shape: 'circle',
        });
      });
      expect(projectActions.addMindMapNode).not.toHaveBeenCalled();
    });

    it('dispatches updateMindMapNode', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleUpdateNode('node-1', { label: 'Updated' }));
      expect(projectActions.updateMindMapNode).toHaveBeenCalledWith(
        expect.objectContaining({ mapId: 'map-1', nodeId: 'node-1' }),
      );
    });

    it('dispatches deleteMindMapNode', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleDeleteNode('node-1'));
      expect(projectActions.deleteMindMapNode).toHaveBeenCalledWith({
        mapId: 'map-1',
        nodeId: 'node-1',
      });
    });

    it('dispatches setSelectedNode', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleSelectNode('node-1'));
      expect(mindMapUiActions.setSelectedNode).toHaveBeenCalledWith('node-1');
    });

    it('opens node editor', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenNodeEditor('node-1'));
      expect(result.current.isNodeEditorOpen).toBe(true);
    });

    it('closes node editor', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleOpenNodeEditor('node-1'));
      act(() => result.current.handleCloseNodeEditor());
      expect(result.current.isNodeEditorOpen).toBe(false);
    });
  });

  describe('edge operations', () => {
    it('dispatches addMindMapEdge', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => {
        result.current.handleAddEdge({ sourceNodeId: 'n1', targetNodeId: 'n2' });
      });
      expect(projectActions.addMindMapEdge).toHaveBeenCalled();
    });

    it('dispatches updateMindMapEdge', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleUpdateEdge('edge-1', { label: 'loves' }));
      expect(projectActions.updateMindMapEdge).toHaveBeenCalled();
    });

    it('dispatches deleteMindMapEdge', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleDeleteEdge('edge-1'));
      expect(projectActions.deleteMindMapEdge).toHaveBeenCalled();
    });

    it('dispatches setSelectedEdge', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleSelectEdge('edge-1'));
      expect(mindMapUiActions.setSelectedEdge).toHaveBeenCalledWith('edge-1');
    });
  });

  describe('viewport', () => {
    it('dispatches setZoom on handleZoom', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleZoom(0.1));
      expect(mindMapUiActions.setZoom).toHaveBeenCalled();
    });

    it('clamps zoom between 0.2 and 3', () => {
      mockZoom = 0.2;
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleZoom(-10)); // try to go below min
      const call = vi.mocked(mindMapUiActions.setZoom).mock.calls[0]?.[0];
      expect(call).toBeGreaterThanOrEqual(0.2);
    });

    it('dispatches setPan on handlePan', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handlePan(10, 20));
      expect(mindMapUiActions.setPan).toHaveBeenCalled();
    });

    it('dispatches resetViewport', () => {
      const { result } = renderHook(() => useMindMapView());
      act(() => result.current.handleResetViewport());
      expect(mindMapUiActions.resetViewport).toHaveBeenCalled();
    });
  });
});
