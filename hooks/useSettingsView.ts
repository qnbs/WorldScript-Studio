import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { RootState } from '../app/store';
import type { PassphraseModalMode } from '../components/settings/PassphraseModal';
import { useToast } from '../components/ui/Toast';
import { featureFlagsActions } from '../features/featureFlags/featureFlagsSlice';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import {
  importProjectThunk,
  restoreSnapshotThunk,
} from '../features/project/thunks/projectManagementThunks';
import { settingsActions } from '../features/settings/settingsSlice';
import { statusActions } from '../features/status/statusSlice';
import { useTranslation } from '../hooks/useTranslation';
import { dbService } from '../services/dbService';
import { wipeAllAppData } from '../services/factoryResetService';
import { logger } from '../services/logger';
import {
  clearIdbEncryptionKey,
  clearIdbPassphrase,
  isIdbEncryptionReady,
  rotateIdbPassphrase,
  setupIdbEncryption,
  verifyAndInitIdbEncryption,
} from '../services/storage/storageEncryptionService';
import { storageService } from '../services/storageService';
import type {
  AccessibilitySettings,
  AdvancedAiSettings,
  AdvancedEditorSettings,
  AiCreativity,
  AppearancePreset,
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
  VoiceSettings,
  WritingGoal,
} from '../types';

type ModalState = 'closed' | 'reset' | 'restore' | 'delete' | 'create' | 'factoryReset';
type ModalPayload = { id?: number; name?: string; date?: string; wordCount?: number };

