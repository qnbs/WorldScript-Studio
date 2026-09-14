import { LocalServerError, localServerFetch } from '../../localServerHttp';
import { CspConnectPolicyError } from '../../network/cspOriginPolicy';
import {
  listOllamaModels as listOllamaModelsFromService,
  testOllamaConnection,
} from '../../ollamaService';
import { isTauriRuntime } from '../../tauriRuntime';
import type { LocalBackendPreset } from '../contracts/providerRequest';
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

function localServerFailure(
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

export async function listLocalBackendModels(
  baseUrl: string | undefined,
  preset: LocalBackendPreset,
): Promise<string[]> {
  if (!isOpenAiCompatibleLocalPreset(preset)) return listOllamaModels(baseUrl);
  const result = await testOpenAiCompatibleLocalConnection(baseUrl);
  return result.ok ? (result.localServer?.modelNames ?? []) : [];
}

export type LocalEndpointScanState = 'ok' | 'unreachable' | 'timeout' | 'http';

export interface LocalEndpointScanResult {
  labelKey: string;
  baseUrl: string;
  ok: boolean;
  state: LocalEndpointScanState;
  /** Numeric HTTP status when the server answered (incl. error statuses). */
  status?: number;
}

export async function scanLocalOpenAiCompatibleEndpoints(): Promise<LocalEndpointScanResult[]> {
  const candidates = [
    { labelKey: 'settings.ai.scanLabelOllama', baseUrl: 'http://localhost:11434', ollama: true },
    { labelKey: 'settings.ai.scanLabelLmStudio', baseUrl: 'http://localhost:1234', ollama: false },
    { labelKey: 'settings.ai.scanLabelVllm', baseUrl: 'http://localhost:8000', ollama: false },
  ];
  return Promise.all(
    candidates.map(async ({ labelKey, baseUrl, ollama }): Promise<LocalEndpointScanResult> => {
      try {
        let response: Response;
        if (ollama) {
          try {
            response = await localServerFetch(`${baseUrl}/api/tags`, { timeoutMs: 2800 });
          } catch (nativeError) {
            if (nativeError instanceof LocalServerError && nativeError.kind === 'timeout') {
              throw nativeError;
            }
            const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
            response = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
          }
        } else {
          const root = normalizeOpenAiCompatibleBaseUrl(baseUrl);
          response = await localServerFetch(`${root}/models`, { timeoutMs: 2800 });
        }
        const ok = response.ok || response.status === 401;
        return { labelKey, baseUrl, ok, state: ok ? 'ok' : 'http', status: response.status };
      } catch (error) {
        const state: LocalEndpointScanState =
          error instanceof LocalServerError && error.kind === 'timeout' ? 'timeout' : 'unreachable';
        return { labelKey, baseUrl, ok: false, state };
      }
    }),
  );
}

export { isOpenAiCompatibleLocalPreset } from '../providers/localOpenAiCompatibleProvider';
export { testOllamaConnection };
