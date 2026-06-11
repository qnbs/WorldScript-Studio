import type { ReactNode } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { ICONS } from '../../constants';
import { projectActions } from '../../features/project/projectSlice';
import { settingsActions } from '../../features/settings/settingsSlice';
import { statusActions } from '../../features/status/statusSlice';
import type { CommandDefinition, CommandRuntimeDeps } from './commandTypes';

const SparkIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    {ICONS.SPARKLES}
  </svg>
);

const iconBtn = (children: ReactNode) => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    {children}
  </svg>
);

export function getStaticCommandDefinitions(): CommandDefinition[] {
  const nav = (
    items: {
      id: string;
      view: import('../../types').View;
      labelKey: string;
      iconKey: keyof typeof ICONS;
    }[],
  ): CommandDefinition[] =>
    items.map((item) => ({
      id: item.id,
      category: 'navigation',
      titleKey: item.labelKey,
      keywords: [
        item.view
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .toLowerCase(),
      ],
      icon: iconBtn(ICONS[item.iconKey]),
      run: (deps) => {
        deps.navigate(item.view);
      },
    }));

  const baseNav = nav([
    { id: 'nav-dashboard', view: 'dashboard', labelKey: 'sidebar.dashboard', iconKey: 'DASHBOARD' },
    { id: 'nav-manuscript', view: 'manuscript', labelKey: 'sidebar.manuscript', iconKey: 'WRITER' },
    { id: 'nav-writer', view: 'writer', labelKey: 'sidebar.writer', iconKey: 'SPARKLES' },
    { id: 'nav-templates', view: 'templates', labelKey: 'sidebar.templates', iconKey: 'TEMPLATES' },
    { id: 'nav-outline', view: 'outline', labelKey: 'sidebar.outline', iconKey: 'OUTLINE' },
    {
      id: 'nav-characters',
      view: 'characters',
      labelKey: 'sidebar.characters',
      iconKey: 'CHARACTERS',
    },
    { id: 'nav-world', view: 'world', labelKey: 'sidebar.world', iconKey: 'WORLD' },
    { id: 'nav-export', view: 'export', labelKey: 'sidebar.export', iconKey: 'EXPORT' },
    { id: 'nav-settings', view: 'settings', labelKey: 'sidebar.settings', iconKey: 'SETTINGS' },
    { id: 'nav-help', view: 'help', labelKey: 'sidebar.help', iconKey: 'HELP' },
    {
      id: 'nav-sceneboard',
      view: 'sceneboard',
      labelKey: 'sidebar.sceneboard',
      iconKey: 'OUTLINE',
    },
    {
      id: 'nav-character-graph',
      view: 'characterGraph',
      labelKey: 'sidebar.characterGraph',
      iconKey: 'CHARACTERS',
    },
    {
      id: 'nav-consistency',
      view: 'consistencyChecker',
      labelKey: 'sidebar.consistencyChecker',
      iconKey: 'SPARKLES',
    },
    { id: 'nav-critic', view: 'critic', labelKey: 'sidebar.critic', iconKey: 'CRITIC' },
  ]);

  const quick: CommandDefinition[] = [
    {
      id: 'act-new-char',
      category: 'projectManagement',
      titleKey: 'characters.addNewManually',
      keywords: ['character', 'person', 'protagonist'],
      icon: iconBtn(ICONS.ADD),
      run: (deps) => {
        deps.dispatch(projectActions.addCharacter({ name: deps.t('characters.newCharacterName') }));
        deps.navigate('characters');
      },
    },
    {
      id: 'act-new-world',
      category: 'projectManagement',
      titleKey: 'worlds.addNewManually',
      keywords: ['world', 'setting', 'lore'],
      icon: iconBtn(ICONS.ADD),
      run: (deps) => {
        deps.dispatch(projectActions.addWorld({ name: deps.t('worlds.newWorldName') }));
        deps.navigate('world');
      },
    },
  ];

  const aiCmds: CommandDefinition[] = [
    {
      id: 'ai-outline',
      category: 'aiActions',
      titleKey: 'palette.aiOutline',
      keywords: ['ai', 'outline', 'plot'],
      shortcutHint: ['/ai', 'outline'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('outline'),
    },
    {
      id: 'ai-character',
      category: 'aiActions',
      titleKey: 'palette.aiCharacter',
      keywords: ['ai', 'character', 'profile'],
      shortcutHint: ['/ai', 'char'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('characters'),
    },
    {
      id: 'ai-consistency',
      category: 'aiActions',
      titleKey: 'palette.aiConsistency',
      keywords: ['consistency', 'check', 'plot holes'],
      shortcutHint: ['/ai', 'check'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('consistencyChecker'),
    },
    {
      id: 'ai-critic',
      category: 'aiActions',
      titleKey: 'palette.aiCritic',
      keywords: ['critic', 'feedback'],
      shortcutHint: ['/ai', 'critic'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('critic'),
    },
    {
      id: 'ai-writer',
      category: 'aiActions',
      titleKey: 'palette.aiWriter',
      keywords: ['write', 'studio', 'assistant'],
      shortcutHint: ['/ai', 'write'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('writer'),
    },
    {
      id: 'export-pdf',
      category: 'aiActions',
      titleKey: 'palette.export',
      keywords: ['export', 'pdf', 'download'],
      shortcutHint: ['/export'],
      icon: <SparkIcon />,
      run: (deps) => deps.navigate('export'),
    },
  ];

  const editorCmds: CommandDefinition[] = [
    {
      id: 'editor-manuscript',
      category: 'editor',
      titleKey: 'sidebar.manuscript',
      keywords: ['editor', 'write', 'draft'],
      icon: iconBtn(ICONS.WRITER),
      run: (deps) => deps.navigate('manuscript'),
    },
    {
      id: 'editor-scene-board',
      category: 'editor',
      titleKey: 'sidebar.sceneboard',
      keywords: ['cards', 'scenes', 'board'],
      icon: iconBtn(ICONS.OUTLINE),
      run: (deps) => deps.navigate('sceneboard'),
    },
  ];

  // ── Theme commands (all 3, not just binary toggle) ────────────────────────
  const settingsCmds: CommandDefinition[] = [
    {
      id: 'set-theme-dark',
      category: 'appearance',
      titleKey: 'palette.action.darkMode',
      keywords: ['theme', 'dark', 'night', 'appearance'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
        />,
      ),
      when: (deps) => deps.theme !== 'dark',
      run: (deps) => {
        deps.dispatch(settingsActions.setTheme('dark'));
      },
    },
    {
      id: 'set-theme-light',
      category: 'appearance',
      titleKey: 'palette.action.lightMode',
      keywords: ['theme', 'light', 'day', 'bright', 'appearance'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
        />,
      ),
      when: (deps) => deps.theme !== 'light',
      run: (deps) => {
        deps.dispatch(settingsActions.setTheme('light'));
      },
    },
    {
      id: 'set-theme-auto',
      category: 'appearance',
      titleKey: 'palette.action.autoTheme',
      keywords: ['theme', 'auto', 'system', 'automatic', 'os', 'appearance'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3"
        />,
      ),
      when: (deps) => deps.theme !== ('auto' as unknown as 'light' | 'dark'),
      run: (deps) => {
        deps.dispatch(settingsActions.setTheme('auto'));
      },
    },
  ];

  // ── Appearance preset commands ─────────────────────────────────────────────
  const appearanceCmds: CommandDefinition[] = [
    {
      id: 'set-preset-default',
      category: 'appearance',
      titleKey: 'palette.appearance.presetDefault',
      keywords: ['appearance', 'preset', 'default', 'clean', 'minimal'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12m6.894 5.785l-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864l-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495"
        />,
      ),
      when: (deps) => deps.appearancePreset !== 'default',
      run: (deps) => {
        deps.dispatch(settingsActions.setAppearancePreset('default'));
      },
    },
    {
      id: 'set-preset-sepia',
      category: 'appearance',
      titleKey: 'palette.appearance.presetSepia',
      keywords: ['appearance', 'preset', 'sepia', 'warm', 'vintage', 'reading'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />,
      ),
      when: (deps) => deps.appearancePreset !== 'sepia',
      run: (deps) => {
        deps.dispatch(settingsActions.setAppearancePreset('sepia'));
      },
    },
  ];

  // ── Accessibility toggle commands ─────────────────────────────────────────
  const accessibilityCmds: CommandDefinition[] = [
    {
      id: 'toggle-high-contrast',
      category: 'accessibility',
      titleKey: 'palette.accessibility.highContrast',
      keywords: ['accessibility', 'contrast', 'high', 'vision', 'a11y'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
        />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAccessibility({ highContrast: !deps.accessibility.highContrast }),
        );
      },
    },
    {
      id: 'toggle-reduced-motion',
      category: 'accessibility',
      titleKey: 'palette.accessibility.reducedMotion',
      keywords: ['accessibility', 'motion', 'animation', 'reduce', 'a11y'],
      icon: iconBtn(
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAccessibility({ reducedMotion: !deps.accessibility.reducedMotion }),
        );
      },
    },
    {
      id: 'toggle-large-text',
      category: 'accessibility',
      titleKey: 'palette.accessibility.largeText',
      keywords: ['accessibility', 'text', 'large', 'font', 'size', 'a11y'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
        />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAccessibility({ largeText: !deps.accessibility.largeText }),
        );
      },
    },
  ];

  // ── Editor mode commands ──────────────────────────────────────────────────
  const editorModeCmds: CommandDefinition[] = [
    {
      id: 'toggle-distraction-free',
      category: 'editor',
      titleKey: 'palette.editor.distractionFree',
      keywords: ['distraction', 'free', 'focus', 'editor', 'zen', 'writing'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
        />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAdvancedEditor({
            distractionFree: !deps.advancedEditor.distractionFree,
          }),
        );
      },
    },
    {
      id: 'toggle-typewriter-mode',
      category: 'editor',
      titleKey: 'palette.editor.typewriterMode',
      keywords: ['typewriter', 'mode', 'center', 'focus', 'editor'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAdvancedEditor({
            typewriterMode: !deps.advancedEditor.typewriterMode,
          }),
        );
      },
    },
    {
      id: 'toggle-zen-mode',
      category: 'editor',
      titleKey: 'palette.editor.zenMode',
      keywords: ['zen', 'mode', 'fullscreen', 'focus', 'immersive'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
        />,
      ),
      run: (deps) => {
        deps.dispatch(settingsActions.setAdvancedEditor({ zenMode: !deps.advancedEditor.zenMode }));
      },
    },
    {
      id: 'toggle-focus-mode',
      category: 'editor',
      titleKey: 'palette.editor.focusMode',
      keywords: ['focus', 'mode', 'paragraph', 'highlight', 'editor'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
        />,
      ),
      run: (deps) => {
        deps.dispatch(
          settingsActions.setAdvancedEditor({ focusMode: !deps.advancedEditor.focusMode }),
        );
      },
    },
  ];

  // ── Editor font commands ──────────────────────────────────────────────────
  const editorFontCmds: CommandDefinition[] = [
    {
      id: 'set-font-serif',
      category: 'editor',
      titleKey: 'palette.editor.fontSerif',
      keywords: ['font', 'serif', 'georgia', 'classical', 'editor'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
        />,
      ),
      run: (deps) => {
        deps.dispatch(settingsActions.setEditorFont('serif'));
      },
    },
    {
      id: 'set-font-sans',
      category: 'editor',
      titleKey: 'palette.editor.fontSans',
      keywords: ['font', 'sans', 'sans-serif', 'clean', 'modern', 'editor'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
        />,
      ),
      run: (deps) => {
        deps.dispatch(settingsActions.setEditorFont('sans-serif'));
      },
    },
    {
      id: 'set-font-mono',
      category: 'editor',
      titleKey: 'palette.editor.fontMono',
      keywords: ['font', 'mono', 'monospace', 'code', 'typewriter', 'editor'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
        />,
      ),
      run: (deps) => {
        deps.dispatch(settingsActions.setEditorFont('monospace'));
      },
    },
  ];

  // ── AI mode commands ──────────────────────────────────────────────────────
  const aiModeCmds: CommandDefinition[] = [
    {
      id: 'set-ai-mode-hybrid',
      category: 'aiActions',
      titleKey: 'palette.aiMode.hybrid',
      keywords: ['ai', 'mode', 'hybrid', 'smart', 'auto', 'routing', 'mixed'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
        />,
      ),
      when: (deps) => deps.aiMode !== 'hybrid',
      run: (deps) => {
        deps.dispatch(settingsActions.setAiMode('hybrid'));
      },
    },
    {
      id: 'set-ai-mode-cloud',
      category: 'aiActions',
      titleKey: 'palette.aiMode.cloud',
      keywords: ['ai', 'mode', 'cloud', 'online', 'gemini', 'openai', 'api'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
        />,
      ),
      when: (deps) => deps.aiMode !== 'cloud',
      run: (deps) => {
        deps.dispatch(settingsActions.setAiMode('cloud'));
      },
    },
    {
      id: 'set-ai-mode-local',
      category: 'aiActions',
      titleKey: 'palette.aiMode.local',
      keywords: ['ai', 'mode', 'local', 'offline', 'private', 'on-device', 'ollama', 'webllm'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
        />,
      ),
      when: (deps) => deps.aiMode !== 'local',
      run: (deps) => {
        deps.dispatch(settingsActions.setAiMode('local'));
      },
    },
    {
      id: 'set-ai-mode-eco',
      category: 'aiActions',
      titleKey: 'palette.aiMode.eco',
      keywords: ['ai', 'mode', 'eco', 'battery', 'saver', 'low-end', 'energy', 'mobile'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
        />,
      ),
      when: (deps) => deps.aiMode !== 'eco',
      run: (deps) => {
        deps.dispatch(settingsActions.setAiMode('eco'));
      },
    },
  ];

  const helpCmds: CommandDefinition[] = [
    {
      id: 'help-open',
      category: 'help',
      titleKey: 'sidebar.help',
      keywords: ['faq', 'guide', 'documentation'],
      icon: iconBtn(ICONS.HELP),
      run: (deps) => deps.navigate('help'),
    },
    {
      id: 'help-tour',
      category: 'help',
      titleKey: 'help.tryTour',
      keywords: ['tour', 'onboarding', 'spotlight'],
      icon: iconBtn(ICONS.LIGHTNING_BOLT),
      run: (deps) => {
        void import('../../services/spotlightTour').then(({ startSpotlightTour }) => {
          startSpotlightTour(deps.t, 'default');
        });
      },
    },
  ];

  const globalCmds: CommandDefinition[] = [
    {
      id: 'global-open-command-palette',
      category: 'global',
      titleKey: 'palette.command.openPalette',
      keywords: ['palette', 'command', 'search', 'k'],
      icon: iconBtn(ICONS.DASHBOARD),
      run: () => {
        useTransientUiStore.getState().setCommandPaletteOpen(true);
      },
    },
    {
      id: 'global-dashboard',
      category: 'global',
      titleKey: 'palette.command.homeDashboard',
      keywords: ['home', 'start'],
      icon: iconBtn(ICONS.DASHBOARD),
      run: (deps) => deps.navigate('dashboard'),
    },
    {
      id: 'labs-project-health',
      category: 'global',
      titleKey: 'palette.labs.healthScore',
      keywords: ['health', 'score', 'progress'],
      icon: <SparkIcon />,
      when: (deps) => deps.featureFlags.enableProjectHealthScore,
      run: (deps) => {
        deps.navigate('dashboard');
        deps.dispatch(
          statusActions.addNotification({
            type: 'info',
            title: deps.t('palette.labs.healthScoreToastTitle'),
            description: deps.t('palette.labs.healthScoreToastBody'),
          }),
        );
      },
    },
    {
      id: 'labs-cross-project-search',
      category: 'global',
      titleKey: 'palette.labs.crossProjectSearch',
      keywords: ['search', 'projects', 'all'],
      icon: iconBtn(ICONS.DASHBOARD),
      // QNBS-v3: enableCrossProjectSearch promoted to permanent core — command always available.
      // QNBS-v3: opens cross-project search panel via Zustand transient state, not Redux (avoids re-renders)
      run: () => {
        useTransientUiStore.getState().setCrossProjectSearchOpen(true);
      },
    },
  ];

  return [
    ...baseNav,
    ...quick,
    ...aiCmds,
    ...editorCmds,
    ...settingsCmds,
    ...appearanceCmds,
    ...accessibilityCmds,
    ...editorModeCmds,
    ...editorFontCmds,
    ...aiModeCmds,
    ...helpCmds,
    ...globalCmds,
  ];
}

