import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransientUiStore } from '../../../app/transientUiStore';
import { useSettingsView } from '../../../hooks/useSettingsView';
import type { ProjectSnapshot, StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — thunk match fns
// ---------------------------------------------------------------------------
const { mockImportMatch, mockRestoreMatch, stableT, stableToast, stableEmptyArray } = vi.hoisted(
  () => ({
    mockImportMatch: vi.fn((_: unknown) => true),
    mockRestoreMatch: vi.fn((_: unknown) => true),
    // QNBS-v3 (#332/D5): the real I18nContext memoizes `t` — a fresh arrow function here would defeat the useSettingsView useMemo identity test below.
    stableT: (key: string) => key,
    stableToast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
    // QNBS-v3 (#332/D5): real EntityAdapter selectAll() selectors return the same array reference when entities are unchanged — a fresh `[]` here would defeat the identity test for an unrelated reason.
    stableEmptyArray: [] as unknown[],
  }),
);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSetLanguage = vi.fn();
const mockListSnapshots = vi.fn().mockResolvedValue([]);
const mockSaveSnapshot = vi.fn().mockResolvedValue(undefined);
const mockDeleteSnapshot = vi.fn().mockResolvedValue(undefined);
const mockLoggerWarn = vi.fn();
// QNBS-v3 (#332/D5): aliased to stableToast's own methods (not fresh vi.fn()s) so the encryption tests below assert against the same stable mock useToast() actually returns.
const mockToastInfo = stableToast.info;
const mockToastSuccess = stableToast.success;
const mockClearIdbEncryptionKey = vi.fn();
const mockIsIdbEncryptionReady = vi.fn(() => false);
const mockSetupIdbEncryption = vi.fn().mockResolvedValue(undefined);
const mockVerifyAndInitIdbEncryption = vi.fn().mockResolvedValue(undefined);
const mockClearIdbPassphrase = vi.fn().mockResolvedValue(undefined);
const mockRotateIdbPassphrase = vi.fn().mockResolvedValue(undefined);
const mockDeriveRotationTargetKey = vi.fn().mockResolvedValue('mock-target-key');
const mockResolveProtectedWriteKey = vi.fn().mockResolvedValue('mock-active-key');
const mockDeriveAndVerifySourceKeyFromSentinel = vi.fn().mockResolvedValue('mock-source-key');
const mockMigrateAllProtectedFsData = vi.fn().mockResolvedValue(undefined);
const mockIsTauriRuntime = vi.fn(() => false);

const mockSettings = {
  theme: 'dark' as const,
  geminiApiKey: '',
  fontSize: 16,
  lineSpacing: 1.5,
  aiCreativity: 'balanced' as const,
};

let mockProject = {
  id: 'p1',
  title: 'My Novel',
  logline: 'Hero saves world',
  author: undefined as string | undefined,
  manuscript: [] as StorySection[],
};

const mockFeatureFlags = {
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableAppHealthPanel: false,
};

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      settings: mockSettings,
      featureFlags: mockFeatureFlags,
      project: { present: { data: mockProject } },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: stableT,
    language: 'en',
    setLanguage: mockSetLanguage,
  }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => stableEmptyArray,
  selectAllWorlds: () => stableEmptyArray,
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    resetProject: (payload: unknown) => ({ type: 'project/resetProject', payload }),
  },
}));

vi.mock('../../../features/project/thunks/projectManagementThunks', () => {
  const importThunk = vi.fn(() => ({ type: 'mock-import' }));
  (importThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockImportMatch(a),
  };

  const restoreThunk = vi.fn(() => ({ type: 'mock-restore' }));
  (restoreThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockRestoreMatch(a),
  };

  return { importProjectThunk: importThunk, restoreSnapshotThunk: restoreThunk };
});

