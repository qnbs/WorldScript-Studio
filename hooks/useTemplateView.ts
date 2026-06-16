import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppDispatch } from '../app/hooks';
import { useToast } from '../components/ui/Toast';
import { STORY_TEMPLATES } from '../constants';
import { projectActions } from '../features/project/projectSlice';
import {
  generateCustomTemplateThunk,
  personalizeTemplateThunk,
} from '../features/project/thunks/outlineThunks';
import type { CommunityTemplate, OutlineSection, StorySection, Template } from '../types';
import { useTranslation } from './useTranslation';

interface UseTemplateViewProps {
  onNavigate: (view: 'manuscript') => void;
}

export const useTemplateView = ({ onNavigate }: UseTemplateViewProps) => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const [filter, setFilter] = useState<'All' | 'Structure' | 'Genre'>('All');
  const [modalState, setModalState] = useState<'closed' | 'preview' | 'create'>('closed');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Remix state
  const [isRemixMode, setIsRemixMode] = useState(false);
  // QNBS-v3: description is optional — present for community template sections, absent for built-in templates.
  const [remixedSections, setRemixedSections] = useState<
    { id: number; title: string; description?: string }[]
  >([]);
  const draggedItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // AI personalization state
  const [aiConcept, setAiConcept] = useState('');

  // Custom template state
  const [customConcept, setCustomConcept] = useState('');
  const [customElements, setCustomElements] = useState('');
  const [customNumSections, setCustomNumSections] = useState(10);

  const filteredTemplates = useMemo(() => {
    if (filter === 'All') return STORY_TEMPLATES;
    return STORY_TEMPLATES.filter((t) => t.type === filter);
  }, [filter]);

  const openPreviewModal = useCallback(
    (template: Template) => {
      setSelectedTemplate(template);
      setRemixedSections(template.sections.map((s, i) => ({ id: i, title: t(s.titleKey) })));
      setModalState('preview');
    },
    [t],
  );

  const closeModal = useCallback(() => {
    setModalState('closed');
    setSelectedTemplate(null);
    setIsRemixMode(false);
    setAiConcept('');
  }, []);

  const handleDragSort = useCallback(() => {
    if (draggedItem.current === null || dragOverItem.current === null) return;
    const newSections = [...remixedSections];
    const [reorderedItem] = newSections.splice(draggedItem.current, 1);
    if (reorderedItem === undefined) return;
    newSections.splice(dragOverItem.current, 0, reorderedItem);
    setRemixedSections(newSections);
    draggedItem.current = null;
    dragOverItem.current = null;
  }, [remixedSections]);

  const updateRemixedSectionTitle = useCallback((id: number, title: string) => {
    setRemixedSections((currentSections) =>
      currentSections.map((sec) => (sec.id === id ? { ...sec, title } : sec)),
    );
  }, []);

  const addRemixedSection = useCallback(
    (index: number) => {
      const newSection = { id: Date.now(), title: t('templates.remix.newSection') };
      setRemixedSections((currentSections) => {
        const newSections = [...currentSections];
        newSections.splice(index + 1, 0, newSection);
        return newSections;
      });
    },
    [t],
  );

  const deleteRemixedSection = useCallback((id: number) => {
    setRemixedSections((currentSections) => currentSections.filter((sec) => sec.id !== id));
  }, []);

  const applyToManuscript = useCallback(
    (sections: { title: string; prompt?: string }[]) => {
      const newManuscript: StorySection[] = sections.map((s, i) => ({
        id: `sec-${Date.now()}-${i}`,
        title: s.title,
        content: '',
        prompt: s.prompt || '',
      }));
      const newOutline: OutlineSection[] = sections.map((s, i) => ({
        id: `out-${Date.now()}-${i}`,
        title: s.title,
        description: s.prompt || '',
      }));
      dispatch(projectActions.setManuscript(newManuscript));
      dispatch(projectActions.setOutline(newOutline));
      toast.success(t('common.saved'), t('sidebar.manuscript'));
      onNavigate('manuscript');
    },
    [dispatch, onNavigate, toast, t],
  );

  // QNBS-v3: Apply a community template directly via Redux (setManuscript/setOutline), mirroring
  // applyToManuscript. Previously the Community tab dispatched a `*:applyTemplate` window event that
  // had no listener anywhere, so applying a community template was a silent no-op (pre-existing bug).
  const applyCommunityTemplate = useCallback(
    (ct: CommunityTemplate) => {
      const stamp = Date.now();
      const newManuscript: StorySection[] = ct.sections.map((s, i) => ({
        id: `sec-${stamp}-${i}`,
        title: s.title,
        // QNBS-v3: section guidance goes into `prompt` (writing brief), NOT `content` — mirrors the
        // built-in-template path so a freshly applied template starts with an EMPTY manuscript.
        content: '',
        prompt: s.description ?? '',
      }));
      const newOutline: OutlineSection[] = ct.sections.map((s, i) => ({
        id: `out-${stamp}-${i}`,
        title: s.title,
        description: s.description ?? '',
      }));
      dispatch(projectActions.setManuscript(newManuscript));
      dispatch(projectActions.setOutline(newOutline));
      toast.success(t('common.saved'), t('sidebar.manuscript'));
      onNavigate('manuscript');
    },
    [dispatch, onNavigate, toast, t],
  );

  const handleAiApply = useCallback(async () => {
    if (!selectedTemplate) return;
    setIsAiLoading(true);
    const resultAction = await dispatch(
      personalizeTemplateThunk({
        sections: remixedSections,
        concept: aiConcept,
        lang: language,
      }),
    );

    if (personalizeTemplateThunk.fulfilled.match(resultAction)) {
      applyToManuscript(resultAction.payload);
    } else {
      toast.error(t('templates.error.personalizationFailed'));
      applyToManuscript(remixedSections); // Fallback to standard apply
    }
    setIsAiLoading(false);
    closeModal();
  }, [
    selectedTemplate,
    dispatch,
    remixedSections,
    aiConcept,
    language,
    applyToManuscript,
    t,
    closeModal,
    toast,
  ]);

  const handleStandardApply = useCallback(() => {
    applyToManuscript(remixedSections);
    closeModal();
  }, [applyToManuscript, remixedSections, closeModal]);

  const handleGenerateCustom = useCallback(async () => {
    setIsAiLoading(true);
    const resultAction = await dispatch(
      generateCustomTemplateThunk({
        customConcept,
        customElements,
        numSections: customNumSections,
        lang: language,
      }),
    );
    if (generateCustomTemplateThunk.fulfilled.match(resultAction)) {
      applyToManuscript(resultAction.payload);
    } else {
      toast.error(t('templates.error.customGenerationFailed'));
    }
    setIsAiLoading(false);
    closeModal();
  }, [
    dispatch,
    customConcept,
    customElements,
    customNumSections,
    language,
    applyToManuscript,
    t,
    closeModal,
    toast,
  ]);

  return {
    t,
    filter,
    setFilter,
    filteredTemplates,
    modalState,
    setModalState,
    selectedTemplate,
    isAiLoading,
    openPreviewModal,
    closeModal,
    // Remix
    isRemixMode,
    setIsRemixMode,
    remixedSections,
    draggedItem,
    dragOverItem,
    handleDragSort,
    updateRemixedSectionTitle,
    addRemixedSection,
    deleteRemixedSection,
    // AI
    aiConcept,
    setAiConcept,
    handleAiApply,
    handleStandardApply,
    applyCommunityTemplate,
    // Custom
    customConcept,
    setCustomConcept,
    customElements,
    setCustomElements,
    customNumSections,
    setCustomNumSections,
    handleGenerateCustom,
  };
};

export type UseTemplateViewReturnType = ReturnType<typeof useTemplateView>;
