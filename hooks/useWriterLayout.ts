// QNBS-v3: Local UI/layout state for WriterViewUI, extracted so the view component focuses on
// rendering. Owns mobile tab, panel collapse, desktop focus mode, the flow-mode Escape handler,
// and the mobile swipe-to-switch-panel wiring.
import { useEffect, useRef, useState } from 'react';
import { useWriterViewContext } from '../contexts/WriterViewContext';
import { useSwipeGesture } from './useSwipeGesture';

const MOBILE_TABS = ['context', 'tools', 'result'] as const;
export type WriterMobileTab = (typeof MOBILE_TABS)[number];

export function useWriterLayout() {
  const { flowMode, toggleFlowMode } = useWriterViewContext();
  const [activeMobileTab, setActiveMobileTab] = useState<WriterMobileTab>('tools');
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({});
  const [focusMode, setFocusMode] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  // X-2: Escape exits Flow Mode without conflicting with global shortcuts (no existing Escape handler found in useGlobalKeyboardShortcuts)
  useEffect(() => {
    if (!flowMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleFlowMode();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flowMode, toggleFlowMode]);

  useSwipeGesture(mobilePanelRef, {
    onSwipeLeft: () => {
      // QNBS-v3: Swipe left = next panel. Functional update derives from the latest tab so rapid
      // consecutive swipes aren't collapsed into one move by a stale captured value.
      setActiveMobileTab((prev) => {
        const idx = MOBILE_TABS.indexOf(prev);
        return idx < MOBILE_TABS.length - 1 ? MOBILE_TABS[idx + 1]! : prev;
      });
    },
    onSwipeRight: () => {
      setActiveMobileTab((prev) => {
        const idx = MOBILE_TABS.indexOf(prev);
        return idx > 0 ? MOBILE_TABS[idx - 1]! : prev;
      });
    },
  });

  const togglePanel = (panel: string) => {
    setCollapsedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  return {
    flowMode,
    toggleFlowMode,
    activeMobileTab,
    setActiveMobileTab,
    collapsedPanels,
    togglePanel,
    focusMode,
    setFocusMode,
    mobilePanelRef,
    mobileTabs: MOBILE_TABS,
  };
}

export type UseWriterLayoutReturn = ReturnType<typeof useWriterLayout>;
