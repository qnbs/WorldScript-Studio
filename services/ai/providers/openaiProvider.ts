import { sanitizePromptValue } from '../../aiUtils';
import { assertCspConnectEndpointAllowed } from '../../network/cspOriginPolicy';
import { storageService } from '../../storageService';
import type { AIRequestOptions, AIStreamCallbacks } from '../contracts/providerRequest';
import {
  buildOpenRouterStyleHeaders,
  isOfficialOpenAiApiRoot,
  normalizeOfficialOpenAiApiRoot,
  resolveOpenAiCompatibleRoot,
} from '../modelNormalization';

export const GROK_API_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

function buildOpenAiCompletionParameters(
  usesOfficialOpenAi: boolean,
  model: AIRequestOptions['model'],
  opts: Pick<AIRequestOptions, 'maxTokens' | 'temperature'>,
) {
  // QNBS-v3: direct OpenAI reasoning models reject legacy sampling parameters.
  if (usesOfficialOpenAi && /^o\d/.test(model)) {
    return { max_completion_tokens: opts.maxTokens ?? 2048 };
  }
  return { temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 2048 };
}

export async function consumeOpenAiCompatibleStream(
  response: Response,
  callbacks: AIStreamCallbacks,
  providerName: 'OpenAI' | 'Grok',
  abortPolicy: 'complete' | 'throw',
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${providerName}: No response body`);

  // QNBS-v3: OpenAI and xAI share the chat-completions SSE framing; one typed consumer keeps
  // final-frame flushing and abort completion semantics identical across both cloud adapters.
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDone = false;
  const parseLine = (rawLine: string): void => {
    const line = rawLine.trimEnd();
    if (!line.startsWith('data: ')) return;
    if (line === 'data: [DONE]') {
      receivedDone = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(line.slice(6));
    } catch {
      return;
    }
    if (typeof payload !== 'object' || payload === null) return;
    const delta = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]
      ?.delta?.content;
    if (typeof delta === 'string' && delta) callbacks.onChunk(delta);
  };

  try {
    while (true) {
      if (signal?.aborted) {
        if (abortPolicy === 'complete') {
          callbacks.onDone?.();
          return;
        }
        break;
      }
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (error) {
        if (signal?.aborted && abortPolicy === 'complete') {
          callbacks.onDone?.();
          return;
        }
        throw error;
      }
      const { done, value } = readResult;
      if (signal?.aborted) {
        if (abortPolicy === 'complete') {
          callbacks.onDone?.();
          return;
        }
        throw Object.assign(new Error(`${providerName} stream aborted`), { name: 'AbortError' });
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (signal?.aborted) break;
        parseLine(line);
      }
    }
    if (signal?.aborted) {
      if (abortPolicy === 'complete') {
        callbacks.onDone?.();
        return;
      }
      throw Object.assign(new Error(`${providerName} stream aborted`), { name: 'AbortError' });
    }
    buffer += decoder.decode();
    if (buffer) parseLine(buffer);
    if (abortPolicy === 'throw' && !receivedDone) {
      throw new Error(`${providerName}: stream ended before completion`);
    }
    callbacks.onDone?.();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function streamOpenAI(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const apiKey = await storageService.getApiKey('openai');
  if (!apiKey) throw new Error('NO_API_KEY: OpenAI API key missing. Please enter it in Settings.');
  const apiRoot = normalizeOfficialOpenAiApiRoot(
    resolveOpenAiCompatibleRoot(opts.openAiCompatibleBaseUrl),
  );
  const usesOfficialOpenAi = isOfficialOpenAiApiRoot(apiRoot);
  const isValidOpenAiModel = opts.model.startsWith('gpt-') || /^o\d/.test(opts.model);
  if (usesOfficialOpenAi && !isValidOpenAiModel) {
    throw new Error(
      `OpenAI: Model "${opts.model}" is not a valid OpenAI model. Please select a GPT or o-series model (e.g. gpt-4.1, o3, o4-mini) in Settings.`,
    );
  }
  const messages = opts.systemPrompt
    ? [
        { role: 'system', content: sanitizePromptValue(opts.systemPrompt) },
        { role: 'user', content: sanitizePromptValue(prompt) },
      ]
    : [{ role: 'user', content: sanitizePromptValue(prompt) }];
  assertCspConnectEndpointAllowed(apiRoot, 'OpenAI-compatible endpoint');
  const refererHeaders = buildOpenRouterStyleHeaders(opts.openAiSiteUrl, opts.openAiSiteTitle);
  const requestParameters = buildOpenAiCompletionParameters(usesOfficialOpenAi, opts.model, opts);
  const res = await fetch(`${apiRoot}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(refererHeaders ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages,
      ...requestParameters,
    }),
    signal: opts.signal ?? null,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `OpenAI API Error ${res.status}: ${(err as { error?: { message?: string } })?.error?.message ?? res.statusText}`,
    );
  }
  return consumeOpenAiCompatibleStream(res, callbacks, 'OpenAI', 'complete', opts.signal);
}

export async function streamGrok(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const apiKey = await storageService.getApiKey('grok');
  if (!apiKey) throw new Error('NO_API_KEY: Grok API key missing. Please enter it in Settings.');
  const messages = opts.systemPrompt
    ? [
        { role: 'system', content: sanitizePromptValue(opts.systemPrompt) },
        { role: 'user', content: sanitizePromptValue(prompt) },
      ]
    : [{ role: 'user', content: sanitizePromptValue(prompt) }];
  const res = await fetch(GROK_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: opts.signal ?? null,
  });
  if (!res.ok) throw new Error(`Grok API Error ${res.status}: ${res.statusText}`);
  return consumeOpenAiCompatibleStream(res, callbacks, 'Grok', 'throw', opts.signal);
}
