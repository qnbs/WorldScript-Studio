import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { Language } from '../contexts/I18nContext';
import { selectFeatureFlags } from '../features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useTranslation } from '../hooks/useTranslation';
import { getLocalAiSuggestions } from '../services/commands/aiSuggestions';
import { buildPaletteCommandModels } from '../services/commands/commandBuilder';
import type { CommandCategory, PaletteCommandModel } from '../services/commands/commandTypes';
import { getEffectiveTheme } from '../services/commands/effectiveTheme';
import {
  highlightSubsequence,
  normalizeSearch,
  scoreAgainstQuery,
} from '../services/commands/fuzzyScore';
import {
  loadPalettePreferences,
  recordRecentCommand,
  togglePinnedCommand,
} from '../services/commands/palettePreferences';
import { approximateManuscriptWordCount } from '../services/commands/wordCountApprox';
import type { View } from '../types';

const CATEGORY_SORT: CommandCategory[] = [
  'navigation',
  'global',
  'editor',
  'projectManagement',
  'aiActions',
  'settings',
  'help',
  'customUser',
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  currentView: View;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  currentView,
}) => {
  const { t, language, setLanguage } = useTranslation();
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);
  const project = useAppSelector(selectProjectData);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const featureFlags = useAppSelector(selectFeatureFlags);
  const { isListening, transcript, toggleListening, stopListening, setTranscript } =
    useSpeechRecognition();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pinTick, setPinTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const palettePanelRef = useRef<HTMLDivElement>(null);
  const [paletteLiveStatus, setPaletteLiveStatus] = useState('');

  useFocusTrap(palettePanelRef, { isActive: isOpen });

  const isTouchDevice = useMemo(
    () =>
      typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
    [],
  );

  const effectiveTheme = useMemo(() => getEffectiveTheme(settings.theme), [settings.theme]);

  const wordCountApprox = useMemo(() => approximateManuscriptWordCount(project), [project]);

  const runtimeDeps = useMemo(
    () => ({
      dispatch,
      navigate: onNavigate,
      setLanguage: (lang: Language) => setLanguage(lang),
      t,
      theme: effectiveTheme,
      language,
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      worlds: worlds.map((w) => ({ id: w.id, name: w.name })),
      currentView,
      wordCountApprox,
      featureFlags,
    }),
    [
      dispatch,
      onNavigate,
      setLanguage,
      t,
      effectiveTheme,
      language,
      characters,
      worlds,
      currentView,
      wordCountApprox,
      featureFlags,
    ],
  );

  const baseModels = useMemo(() => buildPaletteCommandModels(runtimeDeps), [runtimeDeps]);

  useEffect(() => {
    if (transcript && isOpen) {
      setQuery(transcript);
      setTranscript('');
    }
  }, [transcript, isOpen, setTranscript]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      if (!isTouchDevice) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      if (isListening) stopListening();
    }
  }, [isOpen, isListening, stopListening, isTouchDevice]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pinTick` only exists to invalidate cached prefs after pin/unpin writes to storage
  const prefs = useMemo(() => loadPalettePreferences(), [pinTick]);

  const suggestionEntries = useMemo(() => {
    const sug = getLocalAiSuggestions(runtimeDeps);
    return sug
      .map((s) => {
        const m = baseModels.find((x) => x.id === s.id);
        return m ? { model: m, reasonKey: s.reasonKey } : null;
      })
      .filter((x): x is { model: PaletteCommandModel; reasonKey: string } => x != null);
  }, [baseModels, runtimeDeps]);

  const sortedCommands = useMemo(() => {
    const qn = normalizeSearch(query);
    const pinnedSet = new Set(prefs.pinnedIds);
    const recentOrder = new Map(prefs.recentIds.map((id, i) => [id, i]));

    const boost = (m: PaletteCommandModel): number => {
      let b = 0;
      if (pinnedSet.has(m.id)) b += 400;
      const ri = recentOrder.get(m.id);
      if (ri !== undefined) b += (50 - ri) * 2;
      return b;
    };

    if (!qn) {
      const catRank = (c: CommandCategory) => CATEGORY_SORT.indexOf(c);
      return [...baseModels].sort((a, b) => {
        const ap = pinnedSet.has(a.id);
        const bp = pinnedSet.has(b.id);
        if (ap !== bp) return ap ? -1 : 1;
        const ar = recentOrder.get(a.id) ?? 999;
        const br = recentOrder.get(b.id) ?? 999;
        if (ar !== br) return ar - br;
        const cc = catRank(a.category) - catRank(b.category);
        if (cc !== 0) return cc;
        return a.title.localeCompare(b.title);
      });
    }

    return baseModels
      .map((m) => {
        const textScore = scoreAgainstQuery(qn, m.title, m.keywords.join(' '), m.categoryLabel);
        const total = textScore > 0 ? textScore + boost(m) : 0;
        return { m, total };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((x) => x.m);
  }, [baseModels, query, prefs.pinnedIds, prefs.recentIds]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlighted row whenever the search query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, sortedCommands.length - 1)));
  }, [sortedCommands.length]);

  const flatList = useMemo(() => {
    if (!query) {
      const pinned = sortedCommands.filter((c) => prefs.pinnedIds.includes(c.id));
      const recentIds = prefs.recentIds.filter((id) => !prefs.pinnedIds.includes(id));
      const recent = recentIds
        .map((id) => sortedCommands.find((c) => c.id === id))
        .filter((c): c is PaletteCommandModel => c != null);
      const sugIds = new Set(suggestionEntries.map((s) => s.model.id));
      const rest = sortedCommands.filter(
        (c) => !prefs.pinnedIds.includes(c.id) && !recentIds.includes(c.id) && !sugIds.has(c.id),
      );
      const blocks: { heading?: string; items: PaletteCommandModel[] }[] = [];
      if (suggestionEntries.length) {
        blocks.push({
          heading: t('palette.section.suggestions'),
          items: suggestionEntries.map((s) => s.model),
        });
      }
      if (pinned.length) blocks.push({ heading: t('palette.section.pinned'), items: pinned });
      if (recent.length) blocks.push({ heading: t('palette.section.recent'), items: recent });
      if (rest.length) blocks.push({ heading: t('palette.section.allCommands'), items: rest });
      return blocks;
    }

    const grouped = sortedCommands.reduce((acc, cmd) => {
      const cat = cmd.categoryLabel;
      const bucket = acc.get(cat);
      if (bucket) bucket.push(cmd);
      else acc.set(cat, [cmd]);
      return acc;
    }, new Map<string, PaletteCommandModel[]>());

    return [...grouped.entries()].map(([heading, items]) => ({ heading, items }));
  }, [query, sortedCommands, prefs.pinnedIds, prefs.recentIds, suggestionEntries, t]);

  const flatItems = useMemo(() => {
    let seq = 0;
    return flatList.flatMap((b) =>
      b.items.map((item) => {
        seq += 1;
        const headingKey = b.heading ?? '';
        return {
          item,
          heading: b.heading,
          rowKey: `${item.id}-${headingKey}-${seq}`,
        };
      }),
    );
  }, [flatList]);

  const runCommand = useCallback(
    (cmd: PaletteCommandModel) => {
      recordRecentCommand(cmd.id);
      cmd.run();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      // QNBS-v3: Escape + Enter must work on all devices (ARIA modal requirement + command execution);
      // Arrow navigation skipped on touch devices to avoid conflicts with native mobile browser behaviour.
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = flatItems[selectedIndex]?.item;
        if (row) runCommand(row);
        return;
      }
      if (isTouchDevice) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(flatItems.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + Math.max(flatItems.length, 1)) % Math.max(flatItems.length, 1),
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isTouchDevice, flatItems, selectedIndex, runCommand, onClose]);

  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.querySelector(`[data-palette-index="${selectedIndex}"]`);
      if (activeItem instanceof HTMLElement) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // QNBS-v3: aria-live für Spracheingabe (Priorität) und Trefferzahl.
  useEffect(() => {
    if (!isOpen) {
      setPaletteLiveStatus('');
      return;
    }
    if (isListening) {
      setPaletteLiveStatus(t('palette.voice.listeningLive'));
      return;
    }
    const qn = normalizeSearch(query);
    if (flatItems.length === 0 && qn) {
      setPaletteLiveStatus(t('palette.noResults'));
      return;
    }
    setPaletteLiveStatus(t('palette.resultsLive', { count: String(flatItems.length) }));
  }, [isOpen, isListening, query, flatItems.length, t]);

  const qNorm = normalizeSearch(query);

  const renderTitle = (title: string) => {
    if (!qNorm) return title;
    const segments = highlightSubsequence(qNorm, title);
    let hlOffset = 0;
    return segments.map((seg) => {
      const key = `hl-${hlOffset}-${seg.match ? 'm' : 'n'}`;
      hlOffset += seg.text.length;
      return seg.match ? (
        <mark
          key={key}
          className="bg-amber-400/40 dark:bg-amber-300/25 text-inherit rounded px-0.5"
        >
          {seg.text}
        </mark>
      ) : (
        <span key={key}>{seg.text}</span>
      );
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
      <div
        className="fixed inset-0 bg-[var(--overlay-backdrop)] backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={palettePanelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.ariaLabel')}
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-[var(--background-secondary)]/90 backdrop-blur-xl border border-[var(--border-primary)] shadow-2xl rounded-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 ring-1 ring-[var(--glass-border)] max-h-[85vh]"
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {paletteLiveStatus}
        </div>
        <div className="flex items-center px-4 py-4 border-b border-[var(--border-primary)]/50">
          <svg
            className="w-5 h-5 text-[var(--foreground-muted)] mr-3 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 001.061 1.061z"
            />
          </svg>
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
            className="w-full bg-transparent border-none focus:ring-0 text-lg text-[var(--foreground-primary)] placeholder-[var(--foreground-muted)] h-10"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: '16px' }}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`mr-2 p-2 rounded-lg transition-all duration-200 ${
              isListening
                ? 'bg-red-500/20 text-red-400 animate-pulse ring-2 ring-red-500/50'
                : 'bg-[var(--background-tertiary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-interactive)]/20'
            }`}
            title={isListening ? t('palette.voice.stop') : t('palette.voice.start')}
            aria-label={isListening ? t('palette.voice.stop') : t('palette.voice.start')}
            aria-pressed={isListening}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              {isListening ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                />
              )}
            </svg>
          </button>
          <div className="hidden sm:flex items-center gap-1">
            <kbd className="px-2 py-1 text-xs font-semibold text-[var(--foreground-muted)] bg-[var(--background-tertiary)] rounded border border-[var(--border-primary)]">
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
            <div className="p-8 text-center text-[var(--foreground-muted)]">
              {t('palette.noResults')}
            </div>
          ) : (
            (() => {
              let visualIndex = 0;
              return flatList.map((block) => {
                const blockKey = `${block.heading ?? '__flat__'}:${block.items.map((c) => c.id).join('|')}`;
                const headingId = block.heading
                  ? `palette-sec-${block.items.map((c) => c.id).join('-')}`.replace(
                      /[^a-zA-Z0-9_-]/g,
                      '_',
                    )
                  : undefined;
                const headingNode =
                  block.heading && headingId ? (
                    <div
                      key={headingId}
                      id={headingId}
                      role="presentation"
                      className="px-3 py-2 text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider sticky top-0 bg-[var(--background-secondary)]/95 backdrop-blur-sm z-10"
                    >
                      {block.heading}
                    </div>
                  ) : null;

                const optionButtons = block.items.map((cmd) => {
                  const vi = visualIndex;
                  visualIndex += 1;
                  const isActive = vi === selectedIndex;
                  const sug = suggestionEntries.find((s) => s.model.id === cmd.id);
                  const rowKey = `${cmd.id}-${blockKey}-${vi}`;

                  return (
                    <button
                      key={rowKey}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      id={`palette-opt-${vi}`}
                      data-palette-index={vi}
                      onClick={() => runCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(vi)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        togglePinnedCommand(cmd.id);
                        setPinTick((x) => x + 1);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-all duration-150 group ${
                        isActive
                          ? 'bg-[var(--background-interactive)] text-white shadow-md'
                          : 'text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`p-1.5 rounded-md shrink-0 ${isActive ? 'text-white bg-[var(--glass-bg-hover)]' : 'text-[var(--foreground-secondary)] bg-[var(--background-tertiary)] group-hover:bg-[var(--background-primary)]'}`}
                        >
                          {cmd.icon}
                        </div>
                        <div className="min-w-0">
                          <div className={`font-medium truncate ${isActive ? 'text-white' : ''}`}>
                            {renderTitle(cmd.title)}
                          </div>
                          {sug && !query ? (
                            <div
                              className={`text-xs truncate ${isActive ? 'text-white/80' : 'text-[var(--foreground-muted)]'}`}
                            >
                              {t(sug.reasonKey)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {prefs.pinnedIds.includes(cmd.id) ? (
                          <span
                            className={`text-[10px] uppercase tracking-wide ${isActive ? 'text-white/70' : 'text-[var(--foreground-muted)]'}`}
                          >
                            {t('palette.pin.badge')}
                          </span>
                        ) : null}
                        {cmd.shortcutDisplay ? (
                          <div className="flex gap-1">
                            {cmd.shortcutDisplay.map((k) => (
                              <kbd
                                key={k}
                                className={`px-1.5 py-0.5 text-xs rounded border ${isActive ? 'border-[var(--glass-highlight)] bg-[var(--glass-bg-hover)] text-white' : 'border-[var(--border-primary)] bg-[var(--background-primary)] text-[var(--foreground-muted)]'}`}
                              >
                                {k}
                              </kbd>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                });

                const groupProps =
                  block.heading && headingId
                    ? { role: 'group' as const, 'aria-labelledby': headingId }
                    : {};

                return (
                  <div key={`palette-block-${blockKey}`} {...groupProps}>
                    {headingNode}
                    {optionButtons}
                  </div>
                );
              });
            })()
          )}
        </div>

        <div className="hidden sm:flex items-center justify-between px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--background-tertiary)]/30 text-xs text-[var(--foreground-muted)]">
          <div className="flex gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--background-primary)] px-1 rounded border border-[var(--border-primary)]">
                ↑
              </kbd>
              <kbd className="bg-[var(--background-primary)] px-1 rounded border border-[var(--border-primary)]">
                ↓
              </kbd>{' '}
              {t('palette.footer.navigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--background-primary)] px-1 rounded border border-[var(--border-primary)]">
                ↵
              </kbd>{' '}
              {t('palette.footer.select')}
            </span>
            <span>{t('palette.footer.pinHint')}</span>
          </div>
          <span>StoryCraft Studio</span>
        </div>
      </div>
    </div>
  );
};
