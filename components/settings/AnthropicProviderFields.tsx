import type { FC } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { ANTHROPIC_MODEL_OPTIONS } from '../../services/ai/cloudModelCatalog';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';

interface AnthropicProviderFieldsProps {
  isDesktop: boolean;
  isProxyCapableWeb: boolean;
  anthropicKey: string;
  onAnthropicKeyChange: (value: string) => void;
  isSavingAnthropicKey: boolean;
  onSaveAnthropicKey: () => void;
  model: string;
  onModelSelect?: ((model: string) => void) | undefined;
}

// QNBS-v3 (ADR-0016): extracted from AiProviderCard.tsx to keep that component's cognitive
// complexity under the Biome gate; desktop (Track A) and proxy-capable web (Track B) render the
// same real key + model UI every other cloud provider gets, GitHub Pages keeps a warning-only block.
export const AnthropicProviderFields: FC<AnthropicProviderFieldsProps> = ({
  isDesktop,
  isProxyCapableWeb,
  anthropicKey,
  onAnthropicKeyChange,
  isSavingAnthropicKey,
  onSaveAnthropicKey,
  model,
  onModelSelect,
}) => {
  const { t } = useTranslation();

  if (!isDesktop && !isProxyCapableWeb) {
    return (
      <div className="p-3 rounded-lg bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)] text-sm text-[var(--sc-warning-fg)]">
        <p className="font-semibold mb-1 flex items-center gap-1">
          <Icon name="warning" size="sm" aria-hidden="true" />
          {t('settings.ai.corsRestriction')}
        </p>
        <p>{t('settings.ai.anthropicCorsNote')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor="anthropic-api-key"
        className="text-sm font-medium text-[var(--sc-text-secondary)] block"
      >
        {t('settings.ai.anthropicKey')}
      </label>
      <div className="flex gap-2">
        <Input
          id="anthropic-api-key"
          type="password"
          placeholder="sk-ant-..."
          value={anthropicKey}
          onChange={(e) => onAnthropicKeyChange(e.target.value)}
          className="flex-1 font-mono text-sm"
        />
        <Button onClick={onSaveAnthropicKey} disabled={isSavingAnthropicKey} variant="secondary">
          {isSavingAnthropicKey ? <Spinner className="w-4 h-4" /> : t('settings.ai.save')}
        </Button>
      </div>
      <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.ai.keysEncrypted')}</p>
      {isProxyCapableWeb && (
        <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.ai.anthropicProxyNote')}</p>
      )}
      <label
        htmlFor="anthropic-model"
        className="text-sm font-medium text-[var(--sc-text-secondary)] block"
      >
        {t('settings.advancedAi.model')}
      </label>
      <Select
        id="anthropic-model"
        value={model}
        onChange={(v) => onModelSelect?.(v)}
        options={ANTHROPIC_MODEL_OPTIONS}
      />
    </div>
  );
};
