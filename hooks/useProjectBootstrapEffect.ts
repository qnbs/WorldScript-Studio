import { useEffect, useRef } from 'react';
import { useAppDispatch } from '../app/hooks';
import { projectActions } from '../features/project/projectSlice';
import type { ProjectMetaSlice, TranslateFn } from '../services/projectI18nRepair';
import { repairProjectI18nFields } from '../services/projectI18nRepair';

export interface ProjectBootstrapGateState {
  project: ProjectMetaSlice | null;
  // QNBS-v3: pre-hydration new-user state is the only authority allowed to seed blank metadata.
  isNewUser: boolean;
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
  isNewUser,
  isInitialLoad,
  isPortalActive,
  isI18nReady,
  t,
}: UseProjectBootstrapEffectParams): void {
  const dispatch = useAppDispatch();
  const hasCompletedFreshUserBootstrap = useRef(false);

  useEffect(() => {
    // QNBS-v3: narrows project directly (not via the predicate's own return type) so the redundant post-check codecov flagged as dead code isn't needed.
    if (
      !project ||
      !shouldRunProjectBootstrap({
        project,
        isNewUser,
        isInitialLoad,
        isPortalActive,
        isI18nReady,
      })
    )
      return;

    const repair = repairProjectI18nFields(project, t, {
      seedInitialMetadata: isNewUser && !hasCompletedFreshUserBootstrap.current,
    });
    if (isNewUser) hasCompletedFreshUserBootstrap.current = true;
    if (repair) {
      if (repair.title !== undefined) dispatch(projectActions.updateTitle(repair.title));
      if (repair.logline !== undefined) dispatch(projectActions.updateLogline(repair.logline));
      if (repair.manuscript !== undefined)
        dispatch(projectActions.setManuscript(repair.manuscript));
    }
    // QNBS-v3: blank metadata is seeded only once for a fresh user; later empty strings remain user intent.
  }, [project, isNewUser, isInitialLoad, isPortalActive, isI18nReady, dispatch, t]);
}
