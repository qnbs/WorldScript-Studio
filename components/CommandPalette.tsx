import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { ICONS } from '../constants';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { settingsActions } from '../features/settings/settingsSlice';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import type { Language } from '../contexts/I18nContext';
import { useTranslation } from '../hooks/useTranslation';
import type { View } from '../types';

const PALETTE_LANG_OPTIONS: {
  code: Language;
  labelKey:
    | 'settings.language.english'
    | 'settings.language.german'
    | 'settings.language.french'
    | 'settings.language.spanish'
    | 'settings.language.italian';
}[] = [
  { code: 'en', labelKey: 'settings.language.english' },
  { code: 'de', labelKey: 'settings.language.german' },
  { code: 'fr', labelKey: 'settings.language.french' },
  { code: 'es', labelKey: 'settings.language.spanish' },
  { code: 'it', labelKey: 'settings.language.italian' },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
}

type CommandItem = {
  id: string;
  title: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  shortcut?: string[];
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onNavigate }) => {
  const { t, language, setLanguage } = useTranslation();
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const { isListening, transcript, toggleListening, stopListening, setTranscript } =
    useSpeechRecognition();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Detect touch/mobile device to avoid auto-opening virtual keyboard
  const isTouchDevice = useMemo(
    () =>
      typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
    [],
  );

  // Sync voice transcript to query
  useEffect(() => {
    if (transcript && isOpen) {
      setQuery(transcript);
      setTranscript('');
    }
  }, [transcript, isOpen, setTranscript]);

  // --- Reset state when opened/closed ---
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Only auto-focus on non-touch devices to prevent virtual keyboard popup
      if (!isTouchDevice) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      // Stop listening when closing
      if (isListening) {
        stopListening();
      }
    }
  }, [isOpen, isListening, stopListening, isTouchDevice]);

  // --- Define Commands ---
  const commands: CommandItem[] = useMemo(() => {
    const cmds: CommandItem[] = [];

    // 1. Navigation
    const navItems: { view: View; icon: keyof typeof ICONS; label: string }[] = [
      { view: 'dashboard', icon: 'DASHBOARD', label: 'sidebar.dashboard' },
      { view: 'manuscript', icon: 'WRITER', label: 'sidebar.manuscript' },
      { view: 'writer', icon: 'SPARKLES', label: 'sidebar.writer' },
      { view: 'templates', icon: 'TEMPLATES', label: 'sidebar.templates' },
      { view: 'outline', icon: 'OUTLINE', label: 'sidebar.outline' },
      { view: 'characters', icon: 'CHARACTERS', label: 'sidebar.characters' },
      { view: 'world', icon: 'WORLD', label: 'sidebar.world' },
      { view: 'export', icon: 'EXPORT', label: 'sidebar.export' },
      { view: 'settings', icon: 'SETTINGS', label: 'sidebar.settings' },
      { view: 'help', icon: 'HELP', label: 'sidebar.help' },
    ];

    navItems.forEach((item) => {
      cmds.push({
        id: `nav-${item.view}`,
        title: t(item.label),
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            {ICONS[item.icon]}
          </svg>
        ),
        category: t('palette.category.navigation'),
        action: () => onNavigate(item.view),
      });
    });

    // 2. Quick Actions
    cmds.push({
      id: 'act-new-char',
      title: t('characters.addNewManually'),
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          {ICONS.ADD}
        </svg>
      ),
      category: t('palette.category.actions'),
      action: () => {
        dispatch(projectActions.addCharacter({ name: t('characters.newCharacterName') }));
        onNavigate('characters');
      },
    });

    cmds.push({
      id: 'act-new-world',
      title: t('worlds.addNewManually'),
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          {ICONS.ADD}
        </svg>
      ),
      category: t('palette.category.actions'),
      action: () => {
        dispatch(projectActions.addWorld({ name: t('worlds.newWorldName') }));
        onNavigate('world');
      },
    });

    // 3. AI-Schnellbefehle
    const aiCommands = [
      {
        id: 'ai-outline',
        title: t('palette.aiOutline'),
        view: 'outline' as const,
        shortcut: ['/ai', 'outline'],
      },
      {
        id: 'ai-character',
        title: t('palette.aiCharacter'),
        view: 'characters' as const,
        shortcut: ['/ai', 'char'],
      },
      {
        id: 'ai-consistency',
        title: t('palette.aiConsistency'),
        view: 'consistencyChecker' as const,
        shortcut: ['/ai', 'check'],
      },
      {
        id: 'ai-critic',
        title: t('palette.aiCritic'),
        view: 'critic' as const,
        shortcut: ['/ai', 'critic'],
      },
      {
        id: 'ai-writer',
        title: t('palette.aiWriter'),
        view: 'writer' as const,
        shortcut: ['/ai', 'write'],
      },
      {
        id: 'export-pdf',
        title: t('palette.export'),
        view: 'export' as const,
        shortcut: ['/export'],
      },
    ];

    aiCommands.forEach((cmd) => {
      cmds.push({
        id: cmd.id,
        title: cmd.title,
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            {ICONS.SPARKLES}
          </svg>
        ),
        category: t('palette.category.ai'),
        shortcut: cmd.shortcut,
        action: () => onNavigate(cmd.view),
      });
    });

    // 4. Search Content (Characters)
    characters.forEach((char) => {
      cmds.push({
        id: `char-${char.id}`,
        title: char.name,
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            {ICONS.CHARACTERS}
          </svg>
        ),
        category: t('palette.category.characters'),
        action: () => onNavigate('characters'), // Ideally deeper linking, but View switch for now
      });
    });

    // 4. Search Content (Worlds)
    worlds.forEach((world) => {
      cmds.push({
        id: `world-${world.id}`,
        title: world.name,
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            {ICONS.WORLD}
          </svg>
        ),
        category: t('palette.category.worlds'),
        action: () => onNavigate('world'),
      });
    });

    // 5. Settings & System
    cmds.push({
      id: 'set-theme',
      title:
        settings.theme === 'dark' ? t('palette.action.lightMode') : t('palette.action.darkMode'),
      icon: (
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
            d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
          />
        </svg>
      ),
      category: t('palette.category.settings'),
      action: () =>
        dispatch(settingsActions.setTheme(settings.theme === 'dark' ? 'light' : 'dark')),
    });

    for (const { code, labelKey } of PALETTE_LANG_OPTIONS) {
      if (code === language) continue;
      cmds.push({
        id: `set-lang-${code}`,
        title: t('palette.lang.switchTo', { name: t(labelKey) }),
        icon: (
          <span className="font-bold text-xs border border-current rounded px-1 uppercase">
            {code}
          </span>
        ),
        category: t('palette.category.settings'),
        action: () => setLanguage(code),
      });
    }

    return cmds;
  }, [t, onNavigate, dispatch, settings.theme, language, setLanguage, characters, worlds]);

  // --- Filtering ---
  const filteredCommands = useMemo(() => {
    if (!query) return commands;
    const lowerQuery = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(lowerQuery) ||
        cmd.category.toLowerCase().includes(lowerQuery),
    );
  }, [query, commands]);

  // --- Keyboard Handling (desktop only) ---
  useEffect(() => {
    if (isTouchDevice) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isTouchDevice, filteredCommands, selectedIndex, onClose]);

  // Ensure selection index is valid when filtering
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Grouping for display
  const groupedCommands = filteredCommands.reduce(
    (acc, cmd) => {
      const category = cmd.category;
      if (!acc[category]) acc[category] = [];
      const bucket = acc[category];
      if (bucket) {
        bucket.push(cmd);
      }
      return acc;
    },
    {} as Record<string, CommandItem[]>,
  );

  // Flatten for index mapping
  let currentIndexCounter = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[var(--overlay-backdrop)] backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Window */}
      <div className="relative w-full max-w-2xl bg-[var(--background-secondary)]/90 backdrop-blur-xl border border-[var(--border-primary)] shadow-2xl rounded-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 ring-1 ring-[var(--glass-border)]">
        {/* Search Input */}
        <div className="flex items-center px-4 py-4 border-b border-[var(--border-primary)]/50">
          <svg
            className="w-5 h-5 text-[var(--foreground-muted)] mr-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 001.061 1.061z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent border-none focus:ring-0 text-lg text-[var(--foreground-primary)] placeholder-[var(--foreground-muted)] h-10"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Prevent zooming on iOS
            style={{ fontSize: '16px' }}
          />
          {/* Voice Input Button */}
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

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2 scroll-smooth" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-[var(--foreground-muted)]">
              {t('palette.noResults')}
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, items]) => (
              <React.Fragment key={category}>
                <div className="px-3 py-2 text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider sticky top-0 bg-[var(--background-secondary)]/95 backdrop-blur-sm z-10">
                  {category}
                </div>
                {(items as CommandItem[]).map((cmd) => {
                  const isActive = currentIndexCounter === selectedIndex;
                  const itemIndex = currentIndexCounter;
                  currentIndexCounter++;

                  return (
                    <button
                      type="button"
                      key={cmd.id}
                      onClick={() => {
                        cmd.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-all duration-150 group ${
                        isActive
                          ? 'bg-[var(--background-interactive)] text-white shadow-md'
                          : 'text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-1.5 rounded-md ${isActive ? 'text-white bg-[var(--glass-bg-hover)]' : 'text-[var(--foreground-secondary)] bg-[var(--background-tertiary)] group-hover:bg-[var(--background-primary)]'}`}
                        >
                          {cmd.icon}
                        </div>
                        <span className={`font-medium ${isActive ? 'text-white' : ''}`}>
                          {cmd.title}
                        </span>
                      </div>
                      {cmd.shortcut && (
                        <div className="flex gap-1">
                          {cmd.shortcut.map((k) => (
                            <kbd
                              key={k}
                              className={`px-1.5 py-0.5 text-xs rounded border ${isActive ? 'border-[var(--glass-highlight)] bg-[var(--glass-bg-hover)] text-white' : 'border-[var(--border-primary)] bg-[var(--background-primary)] text-[var(--foreground-muted)]'}`}
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      )}
                      {isActive && (
                        <svg
                          className="w-4 h-4 text-white opacity-70"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Footer (Desktop only) */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--background-tertiary)]/30 text-xs text-[var(--foreground-muted)]">
          <div className="flex gap-3">
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
          </div>
          <span>StoryCraft Studio</span>
        </div>
      </div>
    </div>
  );
};
