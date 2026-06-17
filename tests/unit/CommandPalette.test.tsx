import { render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../components/CommandPalette';
import { useCommandPalette } from '../../hooks/useCommandPalette';
import { buildPaletteCommandModels } from '../../services/commands/commandBuilder';
import type { PaletteCommandModel } from '../../services/commands/commandTypes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        theme: 'dark',
        appearancePreset: 'default',
        aiMode: 'hybrid',
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.5,
        aiCreativity: 'Balanced',
        advancedAi: {},
        accessibility: {
          liveRegionVerbosity: 'full',
          highContrast: false,
          reducedMotion: false,
          largeText: false,
        },
        advancedEditor: {
          distractionFree: false,
          typewriterMode: false,
          zenMode: false,
          focusMode: false,
        },
        collaboration: { webrtcSignalingUrls: [] },
        featureFlags: {},
      },
      featureFlags: { enableCompileWizard: false, enableManuscriptResearchSplit: false },
      project: {
        present: {
          data: {
            id: 'p1',
            title: 'My Story',
            manuscript: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
          },
        },
      },
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    stopListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock('../../services/commands/buildPaletteCommandModels', () => ({
  buildPaletteCommandModels: vi.fn(() => []),
}));

vi.mock('../../services/commands/commandBuilder', () => ({
  buildPaletteCommandModels: vi.fn(() => []),
}));

vi.mock('../../services/commands/palettePreferences', () => ({
  loadPalettePreferences: vi.fn(() => ({ pinnedIds: [], recentIds: [] })),
  recordRecentCommand: vi.fn(),
  togglePinnedCommand: vi.fn(),
}));

vi.mock('../../services/commands/aiSuggestions', () => ({
  getLocalAiSuggestions: vi.fn(() => []),
}));

vi.mock('../../services/commands/effectiveTheme', () => ({
  getEffectiveTheme: vi.fn((t: string) => t),
}));

vi.mock('../../services/commands/wordCountApprox', () => ({
  approximateManuscriptWordCount: vi.fn(() => 0),
}));

vi.mock('../../services/commands/fuzzyScore', () => ({
  highlightSubsequence: vi.fn((text: string) => [{ text, match: false }]),
  normalizeSearch: vi.fn((s: string) => s),
  scoreAgainstQuery: vi.fn(() => 0),
}));

vi.mock('../../features/featureFlags/featureFlagsSlice', () => ({
  selectFeatureFlags: vi.fn((s: { featureFlags: unknown }) => s.featureFlags),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectProjectData: vi.fn(
    (s: { project: { present: { data: unknown } } }) => s.project.present.data,
  ),
  selectAllCharacters: vi.fn(() => []),
  selectAllWorlds: vi.fn(() => []),
}));

const mockOnClose = vi.fn();
const mockOnNavigate = vi.fn();

// QNBS-v3: keep the default empty-list mock for the smoke tests; populated per-test below.
afterEach(() => {
  vi.mocked(buildPaletteCommandModels).mockReturnValue([]);
});

const makeCommands = (n: number): PaletteCommandModel[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `cmd-${i}`,
    title: `Command ${i}`,
    categoryLabel: 'palette.category.global',
    category: 'global',
    icon: null,
    keywords: [],
    run: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette
        isOpen={false}
        onClose={mockOnClose}
        onNavigate={mockOnNavigate}
        currentView="dashboard"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows search input when open', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onNavigate={mockOnNavigate}
        currentView="dashboard"
      />,
    );
    const inputs = screen.getAllByPlaceholderText('palette.placeholder');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('shows the palette aria-label when open', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onNavigate={mockOnNavigate}
        currentView="dashboard"
      />,
    );
    expect(screen.getByRole('dialog', { name: 'palette.ariaLabel' })).toBeTruthy();
  });

  it('renders without throwing when open', () => {
    expect(() =>
      render(
        <CommandPalette
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
          currentView="writer"
        />,
      ),
    ).not.toThrow();
  });

  // QNBS-v3: the virtualized refactor flattens blocks into a single row list. Verify the hook's
  // row model deterministically (no DOM/layout): headings + options interleaved, with a stable
  // option-index → row-index map so the virtualizer can scroll the keyboard selection into view.
  it('builds a flattened heading+option row model with a stable option-index map', () => {
    vi.mocked(buildPaletteCommandModels).mockReturnValue(makeCommands(60));
    const { result } = renderHook(() =>
      useCommandPalette({
        isOpen: true,
        onClose: mockOnClose,
        onNavigate: mockOnNavigate,
        currentView: 'dashboard',
      }),
    );
    const headings = result.current.rows.filter((r) => r.kind === 'heading');
    const options = result.current.rows.filter((r) => r.kind === 'option');
    expect(headings.length).toBe(1);
    expect(options.length).toBe(60);
    expect(result.current.flatItems.length).toBe(60);
    // Row 0 is the section heading, so option index 0 lives at row index 1.
    expect(result.current.optionIndexToRowIndex.get(0)).toBe(1);
    expect(result.current.optionIndexToRowIndex.get(59)).toBe(60);
  });
});