vi.mock('../../../features/settings/settingsSlice', () => ({
  settingsActions: {
    setTheme: (v: unknown) => ({ type: 'settings/setTheme', payload: v }),
    setAppearancePreset: (v: unknown) => ({ type: 'settings/setAppearancePreset', payload: v }),
    setEditorFont: (v: unknown) => ({ type: 'settings/setEditorFont', payload: v }),
    setFontSize: (v: unknown) => ({ type: 'settings/setFontSize', payload: v }),
    setLineSpacing: (v: unknown) => ({ type: 'settings/setLineSpacing', payload: v }),
    setAiCreativity: (v: unknown) => ({ type: 'settings/setAiCreativity', payload: v }),
    setParagraphSpacing: (v: unknown) => ({ type: 'settings/setParagraphSpacing', payload: v }),
    setIndentFirstLine: (v: unknown) => ({ type: 'settings/setIndentFirstLine', payload: v }),
    setCustomFont: (v: unknown) => ({ type: 'settings/setCustomFont', payload: v }),
    setKeyboardShortcuts: (v: unknown) => ({ type: 'settings/setKeyboardShortcuts', payload: v }),
    setWritingGoals: (v: unknown) => ({ type: 'settings/setWritingGoals', payload: v }),
    setAdvancedAi: (v: unknown) => ({ type: 'settings/setAdvancedAi', payload: v }),
    setAccessibility: (v: unknown) => ({ type: 'settings/setAccessibility', payload: v }),
    setPrivacy: (v: unknown) => ({ type: 'settings/setPrivacy', payload: v }),
    setCollaboration: (v: unknown) => ({ type: 'settings/setCollaboration', payload: v }),
    setIntegrations: (v: unknown) => ({ type: 'settings/setIntegrations', payload: v }),
    setAdvancedEditor: (v: unknown) => ({ type: 'settings/setAdvancedEditor', payload: v }),
    setThemeCustomization: (v: unknown) => ({ type: 'settings/setThemeCustomization', payload: v }),
  },
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  featureFlagsActions: {
    setEnableStoryBibleAdvanced: (v: unknown) => ({
      type: 'featureFlags/setEnableStoryBibleAdvanced',
      payload: v,
    }),
    setEnableBinderResearch: (v: unknown) => ({
      type: 'featureFlags/setEnableBinderResearch',
      payload: v,
    }),
    setEnableCompileWizard: (v: unknown) => ({
      type: 'featureFlags/setEnableCompileWizard',
      payload: v,
    }),
    setEnableProjectHealthScore: (v: unknown) => ({
      type: 'featureFlags/setEnableProjectHealthScore',
      payload: v,
    }),
    setEnableAppHealthPanel: (v: unknown) => ({
      type: 'featureFlags/setEnableAppHealthPanel',
      payload: v,
    }),
    setEnableProForge: (v: unknown) => ({
      type: 'featureFlags/setEnableProForge',
      payload: v,
    }),
    setEnableVoiceWasm: (v: unknown) => ({
      type: 'featureFlags/setEnableVoiceWasm',
      payload: v,
    }),
    setEnableIdbAtRestEncryption: (v: unknown) => ({
      type: 'featureFlags/setEnableIdbAtRestEncryption',
      payload: v,
    }),
    setEnableGlobalCopilot: (v: unknown) => ({
      type: 'featureFlags/setEnableGlobalCopilot',
      payload: v,
    }),
    setEnableBrowserOllama: (v: unknown) => ({
      type: 'featureFlags/setEnableBrowserOllama',
      payload: v,
    }),
  },
}));

vi.mock('../../../features/copilot/copilotSlice', () => ({
  copilotActions: {
    setOpen: (v: unknown) => ({ type: 'copilot/setOpen', payload: v }),
    clear: () => ({ type: 'copilot/clear' }),
  },
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: (payload: unknown) => ({ type: 'status/addNotification', payload }),
  },
}));

vi.mock('../../../components/ui/Toast', () => ({
  // QNBS-v3 (#332/D5): a stable reference here isolates the identity test below to useSettingsView's own dependency wiring — production useToast() is now separately memoized and covered by tests/unit/Toast.test.tsx's own reference-stability test.
  useToast: () => stableToast,
}));

