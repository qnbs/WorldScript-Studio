import { z } from 'zod';
import type { AIProvider, AiCreativity } from '../../../types';
import { sanitizePromptValue } from '../../aiUtils';
import {
  generateText as generateTextGemini,
  streamText as streamTextGemini,
} from '../../geminiService';
import { generateLocalText } from '../../localAiFacade';
import { streamOllama } from '../../ollamaService';
import { storageService } from '../../storageService';
import { shouldRouteLocally, shouldUseOpenRouter } from '../aiModeService';
import { assertCloudAiAllowed } from '../aiPolicy';
import type { AIRequestOptions, AIStreamCallbacks } from '../contracts/providerRequest';
import { streamAnthropic } from '../providers/anthropicProvider';
import {
  isOpenAiCompatibleLocalPreset,
  streamOpenAiCompatibleLocal,
} from '../providers/localOpenAiCompatibleProvider';
import { streamGrok, streamOpenAI } from '../providers/openaiProvider';
import { generateOpenRouterText, streamOpenRouter } from '../providers/openrouterProvider';

const providerTextSchema = z.object({ text: z.string().min(1) });
const OPENROUTER_API_KEY_ERROR =
  'NO_API_KEY: OpenRouter API key missing. Please enter it in Settings → AI → OpenRouter.';

export function isGeminiDirectCloudPath(provider: AIProvider): boolean {
  return provider === 'gemini' && !shouldRouteLocally() && !shouldUseOpenRouter();
}

type StreamProviderHandler = (
  prompt: string,
  creativity: AiCreativity,
  options: AIRequestOptions,
  callbacks: AIStreamCallbacks,
) => Promise<void>;

function applyLoraModelOverride(options: AIRequestOptions): AIRequestOptions {
  return options.provider === 'ollama' && options.loraModelPath
    ? { ...options, model: options.loraModelPath as typeof options.model }
    : options;
}

async function streamOpenRouterProvider(
  prompt: string,
  _creativity: AiCreativity,
  options: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const apiKey = await requireOpenRouterApiKey();
  return streamOpenRouter(prompt, options, callbacks, apiKey);
}

async function requireOpenRouterApiKey(): Promise<string> {
  const apiKey = await storageService.getApiKey('openrouter');
  if (!apiKey) throw new Error(OPENROUTER_API_KEY_ERROR);
  return apiKey;
}

async function streamLocalInference(
  prompt: string,
  _creativity: AiCreativity,
  options: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const merged = options.systemPrompt?.trim()
    ? `${sanitizePromptValue(options.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
    : sanitizePromptValue(prompt);
  const local = await generateLocalText(
    merged,
    options.model,
    undefined,
    undefined,
    options.signal,
  );
  callbacks.onChunk(local.text);
  callbacks.onDone?.();
}

async function streamGeminiProvider(
  prompt: string,
  creativity: AiCreativity,
  options: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  return streamTextGemini(
    options.systemPrompt
      ? `${sanitizePromptValue(options.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
      : prompt,
    creativity,
    callbacks.onChunk,
    options.signal,
    options.model,
  );
}

const streamOllamaProvider: StreamProviderHandler = (prompt, _creativity, options, callbacks) =>
  isOpenAiCompatibleLocalPreset(options.localBackendPreset)
    ? streamOpenAiCompatibleLocal(prompt, options, callbacks)
    : streamOllama(prompt, options, callbacks);

const STREAM_PROVIDER_HANDLERS: Partial<Record<AIProvider, StreamProviderHandler>> = {
  openai: (prompt, _creativity, options, callbacks) => streamOpenAI(prompt, options, callbacks),
  openrouter: streamOpenRouterProvider,
  ollama: streamOllamaProvider,
  anthropic: (prompt, _creativity, options, callbacks) =>
    streamAnthropic(prompt, options, callbacks),
  grok: (prompt, _creativity, options, callbacks) => streamGrok(prompt, options, callbacks),
  webllm: streamLocalInference,
  onnx: streamLocalInference,
  transformers: streamLocalInference,
};

export async function streamProvider(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  await assertCloudAiAllowed(opts.provider);
  const options = applyLoraModelOverride(opts);
  const handler = STREAM_PROVIDER_HANDLERS[options.provider] ?? streamGeminiProvider;
  return handler(prompt, creativity, options, callbacks);
}

type TextProviderHandler = (
  prompt: string,
  creativity: AiCreativity,
  options: AIRequestOptions,
) => Promise<string>;

async function collectStreamedText(
  run: (callbacks: AIStreamCallbacks) => Promise<void>,
): Promise<string> {
  let result = '';
  await run({ onChunk: (text) => (result += text) });
  return providerTextSchema.parse({ text: result }).text;
}

const generateOpenAiText: TextProviderHandler = (prompt, _creativity, options) =>
  collectStreamedText((callbacks) => streamOpenAI(prompt, options, callbacks));

async function generateOpenRouterProviderText(
  prompt: string,
  _creativity: AiCreativity,
  options: AIRequestOptions,
): Promise<string> {
  const apiKey = await requireOpenRouterApiKey();
  return generateOpenRouterText(prompt, options, apiKey);
}

const generateOllamaText: TextProviderHandler = (prompt, _creativity, options) => {
  const stream = isOpenAiCompatibleLocalPreset(options.localBackendPreset)
    ? streamOpenAiCompatibleLocal
    : streamOllama;
  return collectStreamedText((callbacks) => stream(prompt, options, callbacks));
};

const generateAnthropicText: TextProviderHandler = (prompt, _creativity, options) =>
  collectStreamedText((callbacks) => streamAnthropic(prompt, options, callbacks));

const generateGrokText: TextProviderHandler = (prompt, _creativity, options) =>
  collectStreamedText((callbacks) => streamGrok(prompt, options, callbacks));

const generateLocalTextProvider: TextProviderHandler = async (prompt, _creativity, options) => {
  const merged = options.systemPrompt?.trim()
    ? `${sanitizePromptValue(options.systemPrompt)}\n\n${sanitizePromptValue(prompt)}`
    : sanitizePromptValue(prompt);
  const local = await generateLocalText(
    merged,
    options.model,
    undefined,
    undefined,
    options.signal,
  );
  return providerTextSchema.parse({ text: local.text }).text;
};

const generateGeminiTextProvider: TextProviderHandler = async (prompt, creativity, options) =>
  providerTextSchema.parse({
    text: await generateTextGemini(prompt, creativity, options.signal, undefined, options.model),
  }).text;

const TEXT_PROVIDER_HANDLERS: Partial<Record<AIProvider, TextProviderHandler>> = {
  openai: generateOpenAiText,
  openrouter: generateOpenRouterProviderText,
  ollama: generateOllamaText,
  anthropic: generateAnthropicText,
  grok: generateGrokText,
  webllm: generateLocalTextProvider,
  onnx: generateLocalTextProvider,
  transformers: generateLocalTextProvider,
};

export async function generateTextSingleProvider(
  prompt: string,
  creativity: AiCreativity,
  options: AIRequestOptions,
): Promise<string> {
  await assertCloudAiAllowed(options.provider);
  const handler = TEXT_PROVIDER_HANDLERS[options.provider] ?? generateGeminiTextProvider;
  return handler(prompt, creativity, options);
}
