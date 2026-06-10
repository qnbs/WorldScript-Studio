/**
 * Node adapter for the ProForge Capability Layer (used by the MCP server).
 * QNBS-v3: Operates on a portable, untrusted project payload — no Redux, no IndexedDB. The memory
 * bank uses its in-process fallback (seeded from the payload); run history is an optional JSON file.
 * The gateway is constructed only when an API key is available, so the pure ops (applyEdits,
 * ragQuery-lexical, getHistory, getSupervisorStatus) work with zero credentials.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { PipelineRun } from '../../../features/proForge/types';
import type {
  ProForgeCapabilityPorts,
  ProForgeGatewayPort,
  ProForgeProjectSnapshot,
} from '../proForgeCapabilityCore';
import {
  createProForgeCapabilityLayer,
  type ProForgeCapabilityLayer,
} from '../proForgeCapabilityLayer';
import { type ProjectPayload, projectPayloadSchema } from '../proForgeCapabilitySchemas';
import { getMemoryBank, saveMemoryEntry } from '../proForgeMemoryBank';
import { NodeInferenceGateway, resolveNodeApiKey } from './nodeInferenceGateway';

export interface NodeCapabilityOptions {
  /** Optional path to a JSON run-history file ({ runs: PipelineRun[] }). */
  historyFile?: string;
  /** Explicit gateway (tests). Defaults to NodeInferenceGateway when an API key is present. */
  gateway?: ProForgeGatewayPort;
  /** Env source (tests). */
  env?: NodeJS.ProcessEnv;
}

/** Gateway that rejects AI calls with a clear, actionable message (no API key configured). */
function makeUnavailableGateway(reason: string): ProForgeGatewayPort {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    generate: fail,
    embed: async () => ({ vector: [] }),
    modelList: async () => [],
    healthCheck: async () => ({ status: 'unavailable', provider: 'gemini' }),
  };
}

function payloadToSnapshot(payload: ProjectPayload): ProForgeProjectSnapshot {
  return {
    id: payload.projectId,
    title: payload.title,
    logline: payload.logline,
    manuscript: payload.manuscript,
    characters: payload.characters,
    worlds: payload.worlds,
  };
}

async function loadHistoryFile(path: string): Promise<PipelineRun[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as { runs?: PipelineRun[] } | PipelineRun[];
    return Array.isArray(parsed) ? parsed : (parsed.runs ?? []);
  } catch {
    return [];
  }
}

/**
 * Build a ProForge Capability Layer bound to a portable project payload. Validates the payload,
 * seeds the in-process memory bank, and wires Node ports. Async because memory seeding is async.
 */
export async function createNodeProForgeCapability(
  rawPayload: unknown,
  opts: NodeCapabilityOptions = {},
): Promise<ProForgeCapabilityLayer> {
  const payload = projectPayloadSchema.parse(rawPayload);
  const snapshot = payloadToSnapshot(payload);

  // Seed memory entries from the payload into the in-process bank.
  // QNBS-v3 (CodeAnt #5): derive a DETERMINISTIC id when the payload omits one, so re-building the
  // capability (e.g. before the per-payload cache in capability.ts kicks in, or with a different
  // adapter) overwrites rather than mints a fresh random id per seed → no duplicate RAG hits / bloat.
  for (const entry of payload.memoryEntries) {
    await saveMemoryEntry({
      id: entry.id ?? `${payload.projectId}:${entry.category}:${entry.key}`,
      projectId: payload.projectId,
      category: entry.category,
      key: entry.key,
      content: entry.content,
      sourceStage: entry.sourceStage,
    });
  }

  // Resolve gateway: explicit > NodeInferenceGateway (if key) > unavailable stub.
  let gateway: ProForgeGatewayPort;
  if (opts.gateway) {
    gateway = opts.gateway;
  } else {
    try {
      const apiKey = resolveNodeApiKey(opts.env);
      gateway = new NodeInferenceGateway({ apiKey });
    } catch (err) {
      gateway = makeUnavailableGateway(
        err instanceof Error ? err.message : 'AI gateway unavailable',
      );
    }
  }

  const ports: ProForgeCapabilityPorts = {
    gateway,
    memory: (projectId) => getMemoryBank(projectId),
    history: {
      load: async (projectId) => {
        if (!opts.historyFile) return [];
        const runs = await loadHistoryFile(opts.historyFile);
        return runs.filter((r) => r.projectId === projectId);
      },
      save: async (_projectId, runs) => {
        if (opts.historyFile) {
          await writeFile(opts.historyFile, JSON.stringify({ runs }, null, 2), 'utf8');
        }
      },
    },
    project: { get: (projectId) => (projectId === payload.projectId ? snapshot : null) },
    // QNBS-v3: running the MCP server IS the opt-in; the browser feature flag does not apply here.
    isEnabled: () => true,
  };

  return createProForgeCapabilityLayer(ports);
}
