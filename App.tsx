import type { FC } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from './app/hooks';
import { flushPersistedState } from './app/persistedStateFlush';
import type { RootState } from './app/store';
import { useTransientUiStore } from './app/transientUiStore';
import { AnalyticsBootstrap } from './components/AnalyticsBootstrap';
import { CommandPalette } from './components/CommandPalette';

const CollaborationPanel = lazy(() =>
  import('./components/CollaborationPanel').then((m) => ({ default: m.CollaborationPanel })),
);

// QNBS-v3: lazy-load cross-project search panel so it's excluded from the initial bundle
const CrossProjectSearchPanelConnected = lazy(() =>
  import('./components/CrossProjectSearchPanel').then((m) => ({
    default: m.CrossProjectSearchPanelConnected,
  })),
);

// QNBS-v3: Global AI Copilot — lazy so its AI-SDK chat path stays out of the initial bundle.
const CopilotLauncher = lazy(() =>
  import('./components/copilot/CopilotLauncher').then((m) => ({ default: m.CopilotLauncher })),
);

import {
  initAdaptiveAiOnStartup,
  initLocalFirstSyncOnStartup,
  initWorkerBusOnStartup,
} from './app/listenerMiddleware';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EncryptionRecoveryModal } from './components/settings/EncryptionRecoveryModal';
import { IdbUnlockModalGate } from './components/settings/IdbUnlockModalGate';
import { Button } from './components/ui/Button';
import { DuckDbMigrationBanner } from './components/ui/DuckDbMigrationBanner';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Modal } from './components/ui/Modal';
import { OfflineIndicator, PWAInstallBanner, PWAUpdateToast } from './components/ui/PWAComponents';
import { Spinner } from './components/ui/Spinner';
import { ToastProvider } from './components/ui/Toast';
import { ViewErrorBoundary } from './components/ui/ViewErrorBoundary';
import { VersionControlPanel } from './components/VersionControlPanel';
import { VoiceControlPanel } from './components/voice/VoiceControlPanel';
import { VoiceIndicator } from './components/voice/VoiceIndicator';
import { AppContext } from './contexts/AppContext';
import { CommandExecutorProvider } from './contexts/CommandExecutorContext';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
import { I18nProvider, RTL_LOCALES } from './contexts/I18nContext';
import { LiveRegionProvider, useAnnounce } from './contexts/LiveRegionContext';
import { featureFlagsActions, selectFeatureFlags } from './features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from './features/project/projectSelectors';
import { statusActions } from './features/status/statusSlice';
import { useApp } from './hooks/useApp';
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts';
import { useIdbUnlockStartupGuard } from './hooks/useIdbUnlockStartupGuard';
import { useNativeNotifications } from './hooks/useNativeNotifications';
import { useProjectBootstrapEffect } from './hooks/useProjectBootstrapEffect';
import { usePushToTalk } from './hooks/usePushToTalk';
import { useTranslation } from './hooks/useTranslation';
import { runCommandById } from './services/commands/commandBuilder';
import { getEffectiveTheme } from './services/commands/effectiveTheme';
import { approximateManuscriptWordCount } from './services/commands/wordCountApprox';
import { DESKTOP_COMMANDS } from './services/desktop/desktopEvents';
import { installDesktopMenu } from './services/desktop/desktopMenu';
import { installCloseToTray, installDesktopTray } from './services/desktop/desktopTray';
import { desktopPlatform } from './services/desktopPlatform';
import { logger } from './services/logger';
import { pluginRegistry } from './services/pluginRegistry';
import { loadScenarioWorkspaceView } from './services/scenarioWorkspaceLoader';
import { hasCompletedSpotlightTour, startSpotlightTour } from './services/spotlightTour';
import {
  type EncryptionMigrationJournal,
  readEncryptionMigrationJournal,
} from './services/storage/encryptionMigrationJournal';
import { isIdbEncryptionReady } from './services/storage/storageEncryptionService';
import { initTauriDeepLink } from './services/tauriDeepLink';
import {
  registerTauriMenuHandler,
  type TauriMenuAction,
  unregisterTauriMenuHandler,
} from './services/tauriMenuService';
import { applyDesktopRuntimeFlags } from './services/tauriRuntime';
import { viewNavigationLabelKey } from './services/viewNavigationLabels';
import type { View } from './types';

