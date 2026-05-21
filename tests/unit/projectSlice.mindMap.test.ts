import { describe, expect, it } from 'vitest';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import type { MindMap } from '../../types';

type PartialState = { data: { mindMaps?: MindMap[] } };

const NOW = '2026-01-01T00:00:00Z';

function s(mindMaps: MindMap[]): PartialState {
  return { data: { mindMaps } };
}

function makeMap(overrides: Partial<MindMap> = {}): MindMap {
  return {
    id: 'map-1',
    projectId: 'proj-1',
    name: 'Test Map',
    nodes: [],
    edges: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('projectSlice — mindMap reducers', () => {
  it('addMindMap appends a map with a supplied id', () => {
    const state = s([]);
    const payload = makeMap({ id: 'new-map', name: 'My Map' });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.addMindMap(payload),
    );
    expect(next.data.mindMaps).toHaveLength(1);
    expect(next.data.mindMaps?.[0]?.name).toBe('My Map');
    expect(next.data.mindMaps?.[0]?.id).toBe('new-map');
  });

  it('updateMindMap patches fields by id', () => {
    const state = s([makeMap()]);
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.updateMindMap({ id: 'map-1', changes: { name: 'Renamed' } }),
    );
    expect(next.data.mindMaps?.[0]?.name).toBe('Renamed');
  });

  it('deleteMindMap removes the map', () => {
    const state = s([makeMap()]);
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.deleteMindMap('map-1'),
    );
    expect(next.data.mindMaps).toHaveLength(0);
  });

  it('addMindMapNode adds a node to the correct map', () => {
    const state = s([makeMap()]);
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.addMindMapNode({
        mapId: 'map-1',
        node: {
          id: 'node-1',
          mindMapId: 'map-1',
          label: 'Node A',
          type: 'free',
          position: { x: 100, y: 100 },
          color: '#aaa',
          shape: 'circle',
          textNotes: '',
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(next.data.mindMaps?.[0]?.nodes).toHaveLength(1);
    expect(next.data.mindMaps?.[0]?.nodes?.[0]?.label).toBe('Node A');
  });

  it('deleteMindMapNode cascades to remove edges referencing it', () => {
    const nodeId = 'node-1';
    const initial = makeMap({
      nodes: [
        {
          id: nodeId,
          mindMapId: 'map-1',
          label: 'A',
          type: 'free',
          position: { x: 0, y: 0 },
          color: '#000',
          shape: 'rectangle',
          textNotes: '',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'node-2',
          mindMapId: 'map-1',
          label: 'B',
          type: 'free',
          position: { x: 100, y: 0 },
          color: '#000',
          shape: 'rectangle',
          textNotes: '',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      edges: [
        {
          id: 'e-1',
          mindMapId: 'map-1',
          sourceNodeId: nodeId,
          targetNodeId: 'node-2',
          color: '#000',
          style: 'solid',
          direction: 'uni',
          createdAt: NOW,
        },
      ],
    });
    const state = s([initial]);
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.deleteMindMapNode({ mapId: 'map-1', nodeId }),
    );
    expect(next.data.mindMaps?.[0]?.nodes).toHaveLength(1);
    expect(next.data.mindMaps?.[0]?.edges).toHaveLength(0);
  });

  it('addMindMapEdge connects two nodes', () => {
    const state = s([
      makeMap({
        nodes: [
          {
            id: 'n1',
            mindMapId: 'map-1',
            label: 'A',
            type: 'free',
            position: { x: 0, y: 0 },
            color: '#000',
            shape: 'circle',
            textNotes: '',
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            id: 'n2',
            mindMapId: 'map-1',
            label: 'B',
            type: 'free',
            position: { x: 100, y: 0 },
            color: '#000',
            shape: 'circle',
            textNotes: '',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      }),
    ]);
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.addMindMapEdge({
        mapId: 'map-1',
        edge: {
          id: 'e-1',
          mindMapId: 'map-1',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          color: '#000',
          style: 'solid',
          direction: 'uni',
          createdAt: NOW,
        },
      }),
    );
    expect(next.data.mindMaps?.[0]?.edges).toHaveLength(1);
  });
});
