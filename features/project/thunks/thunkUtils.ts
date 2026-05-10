import type { RootState } from '../../../app/store';
import type { AIRequestOptions } from '../../../services/aiProviderService';

export const loadAiProvider = () => import('../../../services/aiProviderService');
export const loadPrompts = () => import('../../../services/geminiService');

export const buildAiOptions = (state: RootState): AIRequestOptions => ({
  provider: state.settings.advancedAi.provider,
  model: state.settings.advancedAi.model,
  temperature: state.settings.advancedAi.temperature,
  maxTokens: state.settings.advancedAi.maxTokens,
  ollamaBaseUrl: state.settings.advancedAi.ollamaBaseUrl,
  openAiCompatibleBaseUrl: state.settings.advancedAi.openAiCompatibleBaseUrl,
  openAiSiteUrl: state.settings.advancedAi.openAiSiteUrl,
  openAiSiteTitle: state.settings.advancedAi.openAiSiteTitle,
  hybridFallbackEnabled: state.settings.advancedAi.hybridFallbackEnabled,
  hybridFallbackChain: state.settings.advancedAi.hybridFallbackChain,
});
