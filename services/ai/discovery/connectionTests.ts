import { detectWebGpuSupport } from '@domain/ai-core';
import type { AIProvider } from '../../../types';
import { isServerlessProxyCapable } from '../../deployTarget';
import { localServerFetch } from '../../localServerHttp';
import { createLogger } from '../../logger';
import { assertCspConnectEndpointAllowed } from '../../network/cspOriginPolicy';
import { testOllamaConnection } from '../../ollamaService';
import { storageService } from '../../storageService';
import { isTauriRuntime } from '../../tauriRuntime';
// QNBS-v3: connection tests use the same current Anthropic default as the catalog and proxy.
import { DEFAULT_ANTHROPIC_MODEL_ID } from '../cloudModelCatalog';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { resolveOpenAiCompatibleRoot } from '../modelNormalization';
import { isOpenAiCompatibleLocalPreset } from '../providers/localOpenAiCompatibleProvider';
import type { LocalServerDiagnostic } from './localModelDiscovery';
import { testOpenAiCompatibleLocalConnection } from './localModelDiscovery';

const log = createLogger('aiProviderService');

/**
 * Stable, i18n-mappable classification of a connection-test failure across ALL providers. `error`
 * stays a raw/technical string for logs; UI code should prefer `kind` (+ `params` for
 * interpolation) to render a localized message via `settings.ai.testError.*`
 * (`locales/<lang>/settings.json`) — falling back to `error` only when `kind` is absent.
 */
export type TestConnectionErrorKind =
  | 'noApiKey'
  | 'httpError'
  | 'timeout'
  | 'unreachable'
  | 'policyBlocked'
  | 'pluginUnavailable'
  | 'desktopRequired'
  | 'proxyUnavailableStaticHost'
  | 'corsSuspected'
  | 'invalidResponse'
  | 'noModels'
  | 'noWebgpu'
  | 'unknownProvider'
  | 'unexpected';

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  kind?: TestConnectionErrorKind;
  params?: Record<string, string | number>;
  localServer?: LocalServerDiagnostic;
}

export async function testAIConnection(
  provider: AIProvider,
  opts: Partial<AIRequestOptions>,
): Promise<TestConnectionResult> {
  try {
    switch (provider) {
      case 'openai': {
        const apiKey = await storageService.getApiKey('openai');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein OpenAI API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'OpenAI' },
          };
        }
        const root = resolveOpenAiCompatibleRoot(opts.openAiCompatibleBaseUrl);
        // QNBS-v3: connection tests reuse the same endpoint policy as production requests.
        assertCspConnectEndpointAllowed(root, 'OpenAI-compatible endpoint');
        const res = await fetch(`${root}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'ollama': {
        // QNBS-v3 (T0): canonical detection — `__TAURI__` alone was false in the real shell, so the desktop Ollama (localhost) path was unreachable there.
        const isDesktop = isTauriRuntime();
        // QNBS-v3 (ADR-0017): enableBrowserOllama is an explicit, advanced opt-in — the user has separately configured their own Ollama server's OLLAMA_ORIGINS for this exact origin (see AnthropicProviderFields-adjacent Ollama UI in AiProviderCard.tsx). Off by default.
        if (!isDesktop && !opts.browserOllamaEnabled) {
          // QNBS-v3 (ADR-0012): browsers block localhost via CORS/Private Network Access, NOT CSP — this repo's CSP already allowlists localhost (docs/adr/0004). Matches the corrected settings.ai.ollamaDesktopOnlyBody wording from #269; this hard-gate string had drifted.
          return {
            ok: false,
            error:
              'Ollama and local OpenAI-compatible servers are only available in the desktop app. Browsers block direct connections from web pages to localhost (CORS and Private Network Access).',
            kind: 'desktopRequired',
          };
        }
        const result = isOpenAiCompatibleLocalPreset(opts.localBackendPreset)
          ? await testOpenAiCompatibleLocalConnection(opts.ollamaBaseUrl)
          : await testOllamaConnection(opts.ollamaBaseUrl);
        // QNBS-v3 (ADR-0017): the Fetch API gives an identical generic failure for "CORS rejected" and "server genuinely down" — this can only be a heuristic hint when running the opt-in browser path, never a certain diagnosis. Desktop keeps the plain 'unreachable' kind.
        if (!isDesktop && !result.ok && result.kind === 'unreachable') {
          return { ...result, kind: 'corsSuspected' };
        }
        return result;
      }
      case 'anthropic': {
        // QNBS-v3 (ADR-0016): desktop bypasses CORS via localServerFetch's native path (Track A); web relays through api/claude-proxy (Track B) — except GitHub Pages, which can host neither Vercel nor Cloudflare Pages Functions and stays structurally unsupported.
        const isDesktop = isTauriRuntime();
        if (!isDesktop && !isServerlessProxyCapable()) {
          return {
            ok: false,
            error:
              'Claude is not available on this deployment (no serverless proxy on GitHub Pages)',
            kind: 'proxyUnavailableStaticHost',
          };
        }
        const apiKey = await storageService.getApiKey('anthropic');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein Claude API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'Claude' },
          };
        }
        // QNBS-v3: Anthropic has no public /v1/models endpoint — a minimal (max_tokens: 1) real request is the practical connectivity check, mirroring the pattern used for Grok.
        // QNBS-v3 (CodeRabbit): bounded like every sibling connectivity check (testOllamaConnection uses timeoutMs: 5000; openai/grok/gemini use AbortSignal.timeout(8000)) — a stalled native/proxy HTTP call must not hang the Settings test spinner indefinitely.
        const res = isDesktop
          ? await localServerFetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: DEFAULT_ANTHROPIC_MODEL_ID,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
              }),
              timeoutMs: 8000,
            })
          : await fetch('/api/claude-proxy', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                apiKey,
                model: DEFAULT_ANTHROPIC_MODEL_ID,
                maxTokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
              }),
              signal: AbortSignal.timeout(8000),
            });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'grok': {
        const apiKey = await storageService.getApiKey('grok');
        if (!apiKey) {
          return {
            ok: false,
            error: 'Kein Grok API Key gesetzt',
            kind: 'noApiKey',
            params: { provider: 'Grok' },
          };
        }
        const res = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'gemini': {
        const geminiKey = await storageService.getGeminiApiKey();
        if (!geminiKey) {
          return {
            ok: false,
            error: 'No Gemini API key set',
            kind: 'noApiKey',
            params: { provider: 'Gemini' },
          };
        }
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `Gemini API: HTTP ${res.status}`,
            kind: 'httpError',
            params: { status: res.status },
          };
        }
        return { ok: true };
      }
      case 'webllm':
        return detectWebGpuSupport()
          ? { ok: true }
          : {
              ok: false,
              error:
                'WebGPU unavailable in this browser — WebLLM needs WebGPU (try Chrome/Edge or enable flags).',
              kind: 'noWebgpu',
            };
      case 'onnx':
        // QNBS-v3: ONNX Runtime Web uses WASM — always available, no GPU required.
        return { ok: true };
      case 'transformers':
        // QNBS-v3: Transformers.js uses WASM/WebGPU — connection test is always ok; model loads on first use.
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown provider', kind: 'unknownProvider' };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // QNBS-v3 (CodeAnt CWE-209): log the raw exception for diagnostics; never interpolate it into the user-facing i18n string, which could otherwise leak internal error detail to the UI.
    log.error('testAIConnection: unexpected failure', { provider, message });
    return {
      ok: false,
      error: message,
      kind: 'unexpected',
    };
  }
}
