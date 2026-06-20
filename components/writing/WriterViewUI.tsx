// QNBS-v3: Extracted from WriterView.tsx to keep each file ≤350 lines per architecture rules
import type { FC } from 'react';
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { proForgeActions } from '../../features/proForge/proForgeSlice';
import {
  selectIsPanelOpen,
  versionControlActions,
} from '../../features/versionControl/versionControlSlice';
import { useFirstUseFlag } from '../../hooks/useFirstUseFlag';
import { useTranslation } from '../../hooks/useTranslation';
import { useWriterLayout } from '../../hooks/useWriterLayout';
import { ProForgeDashboard } from '../proForge/ProForgeDashboard';
import { AiScratchpad } from './AiScratchpad';
import { ContextPanel } from './ContextPanel';
import { ToolsPanel } from './ToolsPanel';
import { WriterModeBadge } from './WriterModeBadge';
import { WriterModeCoachmark } from './WriterModeCoachmark';

const WriterViewUI: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isVCPanelOpen = useAppSelector(selectIsPanelOpen);
  const isProForgeEnabled = useAppSelector((s) => s.featureFlags.enableProForge);
  const isProForgeActive = useAppSelector((s) => s.proForge.isActive);
  const {
    flowMode,
    toggleFlowMode,
    activeMobileTab,
    setActiveMobileTab,
    collapsedPanels,
    togglePanel,
    focusMode,
    setFocusMode,
    resetLayout,
    mobilePanelRef,
  } = useWriterLayout();

  // QNBS-v3: one-time mode coachmarks (persist via localStorage) so first-time users learn what
  // Flow / Focus / ProForge do without a heavyweight tour framework.
  const [seenFlow, markFlowSeen] = useFirstUseFlag('flow');
  const [seenFocus, markFocusSeen] = useFirstUseFlag('focus');
  const [seenProForge, markProForgeSeen] = useFirstUseFlag('proforge');

  const contextHidden = Boolean(collapsedPanels['context']);
  const toolsHidden = Boolean(collapsedPanels['tools']);

  // QNBS-v3: badge reset clears layout (focus/collapse/flow) AND turns off the Redux-owned
  // ProForge mode, guaranteeing a return to the default 3-column view in one click.
  const handleResetLayout = useCallback(() => {
    resetLayout();
    if (isProForgeActive) dispatch(proForgeActions.setProForgeActive(false));
  }, [resetLayout, isProForgeActive, dispatch]);

  const modeBadge = (
    <WriterModeBadge
      flowMode={flowMode}
      focusMode={focusMode}
      proForgeActive={isProForgeActive}
      contextHidden={contextHidden}
      toolsHidden={toolsHidden}
      onReset={handleResetLayout}
      t={t}
    />
  );

  // X-2: Flow Mode — full-screen AiScratchpad, all panels hidden
  if (flowMode) {
    return (
      <div className="h-full flex flex-col">
        {modeBadge}
        {!seenFlow && (
          <div className="mb-2">
            <WriterModeCoachmark
              title={t('writer.coachmark.flow.title')}
              body={t('writer.coachmark.flow.body')}
              dismissLabel={t('writer.coachmark.dismiss')}
              onDismiss={markFlowSeen}
            />
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--sc-text-muted)]">{t('writer.flowMode.hint')}</span>
          <button
            type="button"
            onClick={toggleFlowMode}
            aria-label={t('writer.flowMode.exit')}
            className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors"
          >
            ⊠ {t('writer.flowMode.exitLabel')}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <AiScratchpad />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {modeBadge}
      {/* Focus Mode Toggle + Panel Controls (Desktop) */}
      <div className="hidden md:flex items-center justify-end mb-2 gap-2">
        {/* QNBS-v3: ProForge pipeline mode toggle — only visible when feature flag is enabled */}
        {isProForgeEnabled && (
          <button
            type="button"
            data-testid="writer-proforge-btn-desktop"
            onClick={() => dispatch(proForgeActions.setProForgeActive(!isProForgeActive))}
            aria-pressed={isProForgeActive}
            aria-label={
              isProForgeActive ? t('proforge.toggle.deactivate') : t('proforge.toggle.activate')
            }
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              isProForgeActive
                ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-ring-focus)]/40 text-[var(--sc-ring-focus)]'
                : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'
            }`}
          >
            {isProForgeActive ? '🔥 ProForge' : 'ProForge'}
          </button>
        )}
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
        {/* X-2: Flow Mode — hides all panels, leaves only AiScratchpad + Esc-to-exit */}
        <button
          type="button"
          onClick={toggleFlowMode}
          title={t('writer.flowMode.title')}
          aria-label={t('writer.flowMode.title')}
          className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors"
        >
          ✦ {t('writer.flowMode.enterLabel')}
        </button>
        {/* QNBS-v3: ARIA + minimum touch target for VC toggle — axe/E2E and mobile Writer stability. */}
        <button
          type="button"
          data-testid="writer-version-control-btn"
          onClick={() => dispatch(versionControlActions.togglePanel())}
          title={t('writer.versionControl.tooltip')}
          aria-label={t('writer.versionControl.label')}
          aria-expanded={isVCPanelOpen}
          className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${isVCPanelOpen ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-accent)]/40 text-[var(--sc-accent)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'}`}
        >
          ⎎ {t('writer.versionControl.label')}
        </button>
      </div>

      {/* QNBS-v3: mobile VC + ProForge buttons — desktop equivalents are hidden md:flex, unreachable on small viewports */}
      <div className="md:hidden flex items-center justify-end mb-1 px-1 gap-2">
        {isProForgeEnabled && (
          <button
            type="button"
            data-testid="writer-proforge-btn-mobile"
            onClick={() => dispatch(proForgeActions.setProForgeActive(!isProForgeActive))}
            aria-pressed={isProForgeActive}
            aria-label={
              isProForgeActive ? t('proforge.toggle.deactivate') : t('proforge.toggle.activate')
            }
            className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${
              isProForgeActive
                ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-accent)]/40 text-[var(--sc-accent)]'
                : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'
            }`}
          >
            {isProForgeActive ? '🔥 ProForge' : 'ProForge'}
          </button>
        )}
        <button
          type="button"
          data-testid="writer-version-control-btn"
          onClick={() => dispatch(versionControlActions.togglePanel())}
          aria-label={t('writer.versionControl.label')}
          aria-expanded={isVCPanelOpen}
          className={`text-xs min-h-[44px] px-3 py-2 rounded border transition-colors touch-manipulation ${isVCPanelOpen ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-accent)]/40 text-[var(--sc-accent)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)]'}`}
        >
          ⎎ {t('writer.versionControl.label')}
        </button>
      </div>

      {/* QNBS-v3: first-use coachmarks for Focus / ProForge — shown once until dismissed */}
      {((focusMode && !seenFocus) || (isProForgeActive && !seenProForge)) && (
        <div className="mb-3 space-y-2">
          {focusMode && !seenFocus && (
            <WriterModeCoachmark
              title={t('writer.coachmark.focus.title')}
              body={t('writer.coachmark.focus.body')}
              dismissLabel={t('writer.coachmark.dismiss')}
              onDismiss={markFocusSeen}
            />
          )}
          {isProForgeActive && !seenProForge && (
            <WriterModeCoachmark
              title={t('writer.coachmark.proforge.title')}
              body={t('writer.coachmark.proforge.body')}
              dismissLabel={t('writer.coachmark.dismiss')}
              onDismiss={markProForgeSeen}
            />
          )}
        </div>
      )}

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
            {tab === 'tools' &&
              (isProForgeActive ? 'ProForge' : t('writer.studio.tools.title').split(' ')[0])}
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
            {isProForgeActive ? <ProForgeDashboard /> : <ToolsPanel />}
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
            {isProForgeActive ? <ProForgeDashboard /> : <ToolsPanel />}
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
