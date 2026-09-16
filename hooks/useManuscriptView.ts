import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { useToast } from '../components/ui/Toast';
import {
  captureActiveProjectIdentity,
  getProjectTargetIdentity,
  identityUnchanged,
  isExpectedAiCancellationError,
  isStaleProjectOperationError,
} from '../features/project/projectIdentity';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import {
  generateLoglineSuggestionsThunk,
  generateSceneImageThunk,
  proofreadTextThunk,
} from '../features/project/thunks/writingThunks';
import type { Character, View, World } from '../types';
import { useTranslation } from './useTranslation';

// Helper to get cursor coords in textarea. This is a robust way to handle it.
const getCursorXY = (input: HTMLTextAreaElement, selectionPoint: number) => {
  const mirror = document.createElement('div');
  const style = getComputedStyle(input);

  // Properties that affect layout and position
  const props: (keyof CSSStyleDeclaration)[] = [
    'width',
    'height',
    'font',
    'lineHeight',
    'padding',
    'border',
    'textIndent',
    'whiteSpace',
    'wordWrap',
    'wordBreak',
    'letterSpacing',
    'textAlign',
  ];
  props.forEach((prop) => {
    const key = prop as string;
    const value = style.getPropertyValue(key);
    if (value) {
      mirror.style.setProperty(key, value);
    }
  });

  // Make it invisible and position it off-screen
  mirror.style.position = 'absolute';
  mirror.style.left = '-9999px';
  mirror.style.top = '0px';
  mirror.style.height = 'auto'; // allow it to grow

  document.body.appendChild(mirror);

  mirror.textContent = input.value.substring(0, selectionPoint);

  const marker = document.createElement('span');
  marker.textContent = '|'; // Use a character to prevent collapsing
  mirror.appendChild(marker);

  const inputRect = input.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();

  document.body.removeChild(mirror);

  // Calculate position relative to the textarea, accounting for scroll
  return {
    top: markerRect.top - inputRect.top + input.scrollTop,
    left: markerRect.left - inputRect.left + input.scrollLeft,
    height: markerRect.height,
  };
};

