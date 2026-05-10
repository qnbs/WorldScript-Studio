/** Kleinbuchstaben-Keywords für die globale Settings-Suche (Sidebar-Filter). */
export const SETTINGS_CATEGORY_SEARCH_HINTS: Record<string, string[]> = {
  general: ['language', 'locale', 'welcome'],
  appearance: ['theme', 'dark', 'light', 'preset', 'sepia'],
  editor: ['font', 'spacing', 'paragraph', 'typography'],
  'advanced-editor': ['grammar', 'spell', 'dictionary', 'distraction', 'zen'],
  ai: ['creativity', 'gemini', 'model'],
  'advanced-ai': ['provider', 'ollama', 'temperature', 'tokens', 'rag'],
  accessibility: ['contrast', 'motion', 'screen reader', 'a11y'],
  privacy: ['analytics', 'encryption', 'data'],
  performance: ['cache', 'preload', 'offline'],
  notifications: ['reminder', 'desktop', 'email'],
  collaboration: ['webrtc', 'sharing', 'yjs'],
  integrations: ['language tool', 'sync', 'notion'],
  backup: ['snapshot', 'frequency', 'encrypt'],
  data: ['export', 'import', 'reset', 'json'],
  about: ['version', 'license', 'credits'],
  shortcuts: ['keyboard', 'hotkey', 'keybinding', 'ctrl', 'meta'],
};
