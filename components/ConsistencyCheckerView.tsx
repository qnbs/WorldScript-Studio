import type { FC } from 'react';
import { useCallback } from 'react';
import {
  ConsistencyCheckerViewContext,
  useConsistencyCheckerViewContext,
} from '../contexts/ConsistencyCheckerViewContext';
import { useConsistencyCheckerView } from '../hooks/useConsistencyCheckerView';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionIcon } from './ui/SectionIcon';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';

const ConsistencyCheckerUI: FC = () => {
  const {
    t,
    characters,
    selectedCharacterId,
    setSelectedCharacterId,
    checkResult,
    isChecking,
    runCheck,
    storyCodex,
  } = useConsistencyCheckerViewContext();

  const handleCheck = useCallback(() => {
    if (selectedCharacterId) {
      runCheck(selectedCharacterId);
    }
  }, [selectedCharacterId, runCheck]);

  return (
    <div className="h-full">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <SectionIcon section="consistencyChecker" size="lg" />
          <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">
            {t('consistencyChecker.title')}
          </h1>
        </div>
        <p className="text-[var(--sc-text-secondary)] mt-2">
          {t('consistencyChecker.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('consistencyChecker.selectCharacter')}</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={selectedCharacterId || ''}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
              >
                {characters.map((char) => (
                  <option key={char.id} value={char.id}>
                    {char.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={handleCheck}
                disabled={!selectedCharacterId || isChecking}
                className="w-full"
                type="button"
              >
                {isChecking ? <Spinner className="w-4 h-4 mr-2" /> : null}
                {t('consistencyChecker.checkButton')}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {storyCodex ? (
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">
                  {t('consistencyChecker.storyBible.title')}
                </h3>
              </CardHeader>
              <CardContent className="space-y-4">
                {storyCodex.consistencyHints && storyCodex.consistencyHints.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2">
                      {t('consistencyChecker.storyBible.hintsTitle')}
                    </h4>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {storyCodex.consistencyHints.map((h) => (
                        <li
                          key={h.id}
                          className={h.severity === 'warn' ? 'text-[var(--sc-warning-fg)]' : ''}
                        >
                          {h.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {storyCodex.relationshipEdges && storyCodex.relationshipEdges.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2">
                      {t('consistencyChecker.storyBible.edgesTitle')}
                    </h4>
                    <ul className="space-y-1 text-sm font-mono">
                      {storyCodex.relationshipEdges.slice(0, 12).map((e) => {
                        const name = (id: string) =>
                          storyCodex.entities.find((x) => x.id === id)?.name ?? id;
                        const key = `${e.sourceEntityId}-${e.targetEntityId}-${e.sectionIds.slice().sort().join(',')}`;
                        return (
                          <li key={key}>
                            {name(e.sourceEntityId)} ↔ {name(e.targetEntityId)} · {e.weight}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {!storyCodex.consistencyHints?.length && !storyCodex.relationshipEdges?.length ? (
                  <p className="text-sm text-[var(--sc-text-muted)]">
                    {t('consistencyChecker.storyBible.empty')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="h-full">
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('consistencyChecker.results')}</h3>
            </CardHeader>
            <CardContent>
              {checkResult ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm">{checkResult}</pre>
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-8 h-8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                  }
                  title={t('consistencyChecker.noResults')}
                  description={t('consistencyChecker.noResultsHint')}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export const ConsistencyCheckerView: FC = () => {
  const contextValue = useConsistencyCheckerView();
  return (
    <ConsistencyCheckerViewContext.Provider value={contextValue}>
      <ConsistencyCheckerUI />
    </ConsistencyCheckerViewContext.Provider>
  );
};
