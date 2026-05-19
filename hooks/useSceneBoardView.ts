import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import type { RootState } from '../app/store';
import {
  plotBoardActions,
  selectAllSubplots,
  selectConnections,
} from '../features/plotBoard/plotBoardSlice';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import type { PlotConnectionType, StorySection } from '../types';

export const useSceneBoardView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelectorShallow((state) => state.project.present.data);
  const characters = selectAllCharacters({
    project: { present: { data: project } },
  } as unknown as RootState);

  const worlds = selectAllWorlds({
    project: { present: { data: project } },
  } as unknown as RootState);

  const locationOptions = useMemo(
    () =>
      worlds.flatMap((w) =>
        (w.locations ?? []).map((loc) => ({
          id: loc.id,
          label: `${w.name}: ${loc.name}`,
        })),
      ),
    [worlds],
  );

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
      dispatch(projectActions.updateManuscriptSection({ id, changes: updates }));
    },
    [dispatch],
  );

  const handleDeleteSection = useCallback(
    (id: string) => {
      dispatch(projectActions.deleteManuscriptSection(id));
    },
    [dispatch],
  );

  const handleMoveSection = useCallback(
    (id: string, position: { x: number; y: number }) => {
      dispatch(projectActions.updateSceneBoardLayout({ [id]: position }));
    },
    [dispatch],
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

  const handleMoveSectionWithinAct = useCallback(
    (id: string, direction: 'up' | 'down') => {
      dispatch(projectActions.moveManuscriptSectionWithinAct({ id, direction }));
    },
    [dispatch],
  );

  // ── Connection handlers ───────────────────────────────────────────────────

  const connections = useAppSelectorShallow(selectConnections);

  const handleAddConnection = useCallback(
    (fromSectionId: string, toSectionId: string, type: PlotConnectionType = 'cause-effect') => {
      dispatch(
        plotBoardActions.addConnection({
          id: `conn-${Date.now()}`,
          fromSectionId,
          toSectionId,
          type,
        }),
      );
    },
    [dispatch],
  );

  const handleDeleteConnection = useCallback(
    (id: string) => {
      dispatch(plotBoardActions.removeConnection(id));
    },
    [dispatch],
  );

  const handleStartDrawConnection = useCallback(
    (fromId: string) => {
      dispatch(plotBoardActions.startDrawConnection(fromId));
    },
    [dispatch],
  );

  const handleFinishDrawConnection = useCallback(
    (toId: string, type: PlotConnectionType = 'cause-effect') => {
      dispatch(
        plotBoardActions.finishDrawConnection({
          toSectionId: toId,
          type,
          newId: `conn-${Date.now()}`,
        }),
      );
    },
    [dispatch],
  );

  const handleCancelDrawConnection = useCallback(() => {
    dispatch(plotBoardActions.cancelDrawConnection());
  }, [dispatch]);

  // ── Subplot handlers ──────────────────────────────────────────────────────

  const subplots = useAppSelectorShallow(selectAllSubplots);

  const handleAddSubplot = useCallback(
    (name: string, color: string) => {
      dispatch(
        plotBoardActions.addSubplot({
          id: `sp-${Date.now()}`,
          name,
          color,
          sectionIds: [],
        }),
      );
    },
    [dispatch],
  );

  const handleDeleteSubplot = useCallback(
    (id: string) => {
      dispatch(plotBoardActions.deleteSubplot(id));
    },
    [dispatch],
  );

  const handleAssignToSubplot = useCallback(
    (sectionId: string, subplotId: string) => {
      dispatch(plotBoardActions.assignSectionToSubplot({ sectionId, subplotId }));
    },
    [dispatch],
  );

  return {
    t,
    project,
    sections,
    characters,
    locationOptions,
    connections,
    subplots,
    handleUpdateSection,
    handleDeleteSection,
    handleMoveSection,
    handleMoveSectionWithinAct,
    handleAddSection,
    handleAddConnection,
    handleDeleteConnection,
    handleStartDrawConnection,
    handleFinishDrawConnection,
    handleCancelDrawConnection,
    handleAddSubplot,
    handleDeleteSubplot,
    handleAssignToSubplot,
  };
};
