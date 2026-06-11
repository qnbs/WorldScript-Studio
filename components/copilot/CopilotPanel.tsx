import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';
import type { View } from '../../types';
import { CopilotComposer } from './CopilotComposer';
import { CopilotMessageList } from './CopilotMessageList';
import { HeuristicsModeToggle } from './HeuristicsModeToggle';
import { InsightSection } from './InsightSection';

interface CopilotPanelProps {
  copilot: UseGlobalCopilotReturn;
  contextLabel: string;
  onNavigate?: (view: View) => void;
}

/** The Copilot dialog — focus-trapped, Escape-to-close, design-system tokens only. */
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
  } = copilot;
  const panelRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(panelRef, { isActive: true, restoreFocus: true });

  // QNBS-v3: Escape closes the panel (APG dialog pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // QNBS-v3: clicking/tapping outside the panel dismisses it ("click away to close"). No blocking
  // backdrop — the assistant is non-blocking, so the rest of the app stays interactive. The listener
  // is attached after mount, so the pointerdown that opened the panel has already fired (no instant close).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('copilot.title')}
      className="fixed bottom-24 right-4 z-[90] flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col rounded-sc-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-2xl"
    >
      <header className="flex items-start justify-between gap-2 border-b border-[var(--sc-border-subtle)] p-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--sc-text-primary)]">
            {t('copilot.title')}
          </h2>
          <p className="text-xs text-[var(--sc-text-muted)]">{contextLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          {/* QNBS-v3: Heuristics-only toggle — privacy/offline mode. */}
          <HeuristicsModeToggle
            heuristicsOnly={heuristicsOnly}
            onToggle={toggleHeuristicsOnly}
            t={t}
          />
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
              className="w-icon-sc-sm h-icon-sc-sm"
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
              className="w-icon-sc-sm h-icon-sc-sm"
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
        // QNBS-v3: exactOptionalPropertyTypes — only spread when defined.
        {...(onNavigate ? { onNavigate } : {})}
      />

      <CopilotMessageList
        messages={messages}
        emptyTitle={t('copilot.emptyTitle')}
        emptyBody={t('copilot.emptyBody')}
        youLabel={t('copilot.you')}
        assistantLabel={t('copilot.assistant')}
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

      <CopilotComposer
        placeholder={t('copilot.placeholder')}
        sendLabel={t('copilot.send')}
        isStreaming={status === 'streaming'}
        onSend={sendMessage}
      />
    </div>
  );
};
