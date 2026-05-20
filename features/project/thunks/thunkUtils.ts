import type { RootState } from '../../../app/store';
import type { AIRequestOptions } from '../../../services/aiProviderService';
import type { AiCreativity } from '../../../types';

export const loadAiProvider = () => import('../../../services/aiProviderService');
export const loadPrompts = () => import('../../../services/geminiService');

/** Returns AI request options merged with any active per-project preset. */
export const buildAiOptions = (state: RootState): AIRequestOptions => {
  const global = state.settings.advancedAi;
  const preset = state.project.present?.data?.aiPreset;
  // QNBS-v3: project preset overrides provider/model/temperature/maxTokens; URL/auth stays global.
  const usePreset = preset?.enabled === true;
  return {
    provider: usePreset && preset.provider ? preset.provider : global.provider,
    model: usePreset && preset.model ? preset.model : global.model,
    temperature:
      usePreset && preset.temperature !== undefined ? preset.temperature : global.temperature,
    maxTokens: usePreset && preset.maxTokens !== undefined ? preset.maxTokens : global.maxTokens,
    ollamaBaseUrl: global.ollamaBaseUrl,
    openAiCompatibleBaseUrl: global.openAiCompatibleBaseUrl,
    openAiSiteUrl: global.openAiSiteUrl,
    openAiSiteTitle: global.openAiSiteTitle,
    hybridFallbackEnabled: global.hybridFallbackEnabled,
    hybridFallbackChain: global.hybridFallbackChain,
  };
};

/**
 * Returns the effective AI creativity level — project preset takes priority over global setting.
 * Use this instead of `state.settings.aiCreativity` in all AI thunks.
 */
export const buildAiCreativity = (state: RootState): AiCreativity => {
  const preset = state.project.present?.data?.aiPreset;
  if (preset?.enabled && preset.creativity) return preset.creativity;
  return state.settings.aiCreativity;
};
