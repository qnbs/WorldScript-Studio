import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { selectEnableLoraAdapters } from '../../features/featureFlags/featureFlagsSlice';
import {
  deleteAdapter,
  type LoraAdapterMeta,
  listAdapters,
  saveAdapter,
} from '../../services/loraAdapterService';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { MaturityBadge } from './MaturityBadge';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export const LoraAdapterSection: React.FC = () => {
  const { t } = useSettingsViewContext();
  const isEnabled = useAppSelector(selectEnableLoraAdapters);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adapters, setAdapters] = useState<LoraAdapterMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listAdapters();
    setAdapters(list);
  }, []);

  useEffect(() => {
    if (isEnabled) {
      refresh().catch(() => {});
    }
  }, [isEnabled, refresh]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setIsLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const meta: LoraAdapterMeta = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.(safetensors|bin)$/i, ''),
        description: '',
        modelCompatibility: '',
        scale: 1,
        fileSizeBytes: file.size,
        createdAt: Date.now(),
      };
      await saveAdapter(meta, buffer);
      await refresh();
    } catch {
      setUploadError(t('settings.loraAdapters.uploadError'));
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    await deleteAdapter(id);
    await refresh();
  }

  if (!isEnabled) {
    return (
      <Card>
        <CardHeader>
          {/* QNBS-v3: badge also in the flag-gated header so maturity signalling stays consistent
              whether or not the feature is enabled. */}
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
              {t('settings.loraAdapters.title')}
            </h2>
            <MaturityBadge flagKey="enableLoraAdapters" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--sc-text-muted)]">
            {t('settings.loraAdapters.flagGate')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          {/* QNBS-v3: maturity badge (enableLoraAdapters → Experimental), derived from FEATURE_CATALOG. */}
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
              {t('settings.loraAdapters.title')}
            </h2>
            <MaturityBadge flagKey="enableLoraAdapters" />
          </div>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
            {t('settings.loraAdapters.description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--sc-text-muted)] bg-[var(--sc-surface-raised)] rounded-sc-md p-3">
            {t('settings.loraAdapters.notice')}
          </p>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".safetensors,.bin"
              aria-label={t('settings.loraAdapters.uploadBtn')}
              className="sr-only"
              onChange={handleFileChange}
              id="lora-file-upload"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px]"
            >
              {isLoading ? '…' : t('settings.loraAdapters.uploadBtn')}
            </Button>
            {uploadError && (
              <p className="mt-2 text-sm text-[var(--sc-danger-fg)]" role="alert">
                {uploadError}
              </p>
            )}
          </div>

          {adapters.length === 0 ? (
            <p className="text-sm text-[var(--sc-text-muted)] py-4 text-center">
              {t('settings.loraAdapters.emptyState')}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={t('settings.loraAdapters.title')}>
              {adapters.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--sc-text-primary)]">
                      {a.name}
                    </p>
                    <p className="text-xs text-[var(--sc-text-muted)]">
                      {formatBytes(a.fileSizeBytes)} &middot; {t('settings.loraAdapters.scale')}{' '}
                      {a.scale}
                      {a.modelCompatibility ? ` · ${a.modelCompatibility}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('settings.loraAdapters.deleteBtn')} ${a.name}`}
                    onClick={() => handleDelete(a.id)}
                    className="shrink-0 rounded-sc-sm p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--sc-text-muted)] hover:text-[var(--sc-danger-fg)] hover:bg-[var(--sc-surface-overlay)] transition-colors"
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
