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

// QNBS-v3: stub the LanguageTool hook (it pulls Redux selectors). Mutable so the default tests stay on
// the static TYPOS fallback (available:false) while the PR-C2 block drives the live LanguageTool path.
const ltMock = vi.hoisted(() => ({
  available: false,
  matches: [] as Array<Record<string, unknown>>,
  applySuggestion: vi.fn(),
}));

vi.mock('../../../hooks/useLanguageToolCheck', () => ({
  useLanguageToolCheck: () => ({
    available: ltMock.available,
    unsupportedLocale: false,
    status: 'idle',
    matches: ltMock.matches,
    check: vi.fn(),
    applySuggestion: ltMock.applySuggestion,
    ignore: vi.fn(),
    addToDictionary: vi.fn(),
    clear: vi.fn(),
  }),
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

// QNBS-v3 (#341): captured so tests can assert ManuscriptEditor passes variant="overlay" through,
// and so onScroll can be invoked manually to verify the mirror scroll-sync wiring.
let lastEditorTextareaVariant: string | undefined;
let lastEditorTextareaOnScroll: ((e: React.UIEvent<HTMLTextAreaElement>) => void) | undefined;

// Stub Textarea
vi.mock('../../../components/ui/Textarea', () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    variant,
    onScroll,
    // QNBS-v3 (#341): destructured out (not spread) so this mock's own stable "editor-textarea"
    // testid below always wins over whatever data-testid the real component now also passes.
    'data-testid': _dataTestId,
    ...rest
  }: {
    value: string;
    onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
    placeholder?: string;
    variant?: string;
    onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void;
    'data-testid'?: string;
    [k: string]: unknown;
  }) => {
    lastEditorTextareaVariant = variant;
    lastEditorTextareaOnScroll = onScroll;
    return (
      <textarea
        data-testid="editor-textarea"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onScroll={onScroll}
        {...(rest as object)}
      />
    );
  },
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
    ltMock.available = false;
    ltMock.matches = [];
    ltMock.applySuggestion.mockReset();
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

  describe('PR-C2 live LanguageTool overlay', () => {
    // "Hello world teh quick brown fox" — "teh" starts at offset 12.
    const tehMatch = {
      offset: 12,
      length: 3,
      message: 'Possible spelling mistake',
      shortMessage: '',
      replacements: ['the'],
      ruleId: 'MORFOLOGIK',
      category: 'TYPOS',
      categoryName: 'Typos',
      matchedText: 'teh',
      isSpelling: true,
    };

    it('underlines a LanguageTool-flagged word and applies its replacement offset-safe', async () => {
      ltMock.available = true;
      ltMock.matches = [tehMatch];
      // The overlay is aria-hidden, so query the spell-error button by class via the container.
      const { container } = render(<ManuscriptEditor isFocusMode={false} />);

      const flagged = container.querySelector('.spell-error');
      expect(flagged?.textContent).toBe('teh');
      await userEvent.click(flagged as Element);

      // Popover (role=dialog, not hidden) shows the LanguageTool message + the replacement chip.
      expect(await screen.findByText('Possible spelling mistake')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'the' }));

      // Applies via the hook (offset-safe), not the legacy regex path.
      expect(ltMock.applySuggestion).toHaveBeenCalledWith('sec-1', tehMatch, 'the');
    });

    it('does not use the static TYPOS fallback when LanguageTool is active', () => {
      ltMock.available = true;
      ltMock.matches = []; // LT active but found nothing → no underline at all
      const { container } = render(<ManuscriptEditor isFocusMode={false} />);
      // "teh" is in the static TYPOS map but must NOT be flagged while LT is the source of truth.
      expect(container.querySelector('.spell-error')).toBeNull();
    });
  });

  // QNBS-v3 (#341): same overlay-textarea/mirror-div pattern and defect as ContextPanel — the real
  // textarea must stay invisible-input-only, and the mirror must track its scroll position.
  describe('rendering fix (#341)', () => {
    it('passes variant="overlay" to the real textarea', () => {
      render(<ManuscriptEditor isFocusMode={false} />);
      expect(lastEditorTextareaVariant).toBe('overlay');
    });

    it('syncs the mirror scroll position when the real textarea scrolls', () => {
      render(<ManuscriptEditor isFocusMode={false} />);
      const mirror = screen.getByTestId('manuscript-editor-mirror');
      expect(lastEditorTextareaOnScroll).toBeDefined();
      Object.defineProperty(mirror, 'scrollTop', { value: 0, writable: true });
      lastEditorTextareaOnScroll?.({
        currentTarget: { scrollTop: 360, scrollLeft: 0 },
      } as unknown as React.UIEvent<HTMLTextAreaElement>);
      expect(mirror.scrollTop).toBe(360);
    });
  });
});
