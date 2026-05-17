import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('settings.categories.general')).toBeTruthy();
    expect(screen.getByText('settings.categories.appearance')).toBeTruthy();
    expect(screen.getByText('settings.categories.ai')).toBeTruthy();
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
});
