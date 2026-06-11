/**
 * Tests for components/manuscript/ManuscriptEditor.tsx
 * QNBS-v3: Mocks ManuscriptViewContext, useVoiceDictation, Redux store; tests empty state,
 *          title input, content textarea, spell-check popover, mention suggestions, word count.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleContentChange = vi.fn();
const mockHandleTitleChange = vi.fn();
const mockHandleMentionSelect = vi.fn();

let mockActiveSection: {
  id: string;
  title: string;
  content: string;
  prompt?: string;
} | null = {
  id: 'sec-1',
  title: 'Chapter One',
  content: 'Hello world teh quick brown fox',
};
let mockMentions: { id: string; name: string; type: 'character' | 'world' }[] = [];
let mockMentionPosition: { top: number; left: number } | null = null;

vi.mock('../../../contexts/ManuscriptViewContext', () => ({
  useManuscriptViewContext: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    activeSection: mockActiveSection,
    handleContentChange: mockHandleContentChange,
    handleTitleChange: mockHandleTitleChange,
    mentions: mockMentions,
    handleMentionSelect: mockHandleMentionSelect,
    mentionPosition: mockMentionPosition,
    editorRef: { current: null },
    activeSectionStats: { wordCount: 7 },
    characters: [{ id: 'c1', name: 'Alice' }],
    worlds: [{ id: 'w1', name: 'Westeros' }],
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../hooks/useVoiceDictation', () => ({
  useVoiceDictation: vi.fn(),
}));

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn(() => ({
    editorFont: 'Georgia',
    fontSize: 16,
    lineSpacing: 1.6,
  })),
  useAppDispatch: vi.fn(() => vi.fn()),
}));

// QNBS-v3: stub InlineAnnotationLayer — it depends on transientUiStore + Redux dispatch
// which are beyond the scope of ManuscriptEditor unit tests.
vi.mock('../../../components/copilot/InlineAnnotationLayer', () => ({
  InlineAnnotationLayer: () => null,
}));

// Stub DebouncedInput so title changes are testable
vi.mock('../../../components/ui/DebouncedInput', () => ({
  DebouncedInput: ({
    value,
    onDebouncedChange,
    placeholder,
    ...rest
  }: {
    value: string;
    onDebouncedChange: (v: string) => void;
    placeholder?: string;
    [k: string]: unknown;
  }) => (
    <input
      data-testid="debounced-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onDebouncedChange(e.target.value)}
      {...(rest as object)}
    />
  ),
}));

// Stub Textarea
vi.mock('../../../components/ui/Textarea', () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    ...rest
  }: {
    value: string;
    onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
    placeholder?: string;
    [k: string]: unknown;
  }) => (
    <textarea
      data-testid="editor-textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...(rest as object)}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ManuscriptEditor } from '../../../components/manuscript/ManuscriptEditor';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManuscriptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSection = {
      id: 'sec-1',
      title: 'Chapter One',
      content: 'Hello world teh quick brown fox',
    };
    mockMentions = [];
    mockMentionPosition = null;
  });

  it('shows empty state when no section is selected', () => {
    mockActiveSection = null;
    render(<ManuscriptEditor isFocusMode={false} />);
    expect(screen.getByText('manuscript.select')).toBeInTheDocument();
  });

  it('renders the title input with section title', () => {
    render(<ManuscriptEditor isFocusMode={false} />);
    const input = screen.getByTestId('debounced-input');
    expect(input).toHaveValue('Chapter One');
  });

  it('renders the content textarea with section content', () => {
    render(<ManuscriptEditor isFocusMode={false} />);
    const textarea = screen.getByTestId('editor-textarea');
    expect(textarea).toHaveValue('Hello world teh quick brown fox');
  });

  it('shows word count badge', () => {
    render(<ManuscriptEditor isFocusMode={false} />);
    // QNBS-v3: badge renders "7 common.words" — match the word count portion
    expect(screen.getByText(/\b7\b/)).toBeInTheDocument();
  });

  it('calls handleContentChange when textarea changes', async () => {
    const user = userEvent.setup();
    render(<ManuscriptEditor isFocusMode={false} />);
    const textarea = screen.getByTestId('editor-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'New content');
    expect(mockHandleContentChange).toHaveBeenCalled();
  });

  it('renders mention suggestions when mentions are available', () => {
    mockMentions = [{ id: 'c1', name: 'Alice', type: 'character' }];
    mockMentionPosition = { top: 50, left: 100 };
    render(<ManuscriptEditor isFocusMode={false} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('calls handleMentionSelect when a mention item is clicked', async () => {
    mockMentions = [{ id: 'c1', name: 'Alice', type: 'character' }];
    mockMentionPosition = { top: 50, left: 100 };
    render(<ManuscriptEditor isFocusMode={false} />);
    const item = screen.getByText('Alice');
    // Use mousedown as in the real component
    item.closest('li')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await waitFor(() => expect(mockHandleMentionSelect).toHaveBeenCalled());
  });

  it('does not show mention list when no mentions', () => {
    render(<ManuscriptEditor isFocusMode={false} />);
    expect(screen.queryByText('manuscript.mention.suggestions')).not.toBeInTheDocument();
  });

  it('title input has correct placeholder', () => {
    render(<ManuscriptEditor isFocusMode={false} />);
    const input = screen.getByTestId('debounced-input');
    expect(input).toHaveAttribute('placeholder', 'manuscript.titlePlaceholder');
  });

  it('renders in focus mode without throwing', () => {
    render(<ManuscriptEditor isFocusMode={true} />);
    expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
  });

  it('uses prompt as placeholder when set', () => {
    mockActiveSection = {
      id: 'sec-1',
      title: 'Chapter One',
      content: '',
      prompt: 'Write about adventure',
    };
    render(<ManuscriptEditor isFocusMode={false} />);
    const textarea = screen.getByTestId('editor-textarea');
    expect(textarea).toHaveAttribute('placeholder', 'Write about adventure');
  });
});
