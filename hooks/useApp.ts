import { useState, useEffect, useCallback } from 'react';
import type { View } from '../types';

export const useApp = ({ isNewUser }: { isNewUser: boolean }) => {
  const [currentView, setCurrentView] = useState<View>(() => {
    // Read the last view from localStorage. If it doesn't exist, default to 'dashboard'.
    try {
      return (localStorage.getItem('storycraft-last-view') as View) || 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPortalActive, setIsPortalActive] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (isNewUser) {
      setIsPortalActive(true);
    }
    setIsInitialLoad(false);
  }, [isNewUser]);

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
