import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OutlineGeneratorView } from '../../components/OutlineGeneratorView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleGenerate = vi.fn();
const mockSetGenre = vi.fn();
const mockSetIdea = vi.fn();
const mockSetShowAdvanced = vi.fn();
const mockRegenerateSection = vi.fn();

const baseContextValue = {
  t: (k: string) => k,
  genre: '',
  setGenre: mockSetGenre,
  idea: '',
  setIdea: mockSetIdea,
  showAdvanced: false,
  setShowAdvanced: mockSetShowAdvanced,
  characters: '',
  setCharacters: vi.fn(),
  setting: '',
  setSetting: vi.fn(),
  pacing: '',
  setPacing: vi.fn(),
  numChapters: 10,
  setNumChapters: vi.fn(),
  includeTwist: false,
  setIncludeTwist: vi.fn(),
  isLoading: false,
  handleGenerate: mockHandleGenerate,
  outline: [],
  editingIndex: null,
  setEditingIndex: vi.fn(),
  editingContent: '',
  setEditingContent: vi.fn(),
  editingTitle: '',
  setEditingTitle: vi.fn(),
  handleSaveEdit: vi.fn(),
  handleApply: vi.fn(),
  regenerateSection: mockRegenerateSection,
  isRegenerating: false,
};

vi.mock('../../hooks/useOutlineGenerator', () => ({
  useOutlineGenerator: vi.fn(() => baseContextValue),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
  useAppSelectorShallow: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

const mockOnNavigate = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutlineGeneratorView', () => {
  it('renders without throwing', () => {
    expect(() => render(<OutlineGeneratorView onNavigate={mockOnNavigate} />)).not.toThrow();
  });

  it('shows the idea form title', () => {
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('outline.idea.title')).toBeTruthy();
  });

  it('shows genre and idea labels', () => {
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('outline.idea.genreLabel')).toBeTruthy();
    expect(screen.getByText('outline.idea.promptLabel')).toBeTruthy();
  });

  it('shows generate button', () => {
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('outline.idea.generateButton')).toBeTruthy();
  });

  it('shows advanced toggle button', () => {
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    expect(screen.getByText(/outline\.advanced\.title/)).toBeTruthy();
  });

  it('calls handleGenerate when generate button is clicked', async () => {
    const { useOutlineGenerator } = await import('../../hooks/useOutlineGenerator');
    vi.mocked(useOutlineGenerator).mockReturnValueOnce({
      ...baseContextValue,
      genre: 'Fantasy',
      idea: 'A dragon saves the world.',
    } as never);
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    fireEvent.click(screen.getByText('outline.idea.generateButton'));
    expect(mockHandleGenerate).toHaveBeenCalledOnce();
  });

  it('shows outline sections when outline is provided', async () => {
    const { useOutlineGenerator } = await import('../../hooks/useOutlineGenerator');
    vi.mocked(useOutlineGenerator).mockReturnValueOnce({
      ...baseContextValue,
      outline: [
        { id: 'o1', title: 'Chapter One', description: 'Hero arrives.' },
        { id: 'o2', title: 'Chapter Two', description: 'Conflict begins.' },
      ],
    } as never);
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    // section titles are rendered in inputs — use getByDisplayValue
    expect(screen.getByDisplayValue('Chapter One')).toBeTruthy();
    expect(screen.getByDisplayValue('Chapter Two')).toBeTruthy();
  });

  it('shows loading spinner when isLoading is true', async () => {
    const { useOutlineGenerator } = await import('../../hooks/useOutlineGenerator');
    vi.mocked(useOutlineGenerator).mockReturnValueOnce({
      ...baseContextValue,
      isLoading: true,
    } as never);
    render(<OutlineGeneratorView onNavigate={mockOnNavigate} />);
    // generate button should show loading state (disabled)
    const generateBtns = screen.getAllByRole('button');
    const generateBtn = generateBtns.find((b) => b.hasAttribute('disabled'));
    expect(generateBtn).toBeTruthy();
  });
});
