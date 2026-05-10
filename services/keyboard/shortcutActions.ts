import type { AppDispatch, RootState } from '../../app/store';
import type { ProjectData } from '../../features/project/projectSlice';
import { projectActions } from '../../features/project/projectSlice';
import { settingsActions } from '../../features/settings/settingsSlice';
import { statusActions } from '../../features/status/statusSlice';
import type { View } from '../../types';
import type { I18nTranslate } from '../commands/commandTypes';
import { logger } from '../logger';
import { saveEnvelopeFromProjectData } from '../storageBackend';
import { storageService } from '../storageService';
import { eventMatchesShortcutKeys } from './matchShortcut';

type ProjectStateShape = {
  present?: { data?: ProjectData };
  data?: ProjectData;
};

export interface ShortcutRuntimeApi {
  dispatch: AppDispatch;
  getState: () => RootState;
  navigate: (view: View) => void;
  togglePalette: () => void;
  translate: I18nTranslate;
}

export function findMatchingShortcutAction(
  e: KeyboardEvent,
  shortcuts: { keys: string[]; action: string }[],
): string | undefined {
  for (const s of shortcuts) {
    if (eventMatchesShortcutKeys(e, s.keys)) return s.action;
  }
  return undefined;
}

export async function performShortcutAction(
  action: string,
  api: ShortcutRuntimeApi,
): Promise<void> {
  const { dispatch, getState, navigate, togglePalette, translate } = api;

  switch (action) {
    case 'openCommandPalette': {
      togglePalette();
      return;
    }
    case 'save': {
      await flushProjectSave(dispatch, getState, translate);
      return;
    }
    case 'newSection': {
      dispatch(
        projectActions.addManuscriptSection({
          title: translate('outline.result.newSectionTitle'),
        }),
      );
      navigate('manuscript');
      dispatch(
        statusActions.addNotification({
          type: 'info',
          title: translate('palette.shortcut.newSectionToast'),
        }),
      );
      return;
    }
    case 'search': {
      navigate('manuscript');
      dispatch(
        statusActions.addNotification({
          type: 'info',
          title: translate('palette.shortcut.searchHintTitle'),
          description: translate('palette.shortcut.searchHintBody'),
          actionLabel: translate('palette.shortcut.searchOpenPaletteAction'),
          commandId: 'global-open-command-palette',
        }),
      );
      return;
    }
    case 'export': {
      navigate('export');
      return;
    }
    case 'toggleTheme': {
      const st = getState().settings;
      const effective =
        st.theme === 'auto'
          ? typeof window !== 'undefined' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : st.theme;
      dispatch(settingsActions.setTheme(effective === 'dark' ? 'light' : 'dark'));
      return;
    }
    default:
      logger.warn('Unhandled shortcut action:', action);
  }
}

async function flushProjectSave(
  dispatch: AppDispatch,
  getState: () => RootState,
  translate: I18nTranslate,
): Promise<void> {
  const state = getState();
  const projectState = state.project as unknown as ProjectStateShape;
  const presentData = projectState.present?.data ?? projectState.data;

  if (!presentData || presentData.title === undefined) {
    dispatch(
      statusActions.addNotification({
        type: 'error',
        title: translate('palette.shortcut.saveFailedTitle'),
        description: translate('palette.shortcut.saveNoProject'),
      }),
    );
    return;
  }

  dispatch(statusActions.setSavingStatus('saving'));

  try {
    const enriched = {
      ...presentData,
      persistedVersionControl: {
        branches: state.versionControl.branches,
        snapshots: state.versionControl.snapshots,
        currentBranchId: state.versionControl.currentBranchId,
      },
    };
    await storageService.saveProject(saveEnvelopeFromProjectData(enriched));
    dispatch(statusActions.setSavingStatus('saved'));
    dispatch(
      statusActions.addNotification({
        type: 'success',
        title: translate('palette.shortcut.saveSuccessTitle'),
        description: translate('palette.shortcut.saveSuccessBody'),
      }),
    );
    window.setTimeout(() => {
      if ((getState().status.saving as string) === 'saved') {
        dispatch(statusActions.setSavingStatus('idle'));
      }
    }, 1500);
  } catch (error) {
    logger.error('Manual save shortcut failed:', error);
    dispatch(statusActions.setSavingStatus('idle'));
    dispatch(
      statusActions.addNotification({
        type: 'error',
        title: translate('palette.shortcut.saveFailedTitle'),
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