vi.mock('../../../services/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  clearIdbEncryptionKey: () => mockClearIdbEncryptionKey(),
  isIdbEncryptionReady: () => mockIsIdbEncryptionReady(),
  setupIdbEncryption: (passphrase: string) => mockSetupIdbEncryption(passphrase),
  verifyAndInitIdbEncryption: (passphrase: string) => mockVerifyAndInitIdbEncryption(passphrase),
  clearIdbPassphrase: (onProgress?: unknown) => mockClearIdbPassphrase(onProgress),
  rotateIdbPassphrase: (oldPass: string, newPass: string, onProgress?: unknown) =>
    mockRotateIdbPassphrase(oldPass, newPass, onProgress),
  deriveRotationTargetKey: (newPassphrase: string) => mockDeriveRotationTargetKey(newPassphrase),
  resolveProtectedWriteKey: () => mockResolveProtectedWriteKey(),
  deriveAndVerifySourceKeyFromSentinel: (passphrase: string) =>
    mockDeriveAndVerifySourceKeyFromSentinel(passphrase),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    listSnapshots: () => mockListSnapshots(),
    saveSnapshot: (name: string, project: unknown) => mockSaveSnapshot(name, project),
    deleteSnapshot: (id: number) => mockDeleteSnapshot(id),
  },
}));

// QNBS-v3: services/fs/fsEncryptionMigration.ts transitively imports the real Tauri fs store chain (down to idbCodexStore.ts) — mocked here so this hook test stays isolated and doesn't need the full @tauri-apps/* + IDB mock surface fsStores.test.ts sets up.
vi.mock('../../../services/fs/fsEncryptionMigration', () => ({
  migrateAllProtectedFsData: (targetKey: unknown, operation: unknown) =>
    mockMigrateAllProtectedFsData(targetKey, operation),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));

// Stub URL.createObjectURL / URL.revokeObjectURL
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(id: number, name: string): ProjectSnapshot {
  return { id, name, date: '2026-01-01', wordCount: 100 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockListSnapshots.mockResolvedValue([]);
  mockImportMatch.mockReturnValue(true);
  mockRestoreMatch.mockReturnValue(true);
  mockProject = {
    id: 'p1',
    title: 'My Novel',
    logline: 'Hero saves world',
    author: undefined,
    manuscript: [],
  };
});

// ---------------------------------------------------------------------------
// useEffect: refreshSnapshots when activeCategory === 'data'
// (hook initializes with 'general'; snapshots load on switch to 'data')
// ---------------------------------------------------------------------------
describe('initial snapshot load', () => {
  it('calls listSnapshots when data category is activated', async () => {
    mockListSnapshots.mockResolvedValue([makeSnapshot(1, 'Draft 1')]);
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setActiveCategory('data');
    });
    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// handleLanguageChange
// ---------------------------------------------------------------------------
describe('handleLanguageChange', () => {
  it('calls setLanguage with the selected value', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.handleLanguageChange('de');
    });
    expect(mockSetLanguage).toHaveBeenCalledWith('de');
  });
});

// ---------------------------------------------------------------------------
// handleSettingChange — basic settings
// ---------------------------------------------------------------------------
describe('handleSettingChange', () => {
  it('dispatches setTheme', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('theme', 'light'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setTheme', payload: 'light' }),
    );
  });

  it('dispatches setFontSize', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('fontSize', '18'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setFontSize', payload: 18 }),
    );
  });

  it('dispatches setAiCreativity', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('aiCreativity', 'focused'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setAiCreativity', payload: 'focused' }),
    );
  });

  it('dispatches setAdvancedAi', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('advancedAi', { maxTokens: 2048 }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setAdvancedAi' }),
    );
  });

  // QNBS-v3: enableCrossProjectSearch promoted to permanent core — no dispatch case exists.

  it('dispatches setEnableProForge when enableProForge flag toggled on', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableProForge', true));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'featureFlags/setEnableProForge', payload: true }),
    );
  });

  it('calls toast.info when enableProForge toggled on', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableProForge', true));
    expect(mockToastInfo).toHaveBeenCalledWith('proforge.enabledHint');
  });

  it('does not call toast.info when enableProForge toggled off', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableProForge', false));
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  // QNBS-v3 (CodeAnt #8): disabling the Copilot flag must also end the active session so a
  // re-enable later doesn't restore a stale (possibly streaming) panel.
  it('dispatches setEnableGlobalCopilot when toggled on, without clearing the session', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableGlobalCopilot', true));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'featureFlags/setEnableGlobalCopilot', payload: true }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/clear' }),
    );
  });

  it('closes and clears the Copilot when enableGlobalCopilot toggled off', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableGlobalCopilot', false));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'featureFlags/setEnableGlobalCopilot', payload: false }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'copilot/setOpen', payload: false }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'copilot/clear' }));
  });

  // QNBS-v3 (ADR-0017): opt-in direct browser→Ollama connection — a plain dispatch case, same
  // pattern as enableLocalFirstSync above it in the switch.
  it('dispatches setEnableBrowserOllama when toggled', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('enableBrowserOllama', true));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'featureFlags/setEnableBrowserOllama', payload: true }),
    );
  });

  it('logs warning for unknown key', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('unknownKey', 'value'));
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('unknownKey'));
  });

  it('dispatches setAccessibility', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('accessibility', { reduceMotion: true }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setAccessibility' }),
    );
  });

  it('dispatches setCollaboration', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('collaboration', { webrtcSignalingUrls: [] }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setCollaboration' }),
    );
  });
});

