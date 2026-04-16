import { useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from './useTranslation';
import { useAppDispatch, useAppSelector, useAppSelectorShallow } from '../app/hooks';
import { logger } from '../services/logger';
import {
  selectProjectData,
  selectManuscript,
  selectAllCharacters,
} from '../features/project/projectSelectors';
import { writerActions } from '../features/writer/writerSlice';
import { projectActions, streamGenerationThunk } from '../features/project/projectSlice';

export const useWriterView = () => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const characters = useAppSelector(selectAllCharacters);
  const manuscript = useAppSelector(selectManuscript);
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

  // Ref to hold the abort controller for the current generation request
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedSectionId = useMemo(() => {
    // If there's a valid selection in state, use it. Otherwise, default to the first section.
    return writerState.selectedSectionId &&
      manuscript.some((s) => s.id === writerState.selectedSectionId)
      ? writerState.selectedSectionId
      : manuscript[0]?.id || null;
  }, [writerState.selectedSectionId, manuscript]);

  // Effect to dispatch the default selection if it's not set
  useEffect(() => {
    if (selectedSectionId && !writerState.selectedSectionId) {
      dispatch(writerActions.setSelectedSectionId(selectedSectionId));
    }
  }, [selectedSectionId, writerState.selectedSectionId, dispatch]);

  // Cleanup function to abort any pending requests when unmounting or changing view
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      dispatch(writerActions.stopLoading());
    };
  }, [dispatch]);

  const handleContentChange = useCallback(
    (index: number, content: string) => {
      const section = manuscript[index];
      if (!section) return;
      const sectionId = section.id;
      dispatch(projectActions.updateManuscriptSection({ id: sectionId, changes: { content } }));
    },
    [dispatch, manuscript]
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
        // The tone value is now directly used (either preset or custom)
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
        // Deutsch/Englisch automatisch, Prompt für Korrektur und Stilverbesserung
        return `Korrigiere Grammatik, Stil und Wiederholungen im folgenden Text. Behalte die Sprache des Originals (Deutsch/Englisch) bei. Liefere nur den verbesserten Text ohne weitere Erklärungen.\n\nText:\n"""\n${selection.text || content}\n"""\n`;

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
        // RAG context building
        const dChars = JSON.stringify(project.characters || []).substring(0, 50000);
        const dWorlds = JSON.stringify(project.worlds || []).substring(0, 50000);
        return `Prüfe auf Widersprüche zum bisherigen Wissen. Hier ist das Universe-Lore:

Characters:
${dChars}

Worlds:
${dWorlds}

Prüfe diesen Text:
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

  const handleGenerate = useCallback(() => {
    // If already loading, checking explicitly to act as a "Stop" toggle
    if (isLoading) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      dispatch(writerActions.stopLoading());
      return;
    }

    if (isGenerateDisabled()) return;

    // Create new controller
    abortControllerRef.current = new AbortController();

    const prompt = getPromptForTool();
    if (!prompt) return;

    dispatch(writerActions.startLoading());
    dispatch(writerActions.clearResultStream()); // Live-Preview reset
    let fullStream = '';

    const onChunk = (chunk: string) => {
      fullStream += chunk;
      // Dual-update: history für Accept-Button, resultStream für Live-Preview
      dispatch(writerActions.updateCurrentHistoryItem(fullStream));
      dispatch(writerActions.appendResultStream(chunk));
    };

    dispatch(writerActions.addHistory('')); // Add empty item to start

    dispatch(
      streamGenerationThunk({
        prompt,
        lang: language,
        onChunk,
      })
    )
      .unwrap()
      .catch((err) => {
        if (err.name !== 'AbortError') {
          logger.error('Generation failed', err);
          dispatch(
            writerActions.updateCurrentHistoryItem(
              'Error generating content. Please try again later or check your API key.'
            )
          );
        } else {
          dispatch(writerActions.updateCurrentHistoryItem(fullStream + ' [Cancelled]'));
        }
      })
      .finally(() => {
        dispatch(writerActions.stopLoading());
        abortControllerRef.current = null;
      });
  }, [dispatch, isLoading, isGenerateDisabled, getPromptForTool, language]);

  const handleNavigateHistory = useCallback(
    (direction: 'prev' | 'next') => {
      dispatch(writerActions.navigateHistory(direction));
    },
    [dispatch]
  );

  const handleUpdateScratchpad = useCallback(
    (text: string) => {
      dispatch(writerActions.updateCurrentHistoryItem(text));
    },
    [dispatch]
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
    ]
  );

  const projectForContext = useMemo(
    () => ({
      ...project,
      characters,
    }),
    [project, characters]
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
  };
};

export type UseWriterViewReturnType = ReturnType<typeof useWriterView>;
