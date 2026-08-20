/**
 * Cloud model catalog shared by settings, provider fallbacks, and the Claude proxy.
 * QNBS-v3: one typed source prevents a model being selectable in the UI while the
 * server-side defense-in-depth allowlist rejects it.
 */

export const ANTHROPIC_MODEL_IDS = [
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
] as const;

export const OPENAI_MODEL_IDS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'] as const;

export const GROK_MODEL_IDS = ['grok-4.6', 'grok-4.5'] as const;

export const ANTHROPIC_MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-opus-5', label: 'Claude Opus 5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { value: 'claude-fable-5', label: 'Claude Fable 5' },
];

export const OPENAI_MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
];

export const GROK_MODEL_OPTIONS = [
  { value: 'grok-4.6', label: 'Grok 4.6' },
  { value: 'grok-4.5', label: 'Grok 4.5' },
];
