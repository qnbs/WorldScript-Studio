/**
 * Voice command mappings — natural language templates for existing commands.
 * QNBS-v3: Bridges the intent engine to the existing command registry.
 */

import type { VoiceCommandDefinition } from './voiceTypes';

export const STATIC_VOICE_COMMANDS: VoiceCommandDefinition[] = [
  // Navigation
  {
    id: 'global-dashboard',
    templates: ['open dashboard', 'show dashboard', 'go to dashboard', 'dashboard'],
    keywords: ['dashboard', 'home', 'overview'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-manuscript',
    templates: [
      'open manuscript',
      'show manuscript',
      'go to manuscript',
      'manuscript',
      'open editor',
    ],
    keywords: ['manuscript', 'editor', 'write'],
    supportsDictation: true,
    requiredViews: [],
  },
  {
    id: 'ai-writer',
    templates: ['open writer', 'show writer', 'go to writer', 'writer', 'open ai writer'],
    keywords: ['writer', 'ai writer'],
    supportsDictation: true,
    requiredViews: [],
  },
  {
    id: 'nav-settings',
    templates: ['open settings', 'show settings', 'go to settings', 'settings'],
    keywords: ['settings', 'preferences', 'options'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'help-open',
    templates: ['open help', 'show help', 'go to help', 'help'],
    keywords: ['help', 'support', 'guide'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-scene-board',
    templates: [
      'open plot board',
      'show plot board',
      'go to plot board',
      'plot board',
      'open scene board',
      'scene board',
    ],
    keywords: ['plot', 'scene board', 'board', 'timeline'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-outline',
    templates: ['open outline', 'show outline', 'go to outline', 'outline'],
    keywords: ['outline', 'structure'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-characters',
    templates: ['open characters', 'show characters', 'go to characters', 'characters'],
    keywords: ['characters', 'casts', 'people'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-world',
    templates: ['open world', 'show world', 'go to world', 'world building', 'world'],
    keywords: ['world', 'locations', 'settings'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-export',
    templates: ['open export', 'show export', 'go to export', 'export'],
    keywords: ['export', 'compile', 'pdf', 'epub'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-analytics',
    templates: ['open analytics', 'show analytics', 'go to analytics', 'analytics', 'statistics'],
    keywords: ['analytics', 'stats', 'progress'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'editor-mindmap',
    templates: ['open mind map', 'show mind map', 'go to mind map', 'mind map'],
    keywords: ['mind map', 'mindmap'],
    supportsDictation: false,
    requiredViews: [],
  },

  // Editor actions
  {
    id: 'act-save',
    templates: ['save', 'save project', 'save file'],
    keywords: ['save'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'act-undo',
    templates: ['undo', 'undo last action'],
    keywords: ['undo'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'act-redo',
    templates: ['redo', 'redo last action'],
    keywords: ['redo'],
    supportsDictation: false,
    requiredViews: [],
  },

  // AI actions
  {
    id: 'ai-consistency',
    templates: ['check consistency', 'run consistency check', 'check story consistency'],
    keywords: ['consistency', 'check'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'ai-outline',
    templates: ['generate plot ideas', 'plot ideas', 'outline ideas', 'generate outline'],
    keywords: ['plot ideas', 'outline', 'generate'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'ai-critic',
    templates: ['run critic', 'critic mode', 'analyze story'],
    keywords: ['critic', 'analyze'],
    supportsDictation: false,
    requiredViews: [],
  },

  // Voice-specific
  {
    id: 'voice-start-dictation',
    templates: ['start dictation', 'dictate', 'begin dictation'],
    keywords: ['dictation', 'dictate'],
    supportsDictation: true,
    requiredViews: ['manuscript', 'writer'],
  },
  {
    id: 'voice-stop-dictation',
    templates: ['stop dictation', 'end dictation', 'stop dictating'],
    keywords: ['stop dictation'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'voice-toggle-listening',
    templates: ['start listening', 'stop listening', 'toggle voice'],
    keywords: ['listening', 'voice'],
    supportsDictation: false,
    requiredViews: [],
  },

  // Settings shortcuts
  {
    id: 'toggle-theme',
    templates: ['toggle theme', 'switch theme', 'change theme'],
    keywords: ['theme', 'dark mode', 'light mode'],
    supportsDictation: false,
    requiredViews: [],
  },
  {
    id: 'toggle-zen-mode',
    templates: ['zen mode', 'toggle zen mode', 'distraction free'],
    keywords: ['zen', 'distraction free'],
    supportsDictation: false,
    requiredViews: [],
  },
];

/** Build a lookup map for fast template matching */
export function buildVoiceCommandMap(commands: VoiceCommandDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cmd of commands) {
    for (const template of cmd.templates) {
      map.set(template.toLowerCase().trim(), cmd.id);
    }
  }
  return map;
}
