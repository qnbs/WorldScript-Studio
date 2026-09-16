import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector, useAppSelectorShallow } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import {
  captureActiveProjectIdentity,
  getProjectTargetIdentity,
  identityUnchanged,
} from '../features/project/projectIdentity';
import {
  selectAllCharacters,
  selectManuscript,
  selectProjectData,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { streamGenerationThunk } from '../features/project/thunks/writingThunks';
import { type RagChunkPreview, writerActions } from '../features/writer/writerSlice';
import { getAiErrorMessage } from '../services/ai/aiErrorTaxonomy';
import { aiUsageTracker } from '../services/ai/aiUsageTracker';
import { isOrchestrationReadyProvider } from '../services/ai/orchestrationProviders';
import { logger } from '../services/logger';
import { assembleRAGPrompt } from '../services/ragPromptAssembly';
import { useTranslation } from './useTranslation';
import { useWorldScriptAI } from './useWorldScriptAI';

export const useWriterView = () => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const flowMode = useTransientUiStore((s) => s.flowMode);
  const setFlowMode = useTransientUiStore((s) => s.setFlowMode);
  const toggleFlowMode = useCallback(() => setFlowMode(!flowMode), [flowMode, setFlowMode]);
  const project = useAppSelector(selectProjectData);
  // QNBS-v3: optional chaining -- getProjectTargetIdentity already handles null/undefined (fail-closed to null), and some mounted contexts (e.g. minimal test stores) may not have a project key at all.
  const projectIdentity = useAppSelector((state) =>
    getProjectTargetIdentity(state.project?.present),
  );
  // QNBS-v3 (#713): two different id-less project replacements both resolve to identity null, which projectIdentity alone can't tell apart -- combined with generation (which always bumps on import/restore) for the stream-cancellation effect below (fail-closed, mirrors app/listenerMiddleware.ts's predicate).
  const projectGeneration = useAppSelector((state) => state.project?.present?.generation ?? 0);
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
  // QNBS-v3 (#713): the identity a currently in-flight generation targets -- checked live inside the streaming callbacks below since they're shared/stable and don't otherwise know which request they belong to.
  const writerTargetIdentityRef = useRef<string | null>(null);
  // QNBS-v3 (#713): a project switch resets isLoading (via invalidateForProjectChange), letting a NEW generation start while an old one is still settling in the background (the legacy streamGenerationThunk path has no true cancellation) -- this makes completion cleanup request-scoped so a stale finally() can never clear a newer request's loading/abort-controller state.
  const writerRequestRef = useRef(0);

  const { runCompletion, stop: stopOrchestrationStreaming } = useWorldScriptAI({
    source: 'writer',
    onIncremental: useCallback(
      (fullText: string, delta: string) => {
        // QNBS-v3 (#713): discard a stale stream chunk if the project changed since this generation started.
        if (!identityUnchanged(writerTargetIdentityRef.current, captureActiveProjectIdentity())) {
          return;
        }
        fullStreamRef.current = fullText;
        dispatch(writerActions.updateCurrentHistoryItem(fullText));
        dispatch(writerActions.appendResultStream(delta));
      },
      [dispatch],
    ),
  });

  // QNBS-v3 (#713): combines identity + generation (not identity alone) since two different id-less project replacements both resolve to identity null -- genuinely read (compare-against-previous-value) so no lint suppression is needed.
  const writerInvalidationKey = `${projectIdentity ?? ''}:${projectGeneration}`;
  const prevWriterIdentityRef = useRef(writerInvalidationKey);
  // QNBS-v3 (#713): actually cancel the in-flight stream on a project switch -- invalidateForProjectChange (listener middleware) only resets Redux state; without this, the old stream keeps running and its callbacks (guarded above) become no-ops at best, while still wasting the request.
  useEffect(() => {
    if (prevWriterIdentityRef.current === writerInvalidationKey) return;
    prevWriterIdentityRef.current = writerInvalidationKey;
    stopOrchestrationStreaming();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [writerInvalidationKey, stopOrchestrationStreaming]);

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

    // QNBS-v3 (#713): captured before the RAG await (not after) so a project switch during RAG assembly is caught by the live re-check below instead of silently recording the NEW project's identity for a prompt built from the OLD project's data.
    const capturedProjectIdentity = captureActiveProjectIdentity();
    writerTargetIdentityRef.current = capturedProjectIdentity;
    const requestId = ++writerRequestRef.current;

    // QNBS-v3 (CodeAnt): clear the previous request's writer-scoped token usage up front. Only the
    // orchestration path (worldScriptCompletionFetch onFinish) reports usage; when the Writer falls
    // back to the legacy streamGenerationThunk/aiProviderService path no usage arrives, so without
    // this the badge would keep showing a stale count from an earlier request.
    aiUsageTracker.clear('writer');

    const basePrompt = getPromptForTool();
    if (!basePrompt) return;

    abortControllerRef.current = new AbortController();

    const selectedSection = manuscript.find((s) => s.id === selectedSectionId);
    const projectId = project?.id || 'default';
    let fullPrompt = `${basePrompt}\n\nRespond in ${language === 'de' ? 'German' : 'English'}.`;

    const ragEligibleTools = new Set<typeof activeTool>(['continue', 'brainstorm', 'critic']);
    let ragChunksToStore: RagChunkPreview[] = [];
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
        ragChunksToStore = assembled.chunks.map((c) => ({
          sectionId: c.sectionId,
          chunkIndex: c.chunkIndex,
          score: c.score,
          snippet: c.text.slice(0, 160),
        }));
      } catch (ragErr) {
        logger.warn('Writer RAG assembly failed, using base prompt:', ragErr);
      }
    }

    // QNBS-v3 (#713): checked once, right after the only await above (RAG assembly), and BEFORE any dispatch -- otherwise stale RAG chunk previews assembled from the old project get written into Redux even though generation itself is aborted right after.
    if (!identityUnchanged(capturedProjectIdentity, captureActiveProjectIdentity())) return;

    // QNBS-v3: PR4 — store chunk previews (section, score, snippet) for the transparency inspector.
    dispatch(writerActions.setLastRagChunks(ragChunksToStore));
    // QNBS-v3 (#713): the captured (pre-RAG) identity, so handleAccept can later verify the generation it's applying still targets the active project -- writerSlice is global Redux and survives a Writer-view unmount/remount across a project switch.
    dispatch(writerActions.startLoading(capturedProjectIdentity));
    dispatch(writerActions.clearResultStream());
    fullStreamRef.current = '';
    dispatch(writerActions.addHistory(''));

    const handleFailure = (err: unknown) => {
      // QNBS-v3 (#713): discard a stale failure if the project changed OR a newer same-project request has already started (the requestId check the identity check alone can't cover).
      if (
        writerRequestRef.current !== requestId ||
        !identityUnchanged(writerTargetIdentityRef.current, captureActiveProjectIdentity())
      ) {
        return;
      }
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
      if (!isAbort) {
        logger.error('Generation failed', err);
        // QNBS-v3 (Phase 1): classified, localized recovery hint instead of a hardcoded English
        // string — mirrors the Copilot (Batch 1.2).
        dispatch(writerActions.updateCurrentHistoryItem(getAiErrorMessage(err, t)));
      } else {
        dispatch(
          writerActions.updateCurrentHistoryItem(
            `${fullStreamRef.current} [${t('writer.cancelledTag')}]`,
          ),
        );
      }
    };

    // QNBS-v3 (#713): only the still-current request may clear the shared loading/abort-controller state -- a project switch resets isLoading, letting a NEW request start while an old one (still settling in the background, e.g. the legacy path below has no true cancellation) would otherwise clobber it on completion.
    const finishRequest = () => {
      if (writerRequestRef.current === requestId) {
        dispatch(writerActions.stopLoading());
        abortControllerRef.current = null;
      }
    };

    const orchestrationReady = isOrchestrationReadyProvider(aiProvider);
    if (orchestrationReady) {
      void runCompletion(fullPrompt).catch(handleFailure).finally(finishRequest);
      return;
    }

    let fullStream = '';
    const onChunk = (chunk: string) => {
      // QNBS-v3 (#713): discard a stale stream chunk if the project changed since this generation started.
      if (!identityUnchanged(writerTargetIdentityRef.current, captureActiveProjectIdentity())) {
        return;
      }
      fullStream += chunk;
      fullStreamRef.current = fullStream;
      dispatch(writerActions.updateCurrentHistoryItem(fullStream));
      dispatch(writerActions.appendResultStream(chunk));
    };

    dispatch(streamGenerationThunk({ prompt: fullPrompt, lang: language, onChunk }))
      .unwrap()
      .catch(handleFailure)
      .finally(finishRequest);
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
    t,
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
      // QNBS-v3 (#713): reject applying a generation that targeted a different project incarnation -- writerSlice is global Redux, so a stale generationHistory entry can otherwise outlive a project switch and get inserted into the wrong project's manuscript.
      if (
        !identityUnchanged(writerState.generatedForProjectIdentity, captureActiveProjectIdentity())
      ) {
        return;
      }
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
      writerState.generatedForProjectIdentity,
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
