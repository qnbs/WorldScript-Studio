// QNBS-v3: one curated cloud authority keeps selectors, fallbacks, persistence admission, and
// the Claude proxy allowlist synchronized. Remote model discovery never changes this registry.

export type CloudProvider = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'openrouter';
export type CloudModelLifecycle =
  | 'recommended-default'
  | 'current-supported'
  | 'specialized'
  | 'preview-opt-in'
  | 'legacy-compat';
export type CloudModelStability = 'stable' | 'preview' | 'legacy';
export type CloudModelCapability =
  | 'TEXT'
  | 'STREAMING_TEXT'
  | 'STRUCTURED_JSON'
  | 'IMAGE_INPUT'
  | 'IMAGE_GENERATION'
  | 'REASONING';
export type CloudModelRole =
  | 'GENERAL_WRITING'
  | 'FAST_LOW_COST'
  | 'HIGH_QUALITY_REASONING'
  | 'STRUCTURED_OUTPUT'
  | 'LONG_CONTEXT'
  | 'IMAGE_GENERATION';
export type CloudModelParameterProfile =
  | 'gemini-text'
  | 'gemini-image'
  | 'openai-text'
  | 'anthropic-messages'
  | 'grok-openai-compatible'
  | 'openrouter-openai-compatible';

export interface CloudModelMetadata {
  provider: CloudProvider;
  modelId: string;
  displayName: string;
  lifecycle: CloudModelLifecycle;
  stability: CloudModelStability;
  capabilities: readonly CloudModelCapability[];
  recommendedRoles: readonly CloudModelRole[];
  requiresApiKey: true;
  localOrCloud: 'cloud';
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsImageInput: boolean;
  supportsImageGeneration: boolean;
  supportsReasoning: boolean;
  parameterProfile: CloudModelParameterProfile;
  verificationSource: string;
  lastVerifiedAt: string;
  contextLimit?: number;
  outputLimit?: number;
  replacementModel?: string;
}

const VERIFIED_AT = '2026-09-13';
const OFFICIAL_SOURCES: Record<CloudProvider, string> = {
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  openai: 'https://platform.openai.com/docs/models',
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/models',
  grok: 'https://docs.x.ai/docs/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

// Current selector/admission IDs. Preview and legacy values are intentionally separate so a
// remotely advertised or historical ID cannot become a default without an explicit curation pass.
export const GEMINI_MODEL_IDS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash',
  'gemini-3.1-flash-lite',
] as const;
export const GEMINI_PREVIEW_MODEL_IDS = ['gemini-3.1-pro-preview'] as const;
export const GEMINI_ADMITTED_MODEL_IDS = [
  ...GEMINI_MODEL_IDS,
  ...GEMINI_PREVIEW_MODEL_IDS,
] as const;
export const GEMINI_LEGACY_MODEL_IDS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
] as const;
export const GEMINI_IMAGE_MODEL_ID = 'gemini-3.1-flash-image' as const;

export const OPENAI_MODEL_IDS = [
  'gpt-6-astra',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
] as const;
export const OPENAI_LEGACY_MODEL_IDS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4o',
  'gpt-4o-mini',
] as const;

export const ANTHROPIC_MODEL_IDS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-fable-5',
] as const;
export const ANTHROPIC_LEGACY_MODEL_IDS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-3-5',
] as const;

export const GROK_MODEL_IDS = ['grok-4.6', 'grok-4.5'] as const;
export const GROK_PREVIEW_MODEL_IDS = ['grok-4.20'] as const;
export const GROK_LEGACY_MODEL_IDS = ['grok-3', 'grok-3-mini'] as const;

// OpenRouter's public free tier rotates. These are an offline fallback only; the runtime catalog
// remains the primary source and arbitrary user-selected model IDs remain persistable.
export const OPENROUTER_FREE_MODEL_FALLBACK = [
  'google/gemma-4-31b-it:free',
  'nex-agi/nex-n2.5-pro:free',
  'cohere/north-mini-code:free',
] as const;
export const DEFAULT_OPENROUTER_MODEL_ID = OPENROUTER_FREE_MODEL_FALLBACK[0];

export type GeminiModelId = (typeof GEMINI_MODEL_IDS)[number];
export type AnthropicModelId = (typeof ANTHROPIC_MODEL_IDS)[number];
export type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number];
export type GrokModelId = (typeof GROK_MODEL_IDS)[number];

type ModelOption<T extends string> = { value: T; label: string };

export const DEFAULT_GEMINI_MODEL_ID: GeminiModelId = 'gemini-3.5-flash';
export const DEFAULT_ANTHROPIC_MODEL_ID: AnthropicModelId = 'claude-sonnet-5';
export const DEFAULT_OPENAI_MODEL_ID: OpenAiModelId = 'gpt-5.6-terra';
export const DEFAULT_GROK_MODEL_ID: GrokModelId = 'grok-4.6';

