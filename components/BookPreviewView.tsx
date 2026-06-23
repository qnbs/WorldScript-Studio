import { useVirtualizer } from '@tanstack/react-virtual';
import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookPreviewContext, useBookPreviewContext } from '../contexts/BookPreviewContext';
import { useBookPreviewView } from '../hooks/useBookPreviewView';
import type { StorySection, View } from '../types';
import { EmptyState } from './ui/EmptyState';
import { SectionIcon } from './ui/SectionIcon';
import { Select } from './ui/Select';

// ── TOC Sidebar ──────────────────────────────────────────────────────────────

// QNBS-v3: activeId/onScrollTo are component-local (driven by the virtualizer's scroll), not the
// hook — so they're passed as props rather than threaded through the context.
const TocSidebar: FC<{ activeId: string | null; onScrollTo: (id: string) => void }> = ({
  activeId,
  onScrollTo,
}) => {
  const { t, sections, isTocOpen, toggleToc } = useBookPreviewContext();
  if (!isTocOpen) return null;
  return (
    <nav
      aria-label={t('preview.toc.ariaLabel')}
      className="fixed top-14 left-0 z-30 w-56 h-[calc(100%-3.5rem)] overflow-y-auto bg-[var(--sc-surface-raised)] border-r border-[var(--sc-border-subtle)] p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide">
          {t('preview.toc.title')}
        </span>
        <button
          type="button"
          onClick={toggleToc}
          aria-label={t('preview.toc.close')}
          className="p-1 rounded hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]"
        >
          ✕
        </button>
      </div>
      <ul className="space-y-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onScrollTo(s.id)}
              aria-current={activeId === s.id ? 'true' : undefined}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors truncate ${
                activeId === s.id
                  ? 'bg-[var(--sc-accent)] text-[white]'
                  : 'text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)]'
              }`}
            >
              {s.title || t('preview.untitledScene')}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

// ── Controls Bar ─────────────────────────────────────────────────────────────

const ControlsBar: FC = () => {
  const {
    t,
    fontSize,
    fontFamily,
    showWordCount,
    isFullscreen,
    isTocOpen,
    isPaginated,
    setFontSize,
    setFontFamily,
    toggleWordCount,
    toggleFullscreen,
    toggleToc,
    togglePaginated,
    onExport,
  } = useBookPreviewContext();

  return (
    <div
      role="toolbar"
      aria-label={t('preview.controls.ariaLabel')}
      className="flex items-center gap-3 flex-wrap p-3 border-b border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
    >
      {/* TOC toggle */}
      <button
        type="button"
        onClick={toggleToc}
        aria-label={t('preview.toc.toggle')}
        aria-pressed={isTocOpen}
        className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        ☰ {t('preview.toc.title')}
      </button>

      {/* Font size */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setFontSize(fontSize - 1)}
          aria-label={t('preview.controls.decreaseFontSize')}
          className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
        >
          A-
        </button>
        <span className="text-xs text-[var(--sc-text-secondary)] w-8 text-center">{fontSize}</span>
        <button
          type="button"
          onClick={() => setFontSize(fontSize + 1)}
          aria-label={t('preview.controls.increaseFontSize')}
          className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
        >
          A+
        </button>
      </div>

      {/* Font family */}
      <Select
        value={fontFamily}
        onChange={(v) => setFontFamily(v)}
        ariaLabel={t('preview.controls.fontFamily')}
        options={[
          { value: 'system-ui', label: t('preview.controls.fontSystemUi') },
          { value: 'serif', label: t('preview.controls.fontSerif') },
          { value: 'monospace', label: t('preview.controls.fontMono') },
        ]}
      />

      {/* Word count toggle */}
      <button
        type="button"
        onClick={toggleWordCount}
        aria-pressed={showWordCount}
        aria-label={t('preview.controls.wordCount')}
        className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        {t('preview.controls.wordCount')}
      </button>

      {/* Paged reading mode toggle */}
      <button
        type="button"
        onClick={togglePaginated}
        aria-pressed={isPaginated}
        aria-label={t('preview.controls.pagedMode')}
        className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        {t('preview.controls.pagedMode')}
      </button>

      {/* Export → Export view (EPUB) */}
      <button
        type="button"
        onClick={onExport}
        aria-label={t('preview.controls.export')}
        className="ml-auto px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        {t('preview.controls.export')}
      </button>

      {/* Fullscreen */}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={
          isFullscreen ? t('preview.controls.exitFullscreen') : t('preview.controls.fullscreen')
        }
        className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        {isFullscreen ? '⊡' : '⊞'}{' '}
        {isFullscreen ? t('preview.controls.exitFullscreen') : t('preview.controls.fullscreen')}
      </button>
    </div>
  );
};

// ── Section Article ───────────────────────────────────────────────────────────

const SectionArticle: FC<{ section: StorySection }> = ({ section }) => {
  const { t, fontSize, fontFamily, showWordCount, isPaginated } = useBookPreviewContext();
  const wordCount = section.content?.trim().split(/\s+/).filter(Boolean).length ?? 0;

  return (
    <article
      id={section.id}
      aria-label={section.title || t('preview.untitledScene')}
      className={
        isPaginated
          ? 'mb-8 mx-auto max-w-[760px] bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] shadow-sc-xl rounded-sc-lg px-8 py-10'
          : 'mb-12'
      }
      style={{ fontFamily, fontSize }}
    >
      {/* QNBS-v3: heading row doubles as the margin annotation gutter for the per-section word count. */}
      <div className="flex items-baseline justify-between gap-4 mb-4 border-b border-[var(--sc-border-subtle)] pb-2">
        <h2 className="text-2xl font-bold text-[var(--sc-text-primary)]" style={{ fontFamily }}>
          {section.title || t('preview.untitledScene')}
        </h2>
        {showWordCount && (
          <span className="shrink-0 text-xs text-[var(--sc-text-muted)] tabular-nums">
            {t('preview.wordCount', { count: String(wordCount) })}
          </span>
        )}
      </div>
      <div
        className="whitespace-pre-wrap leading-relaxed text-[var(--sc-text-primary)]"
        style={{ maxWidth: '70ch', lineHeight: 1.8 }}
      >
        {section.content || (
          <em className="text-[var(--sc-text-secondary)]">{t('preview.emptyScene')}</em>
        )}
      </div>
    </article>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const BookPreviewInner: FC = () => {
  const { t, sections, isFullscreen, isTocOpen } = useBookPreviewContext();

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const [progress, setProgress] = useState(0);

  // QNBS-v3: variable-height virtualization — only on-screen sections are in the DOM, which keeps
  // very long manuscripts responsive (the old plain .map() rendered every section at once).
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 600,
    overscan: 4,
  });

  // QNBS-v3: scroll-driven reading progress + active-chapter highlight, computed from the virtualizer
  // window. This replaces the previous IntersectionObserver, which observed an empty ref map on the
  // first commit (empty-deps effect) and so never tracked scrolling reliably.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const max = scrollHeight - clientHeight;
    setProgress(max > 0 ? Math.min(100, Math.max(0, (scrollTop / max) * 100)) : 0);

    const line = scrollTop + clientHeight * 0.25;
    const items = virtualizer.getVirtualItems();
    let activeIndex = items[0]?.index ?? 0;
    for (const item of items) {
      if (item.start <= line) activeIndex = item.index;
      else break;
    }
    const section = sections[activeIndex];
    if (section) setActiveId(section.id);
  }, [virtualizer, sections]);

  const scrollToSection = useCallback(
    (id: string) => {
      const index = sections.findIndex((s) => s.id === id);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
        setActiveId(id);
      }
    },
    [sections, virtualizer],
  );

  // QNBS-v3 (CodeAnt): progress + active-chapter were only recomputed inside onScroll, so non-scroll
  // changes left them stale. A ResizeObserver on the content recomputes whenever its height changes —
  // which covers font-size/family, the paged toggle, the word-count gutter, and section add/remove —
  // without listing layout values that the effect body never reads. Re-attaches when handleScroll
  // changes (its identity tracks `sections`), so it also binds once the content first mounts.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => handleScroll());
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleScroll]);

  return (
    <div
      className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-[var(--sc-surface-base)]' : 'h-full'}`}
    >
      <div className="flex items-center gap-2 p-4 border-b border-[var(--sc-border-subtle)]">
        <SectionIcon section="preview" size="sm" />
        <h1 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {t('preview.title')}
        </h1>
      </div>
      <ControlsBar />
      {/* Reading progress bar */}
      <div
        role="progressbar"
        aria-label={t('preview.progress.ariaLabel')}
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 bg-[var(--sc-surface-overlay)] shrink-0"
      >
        <div
          className="h-full bg-[var(--sc-accent)] transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <TocSidebar activeId={activeId} onScrollTo={scrollToSection} />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          aria-live="off"
          className={`flex-1 overflow-y-auto p-6 sm:p-10 ${isTocOpen ? 'ml-56' : ''}`}
        >
          {sections.length === 0 ? (
            <div className="mt-12">
              <EmptyState
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-10 h-10"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                    />
                  </svg>
                }
                title={t('preview.noScenes')}
                description={t('preview.noScenesHint')}
              />
            </div>
          ) : (
            <div
              ref={contentRef}
              style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const section = sections[virtualRow.index];
                if (!section) return null;
                return (
                  <div
                    key={section.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <SectionArticle section={section} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const BookPreviewView: FC<{ onNavigate?: (view: View) => void }> = ({ onNavigate }) => {
  const contextValue = useBookPreviewView(onNavigate);
  return (
    <BookPreviewContext.Provider value={contextValue}>
      <BookPreviewInner />
    </BookPreviewContext.Provider>
  );
};
