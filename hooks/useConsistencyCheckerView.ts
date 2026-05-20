import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import {
  selectAiCreativity,
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { embedText } from '../services/ai/localEmbeddingService';
import { generateText } from '../services/aiProviderService';
import { loadStoryCodex } from '../services/codexService';
import { getPrompts } from '../services/geminiService';
import { retrieveContext } from '../services/localRagService';
import { logger } from '../services/logger';
import type { CharacterRelationship, StoryCodex } from '../types';

export const useConsistencyCheckerView = () => {
  const { t, language } = useTranslation();
  const aiCreativity = useAppSelector(selectAiCreativity);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const projectData = useAppSelector(selectProjectData);
  const aiSettings = useAppSelector((state) => state.settings.advancedAi);
  const ragMode = useAppSelector((state) => state.settings.advancedAi.ragMode ?? 'hybrid');
  const duckDbEnabled = useAppSelector((state) => state.featureFlags.enableDuckDbAnalytics);
  const aiOptions = useMemo(
    () => ({
      provider: aiSettings.provider,
      model: aiSettings.model,
      temperature: aiSettings.temperature,
      maxTokens: aiSettings.maxTokens,
      ollamaBaseUrl: aiSettings.ollamaBaseUrl,
    }),
    [aiSettings],
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
        const codex = await loadStoryCodex(projectId);
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
  }, [projectData]);

  const runCheck = useCallback(
    async (characterId: string) => {
      if (!projectData) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsChecking(true);
      try {
        const projectId = projectData.id || 'default';
        const character = characters.find((c) => c.id === characterId);

        // QNBS-v3: retrieve relevant chunks so we avoid sending the full manuscript to the AI.
        let ragChunks: string | undefined;
        if (character) {
          try {
            let queryEmb: Float32Array | undefined;
            if (ragMode === 'hybrid') {
              queryEmb = await embedText(character.name).catch(() => undefined);
            }
            const chunks = await retrieveContext(
              projectId,
              character.name,
              8,
              ragMode,
              queryEmb,
              duckDbEnabled && ragMode === 'hybrid',
            );
            if (chunks.length > 0) {
              ragChunks = chunks.map((c) => c.text).join('\n\n---\n\n');
            }
          } catch (ragErr) {
            logger.warn('RAG retrieval failed (non-critical):', ragErr);
          }
        }

        const promptArgs: {
          characterId: string;
          characters: typeof characters;
          worlds: typeof worlds;
          manuscript: typeof projectData.manuscript;
          relationships: CharacterRelationship[];
          lang: string;
          codex?: StoryCodex;
          ragChunks?: string;
        } = {
          characterId,
          characters,
          worlds,
          manuscript: projectData.manuscript,
          relationships: projectData.relationships || [],
          lang: language,
          // QNBS-v3: conditional spread avoids exactOptionalPropertyTypes violation.
          ...(ragChunks !== undefined ? { ragChunks } : {}),
        };

        if (storyCodex) {
          promptArgs.codex = storyCodex;
        }

        const { prompt } = getPrompts('consistencyCheck', promptArgs);
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
    [
      characters,
      worlds,
      projectData,
      language,
      aiCreativity,
      aiOptions,
      storyCodex,
      ragMode,
      duckDbEnabled,
    ],
  );

  return {
    t,
    characters,
    selectedCharacterId,
    setSelectedCharacterId,
    checkResult,
    isChecking,
    runCheck,
    storyCodex,
  };
};
