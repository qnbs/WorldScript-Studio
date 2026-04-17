const normalizeBaseUrl = (baseUrl?: string): string => {
  const resolved = baseUrl?.trim() || 'http://localhost:11434';
  return resolved.replace(/\/+$/, '');
};

const stripControlChars = (value: string): string => {
  let output = '';
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return output;
};

const sanitizeOllamaPrompt = (prompt: string): string =>
  stripControlChars(prompt).replace(/```/g, '"').replace(/\s+/g, ' ').trim();

const buildOllamaPrompt = (prompt: string, systemPrompt?: string): string =>
  systemPrompt && systemPrompt.trim()
    ? `${sanitizeOllamaPrompt(systemPrompt)}\n\n${sanitizeOllamaPrompt(prompt)}`
    : sanitizeOllamaPrompt(prompt);

export interface OllamaRequestOptions {
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface OllamaStreamCallbacks {
  onChunk: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) as unknown as AbortSignal });
    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload.models)
      ? payload.models.map((model: unknown) => String((model as { name: unknown }).name || ''))
      : [];
  } catch {
    return [];
  }
}

export async function testOllamaConnection(
  baseUrl?: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) as unknown as AbortSignal });
    if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Ollama not reachable (${normalizeBaseUrl(baseUrl)}): ${message}`,
    };
  }
}

export async function streamOllama(
  prompt: string,
  opts: OllamaRequestOptions,
  callbacks: OllamaStreamCallbacks
): Promise<void> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const model = opts.model.replace(/^ollama\//, '');
  const body = {
    model,
    prompt: buildOllamaPrompt(prompt, opts.systemPrompt),
    stream: true,
    options: {
      temperature: opts.temperature ?? 0.7,
      num_predict: opts.maxTokens ?? 2048,
    },
  } as Record<string, unknown>;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal ?? null,
    });
  } catch (err) {
    const error = new Error(
      `Ollama not reachable (${baseUrl}). Make sure Ollama is running: ollama serve`,
      { cause: err as Error }
    );
    callbacks.onError?.(error);
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Ollama API Error ${response.status}: ${response.statusText}`);
    callbacks.onError?.(error);
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const error = new Error('Ollama: Kein Response-Body');
    callbacks.onError?.(error);
    throw error;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
      try {
        const payload = JSON.parse(event);
        if (payload?.response) {
          callbacks.onChunk(String(payload.response));
        }
        if (payload?.done || payload?.type === 'response' || payload?.type === 'summary') {
          callbacks.onDone?.();
        }
      } catch {
        // Ignore invalid chunk lines and continue streaming.
      }
    }
  }

  callbacks.onDone?.();
}