export function buildLanguageCommands(deps: CommandRuntimeDeps): CommandDefinition[] {
  const PALETTE_LANG_OPTIONS: {
    code: import('../../contexts/I18nContext').Language;
    labelKey: string;
  }[] = [
    { code: 'en', labelKey: 'settings.language.english' },
    { code: 'de', labelKey: 'settings.language.german' },
    { code: 'fr', labelKey: 'settings.language.french' },
    { code: 'es', labelKey: 'settings.language.spanish' },
    { code: 'it', labelKey: 'settings.language.italian' },
  ];

  return PALETTE_LANG_OPTIONS.filter((o) => o.code !== deps.language).map((o) => ({
    id: `set-lang-${o.code}`,
    category: 'settings' as const,
    titleKey: 'palette.lang.switchTo',
    inlineTitle: deps.t('palette.lang.switchTo', { name: deps.t(o.labelKey) }),
    keywords: [o.code, 'language', 'locale'],
    icon: (
      <span className="font-bold text-xs border border-current rounded px-1 uppercase">
        {o.code}
      </span>
    ),
    run: (d) => {
      d.setLanguage(o.code);
    },
  }));
}

export function buildEntityCommands(deps: CommandRuntimeDeps): CommandDefinition[] {
  const charCmds: CommandDefinition[] = deps.characters.map((char) => ({
    id: `char-${char.id}`,
    category: 'projectManagement' as const,
    titleKey: '',
    inlineTitle: char.name,
    keywords: [char.name.toLowerCase(), 'character'],
    icon: iconBtn(ICONS.CHARACTERS),
    run: (d) => {
      d.navigate('characters');
    },
  }));

  const worldCmds: CommandDefinition[] = deps.worlds.map((world) => ({
    id: `world-${world.id}`,
    category: 'projectManagement' as const,
    titleKey: '',
    inlineTitle: world.name,
    keywords: [world.name.toLowerCase(), 'world'],
    icon: iconBtn(ICONS.WORLD),
    run: (d) => {
      d.navigate('world');
    },
  }));

  return [...charCmds, ...worldCmds];
}
