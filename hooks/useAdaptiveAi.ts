/**
 * useAdaptiveAi — Adaptive AI engine state + device health monitoring.
 * Bridges the adaptiveAiEngine singleton with React components.
 * Watches enableAdaptiveAiEngine feature flag and eco-mode changes.
 */

import { releaseAllOnnxSessions, releaseAllWebLlmEngines } from '@domain/ai-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import {
  selectEnableAdaptiveAiEngine,
  selectEnableComputeShaders,
} from '../features/featureFlags/featureFlagsSlice';
import {
  type AiTaskType,
  adaptiveAiEngine,
  type TaskConfig,
  type WarmedModelEntry,
} from '../services/ai/adaptiveAiEngine';
import { ecoModeService } from '../services/ai/ecoModeService';
import {
  type DeviceCapabilityProfile,
  generateDeviceProfile,
} from '../services/ai/localAiDeviceProfiler';
import { logger as log } from '../services/logger';

// QNBS-v3: device profile is refreshed every 30s while the feature is active
const PROFILE_REFRESH_INTERVAL_MS = 30_000;

export interface UseAdaptiveAiReturn {
  /** True when enableAdaptiveAiEngine feature flag is on */
  enabled: boolean;
  /** True when enableComputeShaders feature flag is on */
  computeShadersEnabled: boolean;
  /** True when battery is low and eco-mode is active */
  isEco: boolean;
  /** Latest device capability profile; null while loading */
  deviceProfile: DeviceCapabilityProfile | null;
  /** Currently warmed (preloaded) model entries */
  warmedModels: WarmedModelEntry[];
  /** Get optimal backend + model for a task (async; triggers profile load if needed) */
  getTaskConfig: (task: AiTaskType) => Promise<TaskConfig>;
  /** Pre-load the model for a task into GPU memory */
  prewarmModel: (task: AiTaskType) => Promise<void>;
  /** Release the warmed model for a task */
  releaseModel: (task: AiTaskType) => void;
}

export function useAdaptiveAi(): UseAdaptiveAiReturn {
  const enabled = useAppSelector(selectEnableAdaptiveAiEngine);
  const computeShadersEnabled = useAppSelector(selectEnableComputeShaders);

  const [isEco, setIsEco] = useState<boolean>(() => ecoModeService.isEcoMode());
  const [deviceProfile, setDeviceProfile] = useState<DeviceCapabilityProfile | null>(null);
  const [warmedModels, setWarmedModels] = useState<WarmedModelEntry[]>([]);

  // Ref to avoid stale-closure issues in interval
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Subscribe to eco-mode changes
  useEffect(() => {
    return ecoModeService.onEcoModeChange((eco) => {
      setIsEco(eco);
      // Refresh device profile on eco-mode change (battery state affects backend selection)
      if (enabledRef.current) {
        void generateDeviceProfile()
          .then(setDeviceProfile)
          .catch((e) => {
            log.warn('Profile refresh on eco-mode change failed', e as Error);
          });
      }
    });
  }, []);

  // Load and periodically refresh device profile while feature is enabled
  useEffect(() => {
    if (!enabled) {
      setDeviceProfile(null);
      setWarmedModels([]);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const profile = await generateDeviceProfile();
        if (!cancelled) {
          setDeviceProfile(profile);
          setWarmedModels(adaptiveAiEngine.getWarmedModels());
        }
      } catch (e) {
        log.warn('Device profile refresh failed', e as Error);
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), PROFILE_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  // Release GPU resources when feature is disabled
  useEffect(() => {
    if (!enabled) {
      releaseAllWebLlmEngines();
      releaseAllOnnxSessions();
    }
  }, [enabled]);

  const getTaskConfig = useCallback((task: AiTaskType) => adaptiveAiEngine.getTaskConfig(task), []);

  const prewarmModel = useCallback(async (task: AiTaskType) => {
    await adaptiveAiEngine.prewarmModel(task);
    setWarmedModels(adaptiveAiEngine.getWarmedModels());
  }, []);

  const releaseModel = useCallback((task: AiTaskType) => {
    adaptiveAiEngine.releaseModel(task);
    setWarmedModels(adaptiveAiEngine.getWarmedModels());
  }, []);

  return useMemo(
    () => ({
      enabled,
      computeShadersEnabled,
      isEco,
      deviceProfile,
      warmedModels,
      getTaskConfig,
      prewarmModel,
      releaseModel,
    }),
    [
      enabled,
      computeShadersEnabled,
      isEco,
      deviceProfile,
      warmedModels,
      getTaskConfig,
      prewarmModel,
      releaseModel,
    ],
  );
}
