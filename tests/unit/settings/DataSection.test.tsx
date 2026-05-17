import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSection } from '../../../components/settings/DataSection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleExport = vi.fn();
const mockHandleImport = vi.fn();
const mockSetModal = vi.fn();

const baseContextValue = {
  t: (k: string) => k,
  language: 'en',
  settings: {
    theme: 'dark',
    editorFont: 'serif',
    fontSize: 16,
    lineSpacing: 1.5,
    paragraphSpacing: 1.5,
    aiCreativity: 'Balanced',
    advancedAi: {},
    accessibility: { liveRegionVerbosity: 'full' },
    collaboration: { webrtcSignalingUrls: [] },
    featureFlags: {},
    keyboardShortcuts: [],
    themeCustomization: {
      primaryColor: '#000',
      secondaryColor: '#000',
      accentColor: '#000',
      backgroundColor: '#000',
    },
  },
  featureFlags: {},
  project: {
    title: 'My Story',
    manuscript: [],
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
  },
  activeCategory: 'general',
  setActiveCategory: vi.fn(),
  modal: { state: 'closed', payload: {} },
  setModal: mockSetModal,
  importFileRef: { current: null },
  snapshots: [],
  snapshotName: '',
  setSnapshotName: vi.fn(),
  handleLanguageChange: vi.fn(),
  handleSettingChange: vi.fn(),
  handleExport: mockHandleExport,
  handleImport: mockHandleImport,
  handleResetProject: vi.fn(),
  handleCreateSnapshot: vi.fn(),
  handleRestoreSnapshot: vi.fn(),
  handleDeleteSnapshot: vi.fn(),
  projectSize: '2.3 KB',
  currentWordCount: 0,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: vi.fn(() => baseContextValue),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn(() => ({})),
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  settingsActions: {
    setSettings: vi.fn((x: unknown) => ({ type: 'settings/setSettings', payload: x })),
  },
  default: (s = {}) => s,
}));

vi.mock('../../../features/settings/keyboardShortcutsDefaults', () => ({
  getDefaultKeyboardShortcuts: vi.fn(() => []),
  SHORTCUT_ACTION_REGISTRY: [],
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((x: unknown) => ({ type: 'status/addNotification', payload: x })),
  },
  default: (s = {}) => s,
}));

vi.mock('../../../services/libraryBackupService', () => ({
  buildEncryptedLibraryZipBlob: vi.fn().mockResolvedValue(new Blob(['zip'])),
}));

vi.mock('../../../services/settingsExchange', () => ({
  buildSettingsExportEnvelope: vi.fn(() => ({ version: 1, settings: {} })),
  parseSettingsImportEnvelope: vi.fn(() => null),
}));

vi.mock('../../../constants', () => ({
  ICONS: { export: '↑', import: '↓', reset: '✗' },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<DataSection />)).not.toThrow();
  });

  it('shows data section title', () => {
    render(<DataSection />);
    expect(screen.getByText('settings.data.title')).toBeTruthy();
  });

  it('shows export button', () => {
    render(<DataSection />);
    expect(screen.getByText('settings.data.export')).toBeTruthy();
  });

  it('shows import button', () => {
    render(<DataSection />);
    expect(screen.getByText('settings.data.import')).toBeTruthy();
  });

  it('shows reset button', () => {
    render(<DataSection />);
    expect(screen.getByText('settings.data.reset')).toBeTruthy();
  });

  it('calls handleExport when export button is clicked', () => {
    render(<DataSection />);
    const exportBtn = screen.getByText('settings.data.export');
    fireEvent.click(exportBtn);
    expect(mockHandleExport).toHaveBeenCalled();
  });

  it('calls setModal when reset button is clicked', () => {
    render(<DataSection />);
    const resetBtn = screen.getByText('settings.data.reset');
    fireEvent.click(resetBtn);
    expect(mockSetModal).toHaveBeenCalledWith({ state: 'reset', payload: {} });
  });

  it('shows project size', () => {
    render(<DataSection />);
    // t('settings.data.projectSize', ...) returns the key with interpolation
    expect(screen.getByText(/settings.data.projectSize/)).toBeTruthy();
  });
});
