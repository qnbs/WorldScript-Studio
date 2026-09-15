import type { LocalBackendPreset } from '../../../types';
import { LocalServerError, localServerFetch } from '../../localServerHttp';
import { CspConnectPolicyError } from '../../network/cspOriginPolicy';
import { listOllamaModels as listOllamaModelsFromService } from '../../ollamaService';
import { isTauriRuntime } from '../../tauriRuntime';
import { normalizeOpenAiCompatibleBaseUrl } from '../modelNormalization';
import { isOpenAiCompatibleLocalPreset } from '../providers/localOpenAiCompatibleProvider';
import type { TestConnectionResult } from './connectionTests';

export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  return listOllamaModelsFromService(baseUrl);
}

/** Safe details from an explicit local-server diagnostic; credentials and response bodies stay local. */
export interface LocalServerDiagnostic {
  normalizedEndpoint: string;
  transport: 'tauri-http' | 'browser-fetch';
  modelNames: string[];
}

function localServerTransport(): LocalServerDiagnostic['transport'] {
  return isTauriRuntime() ? 'tauri-http' : 'browser-fetch';
}

export function localServerFailure(
  error: unknown,
  endpoint: string,
): Pick<TestConnectionResult, 'ok' | 'error' | 'kind' | 'params'> {
  if (error instanceof LocalServerError && error.kind === 'plugin_unavailable') {
    return { ok: false, error: 'Desktop HTTP plugin unavailable', kind: 'pluginUnavailable' };
  }
  if (error instanceof LocalServerError && error.kind === 'timeout') {
    return {
      ok: false,
      error: `Local server timed out (${endpoint})`,
      kind: 'timeout',
      params: { url: endpoint },
    };
  }
  if (error instanceof CspConnectPolicyError) {
    return {
      ok: false,
      error: error.message,
      kind: 'policyBlocked',
      params: { url: endpoint },
    };
  }
  return {
    ok: false,
    error: `Local server not reachable (${endpoint})`,
    kind: 'unreachable',
    params: { url: endpoint },
  };
}

/**
 * Tests the standard OpenAI-compatible endpoint used by LM Studio and vLLM. The request is
 * user-triggered by the Settings card; opening Settings remains side-effect free.
 */
export async function testOpenAiCompatibleLocalConnection(
  baseUrl: string | undefined,
): Promise<TestConnectionResult> {
  const normalizedEndpoint = normalizeOpenAiCompatibleBaseUrl(
    baseUrl?.trim() || 'http://localhost:1234',
  );
  try {
    const response = await localServerFetch(`${normalizedEndpoint}/models`, { timeoutMs: 5000 });
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        kind: 'httpError',
        params: { status: response.status },
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: 'Invalid models response', kind: 'invalidResponse' };
    }
    const data =
      typeof payload === 'object' &&
      payload !== null &&
      Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : null;
    if (data === null) {
      return { ok: false, error: 'Invalid models response', kind: 'invalidResponse' };
    }
    const modelNames = data.flatMap((model) => {
      if (typeof model !== 'object' || model === null) return [];
      const id = (model as { id?: unknown }).id;
      return typeof id === 'string' && id.trim() ? [id.trim()] : [];
    });
    if (modelNames.length === 0) {
      return { ok: false, error: 'No models exposed', kind: 'noModels' };
    }
    return {
      ok: true,
      localServer: { normalizedEndpoint, transport: localServerTransport(), modelNames },
    };
  } catch (error) {
    return localServerFailure(error, normalizedEndpoint);
  }
}

/** Loads models for an explicit local-backend choice without assuming every server speaks Ollama. */
export async function listLocalBackendModels(
  baseUrl: string | undefined,
  preset: LocalBackendPreset,
): Promise<string[]> {
  if (!isOpenAiCompatibleLocalPreset(preset)) return listOllamaModels(baseUrl);
  const result = await testOpenAiCompatibleLocalConnection(baseUrl);
  return result.ok ? (result.localServer?.modelNames ?? []) : [];
}

/** QNBS-v3: classified reachability of a scanned local endpoint (#266). */
export type LocalEndpointScanState = 'ok' | 'unreachable' | 'timeout' | 'http';

export interface LocalEndpointScanResult {
  labelKey: string;
  baseUrl: string;
  ok: boolean;
  state: LocalEndpointScanState;
  /** Numeric HTTP status when the server answered (incl. error statuses). */
  status?: number;
}

/**
 * QNBS-v3: Schneller Desktop-Check typischer lokaler /v1-Endpunkte — keine Secrets, nur
 * Erreichbarkeit. #266: routed through localServerFetch (Tauri plugin-http on desktop) so the
 * scan works inside the WebView, with per-endpoint state classification for actionable UI badges.
 * Ollama tries its native /api/tags first (present since early versions) before falling back to
 * the OpenAI-compat /v1/models shim (only on Ollama ≥0.1.24) — mirrors the native-first approach
 * testOllamaConnection/listOllamaModels already use, so an older Ollama install isn't missed.
 */
export async function scanLocalOpenAiCompatibleEndpoints(): Promise<LocalEndpointScanResult[]> {
  const candidates = [
    { labelKey: 'settings.ai.scanLabelOllama', baseUrl: 'http://localhost:11434', ollama: true },
    { labelKey: 'settings.ai.scanLabelLmStudio', baseUrl: 'http://localhost:1234', ollama: false },
    { labelKey: 'settings.ai.scanLabelVllm', baseUrl: 'http://localhost:8000', ollama: false },
  ];
  return Promise.all(
    candidates.map(async ({ labelKey, baseUrl, ollama }): Promise<LocalEndpointScanResult> => {
      try {
        let res: Response;
        if (ollama) {
          try {
            res = await localServerFetch(`${baseUrl}/api/tags`, { timeoutMs: 2800 });
          } catch (nativeErr) {
            if (nativeErr instanceof LocalServerError && nativeErr.kind === 'timeout') {
              throw nativeErr;
            }
            const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
            res = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
          }
        } else {
          const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
          res = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
        }
        const ok = res.ok || res.status === 401;
        return { labelKey, baseUrl, ok, state: ok ? 'ok' : 'http', status: res.status };
      } catch (err) {
        const state: LocalEndpointScanState =
          err instanceof LocalServerError && err.kind === 'timeout' ? 'timeout' : 'unreachable';
        return { labelKey, baseUrl, ok: false, state };
      }
    }),
  );
}
