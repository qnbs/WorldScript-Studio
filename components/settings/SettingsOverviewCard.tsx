import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

/** Quick links at top of General settings. */
export const SettingsOverviewCard: FC = () => {
  const { t, setActiveCategory } = useSettingsViewContext();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {t('settings.overview.title')}
        </h2>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setActiveCategory('guide')}
        >
          {t('settings.overview.openGuide')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setActiveCategory('ai')}>
          {t('settings.categories.ai')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setActiveCategory('backup')}
        >
          {t('settings.categories.backup')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setActiveCategory('experimental')}
        >
          {t('settings.categories.experimental')}
        </Button>
      </CardContent>
    </Card>
  );
};