export const useSettingsView = () => {
  const { t, language, setLanguage } = useTranslation();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const settings = useAppSelector((state) => state.settings);
  const featureFlags = useAppSelector((state) => state.featureFlags);
  const projectState = useAppSelector((state) => state.project.present);
  const project = projectState.data;
  // We mock the RootState structure for the selector, as we are pulling from a detached state slice for export/management
  const characters = selectAllCharacters({ project: { present: projectState } } as RootState);
  const worlds = selectAllWorlds({ project: { present: projectState } } as RootState);

  const [activeCategory, setActiveCategory] = useState('general');

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('storycraft-settings-category');
      if (pending) {
        setActiveCategory(pending);
        sessionStorage.removeItem('storycraft-settings-category');
      }
    } catch {
      /* storage blocked */
    }
  }, []);
  const [modal, setModal] = useState<{ state: ModalState; payload: ModalPayload }>({
    state: 'closed',
    payload: {},
  });
  const importFileRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState('');
  const [passphraseModal, setPassphraseModal] = useState<PassphraseModalMode | 'closed'>('closed');
  const [encryptionReady, setEncryptionReady] = useState(isIdbEncryptionReady());

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
        case 'appearancePreset':
          dispatch(settingsActions.setAppearancePreset(value as AppearancePreset));
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
        case 'voice':
          dispatch(settingsActions.setVoiceSettings(value as unknown as Partial<VoiceSettings>));
          break;
        case 'enableVoiceSupport':
          dispatch(featureFlagsActions.setEnableVoiceSupport(Boolean(value)));
          break;
        case 'enableStoryBibleAdvanced':
          dispatch(featureFlagsActions.setEnableStoryBibleAdvanced(Boolean(value)));
          break;
        case 'enableBinderResearch':
          dispatch(featureFlagsActions.setEnableBinderResearch(Boolean(value)));
          break;
        case 'enableCompileWizard':
          dispatch(featureFlagsActions.setEnableCompileWizard(Boolean(value)));
          break;
        case 'enableProjectHealthScore':
          dispatch(featureFlagsActions.setEnableProjectHealthScore(Boolean(value)));
          break;
        case 'enableAppHealthPanel':
          dispatch(featureFlagsActions.setEnableAppHealthPanel(Boolean(value)));
          break;
        case 'enableDuckDbAnalytics':
          dispatch(featureFlagsActions.setEnableDuckDbAnalytics(Boolean(value)));
          break;
        case 'enableObjectsGroups':
          dispatch(featureFlagsActions.setEnableObjectsGroups(Boolean(value)));
          break;
        case 'enableMindMaps':
          dispatch(featureFlagsActions.setEnableMindMaps(Boolean(value)));
          break;
        case 'enableCharacterInterviews':
          dispatch(featureFlagsActions.setEnableCharacterInterviews(Boolean(value)));
          break;
        case 'enableRtlLayout':
          dispatch(featureFlagsActions.setEnableRtlLayout(Boolean(value)));
          break;
        case 'enableLoraAdapters':
          dispatch(featureFlagsActions.setEnableLoraAdapters(Boolean(value)));
          break;
        case 'enablePluginSystem':
          dispatch(featureFlagsActions.setEnablePluginSystem(Boolean(value)));
          break;
        // QNBS-v3: Three flags were wired into FeatureFlagsSection.tsx but missing here;
        // toggles fell to default and logged a warning without updating Redux/localStorage.
        case 'enableProForge':
          dispatch(featureFlagsActions.setEnableProForge(Boolean(value)));
          // QNBS-v3: guide user to the ProForge button — it is only in WriterView, not the sidebar
          if (value) toast.info(t('proforge.enabledHint'));
          break;
        case 'enableVoiceWasm':
          dispatch(featureFlagsActions.setEnableVoiceWasm(Boolean(value)));
          break;
        // QNBS-v3: Edge-AI Perfection Cycle flags
        case 'enableAdaptiveAiEngine':
          dispatch(featureFlagsActions.setEnableAdaptiveAiEngine(Boolean(value)));
          break;
        case 'enableWebnnInference':
          dispatch(featureFlagsActions.setEnableWebnnInference(Boolean(value)));
          break;
        case 'enableComputeShaders':
          dispatch(featureFlagsActions.setEnableComputeShaders(Boolean(value)));
          break;
        // QNBS-v3: Phase 2 WorkerBus v2 flags — wired to listenerMiddleware init/shutdown
        case 'enableWorkerBusV2':
          dispatch(featureFlagsActions.setEnableWorkerBusV2(Boolean(value)));
          break;
        case 'enableRustCompute':
          dispatch(featureFlagsActions.setEnableRustCompute(Boolean(value)));
          break;
        // QNBS-v3: enableIdbAtRestEncryption intentionally absent — managed via handlePassphraseConfirm
        // in Settings > Privacy, not the experimental flags UI toggle.
        default:
          logger.warn(`Unknown setting key: ${key}`);
          break;
      }
    },
    [dispatch, t, toast.info],
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
          dispatch(
            statusActions.addNotification({
              type: 'success',
              title: t('settings.data.importSuccess'),
            }),
          );
        } else {
          dispatch(
            statusActions.addNotification({
              type: 'error',
              title: t('settings.data.importError'),
            }),
          );
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
        chapter1Title: t('initialProject.chapter1'),
      }),
    );
    setModal({ state: 'closed', payload: {} });
  }, [dispatch, t]);

  const handleFactoryReset = useCallback(async () => {
    setModal({ state: 'closed', payload: {} });
    // QNBS-v3: wipes all IDB databases, localStorage, SW caches, then reloads.
    await wipeAllAppData();
  }, []);

  const handleRepeatOnboarding = useCallback(() => {
    // QNBS-v3: useApp.ts listens for this event and re-opens the WelcomePortal.
    window.dispatchEvent(new CustomEvent('storycraft:openPortal'));
  }, []);

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

  // QNBS-v3: B-1 passphrase handlers — sentinel-backed; each operation verifies against IDB token
  const handlePassphraseConfirm = useCallback(
    async (_current: string, newPassphrase: string) => {
      if (passphraseModal === 'set') {
        // QNBS-v3: setupIdbEncryption derives key, writes sentinel to IDB, sets _activeKey
        await setupIdbEncryption(newPassphrase);
        dispatch(featureFlagsActions.setEnableIdbAtRestEncryption(true));
        setEncryptionReady(true);
        // QNBS-v3: WCAG 4.1.3 — toast confirms success for keyboard/AT users who can't see status text
        toast.success(t('settings.privacy.encryptionActiveStatus'));
      } else if (passphraseModal === 'change') {
        // QNBS-v3: rotateIdbPassphrase verifies old passphrase, derives new key, then calls
        // reEncrypt callback to re-encrypt all existing IDB data before old key is discarded.
        await rotateIdbPassphrase(_current, newPassphrase, async (oldKey, newKey) => {
          await dbService.reEncryptAllAppData(oldKey, newKey);
          await dbService.reEncryptAllSnapshots(oldKey, newKey);
          // QNBS-v3: Codex, RAG vectors, images, and binder assets are re-encrypted on next
          // natural write. A full re-encryption of all auxiliary stores is Phase-2 hardening.
        });
        setEncryptionReady(true);
        toast.success(t('settings.privacy.encryptionActiveStatus'));
      } else if (passphraseModal === 'disable') {
        // QNBS-v3: verify current passphrase first, then remove sentinel and disable flag
        await verifyAndInitIdbEncryption(_current);
        await clearIdbPassphrase();
        dispatch(featureFlagsActions.setEnableIdbAtRestEncryption(false));
        setEncryptionReady(false);
        toast.info(t('settings.privacy.encryptionDisabledStatus'));
      }
      setPassphraseModal('closed');
    },
    [passphraseModal, dispatch, toast, t],
  );

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
    handleFactoryReset,
    handleRepeatOnboarding,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    projectSize,
    currentWordCount,
    passphraseModal,
    setPassphraseModal,
    encryptionReady,
    handlePassphraseConfirm,
    handleLockSession: useCallback(() => {
      clearIdbEncryptionKey();
      setEncryptionReady(false);
      toast.info(t('settings.privacy.encryptionLockedStatus'));
    }, [toast, t]),
  };
};

export type UseSettingsViewReturnType = ReturnType<typeof useSettingsView>;