export const useManuscriptView = ({
  onNavigate: _onNavigate,
}: {
  onNavigate: (view: View) => void;
}) => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const projectIdentity = useAppSelector((state) =>
    getProjectTargetIdentity(state.project.present),
  );
  const manuscript = useAppSelector((state) => state.project.present.data.manuscript);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const toast = useToast();

  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    manuscript?.[0]?.id ?? null,
  );
  // QNBS-v3: Phase 2 — publish activeSectionId to transient store so InlineAnnotationLayer
  // and the copilot apply-flow can read it without prop-drilling through unrelated views.
  const setGlobalActiveSectionId = useTransientUiStore((s) => s.setActiveSectionId);
  useEffect(() => {
    setGlobalActiveSectionId(activeSectionId ?? manuscript?.[0]?.id ?? null);
  }, [activeSectionId, manuscript, setGlobalActiveSectionId]);
  const [isLoglineModalOpen, setIsLoglineModalOpen] = useState(false);
  const [loglineSuggestions, setLoglineSuggestions] = useState<string[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isProofreading, setIsProofreading] = useState(false);
  const [proofreadSuggestions, setProofreadSuggestions] = useState<
    { original: string; suggestion: string; explanation: string }[]
  >([]);
  const [isSceneVisualizing, setIsSceneVisualizing] = useState(false);
  const [sceneImagePreviewUrl, setSceneImagePreviewUrl] = useState<string | null>(null);
  const loglineRequestRef = useRef(0);
  // QNBS-v3: frozen at successful-generation time (not resynced on every render) so selectLogline() can independently detect that the live identity has since diverged from the one that produced these suggestions.
  const loglineGeneratedForIdentityRef = useRef<string | null>(null);
  const proofreadRequestRef = useRef(0);
  // QNBS-v3: same mid-flight-race guard shape as sceneVisualizationTargetRef below -- a fresh object each time the invalidation effect runs, compared by reference.
  const proofreadTargetRef = useRef({ sectionId: activeSectionId, projectIdentity });
  // QNBS-v3: frozen at successful-generation time, mirroring loglineGeneratedForIdentityRef -- applyProofreadSuggestion must independently detect staleness, not only rely on proofreadTargetRef (which is resynced on every invalidation, not frozen at generation time).
  const proofreadGeneratedForRef = useRef<{
    sectionId: string | null;
    projectIdentity: string | null;
  }>({ sectionId: null, projectIdentity: null });
  const sceneVisualizationRequestRef = useRef(0);
  const sceneVisualizationTargetRef = useRef({
    sectionId: activeSectionId,
    projectIdentity,
  });

  // Drag and drop state
  const draggedItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Mention state
  const [mentions, setMentions] = useState<
    ((Character & { type: 'character' }) | (World & { type: 'world' }))[]
  >([]);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const activeSection = useMemo(() => {
    const currentActiveId = activeSectionId || manuscript?.[0]?.id;
    return manuscript.find((s) => s.id === currentActiveId) || manuscript?.[0];
  }, [activeSectionId, manuscript]);

  // QNBS-v3: the RESOLVED section, not the raw stored id -- another view can delete the active section directly (bypassing this hook's own handleDeleteSection), leaving activeSection to fall back to manuscript[0] while activeSectionId still names the deleted section.
  const resolvedActiveSectionId = activeSection?.id ?? null;

  // QNBS-v3: changing the visualization target or project incarnation invalidates pending results.
  useEffect(() => {
    sceneVisualizationTargetRef.current = { sectionId: activeSectionId, projectIdentity };
    sceneVisualizationRequestRef.current += 1;
    setSceneImagePreviewUrl(null);
    setIsSceneVisualizing(false);
  }, [activeSectionId, projectIdentity]);

  // QNBS-v3: same section-scoped invalidation as scene visualization -- a proofread suggestion targets the section content it was generated from, so a section switch invalidates it exactly like a project switch does. Resets isProofreading too, mirroring the scene-visualization effect above, so an in-flight request never leaves the spinner stuck once its target is invalidated.
  useEffect(() => {
    proofreadTargetRef.current = { sectionId: resolvedActiveSectionId, projectIdentity };
    proofreadRequestRef.current += 1;
    setProofreadSuggestions([]);
    setIsProofreading(false);
  }, [resolvedActiveSectionId, projectIdentity]);

  // QNBS-v3: logline is a project-level field, not section-scoped, so it only invalidates on project-incarnation change; loglineGeneratedForIdentityRef is untouched here since it must record the origin identity, not the live one. Resets isAiLoading too, mirroring the scene-visualization effect above, so an in-flight request never leaves the spinner stuck once its target is invalidated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectIdentity is an intentional trigger-only dependency -- the effect invalidates on identity change without needing to read the value itself.
  useEffect(() => {
    loglineRequestRef.current += 1;
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(false);
    setIsAiLoading(false);
  }, [projectIdentity]);

  const activeSectionStats = useMemo(() => {
    if (!activeSection) return { wordCount: 0, charCount: 0, readTime: 0 };
    const content = activeSection.content || '';
    const wordCount = content.match(/\S+/g)?.length || 0;
    const charCount = content.length;
    const readTime = Math.ceil(wordCount / 225); // Average reading speed 225 wpm
    return { wordCount, charCount, readTime };
  }, [activeSection]);

  const handleContentChange = useCallback(
    (id: string, content: string) => {
      dispatch(projectActions.updateManuscriptSection({ id, changes: { content } }));

      // Mention logic
      if (editorRef.current) {
        const cursor = editorRef.current.selectionStart;
        const textBeforeCursor = content.substring(0, cursor);
        const mentionMatch = textBeforeCursor.match(/([@#])([\w\s]*)$/);

        if (mentionMatch) {
          const [_, symbol, query] = mentionMatch;
          const queryText = query ?? '';
          if (!queryText) {
            setMentions([]);
            return;
          }
          const normalizedQuery = queryText.toLowerCase();

          const suggestions: ((Character & { type: 'character' }) | (World & { type: 'world' }))[] =
            symbol === '@'
              ? characters
                  .filter((c) => c.name.toLowerCase().startsWith(normalizedQuery))
                  .map((c) => ({ ...c, type: 'character' as const }))
              : worlds
                  .filter((w) => w.name.toLowerCase().startsWith(normalizedQuery))
                  .map((w) => ({ ...w, type: 'world' as const }));

          if (suggestions.length > 0) {
            setMentions(suggestions);
            const { top, left, height } = getCursorXY(editorRef.current, cursor);
            setMentionPosition({ top: top + height, left: left });
          } else {
            setMentions([]);
          }
        } else {
          setMentions([]);
        }
      }
    },
    [dispatch, characters, worlds],
  );

  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      dispatch(projectActions.updateManuscriptSection({ id, changes: { title } }));
    },
    [dispatch],
  );

  const handleAddSection = useCallback(() => {
    dispatch(projectActions.addManuscriptSection({ title: t('manuscript.untitledSection') }));
  }, [dispatch, t]);

  const handleDeleteSection = useCallback(
    (id: string) => {
      if (manuscript.length <= 1) return; // Prevent deleting last section

      const index = manuscript.findIndex((s) => s.id === id);
      if (index === -1) return;
      const newActiveId = index > 0 ? manuscript[index - 1]?.id : manuscript[index + 1]?.id;
      if (!newActiveId) return;

      dispatch(projectActions.deleteManuscriptSection(id));
      if (activeSectionId === id) {
        setActiveSectionId(newActiveId);
      }
    },
    [dispatch, manuscript, activeSectionId],
  );

  const handleMentionSelect = (item: { id: string; name: string }) => {
    if (!activeSection || !editorRef.current) return;

    const cursor = editorRef.current.selectionStart;
    const { content } = activeSection;

    const textBeforeCursor = content.substring(0, cursor);
    const textAfterCursor = content.substring(cursor);

    const mentionMatch = textBeforeCursor.match(/([@#])([\w\s]*)$/);
    if (mentionMatch) {
      const startIndex = mentionMatch.index || 0;
      const newText =
        textBeforeCursor.substring(0, startIndex) +
        `${mentionMatch[1]}${item.name} ` +
        textAfterCursor;
      handleContentChange(activeSection.id, newText);
      // Set cursor position after the inserted mention
      setTimeout(() => {
        if (editorRef.current) {
          const newCursorPos = startIndex + 1 + item.name.length + 1;
          editorRef.current.focus();
          editorRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    }
    setMentions([]);
  };

  const handleDragSort = useCallback(() => {
    if (draggedItem.current === null || dragOverItem.current === null) return;
    const newManuscript = [...manuscript];
    const removedItems = newManuscript.splice(draggedItem.current, 1);
    const reorderedItem = removedItems[0];
    if (!reorderedItem) return;
    newManuscript.splice(dragOverItem.current, 0, reorderedItem);
    dispatch(projectActions.setManuscript(newManuscript));
    draggedItem.current = null;
    dragOverItem.current = null;
    setDraggingIndex(null);
  }, [manuscript, dispatch]);

  const handleMoveSection = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= manuscript.length) return;

      const newManuscript = [...manuscript];
      const currentSection = newManuscript[index];
      const targetSection = newManuscript[newIndex];
      if (!currentSection || !targetSection) return;
      [newManuscript[index], newManuscript[newIndex]] = [targetSection, currentSection]; // swap
      dispatch(projectActions.setManuscript(newManuscript));
    },
    [manuscript, dispatch],
  );

  const handleGenerateLoglines = async () => {
    const requestId = ++loglineRequestRef.current;
    // QNBS-v3: live store read (not the projectIdentity selector value) so this check doesn't depend on this component's own render/effect cycle having caught up yet.
    const capturedProjectIdentity = captureActiveProjectIdentity();
    setIsAiLoading(true);
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(true);
    try {
      const result = await dispatch(generateLoglineSuggestionsThunk(language)).unwrap();
      if (
        loglineRequestRef.current !== requestId ||
        !identityUnchanged(capturedProjectIdentity, captureActiveProjectIdentity())
      )
        return;
      loglineGeneratedForIdentityRef.current = capturedProjectIdentity;
      setLoglineSuggestions(result || []);
    } catch (e: unknown) {
      if (loglineRequestRef.current !== requestId) return;
      if (isExpectedAiCancellationError(e)) return;
      let errorMessage = t('error.apiErrorDescription');
      if (typeof e === 'string') {
        errorMessage = e;
      } else if (e instanceof Error) {
        errorMessage = e.message;
      }
      toast.error(t('error.apiErrorTitle'), errorMessage);
      setIsLoglineModalOpen(false);
    } finally {
      if (loglineRequestRef.current === requestId) setIsAiLoading(false);
    }
  };

  const selectLogline = (logline: string) => {
    // QNBS-v3: reject a stale suggestion independently of the array already having been cleared by the invalidation effect above -- required even though the UI would normally not offer a cleared suggestion to select. Live-captured (not the projectIdentity selector value), matching useOutlineGenerator's apply().
    if (
      !identityUnchanged(loglineGeneratedForIdentityRef.current, captureActiveProjectIdentity())
    ) {
      setIsLoglineModalOpen(false);
      return;
    }
    dispatch(projectActions.updateLogline(logline));
    setIsLoglineModalOpen(false);
  };

  const handleProofread = async () => {
    if (!activeSection?.content) return;
    const requestId = ++proofreadRequestRef.current;
    const requestTarget = proofreadTargetRef.current;
    // QNBS-v3: live-captured in addition to requestTarget/requestId -- an effect isn't guaranteed to flush before this await resolves, so a ref/counter comparison alone can miss a same-tick project change.
    const capturedProjectIdentity = captureActiveProjectIdentity();
    setIsProofreading(true);
    setProofreadSuggestions([]);

    const resultAction = await dispatch(
      proofreadTextThunk({ text: activeSection.content, lang: language }),
    );

    if (
      proofreadRequestRef.current !== requestId ||
      proofreadTargetRef.current !== requestTarget ||
      !identityUnchanged(capturedProjectIdentity, captureActiveProjectIdentity())
    ) {
      // QNBS-v3: only clear loading if no newer request has taken over by counter -- otherwise this stale completion would wrongly cancel a still-in-flight newer request's own loading state.
      if (proofreadRequestRef.current === requestId) setIsProofreading(false);
      return;
    }

    if (proofreadTextThunk.fulfilled.match(resultAction)) {
      proofreadGeneratedForRef.current = requestTarget;
      setProofreadSuggestions(resultAction.payload);
      if (resultAction.payload.length === 0) {
        toast.success('No issues found!', 'Great job!');
      }
    } else if (!isExpectedAiCancellationError(resultAction.error)) {
      toast.error(t('error.apiErrorTitle'));
    }
    setIsProofreading(false);
  };

  const handleVisualizeScene = useCallback(async () => {
    if (!activeSection?.content?.trim() || !project) return;
    const requestId = ++sceneVisualizationRequestRef.current;
    const requestTarget = sceneVisualizationTargetRef.current;
    setIsSceneVisualizing(true);
    try {
      const result = await dispatch(
        generateSceneImageThunk({
          sectionId: activeSection.id,
          sectionTitle: activeSection.title,
          sectionContent: activeSection.content,
          projectTitle: project.title,
          lang: language,
        }),
      ).unwrap();
      // QNBS-v3: only the newest request may publish preview, toast, or loading completion.
      if (
        sceneVisualizationRequestRef.current !== requestId ||
        sceneVisualizationTargetRef.current !== requestTarget
      )
        return;
      setSceneImagePreviewUrl(result.dataUrl);
      toast.success(t('manuscript.visualize.successTitle'), t('manuscript.visualize.successBody'));
    } catch (error) {
      // QNBS-v3: [Grund: stale scene result is expected after a project switch / Impact: suppress false error toasts / Kreativer Mehrwert: keep authoring feedback actionable]
      if (
        sceneVisualizationRequestRef.current !== requestId ||
        sceneVisualizationTargetRef.current !== requestTarget
      )
        return;
      if (isExpectedAiCancellationError(error) && !isStaleProjectOperationError(error)) return;
      if (!isStaleProjectOperationError(error)) {
        toast.error(t('error.apiErrorTitle'));
      } else {
        // QNBS-v3: [Grund: stale request ordering / Impact: do not erase a newer preview / Kreativer Mehrwert: keep current-project feedback visible]
        setSceneImagePreviewUrl(null);
      }
    } finally {
      if (
        sceneVisualizationRequestRef.current === requestId &&
        sceneVisualizationTargetRef.current === requestTarget
      )
        setIsSceneVisualizing(false);
    }
  }, [activeSection, dispatch, language, project, t, toast]);

  const applyProofreadSuggestion = (index: number) => {
    if (!activeSection) return;
    // QNBS-v3: reject a stale suggestion independently of the array already having been cleared by the invalidation effect above -- a suggestion targets the section content it was generated from, so a section or project-incarnation change must never mutate a different section/project. Compares against the RESOLVED section id (not the raw stored activeSectionId), and live-captures identity, matching useOutlineGenerator's apply().
    if (
      proofreadGeneratedForRef.current.sectionId !== resolvedActiveSectionId ||
      !identityUnchanged(
        proofreadGeneratedForRef.current.projectIdentity,
        captureActiveProjectIdentity(),
      )
    ) {
      return;
    }
    const suggestion = proofreadSuggestions[index];
    if (!suggestion) return;
    // Simple string replacement (basic implementation, improved via real diffing in production)
    const newContent = activeSection.content.replace(suggestion.original, suggestion.suggestion);
    handleContentChange(activeSection.id, newContent);
    setProofreadSuggestions((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    t,
    project,
    manuscript,
    characters,
    worlds,
    dispatch,
    activeSectionId,
    setActiveSectionId,
    activeSection,
    activeSectionStats,
    handleContentChange,
    handleTitleChange,
    handleAddSection,
    handleDeleteSection,
    isLoglineModalOpen,
    setIsLoglineModalOpen,
    loglineSuggestions,
    isAiLoading,
    handleGenerateLoglines,
    selectLogline,
    // Drag & Drop
    draggedItem,
    dragOverItem,
    handleDragSort,
    handleMoveSection,
    draggingIndex,
    setDraggingIndex,
    // Mentions
    mentions,
    mentionPosition,
    handleMentionSelect,
    editorRef,
    // Proofreading
    isProofreading,
    handleProofread,
    proofreadSuggestions,
    applyProofreadSuggestion,
    // Scene visualization (Gemini image)
    isSceneVisualizing,
    handleVisualizeScene,
    sceneImagePreviewUrl,
  };
};

export type UseManuscriptViewReturnType = ReturnType<typeof useManuscriptView>;
