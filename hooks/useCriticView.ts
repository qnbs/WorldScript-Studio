import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../app/hooks';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
  selectAiCreativity,
} from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { analyzeAsCritic, detectPlotHoles } from '../services/geminiService';

export const useCriticView = () => {
  const _dispatch = useAppDispatch();
  const { t, language } = useTranslation();
  const aiCreativity = useAppSelector(selectAiCreativity);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const projectData = useAppSelector(selectProjectData);

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
        const result = await analyzeAsCritic(text, aiCreativity, language, controller.signal);
        setAnalysisResult(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAnalysisResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsAnalyzing(false);
        abortControllerRef.current = null;
      }
    },
    [aiCreativity, language]
  );

  const detectPlotHolesFn = useCallback(async () => {
    if (!projectData) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    try {
      const result = await detectPlotHoles(
        JSON.stringify({
          title: projectData.title,
          logline: projectData.logline,
          manuscript: projectData.manuscript,
          characters,
          worlds,
        }),
        aiCreativity,
        language,
        controller.signal
      );
      setAnalysisResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setAnalysisResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  }, [projectData, characters, worlds, language, aiCreativity]);

  return {
    t,
    analysisResult,
    isAnalyzing,
    analyzeText,
    detectPlotHoles: detectPlotHolesFn,
  };
};
