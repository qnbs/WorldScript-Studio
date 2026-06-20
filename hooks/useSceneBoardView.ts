import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import type { RootState } from '../app/store';
import { plotBoardActions, selectActiveSubplotFilter } from '../features/plotBoard/plotBoardSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectPlotConnections,
  selectPlotSubplots,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import type { PlotConnectionType, StorySection } from '../types';

// QNBS-v3: single source for new-section defaults so handleAddSection / handleAddSectionForAct
// stay in lockstep (color/status/summary) and `act` is applied without a follow-up update.
// No `position` here: Scene Board placement is authoritative in `project.sceneBoardLayout` (keyed by
// section id), never `section.position` — storing one would be dead data. Unplaced sections fall to
// the deterministic grid in the `sections` derivation below.
const buildNewSectionPayload = (
  title: string,
  act?: 1 | 2 | 3,
): { title: string } & Partial<Omit<StorySection, 'id'>> => ({
  title,
  content: '',
  summary: '',
  color: '#3b82f6',
  status: 'draft',
  ...(act !== undefined ? { act } : {}),
});

// QNBS-v3: deterministic fallback placement for sections not yet in sceneBoardLayout. Index-derived
// grid (not Math.random()) so a new/unplaced scene keeps a stable position across re-renders instead
// of jumping to a fresh random spot every time the manuscript changes.
const FALLBACK_GRID_COLS = 4;
const fallbackPosition = (index: number): { x: number; y: number } => ({
  x: (index % FALLBACK_GRID_COLS) * 220 + 40,
  y: Math.floor(index / FALLBACK_GRID_COLS) * 160 + 40,
});

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
    return project.manuscript.map((section, index) => ({
      ...section,
      position: project.sceneBoardLayout?.[section.id] || fallbackPosition(index),
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
      // QNBS-v3: Also remove plot connections for this section so the board stays consistent.
      dispatch(projectActions.removePlotConnectionsForSection(id));
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
    dispatch(
      projectActions.addManuscriptSection(buildNewSectionPayload(t('sceneboard.newSceneTitle'))),
    );
  }, [dispatch, t]);

  // QNBS-v3: deterministic add-to-act — sets `act` atomically on the freshly created section in a
  // single dispatch. Replaces the previous setTimeout + sections[sections.length-1] guess, which
  // read a stale closure and reassigned the WRONG section's act (data-integrity bug).
  const handleAddSectionForAct = useCallback(
    (act: 1 | 2 | 3) => {
      dispatch(
        projectActions.addManuscriptSection(
          buildNewSectionPayload(t('sceneboard.newSceneTitle'), act),
        ),
      );
    },
    [dispatch, t],
  );

  const handleMoveSectionWithinAct = useCallback(
    (id: string, direction: 'up' | 'down') => {
      dispatch(projectActions.moveManuscriptSectionWithinAct({ id, direction }));
    },
    [dispatch],
  );

  // ── Connection handlers (dispatch to projectSlice for undo support) ───────

  const connections = useAppSelectorShallow(selectPlotConnections);

  const handleAddConnection = useCallback(
    (fromSectionId: string, toSectionId: string, type: PlotConnectionType = 'cause-effect') => {
      dispatch(
        projectActions.addPlotConnection({
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
      dispatch(projectActions.removePlotConnection(id));
      dispatch(plotBoardActions.setSelectedConnection(null));
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
    (toId: string, fromId: string, type: PlotConnectionType = 'cause-effect') => {
      // QNBS-v3: Create connection in projectSlice (undo-able), then clear draw UI state.
      dispatch(
        projectActions.finishPlotDrawConnection({
          fromSectionId: fromId,
          toSectionId: toId,
          type,
          newId: `conn-${Date.now()}`,
        }),
      );
      dispatch(plotBoardActions.finishDrawConnection());
    },
    [dispatch],
  );

  const handleCancelDrawConnection = useCallback(() => {
    dispatch(plotBoardActions.cancelDrawConnection());
  }, [dispatch]);

  // ── Subplot handlers (dispatch to projectSlice for undo support) ──────────

  const subplots = useAppSelectorShallow(selectPlotSubplots);
  const activeSubplotFilter = useAppSelectorShallow(selectActiveSubplotFilter);

  const handleAddSubplot = useCallback(
    (name: string, color: string) => {
      dispatch(
        projectActions.addPlotSubplot({
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
      dispatch(projectActions.deletePlotSubplot(id));
      // Clear viewport filter if the deleted subplot was active
      dispatch(plotBoardActions.setActiveSubplotFilter(null));
    },
    [dispatch],
  );

  const handleAssignToSubplot = useCallback(
    (sectionId: string, subplotId: string) => {
      dispatch(projectActions.assignSectionToPlotSubplot({ sectionId, subplotId }));
    },
    [dispatch],
  );

  const handleRemoveSectionFromSubplot = useCallback(
    (sectionId: string, subplotId: string) => {
      dispatch(projectActions.removeSectionFromPlotSubplot({ sectionId, subplotId }));
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
    activeSubplotFilter,
    handleUpdateSection,
    handleDeleteSection,
    handleMoveSection,
    handleMoveSectionWithinAct,
    handleAddSection,
    handleAddSectionForAct,
    handleAddConnection,
    handleDeleteConnection,
    handleStartDrawConnection,
    handleFinishDrawConnection,
    handleCancelDrawConnection,
    handleAddSubplot,
    handleDeleteSubplot,
    handleAssignToSubplot,
    handleRemoveSectionFromSubplot,
  };
};
