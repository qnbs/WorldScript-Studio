import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../../components/SettingsView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const baseContextValue = {
  t: (k: string) => k,
  language: 'en',
  settings: {
    theme: 'dark',
    editorFont: 'serif',
    fontSize: 16,
    lineSpacing: 1.5,
    aiCreativity: 'Balanced',
    advancedAi: {},
    accessibility: { liveRegionVerbosity: 'full' },
    collaboration: { webrtcSignalingUrls: [] },
    featureFlags: {},
  },
  featureFlags: {
    enableCompileWizard: false,
    enableManuscriptResearchSplit: false,
  },
  project: {
    title: 'My Story',
    manuscript: [],
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
  },
  activeCategory: 'general',
  setActiveCategory: vi.fn(),
  modal: { state: 'closed', payload: {} },
  setModal: vi.fn(),
  importFileRef: { current: null },
  snapshots: [],
  snapshotName: '',
  setSnapshotName: vi.fn(),
  handleLanguageChange: vi.fn(),
  handleSettingChange: vi.fn(),
  handleExport: vi.fn(),
  handleImport: vi.fn(),
  handleResetProject: vi.fn(),
  handleCreateSnapshot: vi.fn(),
  handleRestoreSnapshot: vi.fn(),
  handleDeleteSnapshot: vi.fn(),
  projectSize: '2.3 KB',
  currentWordCount: 0,
};

vi.mock('../../hooks/useSettingsView', () => ({
  useSettingsView: vi.fn(() => baseContextValue),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 },
      // QNBS-v3: SettingsViewUI reads s.featureFlags.enableVoiceSupport — must include all 21 flags
      featureFlags: {
        enableCodexAutoTracking: true,
        enableCrossProjectSearch: true,
        enablePlotBoardV2: true,
        enableDuckDbAnalytics: false,
        enableVoiceSupport: false,
        enableProForge: false,
        enableStoryBibleAdvanced: false,
        enableBinderResearch: false,
        enableCompileWizard: false,
        enableProjectHealthScore: false,
        enableAppHealthPanel: false,
        enableIdbAtRestEncryption: false,
        enableVoiceWasm: false,
        enableRtlLayout: false,
        enableAdaptiveAiEngine: false,
        enableWebnnInference: false,
        enableComputeShaders: false,
        enableWorkerBusV2: false,
        enableRustCompute: false,
        enableLoraAdapters: false,
        enablePluginSystem: false,
        enableObjectsGroups: false,
        enableMindMaps: false,
        enableCharacterInterviews: false,
      },
    }),
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

vi.mock('../../components/ApiKeySection', () => ({
  default: () => <div data-testid="api-key-section" />,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsView', () => {
  it('renders without throwing', () => {
    expect(() => render(<SettingsView />)).not.toThrow();
  });

  it('shows category nav items', () => {
    render(<SettingsView />);
    // getAllByText because Button wraps children in a span, so the text appears in multiple nodes
    expect(screen.getAllByText('settings.categories.general').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.categories.appearance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.categories.ai').length).toBeGreaterThan(0);
  });

  it('shows general category panel by default', () => {
    render(<SettingsView />);
    // General is active, so language section should be visible
    expect(screen.getByText('settings.language.title')).toBeTruthy();
  });

  it('shows settings search input', () => {
    render(<SettingsView />);
    // type="search" inputs have role "searchbox"
    const searchInputs = screen.getAllByRole('searchbox');
    expect(searchInputs.length).toBeGreaterThan(0);
  });

  it('calls setActiveCategory when a nav button is clicked', () => {
    render(<SettingsView />);
    // Find the appearance nav button and click it
    const appearanceButton = screen.getAllByText('settings.categories.appearance')[0]!;
    fireEvent.click(appearanceButton);
    expect(baseContextValue.setActiveCategory).toHaveBeenCalledWith('appearance');
  });

  it('hides unmatched nav items when search query is entered', () => {
    render(<SettingsView />);
    const searchInput = screen.getAllByRole('searchbox')[0]!;
    // Type a query that matches nothing — expect categories to vanish
    fireEvent.change(searchInput, { target: { value: 'zzznotarealcategory' } });
    // All category nav buttons should be hidden; "no results" text or zero nav items
    expect(screen.queryAllByText('settings.categories.general').length).toBe(0);
  });

  it('shows group headers in ungrouped nav (X-1)', () => {
    render(<SettingsView />);
    // Group headers render as non-interactive divs with t() key values
    expect(screen.getByText('settings.categories.writing')).toBeTruthy();
    expect(screen.getByText('settings.categories.aiModels')).toBeTruthy();
    expect(screen.getByText('settings.categories.system')).toBeTruthy();
  });

  it('hides group headers when search is active', () => {
    render(<SettingsView />);
    const searchInput = screen.getAllByRole('searchbox')[0]!;
    fireEvent.change(searchInput, { target: { value: 'editor' } });
    // Group headers should not render in search mode
    expect(screen.queryByText('settings.categories.writing')).toBeNull();
  });
});
