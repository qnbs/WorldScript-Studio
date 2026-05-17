// QNBS-v3: Extracted from WriterView.tsx to keep each file ≤350 lines per architecture rules
import type { FC } from 'react';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import {
  selectIsPanelOpen,
  versionControlActions,
} from '../../features/versionControl/versionControlSlice';
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
          className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-secondary)] transition-colors"
        >
          {collapsedPanels['context']
            ? `▷ ${t('writer.context.label')}`
            : `◁ ${t('writer.context.label')}`}
        </button>
        <button
          type="button"
          onClick={() => togglePanel('tools')}
          title={collapsedPanels['tools'] ? t('writer.tools.show') : t('writer.tools.hide')}
          className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-secondary)] transition-colors"
        >
          {collapsedPanels['tools']
            ? `▷ ${t('writer.tools.label')}`
            : `◁ ${t('writer.tools.label')}`}
        </button>
        <button
          type="button"
          onClick={() => setFocusMode((f) => !f)}
          title={focusMode ? t('writer.focusMode.exit') : t('writer.focusMode.enter')}
          className={`text-xs px-2 py-1 rounded border transition-colors ${focusMode ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10' : 'border-[var(--border-primary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-secondary)]'}`}
        >
          {focusMode
            ? `⊠ ${t('writer.focusMode.exitLabel')}`
            : `⊡ ${t('writer.focusMode.enterLabel')}`}
        </button>
        {/* QNBS-v3: Aria + Mindest-Touch-Ziel für VC-Toggle — axe/E2E und mobile Writer-Stabilität. */}
        <button
          type="button"
          onClick={() => dispatch(versionControlActions.togglePanel())}
          title="Version Control (Branches &amp; Snapshots)"
          aria-label={t('writer.versionControl.label')}
          aria-expanded={isVCPanelOpen}
          className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${isVCPanelOpen ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10' : 'border-[var(--border-primary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-secondary)]'}`}
        >
          ⎎ {t('writer.versionControl.label')}
        </button>
      </div>

      {/* Mobile Segmented Control - Top Navigation */}
      <div className="md:hidden p-1 mx-0 mb-4 bg-[var(--background-tertiary)] rounded-xl flex items-center relative border border-[var(--border-primary)]/50 shadow-inner select-none">
        {(['context', 'tools', 'result'] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveMobileTab(tab)}
            className={`flex-1 min-h-[44px] py-2 text-sm font-semibold rounded-lg transition-all duration-200 z-10 touch-manipulation ${
              activeMobileTab === tab
                ? 'bg-[var(--background-secondary)] text-[var(--foreground-primary)] shadow-md transform scale-[1.02] ring-2 ring-[var(--ring-focus)] ring-offset-2 ring-offset-[var(--background-primary)]'
                : 'text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'
            }`}
          >
            {tab === 'context' && t('writer.studio.context.title').split(' ')[0]}
            {tab === 'tools' && t('writer.studio.tools.title').split(' ')[0]}
            {tab === 'result' && 'Result'}
          </button>
        ))}
      </div>

      {/* Mobile Views (Conditional Render) */}
      <div className="md:hidden flex-grow min-h-0 overflow-hidden">
        {activeMobileTab === 'context' && <ContextPanel />}
        {activeMobileTab === 'tools' && <ToolsPanel />}
        {activeMobileTab === 'result' && <AiScratchpad />}
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
