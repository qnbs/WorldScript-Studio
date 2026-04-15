import { useState, useRef, useCallback } from 'react';
import { useTranslation } from './useTranslation';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectManuscript, selectOutline } from '../features/project/projectSelectors';
import {
  projectActions,
  generateOutlineThunk,
  regenerateOutlineSectionThunk,
} from '../features/project/projectSlice';
import type { OutlineSection, View, StorySection } from '../types';
import { useToast } from '../components/ui/Toast';

interface UseOutlineGeneratorProps {
  onNavigate: (view: View) => void;
}

type ConfirmModalState = {
  type: 'overwrite' | 'apply' | 'delete';
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void;
} | null;

export const useOutlineGenerator = ({ onNavigate }: UseOutlineGeneratorProps) => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const existingOutline = useAppSelector(selectOutline);
  const existingManuscript = useAppSelector(selectManuscript);
  const toast = useToast();

  // Form State
  const [genre, setGenre] = useState('');
  const [idea, setIdea] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [characters, setCharacters] = useState('');
  const [setting, setSetting] = useState('');
  const [pacing, setPacing] = useState('');
  const [numChapters, setNumChapters] = useState(12);
  const [includeTwist, setIncludeTwist] = useState(false);

  // Result State
  const [outline, setOutline] = useState<OutlineSection[]>(existingOutline || []);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(null);
  const draggedItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const generate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const resultAction = await dispatch(
      generateOutlineThunk({
        genre,
        idea,
        characters,
        setting,
        pacing,
        numChapters,
        includeTwist,
        lang: language,
      })
    );

    if (generateOutlineThunk.fulfilled.match(resultAction)) {
      setOutline(resultAction.payload.map((s) => ({ ...s, id: s.id || `gen-${Math.random()}` })));
      toast.success(t('common.saved'));
    } else {
      setError(t('outline.error.generationFailed'));
      toast.error(t('outline.error.generationFailed'));
    }
    setIsLoading(false);
  }, [
    dispatch,
    genre,
    idea,
    characters,
    setting,
    pacing,
    numChapters,
    includeTwist,
    language,
    t,
    toast,
  ]);

  const handleGenerate = useCallback(() => {
    if (outline.length > 0) {
      setConfirmModal({
        type: 'overwrite',
        title: t('outline.confirm.overwriteTitle'),
        description: t('outline.overwriteConfirm'),
        confirmText: t('outline.confirm.overwriteAction'),
        onConfirm: () => {
          setConfirmModal(null);
          generate();
        },
      });
    } else {
      generate();
    }
  }, [outline.length, t, generate]);

  const handleRegenerate = useCallback(
    async (index: number) => {
      const sectionToRegen = outline[index];
      setIsRegenerating(sectionToRegen.id);
      const resultAction = await dispatch(
        regenerateOutlineSectionThunk({
          allSections: outline,
          sectionToIndex: index,
          lang: language,
        })
      );

      if (regenerateOutlineSectionThunk.fulfilled.match(resultAction)) {
        const { index: newIndex, newSection } = resultAction.payload;
        setOutline((currentOutline) => {
          const newOutline = [...currentOutline];
          newOutline[newIndex] = { ...newOutline[newIndex], ...newSection };
          return newOutline;
        });
      } else {
        toast.error(t('outline.error.generationFailed'));
      }
      setIsRegenerating(null);
    },
    [dispatch, outline, language, t, toast]
  );

  const handleDragSort = useCallback(() => {
    if (draggedItem.current === null || dragOverItem.current === null) return;
    const newOutline = [...outline];
    const [reorderedItem] = newOutline.splice(draggedItem.current, 1);
    newOutline.splice(dragOverItem.current, 0, reorderedItem);
    setOutline(newOutline);
    draggedItem.current = null;
    dragOverItem.current = null;
  }, [outline]);

  const handleMove = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= outline.length) return;
      const newOutline = [...outline];
      [newOutline[index], newOutline[newIndex]] = [newOutline[newIndex], newOutline[index]];
      setOutline(newOutline);
    },
    [outline]
  );

  const updateSection = useCallback((id: string, changes: Partial<OutlineSection>) => {
    setOutline((currentOutline) =>
      currentOutline.map((sec) => (sec.id === id ? { ...sec, ...changes } : sec))
    );
  }, []);

  const addSection = useCallback(
    (index: number) => {
      const newSection = {
        id: `custom-${Date.now()}`,
        title: t('outline.result.newSectionTitle'),
        description: '',
      };
      setOutline((currentOutline) => {
        const newOutline = [...currentOutline];
        newOutline.splice(index + 1, 0, newSection);
        return newOutline;
      });
    },
    [t]
  );

  const deleteSection = useCallback((id: string) => {
    setOutline((currentOutline) => currentOutline.filter((sec) => sec.id !== id));
  }, []);

  const apply = useCallback(() => {
    const newManuscript: StorySection[] = outline.map((s, i) => ({
      id: `sec-${Date.now()}-${i}`,
      title: s.title,
      content: '',
      prompt: s.description,
    }));
    dispatch(projectActions.setOutline(outline));
    dispatch(projectActions.setManuscript(newManuscript));
    setConfirmModal(null);
    toast.success(t('common.saved'), t('sidebar.manuscript'));
    onNavigate('manuscript');
  }, [dispatch, outline, onNavigate, toast, t]);

  const handleApplyOutline = useCallback(() => {
    if (
      existingManuscript.length > 1 ||
      (existingManuscript.length === 1 && existingManuscript[0].content !== '')
    ) {
      setConfirmModal({
        type: 'apply',
        title: t('outline.confirm.applyTitle'),
        description: t('outline.applyOverwriteConfirm'),
        confirmText: t('outline.confirm.applyAction'),
        onConfirm: apply,
      });
    } else {
      apply();
    }
  }, [existingManuscript, t, apply]);

  return {
    t,
    genre,
    setGenre,
    idea,
    setIdea,
    showAdvanced,
    setShowAdvanced,
    characters,
    setCharacters,
    setting,
    setSetting,
    pacing,
    setPacing,
    numChapters,
    setNumChapters,
    includeTwist,
    setIncludeTwist,
    isLoading,
    handleGenerate,
    outline,
    error,
    isRegenerating,
    draggedItem,
    dragOverItem,
    handleDragSort,
    handleMove,
    updateSection,
    handleRegenerate,
    addSection,
    deleteSection,
    handleApplyOutline,
    confirmModal,
    setConfirmModal,
    draggingIndex,
    setDraggingIndex,
  };
};

export type UseOutlineGeneratorReturnType = ReturnType<typeof useOutlineGenerator>;
