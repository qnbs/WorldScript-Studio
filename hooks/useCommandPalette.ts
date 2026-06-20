// QNBS-v3: Business logic + derived state for CommandPalette, extracted so the component is
// purely presentational. Also produces a FLAT row model (heading | option) for virtualization
// while keeping `flatItems` (options only) as the keyboard-navigation index space.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { Language } from '../contexts/I18nContext';
import { selectFeatureFlags } from '../features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { getLocalAiSuggestions } from '../services/commands/aiSuggestions';
import { buildPaletteCommandModels } from '../services/commands/commandBuilder';
import type { CommandCategory, PaletteCommandModel } from '../services/commands/commandTypes';
import { getEffectiveTheme } from '../services/commands/effectiveTheme';
import { normalizeSearch, scoreAgainstQuery } from '../services/commands/fuzzyScore';
import {
  loadPalettePreferences,
  recordRecentCommand,
  togglePinnedCommand,
} from '../services/commands/palettePreferences';
import { approximateManuscriptWordCount } from '../services/commands/wordCountApprox';
import type { View } from '../types';
import { useFocusTrap } from './useFocusTrap';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useTranslation } from './useTranslation';

const CATEGORY_SORT: CommandCategory[] = [
  'navigation',
  'global',
  'editor',
  'projectManagement',
  'aiActions',
  'settings',
  'appearance',
  'accessibility',
  'help',
  'customUser',
];

/** A single virtualizable row: a sticky section heading or a selectable command option. */
export type PaletteRow =
  | { kind: 'heading'; key: string; label: string }
  | {
      kind: 'option';
      key: string;
      cmd: PaletteCommandModel;
      optionIndex: number;
      isPinned: boolean;
      suggestionReasonKey?: string;
    };

interface UseCommandPaletteArgs {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  currentView: View;
}

