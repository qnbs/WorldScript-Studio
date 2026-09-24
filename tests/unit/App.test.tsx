import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseApp,
  mockProjectBootstrapEffect,
  mockDispatch,
  mockStore,
  mockFlushPersistedState,
  selectorState,
  project,
} = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockProjectBootstrapEffect: vi.fn(),
  mockDispatch: vi.fn(),
  mockFlushPersistedState: vi.fn().mockResolvedValue(undefined),
  mockStore: {
    getState: vi.fn(() => ({})),
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
  selectorState: {
    settings: {
      theme: 'light',
      appearancePreset: 'default',
      writingSurfaceStyle: 'default',
      keyboardShortcuts: [],
      privacy: { analyticsEnabled: false },
      aiMode: 'hybrid',
      openRouter: { enabled: false },
      advancedEditor: {
        distractionFree: false,
        typewriterMode: false,
        zenMode: false,
        focusMode: false,
      },
      accessibility: {
        highContrast: false,
        reducedMotion: false,
        reducedTransparency: false,
        largeText: false,
        screenReader: false,
        focusIndicators: false,
        comfortableTargets: false,
        colorBlindMode: 'none',
      },
      desktop: { minimizeToTray: false },
    },
  },
  project: { id: 'test-project', title: 'Test project' },
}));

vi.mock('react-redux', () => ({
  Provider: ({ children }: { children: ReactNode }) => children,
  useStore: () => mockStore,
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: vi.fn((selector: (state: unknown) => unknown) => selector(selectorState)),
}));

vi.mock('../../app/persistedStateFlush', () => ({
  flushPersistedState: (...args: unknown[]) => mockFlushPersistedState(...args),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectProjectData: () => project,
  selectAllCharacters: () => [],
  selectAllWorlds: () => [],
}));

vi.mock('../../features/featureFlags/featureFlagsSlice', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../features/featureFlags/featureFlagsSlice')>();
  return {
    ...actual,
    selectFeatureFlags: () => ({
      ...actual.defaultFeatureFlagsState,
      enableRtlLayout: false,
      enablePluginSystem: false,
      enableDuckDbAnalytics: false,
      enableWorkerBusV2: false,
      enableLocalFirstSync: false,
      enableIdbAtRestEncryption: false,
      enableObjectsGroups: false,
      enableMindMaps: false,
      enableCharacterInterviews: false,
      enableLoraAdapters: false,
      enableGlobalCopilot: false,
      enableVoiceSupport: false,
    }),
  };
});

vi.mock('../../hooks/useApp', () => ({ useApp: mockUseApp }));
vi.mock('../../hooks/useProjectBootstrapEffect', () => ({
  useProjectBootstrapEffect: mockProjectBootstrapEffect,
}));
vi.mock('../../hooks/useGlobalKeyboardShortcuts', () => ({
  useGlobalKeyboardShortcuts: vi.fn(),
}));
vi.mock('../../hooks/useIdbUnlockStartupGuard', () => ({
  useIdbUnlockStartupGuard: vi.fn(),
}));
vi.mock('../../hooks/useNativeNotifications', () => ({ useNativeNotifications: vi.fn() }));
vi.mock('../../hooks/usePushToTalk', () => ({ usePushToTalk: vi.fn() }));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
    isReady: true,
  }),
}));

vi.mock('../../contexts/I18nContext', () => ({
  I18nProvider: ({ children }: { children: ReactNode }) => children,
  RTL_LOCALES: new Set<string>(),
}));
vi.mock('../../contexts/LiveRegionContext', () => ({
  LiveRegionProvider: ({ children }: { children: ReactNode }) => children,
  useAnnounce: () => vi.fn(),
}));

