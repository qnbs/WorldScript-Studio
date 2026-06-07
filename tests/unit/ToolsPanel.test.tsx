/**
 * Tests for components/writing/ToolsPanel.tsx
 * QNBS-v3: Mocks WriterViewContext; tests tool button grid, generate button, RAG checkbox.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockHandleGenerate = vi.fn();
const mockIsGenerateDisabled = vi.fn().mockReturnValue(false);

let mockWriterState = {
  activeTool: 'continue' as string,
  tone: '',
  style: '',
  isLoading: false,
  useRagContext: true,
  lastRagChunkCount: 0,
  selection: { start: 0, end: 0, text: '' },
  selectedSectionId: null as string | null,
};

vi.mock('../../contexts/WriterViewContext', () => ({
  useWriterViewContext: () => ({
    writerState: mockWriterState,
    dispatch: mockDispatch,
    isGenerateDisabled: mockIsGenerateDisabled,
    handleGenerate: mockHandleGenerate,
    project: { manuscript: [], title: 'Test', id: 'p1' },
    selectedSectionId: null,
    handleContentChange: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// Mock ToolInputs to isolate ToolsPanel
vi.mock('../../components/writing/ToolInputs', () => ({
  ToolInputs: () => <div data-testid="tool-inputs" />,
}));

vi.mock('../../components/ui/Select', () => ({
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

import { ToolsPanel } from '../../components/writing/ToolsPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGenerateDisabled.mockReturnValue(false);
    mockWriterState = {
      activeTool: 'continue',
      tone: '',
      style: '',
      isLoading: false,
      useRagContext: true,
      lastRagChunkCount: 0,
      selection: { start: 0, end: 0, text: '' },
      selectedSectionId: null,
    };
  });

  it('renders the tools group', () => {
    render(<ToolsPanel />);
    expect(screen.getByRole('group', { name: 'writer.tools.selectLabel' })).toBeInTheDocument();
  });

  it('renders at least 5 tool buttons', () => {
    render(<ToolsPanel />);
    const buttons = screen.getAllByRole('button', { hidden: false });
    // Tool grid buttons + generate button
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });

  it('shows RAG checkbox', () => {
    render(<ToolsPanel />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('dispatches setUseRagContext when checkbox toggled', async () => {
    const user = userEvent.setup();
    render(<ToolsPanel />);
    await user.click(screen.getByRole('checkbox'));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('shows generate button when not loading', () => {
    render(<ToolsPanel />);
    expect(screen.getByText('common.generate')).toBeInTheDocument();
  });

  it('shows stop button when loading', () => {
    mockWriterState = { ...mockWriterState, isLoading: true };
    render(<ToolsPanel />);
    expect(screen.getByText('writer.stopGenerating')).toBeInTheDocument();
  });

  it('dispatches setActiveTool when a tool button is clicked', async () => {
    const user = userEvent.setup();
    render(<ToolsPanel />);
    const improveBtn = screen.getByRole('button', {
      name: 'writer.studio.tools.improve.title',
    });
    await user.click(improveBtn);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('calls handleGenerate when generate button is clicked', async () => {
    const user = userEvent.setup();
    render(<ToolsPanel />);
    await user.click(screen.getByText('common.generate'));
    expect(mockHandleGenerate).toHaveBeenCalledTimes(1);
  });

  it('generate button is disabled when isGenerateDisabled returns true', () => {
    mockIsGenerateDisabled.mockReturnValue(true);
    render(<ToolsPanel />);
    const generateBtn = screen.getByText('common.generate').closest('button');
    expect(generateBtn).toBeDisabled();
  });

  it('shows active tool button with aria-pressed=true', () => {
    mockWriterState = { ...mockWriterState, activeTool: 'improve' };
    render(<ToolsPanel />);
    const improveBtn = screen.getByRole('button', {
      name: 'writer.studio.tools.improve.title',
    });
    expect(improveBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows style select for continue tool', () => {
    mockWriterState = { ...mockWriterState, activeTool: 'continue' };
    render(<ToolsPanel />);
    expect(screen.getAllByRole('combobox')[0]).toBeInTheDocument();
  });

  it('shows RAG chunk badge when lastRagChunkCount > 0', () => {
    mockWriterState = { ...mockWriterState, lastRagChunkCount: 3 };
    render(<ToolsPanel />);
    expect(screen.getByTitle('writer.studio.rag.chunksHint')).toBeInTheDocument();
  });

  it('renders ToolInputs component', () => {
    render(<ToolsPanel />);
    expect(screen.getByTestId('tool-inputs')).toBeInTheDocument();
  });
});
