import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { generateText } from '../services/aiProviderService';
import type { AIProvider, AiCreativity, AiModel } from '../types';

export interface GenerateTextRequest {
  prompt: string;
  creativity: AiCreativity;
  provider: AIProvider;
  model: AiModel;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateTextResponse {
  text: string;
}

export const aiApi = createApi({
  reducerPath: 'aiApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    generateText: builder.mutation<GenerateTextResponse, GenerateTextRequest>({
      queryFn: async (req) => {
        try {
          const options: {
            provider: AIProvider;
            model: AiModel;
            temperature?: number;
            maxTokens?: number;
          } = {
            provider: req.provider,
            model: req.model,
          };
          if (req.temperature !== undefined) options.temperature = req.temperature;
          if (req.maxTokens !== undefined) options.maxTokens = req.maxTokens;

          // QNBS-v3: RTK Query kapselt AI-Responses zentral, damit Request-Dedupe/Caching im Redux-Layer stattfinden kann.
          const text = await generateText(req.prompt, req.creativity, options);
          return { data: { text } };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unbekannter AI-Fehler';
          return { error: { status: 'CUSTOM_ERROR', error: message } };
        }
      },
    }),
  }),
});

export const { useGenerateTextMutation } = aiApi;
