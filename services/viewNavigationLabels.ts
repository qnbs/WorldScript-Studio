import type { View } from '../types';

/** i18n keys under sidebar.* — single source for Header titles + screen reader view announcements. */
export const VIEW_NAVIGATION_LABEL_KEYS: Partial<Record<View, string>> = {
  dashboard: 'sidebar.dashboard',
  manuscript: 'sidebar.manuscript',
  writer: 'sidebar.writer',
  templates: 'sidebar.templates',
  outline: 'sidebar.outline',
  characters: 'sidebar.characters',
  world: 'sidebar.world',
  export: 'sidebar.export',
  settings: 'sidebar.settings',
  help: 'sidebar.help',
  sceneboard: 'sidebar.sceneboard',
  analytics: 'sidebar.analytics',
  zen: 'sidebar.zen',
  characterGraph: 'sidebar.characterGraph',
  consistencyChecker: 'sidebar.consistencyChecker',
  critic: 'sidebar.critic',
  objects: 'sidebar.objects',
  mindmap: 'sidebar.mindmap',
  characterInterviews: 'sidebar.characterInterviews',
  lora: 'sidebar.lora',
};

export function viewNavigationLabelKey(view: View): string {
  return VIEW_NAVIGATION_LABEL_KEYS[view] ?? 'sidebar.dashboard';
}
