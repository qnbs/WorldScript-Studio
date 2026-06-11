/**
 * CopilotPanel — the Copilot dialog/sidebar with focus trap, Escape-to-close,
 * sidebar/dialog mode toggle (persisted in localStorage), and Apply-to-chapter flow.
 * QNBS-v3: Phase 2 — sidebar mode, markdown rendering, InlineAnnotation Apply bridge.
 */

import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';
import type { View } from '../../types';
import { AiModeIndicator } from './AiModeIndicator';
import { CopilotComposer } from './CopilotComposer';
import { CopilotMessageList } from './CopilotMessageList';
import { HeuristicsModeToggle } from './HeuristicsModeToggle';
import { InsightSection } from './InsightSection';

const MODE_STORAGE_KEY = 'copilot.mode';
type PanelMode = 'dialog' | 'sidebar';

function readMode(): PanelMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'sidebar' ? 'sidebar' : 'dialog';
  } catch {
    return 'dialog';
  }
}

function writeMode(m: PanelMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, m);
  } catch {
    /* quota full — ignore */
  }
}

interface CopilotPanelProps {
  copilot: UseGlobalCopilotReturn;
  contextLabel: string;
  onNavigate?: (view: View) => void;
}

/** The Copilot dialog/sidebar — focus-trapped, Escape-to-close, design-system tokens only. */
export const CopilotPanel: FC<CopilotPanelProps> = ({ copilot, contextLabel, onNavigate }) => {
  const {
    t,
    messages,
    status,
    error,
    suggestions,
    proactiveInsights,
    heuristicsOnly,
    sendMessage,
    close,
    clear,
    toggleHeuristicsOnly,
    applyLastSuggestion,
    applyStatus,
  } = copilot;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<PanelMode>(readMode);
  const activeSectionId = useTransientUiStore((s) => s.activeSectionId);

  useFocusTrap(panelRef, { isActive: true, restoreFocus: true });

  // QNBS-v3: Escape closes the panel (APG dialog pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // QNBS-v3: clicking/tapping outside dismisses the panel. Skip in sidebar mode — the whole
  // right side is the panel; a click elsewhere shouldn't close it.
  useEffect(() => {
    if (mode === 'sidebar') return;
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, mode]);

  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next: PanelMode = m === 'dialog' ? 'sidebar' : 'dialog';
      writeMode(next);
      return next;
    });
  }, []);

  // QNBS-v3: sidebar only on md+ (≥768px); force dialog on small screens.
  const isSidebar =
    mode === 'sidebar' && (typeof window === 'undefined' || window.innerWidth >= 768);

  const panelCls = isSidebar
    ? 'fixed inset-y-0 end-0 z-[90] flex h-full w-80 flex-col border-s border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-2xl'
    : 'fixed bottom-24 end-4 z-[90] flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col rounded-sc-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-2xl';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('copilot.title')}
      className={panelCls}
    >
      <header className="flex items-start justify-between gap-2 border-b border-[var(--sc-border-subtle)] p-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--sc-text-primary)]">
            {t('copilot.title')}
          </h2>
          <p className="text-xs text-[var(--sc-text-muted)]">{contextLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* QNBS-v3: Active AI mode indicator — shows current routing mode at a glance (G9). */}
          <AiModeIndicator />
          {/* QNBS-v3: Heuristics-only toggle — privacy/offline mode. */}
          <HeuristicsModeToggle
            heuristicsOnly={heuristicsOnly}
            onToggle={toggleHeuristicsOnly}
            t={t}
          />
          {/* QNBS-v3: Phase 2 — sidebar/dialog mode toggle (hidden on small screens) */}
          <button
            type="button"
            onClick={toggleMode}
            aria-label={isSidebar ? t('copilot.dialogMode') : t('copilot.sidebarMode')}
            title={isSidebar ? t('copilot.dialogMode') : t('copilot.sidebarMode')}
            className="hidden rounded-sc-lg p-1.5 text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] md:flex"
          >
            {isSidebar ? (
              /* dock→dialog icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-icon-sc-sm w-icon-sc-sm"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M15 3v18" />
              </svg>
            ) : (
              /* float icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-icon-sc-sm w-icon-sc-sm"
                aria-hidden="true"
              >
                <path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={clear}
            aria-label={t('copilot.clear')}
            className="rounded-sc-lg p-1.5 text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-icon-sc-sm w-icon-sc-sm"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 002 2h6a2 2 0 002-2V6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={close}
            aria-label={t('copilot.closeLabel')}
            className="rounded-sc-lg p-1.5 text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-icon-sc-sm w-icon-sc-sm"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      {/* QNBS-v3: Proactive heuristic insights — collapsed by default, expands on user click. */}
      <InsightSection
        insights={proactiveInsights}
        copilot={copilot}
        {...(onNavigate ? { onNavigate } : {})}
      />

      <CopilotMessageList
        messages={messages}
        emptyTitle={t('copilot.emptyTitle')}
        emptyBody={t('copilot.emptyBody')}
        youLabel={t('copilot.you')}
        assistantLabel={t('copilot.assistant')}
        applyLabel={t('copilot.apply')}
        applyingLabel={t('copilot.applyingChange')}
        hasActiveSection={activeSectionId !== null}
        onApply={applyLastSuggestion}
        applyStatus={applyStatus}
      />

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => sendMessage(s)}
              className="rounded-sc-lg border border-[var(--sc-border-subtle)] px-2.5 py-1 text-xs text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="px-4 pb-1 text-xs text-[var(--sc-danger-fg)]" role="alert">
          {t('copilot.error')}
        </p>
      )}

      {/* QNBS-v3: show apply feedback below composer */}
      {applyStatus === 'success' && (
        <p className="px-4 pb-1 text-xs text-[var(--sc-success-fg)]" role="status">
          {t('copilot.changeApplied')}
        </p>
      )}
      {applyStatus === 'error' && (
        <p className="px-4 pb-1 text-xs text-[var(--sc-danger-fg)]" role="alert">
          {t('copilot.changeApplyFailed')}
        </p>
      )}

      <CopilotComposer
        placeholder={t('copilot.placeholder')}
        sendLabel={t('copilot.send')}
        isStreaming={status === 'streaming'}
        onSend={sendMessage}
      />
    </div>
  );
};
