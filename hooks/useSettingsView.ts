import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { RootState } from '../app/store';
import { featureFlagsActions } from '../features/featureFlags/featureFlagsSlice';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import {
  importProjectThunk,
  projectActions,
  restoreSnapshotThunk,
} from '../features/project/projectSlice';
import { settingsActions } from '../features/settings/settingsSlice';
import { useTranslation } from '../hooks/useTranslation';
import { logger } from '../services/logger';
import { storageService } from '../services/storageService';
import type {
  AccessibilitySettings,
  AdvancedAiSettings,
  AdvancedEditorSettings,
  AiCreativity,
  BackupSettings,
  CollaborationSettings,
  CustomFont,
  EditorFont,
  IntegrationSettings,
  KeyboardShortcut,
  NotificationSettings,
  PerformanceSettings,
  PrivacySettings,
  ProjectSnapshot,
  StoryProject,
  Theme,
  ThemeCustomization,
  WritingGoal,
} from '../types';

type ModalState = 'closed' | 'reset' | 'restore' | 'delete' | 'create';
type ModalPayload = { id?: number; name?: string; date?: string; wordCount?: number };

export const useSettingsView = () => {
  const { t, language, setLanguage } = useTranslation();
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);
  const featureFlags = useAppSelector((state) => state.featureFlags);
  const projectState = useAppSelector((state) => state.project.present);
  const project = projectState.data;
  // We mock the RootState structure for the selector, as we are pulling from a detached state slice for export/management
  const characters = selectAllCharacters({ project: { present: projectState } } as RootState);
  const worlds = selectAllWorlds({ project: { present: projectState } } as RootState);

  const [activeCategory, setActiveCategory] = useState('data');
  const [modal, setModal] = useState<{ state: ModalState; payload: ModalPayload }>({
    state: 'closed',
    payload: {},
  });
  const importFileRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState('');

  const refreshSnapshots = useCallback(async () => {
    const snaps = await storageService.listSnapshots();
    setSnapshots(snaps);
  }, []);

  useEffect(() => {
    if (activeCategory === 'data') {
      refreshSnapshots();
    }
  }, [activeCategory, refreshSnapshots]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setLanguage(e.target.value as 'en' | 'de' | 'fr' | 'es' | 'it');
    },
    [setLanguage],
  );

  const handleSettingChange = useCallback(
    (key: string, value: unknown) => {
      switch (key) {
        // Basic Settings
        case 'theme':
          dispatch(settingsActions.setTheme(value as Theme));
          break;
        case 'editorFont':
          dispatch(settingsActions.setEditorFont(value as EditorFont));
          break;
        case 'fontSize':
          dispatch(settingsActions.setFontSize(Number(value)));
          break;
        case 'lineSpacing':
          dispatch(settingsActions.setLineSpacing(Number(value)));
          break;
        case 'aiCreativity':
          dispatch(settingsActions.setAiCreativity(value as AiCreativity));
          break;
        case 'paragraphSpacing':
          dispatch(settingsActions.setParagraphSpacing(Number(value)));
          break;
        case 'indentFirstLine':
          dispatch(settingsActions.setIndentFirstLine(Boolean(value)));
          break;

        // Advanced Settings
        case 'customFont':
          dispatch(settingsActions.setCustomFont(value as unknown as CustomFont | undefined));
          break;
        case 'keyboardShortcuts':
          dispatch(settingsActions.setKeyboardShortcuts(value as unknown as KeyboardShortcut[]));
          break;
        case 'writingGoals':
          dispatch(settingsActions.setWritingGoals(value as unknown as WritingGoal[]));
          break;
        case 'advancedAi':
          dispatch(settingsActions.setAdvancedAi(value as unknown as Partial<AdvancedAiSettings>));
          break;
        case 'accessibility':
          dispatch(
            settingsActions.setAccessibility(value as unknown as Partial<AccessibilitySettings>),
          );
          break;
        case 'privacy':
          dispatch(settingsActions.setPrivacy(value as unknown as Partial<PrivacySettings>));
          break;
        case 'performance':
          dispatch(
            settingsActions.setPerformance(value as unknown as Partial<PerformanceSettings>),
          );
          break;
        case 'notifications':
          dispatch(
            settingsActions.setNotifications(value as unknown as Partial<NotificationSettings>),
          );
          break;
        case 'collaboration':
          dispatch(
            settingsActions.setCollaboration(value as unknown as Partial<CollaborationSettings>),
          );
          break;
        case 'integrations':
          dispatch(
            settingsActions.setIntegrations(value as unknown as Partial<IntegrationSettings>),
          );
          break;
        case 'advancedEditor':
          dispatch(
            settingsActions.setAdvancedEditor(value as unknown as Partial<AdvancedEditorSettings>),
          );
          break;
        case 'backup':
          dispatch(settingsActions.setBackup(value as unknown as Partial<BackupSettings>));
          break;
        case 'themeCustomization':
          dispatch(
            settingsActions.setThemeCustomization(value as unknown as Partial<ThemeCustomization>),
          );
          break;
        case 'enableOllama':
          dispatch(featureFlagsActions.setEnableOllama(Boolean(value)));
          break;
        case 'enablePerformanceBudgets':
          dispatch(featureFlagsActions.setEnablePerformanceBudgets(Boolean(value)));
          break;
        case 'enableVisualRegression':
          dispatch(featureFlagsActions.setEnableVisualRegression(Boolean(value)));
          break;
        default:
          logger.warn(`Unknown setting key: ${key}`);
          break;
      }
    },
    [dispatch],
  );

  const projectSize = useMemo(() => {
    const size = new TextEncoder().encode(JSON.stringify(project)).length;
    return `${(size / 1024).toFixed(2)} KB`;
  }, [project]);

  const currentWordCount = useMemo(() => {
    return project.manuscript.reduce(
      (sum, section) => sum + (section.content?.split(/\s+/).filter(Boolean).length || 0),
      0,
    );
  }, [project.manuscript]);

  const handleExport = useCallback(() => {
    if (!project) return;
    const projectToExport: StoryProject = {
      ...project,
      characters,
      worlds,
    };
    const dataStr = JSON.stringify(projectToExport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.download = `${project.title.replace(/\s+/g, '_')}_backup.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [project, characters, worlds]);

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        const resultAction = await dispatch(importProjectThunk(file));
        if (importProjectThunk.fulfilled.match(resultAction)) {
          alert(t('settings.data.importSuccess'));
        } else {
          alert(t('settings.data.importError'));
        }
      }
      if (event.target) event.target.value = '';
    },
    [dispatch, t],
  );

  const handleResetProject = useCallback(() => {
    dispatch(
      projectActions.resetProject({
        title: t('initialProject.title'),
        logline: t('initialProject.logline'),
      }),
    );
    setModal({ state: 'closed', payload: {} });
  }, [dispatch, t]);

  const handleCreateSnapshot = useCallback(async () => {
    await storageService.saveSnapshot(snapshotName, project);
    setSnapshotName('');
    setModal({ state: 'closed', payload: {} });
    refreshSnapshots();
  }, [project, snapshotName, refreshSnapshots]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (modal.payload.id) {
      await dispatch(restoreSnapshotThunk(modal.payload.id));
      setModal({ state: 'closed', payload: {} });
    }
  }, [dispatch, modal.payload.id]);

  const handleDeleteSnapshot = useCallback(async () => {
    if (modal.payload.id) {
      await storageService.deleteSnapshot(modal.payload.id);
      setModal({ state: 'closed', payload: {} });
      refreshSnapshots();
    }
  }, [modal.payload.id, refreshSnapshots]);

  return {
    t,
    language,
    settings,
    featureFlags,
    project,
    activeCategory,
    setActiveCategory,
    modal,
    setModal,
    importFileRef,
    snapshots,
    snapshotName,
    setSnapshotName,
    handleLanguageChange,
    handleSettingChange,
    handleExport,
    handleImport,
    handleResetProject,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    projectSize,
    currentWordCount,
  };
};

export type UseSettingsViewReturnType = ReturnType<typeof useSettingsView>;
