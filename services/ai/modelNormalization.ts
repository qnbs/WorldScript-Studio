import type { AiModel } from '../../types';

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** Offizielle OpenAI-API wenn `baseUrl` leer/undefiniert, sonst OpenRouter/Groq/Custom-Root. */
export function resolveOpenAiCompatibleRoot(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return normalizeOpenAiCompatibleBaseUrl('https://api.openai.com');
  }
  return normalizeOpenAiCompatibleBaseUrl(trimmed);
}

/** QNBS-v3: OpenRouter-Doku — optionale Attribution-Header ohne Secrets. */
export function buildOpenRouterStyleHeaders(
  siteUrl?: string,
  siteTitle?: string,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (siteUrl?.trim()) {
    headers['HTTP-Referer'] = siteUrl.trim();
  }
  if (siteTitle?.trim()) {
    headers['X-Title'] = siteTitle.trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Entfernt das `ollama/`-Prefix aus gespeicherten `AiModel`-Strings. */
export function normalizeOllamaModelId(model: AiModel): string {
  return typeof model === 'string' && model.startsWith('ollama/')
    ? model.slice('ollama/'.length)
    : String(model);
}
