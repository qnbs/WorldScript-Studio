/**
 * openrouterModels.ts
 * -------------------
 * Model catalog + key validation for OpenRouter.
 * QNBS-v3: Fetches the public /models endpoint, caches results locally for 1 h,
 * and provides a lightweight key probe so the Settings UI can validate a key
 * before the first inference call.
 */

import { createLogger } from '../logger';
import { assertCloudAiAllowed } from './aiPolicy';

const logger = createLogger('openrouter-models');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODELS_URL = `${OPENROUTER_BASE_URL}/models`;
const CACHE_KEY = 'worldscript-openrouter-models';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface OpenRouterModel {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  contextLength?: number | undefined;
  pricing?:
    | {
        prompt?: number | undefined;
        completion?: number | undefined;
        image?: number | undefined;
        request?: number | undefined;
      }
    | undefined;
}

interface CacheEntry {
  fetchedAt: number;
  models: OpenRouterModel[];
  // QNBS-v3: Whether this catalog was fetched with an API key. Buckets the cache by credential
  // scope (anonymous vs. authenticated) so an anonymous catalog is never served to an authenticated
  // request, and vice-versa. A plain boolean — NO key-derived material is ever written to storage.
  authed?: boolean;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && window.localStorage !== undefined;
}

function isValidCacheEntry(parsed: unknown): parsed is CacheEntry {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  if (typeof p['fetchedAt'] !== 'number' || !Array.isArray(p['models'])) return false;
  // QNBS-v3: Ensure every cached model has a string id so downstream consumers can rely on it.
  return p['models'].every(
    (m) =>
      m !== null &&
      typeof m === 'object' &&
      typeof (m as Record<string, unknown>)['id'] === 'string',
  );
}

function readCache(expectedAuthed: boolean): CacheEntry | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCacheEntry(parsed)) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    // QNBS-v3: Only reuse within the same credential scope. A legacy entry without the flag is
    // treated as anonymous so it's reused only for anonymous requests.
    if ((parsed.authed ?? false) !== expectedAuthed) return null;
    // QNBS-v3: Normalize cached items so malformed entries cannot leak bad field types downstream.
    const normalized = (parsed.models as unknown[])
      .map(normalizeModel)
      .filter((m): m is OpenRouterModel => m !== null);
    return { fetchedAt: parsed.fetchedAt, models: normalized };
  } catch {
    return null;
  }
}

function writeCache(models: OpenRouterModel[], authed: boolean): void {
  if (!isBrowser()) return;
  try {
    const entry: CacheEntry = { fetchedAt: Date.now(), models, authed };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch (err) {
    logger.warn('Failed to write OpenRouter model cache', { error: String(err) });
  }
}

function normalizeModel(raw: unknown): OpenRouterModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  if (typeof id !== 'string' || !id.trim()) return null;
  return {
    id,
    name: typeof r['name'] === 'string' ? r['name'] : undefined,
    description: typeof r['description'] === 'string' ? r['description'] : undefined,
    // QNBS-v3: Accept both the raw API key (`context_length`) and the already-normalized
    // shape (`contextLength`) so re-normalizing cached models doesn't drop the field.
    contextLength:
      typeof r['context_length'] === 'number'
        ? r['context_length']
        : typeof r['contextLength'] === 'number'
          ? r['contextLength']
          : undefined,
    pricing:
      r['pricing'] && typeof r['pricing'] === 'object'
        ? (r['pricing'] as OpenRouterModel['pricing'])
        : undefined,
  };
}

/** QNBS-v3: Fetch the OpenRouter model catalog. Uses a 1h localStorage cache. */
export async function fetchOpenRouterModels(
  apiKey?: string | undefined,
): Promise<OpenRouterModel[]> {
  // QNBS-v3: Bucket the cache by credential scope (anonymous vs. authenticated) so an anonymously
  // fetched catalog is never served to an authenticated request — without persisting any key data.
  const authed = Boolean(apiKey?.trim());
  const cached = readCache(authed);
  if (cached) {
    logger.debug('OpenRouter model cache hit');
    return cached.models;
  }

  // QNBS-v3: Enforce the cloud AI policy before any outbound OpenRouter request.
  await assertCloudAiAllowed('openrouter');

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey?.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch(MODELS_URL, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter models API error ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: unknown[] };
  const rawModels = Array.isArray(json.data) ? json.data : [];
  const models = rawModels
    .map(normalizeModel)
    .filter((m): m is OpenRouterModel => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  writeCache(models, authed);
  return models;
}

/** QNBS-v3: Returns cached models immediately if available, otherwise fetches. */
export async function getOpenRouterModelCatalog(
  apiKey?: string | undefined,
): Promise<OpenRouterModel[]> {
  return fetchOpenRouterModels(apiKey);
}

/** QNBS-v3: Lightweight key probe — a 401 means the key is invalid. */
export async function validateOpenRouterKey(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ok: false, error: 'EMPTY_KEY' };
  }

  // QNBS-v3: Key validation is a cloud request; apply the same AI policy gate.
  await assertCloudAiAllowed('openrouter');

  try {
    const res = await fetch(MODELS_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${trimmed}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401) {
      return { ok: false, error: 'INVALID_KEY' };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    // QNBS-v3: Match aborts by name, not class — some fetch runtimes surface a timeout/abort as a
    // plain Error (not a DOMException) with name 'AbortError'; those must map to TIMEOUT, not NETWORK_ERROR.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'AbortError'
    ) {
      return { ok: false, error: 'TIMEOUT' };
    }
    logger.warn('OpenRouter key validation failed', { error: String(err) });
    return { ok: false, error: 'NETWORK_ERROR' };
  }
}

/** QNBS-v3: Clear the local model cache (e.g. after key change). */
export function clearOpenRouterModelCache(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch (err) {
    logger.warn('Failed to clear OpenRouter model cache', { error: String(err) });
  }
}

export function isOpenRouterFreeModel(modelId: string): boolean {
  return modelId.endsWith(':free');
}