export function useCommandPalette({
  isOpen,
  onClose,
  onNavigate,
  currentView,
}: UseCommandPaletteArgs) {
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
  const [paletteLiveStatus, setPaletteLiveStatus] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const palettePanelRef = useRef<HTMLDivElement>(null);

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
      aiMode: settings.aiMode,
      openRouterEnabled: settings.openRouter?.enabled ?? false,
      appearancePreset: settings.appearancePreset,
      advancedEditor: {
        distractionFree: settings.advancedEditor.distractionFree,
        typewriterMode: settings.advancedEditor.typewriterMode,
        zenMode: settings.advancedEditor.zenMode,
        focusMode: settings.advancedEditor.focusMode,
      },
      accessibility: {
        highContrast: settings.accessibility.highContrast,
        reducedMotion: settings.accessibility.reducedMotion,
        largeText: settings.accessibility.largeText,
      },
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
      settings.aiMode,
      settings.openRouter?.enabled,
      settings.appearancePreset,
      settings.advancedEditor,
      settings.accessibility,
    ],
  );

  const baseModels = useMemo(() => buildPaletteCommandModels(runtimeDeps), [runtimeDeps]);

  useEffect(() => {
    if (transcript && isOpen) {
      setQuery(transcript);
      setTranscript('');
    }
  }, [transcript, isOpen, setTranscript]);

  // QNBS-v3: reset + focus + scroll-lock strictly on OPEN/CLOSE transitions. Deliberately does NOT
  // depend on isListening — otherwise toggling the mic while the palette is open re-runs this and
  // wipes the user's query/selection. The focus timer is tracked and cleared so a stale timeout can't
  // fire after close and steal focus.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      document.body.style.overflow = 'hidden';
      let focusTimer: ReturnType<typeof setTimeout> | undefined;
      if (!isTouchDevice) {
        focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
      }
      return () => {
        if (focusTimer !== undefined) clearTimeout(focusTimer);
      };
    }
    document.body.style.overflow = '';
    return undefined;
  }, [isOpen, isTouchDevice]);

  // QNBS-v3: stop the mic when the palette closes — separated from the reset effect above so a mic
  // toggle while open doesn't trigger a query/selection reset.
  useEffect(() => {
    if (!isOpen && isListening) stopListening();
  }, [isOpen, isListening, stopListening]);

  // QNBS-v3: `pinTick` + `isOpen` are invalidation ticks, not memo inputs — `pinTick` reloads prefs
  // after pin/unpin writes; `isOpen` reloads them on each open so recents recorded by
  // recordRecentCommand (which doesn't bump `pinTick`) aren't stale on reopen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinTick/isOpen are storage-invalidation ticks, intentionally driving the reload
  const prefs = useMemo(() => loadPalettePreferences(), [pinTick, isOpen]);

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

  const flatList = useMemo(() => {
    if (!query) {
      const pinnedSet = new Set(prefs.pinnedIds);
      const pinned = sortedCommands.filter((c) => pinnedSet.has(c.id));
      const recentIds = prefs.recentIds.filter((id) => !pinnedSet.has(id));
      const recentSet = new Set(recentIds);
      const recent = recentIds
        .map((id) => sortedCommands.find((c) => c.id === id))
        .filter((c): c is PaletteCommandModel => c != null);
      // QNBS-v3: a command can be suggested AND pinned/recent — dedupe so it appears once. Suggestions
      // yield to the pinned/recent sections; only the leftovers render under "Suggestions".
      const visibleSuggestions = suggestionEntries.filter(
        (s) => !pinnedSet.has(s.model.id) && !recentSet.has(s.model.id),
      );
      const sugIds = new Set(visibleSuggestions.map((s) => s.model.id));
      const rest = sortedCommands.filter(
        (c) => !pinnedSet.has(c.id) && !recentSet.has(c.id) && !sugIds.has(c.id),
      );
      const blocks: { heading?: string; items: PaletteCommandModel[] }[] = [];
      if (visibleSuggestions.length) {
        blocks.push({
          heading: t('palette.section.suggestions'),
          items: visibleSuggestions.map((s) => s.model),
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

  // QNBS-v3: Flatten blocks into a single virtualizable row list. Options carry `optionIndex`
  // (their position in `flatItems`) so keyboard nav + aria-activedescendant indices are stable
  // regardless of how the virtualizer windows the DOM.
  const { rows, flatItems } = useMemo(() => {
    const rowList: PaletteRow[] = [];
    const optionList: { item: PaletteCommandModel; heading?: string }[] = [];
    const pinnedSet = new Set(prefs.pinnedIds);
    const sugById = new Map(suggestionEntries.map((s) => [s.model.id, s.reasonKey]));
    let optionIndex = 0;
    for (const block of flatList) {
      if (block.heading) {
        rowList.push({
          kind: 'heading',
          key: `heading-${block.heading}-${block.items.map((c) => c.id).join('|')}`,
          label: block.heading,
        });
      }
      for (const cmd of block.items) {
        const reasonKey = !query ? sugById.get(cmd.id) : undefined;
        rowList.push({
          kind: 'option',
          key: `${cmd.id}-${block.heading ?? '__flat__'}-${optionIndex}`,
          cmd,
          optionIndex,
          isPinned: pinnedSet.has(cmd.id),
          ...(reasonKey !== undefined && { suggestionReasonKey: reasonKey }),
        });
        optionList.push({
          item: cmd,
          ...(block.heading !== undefined && { heading: block.heading }),
        });
        optionIndex += 1;
      }
    }
    return { rows: rowList, flatItems: optionList };
  }, [flatList, prefs.pinnedIds, suggestionEntries, query]);

  // QNBS-v3: Map an option's keyboard index back to its row index so the virtualizer can scroll it
  // into view (rows include non-selectable headings, so the two index spaces differ).
  const optionIndexToRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, rowIdx) => {
      if (row.kind === 'option') map.set(row.optionIndex, rowIdx);
    });
    return map;
  }, [rows]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  const runCommand = useCallback(
    (cmd: PaletteCommandModel) => {
      recordRecentCommand(cmd.id);
      cmd.run();
      onClose();
    },
    [onClose],
  );

  // QNBS-v3: pinning reorders the list, so a bare numeric selectedIndex would afterwards point at a
  // different command (Enter could run the wrong one). Capture the currently highlighted command's id
  // before the reorder and remap selection back to it once the list recomputes.
  const pendingSelectIdRef = useRef<string | null>(null);
  const togglePin = useCallback(
    (id: string) => {
      pendingSelectIdRef.current = flatItems[selectedIndex]?.item.id ?? null;
      togglePinnedCommand(id);
      setPinTick((x) => x + 1);
    },
    [flatItems, selectedIndex],
  );

  useEffect(() => {
    const pendingId = pendingSelectIdRef.current;
    if (pendingId == null) return;
    pendingSelectIdRef.current = null;
    const idx = flatItems.findIndex((f) => f.item.id === pendingId);
    if (idx >= 0) setSelectedIndex(idx);
  }, [flatItems]);

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
        // QNBS-v3: never execute a command while an IME composition is active — Enter is committing
        // composed text (e.g. Japanese/Chinese input), not selecting a command.
        if (e.isComposing) return;
        // QNBS-v3: let focused buttons/links handle their own Enter (e.g. the mic toggle) instead of
        // hijacking it to run the selected command. Only the search input / listbox triggers a run.
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
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

  // QNBS-v3: aria-live for voice input (priority) and hit count.
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

  return {
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
  };
}

export type UseCommandPaletteReturn = ReturnType<typeof useCommandPalette>;
