import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { SETTINGS_CATEGORY_SEARCH_HINTS } from '../../services/settingsSearchHints';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

const GUIDE_CATEGORIES: { id: string; titleKey: string; descKey: string }[] = [
  {
    id: 'general',
    titleKey: 'settings.guide.general.title',
    descKey: 'settings.guide.general.desc',
  },
  {
    id: 'appearance',
    titleKey: 'settings.guide.appearance.title',
    descKey: 'settings.guide.appearance.desc',
  },
  { id: 'editor', titleKey: 'settings.guide.editor.title', descKey: 'settings.guide.editor.desc' },
  {
    id: 'advanced-editor',
    titleKey: 'settings.guide.advancedEditor.title',
    descKey: 'settings.guide.advancedEditor.desc',
  },
  { id: 'ai', titleKey: 'settings.guide.ai.title', descKey: 'settings.guide.ai.desc' },
  // QNBS-v3: Local AI is a live AI-Models nav category — document on-device download/storage/fallback.
  {
    id: 'local-ai',
    titleKey: 'settings.guide.localAi.title',
    descKey: 'settings.guide.localAi.desc',
  },
  {
    id: 'advanced-ai',
    titleKey: 'settings.guide.advancedAi.title',
    descKey: 'settings.guide.advancedAi.desc',
  },
  // QNBS-v3: Fine-Tuning is a live AI-Models nav category — was undocumented in the guide.
  {
    id: 'lora-adapters',
    titleKey: 'settings.guide.loraAdapters.title',
    descKey: 'settings.guide.loraAdapters.desc',
  },
  {
    id: 'project-ai',
    titleKey: 'settings.guide.projectAi.title',
    descKey: 'settings.guide.projectAi.desc',
  },
  {
    id: 'accessibility',
    titleKey: 'settings.guide.accessibility.title',
    descKey: 'settings.guide.accessibility.desc',
  },
  {
    id: 'privacy',
    titleKey: 'settings.guide.privacy.title',
    descKey: 'settings.guide.privacy.desc',
  },
  {
    id: 'performance',
    titleKey: 'settings.guide.performance.title',
    descKey: 'settings.guide.performance.desc',
  },
  {
    id: 'notifications',
    titleKey: 'settings.guide.notifications.title',
    descKey: 'settings.guide.notifications.desc',
  },
  {
    id: 'collaboration',
    titleKey: 'settings.guide.collaboration.title',
    descKey: 'settings.guide.collaboration.desc',
  },
  {
    id: 'integrations',
    titleKey: 'settings.guide.integrations.title',
    descKey: 'settings.guide.integrations.desc',
  },
  // QNBS-v3: Community is a live Connections nav category — was undocumented in the guide.
  {
    id: 'community',
    titleKey: 'settings.guide.community.title',
    descKey: 'settings.guide.community.desc',
  },
  { id: 'backup', titleKey: 'settings.guide.backup.title', descKey: 'settings.guide.backup.desc' },
  { id: 'data', titleKey: 'settings.guide.data.title', descKey: 'settings.guide.data.desc' },
  // QNBS-v3: Plugins is a live System nav category — was undocumented in the guide.
  {
    id: 'plugins',
    titleKey: 'settings.guide.plugins.title',
    descKey: 'settings.guide.plugins.desc',
  },
  {
    id: 'experimental',
    titleKey: 'settings.guide.experimental.title',
    descKey: 'settings.guide.experimental.desc',
  },
  {
    id: 'shortcuts',
    titleKey: 'settings.guide.shortcuts.title',
    descKey: 'settings.guide.shortcuts.desc',
  },
  { id: 'about', titleKey: 'settings.guide.about.title', descKey: 'settings.guide.about.desc' },
];

/** In-app map of every settings category with jump links. */
export const SettingsGuideSection: FC = () => {
  const { t, setActiveCategory } = useSettingsViewContext();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.guide.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">{t('settings.guide.intro')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {GUIDE_CATEGORIES.map((cat) => {
            const searchHints = SETTINGS_CATEGORY_SEARCH_HINTS[cat.id];
            return (
              <div
                key={cat.id}
                className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 p-3 rounded-lg border border-[var(--sc-border-subtle)]"
              >
                <div className="min-w-0">
                  <h3 className="font-medium text-[var(--sc-text-primary)]">{t(cat.titleKey)}</h3>
                  <p className="text-sm text-[var(--sc-text-secondary)] mt-1">{t(cat.descKey)}</p>
                  {searchHints && searchHints.length > 0 && (
                    <p className="text-xs text-[var(--sc-text-muted)] mt-2">
                      {t('settings.guide.searchHints')}: {searchHints.slice(0, 6).join(', ')}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {t('settings.guide.openCategory')}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};