export const GEMINI_MODEL_OPTIONS: ModelOption<GeminiModelId>[] = [
  { value: GEMINI_MODEL_IDS[0], label: 'Gemini 3.5 Flash' },
  { value: GEMINI_MODEL_IDS[1], label: 'Gemini 3.1 Flash' },
  { value: GEMINI_MODEL_IDS[2], label: 'Gemini 3.1 Flash-Lite' },
];
export const GEMINI_PREVIEW_MODEL_OPTIONS: ModelOption<
  (typeof GEMINI_PREVIEW_MODEL_IDS)[number]
>[] = [{ value: GEMINI_PREVIEW_MODEL_IDS[0], label: 'Gemini 3.1 Pro Preview' }];
export const GEMINI_LEGACY_MODEL_OPTIONS: ModelOption<(typeof GEMINI_LEGACY_MODEL_IDS)[number]>[] =
  [
    { value: GEMINI_LEGACY_MODEL_IDS[0], label: 'Gemini 2.5 Flash (legacy)' },
    { value: GEMINI_LEGACY_MODEL_IDS[1], label: 'Gemini 2.5 Pro (legacy)' },
    { value: GEMINI_LEGACY_MODEL_IDS[2], label: 'Gemini 2.0 Flash (legacy)' },
    { value: GEMINI_LEGACY_MODEL_IDS[3], label: 'Gemini 2.0 Flash-Lite (legacy)' },
    { value: GEMINI_LEGACY_MODEL_IDS[4], label: 'Gemini 1.5 Flash (legacy)' },
    { value: GEMINI_LEGACY_MODEL_IDS[5], label: 'Gemini 1.5 Pro (legacy)' },
  ];
export const OPENAI_MODEL_OPTIONS: ModelOption<OpenAiModelId>[] = [
  { value: OPENAI_MODEL_IDS[0], label: 'GPT-6 Astra' },
  { value: OPENAI_MODEL_IDS[1], label: 'GPT-5.6 Terra' },
  { value: OPENAI_MODEL_IDS[2], label: 'GPT-5.6 Luna' },
  { value: OPENAI_MODEL_IDS[3], label: 'GPT-5.6 Sol' },
];
export const ANTHROPIC_MODEL_OPTIONS: ModelOption<AnthropicModelId>[] = [
  { value: ANTHROPIC_MODEL_IDS[0], label: 'Claude Opus 5' },
  { value: ANTHROPIC_MODEL_IDS[1], label: 'Claude Sonnet 5' },
  { value: ANTHROPIC_MODEL_IDS[2], label: 'Claude Opus 4.8' },
  { value: ANTHROPIC_MODEL_IDS[3], label: 'Claude Fable 5' },
];
export const GROK_MODEL_OPTIONS: ModelOption<GrokModelId>[] = [
  { value: GROK_MODEL_IDS[0], label: 'Grok 4.6' },
  { value: GROK_MODEL_IDS[1], label: 'Grok 4.5' },
];

const model = (
  provider: CloudProvider,
  modelId: string,
  details: Omit<
    CloudModelMetadata,
    | 'provider'
    | 'modelId'
    | 'requiresApiKey'
    | 'localOrCloud'
    | 'verificationSource'
    | 'lastVerifiedAt'
  >,
): CloudModelMetadata => ({
  provider,
  modelId,
  ...details,
  requiresApiKey: true,
  localOrCloud: 'cloud',
  verificationSource: OFFICIAL_SOURCES[provider],
  lastVerifiedAt: VERIFIED_AT,
});

const legacyModel = (
  provider: Exclude<CloudProvider, 'openrouter'>,
  modelId: string,
  replacementModel: string,
): CloudModelMetadata =>
  model(provider, modelId, {
    displayName: `Legacy ${modelId}`,
    lifecycle: 'legacy-compat',
    stability: 'legacy',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: [],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile:
      provider === 'gemini'
        ? 'gemini-text'
        : provider === 'openai'
          ? 'openai-text'
          : provider === 'anthropic'
            ? 'anthropic-messages'
            : 'grok-openai-compatible',
    replacementModel,
  });

