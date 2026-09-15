import { sanitizePromptValue } from '../../aiUtils';
import { isServerlessProxyCapable } from '../../deployTarget';
import { localServerFetch } from '../../localServerHttp';
import { storageService } from '../../storageService';
import { isTauriRuntime } from '../../tauriRuntime';
import type { AIRequestOptions, AIStreamCallbacks } from '../contracts/providerRequest';

async function deliverAnthropicResponse(
  response: Response,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  if (!response.ok) throw new Error(`Claude API Error ${response.status}: ${response.statusText}`);
  const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (json.content ?? [])
    .filter((content) => content.type === 'text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
  if (text) callbacks.onChunk(text);
  callbacks.onDone?.();
}

export async function streamAnthropic(
  prompt: string,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  // QNBS-v3: desktop uses native HTTP, supported web deployments use the same-origin proxy.
  if (!isTauriRuntime() && !isServerlessProxyCapable()) {
    throw new Error(
      'Claude/Anthropic is not available on this deployment (no serverless proxy on GitHub Pages). ' +
        'Please use the desktop app, a Vercel/Cloudflare Pages deployment, or switch providers.',
    );
  }
  const apiKey = await storageService.getApiKey('anthropic');
  if (!apiKey) throw new Error('NO_API_KEY: Claude API key missing. Please enter it in Settings.');
  if (isTauriRuntime()) {
    const response = await localServerFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        messages: [{ role: 'user', content: sanitizePromptValue(prompt) }],
      }),
      signal: opts.signal ?? null,
    });
    return deliverAnthropicResponse(response, callbacks);
  }
  const response = await fetch('/api/claude-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 2048,
      messages: [{ role: 'user', content: sanitizePromptValue(prompt) }],
    }),
    signal: opts.signal ?? null,
  });
  return deliverAnthropicResponse(response, callbacks);
}
