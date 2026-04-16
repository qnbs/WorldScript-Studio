import type { FC } from 'react';
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { Spinner } from './ui/Spinner';
import { useCriticView } from '../hooks/useCriticView';
import { CriticViewContext, useCriticViewContext } from '../contexts/CriticViewContext';

const CriticUI: FC = () => {
  const { t, analysisResult, isAnalyzing, analyzeText, detectPlotHoles } = useCriticViewContext();
  const [inputText, setInputText] = useState('');

  const handleAnalyze = useCallback(() => {
    if (inputText.trim()) {
      analyzeText(inputText);
    }
  }, [inputText, analyzeText]);

  const handlePlotHoles = useCallback(() => {
    detectPlotHoles();
  }, [detectPlotHoles]);

  return (
    <div className="h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground-primary)]">{t('critic.title')}</h1>
        <p className="text-[var(--foreground-secondary)] mt-2">{t('critic.description')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('critic.textAnalysis')}</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={t('critic.textPlaceholder')}
                rows={8}
              />
              <Button
                onClick={handleAnalyze}
                disabled={!inputText.trim() || isAnalyzing}
                className="w-full"
              >
                {isAnalyzing ? <Spinner className="w-4 h-4 mr-2" /> : null}
                {t('critic.analyzeButton')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('critic.plotAnalysis')}</h3>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handlePlotHoles}
                disabled={isAnalyzing}
                variant="outline"
                className="w-full"
              >
                {isAnalyzing ? <Spinner className="w-4 h-4 mr-2" /> : null}
                {t('critic.detectPlotHoles')}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('critic.results')}</h3>
            </CardHeader>
            <CardContent>
              {analysisResult ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm">{analysisResult}</pre>
                </div>
              ) : (
                <p className="text-[var(--foreground-secondary)]">{t('critic.noResults')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export const CriticView: FC = () => {
  const contextValue = useCriticView();
  return (
    <CriticViewContext.Provider value={contextValue}>
      <CriticUI />
    </CriticViewContext.Provider>
  );
};
