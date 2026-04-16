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
import { dbService } from '../services/dbService';
import type { StoryCodex } from '../types';

export const useConsistencyCheckerView = () => {
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

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<string>('');
  const [isChecking, setIsChecking] = useState(false);
  const [storyCodex, setStoryCodex] = useState<StoryCodex | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const projectId = projectData?.id || 'default';

    const loadCodex = async () => {
      if (!projectData) {
        setStoryCodex(null);
        return;
      }
      try {
        const codex = await dbService.getStoryCodex(projectId);
        if (!cancelled) {
          setStoryCodex(codex);
        }
      } catch {
        if (!cancelled) {
          setStoryCodex(null);
        }
      }
    };

    loadCodex();

    return () => {
      cancelled = true;
    };
  }, [projectData?.id, projectData?.manuscript]);

  const runCheck = useCallback(
    async (characterId: string) => {
      if (!projectData) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsChecking(true);
      try {
        const promptArgs: Record<string, unknown> = {
          characterId,
          characters,
          worlds,
          manuscript: projectData.manuscript,
          relationships: projectData.relationships || [],
          lang: language,
        };

        if (storyCodex) {
          promptArgs.codex = storyCodex;
        }

        const { prompt } = getPrompts('consistencyCheck', promptArgs as any);
        const result = await generateText(prompt, aiCreativity, aiOptions, controller.signal);
        setCheckResult(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCheckResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsChecking(false);
        abortControllerRef.current = null;
      }
    },
    [characters, worlds, projectData, language, aiCreativity, aiOptions, storyCodex]
  );

  return {
    t,
    characters,
    selectedCharacterId,
    setSelectedCharacterId,
    checkResult,
    isChecking,
    runCheck,
  };
};