// ── Lazy-geladene Views (Code-Splitting → separate JS-Chunks) ─────────────────
const Dashboard = lazy(() =>
  import('./components/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const ManuscriptView = lazy(() =>
  import('./components/ManuscriptView').then((m) => ({
    default: m.ManuscriptView,
  })),
);
const WriterView = lazy(() =>
  import('./components/WriterView').then((m) => ({ default: m.WriterView })),
);
const TemplateView = lazy(() =>
  import('./components/TemplateView').then((m) => ({
    default: m.TemplateView,
  })),
);
const OutlineGeneratorView = lazy(() =>
  import('./components/OutlineGeneratorView').then((m) => ({
    default: m.OutlineGeneratorView,
  })),
);
const CharacterView = lazy(() =>
  import('./components/CharacterView').then((m) => ({
    default: m.CharacterView,
  })),
);
const WorldView = lazy(() =>
  import('./components/WorldView').then((m) => ({ default: m.WorldView })),
);
const ExportView = lazy(() =>
  import('./components/ExportView').then((m) => ({ default: m.ExportView })),
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({
    default: m.SettingsView,
  })),
);
const HelpView = lazy(() => import('./components/HelpView').then((m) => ({ default: m.HelpView })));
const SceneBoardView = lazy(() =>
  import('./components/SceneBoardView').then((m) => ({
    default: m.SceneBoardView,
  })),
);
const CharacterGraphView = lazy(() =>
  import('./components/CharacterGraphView').then((m) => ({
    default: m.CharacterGraphView,
  })),
);
const ConsistencyCheckerView = lazy(() =>
  import('./components/ConsistencyCheckerView').then((m) => ({
    default: m.ConsistencyCheckerView,
  })),
);
const CriticView = lazy(() =>
  import('./components/CriticView').then((m) => ({ default: m.CriticView })),
);
const WelcomePortal = lazy(() =>
  import('./components/WelcomePortal').then((m) => ({
    default: m.WelcomePortal,
  })),
);
// QNBS-v3: v1.6 views lazy-loaded to keep initial bundle lean
const BookPreviewView = lazy(() =>
  import('./components/BookPreviewView').then((m) => ({ default: m.BookPreviewView })),
);
const ProgressTrackerView = lazy(() =>
  import('./components/ProgressTrackerView').then((m) => ({ default: m.ProgressTrackerView })),
);
// QNBS-v3: v1.7 views lazy-loaded for bundle isolation
const ObjectsView = lazy(() =>
  import('./components/ObjectsView').then((m) => ({ default: m.ObjectsView })),
);
const MindMapView = lazy(() => import('./components/MindMapView'));
const CharacterInterviewsView = lazy(() => import('./components/CharacterInterviewsView'));
// QNBS-v3: v1.20 Phase 2.2 — LoRA Fine-Tuning view lazy-loaded (heavy adapter/training UI).
const LoraView = lazy(() =>
  import('./components/lora/LoraView').then((m) => ({ default: m.LoraView })),
);
// QNBS-v3: Keep Scenario lazy to keep the initial bundle focused on the default workspace.
const ScenarioWorkspaceView = lazy(loadScenarioWorkspaceView);

// Fallback while a view is loading
const ViewLoader: FC = () => {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('common.loading')}
      className="flex h-full w-full items-center justify-center"
    >
      <Spinner className="w-10 h-10 text-indigo-500" label={t('common.loading')} />
    </div>
  );
};

interface AppProps {
  isNewUser: boolean;
}

