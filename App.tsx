import type { FC } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from './app/hooks';
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

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { IdbUnlockModal } from './components/settings/IdbUnlockModal';
import { DuckDbMigrationBanner } from './components/ui/DuckDbMigrationBanner';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
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
import { selectFeatureFlags } from './features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from './features/project/projectSelectors';
import { projectActions } from './features/project/projectSlice';
import { statusActions } from './features/status/statusSlice';
import { useApp } from './hooks/useApp';
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts';
import { usePushToTalk } from './hooks/usePushToTalk';
import { useTranslation } from './hooks/useTranslation';
import { runCommandById } from './services/commands/commandBuilder';
import { getEffectiveTheme } from './services/commands/effectiveTheme';
import { approximateManuscriptWordCount } from './services/commands/wordCountApprox';
import { pluginRegistry } from './services/pluginRegistry';
import { repairProjectI18nFields } from './services/projectI18nRepair';
import { isIdbEncryptionReady } from './services/storage/storageEncryptionService';
import { registerTauriMenuHandler, unregisterTauriMenuHandler } from './services/tauriMenuService';
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

  useEffect(() => {
    const applyTheme = (isDark: boolean) => {
      document.body.classList.remove('light-theme', 'dark-theme');
      document.body.classList.add(isDark ? 'dark-theme' : 'light-theme');
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isDark ? '#020617' : '#ffffff');
      }
      try {
        localStorage.setItem('storycraft-theme', isDark ? 'dark' : 'light');
      } catch {
        // localStorage may be unavailable (SSR, quota exceeded)
      }
    };

    if (settings.theme === 'auto') {
      // System-Präferenz auslesen
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches);

      // Auf Änderungen der System-Einstellung reagieren
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(settings.theme === 'dark');
    }
    return undefined;
  }, [settings.theme]);

  // QNBS-v3: Appearance presets + a11y hooks → body classes (pairs with index.css tokens).
  useEffect(() => {
    const appearanceClasses = ['appearance-sepia', 'appearance-fantasy', 'appearance-romance'];
    document.body.classList.remove(...appearanceClasses);
    switch (settings.appearancePreset) {
      case 'sepia':
        document.body.classList.add('appearance-sepia');
        break;
      case 'fantasy':
        document.body.classList.add('appearance-fantasy');
        break;
      case 'romance':
        document.body.classList.add('appearance-romance');
        break;
      default:
        break;
    }
  }, [settings.appearancePreset]);

  useEffect(() => {
    document.body.classList.toggle(
      'accessibility-high-contrast',
      settings.accessibility.highContrast,
    );
  }, [settings.accessibility.highContrast]);

  useEffect(() => {
    document.body.classList.toggle(
      'storycraft-reduced-motion',
      settings.accessibility.reducedMotion,
    );
  }, [settings.accessibility.reducedMotion]);

  // QNBS-v3: Barrierefreiheits-Toggles → dokumentweite Klassen (Tokens in index.css).
  useEffect(() => {
    document.documentElement.classList.toggle(
      'storycraft-large-text',
      settings.accessibility.largeText,
    );
    document.body.classList.toggle('storycraft-screen-reader', settings.accessibility.screenReader);
    document.body.classList.toggle(
      'storycraft-focus-indicators',
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

  // QNBS-v3: B-1 — when IDB at-rest encryption is on and the session key is not yet derived,
  // prompt for the passphrase before any IDB read (key is never persisted, must be re-entered).
  useEffect(() => {
    if (featureFlags.enableIdbAtRestEncryption && !isIdbEncryptionReady()) {
      setIdbUnlockOpen(true);
    }
  }, [featureFlags.enableIdbAtRestEncryption, setIdbUnlockOpen]);

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
        sessionStorage.setItem('storycraft-share-target-payload', combined);
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

  // QNBS-v3: Übersetzte View-Ansage statt Rohtext (WCAG 4.1.3 Statusmeldungen).
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

  useEffect(() => {
    if (!isI18nReady || isPortalActive || !project) return;

    const repair = repairProjectI18nFields(project, t);
    if (repair) {
      if (repair.title !== undefined) dispatch(projectActions.updateTitle(repair.title));
      if (repair.logline !== undefined) dispatch(projectActions.updateLogline(repair.logline));
      if (repair.manuscript !== undefined)
        dispatch(projectActions.setManuscript(repair.manuscript));
      return;
    }

    if (project.title === '' && project.manuscript.length === 0) {
      dispatch(
        projectActions.resetProject({
          title: t('initialProject.title'),
          logline: t('initialProject.logline'),
          chapter1Title: t('initialProject.chapter1'),
        }),
      );
    }
  }, [project, isPortalActive, isI18nReady, dispatch, t]);

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
      }),
    [
      dispatch,
      handleNavigate,
      setLanguage,
      t,
      settings.theme,
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

  useEffect(() => {
    void registerTauriMenuHandler((action) => {
      if (action === 'menu-settings') executeCommand('nav-settings');
      else if (action === 'menu-help') executeCommand('nav-help');
      else if (action === 'menu-export') executeCommand('nav-export');
    });
    return () => unregisterTauriMenuHandler();
  }, [executeCommand]);

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
        return <HelpView />;
      case 'sceneboard':
        return <SceneBoardView />;
      case 'characterGraph':
        return <CharacterGraphView />;
      case 'consistencyChecker':
        return <ConsistencyCheckerView />;
      case 'critic':
        return <CriticView />;
      case 'preview':
        return <BookPreviewView />;
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
              <CommandPalette
                isOpen={isPaletteOpen}
                onClose={() => setCommandPaletteOpen(false)}
                onNavigate={handleNavigate}
                currentView={currentView}
              />
              <VersionControlPanel />
              <Suspense fallback={null}>
                <CollaborationPanel
                  isOpen={isCollabPanelOpen}
                  onClose={() => setIsCollabPanelOpen(false)}
                  projectId={project?.id ?? 'default'}
                />
              </Suspense>
              <Suspense fallback={null}>
                <CrossProjectSearchPanelConnected />
              </Suspense>
              <PWAUpdateToast />
              <PWAInstallBanner />
              <OfflineIndicator />
              <DuckDbMigrationBanner />
              {featureFlags.enableVoiceSupport && (
                <>
                  <VoiceIndicator />
                  <VoiceControlPanel />
                </>
              )}
              {isIdbUnlockOpen && <IdbUnlockModal onUnlocked={() => setIdbUnlockOpen(false)} />}
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
