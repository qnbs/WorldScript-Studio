import { sanitizePromptValue } from '../../aiUtils';
import { localServerFetch } from '../../localServerHttp';
import { assertCspConnectEndpointAllowed } from '../../network/cspOriginPolicy';
import { isTauriRuntime } from '../../tauriRuntime';
import type { AIRequestOptions, AIStreamCallbacks } from '../contracts/providerRequest';
import { normalizeOllamaModelId, normalizeOpenAiCompatibleBaseUrl } from '../modelNormalization';

export function isOpenAiCompatibleLocalPreset(
  preset: AIRequestOptions['localBackendPreset'],
): boolean {
  return preset === 'lm_studio' || preset === 'vllm' || preset === 'custom';
}

function localOpenAiErrorSuffix(bodyText: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string };
    detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? bodyText);
  } catch {
    detail = bodyText;
  }
  return detail.trim() ? `: ${detail.trim().slice(0, 300)}` : '';
}

function parseLocalOpenAiSseLine(rawLine: string, onChunk: (chunk: string) => void): void {
  const line = rawLine.trimEnd();
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
  try {
    const json: unknown = JSON.parse(line.slice(6));
    const delta =
      typeof json === 'object' && json !== null
        ? (json as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta
            ?.content
        : undefined;
    if (typeof delta === 'string' && delta) onChunk(delta);
  } catch {
    // QNBS-v3: Ignore an incomplete SSE frame; a later frame still carries the valid delta.
  }
}

async function consumeLocalOpenAiStream(
  response: Response,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Local OpenAI-compatible server returned no response body');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Local generation aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (signal?.aborted) break;
        parseLocalOpenAiSseLine(line, callbacks.onChunk);
      }
    }
    // A reader that already reported done has completed the response; preserve its final frame
    // even if cancellation races with that terminal read.
    if (buffer) parseLocalOpenAiSseLine(buffer, callbacks.onChunk);
    callbacks.onDone?.();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function streamOpenAiCompatibleLocal(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const endpoint = normalizeOpenAiCompatibleBaseUrl(
    opts.ollamaBaseUrl?.trim() || 'http://localhost:1234',
  );
  if (!isTauriRuntime()) {
    assertCspConnectEndpointAllowed(endpoint, 'Local OpenAI-compatible endpoint');
  }
  const messages = opts.systemPrompt
    ? [
        { role: 'system', content: sanitizePromptValue(opts.systemPrompt) },
        { role: 'user', content: sanitizePromptValue(prompt) },
      ]
    : [{ role: 'user', content: sanitizePromptValue(prompt) }];
  const response = await localServerFetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: normalizeOllamaModelId(opts.model),
      stream: true,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: opts.signal ?? null,
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Local OpenAI-compatible server HTTP ${response.status}${localOpenAiErrorSuffix(bodyText)}`,
    );
  }
  return consumeLocalOpenAiStream(response, callbacks, opts.signal);
}
