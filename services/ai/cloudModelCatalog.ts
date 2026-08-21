// QNBS-v3: shared catalog keeps selectors, fallbacks, and proxy allowlists synchronized.

export const ANTHROPIC_MODEL_IDS = [
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
] as const;

export const OPENAI_MODEL_IDS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'] as const;

export const GROK_MODEL_IDS = ['grok-4.6', 'grok-4.5'] as const;

export type AnthropicModelId = (typeof ANTHROPIC_MODEL_IDS)[number];
export type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number];
export type GrokModelId = (typeof GROK_MODEL_IDS)[number];

type ModelOption<T extends string> = { value: T; label: string };

export const DEFAULT_ANTHROPIC_MODEL_ID: AnthropicModelId = 'claude-sonnet-5';
export const DEFAULT_OPENAI_MODEL_ID: OpenAiModelId = 'gpt-5.4-mini';
export const DEFAULT_GROK_MODEL_ID: GrokModelId = 'grok-4.5';

// QNBS-v3: catalog membership rejects legacy model IDs that share a provider prefix.
export const isModelInCatalog = (ids: readonly string[], model: string): boolean =>
  ids.includes(model);

export const ANTHROPIC_MODEL_OPTIONS: ModelOption<AnthropicModelId>[] = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-opus-5', label: 'Claude Opus 5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { value: 'claude-fable-5', label: 'Claude Fable 5' },
];

export const OPENAI_MODEL_OPTIONS: ModelOption<OpenAiModelId>[] = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
];

export const GROK_MODEL_OPTIONS: ModelOption<GrokModelId>[] = [
  { value: 'grok-4.6', label: 'Grok 4.6' },
  { value: 'grok-4.5', label: 'Grok 4.5' },
];
