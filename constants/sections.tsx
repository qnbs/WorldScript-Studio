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

// QNBS-v3: Removed dark: prefix variants — X-500 mid-range works on all appearance presets.
export const APP_SECTIONS: Record<View, SectionConfig> = {
  dashboard: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-indigo-500 bg-indigo-500/10',
    textColor: 'text-indigo-500',
    accentColor: '#6366f1',
  },
  manuscript: {
    icon: ICONS.WRITER,
    colorClass: 'text-emerald-500 bg-emerald-500/10',
    textColor: 'text-emerald-500',
    accentColor: '#10b981',
  },
  writer: {
    icon: ICONS.SPARKLES,
    colorClass: 'text-violet-500 bg-violet-500/10',
    textColor: 'text-violet-500',
    accentColor: '#8b5cf6',
  },
  templates: {
    icon: ICONS.TEMPLATES,
    colorClass: 'text-pink-500 bg-pink-500/10',
    textColor: 'text-pink-500',
    accentColor: '#ec4899',
  },
  outline: {
    icon: ICONS.OUTLINE,
    colorClass: 'text-amber-500 bg-amber-500/10',
    textColor: 'text-amber-500',
    accentColor: '#f59e0b',
  },
  characters: {
    icon: ICONS.CHARACTERS,
    colorClass: 'text-blue-500 bg-blue-500/10',
    textColor: 'text-blue-500',
    accentColor: '#3b82f6',
  },
  world: {
    icon: ICONS.WORLD,
    colorClass: 'text-purple-500 bg-purple-500/10',
    textColor: 'text-purple-500',
    accentColor: '#a855f7',
  },
  export: {
    icon: ICONS.EXPORT,
    colorClass: 'text-slate-500 bg-slate-500/10',
    textColor: 'text-slate-500',
    accentColor: '#64748b',
  },
  settings: {
    icon: ICONS.SETTINGS,
    colorClass: 'text-gray-500 bg-gray-500/10',
    textColor: 'text-gray-500',
    accentColor: '#6b7280',
  },
  help: {
    icon: ICONS.HELP,
    colorClass: 'text-yellow-500 bg-yellow-500/10',
    textColor: 'text-yellow-500',
    accentColor: '#eab308',
  },
  sceneboard: {
    icon: ICONS.SCENEBOARD,
    colorClass: 'text-orange-500 bg-orange-500/10',
    textColor: 'text-orange-500',
    accentColor: '#f97316',
  },
  analytics: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-teal-500 bg-teal-500/10',
    textColor: 'text-teal-500',
    accentColor: '#14b8a6',
  },
  zen: {
    icon: ICONS.WRITER,
    colorClass: 'text-sky-500 bg-sky-500/10',
    textColor: 'text-sky-500',
    accentColor: '#0ea5e9',
  },
  characterGraph: {
    icon: ICONS.CHARACTERGRAPH,
    colorClass: 'text-cyan-500 bg-cyan-500/10',
    textColor: 'text-cyan-500',
    accentColor: '#06b6d4',
  },
  consistencyChecker: {
    icon: ICONS.CONSISTENCYCHECKER,
    colorClass: 'text-green-500 bg-green-500/10',
    textColor: 'text-green-500',
    accentColor: '#22c55e',
  },
  critic: {
    icon: ICONS.CRITIC,
    colorClass: 'text-rose-500 bg-rose-500/10',
    textColor: 'text-rose-500',
    accentColor: '#f43f5e',
  },
  // QNBS-v3: v1.7 Mind Maps — SVG canvas with entity linking.
  mindmap: {
    icon: ICONS.MINDMAP,
    colorClass: 'text-violet-500 bg-violet-500/10',
    textColor: 'text-violet-500',
    accentColor: '#8b5cf6',
  },
  // QNBS-v3: v1.7 Character Interviews — archetype-based AI chat sessions.
  characterInterviews: {
    icon: ICONS.INTERVIEWS,
    colorClass: 'text-blue-500 bg-blue-500/10',
    textColor: 'text-blue-500',
    accentColor: '#3b82f6',
  },
  // QNBS-v3: v1.7 Objects & Groups inventory view.
  objects: {
    icon: ICONS.OBJECTS,
    colorClass: 'text-stone-500 bg-stone-500/10',
    textColor: 'text-stone-500',
    accentColor: '#78716c',
  },
  // QNBS-v3: preview + progress views added in v1.6 — stub icons reuse nearest thematic icon.
  preview: {
    icon: ICONS.WRITER,
    colorClass: 'text-lime-500 bg-lime-500/10',
    textColor: 'text-lime-500',
    accentColor: '#84cc16',
  },
  progress: {
    icon: ICONS.DASHBOARD,
    colorClass: 'text-fuchsia-500 bg-fuchsia-500/10',
    textColor: 'text-fuchsia-500',
    accentColor: '#d946ef',
  },
};
