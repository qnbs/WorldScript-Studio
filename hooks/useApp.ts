import { useCallback, useEffect, useState } from 'react';
import { logger } from '../services/logger';
import type { View } from '../types';

// QNBS-v3: Validates deep-link ?view= values against manifest shortcuts / sidebar ids.
function isValidView(value: string): value is View {
  return (
    value === 'dashboard' ||
    value === 'manuscript' ||
    value === 'writer' ||
    value === 'templates' ||
    value === 'outline' ||
    value === 'characters' ||
    value === 'world' ||
    value === 'export' ||
    value === 'settings' ||
    value === 'help' ||
    value === 'sceneboard' ||
    value === 'analytics' ||
    value === 'zen' ||
    value === 'characterGraph' ||
    value === 'consistencyChecker' ||
    value === 'critic'
  );
}

function readInitialView(): View {
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
    }
    setIsPortalActive(false);
  }, []);

  const handleNavigate = useCallback((view: View) => {
    setCurrentView(view);
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
