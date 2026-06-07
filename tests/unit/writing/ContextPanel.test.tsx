/**
 * Tests for components/writing/ContextPanel.tsx
 * QNBS-v3: Mocks WriterViewContext + useAppSelector; tests section selector, editor, content display.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

const mockProject = {
  manuscript: [
    { id: 'sec-1', title: 'Chapter One', content: 'Once upon a time...' },
    { id: 'sec-2', title: 'Chapter Two', content: 'The story continued.' },
  ],
  characters: [],
  worlds: [],
};

const mockWriterState = {
  selection: { start: 0, end: 0, text: '' },
  activeTool: 'continue',
  tone: '',
  isCustomTone: false,
  dialogueCharacters: [],
  scenario: '',
  brainstormContext: '',
  selectedSectionId: 'sec-1',
  useRagContext: false,
  isLoading: false,
  result: '',
  error: null,
};

let mockSelectedSectionId: string | null = 'sec-1';

vi.mock('../../../contexts/WriterViewContext', () => ({
  useWriterViewContext: () => ({
    project: mockProject,
    selectedSectionId: mockSelectedSectionId,
    handleContentChange: vi.fn(),
    writerState: mockWriterState,
    dispatch: mockDispatch,
  }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.5,
      },
    }),
  ),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    language: 'en',
  }),
}));

// Stub DebouncedTextarea to avoid debounce complexity in tests
vi.mock('../../../components/ui/DebouncedTextarea', () => ({
  DebouncedTextarea: ({
    value,
    placeholder,
    'aria-label': ariaLabel,
    ...rest
  }: {
    value: string;
    placeholder?: string;
    'aria-label'?: string;
    [key: string]: unknown;
  }) => (
    <textarea
      data-testid="debounced-textarea"
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...(rest as object)}
    />
  ),
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

import { ContextPanel } from '../../../components/writing/ContextPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedSectionId = 'sec-1';
    mockWriterState.activeTool = 'continue';
    mockWriterState.selection = { start: 0, end: 0, text: '' };
  });

  it('renders context panel title', () => {
    render(<ContextPanel />);
    expect(screen.getByText('writer.studio.context.title')).toBeInTheDocument();
  });

  it('renders section label', () => {
    render(<ContextPanel />);
    expect(screen.getByText('writer.studio.context.sectionLabel')).toBeInTheDocument();
  });

  it('renders section select with all chapters', () => {
    render(<ContextPanel />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chapter One' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chapter Two' })).toBeInTheDocument();
  });

  it('renders the editor textarea', () => {
    render(<ContextPanel />);
    expect(screen.getByTestId('writer-studio-editor')).toBeInTheDocument();
  });

  it('shows section content in editor', () => {
    render(<ContextPanel />);
    const textarea = screen.getByTestId('writer-studio-editor');
    expect(textarea).toHaveValue('Once upon a time...');
  });

  it('dispatches setSelectedSectionId when section changes', async () => {
    const user = userEvent.setup();
    render(<ContextPanel />);
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'sec-2');
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('sets aria-label from selected section title', () => {
    render(<ContextPanel />);
    const textarea = screen.getByTestId('writer-studio-editor');
    expect(textarea).toHaveAttribute('aria-label', expect.stringContaining('Chapter One'));
  });

  it('shows placeholder when no section selected', () => {
    mockSelectedSectionId = null;
    render(<ContextPanel />);
    const textarea = screen.getByTestId('writer-studio-editor');
    expect(textarea).toHaveAttribute('placeholder', 'writer.studio.context.contentPlaceholder');
  });
});
