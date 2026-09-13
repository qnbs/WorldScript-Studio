import type { AiModel } from '../../types';

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  // QNBS-v3: collapse trailing-slash variants so canonical endpoint identity remains stable.
  const trimmed = baseUrl.replace(/\/+$/, '');
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

// QNBS-v3: canonical endpoint identity keeps official reasoning parameters independent of URL spelling.
export function isOfficialOpenAiApiRoot(apiRoot: string): boolean {
  try {
    const url = new URL(apiRoot);
    return (
      url.protocol === 'https:' &&
      url.hostname.replace(/\.$/, '') === 'api.openai.com' &&
      url.port === '' &&
      url.pathname === '/v1' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

// QNBS-v3: normalize the trailing DNS dot before CSP so equivalent official roots share one origin.
export function normalizeOfficialOpenAiApiRoot(apiRoot: string): string {
  try {
    const url = new URL(apiRoot);
    if (url.hostname === 'api.openai.com.' && isOfficialOpenAiApiRoot(apiRoot)) {
      url.hostname = 'api.openai.com';
      return url.href.replace(/\/$/, '');
    }
  } catch {
    return apiRoot;
  }
  return apiRoot;
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
