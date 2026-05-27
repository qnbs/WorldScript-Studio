/**
 * LoRA Ollama Service
 * QNBS-v3: Ollama REST API integration for adapter model creation and management.
 *          Reuses existing listOllamaModels() from aiProviderService for model listing.
 */

import { logger } from '../logger';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function getOllamaUrl(): string {
  try {
    const { appStoreRef } = require('../../app/store');
    const state = appStoreRef.current?.getState();
    return state?.settings?.localAi?.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

// ---------------------------------------------------------------------------
// Modelfile generation
// ---------------------------------------------------------------------------

export function generateModelfile(
  baseModel: string,
  adapterGgufPath: string,
  assistantName: string,
): string {
  return [
    `FROM ${baseModel}`,
    `ADAPTER ${adapterGgufPath}`,
    `SYSTEM "You are ${assistantName}, a creative writing assistant trained on this author's unique style. Match their voice, rhythm, and vocabulary precisely."`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Ollama REST API wrappers
// ---------------------------------------------------------------------------

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: { format?: string; family?: string };
}

export async function listOllamaModels(baseUrl?: string): Promise<OllamaModel[]> {
  const url = `${baseUrl ?? getOllamaUrl()}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  } catch (err) {
    logger.warn('loraOllamaService: listOllamaModels failed', { err });
    return [];
  }
}

export async function createOllamaModelFromAdapter(
  baseModel: string,
  adapterGgufPath: string,
  modelName: string,
  baseUrl?: string,
): Promise<void> {
  const url = `${baseUrl ?? getOllamaUrl()}/api/create`;
  const modelfile = generateModelfile(baseModel, adapterGgufPath, modelName);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, modelfile }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama create failed (${res.status}): ${text}`);
  }
  // Stream response until done
  const reader = res.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Each line is a JSON status object; check for error
      for (const line of chunk.split('\n').filter(Boolean)) {
        try {
          const obj = JSON.parse(line) as { status?: string; error?: string };
          if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    }
  }
}

export async function deleteOllamaModel(modelName: string, baseUrl?: string): Promise<void> {
  const url = `${baseUrl ?? getOllamaUrl()}/api/delete`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function testOllamaAdapterPrompt(
  modelName: string,
  prompt: string,
  signal: AbortSignal,
  baseUrl?: string,
): Promise<string> {
  const url = `${baseUrl ?? getOllamaUrl()}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt,
      stream: false,
      options: { num_predict: 200 },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama generate failed (${res.status})`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? '';
}

/** List only adapter-capable models (those tagged with LoRA style in metadata). */
export async function listOllamaAdapterModels(baseUrl?: string): Promise<OllamaModel[]> {
  const all = await listOllamaModels(baseUrl);
  // Filter by name convention: storycraft-lora-* or any user-created lora models
  return all.filter((m) => m.name.includes('lora') || m.name.startsWith('storycraft-'));
}
