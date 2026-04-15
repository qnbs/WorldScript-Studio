import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../app/hooks';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
  selectAiCreativity,
} from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { checkConsistency } from '../services/geminiService';

export const useConsistencyCheckerView = () => {
  const _dispatch = useAppDispatch();
  const { t, language } = useTranslation();
  const aiCreativity = useAppSelector(selectAiCreativity);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const projectData = useAppSelector(selectProjectData);

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<string>('');
  const [isChecking, setIsChecking] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const runCheck = useCallback(
    async (characterId: string) => {
      if (!projectData) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsChecking(true);
      try {
        const result = await checkConsistency(
          characterId,
          characters,
          worlds,
          projectData.manuscript,
          projectData.relationships || [],
          aiCreativity,
          language,
          controller.signal
        );
        setCheckResult(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCheckResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsChecking(false);
        abortControllerRef.current = null;
      }
    },
    [characters, worlds, projectData, language, aiCreativity]
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
