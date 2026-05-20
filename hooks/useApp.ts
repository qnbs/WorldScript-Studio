import { useCallback, useEffect, useState } from 'react';
import { parseHash, pushHash } from '../services/deepLinkService';
import { logger } from '../services/logger';
import type { View } from '../types';

// QNBS-v3: All View values listed here — kept in sync with the View union in types.ts.
//          Previously missing: analytics, zen, preview, progress.
const VALID_VIEWS = new Set<View>([
  'dashboard',
  'manuscript',
  'writer',
  'templates',
  'outline',
  'characters',
  'world',
  'export',
  'settings',
  'help',
  'sceneboard',
  'analytics',
  'zen',
  'characterGraph',
  'consistencyChecker',
  'critic',
  'preview',
  'progress',
]);

function isValidView(value: string): value is View {
  return VALID_VIEWS.has(value as View);
}

function readInitialView(): View {
  try {
    // Hash-based deep links take priority over query params and localStorage.
    const { view: hashView } = parseHash(window.location.hash);
    if (hashView) return hashView;
  } catch {
    /* ignore */
  }
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    if (fromUrl && isValidView(fromUrl)) return fromUrl;
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem('storycraft-last-view');
    if (stored && isValidView(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'dashboard';
}

export const useApp = ({ isNewUser }: { isNewUser: boolean }) => {
  const [currentView, setCurrentView] = useState<View>(() => readInitialView());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPortalActive, setIsPortalActive] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (isNewUser) {
      setIsPortalActive(true);
    }
    setIsInitialLoad(false);
  }, [isNewUser]);

  // QNBS-v3: web+storycraft protocol placeholder — manifest passes ?protocol= for future routing hooks.
  useEffect(() => {
    try {
      const proto = new URLSearchParams(window.location.search).get('protocol');
      if (proto) {
        logger.debug('[DeepLink] protocol handler query reserved for future use');
      }
    } catch {
      /* ignore */
    }
  }, []);

  // QNBS-v3: Listen for hash changes so browser back/forward and external deep links work.
  useEffect(() => {
    function onHashChange() {
      const { view } = parseHash(window.location.hash);
      if (view && view !== currentView) {
        setCurrentView(view);
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [currentView]);

  // Save the current view to localStorage whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem('storycraft-last-view', currentView);
    } catch {
      /* Storage unavailable */
    }
  }, [currentView]);

  const handlePortalExit = useCallback((view?: View) => {
    if (view) {
      setCurrentView(view);
      pushHash(view);
    }
    setIsPortalActive(false);
  }, []);

  // QNBS-v3: Keep URL hash in sync with navigation so all views are shareable/bookmarkable.
  const handleNavigate = useCallback((view: View) => {
    setCurrentView(view);
    pushHash(view);
  }, []);

  return {
    currentView,
    isSidebarOpen,
    isPortalActive,
    isInitialLoad,
    handlePortalExit,
    handleNavigate,
    setIsSidebarOpen,
  };
};

export type UseAppReturnType = ReturnType<typeof useApp>;
