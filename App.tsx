import type { FC } from 'react';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAppSelector, useAppDispatch } from './app/hooks';
import { useApp } from './hooks/useApp';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { I18nProvider } from './contexts/I18nContext';
import { useTranslation } from './hooks/useTranslation';
import { AppContext } from './contexts/AppContext';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
import { Spinner } from './components/ui/Spinner';
import { selectProjectData } from './features/project/projectSelectors';
import { selectFeatureFlags } from './features/featureFlags/featureFlagsSlice';
import { projectActions } from './features/project/projectSlice';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { PWAInstallBanner, PWAUpdateToast, OfflineIndicator } from './components/ui/PWAComponents';
import { VersionControlPanel } from './components/VersionControlPanel';
import { CollaborationPanel } from './components/CollaborationPanel';

// ── Lazy-geladene Views (Code-Splitting → separate JS-Chunks) ─────────────────
const Dashboard = lazy(() =>
  import('./components/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const ManuscriptView = lazy(() =>
  import('./components/ManuscriptView').then((m) => ({
    default: m.ManuscriptView,
  }))
);
const WriterView = lazy(() =>
  import('./components/WriterView').then((m) => ({ default: m.WriterView }))
);
const TemplateView = lazy(() =>
  import('./components/TemplateView').then((m) => ({
    default: m.TemplateView,
  }))
);
const OutlineGeneratorView = lazy(() =>
  import('./components/OutlineGeneratorView').then((m) => ({
    default: m.OutlineGeneratorView,
  }))
);
const CharacterView = lazy(() =>
  import('./components/CharacterView').then((m) => ({
    default: m.CharacterView,
  }))
);
const WorldView = lazy(() =>
  import('./components/WorldView').then((m) => ({ default: m.WorldView }))
);
const ExportView = lazy(() =>
  import('./components/ExportView').then((m) => ({ default: m.ExportView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({
    default: m.SettingsView,
  }))
);
const HelpView = lazy(() => import('./components/HelpView').then((m) => ({ default: m.HelpView })));
const SceneBoardView = lazy(() =>
  import('./components/SceneBoardView').then((m) => ({
    default: m.SceneBoardView,
  }))
);
const CharacterGraphView = lazy(() =>
  import('./components/CharacterGraphView').then((m) => ({
    default: m.CharacterGraphView,
  }))
);
const ConsistencyCheckerView = lazy(() =>
  import('./components/ConsistencyCheckerView').then((m) => ({
    default: m.ConsistencyCheckerView,
  }))
);
const CriticView = lazy(() =>
  import('./components/CriticView').then((m) => ({ default: m.CriticView }))
);
const WelcomePortal = lazy(() =>
  import('./components/WelcomePortal').then((m) => ({
    default: m.WelcomePortal,
  }))
);

// Fallback während eine View geladen wird
const ViewLoader: FC = () => (
  <div role="status" aria-label="Lädt…" className="flex h-full w-full items-center justify-center">
    <Spinner className="w-10 h-10 text-indigo-500" label="Lädt…" />
  </div>
);

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
  const { t } = useTranslation();

  // Command Palette State
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
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

  useEffect(() => {
    if (!isPortalActive && project && project.title === '' && project.manuscript.length === 0) {
      dispatch(
        projectActions.resetProject({
          title: t('initialProject.title'),
          logline: t('initialProject.logline'),
        })
      );
      dispatch(
        projectActions.setManuscript([
          {
            id: `sec-${Date.now()}`,
            title: t('initialProject.chapter1'),
            content: '',
          },
        ])
      );
    }
  }, [project, isPortalActive, dispatch, t]);

  // Handle Global Keyboard Shortcut for Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  if (isInitialLoad) {
    return (
      <div
        role="status"
        aria-label="Anwendung wird geladen"
        className="flex h-[100dvh] w-screen items-center justify-center bg-[var(--background-primary)]"
      >
        <Spinner className="w-16 h-16" label="Anwendung wird geladen" />
      </div>
    );
  }

  if (isPortalActive) {
    return (
      <Suspense
        fallback={
          <div
            role="status"
            aria-label="Anwendung wird geladen"
            className="flex h-[100dvh] w-screen items-center justify-center bg-[var(--background-primary)]"
          >
            <Spinner className="w-16 h-16" label="Anwendung wird geladen" />
          </div>
        }
      >
        <WelcomePortal onExit={appState.handlePortalExit} />
      </Suspense>
    );
  }

  return (
    <FeatureFlagsProvider value={featureFlags}>
      <AppContext.Provider value={appState}>
        {/* Skip-to-main-content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[var(--background-interactive)] focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Zum Hauptinhalt springen
        </a>
        {/* ARIA live region: announces view changes to screen readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {currentView}
        </div>
        <div className="flex h-[100dvh] bg-[var(--background-primary)] text-[var(--foreground-primary)] overflow-hidden touch-none md:touch-auto">
          <Sidebar
            currentView={currentView}
            onNavigate={handleNavigate}
            isSidebarOpen={appState.isSidebarOpen}
            setIsSidebarOpen={appState.setIsSidebarOpen}
          />
          <div className="flex-1 flex flex-col h-full overflow-hidden pt-16 transition-all duration-300 ease-in-out md:ml-64">
            <Header
              currentView={currentView}
              setIsSidebarOpen={appState.setIsSidebarOpen}
              isSidebarOpen={appState.isSidebarOpen}
              onOpenPalette={() => setIsPaletteOpen(true)}
            />
            <main
              id="main-content"
              aria-label="Hauptinhalt"
              className="flex-1 overflow-y-auto p-4 pb-20 sm:p-6 sm:pb-20 md:p-8 md:pb-8 scroll-smooth overscroll-none"
            >
              <ErrorBoundary key={currentView} onReset={() => handleNavigate('dashboard')}>
                <Suspense fallback={<ViewLoader />}>{renderView()}</Suspense>
              </ErrorBoundary>
            </main>
          </div>
          <CommandPalette
            isOpen={isPaletteOpen}
            onClose={() => setIsPaletteOpen(false)}
            onNavigate={handleNavigate}
          />
          <VersionControlPanel />
          <CollaborationPanel
            isOpen={isCollabPanelOpen}
            onClose={() => setIsCollabPanelOpen(false)}
            projectId={project?.id ?? 'default'}
          />
          <PWAUpdateToast />
          <PWAInstallBanner />
          <OfflineIndicator />
        </div>
      </AppContext.Provider>
    </FeatureFlagsProvider>
  );
};

const AppWrapper: FC<AppProps> = (props) => (
  <I18nProvider>
    <ToastProvider>
      <App {...props} />
    </ToastProvider>
  </I18nProvider>
);

export default AppWrapper;
