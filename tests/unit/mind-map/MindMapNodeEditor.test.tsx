/**
 * Tests for components/mind-map/MindMapNodeEditor.tsx
 * QNBS-v3: Mocks MindMapViewContext; tests label/type inputs, shape buttons, color swatches, save/delete.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleCloseNodeEditor = vi.fn();
const mockHandleUpdateNode = vi.fn();
const mockHandleDeleteNode = vi.fn();

const mockNode = {
  id: 'node-1',
  label: 'Test Node',
  textNotes: 'Some notes',
  type: 'free' as const,
  shape: 'rectangle' as const,
  color: '#6366f1',
  linkedEntityType: undefined,
};

let mockIsNodeEditorOpen = true;
let mockSelectedNodeId: string | null = 'node-1';

vi.mock('../../../contexts/MindMapViewContext', () => ({
  useMindMapViewContext: () => ({
    activeMindMap: {
      nodes: [mockNode],
      edges: [],
      id: 'mm-1',
    },
    selectedNodeId: mockSelectedNodeId,
    isNodeEditorOpen: mockIsNodeEditorOpen,
    handleCloseNodeEditor: mockHandleCloseNodeEditor,
    handleUpdateNode: mockHandleUpdateNode,
    handleDeleteNode: mockHandleDeleteNode,
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
  }),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MindMapNodeEditor } from '../../../components/mind-map/MindMapNodeEditor';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMapNodeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNodeEditorOpen = true;
    mockSelectedNodeId = 'node-1';
    mockNode.label = 'Test Node';
    mockNode.textNotes = 'Some notes';
    mockNode.type = 'free';
    mockNode.shape = 'rectangle';
    mockNode.color = '#6366f1';
    mockNode.linkedEntityType = undefined;
  });

  it('renders nothing when editor is closed', () => {
    mockIsNodeEditorOpen = false;
    const { container } = render(<MindMapNodeEditor />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no node is selected', () => {
    mockSelectedNodeId = null;
    const { container } = render(<MindMapNodeEditor />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders edit node heading', () => {
    render(<MindMapNodeEditor />);
    expect(screen.getByText('mindmap.editNode')).toBeInTheDocument();
  });

  it('renders label input with current value', () => {
    render(<MindMapNodeEditor />);
    const input = screen.getByRole('textbox', { name: 'mindmap.nodeLabel' });
    expect(input).toHaveValue('Test Node');
  });

  it('renders node type selector', () => {
    render(<MindMapNodeEditor />);
    // The type select has label "mindmap.nodeType" but label association uses htmlFor
    expect(screen.getByLabelText('mindmap.nodeType')).toBeInTheDocument();
  });

  it('renders shape buttons', () => {
    render(<MindMapNodeEditor />);
    const shapeGroup = screen.getByRole('group', { name: 'mindmap.nodeShape' });
    const buttons = within(shapeGroup).getAllByRole('button');
    expect(buttons.length).toBe(5); // circle, rectangle, diamond, ellipse, hexagon
  });

  it('marks current shape as pressed', () => {
    render(<MindMapNodeEditor />);
    const shapeGroup = screen.getByRole('group', { name: 'mindmap.nodeShape' });
    const rectBtn = within(shapeGroup).getByText('mindmap.nodeShapeRectangle');
    expect(rectBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders color swatch buttons', () => {
    render(<MindMapNodeEditor />);
    const colorGroup = screen.getByRole('group', { name: 'mindmap.nodeColor' });
    const swatches = within(colorGroup).getAllByRole('button');
    expect(swatches.length).toBe(7);
  });

  it('marks current color swatch as pressed', () => {
    render(<MindMapNodeEditor />);
    const colorGroup = screen.getByRole('group', { name: 'mindmap.nodeColor' });
    const accentSwatch = within(colorGroup).getByLabelText('#6366f1');
    expect(accentSwatch).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders notes textarea with current value', () => {
    render(<MindMapNodeEditor />);
    const textarea = screen.getByRole('textbox', { name: 'mindmap.nodeNotes' });
    expect(textarea).toHaveValue('Some notes');
  });

  it('calls handleUpdateNode when save is clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    await user.click(screen.getByText('mindmap.save'));
    expect(mockHandleUpdateNode).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({ label: 'Test Node' }),
    );
  });

  it('calls handleCloseNodeEditor after save', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    await user.click(screen.getByText('mindmap.save'));
    expect(mockHandleCloseNodeEditor).toHaveBeenCalled();
  });

  it('calls handleDeleteNode when delete is clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    await user.click(screen.getByText('mindmap.deleteNode'));
    expect(mockHandleDeleteNode).toHaveBeenCalledWith('node-1');
  });

  it('calls handleCloseNodeEditor when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    await user.click(screen.getByText('mindmap.cancel'));
    expect(mockHandleCloseNodeEditor).toHaveBeenCalled();
  });

  it('shows linked entity type selector when type is linked', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    const typeSelect = screen.getByRole('combobox');
    await user.selectOptions(typeSelect, 'linked');
    expect(screen.getByLabelText('mindmap.linkedEntityType')).toBeInTheDocument();
  });

  it('changes shape when a shape button is clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapNodeEditor />);
    const shapeGroup = screen.getByRole('group', { name: 'mindmap.nodeShape' });
    const circleBtn = within(shapeGroup).getByText('mindmap.nodeShapeCircle');
    await user.click(circleBtn);
    expect(circleBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
