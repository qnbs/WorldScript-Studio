import {
  isAbortError,
  LocalServerError,
  localServerFetch,
  normalizeLocalBaseUrl,
} from './localServerHttp';

// QNBS-v3 (#266): canonical normalization lives in localServerHttp (shared with the scanner).
const normalizeBaseUrl = normalizeLocalBaseUrl;

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
  systemPrompt?.trim()
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

export interface OllamaPullProgress {
  /** Ollama status line, e.g. "pulling manifest", "downloading …", "verifying", "success". */
  status: string;
  /** 0–1 download fraction for the active layer, when total/completed bytes are present. */
  progress?: number;
  completedBytes?: number;
  totalBytes?: number;
}

export interface OllamaPullOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (p: OllamaPullProgress) => void;
}

/**
 * One-click model install: POST {baseUrl}/api/pull and stream the NDJSON progress until the model is
 * ready. QNBS-v3: mirrors streamOllama's reader/abort handling. Ollama reports failures inline as an
 * `{error}` line (not via HTTP status), so we surface those as a thrown Error; an aborted signal
 * propagates as the original AbortError so callers can distinguish cancel from failure.
 */
export async function pullOllamaModel(name: string, opts: OllamaPullOptions = {}): Promise<void> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const model = name.trim().replace(/^ollama\//, '');
  if (!model) throw new Error('Ollama pull: model name is required');

  let response: Response;
  try {
    // QNBS-v3 (#266): Tauri-aware fetch — native plugin-http on desktop (CORS-free), web fetch else.
    response = await localServerFetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: opts.signal ?? null,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      `Ollama not reachable (${baseUrl}). Make sure Ollama is running: ollama serve`,
      { cause: err as Error },
    );
  }

  if (!response.ok) {
    throw new Error(`Ollama pull failed ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Ollama pull: no response body');

  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload: { status?: string; total?: number; completed?: number; error?: string };
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return; // ignore non-JSON keepalive/noise lines
    }
    if (payload.error) throw new Error(`Ollama pull error: ${payload.error}`);
    const hasBytes =
      typeof payload.total === 'number' &&
      payload.total > 0 &&
      typeof payload.completed === 'number';
    opts.onProgress?.({
      status: payload.status ?? 'pulling',
      ...(hasBytes
        ? { progress: Math.min(1, (payload.completed as number) / (payload.total as number)) }
        : {}),
      ...(typeof payload.completed === 'number' ? { completedBytes: payload.completed } : {}),
      ...(typeof payload.total === 'number' ? { totalBytes: payload.total } : {}),
    });
  };

  // QNBS-v3: cancel the reader in finally so an inline-{error} throw (or any parse error) does not
  // leave the HTTP body streaming in the background. cancel() is a no-op once the stream is drained.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    // Flush any trailing buffered line (final "success" status without a newline).
    if (buffer.trim()) handleLine(buffer);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  try {
    const res = await localServerFetch(url, { timeoutMs: 5000 });
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
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  try {
    const res = await localServerFetch(url, { timeoutMs: 5000 });
    if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
    return { ok: true };
  } catch (error: unknown) {
    // QNBS-v3 (#266): classified failures — distinguish a hanging server from a missing one.
    if (error instanceof LocalServerError && error.kind === 'timeout') {
      return { ok: false, error: `Ollama timed out (${normalizeBaseUrl(baseUrl)})` };
    }
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
  callbacks: OllamaStreamCallbacks,
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
    response = await localServerFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal ?? null,
    });
  } catch (err) {
    const error = new Error(
      `Ollama not reachable (${baseUrl}). Make sure Ollama is running: ollama serve`,
      { cause: err as Error },
    );
    // QNBS-v3: Only throw — do NOT call callbacks.onError here. The orchestration layer
    // (aiProviderService.streamText) owns the onError contract and fires it once after the whole
    // fallback chain is exhausted, so a failing Ollama attempt that falls back doesn't double-fire
    // (and a terminal failure isn't reported twice).
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Ollama API Error ${response.status}: ${response.statusText}`);
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const error = new Error('Ollama: Kein Response-Body');
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
