import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../components/CommandPalette';

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
});
