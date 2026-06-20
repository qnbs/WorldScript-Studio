// QNBS-v3: Local UI/layout state for ManuscriptView, extracted so ManuscriptViewUI orchestrates
// only rendering. Holds the nav tab, mobile drawers, desktop focus mode, and the resizable-panel
// state, plus the Escape-closes-research-split effect. Shared across the desktop + mobile layouts.
import { useCallback, useEffect, useState } from 'react';
import { useTransientUiStore } from '../app/transientUiStore';
import { useMediaQuery } from './useMediaQuery';
import { useResizablePanels } from './useResizablePanels';

export function useManuscriptLayout() {
  const manuscriptResearchSplitOpen = useTransientUiStore((s) => s.manuscriptResearchSplitOpen);
  const setManuscriptResearchSplitOpen = useTransientUiStore(
    (s) => s.setManuscriptResearchSplitOpen,
  );

  const [leftNavTab, setLeftNavTab] = useState<'chapters' | 'binder'>('chapters');
  const [isNavDrawerOpen, setNavDrawerOpen] = useState(false);
  const [isInspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // QNBS-v3 (#179): the two mobile drawers are mutually exclusive — opening one closes the other.
  // The shared Drawer applies global side effects (body overflow lock + focus restore), so two open at
  // once would let a close re-enable scrolling / restore focus while the other is still open.
  const setIsNavDrawerOpen = useCallback((open: boolean) => {
    setNavDrawerOpen(open);
    if (open) setInspectorDrawerOpen(false);
  }, []);
  const setIsInspectorDrawerOpen = useCallback((open: boolean) => {
    setInspectorDrawerOpen(open);
    if (open) setNavDrawerOpen(false);
  }, []);

  // QNBS-v3 (#179): mobile drawers are meaningless on desktop — reset them when the viewport crosses to
  // desktop, so a drawer opened on mobile doesn't stay logically open and reappear on return to mobile.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  useEffect(() => {
    if (isDesktop) {
      setNavDrawerOpen(false);
      setInspectorDrawerOpen(false);
    }
  }, [isDesktop]);

  const panels = useResizablePanels(20, 20);

  useEffect(() => {
    if (!manuscriptResearchSplitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManuscriptResearchSplitOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manuscriptResearchSplitOpen, setManuscriptResearchSplitOpen]);

  return {
    leftNavTab,
    setLeftNavTab,
    isNavDrawerOpen,
    setIsNavDrawerOpen,
    isInspectorDrawerOpen,
    setIsInspectorDrawerOpen,
    isFocusMode,
    setIsFocusMode,
    manuscriptResearchSplitOpen,
    setManuscriptResearchSplitOpen,
    ...panels,
  };
}

export type UseManuscriptLayoutReturn = ReturnType<typeof useManuscriptLayout>;