vi.mock('../../app/listenerMiddleware', () => ({
  initAdaptiveAiOnStartup: vi.fn(),
  initLocalFirstSyncOnStartup: vi.fn(),
  initWorkerBusOnStartup: vi.fn(),
}));
vi.mock('../../services/storage/encryptionMigrationJournal', () => ({
  readEncryptionMigrationJournal: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../services/storage/storageEncryptionService', () => ({
  isIdbEncryptionReady: vi.fn(() => false),
}));
vi.mock('../../services/desktop/desktopMenu', () => ({
  installDesktopMenu: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../services/desktop/desktopTray', () => ({
  installCloseToTray: vi.fn().mockResolvedValue(undefined),
  installDesktopTray: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tauriDeepLink', () => ({
  initTauriDeepLink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tauriRuntime', () => ({
  applyDesktopRuntimeFlags: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
}));
vi.mock('../../services/desktopPlatform', () => ({
  desktopPlatform: {
    runtime: { isDesktop: false },
    lifecycle: { quit: vi.fn().mockResolvedValue(undefined) },
  },
}));

vi.mock('../../services/i18n/staticTranslate', () => ({
  getCurrentLanguage: () => 'en',
  getStaticTranslation: (key: string) => Promise.resolve(key),
}));

import App from '../../App';
import { statusActions } from '../../features/status/statusSlice';
import { installCloseToTray, installDesktopTray } from '../../services/desktop/desktopTray';
import { desktopPlatform } from '../../services/desktopPlatform';
import { ProjectFileLockedError, StaleProjectWriterError } from '../../services/fs/fsCore';

beforeEach(() => {
  vi.clearAllMocks();
  mockUseApp.mockReturnValue({
    currentView: 'dashboard',
    previousView: 'dashboard',
    handleNavigate: vi.fn(),
    handlePortalExit: vi.fn(),
    isPortalActive: false,
    isInitialLoad: true,
    allowInitialMetadataSeed: true,
    isSidebarOpen: false,
    setIsSidebarOpen: vi.fn(),
  });
});

describe('App seed-authority wiring', () => {
  // QNBS-v3: protects the boot authority boundary so synthetic-project seeding cannot drift from the hydrated runtime decision.
  it('forwards boot authority into useApp and runtime authority into project bootstrap', () => {
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);

    expect(mockUseApp).toHaveBeenCalledWith({
      isNewUser: false,
      allowInitialMetadataSeed: false,
    });
    expect(mockProjectBootstrapEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        project,
        allowInitialMetadataSeed: true,
      }),
    );
  });
});

// QNBS-v3 (Visual Maturity #A): locks the body-class toggle that scopes Aurora/noise to isPortalActive instead of every whole-app view. No manual afterEach needed — the hook's own unmount cleanup (see useAppearanceBodyClasses.test.ts) plus RTL's automatic between-test unmount keep this isolated.
describe('portal-active body class (Aurora/noise scope)', () => {
  // QNBS-v3: one render per test — a second synchronous render inside one test hits an unrelated AnalyticsBootstrap/duckdb singleton issue; RTL's between-test cleanup keeps separate tests safe.
  it('adds portal-active while the welcome portal is showing', () => {
    mockUseApp.mockReturnValue({
      currentView: 'dashboard',
      previousView: 'dashboard',
      handleNavigate: vi.fn(),
      handlePortalExit: vi.fn(),
      isPortalActive: true,
      isInitialLoad: true,
      allowInitialMetadataSeed: true,
      isSidebarOpen: false,
      setIsSidebarOpen: vi.fn(),
    });
    render(<App isNewUser={true} allowInitialMetadataSeed={true} />);
    expect(document.body.classList.contains('portal-active')).toBe(true);
  });

  it('never sets portal-active for an ordinary (non-portal) boot', () => {
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    expect(document.body.classList.contains('portal-active')).toBe(false);
  });
});

