/** Source of truth for Help Center structure (article bodies live in locale `help` module). */

export type HelpArticleDef = {
  titleKey: string;
  contentKey: string;
  tryActionId?: string;
};

export type HelpCategoryDef = {
  id: string;
  titleKey: string;
  icon: string;
  articles: HelpArticleDef[];
};

export const HELP_CATALOG: HelpCategoryDef[] = [
  {
    id: 'getting-started',
    titleKey: 'help.category.gettingStarted',
    icon: 'DASHBOARD',
    articles: [
      {
        titleKey: 'help.gettingStarted.tour.title',
        contentKey: 'help.gettingStarted.tour.content',
        tryActionId: 'nav-dashboard',
      },
      {
        titleKey: 'help.gettingStarted.firstProject.title',
        contentKey: 'help.gettingStarted.firstProject.content',
        tryActionId: 'nav-templates',
      },
      {
        titleKey: 'help.gettingStarted.palette.title',
        contentKey: 'help.gettingStarted.palette.content',
      },
      {
        titleKey: 'help.gettingStarted.navigation.title',
        contentKey: 'help.gettingStarted.navigation.content',
      },
      {
        titleKey: 'help.gettingStarted.desktop.title',
        contentKey: 'help.gettingStarted.desktop.content',
      },
    ],
  },
  {
    id: 'writing',
    titleKey: 'help.category.writing',
    icon: 'DOCUMENT_TEXT',
    articles: [
      {
        titleKey: 'help.writing.manuscript.title',
        contentKey: 'help.writing.manuscript.content',
        tryActionId: 'nav-manuscript',
      },
      {
        titleKey: 'help.writing.writer.title',
        contentKey: 'help.writing.writer.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.writing.templates.title',
        contentKey: 'help.writing.templates.content',
        tryActionId: 'nav-templates',
      },
      {
        titleKey: 'help.writing.outline.title',
        contentKey: 'help.writing.outline.content',
        tryActionId: 'nav-outline',
      },
      {
        titleKey: 'help.writing.sceneboard.title',
        contentKey: 'help.writing.sceneboard.content',
        tryActionId: 'nav-sceneboard',
      },
      {
        titleKey: 'help.writing.plotBoardV2.title',
        contentKey: 'help.writing.plotBoardV2.content',
        tryActionId: 'nav-sceneboard',
      },
      {
        titleKey: 'help.writing.ragHybrid.title',
        contentKey: 'help.writing.ragHybrid.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.writing.bookPreview.title',
        contentKey: 'help.writing.bookPreview.content',
      },
    ],
  },
  {
    id: 'worldbuilding',
    titleKey: 'help.category.worldbuilding',
    icon: 'WORLD',
    articles: [
      {
        titleKey: 'help.worldbuilding.characters.title',
        contentKey: 'help.worldbuilding.characters.content',
        tryActionId: 'nav-characters',
      },
      {
        titleKey: 'help.worldbuilding.worlds.title',
        contentKey: 'help.worldbuilding.worlds.content',
        tryActionId: 'nav-world',
      },
      {
        titleKey: 'help.worldbuilding.objects.title',
        contentKey: 'help.worldbuilding.objects.content',
      },
      {
        titleKey: 'help.worldbuilding.mindmaps.title',
        contentKey: 'help.worldbuilding.mindmaps.content',
      },
      {
        titleKey: 'help.worldbuilding.interviews.title',
        contentKey: 'help.worldbuilding.interviews.content',
      },
      {
        titleKey: 'help.worldbuilding.graph.title',
        contentKey: 'help.worldbuilding.graph.content',
        tryActionId: 'nav-character-graph',
      },
    ],
  },
  {
    id: 'ai-studio',
    titleKey: 'help.category.aiStudio',
    icon: 'SPARKLES',
    articles: [
      {
        titleKey: 'help.aiStudio.overview.title',
        contentKey: 'help.aiStudio.overview.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.aiStudio.tools.title',
        contentKey: 'help.aiStudio.tools.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.aiStudio.providers.title',
        contentKey: 'help.aiStudio.providers.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.aiStudio.ragContext.title',
        contentKey: 'help.aiStudio.ragContext.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.aiStudio.localAi.title',
        contentKey: 'help.aiStudio.localAi.content',
        // QNBS-v3: jump to Settings so users can open the new Local AI section (download/storage).
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.aiStudio.critic.title',
        contentKey: 'help.aiStudio.critic.content',
        tryActionId: 'nav-critic',
      },
      {
        titleKey: 'help.aiStudio.plotAi.title',
        contentKey: 'help.aiStudio.plotAi.content',
        tryActionId: 'nav-sceneboard',
      },
    ],
  },
  {
    id: 'analysis',
    titleKey: 'help.category.analysis',
    icon: 'LIGHTNING_BOLT',
    articles: [
      {
        titleKey: 'help.analysis.consistency.title',
        contentKey: 'help.analysis.consistency.content',
        tryActionId: 'nav-consistency',
      },
      { titleKey: 'help.analysis.progress.title', contentKey: 'help.analysis.progress.content' },
      {
        titleKey: 'help.analysis.health.title',
        contentKey: 'help.analysis.health.content',
        tryActionId: 'nav-dashboard',
      },
      {
        titleKey: 'help.analysis.crossProject.title',
        contentKey: 'help.analysis.crossProject.content',
      },
    ],
  },
  {
    id: 'management',
    titleKey: 'help.category.management',
    icon: 'SETTINGS',
    articles: [
      {
        titleKey: 'help.management.export.title',
        contentKey: 'help.management.export.content',
        tryActionId: 'nav-export',
      },
      {
        titleKey: 'help.management.data.title',
        contentKey: 'help.management.data.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.management.backupDashboard.title',
        contentKey: 'help.management.backupDashboard.content',
        tryActionId: 'nav-dashboard',
      },
      {
        titleKey: 'help.management.versionControl.title',
        contentKey: 'help.management.versionControl.content',
      },
      {
        titleKey: 'help.management.collaboration.title',
        contentKey: 'help.management.collaboration.content',
      },
    ],
  },
  {
    id: 'settings-guide',
    titleKey: 'help.category.settingsGuide',
    icon: 'SETTINGS',
    articles: [
      {
        titleKey: 'help.settingsGuide.overview.title',
        contentKey: 'help.settingsGuide.overview.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.ai.title',
        contentKey: 'help.settingsGuide.ai.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.accessibility.title',
        contentKey: 'help.settingsGuide.accessibility.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.backup.title',
        contentKey: 'help.settingsGuide.backup.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.flags.title',
        contentKey: 'help.settingsGuide.flags.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.shortcuts.title',
        contentKey: 'help.settingsGuide.shortcuts.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.settingsGuide.pwaInstall.title',
        contentKey: 'help.settingsGuide.pwaInstall.content',
        tryActionId: 'nav-settings',
      },
    ],
  },
  {
    // QNBS-v3: Advanced/power features that span Settings + AI — RTL, LoRA, ProForge, Voice,
    // encryption, cloud sync, plugins, adaptive AI. Discoverable in one place for power users.
    id: 'advanced',
    titleKey: 'help.category.advanced',
    icon: 'LIGHTNING_BOLT',
    articles: [
      {
        titleKey: 'help.advanced.languages.title',
        contentKey: 'help.advanced.languages.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.lora.title',
        contentKey: 'help.advanced.lora.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.proforge.title',
        contentKey: 'help.advanced.proforge.content',
        tryActionId: 'nav-writer',
      },
      {
        titleKey: 'help.advanced.voice.title',
        contentKey: 'help.advanced.voice.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.encryption.title',
        contentKey: 'help.advanced.encryption.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.cloudSync.title',
        contentKey: 'help.advanced.cloudSync.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.plugins.title',
        contentKey: 'help.advanced.plugins.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.advanced.adaptiveAi.title',
        contentKey: 'help.advanced.adaptiveAi.content',
        tryActionId: 'nav-settings',
      },
    ],
  },
  {
    id: 'documentation',
    titleKey: 'help.category.documentation',
    icon: 'HELP',
    articles: [
      { titleKey: 'help.docs.architecture.title', contentKey: 'help.docs.architecture.content' },
      { titleKey: 'help.docs.dataModel.title', contentKey: 'help.docs.dataModel.content' },
      { titleKey: 'help.docs.featureFlags.title', contentKey: 'help.docs.featureFlags.content' },
      { titleKey: 'help.docs.ragPipeline.title', contentKey: 'help.docs.ragPipeline.content' },
      { titleKey: 'help.docs.duckdb.title', contentKey: 'help.docs.duckdb.content' },
      { titleKey: 'help.docs.lazyLoading.title', contentKey: 'help.docs.lazyLoading.content' },
      { titleKey: 'help.docs.pwaDesktop.title', contentKey: 'help.docs.pwaDesktop.content' },
      {
        titleKey: 'help.docs.tauriDesktop.title',
        contentKey: 'help.docs.tauriDesktop.content',
        tryActionId: 'nav-settings',
      },
      { titleKey: 'help.docs.deployment.title', contentKey: 'help.docs.deployment.content' },
      {
        titleKey: 'help.docs.privacySecurity.title',
        contentKey: 'help.docs.privacySecurity.content',
      },
    ],
  },
  {
    id: 'pro-tips',
    titleKey: 'help.category.proTips',
    icon: 'LIGHTNING_BOLT',
    articles: [
      {
        titleKey: 'help.proTips.mentions.title',
        contentKey: 'help.proTips.mentions.content',
        tryActionId: 'nav-manuscript',
      },
      {
        titleKey: 'help.proTips.snapshots.title',
        contentKey: 'help.proTips.snapshots.content',
        tryActionId: 'nav-settings',
      },
      {
        titleKey: 'help.proTips.featureFlags.title',
        contentKey: 'help.proTips.featureFlags.content',
        tryActionId: 'nav-settings',
      },
      { titleKey: 'help.proTips.workflow.title', contentKey: 'help.proTips.workflow.content' },
    ],
  },
  {
    id: 'faq',
    titleKey: 'help.category.faq',
    icon: 'HELP',
    articles: [
      { titleKey: 'help.faq.saving.title', contentKey: 'help.faq.saving.content' },
      { titleKey: 'help.faq.api.title', contentKey: 'help.faq.api.content' },
      { titleKey: 'help.faq.privacy.title', contentKey: 'help.faq.privacy.content' },
      { titleKey: 'help.faq.offline.title', contentKey: 'help.faq.offline.content' },
      { titleKey: 'help.faq.providers.title', contentKey: 'help.faq.providers.content' },
    ],
  },
];

export function catalogToHelpCategories(): import('../../types').HelpCategory[] {
  return HELP_CATALOG.map((cat) => ({
    id: cat.id,
    title: cat.titleKey,
    icon: cat.icon,
    articles: cat.articles.map((a) => ({
      title: a.titleKey,
      content: a.contentKey,
      ...(a.tryActionId ? { tryActionId: a.tryActionId } : {}),
    })),
  }));
}
