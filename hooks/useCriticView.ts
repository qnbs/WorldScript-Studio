import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppSelector } from '../app/hooks';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
  selectAiCreativity,
} from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { getPrompts } from '../services/geminiService';
import { generateText } from '../services/aiProviderService';

export const useCriticView = () => {
  const { t, language } = useTranslation();
  const aiCreativity = useAppSelector(selectAiCreativity);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const projectData = useAppSelector(selectProjectData);
  const aiSettings = useAppSelector((state) => state.settings.advancedAi);
  const aiOptions = useMemo(
    () => ({
      provider: aiSettings.provider,
      model: aiSettings.model,
      temperature: aiSettings.temperature,
      maxTokens: aiSettings.maxTokens,
      ollamaBaseUrl: aiSettings.ollamaBaseUrl,
    }),
    [aiSettings]
  );

  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const analyzeText = useCallback(
    async (text: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsAnalyzing(true);
      try {
        const { prompt } = getPrompts('criticAnalysis', { text, lang: language });
        const result = await generateText(prompt, aiCreativity, aiOptions, controller.signal);
        setAnalysisResult(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAnalysisResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsAnalyzing(false);
        abortControllerRef.current = null;
      }
    },
    [aiCreativity, language, aiOptions]
  );

  const detectPlotHolesFn = useCallback(async () => {
    if (!projectData) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    try {
      const { prompt } = getPrompts('plotHoleDetection', {
        text: JSON.stringify({
          title: projectData.title,
          logline: projectData.logline,
          manuscript: projectData.manuscript,
          characters,
          worlds,
        }),
        lang: language,
      });
      const result = await generateText(prompt, aiCreativity, aiOptions, controller.signal);
      setAnalysisResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setAnalysisResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  }, [projectData, characters, worlds, language, aiCreativity, aiOptions]);

  return {
    t,
    analysisResult,
    isAnalyzing,
    analyzeText,
    detectPlotHoles: detectPlotHolesFn,
  };
};
