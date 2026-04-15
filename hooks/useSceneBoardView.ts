import { useMemo, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import { projectActions } from '../features/project/projectSlice';
import { selectAllCharacters } from '../features/project/projectSelectors';
import type { StorySection } from '../types';
import type { RootState } from '../app/store';

export const useSceneBoardView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelectorShallow((state) => state.project.present.data);
  const characters = selectAllCharacters({
    project: { present: { data: project } },
  } as unknown as RootState);

  const sections = useMemo(() => {
    return project.manuscript.map((section) => ({
      ...section,
      position: project.sceneBoardLayout?.[section.id] || {
        x: Math.random() * 800,
        y: Math.random() * 600,
      },
      wordCount: section.content?.split(/\s+/).filter(Boolean).length || 0,
    }));
  }, [project.manuscript, project.sceneBoardLayout]);

  const handleUpdateSection = useCallback(
    (id: string, updates: Partial<StorySection>) => {
      dispatch(projectActions.updateManuscriptSection({ id, updates }));
    },
    [dispatch]
  );

  const handleDeleteSection = useCallback(
    (id: string) => {
      if (confirm(t('sceneboard.confirmDelete'))) {
        dispatch(projectActions.deleteManuscriptSection(id));
      }
    },
    [dispatch, t]
  );

  const handleMoveSection = useCallback(
    (id: string, position: { x: number; y: number }) => {
      dispatch(projectActions.updateSceneBoardLayout({ [id]: position }));
    },
    [dispatch]
  );

  const handleAddSection = useCallback(() => {
    const newSection: Omit<StorySection, 'id'> = {
      title: t('sceneboard.newSceneTitle'),
      content: '',
      summary: '',
      color: '#3b82f6',
      status: 'draft',
      position: { x: Math.random() * 800, y: Math.random() * 600 },
    };
    dispatch(projectActions.addManuscriptSection(newSection));
  }, [dispatch, t]);

  return {
    t,
    project,
    sections,
    characters,
    handleUpdateSection,
    handleDeleteSection,
    handleMoveSection,
    handleAddSection,
  };
};
