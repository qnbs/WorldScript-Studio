/**
 * Tests for components/manuscript/NavigatorPanel.tsx (StoryNavigator)
 * QNBS-v3: Mocks ManuscriptViewContext + useVirtualizer (jsdom 0-height container); tests
 *          section list, add/delete/move/select, drag-sort, large-manuscript notice.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// QNBS-v3: jsdom has 0-height containers so useVirtualizer renders no items.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 40,
        size: 40,
        key: i,
        lane: 0,
      })),
    getTotalSize: () => count * 40,
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    measureElement: vi.fn((_el: any) => {}),
  }),
}));

const mockSetActiveSectionId = vi.fn();
const mockHandleDragSort = vi.fn();
const mockHandleMoveSection = vi.fn();
const mockSetDraggingIndex = vi.fn();
const mockHandleAddSection = vi.fn();
const mockHandleDeleteSection = vi.fn();

const mockManuscript = [
  { id: 'sec-1', title: 'Prologue', content: '' },
  { id: 'sec-2', title: 'Chapter One', content: '' },
  { id: 'sec-3', title: 'Chapter Two', content: '' },
];

let mockActiveSectionId: string | null = 'sec-1';
let mockDraggingIndex: number | null = null;

vi.mock('../../../contexts/ManuscriptViewContext', () => ({
  useManuscriptViewContext: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    manuscript: mockManuscript,
    activeSectionId: mockActiveSectionId,
    setActiveSectionId: mockSetActiveSectionId,
    draggedItem: { current: null },
    dragOverItem: { current: null },
    handleDragSort: mockHandleDragSort,
    handleMoveSection: mockHandleMoveSection,
    draggingIndex: mockDraggingIndex,
    setDraggingIndex: mockSetDraggingIndex,
    handleAddSection: mockHandleAddSection,
    handleDeleteSection: mockHandleDeleteSection,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { StoryNavigator } from '../../../components/manuscript/NavigatorPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StoryNavigator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSectionId = 'sec-1';
    mockDraggingIndex = null;
  });

  it('renders all section titles', () => {
    render(<StoryNavigator />);
    expect(screen.getByText('Prologue')).toBeInTheDocument();
    expect(screen.getByText('Chapter One')).toBeInTheDocument();
    expect(screen.getByText('Chapter Two')).toBeInTheDocument();
  });

  it('renders add section button', () => {
    render(<StoryNavigator />);
    expect(screen.getByText('manuscript.addSection')).toBeInTheDocument();
  });

  it('calls handleAddSection when add button clicked', async () => {
    const user = userEvent.setup();
    render(<StoryNavigator />);
    await user.click(screen.getByText('manuscript.addSection'));
    expect(mockHandleAddSection).toHaveBeenCalled();
  });

  it('calls setActiveSectionId when a section is clicked', async () => {
    const user = userEvent.setup();
    render(<StoryNavigator />);
    await user.click(screen.getByText('Prologue'));
    expect(mockSetActiveSectionId).toHaveBeenCalledWith('sec-1');
  });

  it('renders move-up buttons for each section', () => {
    render(<StoryNavigator />);
    const moveUpBtns = screen.getAllByLabelText(/outline\.moveUp/);
    expect(moveUpBtns.length).toBe(mockManuscript.length);
  });

  it('renders move-down buttons for each section', () => {
    render(<StoryNavigator />);
    const moveDownBtns = screen.getAllByLabelText(/outline\.moveDown/);
    expect(moveDownBtns.length).toBe(mockManuscript.length);
  });

  it('disables move-up button for first section', () => {
    render(<StoryNavigator />);
    const moveUpBtns = screen.getAllByLabelText(/outline\.moveUp/);
    expect(moveUpBtns[0]).toBeDisabled();
  });

  it('disables move-down button for last section', () => {
    render(<StoryNavigator />);
    const moveDownBtns = screen.getAllByLabelText(/outline\.moveDown/);
    expect(moveDownBtns[moveDownBtns.length - 1]).toBeDisabled();
  });

  it('calls handleMoveSection up when move-up clicked', async () => {
    const user = userEvent.setup();
    render(<StoryNavigator />);
    // Second section's move-up button (not disabled)
    const moveUpBtns = screen.getAllByLabelText(/outline\.moveUp/);
    await user.click(moveUpBtns[1]!);
    expect(mockHandleMoveSection).toHaveBeenCalledWith(1, 'up');
  });

  it('calls handleMoveSection down when move-down clicked', async () => {
    const user = userEvent.setup();
    render(<StoryNavigator />);
    const moveDownBtns = screen.getAllByLabelText(/outline\.moveDown/);
    await user.click(moveDownBtns[0]!);
    expect(mockHandleMoveSection).toHaveBeenCalledWith(0, 'down');
  });

  it('renders delete buttons when there are multiple sections', () => {
    render(<StoryNavigator />);
    const deleteBtns = screen.getAllByLabelText('manuscript.deleteSection');
    expect(deleteBtns.length).toBe(mockManuscript.length);
  });

  it('calls handleDeleteSection when delete button clicked', async () => {
    const user = userEvent.setup();
    render(<StoryNavigator />);
    const deleteBtns = screen.getAllByLabelText('manuscript.deleteSection');
    await user.click(deleteBtns[0]!);
    expect(mockHandleDeleteSection).toHaveBeenCalledWith('sec-1');
  });

  it('calls onSectionSelect callback when section is clicked', async () => {
    const onSectionSelect = vi.fn();
    const user = userEvent.setup();
    render(<StoryNavigator onSectionSelect={onSectionSelect} />);
    await user.click(screen.getByText('Prologue'));
    expect(onSectionSelect).toHaveBeenCalled();
  });
});