const App: FC<AppProps> = ({ isNewUser }) => {
  const appState = useApp({ isNewUser });
  const { currentView, handleNavigate, isPortalActive, isInitialLoad } = appState;
  const settings = useAppSelector((state) => state.settings);
  const project = useAppSelector(selectProjectData);
  const featureFlags = useAppSelector(selectFeatureFlags);
  const dispatch = useAppDispatch();
  const store = useStore();
  const { t, language, setLanguage, isReady: isI18nReady } = useTranslation();
  const announce = useAnnounce();
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);

  const prevViewRef = useRef<View | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const shareTargetHandledRef = useRef(false);

  const isPaletteOpen = useTransientUiStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useTransientUiStore((s) => s.setCommandPaletteOpen);
  const isIdbUnlockOpen = useTransientUiStore((s) => s.isIdbUnlockOpen);
  const setIdbUnlockOpen = useTransientUiStore((s) => s.setIdbUnlockOpen);

  // Collaboration Panel State
  const [isCollabPanelOpen, setIsCollabPanelOpen] = useState(false);

  // QNBS-v3: a non-'completed' journal means a disable/rotate was interrupted — recovery UX takes priority over the normal unlock flow below.
  const [recoveryJournal, setRecoveryJournal] = useState<EncryptionMigrationJournal | null>(null);
  // QNBS-v3 (CodeAnt #342): mirrors recoveryJournal so the sentinel-check effect can read it synchronously despite a stale closure.
  const recoveryJournalRef = useRef<EncryptionMigrationJournal | null>(null);
  useEffect(() => {
    recoveryJournalRef.current = recoveryJournal;
  }, [recoveryJournal]);

  useEffect(() => {
    const applyTheme = (isDark: boolean) => {
      document.body.classList.remove('light-theme', 'dark-theme');
      document.body.classList.add(isDark ? 'dark-theme' : 'light-theme');
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        // QNBS-v3: Sepia has distinct dark/light surface colors; reflect them in the
        // mobile browser chrome so the status bar matches the app shell.
        const themeColor =
          settings.appearancePreset === 'sepia'
            ? isDark
              ? '#1c1308'
              : '#f4ecd8'
            : isDark
              ? '#020617'
              : '#ffffff';
        themeColorMeta.setAttribute('content', themeColor);
      }
      try {
        localStorage.setItem('worldscript-theme', isDark ? 'dark' : 'light');
      } catch {
        // localStorage may be unavailable (SSR, quota exceeded)
      }
    };

    if (settings.theme === 'auto') {
      // Read system preference
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches);

      // React to changes in the system preference
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(settings.theme === 'dark');
    }
    return undefined;
  }, [settings.theme, settings.appearancePreset]);

  // QNBS-v3: Appearance presets → body class (pairs with index.css tokens).
  useEffect(() => {
    document.body.classList.remove('appearance-sepia');
    if (settings.appearancePreset === 'sepia') {
      document.body.classList.add('appearance-sepia');
    }
  }, [settings.appearancePreset]);

  useEffect(() => {
    // QNBS-v3: Decorative fixed layers are opt-out so long-form writers can keep a neutral canvas.
    document.body.classList.toggle(
      'writing-surface-plain',
      settings.writingSurfaceStyle === 'plain',
    );
  }, [settings.writingSurfaceStyle]);

  useEffect(() => {
    document.body.classList.toggle(
      'accessibility-high-contrast',
      settings.accessibility.highContrast,
    );
  }, [settings.accessibility.highContrast]);

  // QNBS-v3: Tag the body for desktop-scoped styling (is-desktop + data-os). Tauri-ness is constant
  // for the session, so this runs once; no-op on the web. Pairs with the `.is-desktop` CSS layer.
  useEffect(() => {
    applyDesktopRuntimeFlags();
  }, []);

  useEffect(() => {
    document.body.classList.toggle(
      'worldscript-reduced-motion',
      settings.accessibility.reducedMotion,
    );
  }, [settings.accessibility.reducedMotion]);

  // QNBS-v3 (#332/D4): manual relief valve for backdrop-blur GPU cost, mirroring reducedMotion above — covers OS/DE setups (some Linux/Wayland) that don't expose prefers-reduced-transparency.
  useEffect(() => {
    document.body.classList.toggle(
      'worldscript-reduced-transparency',
      settings.accessibility.reducedTransparency,
    );
  }, [settings.accessibility.reducedTransparency]);

  // QNBS-v3: Barrierefreiheits-Toggles → dokumentweite Klassen (Tokens in index.css).
  useEffect(() => {
    document.documentElement.classList.toggle(
      'worldscript-large-text',
      settings.accessibility.largeText,
    );
    document.body.classList.toggle(
      'worldscript-screen-reader',
      settings.accessibility.screenReader,
    );
    document.body.classList.toggle(
      'worldscript-focus-indicators',
      settings.accessibility.focusIndicators,
    );
    document.body.classList.toggle(
      'accessibility-comfortable-targets',
      settings.accessibility.comfortableTargets,
    );
  }, [
    settings.accessibility.largeText,
    settings.accessibility.screenReader,
    settings.accessibility.focusIndicators,
    settings.accessibility.comfortableTargets,
  ]);

  useEffect(() => {
    const mode = settings.accessibility.colorBlindMode;
    if (mode === 'none') {
      document.documentElement.removeAttribute('data-colorblind');
    } else {
      document.documentElement.setAttribute('data-colorblind', mode);
    }
  }, [settings.accessibility.colorBlindMode]);

  // QNBS-v3: HTML lang + dir — locale drives direction; enableRtlLayout flag overrides for manual RTL testing.
  useEffect(() => {
    document.documentElement.lang = language;
    const localeDir = RTL_LOCALES.has(language) ? 'rtl' : 'ltr';
    document.documentElement.dir = featureFlags.enableRtlLayout ? 'rtl' : localeDir;
  }, [language, featureFlags.enableRtlLayout]);

  // QNBS-v3: Sync enablePluginSystem flag into pluginRegistry so execute/executeAsync/loadPlugin
  // are properly gated without the registry needing direct Redux access.
  useEffect(() => {
    pluginRegistry.setEnabled(featureFlags.enablePluginSystem);
  }, [featureFlags.enablePluginSystem]);

  // QNBS-v3: Sync inference telemetry into telemetryService — the service cannot import the Redux
  // store without a circular dep, so App.tsx acts as the bridge. SEC: telemetry now also honours the
  // Settings → Privacy "Analytics" opt-out, mirroring the DuckDB persistence gate in listenerMiddleware
  // (isAnalyticsPersistenceAllowed). Re-runs on either input change so toggling the opt-out is live.
  useEffect(() => {
    void import('./services/ai/telemetryService').then(({ setTelemetryEnabled }) => {
      setTelemetryEnabled(featureFlags.enableDuckDbAnalytics && settings.privacy.analyticsEnabled);
    });
  }, [featureFlags.enableDuckDbAnalytics, settings.privacy.analyticsEnabled]);

  // QNBS-v3: Issue 5 — set the window adaptive-AI gate on cold start if the flag is already on
  //          (listener only fires on OFF→ON transitions, not on initial true state from localStorage)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot on mount only; flag changes handled by listenerMiddleware
  useEffect(() => {
    initAdaptiveAiOnStartup(featureFlags.enableAdaptiveAiEngine);
    // QNBS-v3: Phase 2 — init WorkerBus v2 on cold start if already enabled in persisted state
    void initWorkerBusOnStartup(featureFlags.enableWorkerBusV2);
    // QNBS-v3: B1.1 — init Local-First shadow sync on cold start if the flag is already on
    void initLocalFirstSyncOnStartup(featureFlags.enableLocalFirstSync);
  }, []);

  // QNBS-v3: checked independently of the feature flag — the journal, not the flag, is the source of truth for an interrupted disable/rotate migration (Phase 4/#338).
  useEffect(() => {
    void (async () => {
      const journal = await readEncryptionMigrationJournal();
      if (journal && journal.phase !== 'completed') setRecoveryJournal(journal);
    })();
  }, []);

  // QNBS-v3: desktop project files remain plaintext until R-15; the startup guard is web-only.
  useIdbUnlockStartupGuard({
    isDesktop: desktopPlatform.runtime.isDesktop,
    encryptionEnabled: featureFlags.enableIdbAtRestEncryption,
    encryptionReady: isIdbEncryptionReady(),
    hasRecoveryJournal: Boolean(recoveryJournal),
    dispatch,
  });

  // QNBS-v3: PWA share_target GET params → toast + stash for Writer paste flows; strip query to avoid leaking shared text in URL bar.
  useEffect(() => {
    if (shareTargetHandledRef.current || isPortalActive) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const shareTitle = params.get('share_title');
      const shareText = params.get('share_text');
      const shareUrl = params.get('share_url');
      if (!shareTitle && !shareText && !shareUrl) return;
      shareTargetHandledRef.current = true;
      const combined = [shareTitle, shareText, shareUrl].filter(Boolean).join('\n');
      const preview = combined.length > 280 ? `${combined.slice(0, 277).trimEnd()}…` : combined;
      try {
        sessionStorage.setItem('worldscript-share-target-payload', combined);
      } catch {
        /* quota / privacy mode */
      }
      dispatch(
        statusActions.addNotification({
          type: 'info',
          title: t('pwa.shareReceivedTitle'),
          description: preview
            ? `${t('pwa.shareReceivedHint')}\n${preview}`
            : t('pwa.shareReceivedHint'),
        }),
      );
      params.delete('share_title');
      params.delete('share_text');
      params.delete('share_url');
      const q = params.toString();
      const next = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', next);
    } catch {
      /* ignore */
    }
  }, [dispatch, isPortalActive, t]);

  // QNBS-v3: Translated view announcement instead of raw text (WCAG 4.1.3 status messages).
  //          requestAnimationFrame focus ensures the new view is mounted before focus moves (WCAG 2.4.3).
  useEffect(() => {
    if (isInitialLoad || isPortalActive) return;
    if (prevViewRef.current === currentView) return;
    prevViewRef.current = currentView;
    document.body.dataset['view'] = currentView;
    const labelKey = viewNavigationLabelKey(currentView);
    announce(
      t('common.viewOpenedAnnouncement', {
        view: t(labelKey),
      }),
    );
    requestAnimationFrame(() => mainRef.current?.focus());
  }, [currentView, announce, t, isInitialLoad, isPortalActive]);

  // QNBS-v3: gates on isInitialLoad too (not just isPortalActive) so a same-commit stale read can't auto-seed a project before the welcome portal shows.
  useProjectBootstrapEffect({
    project,
    isNewUser,
    isInitialLoad,
    isPortalActive,
    isI18nReady,
    t,
  });

  // QNBS-v3: PR3 — auto-launch the product tour once for first-run installs, after the welcome
  // portal closes and the nav has rendered. Returning users (or anyone who already finished/closed
  // it) are never interrupted; they can still start it manually from the Dashboard or Help.
  const tourStartedRef = useRef(false);
  useEffect(() => {
    if (!isNewUser || isInitialLoad || isPortalActive) return;
    // QNBS-v3: never hijack an automated browser session — the tour's full-screen overlay intercepts
    // pointer events and breaks E2E. navigator.webdriver is true only under automation, never for
    // real users, so this is invisible in production.
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    if (tourStartedRef.current || hasCompletedSpotlightTour()) return;
    // QNBS-v3 (CodeAnt): set the once-guard when the timer actually fires, not before it. If a dep
    // changes during the 600ms delay the effect cleanup cancels the timer; setting the guard early
    // would then permanently suppress the tour for a genuine first-run user.
    const id = window.setTimeout(() => {
      tourStartedRef.current = true;
      startSpotlightTour(t);
    }, 600);
    return () => window.clearTimeout(id);
  }, [isNewUser, isInitialLoad, isPortalActive, t]);

  const wordCountApprox = useMemo(() => approximateManuscriptWordCount(project), [project]);

  const togglePalette = useCallback(() => {
    const open = useTransientUiStore.getState().isCommandPaletteOpen;
    useTransientUiStore.getState().setCommandPaletteOpen(!open);
  }, []);

  const shortcutApi = useMemo(
    () => ({
      dispatch,
      getState: () => store.getState() as RootState,
      navigate: handleNavigate,
      togglePalette,
      translate: t,
    }),
    [dispatch, store, handleNavigate, togglePalette, t],
  );

  useGlobalKeyboardShortcuts({
    shortcuts: settings.keyboardShortcuts,
    api: shortcutApi,
  });

  // QNBS-v3: Push-to-Talk voice activation when configured
  usePushToTalk();

  // QNBS-v3 (T3): bootstrap native notification permission when the setting is on. No-op on the web.
  useNativeNotifications();

  const executeCommand = useCallback(
    (id: string) =>
      runCommandById(id, {
        dispatch,
        navigate: handleNavigate,
        setLanguage,
        t,
        theme: getEffectiveTheme(settings.theme),
        language,
        characters: characters.map((c) => ({ id: c.id, name: c.name })),
        worlds: worlds.map((w) => ({ id: w.id, name: w.name })),
        currentView,
        wordCountApprox,
        featureFlags,
        aiMode: settings.aiMode ?? 'hybrid',
        openRouterEnabled: settings.openRouter?.enabled ?? false,
        appearancePreset: settings.appearancePreset,
        advancedEditor: {
          distractionFree: settings.advancedEditor.distractionFree,
          typewriterMode: settings.advancedEditor.typewriterMode,
          zenMode: settings.advancedEditor.zenMode,
          focusMode: settings.advancedEditor.focusMode,
        },
        accessibility: {
          highContrast: settings.accessibility.highContrast,
          reducedMotion: settings.accessibility.reducedMotion,
          largeText: settings.accessibility.largeText,
        },
      }),
    [
      dispatch,
      handleNavigate,
      setLanguage,
      t,
      settings.theme,
      settings.aiMode,
      settings.openRouter?.enabled,
      settings.appearancePreset,
      settings.advancedEditor,
      settings.accessibility,
      language,
      characters,
      worlds,
      currentView,
      wordCountApprox,
      featureFlags,
    ],
  );

  // QNBS-v3: Voice command event listener — decouples voice service from React context
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        commandId: string;
        slots?: Array<{ name: string; value: string }>;
        transcript?: string;
      };
      if (detail?.commandId) {
        executeCommand(detail.commandId);
      }
    };
    window.addEventListener('voice-command', handler);
    return () => window.removeEventListener('voice-command', handler);
  }, [executeCommand]);

  // QNBS-v3 (T1/#189): installDesktopMenu is the source of truth for native menu actions once installed; registerTauriMenuHandler below is scoped to the pre-paint window (or a permanent fallback if install fails) and unregisters itself once the JS menu takes over, so the two paths never double-dispatch the same click.
  //
  // executeCommand is held in a ref so the menu only rebuilds when the language (t) changes — not on
  // every executeCommand identity change (it depends on characters/worlds/settings/… and recreates often).
  // QNBS-v3 (#332/D3): shared by the tray/menu Quit items — PredefinedMenuItem's native Quit bypasses onCloseRequested's flush entirely, so these call this instead. Never resolves if the flush failed, so the app stays running for the user to retry.
  const quitApp = useCallback(async () => {
    try {
      await flushPersistedState(store.getState() as RootState);
    } catch (error) {
      logger.warn('Pre-quit flush failed — aborting quit so autosave can retry', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // QNBS-v3: routes through desktopPlatform.lifecycle instead of the direct @tauri-apps/plugin-process import it replaced
    await desktopPlatform.lifecycle.quit();
  }, [store]);

  // QNBS-v3: executeCommandRef synced in its own effect (never assigned during render) so the menu
  // effect below can depend on [t, quitApp] only and skip rebuilding on every executeCommand identity change.
  const executeCommandRef = useRef(executeCommand);
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);
  useEffect(() => {
    // QNBS-v3: fallback bridge for the Rust pre-paint menu (see comment above) — unregisters itself once installDesktopMenu confirms the JS menu has taken over, or stays registered if it failed.
    const RUST_MENU_ACTION_TO_COMMAND: Record<TauriMenuAction, string> = {
      'menu-export': DESKTOP_COMMANDS.export,
      'menu-settings': DESKTOP_COMMANDS.settings,
      'menu-help': DESKTOP_COMMANDS.help,
      'menu-command-palette': DESKTOP_COMMANDS.commandPalette,
    };
    void registerTauriMenuHandler((action) =>
      executeCommandRef.current(RUST_MENU_ACTION_TO_COMMAND[action]),
    );
    void installDesktopMenu(
      (key) => t(key),
      (id) => executeCommandRef.current(id),
      quitApp,
    ).then((installed) => {
      if (installed) unregisterTauriMenuHandler();
    });
    return unregisterTauriMenuHandler;
  }, [t, quitApp]);

  // QNBS-v3 (T2): system tray (created once; guard makes re-calls a no-op). No-op on the web.
  // QNBS-v3 (#190): executeCommand in a ref so the tray rebuilds on language (t) change only, not on
  // every executeCommand identity change. installDesktopTray relabels the existing tray on re-call.
  const trayCommandRef = useRef(executeCommand);
  trayCommandRef.current = executeCommand;
  useEffect(() => {
    void installDesktopTray(
      (key) => t(key),
      (id) => trayCommandRef.current(id),
      quitApp,
    );
  }, [t, quitApp]);

  // QNBS-v3 (T2): close-to-tray — hide instead of quit when the setting is on (read live from store).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    // QNBS-v3 (#190): guard the async race — if the component unmounts before installCloseToTray
    // resolves, `unlisten` is still null during cleanup and the resolved listener would leak. Track a
    // cancelled flag and tear the resolved listener down immediately in that case.
    let cancelled = false;
    void installCloseToTray(
      // Defensive read — imported/malformed persisted settings can leave `desktop` null/undefined,
      // which would crash the close handler; default to false (don't trap the window).
      () => (store.getState() as RootState).settings.desktop?.minimizeToTray ?? false,
      // QNBS-v3 (#332/D3): flush pending project/settings state before a real quit proceeds.
      () => flushPersistedState(store.getState() as RootState),
    ).then((fn) => {
      if (cancelled) {
        fn?.();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [store]);

  // QNBS-v3: Tauri deep link handler for native file associations (.worldscript, .wsst)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initTauriDeepLink(dispatch, t).then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, [dispatch, t]);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />;
      case 'manuscript':
        return <ManuscriptView />;
      case 'writer':
        return <WriterView />;
      case 'templates':
        return <TemplateView onNavigate={handleNavigate} />;
      case 'outline':
        return <OutlineGeneratorView onNavigate={handleNavigate} />;
      case 'characters':
        return <CharacterView />;
      case 'world':
        return <WorldView />;
      case 'export':
        return <ExportView />;
      case 'settings':
        return <SettingsView />;
      case 'help':
        return <HelpView contextView={appState.previousView} />;
      case 'sceneboard':
        return <SceneBoardView />;
      case 'characterGraph':
        return <CharacterGraphView />;
      case 'consistencyChecker':
        return <ConsistencyCheckerView />;
      case 'critic':
        return <CriticView />;
      case 'preview':
        return <BookPreviewView onNavigate={handleNavigate} />;
      case 'progress':
        return <ProgressTrackerView />;
      case 'objects':
        // QNBS-v3: Gate added — feature was always accessible regardless of flag state.
        if (!featureFlags.enableObjectsGroups) return <Dashboard onNavigate={handleNavigate} />;
        return <ObjectsView />;
      case 'mindmap':
        // QNBS-v3: Gate added — feature was always accessible regardless of flag state.
        if (!featureFlags.enableMindMaps) return <Dashboard onNavigate={handleNavigate} />;
        return <MindMapView />;
      case 'characterInterviews':
        if (!featureFlags.enableCharacterInterviews)
          return <Dashboard onNavigate={handleNavigate} />;
        return <CharacterInterviewsView />;
      case 'lora':
        // QNBS-v3: gated like other flag-only views — falls back to Dashboard when off.
        if (!featureFlags.enableLoraAdapters) return <Dashboard onNavigate={handleNavigate} />;
        return <LoraView />;
      // QNBS-v3: Route Scenario through the canonical projection workspace.
      case 'scenario':
        return <ScenarioWorkspaceView onNavigate={handleNavigate} />;
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  if (isInitialLoad) {
    return (
      <div
        role="status"
        aria-label={t('common.appLoading')}
        className="flex h-[100dvh] w-screen items-center justify-center bg-[var(--sc-surface-base)]"
      >
        <Spinner className="w-16 h-16" label={t('common.appLoading')} />
      </div>
    );
  }

  if (isPortalActive) {
    return (
      <ErrorBoundary onReset={() => window.location.reload()}>
        <Suspense
          fallback={
            <div
              role="status"
              aria-label={t('common.appLoading')}
              className="flex h-[100dvh] w-screen items-center justify-center bg-[var(--sc-surface-base)]"
            >
              <Spinner className="w-16 h-16" label={t('common.appLoading')} />
            </div>
          }
        >
          <WelcomePortal onExit={appState.handlePortalExit} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <FeatureFlagsProvider value={featureFlags}>
      <AnalyticsBootstrap />
      <CommandExecutorProvider execute={executeCommand}>
        <ToastProvider>
          <AppContext.Provider value={appState}>
            {/* Skip-to-main-content link for keyboard users */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[var(--sc-accent)] focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
            >
              {t('common.skipToContent')}
            </a>
            <div className="flex h-[100dvh] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] overflow-hidden touch-none md:touch-auto">
              <Sidebar
                currentView={currentView}
                onNavigate={handleNavigate}
                isSidebarOpen={appState.isSidebarOpen}
                setIsSidebarOpen={appState.setIsSidebarOpen}
                enableLora={featureFlags.enableLoraAdapters}
              />
              <div className="app-column-mobile flex-1 flex flex-col h-full overflow-hidden pt-16 transition-all duration-300 ease-in-out md:ml-64">
                <Header
                  currentView={currentView}
                  setIsSidebarOpen={appState.setIsSidebarOpen}
                  isSidebarOpen={appState.isSidebarOpen}
                  onOpenPalette={() => setCommandPaletteOpen(true)}
                />
                <main
                  ref={mainRef}
                  id="main-content"
                  tabIndex={-1}
                  aria-label={t('common.mainContent')}
                  className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 scroll-smooth overscroll-none focus-visible:outline-none"
                >
                  <ErrorBoundary key={currentView} onReset={() => handleNavigate('dashboard')}>
                    <ViewErrorBoundary viewLabel={t(viewNavigationLabelKey(currentView))}>
                      <Suspense fallback={<ViewLoader />}>{renderView()}</Suspense>
                    </ViewErrorBoundary>
                  </ErrorBoundary>
                </main>
              </div>
              <ErrorBoundary onReset={() => setCommandPaletteOpen(false)}>
                <CommandPalette
                  isOpen={isPaletteOpen}
                  onClose={() => setCommandPaletteOpen(false)}
                  onNavigate={handleNavigate}
                  currentView={currentView}
                />
              </ErrorBoundary>
              <ErrorBoundary onReset={() => {}}>
                <VersionControlPanel />
              </ErrorBoundary>
              <ErrorBoundary onReset={() => setIsCollabPanelOpen(false)}>
                <Suspense fallback={null}>
                  <CollaborationPanel
                    isOpen={isCollabPanelOpen}
                    onClose={() => setIsCollabPanelOpen(false)}
                    projectId={project?.id ?? 'default'}
                  />
                </Suspense>
              </ErrorBoundary>
              <ErrorBoundary onReset={() => {}}>
                <Suspense fallback={null}>
                  <CrossProjectSearchPanelConnected />
                </Suspense>
              </ErrorBoundary>
              {featureFlags.enableGlobalCopilot && (
                <ErrorBoundary onReset={() => {}}>
                  <Suspense fallback={null}>
                    <CopilotLauncher currentView={currentView} onNavigate={handleNavigate} />
                  </Suspense>
                </ErrorBoundary>
              )}
              <ErrorBoundary onReset={() => {}}>
                <PWAUpdateToast />
              </ErrorBoundary>
              <ErrorBoundary onReset={() => {}}>
                <PWAInstallBanner />
              </ErrorBoundary>
              <ErrorBoundary onReset={() => {}}>
                <OfflineIndicator />
              </ErrorBoundary>
              <ErrorBoundary onReset={() => {}}>
                <DuckDbMigrationBanner />
              </ErrorBoundary>
              {featureFlags.enableVoiceSupport && (
                <>
                  <ErrorBoundary onReset={() => {}}>
                    <VoiceIndicator />
                  </ErrorBoundary>
                  <ErrorBoundary onReset={() => {}}>
                    <VoiceControlPanel />
                  </ErrorBoundary>
                </>
              )}
              {recoveryJournal && (
                // QNBS-v3 (CodeRabbit #342): fallback keeps the recovery gate blocking even if EncryptionRecoveryModal itself throws — a plain ErrorFallback has no backdrop/focus-trap and would leave the app underneath interactive.
                <ErrorBoundary
                  onReset={() => setRecoveryJournal(null)}
                  fallback={(reset) => (
                    <Modal
                      isOpen={true}
                      onClose={() => undefined}
                      isDismissible={false}
                      title={t('error.boundary.title')}
                    >
                      <div className="space-y-4">
                        <p className="text-[var(--sc-text-secondary)]">
                          {t('error.boundary.description')}
                        </p>
                        <div className="flex flex-wrap gap-2 justify-end">
                          <Button onClick={reset} variant="primary">
                            {t('error.boundary.reset')}
                          </Button>
                          <Button onClick={() => window.location.reload()} variant="secondary">
                            {t('error.boundary.reload')}
                          </Button>
                        </div>
                      </div>
                    </Modal>
                  )}
                >
                  <EncryptionRecoveryModal
                    journal={recoveryJournal}
                    onRecovered={() => {
                      if (recoveryJournal.operation === 'disable') {
                        dispatch(featureFlagsActions.setEnableIdbAtRestEncryption(false));
                      }
                      setRecoveryJournal(null);
                      // QNBS-v3 (CodeAnt #342): defensively close any unlock-modal state the sentinel-guard race (see recoveryJournalRef) might have set before this resolved.
                      setIdbUnlockOpen(false);
                    }}
                  />
                </ErrorBoundary>
              )}
              <IdbUnlockModalGate
                isOpen={isIdbUnlockOpen}
                encryptionEnabled={featureFlags.enableIdbAtRestEncryption}
                hasRecoveryJournal={Boolean(recoveryJournal)}
              />
            </div>
          </AppContext.Provider>
        </ToastProvider>
      </CommandExecutorProvider>
    </FeatureFlagsProvider>
  );
};

const AppWrapper: FC<AppProps> = (props) => (
  <I18nProvider>
    <LiveRegionProvider>
      <App {...props} />
    </LiveRegionProvider>
  </I18nProvider>
);

export default AppWrapper;
