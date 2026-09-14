import type { AiCreativity, GeminiSchema } from '../../../types';
import { attachCause, stripJsonFences } from '../../aiUtils';
import { generateJson as generateJsonGemini } from '../../geminiService';
import { assertCloudAiAllowed } from '../aiPolicy';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { applyHeuristicFallback } from '../heuristicFallback';
import { throwIfRequestAborted } from '../lifecycle/cancellation';
import { withDeduplicatedRequest } from '../lifecycle/requestDedup';
import { generateText } from './generateText';
import { isGeminiDirectCloudPath } from './providerDispatch';

async function generateDirectGeminiJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<T> {
  return withDeduplicatedRequest(opts, prompt, signal, async (mergedOpts) => {
    try {
      await assertCloudAiAllowed('gemini');
      const result = await generateJsonGemini<T>(
        prompt,
        creativity,
        schema,
        mergedOpts.signal,
        undefined,
        mergedOpts.model,
      );
      throwIfRequestAborted(undefined, mergedOpts.signal);
      return result;
    } catch (error) {
      throwIfRequestAborted(error, mergedOpts.signal);
      throw error;
    }
  });
}

export async function generateJson<T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  opts: AIRequestOptions,
  signal?: AbortSignal,
): Promise<T> {
  try {
    if (isGeminiDirectCloudPath(opts.provider)) {
      return await generateDirectGeminiJson(prompt, creativity, schema, opts, signal);
    }
    const raw = await generateText(prompt, creativity, opts, signal);
    const jsonText = stripJsonFences(raw);
    try {
      return JSON.parse(jsonText) as T;
    } catch (parseError) {
      const parseErr = new Error('The AI model response is not valid JSON. Please try again.');
      attachCause(parseErr, parseError);
      throw parseErr;
    }
  } catch (error) {
    throwIfRequestAborted(error, signal, opts.signal);
    const heuristic = applyHeuristicFallback<T>(
      opts.heuristicTask,
      opts.heuristicContext ?? { prompt, reasonKey: 'error.fallback.generic' },
    );
    if (heuristic) return heuristic.data;
    throw error;
  }
}