// This is the machine-readable curation authority. The exported selector arrays above are the
// intentionally admitted subsets; this registry also records preview and legacy compatibility.
export const CLOUD_MODEL_CATALOG = [
  model('gemini', GEMINI_MODEL_IDS[0], {
    displayName: 'Gemini 3.5 Flash',
    lifecycle: 'recommended-default',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON'],
    recommendedRoles: ['GENERAL_WRITING', 'FAST_LOW_COST', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'gemini-text',
  }),
  model('gemini', GEMINI_MODEL_IDS[1], {
    displayName: 'Gemini 3.1 Flash',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON'],
    recommendedRoles: ['GENERAL_WRITING', 'FAST_LOW_COST', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'gemini-text',
  }),
  model('gemini', GEMINI_MODEL_IDS[2], {
    displayName: 'Gemini 3.1 Flash-Lite',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: ['FAST_LOW_COST'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'gemini-text',
  }),
  model('gemini', GEMINI_PREVIEW_MODEL_IDS[0], {
    displayName: 'Gemini 3.1 Pro Preview',
    lifecycle: 'preview-opt-in',
    stability: 'preview',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING', 'LONG_CONTEXT', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'gemini-text',
  }),
  model('gemini', GEMINI_IMAGE_MODEL_ID, {
    displayName: 'Gemini 3.1 Flash Image',
    lifecycle: 'specialized',
    stability: 'stable',
    capabilities: ['TEXT', 'IMAGE_INPUT', 'IMAGE_GENERATION'],
    recommendedRoles: ['IMAGE_GENERATION'],
    supportsStreaming: false,
    supportsStructuredOutput: false,
    supportsImageInput: true,
    supportsImageGeneration: true,
    supportsReasoning: false,
    parameterProfile: 'gemini-image',
  }),
  model('gemini', GEMINI_LEGACY_MODEL_IDS[0], {
    displayName: 'Gemini 2.5 Flash',
    lifecycle: 'legacy-compat',
    stability: 'legacy',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: ['GENERAL_WRITING'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'gemini-text',
    replacementModel: DEFAULT_GEMINI_MODEL_ID,
  }),
  model('gemini', GEMINI_LEGACY_MODEL_IDS[1], {
    displayName: 'Gemini 2.5 Pro',
    lifecycle: 'legacy-compat',
    stability: 'legacy',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'gemini-text',
    replacementModel: DEFAULT_GEMINI_MODEL_ID,
  }),
  ...GEMINI_LEGACY_MODEL_IDS.slice(2).map((modelId) =>
    legacyModel('gemini', modelId, DEFAULT_GEMINI_MODEL_ID),
  ),
  model('openai', OPENAI_MODEL_IDS[0], {
    displayName: 'GPT-6 Astra',
    lifecycle: 'specialized',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING', 'LONG_CONTEXT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'openai-text',
  }),
  model('openai', OPENAI_MODEL_IDS[1], {
    displayName: 'GPT-5.6 Terra',
    lifecycle: 'recommended-default',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT'],
    recommendedRoles: ['GENERAL_WRITING', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'openai-text',
  }),
  model('openai', OPENAI_MODEL_IDS[2], {
    displayName: 'GPT-5.6 Luna',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON'],
    recommendedRoles: ['FAST_LOW_COST'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'openai-text',
  }),
  model('openai', OPENAI_MODEL_IDS[3], {
    displayName: 'GPT-5.6 Sol',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'openai-text',
  }),
  ...OPENAI_LEGACY_MODEL_IDS.map((modelId) =>
    legacyModel('openai', modelId, DEFAULT_OPENAI_MODEL_ID),
  ),
  model('anthropic', ANTHROPIC_MODEL_IDS[0], {
    displayName: 'Claude Opus 5',
    lifecycle: 'specialized',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'anthropic-messages',
  }),
  model('anthropic', ANTHROPIC_MODEL_IDS[1], {
    displayName: 'Claude Sonnet 5',
    lifecycle: 'recommended-default',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON'],
    recommendedRoles: ['GENERAL_WRITING', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'anthropic-messages',
  }),
  model('anthropic', ANTHROPIC_MODEL_IDS[2], {
    displayName: 'Claude Opus 4.8',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'anthropic-messages',
  }),
  model('anthropic', ANTHROPIC_MODEL_IDS[3], {
    displayName: 'Claude Fable 5',
    lifecycle: 'specialized',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: ['GENERAL_WRITING'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'anthropic-messages',
  }),
  ...ANTHROPIC_LEGACY_MODEL_IDS.map((modelId) =>
    legacyModel('anthropic', modelId, DEFAULT_ANTHROPIC_MODEL_ID),
  ),
  model('grok', GROK_MODEL_IDS[0], {
    displayName: 'Grok 4.6',
    lifecycle: 'recommended-default',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT', 'REASONING'],
    recommendedRoles: ['GENERAL_WRITING', 'HIGH_QUALITY_REASONING', 'STRUCTURED_OUTPUT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'grok-openai-compatible',
  }),
  model('grok', GROK_MODEL_IDS[1], {
    displayName: 'Grok 4.5',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT', 'REASONING'],
    recommendedRoles: ['GENERAL_WRITING'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'grok-openai-compatible',
  }),
  model('grok', GROK_PREVIEW_MODEL_IDS[0], {
    displayName: 'Grok 4.20',
    lifecycle: 'preview-opt-in',
    stability: 'preview',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'STRUCTURED_JSON', 'IMAGE_INPUT', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING', 'LONG_CONTEXT'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'grok-openai-compatible',
  }),
  ...GROK_LEGACY_MODEL_IDS.map((modelId) => legacyModel('grok', modelId, DEFAULT_GROK_MODEL_ID)),
  model('openrouter', OPENROUTER_FREE_MODEL_FALLBACK[0], {
    displayName: 'Google Gemma 4 31B (free)',
    lifecycle: 'recommended-default',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: ['GENERAL_WRITING', 'FAST_LOW_COST'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'openrouter-openai-compatible',
  }),
  model('openrouter', OPENROUTER_FREE_MODEL_FALLBACK[1], {
    displayName: 'Nex AGI Nex-N2.5 Pro (free)',
    lifecycle: 'current-supported',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT', 'REASONING'],
    recommendedRoles: ['HIGH_QUALITY_REASONING'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    parameterProfile: 'openrouter-openai-compatible',
  }),
  model('openrouter', OPENROUTER_FREE_MODEL_FALLBACK[2], {
    displayName: 'Cohere North Mini Code (free)',
    lifecycle: 'specialized',
    stability: 'stable',
    capabilities: ['TEXT', 'STREAMING_TEXT'],
    recommendedRoles: ['FAST_LOW_COST'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportsImageInput: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    parameterProfile: 'openrouter-openai-compatible',
  }),
] as const satisfies readonly CloudModelMetadata[];

export const getCloudModel = (
  provider: CloudProvider,
  modelId: string,
): CloudModelMetadata | undefined =>
  CLOUD_MODEL_CATALOG.find((entry) => entry.provider === provider && entry.modelId === modelId);

export const isCurrentCloudModel = (provider: CloudProvider, modelId: string): boolean => {
  const entry = getCloudModel(provider, modelId);
  return entry !== undefined && entry.lifecycle !== 'legacy-compat' && entry.stability === 'stable';
};

export type PersistedCloudModelStatus =
  | 'current-supported'
  | 'preview-opt-in'
  | 'legacy-compat'
  | 'custom-compatible'
  | 'unknown-stored-value';
export interface PersistedCloudModelAdmission {
  model: string;
  status: PersistedCloudModelStatus;
  replacementModel?: string;
}

const LEGACY_MODEL_REPLACEMENTS: Record<string, string> = {
  ...Object.fromEntries(GEMINI_LEGACY_MODEL_IDS.map((id) => [id, DEFAULT_GEMINI_MODEL_ID])),
  ...Object.fromEntries(OPENAI_LEGACY_MODEL_IDS.map((id) => [id, DEFAULT_OPENAI_MODEL_ID])),
  ...Object.fromEntries(ANTHROPIC_LEGACY_MODEL_IDS.map((id) => [id, DEFAULT_ANTHROPIC_MODEL_ID])),
  ...Object.fromEntries(GROK_LEGACY_MODEL_IDS.map((id) => [id, DEFAULT_GROK_MODEL_ID])),
};

const CURRENT_MODEL_IDS: Record<Exclude<CloudProvider, 'openrouter'>, readonly string[]> = {
  gemini: GEMINI_MODEL_IDS,
  openai: OPENAI_MODEL_IDS,
  anthropic: ANTHROPIC_MODEL_IDS,
  grok: GROK_MODEL_IDS,
};

export const classifyPersistedCloudModel = (
  provider: CloudProvider | string,
  modelId: string,
  customBaseUrl = '',
): PersistedCloudModelAdmission => {
  if (provider === 'openai' && customBaseUrl.trim()) {
    return { model: modelId, status: 'custom-compatible' };
  }
  if (
    (provider === 'gemini' ||
      provider === 'openai' ||
      provider === 'anthropic' ||
      provider === 'grok') &&
    CURRENT_MODEL_IDS[provider].includes(modelId)
  ) {
    return { model: modelId, status: 'current-supported' };
  }
  if (
    provider === 'gemini' &&
    GEMINI_PREVIEW_MODEL_IDS.includes(modelId as (typeof GEMINI_PREVIEW_MODEL_IDS)[number])
  ) {
    return { model: modelId, status: 'preview-opt-in' };
  }
  const replacementModel = LEGACY_MODEL_REPLACEMENTS[modelId];
  if (replacementModel !== undefined) {
    return { model: modelId, status: 'legacy-compat', replacementModel };
  }
  if (provider === 'openrouter' && modelId.trim()) {
    return { model: modelId, status: 'custom-compatible' };
  }
  return { model: modelId, status: 'unknown-stored-value' };
};

// QNBS-v3: catalog membership rejects legacy model IDs that share a provider prefix.
export const isModelInCatalog = (ids: readonly string[], modelId: string): boolean =>
  ids.includes(modelId);
