import { useEffect } from 'react';
import { useAppDispatch } from '../app/hooks';
import { projectActions } from '../features/project/projectSlice';
import type { ProjectMetaSlice, TranslateFn } from '../services/projectI18nRepair';
import { repairProjectI18nFields } from '../services/projectI18nRepair';

export interface ProjectBootstrapGateState {
  project: ProjectMetaSlice | null;
  isInitialLoad: boolean;
  isPortalActive: boolean;
  isI18nReady: boolean;
}

// QNBS-v3: pure guard, exported for direct unit testing — gates on isInitialLoad (not just isPortalActive) so a same-commit stale read of isPortalActive can't let a blank project auto-seed before the welcome portal shows.
export function shouldRunProjectBootstrap({
  project,
  isInitialLoad,
  isPortalActive,
  isI18nReady,
}: ProjectBootstrapGateState): boolean {
  return !isInitialLoad && !isPortalActive && isI18nReady && project !== null;
}

export interface UseProjectBootstrapEffectParams extends ProjectBootstrapGateState {
  t: TranslateFn;
}

/** Repairs raw-i18n-key project fields, or seeds a fresh blank project, once bootstrap has settled. */
export function useProjectBootstrapEffect({
  project,
  isInitialLoad,
  isPortalActive,
  isI18nReady,
  t,
}: UseProjectBootstrapEffectParams): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!shouldRunProjectBootstrap({ project, isInitialLoad, isPortalActive, isI18nReady })) return;
    if (!project) return;

    const repair = repairProjectI18nFields(project, t);
    if (repair) {
      if (repair.title !== undefined) dispatch(projectActions.updateTitle(repair.title));
      if (repair.logline !== undefined) dispatch(projectActions.updateLogline(repair.logline));
      if (repair.manuscript !== undefined)
        dispatch(projectActions.setManuscript(repair.manuscript));
    }
    // QNBS-v3: no further branch here — repairProjectI18nFields already treats any blank title/logline/manuscript as needing repair, so it always returns non-null for a blank project; a separate resetProject dispatch for that same condition was unreachable dead code, removed rather than tested around.
  }, [project, isInitialLoad, isPortalActive, isI18nReady, dispatch, t]);
}
