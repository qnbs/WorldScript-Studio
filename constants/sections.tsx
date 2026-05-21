// QNBS-v3: Single source of truth for section identity — icon + color token per view
import type { View } from '../types';
import { ICONS } from './icons';

export interface SectionConfig {
  icon: React.ReactNode;
  // Combined Tailwind class: icon color + bg (for colored icon badges)
  colorClass: string;
  // Standalone text color for headings / breadcrumbs
  textColor: string;
  // Sidebar active indicator color (CSS variable fallback kept intentionally)
  accentColor: string;
}

export const APP_SECTIONS: Record<View, SectionConfig> = {
  dashboard: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-indigo-500 bg-indigo-500/10 dark:text-indigo-400 dark:bg-indigo-500/10',
    textColor: 'text-indigo-500 dark:text-indigo-400',
    accentColor: '#6366f1',
  },
  manuscript: {
    icon: ICONS.WRITER,
    colorClass: 'text-emerald-500 bg-emerald-500/10 dark:text-emerald-400 dark:bg-emerald-500/10',
    textColor: 'text-emerald-500 dark:text-emerald-400',
    accentColor: '#10b981',
  },
  writer: {
    icon: ICONS.SPARKLES,
    colorClass: 'text-violet-500 bg-violet-500/10 dark:text-violet-400 dark:bg-violet-500/10',
    textColor: 'text-violet-500 dark:text-violet-400',
    accentColor: '#8b5cf6',
  },
  templates: {
    icon: ICONS.TEMPLATES,
    colorClass: 'text-pink-500 bg-pink-500/10 dark:text-pink-400 dark:bg-pink-500/10',
    textColor: 'text-pink-500 dark:text-pink-400',
    accentColor: '#ec4899',
  },
  outline: {
    icon: ICONS.OUTLINE,
    colorClass: 'text-amber-500 bg-amber-500/10 dark:text-amber-400 dark:bg-amber-500/10',
    textColor: 'text-amber-500 dark:text-amber-400',
    accentColor: '#f59e0b',
  },
  characters: {
    icon: ICONS.CHARACTERS,
    colorClass: 'text-blue-500 bg-blue-500/10 dark:text-blue-400 dark:bg-blue-500/10',
    textColor: 'text-blue-500 dark:text-blue-400',
    accentColor: '#3b82f6',
  },
  world: {
    icon: ICONS.WORLD,
    colorClass: 'text-purple-500 bg-purple-500/10 dark:text-purple-400 dark:bg-purple-500/10',
    textColor: 'text-purple-500 dark:text-purple-400',
    accentColor: '#a855f7',
  },
  export: {
    icon: ICONS.EXPORT,
    colorClass: 'text-slate-500 bg-slate-500/10 dark:text-slate-400 dark:bg-slate-500/10',
    textColor: 'text-slate-500 dark:text-slate-400',
    accentColor: '#64748b',
  },
  settings: {
    icon: ICONS.SETTINGS,
    colorClass: 'text-gray-500 bg-gray-500/10 dark:text-gray-400 dark:bg-gray-500/10',
    textColor: 'text-gray-500 dark:text-gray-400',
    accentColor: '#6b7280',
  },
  help: {
    icon: ICONS.HELP,
    colorClass: 'text-yellow-500 bg-yellow-500/10 dark:text-yellow-400 dark:bg-yellow-500/10',
    textColor: 'text-yellow-500 dark:text-yellow-400',
    accentColor: '#eab308',
  },
  sceneboard: {
    icon: ICONS.SCENEBOARD,
    colorClass: 'text-orange-500 bg-orange-500/10 dark:text-orange-400 dark:bg-orange-500/10',
    textColor: 'text-orange-500 dark:text-orange-400',
    accentColor: '#f97316',
  },
  analytics: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-teal-500 bg-teal-500/10 dark:text-teal-400 dark:bg-teal-500/10',
    textColor: 'text-teal-500 dark:text-teal-400',
    accentColor: '#14b8a6',
  },
  zen: {
    icon: ICONS.WRITER,
    colorClass: 'text-sky-500 bg-sky-500/10 dark:text-sky-400 dark:bg-sky-500/10',
    textColor: 'text-sky-500 dark:text-sky-400',
    accentColor: '#0ea5e9',
  },
  characterGraph: {
    icon: ICONS.CHARACTERGRAPH,
    colorClass: 'text-cyan-500 bg-cyan-500/10 dark:text-cyan-400 dark:bg-cyan-500/10',
    textColor: 'text-cyan-500 dark:text-cyan-400',
    accentColor: '#06b6d4',
  },
  consistencyChecker: {
    icon: ICONS.CONSISTENCYCHECKER,
    colorClass: 'text-green-500 bg-green-500/10 dark:text-green-400 dark:bg-green-500/10',
    textColor: 'text-green-500 dark:text-green-400',
    accentColor: '#22c55e',
  },
  critic: {
    icon: ICONS.CRITIC,
    colorClass: 'text-rose-500 bg-rose-500/10 dark:text-rose-400 dark:bg-rose-500/10',
    textColor: 'text-rose-500 dark:text-rose-400',
    accentColor: '#f43f5e',
  },
  // QNBS-v3: v1.7 Mind Maps — SVG canvas with entity linking.
  mindmap: {
    icon: ICONS.MINDMAP,
    colorClass: 'text-violet-500 bg-violet-500/10 dark:text-violet-400 dark:bg-violet-500/10',
    textColor: 'text-violet-500 dark:text-violet-400',
    accentColor: '#8b5cf6',
  },
  // QNBS-v3: v1.7 Character Interviews — archetype-based AI chat sessions.
  characterInterviews: {
    icon: ICONS.INTERVIEWS,
    colorClass: 'text-blue-500 bg-blue-500/10 dark:text-blue-400 dark:bg-blue-500/10',
    textColor: 'text-blue-500 dark:text-blue-400',
    accentColor: '#3b82f6',
  },
  // QNBS-v3: v1.7 Objects & Groups inventory view.
  objects: {
    icon: ICONS.OBJECTS,
    colorClass: 'text-stone-500 bg-stone-500/10 dark:text-stone-400 dark:bg-stone-500/10',
    textColor: 'text-stone-500 dark:text-stone-400',
    accentColor: '#78716c',
  },
  // QNBS-v3: preview + progress views added in v1.6 — stub icons reuse nearest thematic icon.
  preview: {
    icon: ICONS.WRITER,
    colorClass: 'text-lime-500 bg-lime-500/10 dark:text-lime-400 dark:bg-lime-500/10',
    textColor: 'text-lime-500 dark:text-lime-400',
    accentColor: '#84cc16',
  },
  progress: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-fuchsia-500 bg-fuchsia-500/10 dark:text-fuchsia-400 dark:bg-fuchsia-500/10',
    textColor: 'text-fuchsia-500 dark:text-fuchsia-400',
    accentColor: '#d946ef',
  },
};
