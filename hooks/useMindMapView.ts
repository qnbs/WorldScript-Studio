import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import {
  mindMapUiActions,
  selectActiveMindMapId,
  selectMindMapPan,
  selectMindMapUi,
  selectMindMapZoom,
} from '../features/mindMap/mindMapUiSlice';
import { selectMindMaps } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import type {
  MindMap,
  MindMapEdge,
  MindMapEdgeDirection,
  MindMapEdgeStyle,
  MindMapLinkedEntityType,
  MindMapNode,
  MindMapNodeShape,
  MindMapNodeType,
} from '../types';

const { setActiveMindMap, setPan, setSelectedEdge, setSelectedNode, setZoom, resetViewport } =
  mindMapUiActions;

export interface NewMindMapDraft {
  name: string;
  description?: string;
}

export interface NewMindMapNodeDraft {
  label: string;
  type: MindMapNodeType;
  position: { x: number; y: number };
  color: string;
  shape: MindMapNodeShape;
  linkedEntityType?: MindMapLinkedEntityType;
  linkedEntityId?: string;
  textNotes?: string;
}

export interface NewMindMapEdgeDraft {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  color?: string;
  style?: MindMapEdgeStyle;
  direction?: MindMapEdgeDirection;
}

export interface UseMindMapViewReturn {
  mindMaps: MindMap[];
  activeMindMap: MindMap | undefined;
  activeMindMapId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isMapFormOpen: boolean;
  editingMapId: string | null;
  isNodeEditorOpen: boolean;
  editingNodeId: string | null;
  handleSelectMap: (id: string) => void;
  handleOpenNewMapForm: () => void;
  handleOpenEditMapForm: (id: string) => void;
  handleCloseMapForm: () => void;
  handleSaveMap: (draft: NewMindMapDraft) => void;
  handleDeleteMap: (id: string) => void;
  handleAddNode: (draft: NewMindMapNodeDraft) => void;
  handleUpdateNode: (
    nodeId: string,
    changes: Partial<Omit<MindMapNode, 'id' | 'mindMapId' | 'createdAt'>>,
  ) => void;
  handleDeleteNode: (nodeId: string) => void;
  handleSelectNode: (nodeId: string | null) => void;
  handleOpenNodeEditor: (nodeId: string) => void;
  handleCloseNodeEditor: () => void;
  handleAddEdge: (draft: NewMindMapEdgeDraft) => void;
  handleUpdateEdge: (
    edgeId: string,
    changes: Partial<
      Omit<MindMapEdge, 'id' | 'mindMapId' | 'createdAt' | 'sourceNodeId' | 'targetNodeId'>
    >,
  ) => void;
  handleDeleteEdge: (edgeId: string) => void;
  handleSelectEdge: (edgeId: string | null) => void;
  handleZoom: (delta: number) => void;
  handlePan: (dx: number, dy: number) => void;
  handleResetViewport: () => void;
}

