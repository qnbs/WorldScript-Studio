import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../../types';

const mockDispatch = vi.fn();

const makeMindMap = (overrides?: Partial<MindMap>): MindMap => ({
  id: 'map-1',
  projectId: 'proj-1',
  name: 'Story Structure',
  nodes: [],
  edges: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeMockState = (mindMaps: MindMap[] = []) => ({
  project: {
    present: {
      data: {
        title: '',
        logline: '',
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        characters: { ids: [], entities: {} } as any,
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        worlds: { ids: [], entities: {} } as any,
        outline: [],
        manuscript: [],
        mindMaps,
      },
    },
  },
  settings: { language: 'en', theme: 'dark' },
  mindMapUi: {
    activeMindMapId: mindMaps[0]?.id ?? null,
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedNodeId: null,
    selectedEdgeId: null,
    isDrawingEdge: false,
    drawFromNodeId: null,
    editingNodeId: null,
  },
});

let mockState = makeMockState();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

beforeEach(() => {
  mockState = makeMockState();
  mockDispatch.mockClear();
});

// MindMapView is the default export
const { default: MindMapView } = await import('../../components/MindMapView');

describe('MindMapView', () => {
  it('renders the toolbar with zoom controls', () => {
    render(<MindMapView />);
    expect(screen.getByLabelText('mindmap.zoomIn')).toBeInTheDocument();
    expect(screen.getByLabelText('mindmap.zoomOut')).toBeInTheDocument();
    expect(screen.getByLabelText('mindmap.resetViewport')).toBeInTheDocument();
  });

  it('shows the mindmap list panel', () => {
    render(<MindMapView />);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('shows empty state when no active map', () => {
    render(<MindMapView />);
    // emptyState appears in both the list panel and the canvas area
    expect(screen.getAllByText('mindmap.emptyState').length).toBeGreaterThan(0);
  });

  it('renders a map entry in the list when maps exist', () => {
    mockState = makeMockState([makeMindMap()]);
    render(<MindMapView />);
    expect(screen.getByText('Story Structure')).toBeInTheDocument();
  });

  it('renders the add map button', () => {
    render(<MindMapView />);
    expect(screen.getByLabelText('mindmap.addMap')).toBeInTheDocument();
  });

  it('renders zoom percentage in toolbar', () => {
    render(<MindMapView />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
