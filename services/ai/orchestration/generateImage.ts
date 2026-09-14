import { generateImage as generateImageGemini } from '../../geminiService';
import { assertCloudAiAllowed } from '../aiPolicy';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { throwIfRequestAborted, withMergedAbortSignal } from '../lifecycle/cancellation';

const IMAGE_GENERATION_UNSUPPORTED_MESSAGE: Partial<Record<AIRequestOptions['provider'], string>> =
  {
    openai: 'OpenAI image generation is currently not available via the browser version.',
    ollama: 'Ollama image generation is currently not supported. Please use Gemini for images.',
    webllm: 'Local inference is text-only: use Gemini for image generation.',
    onnx: 'Local inference is text-only: use Gemini for image generation.',
    transformers: 'Local inference is text-only: use Gemini for image generation.',
    anthropic:
      'Anthropic image generation is not available. Please use Gemini or Ollama for image content.',
  };

export async function generateImage(
  prompt: string,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (opts.provider === 'gemini') {
    const mergedOpts = withMergedAbortSignal(opts, signal);
    throwIfRequestAborted(undefined, mergedOpts.signal);
    await assertCloudAiAllowed('gemini');
    return generateImageGemini(prompt, mergedOpts.signal);
  }
  throw new Error(
    IMAGE_GENERATION_UNSUPPORTED_MESSAGE[opts.provider] ??
      'Image generation is not supported for this provider.',
  );
}
