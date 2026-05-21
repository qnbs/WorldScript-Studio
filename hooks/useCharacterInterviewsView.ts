import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import { selectEnableCharacterInterviews } from '../features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectCharacterInterviewsAll,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import {
  createNewInterview,
  streamInterviewResponseThunk,
} from '../features/project/thunks/interviewThunks';
import { storageService } from '../services/storageService';
import type { Character, CharacterArchetype, CharacterInterview } from '../types';

export interface UseCharacterInterviewsViewReturn {
  isEnabled: boolean;
  characters: Character[];
  selectedCharacterId: string | null;
  selectedInterviewId: string | null;
  selectedCharacter: Character | undefined;
  interviews: CharacterInterview[];
  selectedInterview: CharacterInterview | undefined;
  selectedArchetype: CharacterArchetype | null;
  isStreaming: boolean;
  hasAiKey: boolean;
  selectCharacter: (id: string) => void;
  selectInterview: (id: string) => void;
  selectArchetype: (a: CharacterArchetype) => void;
  startNewInterview: (title?: string) => void;
  deleteInterview: (interviewId: string) => void;
  sendQuestion: (question: string) => void;
  stopStreaming: () => void;
}

export function useCharacterInterviewsView(): UseCharacterInterviewsViewReturn {
  const dispatch = useAppDispatch();

  const isEnabled = useAppSelectorShallow(selectEnableCharacterInterviews);
  const characters = useAppSelectorShallow(selectAllCharacters);
  const allInterviews = useAppSelectorShallow(selectCharacterInterviewsAll);

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [selectedArchetype, setSelectedArchetype] = useState<CharacterArchetype | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasAiKey, setHasAiKey] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    storageService
      .getGeminiApiKey()
      .then((key) => {
        setHasAiKey(!!key && key !== 'DECRYPT_FAILED');
      })
      .catch(() => setHasAiKey(false));
  }, []);

  // QNBS-v3: per-character interviews derived without re-subscribing the whole allInterviews map
  const interviews = useMemo(
    () => (selectedCharacterId ? (allInterviews[selectedCharacterId] ?? []) : []),
    [allInterviews, selectedCharacterId],
  );

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId),
    [characters, selectedCharacterId],
  );

  const selectedInterview = useMemo(
    () => interviews.find((iv) => iv.id === selectedInterviewId),
    [interviews, selectedInterviewId],
  );

  const selectCharacter = useCallback((id: string) => {
    setSelectedCharacterId(id);
    setSelectedInterviewId(null);
    setSelectedArchetype(null);
  }, []);

  const selectInterview = useCallback((id: string) => {
    setSelectedInterviewId(id);
  }, []);

  const selectArchetype = useCallback((a: CharacterArchetype) => {
    setSelectedArchetype(a);
  }, []);

  const startNewInterview = useCallback(
    (title?: string) => {
      if (!selectedCharacterId || !selectedArchetype) return;
      const interview = createNewInterview(
        selectedCharacterId,
        selectedArchetype,
        `${selectedArchetype}-template`,
        title,
      );
      dispatch(
        projectActions.addCharacterInterview({ characterId: selectedCharacterId, interview }),
      );
      setSelectedInterviewId(interview.id);
    },
    [dispatch, selectedCharacterId, selectedArchetype],
  );

  const deleteInterview = useCallback(
    (interviewId: string) => {
      if (!selectedCharacterId) return;
      dispatch(
        projectActions.deleteCharacterInterview({
          characterId: selectedCharacterId,
          interviewId,
        }),
      );
      if (selectedInterviewId === interviewId) setSelectedInterviewId(null);
    },
    [dispatch, selectedCharacterId, selectedInterviewId],
  );

  const sendQuestion = useCallback(
    (question: string) => {
      if (!selectedCharacterId || !selectedInterviewId || isStreaming) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setIsStreaming(true);
      dispatch(
        streamInterviewResponseThunk({
          characterId: selectedCharacterId,
          interviewId: selectedInterviewId,
          question,
        }),
      ).finally(() => {
        setIsStreaming(false);
        abortRef.current = null;
      });
      // QNBS-v3: abort signal is threaded through the thunk via Redux signal mechanism; controller stored for stopStreaming
    },
    [dispatch, selectedCharacterId, selectedInterviewId, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    isEnabled,
    characters,
    selectedCharacterId,
    selectedInterviewId,
    selectedCharacter,
    interviews,
    selectedInterview,
    selectedArchetype,
    isStreaming,
    hasAiKey,
    selectCharacter,
    selectInterview,
    selectArchetype,
    startNewInterview,
    deleteInterview,
    sendQuestion,
    stopStreaming,
  };
}
