/**
 * Tests for components/mind-map/MindMapListPanel.tsx
 * QNBS-v3: Mocks MindMapViewContext; tests map list, form, delete confirmation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleSelectMap = vi.fn();
const mockHandleOpenNewMapForm = vi.fn();
const mockHandleOpenEditMapForm = vi.fn();
const mockHandleCloseMapForm = vi.fn();
const mockHandleSaveMap = vi.fn();
const mockHandleDeleteMap = vi.fn();
const mockHandleAddNode = vi.fn();

let mockMindMaps: {
  id: string;
  name: string;
  description?: string;
  nodes: unknown[];
  edges: unknown[];
}[] = [];
let mockActiveMindMapId: string | null = null;
let mockIsMapFormOpen = false;
let mockEditingMapId: string | null = null;

vi.mock('../../contexts/MindMapViewContext', () => ({
  useMindMapViewContext: () => ({
    mindMaps: mockMindMaps,
    activeMindMapId: mockActiveMindMapId,
    isMapFormOpen: mockIsMapFormOpen,
    editingMapId: mockEditingMapId,
    handleSelectMap: mockHandleSelectMap,
    handleOpenNewMapForm: mockHandleOpenNewMapForm,
    handleOpenEditMapForm: mockHandleOpenEditMapForm,
    handleCloseMapForm: mockHandleCloseMapForm,
    handleSaveMap: mockHandleSaveMap,
    handleDeleteMap: mockHandleDeleteMap,
    handleAddNode: mockHandleAddNode,
    activeNode: null,
    handleSelectNode: vi.fn(),
    handleUpdateNode: vi.fn(),
    handleDeleteNode: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MindMapListPanel } from '../../components/mind-map/MindMapListPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MAP_A = { id: 'map-1', name: 'Story Map', nodes: [], edges: [] };
const MAP_B = { id: 'map-2', name: 'Character Web', nodes: [], edges: [] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMapListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMindMaps = [];
    mockActiveMindMapId = null;
    mockIsMapFormOpen = false;
    mockEditingMapId = null;
  });

  it('renders the panel landmark', () => {
    render(<MindMapListPanel />);
    expect(screen.getByRole('complementary', { name: 'mindmap.title' })).toBeInTheDocument();
  });

  it('shows empty state when no maps and form is closed', () => {
    render(<MindMapListPanel />);
    expect(screen.getByText('mindmap.emptyState')).toBeInTheDocument();
  });

  it('renders map names in the list', () => {
    mockMindMaps = [MAP_A, MAP_B];
    render(<MindMapListPanel />);
    expect(screen.getByText('Story Map')).toBeInTheDocument();
    expect(screen.getByText('Character Web')).toBeInTheDocument();
  });

  it('calls handleSelectMap when a map button is clicked', async () => {
    const user = userEvent.setup();
    mockMindMaps = [MAP_A];
    render(<MindMapListPanel />);
    await user.click(screen.getByText('Story Map'));
    expect(mockHandleSelectMap).toHaveBeenCalledWith('map-1');
  });

  it('calls handleOpenNewMapForm when + button is clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapListPanel />);
    await user.click(screen.getByRole('button', { name: 'mindmap.addMap' }));
    expect(mockHandleOpenNewMapForm).toHaveBeenCalledTimes(1);
  });

  it('shows form when isMapFormOpen is true', () => {
    mockIsMapFormOpen = true;
    render(<MindMapListPanel />);
    expect(screen.getByLabelText('mindmap.mapName')).toBeInTheDocument();
  });

  it('calls handleSaveMap on form submit with a name', async () => {
    const user = userEvent.setup();
    mockIsMapFormOpen = true;
    render(<MindMapListPanel />);
    await user.type(screen.getByLabelText('mindmap.mapName'), 'New Map');
    await user.click(screen.getByText('mindmap.save'));
    expect(mockHandleSaveMap).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Map' }));
  });

  it('calls handleCloseMapForm on cancel', async () => {
    const user = userEvent.setup();
    mockIsMapFormOpen = true;
    render(<MindMapListPanel />);
    await user.click(screen.getByText('mindmap.cancel'));
    expect(mockHandleCloseMapForm).toHaveBeenCalledTimes(1);
  });

  it('calls handleOpenEditMapForm when edit button is clicked', async () => {
    const user = userEvent.setup();
    mockMindMaps = [MAP_A];
    render(<MindMapListPanel />);
    await user.click(screen.getByRole('button', { name: 'mindmap.editMap' }));
    expect(mockHandleOpenEditMapForm).toHaveBeenCalledWith('map-1');
  });

  it('shows delete confirmation when delete button is clicked', async () => {
    const user = userEvent.setup();
    mockMindMaps = [MAP_A];
    render(<MindMapListPanel />);
    await user.click(screen.getByRole('button', { name: 'mindmap.deleteMap' }));
    expect(screen.getByText('mindmap.deleteMapConfirm')).toBeInTheDocument();
  });

  it('calls handleDeleteMap when delete is confirmed', async () => {
    const user = userEvent.setup();
    mockMindMaps = [MAP_A];
    render(<MindMapListPanel />);
    await user.click(screen.getByRole('button', { name: 'mindmap.deleteMap' }));
    // Now click the confirm delete button (text-based)
    const confirmBtn = screen.getAllByText('mindmap.deleteMap')[0];
    await user.click(confirmBtn);
    expect(mockHandleDeleteMap).toHaveBeenCalledWith('map-1');
  });

  it('shows addNode button when a map is active', () => {
    mockMindMaps = [MAP_A];
    mockActiveMindMapId = 'map-1';
    render(<MindMapListPanel />);
    expect(screen.getByText('mindmap.addNode')).toBeInTheDocument();
  });

  it('calls handleAddNode when addNode button is clicked', async () => {
    const user = userEvent.setup();
    mockMindMaps = [MAP_A];
    mockActiveMindMapId = 'map-1';
    render(<MindMapListPanel />);
    await user.click(screen.getByText('mindmap.addNode'));
    expect(mockHandleAddNode).toHaveBeenCalledTimes(1);
  });

  it('active map option has aria-selected=true', () => {
    mockMindMaps = [MAP_A, MAP_B];
    mockActiveMindMapId = 'map-1';
    render(<MindMapListPanel />);
    const options = screen.getAllByRole('option');
    const activeOption = options.find((o) => o.getAttribute('aria-selected') === 'true');
    expect(activeOption).toBeInTheDocument();
  });
});
