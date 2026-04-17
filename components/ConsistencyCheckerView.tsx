import type { FC } from 'react';
import { useCallback } from 'react';
import {
  ConsistencyCheckerViewContext,
  useConsistencyCheckerViewContext,
} from '../contexts/ConsistencyCheckerViewContext';
import { useConsistencyCheckerView } from '../hooks/useConsistencyCheckerView';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
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
  } = useConsistencyCheckerViewContext();

  const handleCheck = useCallback(() => {
    if (selectedCharacterId) {
      runCheck(selectedCharacterId);
    }
  }, [selectedCharacterId, runCheck]);

  return (
    <div className="h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground-primary)]">
          {t('consistencyChecker.title')}
        </h1>
        <p className="text-[var(--foreground-secondary)] mt-2">
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
              >
                {isChecking ? <Spinner className="w-4 h-4 mr-2" /> : null}
                {t('consistencyChecker.checkButton')}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
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
                <p className="text-[var(--foreground-secondary)]">
                  {t('consistencyChecker.noResults')}
                </p>
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
