import type { ReactNode } from 'react';
import type { AppDispatch } from '../../app/store';
import type { Language } from '../../contexts/I18nContext';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import type { AiMode, AppearancePreset, View } from '../../types';

/** Aligns with `I18nContextType['t']` for assignability from `useTranslation().t`. */
export type I18nTranslate = <T = string>(key: string, replacements?: Record<string, string>) => T;

export type CommandCategory =
  | 'navigation'
  | 'aiActions'
  | 'projectManagement'
  | 'editor'
  | 'settings'
  | 'appearance'
  | 'accessibility'
  | 'help'
  | 'global'
  | 'customUser';

/** Maps to i18n keys under palette.category.* */
export const COMMAND_CATEGORY_I18N: Record<CommandCategory, string> = {
  navigation: 'palette.category.navigation',
  aiActions: 'palette.category.ai',
  projectManagement: 'palette.category.actions',
  editor: 'palette.category.editor',
  settings: 'palette.category.settings',
  appearance: 'palette.category.appearance',
  accessibility: 'palette.category.accessibility',
  help: 'palette.category.help',
  global: 'palette.category.global',
  customUser: 'palette.category.custom',
};

export interface CommandRuntimeDeps {
  dispatch: AppDispatch;
  navigate: (view: View) => void;
  setLanguage: (lang: Language) => void;
  t: I18nTranslate;
  theme: 'light' | 'dark';
  language: Language;
  characters: { id: string; name: string }[];
  worlds: { id: string; name: string }[];
  currentView: View;
  wordCountApprox: number;
  featureFlags: FeatureFlagsState;
  /** Current AI execution mode — used by AI mode switch commands. */
  aiMode: AiMode;
  /** Current appearance preset — used by preset switch commands. */
  appearancePreset: AppearancePreset;
  /** Current advanced-editor settings snapshot (distractionFree, typewriterMode, etc.). */
  advancedEditor: {
    distractionFree: boolean;
    typewriterMode: boolean;
    zenMode: boolean;
    focusMode: boolean;
  };
  /** Current accessibility settings snapshot. */
  accessibility: {
    highContrast: boolean;
    reducedMotion: boolean;
    largeText: boolean;
  };
}

export interface PaletteCommandModel {
  id: string;
  title: string;
  categoryLabel: string;
  category: CommandCategory;
  icon: ReactNode;
  keywords: string[];
  shortcutDisplay?: string[];
  scoreBoost?: number;
  run: () => void;
}

export interface CommandDefinition {
  id: string;
  category: CommandCategory;
  /** Main label i18n key */
  titleKey: string;
  /** When set, displayed instead of t(titleKey) */
  inlineTitle?: string;
  /** Extra searchable tokens (lowercase ascii) */
  keywords?: string[];
  shortcutHint?: string[];
  /** Optional: bind to settings keyboard shortcut action string */
  shortcutAction?: string;
  when?: (deps: CommandRuntimeDeps) => boolean;
  icon: ReactNode;
  run: (deps: CommandRuntimeDeps) => void;
}