export function useMindMapView(): UseMindMapViewReturn {
  const dispatch = useAppDispatch();
  const mindMaps = useAppSelectorShallow(selectMindMaps);
  const activeMindMapId = useAppSelectorShallow(selectActiveMindMapId);
  const zoom = useAppSelectorShallow(selectMindMapZoom);
  const { panX, panY } = useAppSelectorShallow(selectMindMapPan);
  const ui = useAppSelectorShallow(selectMindMapUi);

  const [isMapFormOpen, setIsMapFormOpen] = useState(false);
  const [editingMapId, setEditingMapId] = useState<string | null>(null);
  const [isNodeEditorOpen, setIsNodeEditorOpen] = useState(false);

  const activeMindMap = useMemo(
    () => mindMaps.find((m) => m.id === activeMindMapId),
    [mindMaps, activeMindMapId],
  );

  const handleSelectMap = useCallback((id: string) => dispatch(setActiveMindMap(id)), [dispatch]);

  const handleOpenNewMapForm = useCallback(() => {
    setEditingMapId(null);
    setIsMapFormOpen(true);
  }, []);

  const handleOpenEditMapForm = useCallback((id: string) => {
    setEditingMapId(id);
    setIsMapFormOpen(true);
  }, []);

  const handleCloseMapForm = useCallback(() => {
    setIsMapFormOpen(false);
    setEditingMapId(null);
  }, []);

  const handleSaveMap = useCallback(
    (draft: NewMindMapDraft) => {
      const now = new Date().toISOString();
      if (editingMapId) {
        dispatch(
          projectActions.updateMindMap({
            id: editingMapId,
            // QNBS-v3: exactOptionalPropertyTypes requires conditional spread for optional fields
            changes: {
              name: draft.name,
              ...(draft.description !== undefined ? { description: draft.description } : {}),
              updatedAt: now,
            },
          }),
        );
      } else {
        const map: MindMap = {
          id: uuidv4(),
          projectId: '',
          name: draft.name,
          ...(draft.description !== undefined ? { description: draft.description } : {}),
          nodes: [],
          edges: [],
          createdAt: now,
          updatedAt: now,
        };
        dispatch(projectActions.addMindMap(map));
        dispatch(setActiveMindMap(map.id));
      }
      setIsMapFormOpen(false);
      setEditingMapId(null);
    },
    [dispatch, editingMapId],
  );

  const handleDeleteMap = useCallback(
    (id: string) => {
      dispatch(projectActions.deleteMindMap(id));
      if (activeMindMapId === id) dispatch(setActiveMindMap(null));
    },
    [dispatch, activeMindMapId],
  );

  const handleAddNode = useCallback(
    (draft: NewMindMapNodeDraft) => {
      if (!activeMindMapId) return;
      const now = new Date().toISOString();
      const node: MindMapNode = {
        id: uuidv4(),
        mindMapId: activeMindMapId,
        label: draft.label,
        type: draft.type,
        position: draft.position,
        color: draft.color,
        shape: draft.shape,
        textNotes: draft.textNotes ?? '',
        // QNBS-v3: exactOptionalPropertyTypes — conditional spread for optional fields
        ...(draft.linkedEntityType !== undefined
          ? { linkedEntityType: draft.linkedEntityType }
          : {}),
        ...(draft.linkedEntityId !== undefined ? { linkedEntityId: draft.linkedEntityId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      dispatch(projectActions.addMindMapNode({ mapId: activeMindMapId, node }));
    },
    [dispatch, activeMindMapId],
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, changes: Partial<Omit<MindMapNode, 'id' | 'mindMapId' | 'createdAt'>>) => {
      if (!activeMindMapId) return;
      dispatch(
        projectActions.updateMindMapNode({
          mapId: activeMindMapId,
          nodeId,
          changes: { ...changes, updatedAt: new Date().toISOString() },
        }),
      );
    },
    [dispatch, activeMindMapId],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (!activeMindMapId) return;
      dispatch(projectActions.deleteMindMapNode({ mapId: activeMindMapId, nodeId }));
    },
    [dispatch, activeMindMapId],
  );

  const handleSelectNode = useCallback(
    (nodeId: string | null) => dispatch(setSelectedNode(nodeId)),
    [dispatch],
  );

  const handleOpenNodeEditor = useCallback(
    (nodeId: string) => {
      dispatch(setSelectedNode(nodeId));
      setIsNodeEditorOpen(true);
    },
    [dispatch],
  );

  const handleCloseNodeEditor = useCallback(() => {
    setIsNodeEditorOpen(false);
  }, []);

  const handleAddEdge = useCallback(
    (draft: NewMindMapEdgeDraft) => {
      if (!activeMindMapId) return;
      const edge: MindMapEdge = {
        id: uuidv4(),
        mindMapId: activeMindMapId,
        sourceNodeId: draft.sourceNodeId,
        targetNodeId: draft.targetNodeId,
        ...(draft.label !== undefined ? { label: draft.label } : {}),
        color: draft.color ?? '#6b7280',
        style: draft.style ?? 'solid',
        direction: draft.direction ?? 'uni',
        createdAt: new Date().toISOString(),
      };
      dispatch(projectActions.addMindMapEdge({ mapId: activeMindMapId, edge }));
    },
    [dispatch, activeMindMapId],
  );

  const handleUpdateEdge = useCallback(
    (
      edgeId: string,
      changes: Partial<
        Omit<MindMapEdge, 'id' | 'mindMapId' | 'createdAt' | 'sourceNodeId' | 'targetNodeId'>
      >,
    ) => {
      if (!activeMindMapId) return;
      dispatch(projectActions.updateMindMapEdge({ mapId: activeMindMapId, edgeId, changes }));
    },
    [dispatch, activeMindMapId],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      if (!activeMindMapId) return;
      dispatch(projectActions.deleteMindMapEdge({ mapId: activeMindMapId, edgeId }));
    },
    [dispatch, activeMindMapId],
  );

  const handleSelectEdge = useCallback(
    (edgeId: string | null) => dispatch(setSelectedEdge(edgeId)),
    [dispatch],
  );

  const handleZoom = useCallback(
    (delta: number) => {
      const next = Math.min(4, Math.max(0.25, zoom + delta));
      dispatch(setZoom(next));
    },
    [dispatch, zoom],
  );

  const handlePan = useCallback(
    (dx: number, dy: number) => dispatch(setPan({ panX: panX + dx, panY: panY + dy })),
    [dispatch, panX, panY],
  );

  const handleResetViewport = useCallback(() => dispatch(resetViewport()), [dispatch]);

  return {
    mindMaps,
    activeMindMap,
    activeMindMapId,
    zoom,
    panX,
    panY,
    selectedNodeId: ui.selectedNodeId,
    selectedEdgeId: ui.selectedEdgeId,
    isMapFormOpen,
    editingMapId,
    isNodeEditorOpen,
    editingNodeId: ui.editingNodeId,
    handleSelectMap,
    handleOpenNewMapForm,
    handleOpenEditMapForm,
    handleCloseMapForm,
    handleSaveMap,
    handleDeleteMap,
    handleAddNode,
    handleUpdateNode,
    handleDeleteNode,
    handleSelectNode,
    handleOpenNodeEditor,
    handleCloseNodeEditor,
    handleAddEdge,
    handleUpdateEdge,
    handleDeleteEdge,
    handleSelectEdge,
    handleZoom,
    handlePan,
    handleResetViewport,
  };
}
