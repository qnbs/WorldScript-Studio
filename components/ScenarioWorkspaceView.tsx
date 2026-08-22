import type { FC } from 'react';
import { useAppSelector } from '../app/hooks';
import { selectProjectData } from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { buildScenarioWorkspaceProjection } from '../services/scenarioWorkspaceProjection';
import type { View } from '../types';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { PageContainer } from './ui/PageContainer';
import { SectionIcon } from './ui/SectionIcon';

interface ScenarioWorkspaceViewProps {
  onNavigate: (view: View) => void;
}

const ProjectionCard: FC<{
  label: string;
  count: number;
  view: View;
  onNavigate: (view: View) => void;
}> = ({ label, count, view, onNavigate }) => (
  <Card className="h-full">
    <CardContent className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--sc-text-primary)]">{label}</h2>
        <span
          className="text-2xl font-bold text-[var(--sc-accent)]"
        >
          {count}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={() => onNavigate(view)} className="mt-auto">
        {label}
      </Button>
    </CardContent>
  </Card>
);

export const ScenarioWorkspaceView: FC<ScenarioWorkspaceViewProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const project = useAppSelector(selectProjectData);

  if (!project) return null;
  // QNBS-v3: Render a read-only projection so canonical project state stays authoritative.
  const projection = buildScenarioWorkspaceProjection(project);

  return (
    <PageContainer width="wide" className="space-y-6">
      <header className="flex items-start gap-4">
        <SectionIcon section="scenario" size="lg" />
        <div>
          <p className="text-sm font-medium text-[var(--sc-text-muted)]">{projection.title}</p>
          <h1 className="text-3xl font-bold text-[var(--sc-text-primary)]">
            {t('sidebar.scenario')}
          </h1>
        </div>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('dashboard.details.logline')}
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-[var(--sc-text-secondary)]">
            {projection.logline || t('dashboard.noLogline')}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <ProjectionCard
          label={t('sidebar.characters')}
          count={projection.counts.characters}
          view="characters"
          onNavigate={onNavigate}
        />
        <ProjectionCard
          label={t('sidebar.world')}
          count={projection.counts.worlds}
          view="world"
          onNavigate={onNavigate}
        />
        <ProjectionCard
          label={t('sidebar.outline')}
          count={projection.counts.outline}
          view="outline"
          onNavigate={onNavigate}
        />
        <ProjectionCard
          label={t('sidebar.sceneboard')}
          count={projection.counts.scenes}
          view="sceneboard"
          onNavigate={onNavigate}
        />
        <ProjectionCard
          label={t('sidebar.manuscript')}
          count={projection.counts.words}
          view="manuscript"
          onNavigate={onNavigate}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('sidebar.manuscript')}
          </h2>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" aria-label={t('sidebar.manuscript')}>
            {projection.sections.map((section) => (
              <li
                key={section.id}
                className="rounded-sc-lg border border-[var(--sc-border-subtle)] p-3"
              >
                <p className="font-medium text-[var(--sc-text-primary)]">{section.title}</p>
                {section.summary && (
                  <p className="mt-1 text-sm text-[var(--sc-text-muted)]">{section.summary}</p>
                )}
              </li>
            ))}
          </ul>
          {projection.sections.length === 0 && (
            <p className="text-[var(--sc-text-muted)]">{t('empty.manuscript.description')}</p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
};