// QNBS-v3 (#553): a fresh review's finding — quitting or closing a window whose flush is refused by another window's held project-file lock aborted with only a console warn, no visible explanation, and no way for the user to know the lock's own owner must close first. Proves both paths (native/tray Quit and the close-to-tray window-close handler) now surface a distinct notification for exactly this cause while still aborting (fail closed) exactly as before for any other flush failure — never silently discarding an unsaved change to let the window close anyway.
describe('quit/close blocked by a held project-file lock (#553)', () => {
  it('shows a distinct notification and still aborts quitting when the flush is refused by a held lock', async () => {
    mockFlushPersistedState.mockRejectedValueOnce(
      new ProjectFileLockedError('/app/projects/p1/project.json'),
    );
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const quitApp = vi.mocked(installDesktopTray).mock.calls[0]?.[2] as () => Promise<void>;

    await quitApp();

    expect(desktopPlatform.lifecycle.quit).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: statusActions.addNotification.type,
        payload: expect.objectContaining({ type: 'error', title: 'Cannot Close Yet' }),
      }),
    );
  });

  it('shows the same notification and keeps the window open when the close-to-tray flush is refused by a held lock', async () => {
    mockFlushPersistedState.mockRejectedValueOnce(
      new ProjectFileLockedError('/app/projects/p1/project.json'),
    );
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const flushPendingState = vi.mocked(installCloseToTray).mock
      .calls[0]?.[1] as () => Promise<void>;

    // QNBS-v3: rethrown unchanged so installCloseToTray's own catch still keeps the window open.
    await expect(flushPendingState()).rejects.toBeInstanceOf(ProjectFileLockedError);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: statusActions.addNotification.type,
        payload: expect.objectContaining({ type: 'error', title: 'Cannot Close Yet' }),
      }),
    );
  });

  it('does not show the lock notification for an unrelated flush failure, and still aborts quitting', async () => {
    mockFlushPersistedState.mockRejectedValueOnce(new Error('disk full'));
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const quitApp = vi.mocked(installDesktopTray).mock.calls[0]?.[2] as () => Promise<void>;

    await quitApp();

    expect(desktopPlatform.lifecycle.quit).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'Cannot Close Yet' }),
      }),
    );
  });
});

// QNBS-v3 (#553): a stale-writer refusal never clears by waiting, so quit/close must not trap the window forever — they proceed only on the user's explicit, localized choice to discard this window's unsaved changes, and otherwise stay fail-closed exactly as before.
describe('quit/close refused by a stale independently-loaded writer (#553)', () => {
  const stale = () => new StaleProjectWriterError('p1');

  it('quits only after the user explicitly confirms discarding this window’s changes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFlushPersistedState.mockRejectedValueOnce(stale());
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const quitApp = vi.mocked(installDesktopTray).mock.calls[0]?.[2] as () => Promise<void>;

    await quitApp();

    expect(confirmSpy).toHaveBeenCalledWith('desktop.staleWriter.quitConfirm');
    expect(desktopPlatform.lifecycle.quit).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('stays open when the user declines, on both the quit and the close-to-tray path', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockFlushPersistedState.mockRejectedValueOnce(stale()).mockRejectedValueOnce(stale());
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const quitApp = vi.mocked(installDesktopTray).mock.calls[0]?.[2] as () => Promise<void>;
    const flushPendingState = vi.mocked(installCloseToTray).mock
      .calls[0]?.[1] as () => Promise<void>;

    await quitApp();
    await expect(flushPendingState()).rejects.toBeInstanceOf(StaleProjectWriterError);

    expect(desktopPlatform.lifecycle.quit).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('lets the window close via close-to-tray once the user confirms', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFlushPersistedState.mockRejectedValueOnce(stale());
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const flushPendingState = vi.mocked(installCloseToTray).mock
      .calls[0]?.[1] as () => Promise<void>;

    await expect(flushPendingState()).resolves.toBeUndefined();
    confirmSpy.mockRestore();
  });

  it('never offers the discard prompt for an ordinary flush failure', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFlushPersistedState.mockRejectedValueOnce(new Error('disk full'));
    render(<App isNewUser={false} allowInitialMetadataSeed={false} />);
    const quitApp = vi.mocked(installDesktopTray).mock.calls[0]?.[2] as () => Promise<void>;

    await quitApp();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(desktopPlatform.lifecycle.quit).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
