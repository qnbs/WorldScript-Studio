import { useState, useMemo, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import {
  selectProjectData,
  selectAllCharacters,
  selectAllWorlds,
} from '../features/project/projectSelectors';
import {
  projectActions,
  generateLoglineSuggestionsThunk,
  proofreadTextThunk,
} from '../features/project/projectSlice';
import { useTranslation } from './useTranslation';
import type { Character, View, World } from '../types';
import { useToast } from '../components/ui/Toast';

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
  const manuscript = useAppSelector((state) => state.project.present.data.manuscript);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const toast = useToast();

  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    manuscript?.[0]?.id ?? null
  );
  const [isLoglineModalOpen, setIsLoglineModalOpen] = useState(false);
  const [loglineSuggestions, setLoglineSuggestions] = useState<string[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isProofreading, setIsProofreading] = useState(false);
  const [proofreadSuggestions, setProofreadSuggestions] = useState<
    { original: string; suggestion: string; explanation: string }[]
  >([]);

  // Drag and drop state
  const draggedItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Mention state
  const [mentions, setMentions] = useState<
    ((Character & { type: 'character' }) | (World & { type: 'world' }))[]
  >([]);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const activeSection = useMemo(() => {
    const currentActiveId = activeSectionId || manuscript?.[0]?.id;
    return manuscript.find((s) => s.id === currentActiveId) || manuscript?.[0];
  }, [activeSectionId, manuscript]);

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
    [dispatch, characters, worlds]
  );

  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      dispatch(projectActions.updateManuscriptSection({ id, changes: { title } }));
    },
    [dispatch]
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
    [dispatch, manuscript, activeSectionId]
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
      [newManuscript[index], newManuscript[newIndex]] = [
        targetSection,
        currentSection,
      ]; // swap
      dispatch(projectActions.setManuscript(newManuscript));
    },
    [manuscript, dispatch]
  );

  const handleGenerateLoglines = async () => {
    setIsAiLoading(true);
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(true);
    try {
      const result = await dispatch(generateLoglineSuggestionsThunk(language)).unwrap();
      setLoglineSuggestions(result || []);
    } catch (e: unknown) {
      let errorMessage = t('error.apiErrorDescription');
      if (typeof e === 'string') {
        errorMessage = e;
      } else if (e instanceof Error) {
        errorMessage = e.message;
      }
      toast.error(t('error.apiErrorTitle'), errorMessage);
      setIsLoglineModalOpen(false);
    } finally {
      setIsAiLoading(false);
    }
  };

  const selectLogline = (logline: string) => {
    dispatch(projectActions.updateLogline(logline));
    setIsLoglineModalOpen(false);
  };

  const handleProofread = async () => {
    if (!activeSection?.content) return;
    setIsProofreading(true);
    setProofreadSuggestions([]);

    const resultAction = await dispatch(
      proofreadTextThunk({ text: activeSection.content, lang: language })
    );

    if (proofreadTextThunk.fulfilled.match(resultAction)) {
      setProofreadSuggestions(resultAction.payload);
      if (resultAction.payload.length === 0) {
        toast.success('No issues found!', 'Great job!');
      }
    } else {
      toast.error(t('error.apiErrorTitle'));
    }
    setIsProofreading(false);
  };

  const applyProofreadSuggestion = (index: number) => {
    if (!activeSection) return;
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
  };
};

export type UseManuscriptViewReturnType = ReturnType<typeof useManuscriptView>;
