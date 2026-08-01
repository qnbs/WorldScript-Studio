import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    desktop: undefined as { minimizeToTray: boolean; desktopNotifications: boolean } | undefined,
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

// QNBS-v3 (T3): declared outside the vi.mock factory so tests can call `.mockReturnValue(...)` on
// it directly without importing (and type-checking against) the real hook's full return type.
const mockUseSettingsViewContext = vi.fn(() => baseContextValue);
vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => mockUseSettingsViewContext(),
}));

// QNBS-v3 (T3): the encrypted library export's desktop-notification branch dynamically imports
// this service — mock it so tests can control success/failure without touching a real OS API.
const mockSendDesktopNotification = vi.fn().mockResolvedValue(true);
vi.mock('../../../services/desktop/desktopNotifications', () => ({
  sendDesktopNotification: (...args: unknown[]) => mockSendDesktopNotification(...args),
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
  APP_FILE_SLUG: 'worldscript-studio',
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

// ---------------------------------------------------------------------------
// QNBS-v3 (T3): encrypted library backup desktop-notification gating (Copilot reviewer finding #8)
// ---------------------------------------------------------------------------
describe('DataSection encrypted library export desktop notification', () => {
  async function runEncryptedExport(desktopNotifications: boolean) {
    mockUseSettingsViewContext.mockReturnValue({
      ...baseContextValue,
      settings: {
        ...baseContextValue.settings,
        desktop: { minimizeToTray: false, desktopNotifications },
      },
    });
    render(<DataSection />);
    fireEvent.click(screen.getByText('settings.data.libraryExport.button'));
    fireEvent.change(screen.getByLabelText('settings.data.libraryExport.passphraseLabel'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByText('settings.data.libraryExport.confirm'));
    await waitFor(() =>
      expect(screen.queryByText('settings.data.libraryExport.confirm')).toBeNull(),
    );
  }

  beforeEach(() => {
    mockSendDesktopNotification.mockClear();
    mockSendDesktopNotification.mockResolvedValue(true);
  });

  afterEach(() => {
    mockUseSettingsViewContext.mockReturnValue(baseContextValue);
  });

  it('sends a desktop notification on successful export when enabled', async () => {
    await runEncryptedExport(true);
    await waitFor(() => expect(mockSendDesktopNotification).toHaveBeenCalledTimes(1));
    expect(mockSendDesktopNotification).toHaveBeenCalledWith(
      'settings.data.libraryExport.successTitle',
      'settings.data.libraryExport.successBody',
    );
  });

  it('does not send a desktop notification when disabled', async () => {
    await runEncryptedExport(false);
    expect(mockSendDesktopNotification).not.toHaveBeenCalled();
  });

  it('does not throw an unhandled rejection when the notification module fails', async () => {
    mockSendDesktopNotification.mockRejectedValueOnce(new Error('OS notification denied'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await runEncryptedExport(true);
      await waitFor(() => expect(mockSendDesktopNotification).toHaveBeenCalledTimes(1));
      // Flush the rejected notification promise's microtask queue.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
