// QNBS-v3: Extracted from WriterView.tsx to keep each file ≤350 lines per architecture rules
import type { FC } from 'react';
import { useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import {
  selectIsPanelOpen,
  versionControlActions,
} from '../../features/versionControl/versionControlSlice';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { useTranslation } from '../../hooks/useTranslation';
import { AiScratchpad } from './AiScratchpad';
import { ContextPanel } from './ContextPanel';
import { ToolsPanel } from './ToolsPanel';

const WriterViewUI: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isVCPanelOpen = useAppSelector(selectIsPanelOpen);
  const [activeMobileTab, setActiveMobileTab] = useState<'context' | 'tools' | 'result'>('tools');
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({});
  const [focusMode, setFocusMode] = useState(false);

  // Mobile swipe gesture for panel switching (outline → tools → result)
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const MOBILE_TABS = ['context', 'tools', 'result'] as const;

  useSwipeGesture(mobilePanelRef, {
    onSwipeLeft: () => {
      // QNBS-v3: Swipe left = next panel in tab order.
      const idx = MOBILE_TABS.indexOf(activeMobileTab);
      if (idx < MOBILE_TABS.length - 1) setActiveMobileTab(MOBILE_TABS[idx + 1]!);
    },
    onSwipeRight: () => {
      const idx = MOBILE_TABS.indexOf(activeMobileTab);
      if (idx > 0) setActiveMobileTab(MOBILE_TABS[idx - 1]!);
    },
  });

  const togglePanel = (panel: string) => {
    setCollapsedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Focus Mode Toggle + Panel Controls (Desktop) */}
      <div className="hidden md:flex items-center justify-end mb-2 gap-2">
        <button
          type="button"
          onClick={() => togglePanel('context')}
          title={collapsedPanels['context'] ? t('writer.context.show') : t('writer.context.hide')}
          className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors"
        >
          {collapsedPanels['context']
            ? `▷ ${t('writer.context.label')}`
            : `◁ ${t('writer.context.label')}`}
        </button>
        <button
          type="button"
          onClick={() => togglePanel('tools')}
          title={collapsedPanels['tools'] ? t('writer.tools.show') : t('writer.tools.hide')}
          className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors"
        >
          {collapsedPanels['tools']
            ? `▷ ${t('writer.tools.label')}`
            : `◁ ${t('writer.tools.label')}`}
        </button>
        <button
          type="button"
          onClick={() => setFocusMode((f) => !f)}
          title={focusMode ? t('writer.focusMode.exit') : t('writer.focusMode.enter')}
          className={`text-xs px-2 py-1 rounded border transition-colors ${focusMode ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-ring-focus)]/40 text-[var(--sc-ring-focus)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'}`}
        >
          {focusMode
            ? `⊠ ${t('writer.focusMode.exitLabel')}`
            : `⊡ ${t('writer.focusMode.enterLabel')}`}
        </button>
        {/* QNBS-v3: Aria + Mindest-Touch-Ziel für VC-Toggle — axe/E2E und mobile Writer-Stabilität. */}
        <button
          type="button"
          data-testid="writer-version-control-btn"
          onClick={() => dispatch(versionControlActions.togglePanel())}
          title={t('writer.versionControl.tooltip')}
          aria-label={t('writer.versionControl.label')}
          aria-expanded={isVCPanelOpen}
          className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${isVCPanelOpen ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-ring-focus)]/40 text-[var(--sc-ring-focus)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'}`}
        >
          ⎎ {t('writer.versionControl.label')}
        </button>
      </div>

      {/* QNBS-v3: mobile VC button — desktop VC toggle is hidden md:flex, unreachable on Pixel 5 */}
      <div className="md:hidden flex items-center justify-end mb-1 px-1">
        <button
          type="button"
          data-testid="writer-version-control-btn"
          onClick={() => dispatch(versionControlActions.togglePanel())}
          aria-label={t('writer.versionControl.label')}
          aria-expanded={isVCPanelOpen}
          className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${isVCPanelOpen ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-ring-focus)]/40 text-[var(--sc-ring-focus)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'}`}
        >
          ⎎ {t('writer.versionControl.label')}
        </button>
      </div>

      {/* QNBS-v3: ARIA tablist — mobile segmented control needs role/aria-selected for axe compliance + Playwright testid selectors */}
      <div
        role="tablist"
        aria-label={t('writer.studio.title')}
        className="md:hidden p-1 mx-0 mb-4 bg-[var(--sc-surface-overlay)] rounded-xl flex items-center relative border border-[var(--sc-border-subtle)]/50 shadow-inner select-none"
      >
        {(['context', 'tools', 'result'] as const).map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab}
            aria-selected={activeMobileTab === tab}
            aria-controls={`writer-panel-${tab}`}
            data-testid={`writer-tab-${tab}`}
            onClick={() => setActiveMobileTab(tab)}
            className={`flex-1 min-h-[44px] py-2 text-sm font-semibold rounded-lg transition-all duration-200 z-10 touch-manipulation ${
              activeMobileTab === tab
                ? 'bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] shadow-md transform scale-[1.02] ring-2 ring-[var(--sc-ring-focus)] ring-offset-2 ring-offset-[var(--sc-surface-base)]'
                : 'text-[var(--sc-text-muted)] hover:text-[var(--sc-text-secondary)]'
            }`}
          >
            {tab === 'context' && t('writer.studio.context.title').split(' ')[0]}
            {tab === 'tools' && t('writer.studio.tools.title').split(' ')[0]}
            {tab === 'result' && 'Result'}
          </button>
        ))}
      </div>

      {/* Mobile Views (Conditional Render) */}
      <div ref={mobilePanelRef} className="md:hidden flex-grow min-h-0 overflow-hidden">
        {activeMobileTab === 'context' && (
          <div
            id="writer-panel-context"
            role="tabpanel"
            aria-labelledby="writer-tab-context"
            className="h-full"
          >
            <ContextPanel />
          </div>
        )}
        {activeMobileTab === 'tools' && (
          <div
            id="writer-panel-tools"
            role="tabpanel"
            aria-labelledby="writer-tab-tools"
            className="h-full"
          >
            <ToolsPanel />
          </div>
        )}
        {activeMobileTab === 'result' && (
          <div
            id="writer-panel-result"
            role="tabpanel"
            aria-labelledby="writer-tab-result"
            className="h-full"
          >
            <AiScratchpad />
          </div>
        )}
      </div>

      {/* Desktop Grid Layout (Always Visible on MD+) */}
      {focusMode ? (
        <div className="hidden md:grid md:grid-cols-2 md:gap-6 h-full items-start">
          <div className="h-full overflow-hidden">
            <ContextPanel />
          </div>
          <div className="h-full overflow-hidden">
            <AiScratchpad />
          </div>
        </div>
      ) : (
        <div
          className={`hidden md:grid md:gap-6 h-full items-start transition-all duration-300 ${
            collapsedPanels['context'] && collapsedPanels['tools']
              ? 'md:grid-cols-[0_0_1fr]'
              : collapsedPanels['context']
                ? 'md:grid-cols-[0_1fr_1fr]'
                : collapsedPanels['tools']
                  ? 'md:grid-cols-[1fr_0_1fr]'
                  : 'md:grid-cols-3'
          }`}
        >
          <div
            className={`h-full overflow-hidden transition-all duration-300 ${collapsedPanels['context'] ? 'w-0 opacity-0 overflow-hidden' : 'opacity-100'}`}
          >
            <ContextPanel />
          </div>
          <div
            className={`h-full overflow-hidden transition-all duration-300 ${collapsedPanels['tools'] ? 'w-0 opacity-0 overflow-hidden' : 'opacity-100'}`}
          >
            <ToolsPanel />
          </div>
          <div className="h-full overflow-hidden">
            <AiScratchpad />
          </div>
        </div>
      )}
    </div>
  );
};

export { WriterViewUI };
