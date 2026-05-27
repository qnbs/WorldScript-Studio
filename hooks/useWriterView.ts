import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector, useAppSelectorShallow } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import {
  selectAllCharacters,
  selectManuscript,
  selectProjectData,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { streamGenerationThunk } from '../features/project/thunks/writingThunks';
import { writerActions } from '../features/writer/writerSlice';
import { isOrchestrationReadyProvider } from '../services/ai/orchestrationProviders';
import { logger } from '../services/logger';
import { assembleRAGPrompt } from '../services/ragPromptAssembly';
import { useStoryCraftAI } from './useStoryCraftAI';
import { useTranslation } from './useTranslation';

export const useWriterView = () => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const flowMode = useTransientUiStore((s) => s.flowMode);
  const setFlowMode = useTransientUiStore((s) => s.setFlowMode);
  const toggleFlowMode = useCallback(() => setFlowMode(!flowMode), [flowMode, setFlowMode]);
  const project = useAppSelector(selectProjectData);
  const characters = useAppSelector(selectAllCharacters);
  const manuscript = useAppSelector(selectManuscript);
  const aiProvider = useAppSelector((state) => state.settings?.advancedAi?.provider ?? undefined);
  const ragMode = useAppSelector((state) => state.settings?.advancedAi?.ragMode ?? 'hybrid');
  const duckDbEnabled = useAppSelector(
    (state) => state.featureFlags?.enableDuckDbAnalytics ?? false,
  );
  const writerState = useAppSelectorShallow((state) => state.writer);

  const {
    activeTool,
    selection,
    dialogueCharacters,
    scenario,
    brainstormContext,
    tone,
    style,
    isLoading,
    generationHistory,
    activeHistoryIndex,
  } = writerState;

  const abortControllerRef = useRef<AbortController | null>(null);
  const fullStreamRef = useRef('');

  const { runCompletion, stop: stopOrchestrationStreaming } = useStoryCraftAI({
    onIncremental: useCallback(
      (fullText: string, delta: string) => {
        fullStreamRef.current = fullText;
        dispatch(writerActions.updateCurrentHistoryItem(fullText));
        dispatch(writerActions.appendResultStream(delta));
      },
      [dispatch],
    ),
  });

  const selectedSectionId = useMemo(() => {
    return writerState.selectedSectionId &&
      manuscript.some((s) => s.id === writerState.selectedSectionId)
      ? writerState.selectedSectionId
      : manuscript[0]?.id || null;
  }, [writerState.selectedSectionId, manuscript]);

  useEffect(() => {
    if (selectedSectionId && !writerState.selectedSectionId) {
      dispatch(writerActions.setSelectedSectionId(selectedSectionId));
    }
  }, [selectedSectionId, writerState.selectedSectionId, dispatch]);

  useEffect(() => {
    return () => {
      stopOrchestrationStreaming();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      dispatch(writerActions.stopLoading());
    };
  }, [dispatch, stopOrchestrationStreaming]);

  const handleContentChange = useCallback(
    (index: number, content: string) => {
      const section = manuscript[index];
      if (!section) return;
      const sectionId = section.id;
      dispatch(projectActions.updateManuscriptSection({ id: sectionId, changes: { content } }));
    },
    [dispatch, manuscript],
  );

  const isGenerateDisabled = useCallback(() => {
    if (isLoading) return true;
    if (activeTool === 'improve' || activeTool === 'changeTone') return !selection.text;
    if (activeTool === 'dialogue') return dialogueCharacters.length === 0 || !scenario;
    return !selectedSectionId;
  }, [isLoading, activeTool, selection.text, dialogueCharacters, scenario, selectedSectionId]);

  const getPromptForTool = useCallback((): string => {
    const selectedSection = manuscript.find((s) => s.id === selectedSectionId);
    const content = selectedSection?.content || '';

    switch (activeTool) {
      case 'continue': {
        const context = content.substring(0, selection.start);
        return `Continue writing this story in a ${style || 'compelling'} style. Here is the last part:\n\n"${context}"`;
      }
      case 'improve':
        return `Improve the following text to be more ${style || 'engaging'}:\n\n"${selection.text}"`;
      case 'changeTone': {
        const selectedTone = tone || 'different';
        return `Rewrite the following text in a ${selectedTone} tone:\n\n"${selection.text}"`;
      }
      case 'dialogue': {
        const charNames = dialogueCharacters.map((c) => c.name).join(' and ');
        return `Write a piece of dialogue between ${charNames}. The scenario is: ${scenario}. The dialogue should be placed at the current cursor location in the text:\n\n${content}`;
      }
      case 'brainstorm': {
        const brainstormInput = brainstormContext || content;
        return `Brainstorm 3-5 interesting plot points or ideas for what could happen next, based on this context:\n\n"${brainstormInput}"`;
      }
      case 'synopsis':
        return `Write a concise, one-paragraph synopsis of the following text from a story. Capture the key events, character actions, and tone of the passage.\n\nText:\n"""\n${content}\n"""\n`;
      case 'grammarCheck':
        return `Correct grammar, style, and repetitions in the following text. Keep the original language (German/English). Provide only the improved text without further explanations.\n\nText:\n"""\n${selection.text || content}\n"""\n`;
      case 'critic':
        return `Act as a professional literary critic and editor. Analyze the following text for writing quality, character development, pacing, dialogue, and overall effectiveness. Give specific feedback.

Text to analyze:
"""
${content}
"""
`;
      case 'plotholes':
        return `Act as a detail-oriented story editor. Carefully analyze the following text for any logical inconsistencies, plot holes, continuity errors, or unresolved narrative threads. Be specific.

Text to analyze:
"""
${content}
"""
`;
      case 'consistency': {
        const dChars = JSON.stringify(project.characters || []).substring(0, 50000);
        const dWorlds = JSON.stringify(project.worlds || []).substring(0, 50000);
        return `Check for contradictions against the established lore. Here is the universe lore:

Characters:
${dChars}

Worlds:
${dWorlds}

Check this text:
"""
${content}
"""
`;
      }
      case 'imagePrompt': {
        const sceneText = selection.text || content.substring(0, 2000);
        return `You are an expert AI image prompt engineer for Midjourney and DALL·E 3.

Analyze the following scene from a story and generate ONE detailed, optimized image prompt that captures the mood, setting, characters, and atmosphere.

Scene:
"""
${sceneText}
"""

Output ONLY the image prompt — no explanation, no preamble. Format:
- For DALL·E 3: start with "A [style] [scene description], [lighting], [mood], [details], [art style], [camera angle if relevant]"
- For Midjourney: append "::2 [art style] --ar 16:9 --q 2 --stylize 750" at the end

Generate a single prompt that works for both tools. Be specific, vivid, and include:
- Art style (e.g., cinematic photography, digital painting, oil painting)
- Lighting (e.g., golden hour, dramatic shadows, soft diffused light)
- Mood/atmosphere (e.g., tense, ethereal, melancholic)
- Key visual details of characters and environment
- Camera perspective if relevant`;
      }
      default:
        return '';
    }
  }, [
    manuscript,
    selectedSectionId,
    activeTool,
    selection,
    style,
    tone,
    dialogueCharacters,
    scenario,
    brainstormContext,
    project,
  ]);

  const handleGenerate = useCallback(async () => {
    if (isLoading) {
      stopOrchestrationStreaming();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      dispatch(writerActions.stopLoading());
      return;
    }

    if (isGenerateDisabled()) return;

    const basePrompt = getPromptForTool();
    if (!basePrompt) return;

    abortControllerRef.current = new AbortController();

    const selectedSection = manuscript.find((s) => s.id === selectedSectionId);
    const projectId = project?.id || 'default';
    let fullPrompt = `${basePrompt}\n\nRespond in ${language === 'de' ? 'German' : 'English'}.`;

    const ragEligibleTools = new Set<typeof activeTool>(['continue', 'brainstorm', 'critic']);
    if (writerState.useRagContext && ragEligibleTools.has(activeTool) && project) {
      try {
        const assembled = await assembleRAGPrompt(
          'writerContinuation',
          {
            projectId,
            sectionId: selectedSectionId ?? undefined,
            sectionTitle: selectedSection?.title,
            currentText: selectedSection?.content ?? basePrompt,
            cursorPosition: selection.start,
            style: style || 'compelling',
            lang: language,
            manuscript,
          },
          {
            topK: 8,
            ragMode,
            maxTokens: 6000,
            duckDbEnabled,
            useRag: true,
          },
        );
        fullPrompt = assembled.prompt;
        dispatch(writerActions.setLastRagChunkCount(assembled.chunks.length));
      } catch (ragErr) {
        logger.warn('Writer RAG assembly failed, using base prompt:', ragErr);
        dispatch(writerActions.setLastRagChunkCount(0));
      }
    } else {
      dispatch(writerActions.setLastRagChunkCount(0));
    }

    dispatch(writerActions.startLoading());
    dispatch(writerActions.clearResultStream());
    fullStreamRef.current = '';
    dispatch(writerActions.addHistory(''));

    const handleFailure = (err: unknown) => {
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
      if (!isAbort) {
        logger.error('Generation failed', err);
        dispatch(
          writerActions.updateCurrentHistoryItem(
            'Error generating content. Please try again later or check your API key.',
          ),
        );
      } else {
        dispatch(writerActions.updateCurrentHistoryItem(`${fullStreamRef.current} [Cancelled]`));
      }
    };

    const orchestrationReady = isOrchestrationReadyProvider(aiProvider);
    if (orchestrationReady) {
      void runCompletion(fullPrompt)
        .catch(handleFailure)
        .finally(() => {
          dispatch(writerActions.stopLoading());
          abortControllerRef.current = null;
        });
      return;
    }

    let fullStream = '';
    const onChunk = (chunk: string) => {
      fullStream += chunk;
      fullStreamRef.current = fullStream;
      dispatch(writerActions.updateCurrentHistoryItem(fullStream));
      dispatch(writerActions.appendResultStream(chunk));
    };

    dispatch(streamGenerationThunk({ prompt: fullPrompt, lang: language, onChunk }))
      .unwrap()
      .catch(handleFailure)
      .finally(() => {
        dispatch(writerActions.stopLoading());
        abortControllerRef.current = null;
      });
  }, [
    dispatch,
    isLoading,
    isGenerateDisabled,
    getPromptForTool,
    language,
    aiProvider,
    runCompletion,
    stopOrchestrationStreaming,
    writerState.useRagContext,
    ragMode,
    duckDbEnabled,
    manuscript,
    project,
    selectedSectionId,
    selection.start,
    style,
    activeTool,
  ]);

  const handleNavigateHistory = useCallback(
    (direction: 'prev' | 'next') => {
      dispatch(writerActions.navigateHistory(direction));
    },
    [dispatch],
  );

  const handleUpdateScratchpad = useCallback(
    (text: string) => {
      dispatch(writerActions.updateCurrentHistoryItem(text));
    },
    [dispatch],
  );

  const handleAccept = useCallback(
    (action: 'insert' | 'replace') => {
      const selectedSectionIndex = manuscript.findIndex((s) => s.id === selectedSectionId);
      if (selectedSectionIndex === -1) return;

      const section = manuscript[selectedSectionIndex];
      if (!section) return;
      const currentResult = generationHistory[activeHistoryIndex] || '';

      const newContent =
        action === 'insert'
          ? section.content.substring(0, selection.start) +
            currentResult +
            section.content.substring(selection.start)
          : section.content.substring(0, selection.start) +
            currentResult +
            section.content.substring(selection.end);

      handleContentChange(selectedSectionIndex, newContent);
    },
    [
      manuscript,
      selectedSectionId,
      generationHistory,
      activeHistoryIndex,
      selection,
      handleContentChange,
    ],
  );

  const projectForContext = useMemo(
    () => ({
      ...project,
      characters,
    }),
    [project, characters],
  );

  return {
    t,
    project: projectForContext,
    writerState,
    selectedSectionId,
    dispatch,
    handleContentChange,
    isGenerateDisabled,
    handleGenerate,
    handleNavigateHistory,
    handleUpdateScratchpad,
    handleAccept,
    flowMode,
    toggleFlowMode,
  };
};

export type UseWriterViewReturnType = ReturnType<typeof useWriterView>;
