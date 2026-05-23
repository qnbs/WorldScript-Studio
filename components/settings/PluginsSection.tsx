import type React from 'react';
import { useAppSelector } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { selectEnablePluginSystem } from '../../features/featureFlags/featureFlagsSlice';
import { pluginRegistry } from '../../services/pluginRegistry';
import { Card, CardContent, CardHeader } from '../ui/Card';

const TYPE_BADGE: Record<string, string> = {
  command: 'bg-[var(--sc-interactive-bg)] text-[var(--sc-interactive-fg)]',
  'ai-tool': 'bg-[var(--sc-accent-bg)] text-[var(--sc-accent-fg)]',
  'local-ai-service': 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]',
};

export const PluginsSection: React.FC = () => {
  const { t } = useSettingsViewContext();
  const isEnabled = useAppSelector(selectEnablePluginSystem);
  const plugins = pluginRegistry.list();

  if (!isEnabled) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.plugins.title')}
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--sc-text-muted)]">{t('settings.plugins.flagGate')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.plugins.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
            {t('settings.plugins.description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--sc-text-muted)] bg-[var(--sc-surface-raised)] rounded-sc-md p-3">
            {t('settings.plugins.sandboxNotice')}
          </p>

          {plugins.length === 0 ? (
            <p className="text-sm text-[var(--sc-text-muted)] py-6 text-center">
              {t('settings.plugins.emptyState')}
            </p>
          ) : (
            <ul className="space-y-3" aria-label={t('settings.plugins.title')}>
              {plugins.map((p) => (
                <li
                  key={p.id}
                  className="rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--sc-text-primary)]">
                          {p.name}
                        </span>
                        <span className="text-xs text-[var(--sc-text-muted)]">v{p.version}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[p.type] ?? TYPE_BADGE['local-ai-service']}`}
                        >
                          {p.type}
                        </span>
                      </div>
                      {p.description && (
                        <p className="mt-1 text-xs text-[var(--sc-text-muted)] line-clamp-2">
                          {p.description}
                        </p>
                      )}
                      {p.permissions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.permissions.map((perm) => (
                            <span
                              key={perm}
                              className="text-xs bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)] px-1.5 py-0.5 rounded font-mono"
                            >
                              {perm}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`${t('settings.plugins.uninstallBtn')} ${p.name}`}
                      onClick={() => pluginRegistry.unregister(p.id)}
                      className="shrink-0 rounded-sc-sm px-3 py-2 min-h-[44px] flex items-center text-xs text-[var(--sc-text-muted)] hover:text-[var(--sc-danger-fg)] hover:bg-[var(--sc-surface-overlay)] transition-colors"
                    >
                      {t('settings.plugins.uninstallBtn')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
