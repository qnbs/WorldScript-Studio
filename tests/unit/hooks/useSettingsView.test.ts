import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsView } from '../../../hooks/useSettingsView';
import type { ProjectSnapshot, StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — thunk match fns
// ---------------------------------------------------------------------------
const { mockImportMatch, mockRestoreMatch } = vi.hoisted(() => ({
  mockImportMatch: vi.fn((_: unknown) => true),
  mockRestoreMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSetLanguage = vi.fn();
const mockListSnapshots = vi.fn().mockResolvedValue([]);
const mockSaveSnapshot = vi.fn().mockResolvedValue(undefined);
const mockDeleteSnapshot = vi.fn().mockResolvedValue(undefined);
const mockLoggerWarn = vi.fn();
const mockToastInfo = vi.fn();

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
    t: (key: string) => key,
    language: 'en',
    setLanguage: mockSetLanguage,
  }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => [],
  selectAllWorlds: () => [],
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
    setBackup: (v: unknown) => ({ type: 'settings/setBackup', payload: v }),
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
  useToast: () => ({
    info: mockToastInfo,
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../services/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    listSnapshots: () => mockListSnapshots(),
    saveSnapshot: (name: string, project: unknown) => mockSaveSnapshot(name, project),
    deleteSnapshot: (id: number) => mockDeleteSnapshot(id),
  },
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

  it('dispatches setBackup', () => {
    const { result } = renderHook(() => useSettingsView());
    act(() => result.current.handleSettingChange('backup', { autoBackupEnabled: true }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setBackup' }),
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
