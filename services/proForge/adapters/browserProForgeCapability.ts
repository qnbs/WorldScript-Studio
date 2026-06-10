/**
 * Browser adapter for the ProForge Capability Layer.
 * QNBS-v3: Wires the real browser ports — the InferenceGateway singleton, the IndexedDB-backed
 * memory bank + run-history store, and a caller-supplied live project getter. This is the in-process
 * path used by the Global Copilot, the ProForge UI, and any future in-app AI feature.
 */

import type { PipelineRun } from '../../../features/proForge/types';
import { inferenceGateway } from '../../ai/inferenceGateway';
import type { ProForgeCapabilityPorts, ProForgeProjectSnapshot } from '../proForgeCapabilityCore';
import {
  createProForgeCapabilityLayer,
  type ProForgeCapabilityLayer,
} from '../proForgeCapabilityLayer';
import { loadRunHistory, saveRunHistory } from '../proForgeHistoryStore';
import { getMemoryBank } from '../proForgeMemoryBank';

export interface BrowserProForgeCapabilityDeps {
  /** Resolve the live project snapshot for a project id (from Redux/app state). */
  getProject: (projectId: string) => ProForgeProjectSnapshot | null;
  /** Feature-flag gate — typically `() => featureFlags.enableProForge`. */
  isEnabled: () => boolean;
  /** Optional: the in-flight run, prepended to persisted history so status reflects live runs. */
  getCurrentRun?: (projectId: string) => PipelineRun | null;
}

export function createBrowserProForgeCapability(
  deps: BrowserProForgeCapabilityDeps,
): ProForgeCapabilityLayer {
  const ports: ProForgeCapabilityPorts = {
    gateway: inferenceGateway,
    memory: (projectId) => getMemoryBank(projectId),
    history: {
      load: async (projectId) => {
        const persisted = await loadRunHistory(projectId);
        const current = deps.getCurrentRun?.(projectId);
        // QNBS-v3: surface the in-flight run first so getSupervisorStatus reflects a running pipeline.
        if (current && !persisted.some((r) => r.id === current.id)) {
          return [current, ...persisted];
        }
        return persisted;
      },
      save: async (projectId, runs) => saveRunHistory(projectId, runs),
    },
    project: { get: (projectId) => deps.getProject(projectId) },
    isEnabled: deps.isEnabled,
  };

  return createProForgeCapabilityLayer(ports);
}
