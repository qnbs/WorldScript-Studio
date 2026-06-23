import { useCallback, useEffect, useRef, useState } from 'react';
import { parseHash, pushHash } from '../services/deepLinkService';
import { logger } from '../services/logger';
import type { View } from '../types';

// QNBS-v3: All View values listed here — kept in sync with the View union in types.ts.
//          Previously missing: analytics, zen, preview, progress; then the flag-gated views
//          (objects/mindmap/characterInterviews/lora) — without these, a refresh/bookmark on a
//          flag-gated view failed to restore and silently fell back to 'dashboard'.
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
  'objects',
  'mindmap',
  'characterInterviews',
  'lora',
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
    const stored = localStorage.getItem('worldscript-last-view');
    if (stored && isValidView(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'dashboard';
}

export const useApp = ({ isNewUser }: { isNewUser: boolean }) => {
  const [currentView, setCurrentView] = useState<View>(() => readInitialView());
  // QNBS-v3: remember the view navigated away from, so view-aware Help can open to the matching
  // category (once inside Help, currentView is 'help' and no longer tells us where the user was).
  const previousViewRef = useRef<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPortalActive, setIsPortalActive] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // QNBS-v3 (CodeAnt): the single place that mutates currentView, so previousView is tracked on
  // EVERY navigation path — handleNavigate, hashchange (browser back/forward + deep links), and
  // portal exit — not just sidebar clicks. Otherwise view-aware Help opens with a stale origin view.
  const switchView = useCallback((view: View) => {
    setCurrentView((prev) => {
      if (prev !== view) previousViewRef.current = prev;
      return view;
    });
  }, []);

  useEffect(() => {
    if (isNewUser) {
      setIsPortalActive(true);
    }
    setIsInitialLoad(false);
  }, [isNewUser]);

  // QNBS-v3: Allow settings to re-open the welcome portal from any view.
  useEffect(() => {
    function onOpenPortal() {
      setIsPortalActive(true);
    }
    window.addEventListener('worldscript:openPortal', onOpenPortal);
    return () => window.removeEventListener('worldscript:openPortal', onOpenPortal);
  }, []);

  // QNBS-v3: web+worldscript protocol placeholder — manifest passes ?protocol= for future routing hooks.
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
        switchView(view);
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [currentView, switchView]);

  // Save the current view to localStorage whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem('worldscript-last-view', currentView);
    } catch {
      /* Storage unavailable */
    }
  }, [currentView]);

  const handlePortalExit = useCallback(
    (view?: View) => {
      if (view) {
        switchView(view);
        pushHash(view);
      }
      setIsPortalActive(false);
    },
    [switchView],
  );

  // QNBS-v3: Keep URL hash in sync with navigation so all views are shareable/bookmarkable.
  const handleNavigate = useCallback(
    (view: View) => {
      switchView(view);
      pushHash(view);
    },
    [switchView],
  );

  return {
    currentView,
    previousView: previousViewRef.current,
    isSidebarOpen,
    isPortalActive,
    isInitialLoad,
    handlePortalExit,
    handleNavigate,
    setIsSidebarOpen,
  };
};

export type UseAppReturnType = ReturnType<typeof useApp>;
