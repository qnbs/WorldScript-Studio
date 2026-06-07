/**
 * Tests for components/writing/ToolInputs.tsx
 * QNBS-v3: Mocks WriterViewContext; tests each tool's rendered UI (improve, changeTone, dialogue, brainstorm, etc.).
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

const mockProject = {
  manuscript: [{ id: 'sec-1', title: 'Chapter One', content: 'Sample content.' }],
  characters: [
    { id: 'char-1', name: 'Alice' },
    { id: 'char-2', name: 'Bob' },
  ],
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

vi.mock('../../../contexts/WriterViewContext', () => ({
  useWriterViewContext: () => ({
    project: mockProject,
    selectedSectionId: 'sec-1',
    handleContentChange: vi.fn(),
    writerState: mockWriterState,
    dispatch: mockDispatch,
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    language: 'en',
  }),
}));

vi.mock('../../../components/ui/DebouncedTextarea', () => ({
  DebouncedTextarea: ({ placeholder, id }: { placeholder?: string; id?: string }) => (
    <textarea data-testid={`textarea-${id ?? 'default'}`} placeholder={placeholder} />
  ),
}));

vi.mock('../../../components/ui/Checkbox', () => ({
  Checkbox: ({
    label,
    id,
  }: {
    label: string;
    id: string;
    checked: boolean;
    onChange: () => void;
  }) => (
    <label htmlFor={id}>
      <input type="checkbox" id={id} />
      {label}
    </label>
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

import { ToolInputs } from '../../../components/writing/ToolInputs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTool(activeTool: string, overrides: Partial<typeof mockWriterState> = {}) {
  Object.assign(mockWriterState, { activeTool, ...overrides });
  return render(
    <ToolInputs
      activeTool={activeTool}
      tone={mockWriterState.tone}
      isCustomTone={mockWriterState.isCustomTone}
      onToneSelect={vi.fn()}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockWriterState, {
      selection: { start: 0, end: 0, text: '' },
      activeTool: 'continue',
      tone: '',
      isCustomTone: false,
      dialogueCharacters: [],
      scenario: '',
      brainstormContext: '',
    });
  });

  it('renders continue instruction by default', () => {
    renderTool('continue');
    expect(screen.getByText('writer.studio.tools.continue.instruction')).toBeInTheDocument();
  });

  it('renders improve instruction', () => {
    renderTool('improve');
    expect(screen.getByText(/writer.studio.tools.improve.instruction/)).toBeInTheDocument();
  });

  it('renders changeTone tone selector', () => {
    renderTool('changeTone');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders changeTone custom tones in dropdown', () => {
    renderTool('changeTone');
    expect(
      screen.getByRole('option', { name: 'writer.studio.controls.tones.cinematic' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'writer.studio.controls.tones.formal' }),
    ).toBeInTheDocument();
  });

  it('renders custom tone input when isCustomTone is true', () => {
    renderTool('changeTone', { isCustomTone: true } as Partial<typeof mockWriterState>);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders dialogue characters label', () => {
    renderTool('dialogue');
    expect(screen.getByText('writer.studio.tools.dialogue.charactersLabel')).toBeInTheDocument();
  });

  it('renders character checkboxes for dialogue tool', () => {
    renderTool('dialogue');
    expect(screen.getByLabelText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText('Bob')).toBeInTheDocument();
  });

  it('renders scenario textarea for dialogue tool', () => {
    renderTool('dialogue');
    expect(screen.getByTestId('textarea-scenario')).toBeInTheDocument();
  });

  it('renders brainstorm context label', () => {
    renderTool('brainstorm');
    expect(screen.getByText('writer.studio.tools.brainstorm.contextLabel')).toBeInTheDocument();
  });

  it('renders brainstorm context textarea', () => {
    renderTool('brainstorm');
    expect(screen.getByTestId('textarea-brainstorm-context')).toBeInTheDocument();
  });

  it('renders imagePrompt description', () => {
    renderTool('imagePrompt');
    expect(screen.getByText('writer.imagePrompt.description')).toBeInTheDocument();
  });

  it('renders synopsis instruction', () => {
    renderTool('synopsis');
    expect(screen.getByText('writer.studio.tools.synopsis.instruction')).toBeInTheDocument();
  });

  it('renders critic instruction', () => {
    renderTool('critic');
    expect(screen.getByText('writer.studio.tools.critic.instruction')).toBeInTheDocument();
  });

  it('renders plotholes instruction', () => {
    renderTool('plotholes');
    expect(screen.getByText('writer.studio.tools.plotholes.instruction')).toBeInTheDocument();
  });

  it('renders consistency instruction', () => {
    renderTool('consistency');
    expect(screen.getByText('writer.studio.tools.consistency.instruction')).toBeInTheDocument();
  });

  it('renders grammarCheck instruction', () => {
    renderTool('grammarCheck');
    expect(screen.getByText('writer.studio.tools.grammarCheck.instruction')).toBeInTheDocument();
  });

  it('shows noSelection text in improve when no text is selected', () => {
    renderTool('improve', { selection: { start: 0, end: 0, text: '' } });
    expect(screen.getByText(/writer.studio.tools.improve.noSelection/)).toBeInTheDocument();
  });
});
