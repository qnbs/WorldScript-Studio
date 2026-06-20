import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import { useCallback, useEffect } from 'react';
import { APP_NAME } from '../constants';
import { useCommandPalette } from '../hooks/useCommandPalette';
import { highlightSubsequence } from '../services/commands/fuzzyScore';
import type { View } from '../types';
import { Icon } from './ui/Icon';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  currentView: View;
}

// QNBS-v3: Estimated row heights for the virtualizer (refined at runtime via measureElement).
const HEADING_ROW_ESTIMATE = 36;
const OPTION_ROW_ESTIMATE = 64;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  currentView,
}) => {
  const {
    t,
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    rows,
    flatItems,
    optionIndexToRowIndex,
    qNorm,
    runCommand,
    togglePin,
    paletteLiveStatus,
    isListening,
    toggleListening,
    isTouchDevice,
    inputRef,
    listRef,
    palettePanelRef,
  } = useCommandPalette({ isOpen, onClose, onNavigate, currentView });

  // QNBS-v3: aria-activedescendant points at the active option's id, but the virtualizer only mounts a
  // windowed subset of rows. If the user scrolls the active option out of view its DOM node would
  // unmount and aria-activedescendant would dangle (AT announces nothing). Force the active row to
  // always stay in the rendered range so its id always resolves.
  const activeRowIndex = optionIndexToRowIndex.get(selectedIndex);
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const base = defaultRangeExtractor(range);
      if (activeRowIndex !== undefined && !base.includes(activeRowIndex)) {
        base.push(activeRowIndex);
        base.sort((a, b) => a - b);
      }
      return base;
    },
    [activeRowIndex],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'heading' ? HEADING_ROW_ESTIMATE : OPTION_ROW_ESTIMATE,
    overscan: 6,
    rangeExtractor,
  });

  // QNBS-v3: keep the keyboard-selected option scrolled into view through the virtual window.
  useEffect(() => {
    if (!isOpen) return;
    const rowIndex = optionIndexToRowIndex.get(selectedIndex);
    if (rowIndex !== undefined) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
  }, [isOpen, selectedIndex, optionIndexToRowIndex, virtualizer]);

  const renderTitle = (title: string) => {
    if (!qNorm) return title;
    const segments = highlightSubsequence(qNorm, title);
    let hlOffset = 0;
    return segments.map((seg) => {
      const key = `hl-${hlOffset}-${seg.match ? 'm' : 'n'}`;
      hlOffset += seg.text.length;
      return seg.match ? (
        <mark key={key} className="bg-[var(--sc-warning-bg)] text-inherit rounded-sc-sm px-0.5">
          {seg.text}
        </mark>
      ) : (
        <span key={key}>{seg.text}</span>
      );
    });
  };

  if (!isOpen) return null;

  // QNBS-v3: pt-2 on mobile so the palette is visible with soft keyboard; pt-[12vh] on larger screens.
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-2 sm:pt-[12vh] px-2 sm:px-4">
      <div
        className="fixed inset-0 bg-[var(--sc-backdrop-strong)] backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={palettePanelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.ariaLabel')}
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-[var(--sc-surface-raised)]/90 backdrop-blur-xl border border-[var(--sc-border-subtle)] shadow-2xl rounded-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none ring-1 ring-[var(--glass-border)] max-h-[95vh] sm:max-h-[85vh]"
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {paletteLiveStatus}
        </div>
        <div className="flex items-center px-4 py-4 border-b border-[var(--sc-border-subtle)]/50">
          <Icon
            name="search"
            size="md"
            className="text-[var(--sc-text-muted)] me-3 shrink-0"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('palette.ariaLabel')}
            aria-activedescendant={
              flatItems[selectedIndex] ? `palette-opt-${selectedIndex}` : undefined
            }
            aria-controls="command-palette-listbox"
            aria-autocomplete="list"
            role="combobox"
            aria-expanded={true}
            className="w-full bg-transparent border-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)] rounded-md text-lg text-[var(--sc-text-primary)] placeholder-[var(--sc-text-muted)] h-10"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: '16px' }}
            // QNBS-v3: on touch devices tabIndex=-1 prevents dialog focus-management from
            // auto-focusing the input (which opens the virtual keyboard). User taps to type.
            tabIndex={isTouchDevice ? -1 : 0}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`me-2 p-2 rounded-lg transition-all duration-200 ${
              isListening
                ? 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] animate-pulse ring-2 ring-[var(--sc-danger-fg)]/50'
                : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-accent)]/20'
            }`}
            title={isListening ? t('palette.voice.stop') : t('palette.voice.start')}
            aria-label={isListening ? t('palette.voice.stop') : t('palette.voice.start')}
            aria-pressed={isListening}
          >
            {isListening ? (
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                />
              </svg>
            ) : (
              <Icon name="microphone" size="md" />
            )}
          </button>
          <div className="hidden sm:flex items-center gap-1">
            {/* QNBS-v3: text-secondary (not -muted) — over the /90 translucent panel, -muted composites to ~4.05:1 in sepia and flakes the axe AA gate; -secondary clears 4.5:1 in every theme and matches the footer kbds. */}
            <kbd className="px-2 py-1 text-xs font-semibold text-[var(--sc-text-secondary)] bg-[var(--sc-surface-overlay)] rounded border border-[var(--sc-border-subtle)]">
              ESC
            </kbd>
          </div>
        </div>

        <div
          id="command-palette-listbox"
          role="listbox"
          aria-label={t('palette.resultsLabel')}
          className="max-h-[min(56vh,420px)] overflow-y-auto p-2 scroll-smooth"
          ref={listRef}
        >
          {flatItems.length === 0 ? (
            <div className="p-8 text-center text-[var(--sc-text-muted)]">
              {t('palette.noResults')}
            </div>
          ) : (
            <div
              style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.key}
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
                    {row.kind === 'heading' ? (
                      <div
                        role="presentation"
                        className="px-3 py-2 text-xs font-semibold text-[var(--sc-text-muted)] uppercase tracking-wider bg-[var(--sc-surface-raised)]/95 backdrop-blur-sm"
                      >
                        {row.label}
                      </div>
                    ) : (
                      (() => {
                        const isActive = row.optionIndex === selectedIndex;
                        const cmd = row.cmd;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            id={`palette-opt-${row.optionIndex}`}
                            data-palette-index={row.optionIndex}
                            onClick={() => runCommand(cmd)}
                            onMouseEnter={() => setSelectedIndex(row.optionIndex)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              togglePin(cmd.id);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-start transition-all duration-150 group ${
                              isActive
                                ? 'bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] shadow-md'
                                : 'text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {/* QNBS-v3: decorative icon — the command label already conveys meaning,
                                  so hide it from AT to avoid a redundant announcement per option. */}
                              <div
                                aria-hidden="true"
                                className={`p-1.5 rounded-md shrink-0 ${isActive ? 'text-[var(--sc-text-on-accent)] bg-[var(--glass-bg-hover)]' : 'text-[var(--sc-text-secondary)] bg-[var(--sc-surface-overlay)] group-hover:bg-[var(--sc-surface-base)]'}`}
                              >
                                {cmd.icon}
                              </div>
                              <div className="min-w-0">
                                <div
                                  className={`font-medium truncate ${isActive ? 'text-[var(--sc-text-on-accent)]' : ''}`}
                                >
                                  {renderTitle(cmd.title)}
                                </div>
                                {row.suggestionReasonKey && !query ? (
                                  <div
                                    className={`text-xs truncate ${isActive ? 'text-[var(--sc-text-on-accent)]' : 'text-[var(--sc-text-muted)]'}`}
                                  >
                                    {t(row.suggestionReasonKey)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {row.isPinned ? (
                                <span
                                  // QNBS-v3: text-[var(--sc-text-on-accent)]/70 fails WCAG AA contrast on --sc-accent background; use full-opacity white.
                                  className={`text-[10px] uppercase tracking-wide ${isActive ? 'text-[var(--sc-text-on-accent)]' : 'text-[var(--sc-text-muted)]'}`}
                                >
                                  {t('palette.pin.badge')}
                                </span>
                              ) : null}
                              {cmd.shortcutDisplay ? (
                                <div className="flex gap-1">
                                  {cmd.shortcutDisplay.map((k) => (
                                    <kbd
                                      key={k}
                                      className={`px-1.5 py-0.5 text-xs rounded border ${isActive ? 'border-[var(--glass-highlight)] bg-[var(--glass-bg-hover)] text-[var(--sc-text-on-accent)]' : 'border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-muted)]'}`}
                                    >
                                      {k}
                                    </kbd>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })()
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* QNBS-v3: text-secondary instead of text-muted — muted (#655c50) fails WCAG AA 4.5:1 on
            the sepia overlay bg; secondary (#5c5346) gives ~5.2:1 across all themes. */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 border-t border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)]/30 text-xs text-[var(--sc-text-secondary)]">
          <div className="flex gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--sc-surface-base)] px-1 rounded border border-[var(--sc-border-subtle)]">
                ↑
              </kbd>
              <kbd className="bg-[var(--sc-surface-base)] px-1 rounded border border-[var(--sc-border-subtle)]">
                ↓
              </kbd>{' '}
              {t('palette.footer.navigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--sc-surface-base)] px-1 rounded border border-[var(--sc-border-subtle)]">
                ↵
              </kbd>{' '}
              {t('palette.footer.select')}
            </span>
            <span>{t('palette.footer.pinHint')}</span>
          </div>
          <span>{APP_NAME}</span>
        </div>
      </div>
    </div>
  );
};
