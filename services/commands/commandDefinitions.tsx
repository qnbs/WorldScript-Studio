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

  const settingsCmds: CommandDefinition[] = [
    {
      id: 'set-theme-toggle',
      category: 'settings',
      titleKey: 'palette.action.lightMode',
      keywords: ['theme', 'dark', 'light', 'appearance'],
      icon: iconBtn(
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
        />,
      ),
      when: (deps) => deps.theme === 'dark',
      run: (deps) => {
        deps.dispatch(settingsActions.setTheme('light'));
      },
    },
    {
      id: 'set-theme-toggle-dark',
      category: 'settings',
      titleKey: 'palette.action.darkMode',
      keywords: ['theme', 'dark', 'light', 'appearance'],
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
      when: (deps) => deps.featureFlags.enableCrossProjectSearch,
      run: (deps) => {
        deps.navigate('dashboard');
        deps.dispatch(
          statusActions.addNotification({
            type: 'info',
            title: deps.t('palette.labs.crossProjectToastTitle'),
            description: deps.t('palette.labs.crossProjectToastBody'),
          }),
        );
      },
    },
  ];

  return [
    ...baseNav,
    ...quick,
    ...aiCmds,
    ...editorCmds,
    ...settingsCmds,
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