// ---------------------------------------------------------------------------
// projectSize / currentWordCount
// ---------------------------------------------------------------------------
describe('projectSize', () => {
  it('returns a string with KB unit', () => {
    const { result } = renderHook(() => useSettingsView());
    expect(result.current.projectSize).toMatch(/KB/);
  });
});

describe('currentWordCount', () => {
  it('counts words across all sections', async () => {
    mockProject.manuscript = [
      { id: 's1', title: 'Ch1', content: 'hello world foo' },
      { id: 's2', title: 'Ch2', content: 'bar baz' },
    ];
    const { result } = renderHook(() => useSettingsView());
    await waitFor(() => {
      expect(result.current.currentWordCount).toBe(5);
    });
  });

  it('returns 0 for empty manuscript', () => {
    const { result } = renderHook(() => useSettingsView());
    expect(result.current.currentWordCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleExport
// ---------------------------------------------------------------------------
describe('handleExport', () => {
  it('creates a JSON blob URL for download', () => {
    const mockCreateObjectURL = vi.mocked(URL.createObjectURL);
    mockCreateObjectURL.mockClear();

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.handleExport();
    });
    // QNBS-v3: verify blob URL created for JSON download link
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleImport
// ---------------------------------------------------------------------------
describe('handleImport', () => {
  it('dispatches importProjectThunk and shows success notification on fulfilled', async () => {
    mockDispatch.mockResolvedValue({ type: 'fulfilled' });
    mockImportMatch.mockReturnValue(true);
    const fakeFile = new File(['{}'], 'project.json', { type: 'application/json' });
    const fakeEvent = {
      target: { files: [fakeFile], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    const { result } = renderHook(() => useSettingsView());
    await act(async () => {
      await result.current.handleImport(fakeEvent);
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
  });

  it('shows error notification on rejected', async () => {
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockImportMatch.mockReturnValue(false);
    const fakeFile = new File(['invalid'], 'project.json', { type: 'application/json' });
    const fakeEvent = {
      target: { files: [fakeFile], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    const { result } = renderHook(() => useSettingsView());
    await act(async () => {
      await result.current.handleImport(fakeEvent);
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
  });

  it('does nothing when no file is selected', async () => {
    const fakeEvent = {
      target: { files: [], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    const { result } = renderHook(() => useSettingsView());
    await act(async () => {
      await result.current.handleImport(fakeEvent);
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleResetProject
// ---------------------------------------------------------------------------
describe('handleResetProject', () => {
  it('dispatches resetProject and closes modal', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setModal({ state: 'reset', payload: {} });
      result.current.handleResetProject();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/resetProject' }),
    );
    expect(result.current.modal.state).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// handleCreateSnapshot
// ---------------------------------------------------------------------------
describe('handleCreateSnapshot', () => {
  it('saves snapshot and refreshes list', async () => {
    mockListSnapshots.mockResolvedValue([makeSnapshot(99, 'New Snap')]);
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setSnapshotName('First Draft');
    });
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    expect(mockSaveSnapshot).toHaveBeenCalledWith('First Draft', mockProject);
    expect(result.current.snapshotName).toBe('');
    expect(result.current.modal.state).toBe('closed');
    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// handleRestoreSnapshot
// ---------------------------------------------------------------------------
describe('handleRestoreSnapshot', () => {
  it('dispatches restoreSnapshotThunk with snapshot id', async () => {
    mockDispatch.mockResolvedValue({ type: 'fulfilled' });

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setModal({ state: 'restore', payload: { id: 42 } });
    });
    await act(async () => {
      await result.current.handleRestoreSnapshot();
    });
    expect(mockDispatch).toHaveBeenCalled();
    expect(result.current.modal.state).toBe('closed');
  });

  it('does nothing when modal payload has no id', async () => {
    const { result } = renderHook(() => useSettingsView());
    await act(async () => {
      await result.current.handleRestoreSnapshot();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleDeleteSnapshot
// ---------------------------------------------------------------------------
describe('handleDeleteSnapshot', () => {
  it('deletes snapshot and refreshes list', async () => {
    mockListSnapshots.mockResolvedValue([]);
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setModal({ state: 'delete', payload: { id: 5 } });
    });
    await act(async () => {
      await result.current.handleDeleteSnapshot();
    });
    expect(mockDeleteSnapshot).toHaveBeenCalledWith(5);
    expect(result.current.modal.state).toBe('closed');
  });

  it('does nothing when modal payload has no id', async () => {
    const { result } = renderHook(() => useSettingsView());
    await act(async () => {
      await result.current.handleDeleteSnapshot();
    });
    expect(mockDeleteSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// activeCategory switching triggers snapshot refresh
// ---------------------------------------------------------------------------
describe('activeCategory', () => {
  it('refreshes snapshots each time data category is entered', async () => {
    mockListSnapshots.mockResolvedValue([makeSnapshot(1, 'Draft')]);
    const { result } = renderHook(() => useSettingsView());
    // First switch to 'data' — triggers call 1
    act(() => {
      result.current.setActiveCategory('data');
    });
    // Switch away — no snapshot call
    act(() => {
      result.current.setActiveCategory('appearance');
    });
    // Switch back to 'data' — triggers call 2
    act(() => {
      result.current.setActiveCategory('data');
    });
    await waitFor(() => {
      expect(mockListSnapshots).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// handlePassphraseConfirm — disable/rotate branches (Phase 4, #338)
// ---------------------------------------------------------------------------
describe('handlePassphraseConfirm — disable/rotate', () => {
  afterEach(() => {
    mockClearIdbPassphrase.mockResolvedValue(undefined);
    mockRotateIdbPassphrase.mockResolvedValue(undefined);
    mockMigrateAllProtectedFsData.mockClear().mockResolvedValue(undefined);
    mockDeriveRotationTargetKey.mockClear().mockResolvedValue('mock-target-key');
    mockResolveProtectedWriteKey.mockClear().mockResolvedValue('mock-active-key');
    mockDeriveAndVerifySourceKeyFromSentinel.mockClear().mockResolvedValue('mock-source-key');
    mockIsTauriRuntime.mockReturnValue(false);
  });

  it('calls clearIdbPassphrase with a progress callback, updates the flag, and toasts on success', async () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', '');
    });

    expect(mockClearIdbPassphrase).toHaveBeenCalledWith(expect.any(Function));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'featureFlags/setEnableIdbAtRestEncryption',
        payload: false,
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('settings.privacy.encryptionDisabledStatus');
    expect(result.current.passphraseModal).toBe('closed');
  });

  it('calls rotateIdbPassphrase with both passphrases and a progress callback, then toasts on success', async () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('rotate');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('old-pass', 'new-pass');
    });

    expect(mockRotateIdbPassphrase).toHaveBeenCalledWith(
      'old-pass',
      'new-pass',
      expect.any(Function),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('settings.privacy.encryptionChangedStatus');
    expect(result.current.passphraseModal).toBe('closed');
  });

  it('does not call clearIdbPassphrase or rotateIdbPassphrase for set/unlock modes', async () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('set');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', 'newpass123');
    });

    expect(mockClearIdbPassphrase).not.toHaveBeenCalled();
    expect(mockRotateIdbPassphrase).not.toHaveBeenCalled();
    expect(mockSetupIdbEncryption).toHaveBeenCalledWith('newpass123');
    expect(mockMigrateAllProtectedFsData).not.toHaveBeenCalled();
  });

  it('encrypts existing fs-backed desktop data with the newly-active key on first-time setup, in the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockResolveProtectedWriteKey.mockResolvedValue('newly-active-key');
    const callOrder: string[] = [];
    mockSetupIdbEncryption.mockImplementation(async () => {
      callOrder.push('setupIdbEncryption');
    });
    mockMigrateAllProtectedFsData.mockImplementation(async () => {
      callOrder.push('migrateAllProtectedFsData');
    });

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('set');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', 'newpass123');
    });

    expect(mockMigrateAllProtectedFsData).toHaveBeenCalledWith('newly-active-key', 'set');
    expect(callOrder).toEqual(['setupIdbEncryption', 'migrateAllProtectedFsData']);
  });

  it('does not encrypt fs-backed desktop data on first-time setup outside the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(false);
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('set');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', 'newpass123');
    });

    expect(mockMigrateAllProtectedFsData).not.toHaveBeenCalled();
    expect(mockResolveProtectedWriteKey).not.toHaveBeenCalled();
  });

  it('surfaces migrationProgress updates from the onProgress callback while disable is pending, then clears it', async () => {
    let capturedCallback: ((progress: unknown) => void) | undefined;
    let resolveClear: (() => void) | undefined;
    mockClearIdbPassphrase.mockImplementation((onProgress: (progress: unknown) => void) => {
      capturedCallback = onProgress;
      return new Promise<void>((resolve) => {
        resolveClear = resolve;
      });
    });

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });

    let confirmPromise: Promise<void> | undefined;
    act(() => {
      confirmPromise = result.current.handlePassphraseConfirm('', '');
    });
    await waitFor(() => expect(capturedCallback).toBeDefined());

    act(() => {
      capturedCallback?.({ storeId: 's', storeIndex: 1, storeCount: 2, phase: 'migrating' });
    });
    expect(result.current.migrationProgress).toEqual(
      expect.objectContaining({ storeIndex: 1, storeCount: 2 }),
    );

    await act(async () => {
      resolveClear?.();
      await confirmPromise;
    });
    expect(result.current.migrationProgress).toBeNull();
  });

  it('clears migrationProgress and leaves the modal open when clearIdbPassphrase rejects', async () => {
    mockClearIdbPassphrase.mockRejectedValueOnce(new Error('migration failed'));
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });

    await act(async () => {
      await expect(result.current.handlePassphraseConfirm('', '')).rejects.toThrow();
    });

    expect(result.current.passphraseModal).toBe('disable');
    expect(result.current.migrationProgress).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'featureFlags/setEnableIdbAtRestEncryption' }),
    );
  });

  it('clears migrationProgress and leaves the modal open when rotateIdbPassphrase rejects', async () => {
    mockRotateIdbPassphrase.mockRejectedValueOnce(new Error('migration failed'));
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('rotate');
    });

    await act(async () => {
      await expect(
        result.current.handlePassphraseConfirm('old-pass', 'new-pass'),
      ).rejects.toThrow();
    });

    expect(result.current.passphraseModal).toBe('rotate');
    expect(result.current.migrationProgress).toBeNull();
    expect(mockToastSuccess).not.toHaveBeenCalledWith('settings.privacy.encryptionChangedStatus');
  });

  it('does not touch fs-backed desktop data outside the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(false);
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', '');
    });

    expect(mockMigrateAllProtectedFsData).not.toHaveBeenCalled();
    expect(mockDeriveRotationTargetKey).not.toHaveBeenCalled();
  });

  it('migrates fs-backed desktop data to plaintext BEFORE clearIdbPassphrase runs, in the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    const callOrder: string[] = [];
    mockMigrateAllProtectedFsData.mockImplementation(async () => {
      callOrder.push('migrateAllProtectedFsData');
    });
    mockClearIdbPassphrase.mockImplementation(async () => {
      callOrder.push('clearIdbPassphrase');
    });

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('', '');
    });

    expect(mockMigrateAllProtectedFsData).toHaveBeenCalledWith(null, 'disable');
    expect(mockDeriveRotationTargetKey).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['migrateAllProtectedFsData', 'clearIdbPassphrase']);
  });

  it('derives the rotation target key and re-keys fs-backed desktop data BEFORE rotateIdbPassphrase runs, in the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockDeriveRotationTargetKey.mockResolvedValue('derived-target-key');
    const callOrder: string[] = [];
    mockMigrateAllProtectedFsData.mockImplementation(async () => {
      callOrder.push('migrateAllProtectedFsData');
    });
    mockRotateIdbPassphrase.mockImplementation(async () => {
      callOrder.push('rotateIdbPassphrase');
    });

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('rotate');
    });
    await act(async () => {
      await result.current.handlePassphraseConfirm('old-pass', 'new-pass');
    });

    expect(mockDeriveAndVerifySourceKeyFromSentinel).toHaveBeenCalledWith('old-pass');
    expect(mockDeriveRotationTargetKey).toHaveBeenCalledWith('new-pass');
    expect(mockMigrateAllProtectedFsData).toHaveBeenCalledWith('derived-target-key', 'rotate');
    expect(callOrder).toEqual(['migrateAllProtectedFsData', 'rotateIdbPassphrase']);
  });

  // QNBS-v3: a mistyped current passphrase must abort BEFORE any fs file is re-keyed — otherwise the
  // bridge (which uses the still-active old key, independent of _current) would already have rewritten
  // everything under the new key by the time rotateIdbPassphrase() rejects the wrong _current, leaving
  // fs data under a key the active session never actually adopts.
  it('verifies the current passphrase against the sentinel BEFORE re-keying any fs file, in the Tauri runtime', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockDeriveAndVerifySourceKeyFromSentinel.mockRejectedValueOnce(new Error('wrong passphrase'));

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('rotate');
    });
    await act(async () => {
      await expect(result.current.handlePassphraseConfirm('typo-pass', 'new-pass')).rejects.toThrow(
        'wrong passphrase',
      );
    });

    expect(mockDeriveAndVerifySourceKeyFromSentinel).toHaveBeenCalledWith('typo-pass');
    expect(mockDeriveRotationTargetKey).not.toHaveBeenCalled();
    expect(mockMigrateAllProtectedFsData).not.toHaveBeenCalled();
    expect(mockRotateIdbPassphrase).not.toHaveBeenCalled();
    expect(result.current.passphraseModal).toBe('rotate');
  });

  it('aborts before clearIdbPassphrase and leaves the modal open when the fs migration bridge fails', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockMigrateAllProtectedFsData.mockRejectedValueOnce(new Error('fs decrypt failed'));

    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.setPassphraseModal('disable');
    });
    await act(async () => {
      await expect(result.current.handlePassphraseConfirm('', '')).rejects.toThrow(
        'fs decrypt failed',
      );
    });

    expect(mockClearIdbPassphrase).not.toHaveBeenCalled();
    expect(result.current.passphraseModal).toBe('disable');
  });
});

// ---------------------------------------------------------------------------
// handleLockSession — must route back to the unlock modal, not just clear the key
// ---------------------------------------------------------------------------
describe('handleLockSession', () => {
  beforeEach(() => {
    useTransientUiStore.getState().setIdbUnlockOpen(false);
  });

  it('opens the global unlock modal so a subsequent autosave has a route back to unlocking', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => {
      result.current.handleLockSession();
    });
    expect(useTransientUiStore.getState().isIdbUnlockOpen).toBe(true);
    expect(mockToastInfo).toHaveBeenCalledWith('settings.privacy.encryptionLockedStatus');
  });
});

// QNBS-v3 (#332/D5): the returned object's identity must stay stable across a re-render with unchanged inputs, or every Settings-tree consumer re-renders on any unrelated global-state change.
describe('memoized return value', () => {
  it('keeps the same object reference across a re-render with unchanged inputs', () => {
    const { result, rerender } = renderHook(() => useSettingsView());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('returns a new reference (with updated data) once a real dependency changes', () => {
    const { result, rerender } = renderHook(() => useSettingsView());
    const first = result.current;
    mockProject = { ...mockProject, title: 'Renamed Novel' };
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.project.title).toBe('Renamed Novel');
  });
});
