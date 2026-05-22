import type { FC } from 'react';
import { useCallback } from 'react';
import { BookPreviewContext, useBookPreviewContext } from '../contexts/BookPreviewContext';
import { useBookPreviewView } from '../hooks/useBookPreviewView';
import type { StorySection } from '../types';
import { EmptyState } from './ui/EmptyState';
import { SectionIcon } from './ui/SectionIcon';

// ── TOC Sidebar ──────────────────────────────────────────────────────────────

const TocSidebar: FC = () => {
  const { t, sections, isTocOpen, activeId, scrollToSection, toggleToc } = useBookPreviewContext();
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
              onClick={() => scrollToSection(s.id)}
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
    setFontSize,
    setFontFamily,
    toggleWordCount,
    toggleFullscreen,
    toggleToc,
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
      <select
        value={fontFamily}
        onChange={(e) => setFontFamily(e.target.value)}
        aria-label={t('preview.controls.fontFamily')}
        className="px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]"
      >
        <option value="system-ui">{t('preview.controls.fontSystemUi')}</option>
        <option value="serif">{t('preview.controls.fontSerif')}</option>
        <option value="monospace">{t('preview.controls.fontMono')}</option>
      </select>

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

      {/* Fullscreen */}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={
          isFullscreen ? t('preview.controls.exitFullscreen') : t('preview.controls.fullscreen')
        }
        className="ml-auto px-2 py-1 rounded text-sm border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
      >
        {isFullscreen ? '⊡' : '⊞'}{' '}
        {isFullscreen ? t('preview.controls.exitFullscreen') : t('preview.controls.fullscreen')}
      </button>
    </div>
  );
};

// ── Section Article ───────────────────────────────────────────────────────────

const SectionArticle: FC<{
  section: StorySection;
  refCallback: (el: HTMLElement | null) => void;
}> = ({ section, refCallback }) => {
  const { t, fontSize, fontFamily, showWordCount } = useBookPreviewContext();
  const wordCount = section.content?.trim().split(/\s+/).filter(Boolean).length ?? 0;

  return (
    <article
      id={section.id}
      ref={refCallback}
      aria-label={section.title || t('preview.untitledScene')}
      className="mb-12"
      style={{ fontFamily, fontSize }}
    >
      <h2
        className="text-2xl font-bold mb-4 text-[var(--sc-text-primary)] border-b border-[var(--sc-border-subtle)] pb-2"
        style={{ fontFamily }}
      >
        {section.title || t('preview.untitledScene')}
      </h2>
      {showWordCount && (
        <p className="text-xs text-[var(--sc-text-secondary)] mb-2 text-right">
          {t('preview.wordCount', { count: String(wordCount) })}
        </p>
      )}
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
  const { t, sections, isFullscreen, isTocOpen, sectionRefs } = useBookPreviewContext();
  const refCallback = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) sectionRefs.current.set(id, el);
      else sectionRefs.current.delete(id);
    },
    [sectionRefs],
  );

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
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <TocSidebar />
        <div
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
            sections.map((s) => (
              <SectionArticle key={s.id} section={s} refCallback={refCallback(s.id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const BookPreviewView: FC = () => {
  const contextValue = useBookPreviewView();
  return (
    <BookPreviewContext.Provider value={contextValue}>
      <BookPreviewInner />
    </BookPreviewContext.Provider>
  );
};
