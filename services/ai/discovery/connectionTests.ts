import { detectWebGpuSupport } from '@domain/ai-core';
import type { AIProvider } from '../../../types';
import { isServerlessProxyCapable } from '../../deployTarget';
import { localServerFetch } from '../../localServerHttp';
import { createLogger } from '../../logger';
import { assertCspConnectEndpointAllowed } from '../../network/cspOriginPolicy';
import { testOllamaConnection } from '../../ollamaService';
import { storageService } from '../../storageService';
import { isTauriRuntime } from '../../tauriRuntime';
import { DEFAULT_ANTHROPIC_MODEL_ID } from '../cloudModelCatalog';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { isOpenAiCompatibleLocalPreset } from '../providers/localOpenAiCompatibleProvider';
import { testOpenAiCompatibleLocalConnection } from './localModelDiscovery';

const log = createLogger('aiProviderService');

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
  localServer?: import('./localModelDiscovery').LocalServerDiagnostic;
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
        const root = (await import('../modelNormalization')).resolveOpenAiCompatibleRoot(
          opts.openAiCompatibleBaseUrl,
        );
        assertCspConnectEndpointAllowed(root, 'OpenAI-compatible endpoint');
        const response = await fetch(`${root}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}`,
            kind: 'httpError',
            params: { status: response.status },
          };
        }
        return { ok: true };
      }
      case 'ollama': {
        const isDesktop = isTauriRuntime();
        if (!isDesktop && !opts.browserOllamaEnabled) {
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
        if (!isDesktop && !result.ok && result.kind === 'unreachable') {
          return { ...result, kind: 'corsSuspected' };
        }
        return result;
      }
      case 'anthropic': {
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
        const response = isDesktop
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
        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}`,
            kind: 'httpError',
            params: { status: response.status },
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
        const response = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}`,
            kind: 'httpError',
            params: { status: response.status },
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
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!response.ok) {
          return {
            ok: false,
            error: `Gemini API: HTTP ${response.status}`,
            kind: 'httpError',
            params: { status: response.status },
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
        return { ok: true };
      case 'transformers':
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown provider', kind: 'unknownProvider' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('testAIConnection: unexpected failure', { provider, message });
    return { ok: false, error: message, kind: 'unexpected' };
  }
}
