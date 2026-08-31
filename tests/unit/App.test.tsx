import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseApp, mockProjectBootstrapEffect, mockDispatch, mockStore, selectorState, project } =
  vi.hoisted(() => ({
    mockUseApp: vi.fn(),
    mockProjectBootstrapEffect: vi.fn(),
    mockDispatch: vi.fn(),
    mockStore: {
      getState: vi.fn(() => ({})),
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

import App from '../../App';

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
