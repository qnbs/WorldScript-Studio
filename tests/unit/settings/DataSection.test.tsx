import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// QNBS-v3 (T3): declared outside the vi.mock factory so tests can call `.mockReturnValue(...)` without importing the real hook's return type.
const mockUseSettingsViewContext = vi.fn(() => baseContextValue);
vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => mockUseSettingsViewContext(),
}));

// QNBS-v3 (T3): the encrypted library export's notification branch dynamically imports this service — mock it for deterministic tests.
const mockSendDesktopNotification = vi.fn().mockResolvedValue(true);
vi.mock('../../../services/desktop/desktopNotifications', () => ({
  sendDesktopNotification: (...args: unknown[]) => mockSendDesktopNotification(...args),
}));

const mockDispatch = vi.fn();
vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn(() => ({})),
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  settingsActions: {
    setSettings: vi.fn((x: unknown) => ({ type: 'settings/setSettings', payload: x })),
  },
  default: (s = {}) => s,
}));

vi.mock('../../../services/storage/idbProjectStore', () => ({
  // QNBS-v3: identity pass-through — this integration test only asserts the import path *calls* the sanitizer; normalizePersistedSettings' own stripping logic is unit-tested separately.
  normalizePersistedSettings: vi.fn((s: unknown) => s),
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

// QNBS-v3: a raw settings import previously bypassed sanitization entirely, letting a legacy/crafted openRouter.apiKey reach Redux (and then autosave) unfiltered.
describe('DataSection settings-file import sanitization', () => {
  beforeEach(async () => {
    mockDispatch.mockClear();
    const { normalizePersistedSettings } = await import(
      '../../../services/storage/idbProjectStore'
    );
    vi.mocked(normalizePersistedSettings).mockClear();
  });

  it('routes an imported settings file through normalizePersistedSettings before dispatching', async () => {
    const { parseSettingsImportEnvelope } = await import('../../../services/settingsExchange');
    const importedPartial = { openRouter: { apiKey: 'sk-should-be-stripped', enabled: true } };
    vi.mocked(parseSettingsImportEnvelope).mockReturnValueOnce(importedPartial as never);

    render(<DataSection />);
    const fileInput = document.querySelector('input[type="file"][accept=".json,application/json"]');
    expect(fileInput).toBeTruthy();

    const file = new File(
      [JSON.stringify({ worldscriptSettingsExportVersion: 1, settings: {} })],
      'settings.json',
      {
        type: 'application/json',
      },
    );
    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: '{}', configurable: true });
      void Promise.resolve().then(() => {
        if (typeof this.onload === 'function')
          this.onload(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    });

    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });

    const { normalizePersistedSettings } = await import(
      '../../../services/storage/idbProjectStore'
    );
    await waitFor(() => expect(normalizePersistedSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(normalizePersistedSettings).mock.calls[0]?.[0]).toMatchObject(importedPartial);

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'settings/setSettings',
      // QNBS-v3: identity-mocked normalizePersistedSettings returns its input unchanged — this asserts wiring, not the sanitizer's own stripping (covered in normalizePersistedSettings.test.ts).
      payload: { ...baseContextValue.settings, ...importedPartial },
    });
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
    const user = userEvent.setup();
    await user.click(screen.getByText('settings.data.libraryExport.button'));
    await user.type(
      screen.getByLabelText('settings.data.libraryExport.passphraseLabel'),
      'correct horse battery staple',
    );
    await user.click(screen.getByText('settings.data.libraryExport.confirm'));
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
