import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { ICONS } from '../constants';
import { SettingsViewContext, useSettingsViewContext } from '../contexts/SettingsViewContext';
import { useSettingsView } from '../hooks/useSettingsView';
import { useTranslation } from '../hooks/useTranslation';
import { listOllamaModels, testAIConnection } from '../services/aiProviderService';
import { storageService } from '../services/storageService';
import type { AIProvider } from '../types';
import { ApiKeySection } from './ApiKeySection';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';

// --- SUB-COMPONENTS ---

const NavButton: FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ icon, label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={isActive ? 'page' : undefined}
    className={`flex items-center w-full px-3 py-2 text-left rounded-md transition-colors ${isActive ? 'bg-[var(--nav-background-active)] text-[var(--nav-text-active)]' : 'hover:bg-[var(--nav-background-hover)] text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)]'}`}
  >
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-5 h-5 mr-3"
    >
      {icon}
    </svg>
    <span>{label}</span>
  </button>
));
NavButton.displayName = 'NavButton';

const ToggleSwitch: FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = React.memo(({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-[var(--foreground-secondary)]">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${checked ? 'bg-[var(--background-interactive)] border-[var(--background-interactive)]' : 'bg-[var(--background-tertiary)]/40 border-[var(--border-primary)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] focus:ring-offset-2 focus:ring-offset-[var(--background-primary)] hover:border-[var(--border-highlight)]`}
    >
      <span
        className={`${checked ? 'translate-x-5' : 'translate-x-0'} inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  </div>
));
ToggleSwitch.displayName = 'ToggleSwitch';

// ─── AI Provider Settings Card ────────────────────────────────────────────────

interface AiProviderCardProps {
  provider: AIProvider;
  ollamaBaseUrl: string;
  onProviderChange: (p: AIProvider) => void;
  onOllamaUrlChange: (url: string) => void;
}

const AiProviderCard: FC<AiProviderCardProps> = ({
  provider,
  ollamaBaseUrl,
  onProviderChange,
  onOllamaUrlChange,
}) => {
  const { t } = useTranslation();
  const [openaiKey, setOpenaiKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);

  useEffect(() => {
    storageService
      .getApiKey('openai')
      .then((k) => setOpenaiKey(k ?? ''))
      .catch(() => {});
  }, []);

  const handleSaveOpenAiKey = useCallback(async () => {
    setIsSavingKey(true);
    try {
      if (openaiKey.trim()) {
        await storageService.saveApiKey('openai', openaiKey.trim());
      } else {
        await storageService.clearApiKey('openai');
      }
    } finally {
      setIsSavingKey(false);
    }
  }, [openaiKey]);

  const handleLoadOllamaModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const models = await listOllamaModels(ollamaBaseUrl);
      setOllamaModels(models);
    } catch {
      setOllamaModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [ollamaBaseUrl]);

  const handleTest = useCallback(async () => {
    setTestStatus('loading');
    setTestError('');
    try {
      const result = await testAIConnection(provider, {
        ollamaBaseUrl,
      });
      if (result.ok) {
        setTestStatus('ok');
      } else {
        setTestStatus('error');
        setTestError(result.error ?? t('settings.ai.connectionFailed'));
      }
    } catch (e) {
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : t('settings.ai.unknownError'));
    }
  }, [provider, ollamaBaseUrl, t]);

  useEffect(() => {
    if (provider === 'ollama') {
      void handleLoadOllamaModels();
      void handleTest();
    }
  }, [provider, handleLoadOllamaModels, handleTest]);

  const providers: { id: AIProvider; label: string }[] = [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'ollama', label: 'Ollama (lokal)' },
    { id: 'anthropic', label: 'Anthropic Claude' },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('settings.ai.providerTitle')}
        </h2>
        <p className="text-sm text-[var(--foreground-muted)] mt-1">
          {t('settings.ai.providerDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provider selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {providers.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onProviderChange(p.id);
                setTestStatus('idle');
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${provider === p.id ? 'bg-[var(--background-interactive)] border-[var(--background-interactive)] text-white' : 'border-[var(--border-primary)] text-[var(--foreground-secondary)] hover:border-[var(--border-interactive)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--foreground-secondary)]">
              {t('settings.ai.providerStatusLabel')}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                testStatus === 'ok'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : testStatus === 'error'
                    ? 'bg-red-500/15 text-red-300'
                    : 'bg-slate-400/10 text-slate-200'
              }`}
            >
              {testStatus === 'ok' && t('settings.ai.providerStatusConnected')}
              {testStatus === 'error' && t('settings.ai.providerStatusDisconnected')}
              {testStatus === 'idle' && t('settings.ai.providerStatusReady')}
            </span>
          </div>
          {testStatus === 'error' && testError && (
            <p className="text-xs text-red-300">{testError}</p>
          )}
        </div>

        {/* Gemini */}
        {provider === 'gemini' && (
          <div className="p-3 rounded-lg bg-[var(--background-secondary)] text-sm text-[var(--foreground-secondary)]">
            {t('settings.ai.geminiSelected')}
          </div>
        )}

        {/* OpenAI */}
        {provider === 'openai' && (
          <div className="space-y-3">
            <label
              htmlFor="openai-api-key"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
            >
              {t('settings.ai.openaiKey')}
            </label>
            <div className="flex gap-2">
              <Input
                id="openai-api-key"
                type="password"
                placeholder="sk-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleSaveOpenAiKey} disabled={isSavingKey} variant="secondary">
                {isSavingKey ? <Spinner className="w-4 h-4" /> : t('settings.ai.save')}
              </Button>
            </div>
            <p className="text-xs text-[var(--foreground-muted)]">
              {t('settings.ai.keysEncrypted')}
            </p>
          </div>
        )}

        {/* Ollama */}
        {provider === 'ollama' && (
          <div className="space-y-3">
            <label
              htmlFor="ollama-server-url"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
            >
              {t('settings.ai.ollamaServerUrl')}
            </label>
            <div className="flex gap-2">
              <Input
                id="ollama-server-url"
                placeholder="http://localhost:11434"
                value={ollamaBaseUrl}
                onChange={(e) => onOllamaUrlChange(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={handleLoadOllamaModels}
                disabled={isLoadingModels}
                variant="secondary"
              >
                {isLoadingModels ? <Spinner className="w-4 h-4" /> : t('settings.ai.loadModels')}
              </Button>
            </div>
            {ollamaModels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {ollamaModels.map((m) => (
                  <span
                    key={m}
                    className="px-2 py-1 text-xs rounded-full bg-[var(--background-tertiary)] text-[var(--foreground-secondary)]"
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">{t('settings.ai.ollamaHint')}</p>
          </div>
        )}

        {/* Anthropic */}
        {provider === 'anthropic' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
            <p className="font-semibold mb-1">⚠️ {t('settings.ai.corsRestriction')}</p>
            <p>{t('settings.ai.anthropicCorsNote')}</p>
          </div>
        )}

        {/* Test connection */}
        {provider !== 'gemini' && (
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleTest} disabled={testStatus === 'loading'} variant="secondary">
              {testStatus === 'loading' ? (
                <Spinner className="w-4 h-4" />
              ) : (
                t('settings.ai.testConnection')
              )}
            </Button>
            {testStatus === 'ok' && (
              <span className="text-sm text-emerald-400">
                ✓ {t('settings.ai.connectionSuccess')}
              </span>
            )}
            {testStatus === 'error' && <span className="text-sm text-red-400">✗ {testError}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Main Settings UI ─────────────────────────────────────────────────────────

const SettingsViewUI: FC = () => {
  const {
    t,
    project,
    settings,
    featureFlags,
    language,
    activeCategory,
    setActiveCategory,
    handleLanguageChange,
    handleSettingChange,
    importFileRef,
    handleExport,
    handleImport,
    setModal,
    projectSize,
    snapshots,
    setSnapshotName,
  } = useSettingsViewContext();
  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  const navCategories = [
    {
      id: 'general',
      label: t('settings.categories.general'),
      icon: ICONS.SETTINGS,
    },
    {
      id: 'appearance',
      label: t('settings.categories.appearance'),
      icon: <path d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />,
    },
    {
      id: 'editor',
      label: t('settings.categories.editor'),
      icon: ICONS.WRITER,
    },
    {
      id: 'advanced-editor',
      label: t('settings.categories.advancedEditor'),
      icon: (
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      ),
    },
    { id: 'ai', label: t('settings.categories.ai'), icon: ICONS.SPARKLES },
    {
      id: 'advanced-ai',
      label: t('settings.categories.advancedAi'),
      icon: (
        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      ),
    },
    {
      id: 'accessibility',
      label: t('settings.categories.accessibility'),
      icon: (
        <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M4.5 16.5v-.75a2.25 2.25 0 011.372-2.048l1.287-.513a.75.75 0 011.06.184l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27z" />
      ),
    },
    {
      id: 'privacy',
      label: t('settings.categories.privacy'),
      icon: (
        <path d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      ),
    },
    {
      id: 'performance',
      label: t('settings.categories.performance'),
      icon: <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />,
    },
    {
      id: 'notifications',
      label: t('settings.categories.notifications'),
      icon: (
        <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      ),
    },
    {
      id: 'collaboration',
      label: t('settings.categories.collaboration'),
      icon: (
        <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      ),
    },
    {
      id: 'integrations',
      label: t('settings.categories.integrations'),
      icon: (
        <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      ),
    },
    {
      id: 'backup',
      label: t('settings.categories.backup'),
      icon: (
        <path d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0v-7.5A2.25 2.25 0 018.25 2.25h13.5A2.25 2.25 0 0124 4.5v7.5m-19.5 0v7.5a2.25 2.25 0 002.25 2.25h13.5a2.25 2.25 0 002.25-2.25v-7.5" />
      ),
    },
    {
      id: 'data',
      label: t('settings.categories.data'),
      icon: (
        <path d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125v-1.5c0-.621.504-1.125 1.125-1.125m17.25 0h.008v.008h-.008v-.008zm-17.25 0a1.125 1.125 0 00-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25 0h.008v.008h-.008v-.008zM6 16.5V9.75m6.75 6.75V9.75m6.75 6.75V9.75M9 9.75h.008v.008H9v-.008zm3.75 0h.008v.008h-.008v-.008zm3.75 0h.008v.008h-.008v-.008z" />
      ),
    },
    { id: 'about', label: t('settings.categories.about'), icon: ICONS.HELP },
  ];

  const creativityMap = { Focused: 0, Balanced: 1, Imaginative: 2 };
  const creativityReverseMap = ['Focused', 'Balanced', 'Imaginative'];

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return (
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                {t('settings.language.title')}
              </h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[var(--foreground-secondary)] mb-2">
                {t('settings.language.description')}
              </p>
              <Select id="language-select" value={language} onChange={handleLanguageChange}>
                <option value="en">{t('settings.language.english')}</option>
                <option value="de">{t('settings.language.german')}</option>
                <option value="fr">{t('settings.language.french')}</option>
                <option value="es">{t('settings.language.spanish')}</option>
                <option value="it">{t('settings.language.italian')}</option>
              </Select>
            </CardContent>
          </Card>
        );
      case 'appearance':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.appearance.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <span className="text-sm font-medium text-[var(--foreground-secondary)]">
                  {t('settings.appearance.theme')}
                </span>
                <div className="grid grid-cols-3 gap-4">
                  <Button
                    variant={settings.theme === 'dark' ? 'primary' : 'secondary'}
                    onClick={() => handleSettingChange('theme', 'dark')}
                    className="text-center justify-center py-4"
                  >
                    {t('settings.theme.dark')}
                  </Button>
                  <Button
                    variant={settings.theme === 'light' ? 'primary' : 'secondary'}
                    onClick={() => handleSettingChange('theme', 'light')}
                    className="text-center justify-center py-4"
                  >
                    {t('settings.theme.light')}
                  </Button>
                  <Button
                    variant={settings.theme === 'auto' ? 'primary' : 'secondary'}
                    onClick={() => handleSettingChange('theme', 'auto')}
                    className="text-center justify-center py-4"
                  >
                    {t('settings.theme.auto')}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.appearance.customization')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="settings-primary-color" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.appearance.primaryColor')}
                    </label>
                    <input id="settings-primary-color"
                      type="color"
                      value={settings.themeCustomization.primaryColor}
                      onChange={(e) =>
                        handleSettingChange('themeCustomization', {
                          ...settings.themeCustomization,
                          primaryColor: e.target.value,
                        })
                      }
                      className="w-full h-10 rounded border border-[var(--border-primary)]"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-secondary-color" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.appearance.secondaryColor')}
                    </label>
                    <input id="settings-secondary-color"
                      type="color"
                      value={settings.themeCustomization.secondaryColor}
                      onChange={(e) =>
                        handleSettingChange('themeCustomization', {
                          ...settings.themeCustomization,
                          secondaryColor: e.target.value,
                        })
                      }
                      className="w-full h-10 rounded border border-[var(--border-primary)]"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-accent-color" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.appearance.accentColor')}
                    </label>
                    <input id="settings-accent-color"
                      type="color"
                      value={settings.themeCustomization.accentColor}
                      onChange={(e) =>
                        handleSettingChange('themeCustomization', {
                          ...settings.themeCustomization,
                          accentColor: e.target.value,
                        })
                      }
                      className="w-full h-10 rounded border border-[var(--border-primary)]"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-bg-color" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.appearance.backgroundColor')}
                    </label>
                    <input id="settings-bg-color"
                      type="color"
                      value={settings.themeCustomization.backgroundColor}
                      onChange={(e) =>
                        handleSettingChange('themeCustomization', {
                          ...settings.themeCustomization,
                          backgroundColor: e.target.value,
                        })
                      }
                      className="w-full h-10 rounded border border-[var(--border-primary)]"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="settings-custom-css" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.appearance.customCss')}
                  </label>
                  <textarea id="settings-custom-css"
                    value={settings.themeCustomization.customCss}
                    onChange={(e) =>
                      handleSettingChange('themeCustomization', {
                        ...settings.themeCustomization,
                        customCss: e.target.value,
                      })
                    }
                    placeholder="/* Custom CSS */"
                    className="w-full h-32 p-3 rounded border border-[var(--border-primary)] bg-[var(--background-primary)] text-[var(--foreground-primary)] font-mono text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'editor': {
        const getFontFamily = () => {
          if (settings.editorFont === 'custom' && settings.customFont) {
            return settings.customFont.name;
          }
          return settings.editorFont;
        };
        const previewStyle = {
          fontFamily: getFontFamily(),
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineSpacing,
          '--paragraph-spacing': `${settings.paragraphSpacing * 0.5}rem`,
          textIndent: settings.indentFirstLine ? '2em' : '0',
        } as React.CSSProperties;
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.editor.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <label
                    htmlFor="font-family-select"
                    className="text-sm font-medium text-[var(--foreground-secondary)]"
                  >
                    {t('settings.editor.fontFamily')}
                  </label>
                  <Select
                    id="font-family-select"
                    value={settings.editorFont}
                    onChange={(e) => handleSettingChange('editorFont', e.target.value)}
                  >
                    <option value="serif">{t('settings.font.serif')}</option>
                    <option value="sans-serif">{t('settings.font.sans')}</option>
                    <option value="monospace">{t('settings.font.mono')}</option>
                    <option value="custom">{t('settings.font.custom')}</option>
                  </Select>
                </div>
                {settings.editorFont === 'custom' && (
                  <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg">
                    <h4 className="font-semibold text-[var(--foreground-primary)]">
                      {t('settings.editor.customFont')}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        placeholder={t('settings.editor.customFontName')}
                        value={settings.customFont?.name || ''}
                        onChange={(e) =>
                          handleSettingChange('customFont', {
                            name: e.target.value,
                            url: settings.customFont?.url || '',
                            format: settings.customFont?.format || 'woff2',
                          })
                        }
                      />
                      <Select
                        value={settings.customFont?.format || 'woff2'}
                        onChange={(e) =>
                          handleSettingChange('customFont', {
                            name: settings.customFont?.name || '',
                            url: settings.customFont?.url || '',
                            format: e.target.value as 'woff' | 'woff2' | 'ttf' | 'otf',
                          })
                        }
                      >
                        <option value="woff">WOFF</option>
                        <option value="woff2">WOFF2</option>
                        <option value="ttf">TTF</option>
                        <option value="otf">OTF</option>
                      </Select>
                    </div>
                    <Input
                      placeholder={t('settings.editor.customFontUrl')}
                      value={settings.customFont?.url || ''}
                      onChange={(e) =>
                        handleSettingChange('customFont', {
                          name: settings.customFont?.name || '',
                          url: e.target.value,
                          format: settings.customFont?.format || 'woff2',
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <label
                    htmlFor="font-size-input"
                    className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
                  >
                    <span>{t('settings.editor.fontSize')}</span>
                    <span>{settings.fontSize}px</span>
                  </label>
                  <input
                    id="font-size-input"
                    type="range"
                    min="12"
                    max="24"
                    value={settings.fontSize}
                    onChange={(e) => handleSettingChange('fontSize', e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="line-height-input"
                    className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
                  >
                    <span>{t('settings.editor.lineHeight')}</span>
                    <span>{settings.lineSpacing}</span>
                  </label>
                  <input
                    id="line-height-input"
                    type="range"
                    min="1.2"
                    max="2.2"
                    step="0.1"
                    value={settings.lineSpacing}
                    onChange={(e) => handleSettingChange('lineSpacing', e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="p-spacing-input"
                    className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
                  >
                    <span>{t('settings.editor.paragraphSpacing')}</span>
                    <span>{settings.paragraphSpacing.toFixed(1)}</span>
                  </label>
                  <input
                    id="p-spacing-input"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={settings.paragraphSpacing}
                    onChange={(e) => handleSettingChange('paragraphSpacing', e.target.value)}
                    className="w-full"
                  />
                </div>
                <ToggleSwitch
                  label={t('settings.editor.indentFirstLine')}
                  checked={settings.indentFirstLine}
                  onChange={(v) => handleSettingChange('indentFirstLine', v)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold text-[var(--foreground-primary)]">
                  {t('settings.editor.previewTitle')}
                </h3>
              </CardHeader>
              <CardContent>
                <div
                  style={previewStyle}
                  className="p-4 bg-[var(--glass-bg)] rounded-md border border-[var(--border-primary)] max-h-48 overflow-y-auto text-[var(--foreground-primary)]"
                >
                  <p className="[&&]:my-0 [&&]:mb-[var(--paragraph-spacing)]">
                    {t('settings.editor.previewText1')}
                  </p>
                  <p className="[&&]:my-0">{t('settings.editor.previewText2')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }
      case 'ai':
        return (
          <div className="space-y-6">
            <AiProviderCard
              provider={(settings.advancedAi?.provider ?? 'gemini') as AIProvider}
              ollamaBaseUrl={settings.advancedAi?.ollamaBaseUrl ?? 'http://localhost:11434'}
              onProviderChange={(p) => {
                const currentModel = settings.advancedAi?.model ?? 'gemini-1.5-flash';
                const newModel =
                  p === 'ollama'
                    ? currentModel.startsWith('ollama/')
                      ? currentModel
                      : 'ollama/gemma3'
                    : p === 'gemini'
                      ? currentModel.startsWith('ollama/')
                        ? 'gemini-1.5-flash'
                        : currentModel
                      : p === 'openai'
                        ? currentModel.startsWith('gpt-')
                          ? currentModel
                          : 'gpt-4o-mini'
                        : p === 'anthropic'
                          ? currentModel.startsWith('claude-')
                            ? currentModel
                            : 'claude-3-haiku'
                          : currentModel;
                handleSettingChange('advancedAi', {
                  ...settings.advancedAi,
                  provider: p,
                  model: newModel,
                });
              }}
              onOllamaUrlChange={(url) =>
                handleSettingChange('advancedAi', {
                  ...settings.advancedAi,
                  ollamaBaseUrl: url,
                })
              }
            />
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.ai.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="ai-creativity-select"
                    className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
                  >
                    <span>{t('settings.ai.creativity')}</span>
                    <span className="font-bold text-[var(--foreground-primary)]">
                      {settings.aiCreativity}
                    </span>
                  </label>
                  <p className="text-xs text-[var(--foreground-muted)] mb-2">
                    {t('settings.ai.creativityDescription')}
                  </p>
                  <input
                    id="ai-creativity-select"
                    type="range"
                    min="0"
                    max="2"
                    step="1"
                    value={creativityMap[settings.aiCreativity]}
                    onChange={(e) =>
                      handleSettingChange(
                        'aiCreativity',
                        creativityReverseMap[Number(e.target.value)],
                      )
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-[var(--foreground-muted)]">
                    <span>{t('settings.creativity.focused')}</span>
                    <span>{t('settings.creativity.balanced')}</span>
                    <span>{t('settings.creativity.imaginative')}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <ApiKeySection />
              </CardContent>
            </Card>
          </div>
        );
      case 'data':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.data.title')}
                </h2>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--foreground-secondary)] mb-6">
                  {t('settings.data.description')}
                </p>
                <div className="p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--border-primary)] space-y-3">
                  <h3 className="font-semibold text-[var(--foreground-primary)]">
                    {t('settings.data.actions')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Button onClick={handleExport} variant="secondary">
                      {t('settings.data.export')}
                    </Button>
                    <Button onClick={() => importFileRef.current?.click()} variant="secondary">
                      {t('settings.data.import')}
                    </Button>
                    <input
                      type="file"
                      ref={importFileRef}
                      onChange={handleImport}
                      accept=".json"
                      className="hidden"
                    />
                    <Button
                      onClick={() => setModal({ state: 'reset', payload: {} })}
                      variant="danger"
                    >
                      {t('settings.data.reset')}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-center text-[var(--foreground-muted)] pt-2">
                  {t('settings.data.projectSize', { size: projectSize })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.data.snapshots')}
                </h2>
                <Button
                  onClick={() => {
                    setSnapshotName('');
                    setModal({ state: 'create', payload: {} });
                  }}
                >
                  {t('settings.data.createSnapshot')}
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--foreground-secondary)] mb-4">
                  {t('settings.data.snapshotsDescription')}
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {snapshots.length > 0 ? (
                    snapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className="flex items-center justify-between p-3 bg-[var(--glass-bg)] rounded-md border border-[var(--border-primary)] hover:border-[var(--border-interactive)] transition-colors"
                      >
                        <div>
                          <p className="font-semibold text-[var(--foreground-primary)]">
                            {snap.name === 'Automatic Snapshot'
                              ? t('settings.data.automaticSnapshot')
                              : snap.name}
                          </p>
                          <p className="text-xs text-[var(--foreground-muted)]">
                            {new Date(snap.date).toLocaleString()} - {snap.wordCount}{' '}
                            {t('dashboard.stats.totalWordCount')}
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            onClick={() =>
                              setModal({
                                state: 'restore',
                                payload: {
                                  id: snap.id,
                                  date: new Date(snap.date).toLocaleString(),
                                  wordCount: snap.wordCount,
                                },
                              })
                            }
                            variant="secondary"
                            size="sm"
                          >
                            {t('settings.data.restore')}
                          </Button>
                          <Button
                            onClick={() =>
                              setModal({
                                state: 'delete',
                                payload: { id: snap.id, name: snap.name },
                              })
                            }
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:bg-red-500/10 dark:hover:bg-red-900/50"
                            aria-label={`${t('settings.data.delete')} ${snap.name}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="w-5 h-5"
                            >
                              {ICONS.TRASH}
                            </svg>
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-12 border-2 border-dashed border-[var(--border-primary)] rounded-xl bg-[var(--background-secondary)]/30">
                      <div className="p-4 rounded-full bg-[var(--background-tertiary)] mb-3">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-8 h-8 text-[var(--foreground-muted)]"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-[var(--foreground-primary)]">
                        {t('settings.data.noSnapshots')}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'advanced-editor':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.advancedEditor.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.advancedEditor.autoComplete')}
                    checked={settings.advancedEditor.autoComplete}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        autoComplete: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.advancedEditor.spellCheck')}
                    checked={settings.advancedEditor.spellCheck}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        spellCheck: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.advancedEditor.grammarCheck')}
                    checked={settings.advancedEditor.grammarCheck}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        grammarCheck: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.advancedEditor.wordCount')}
                    checked={settings.advancedEditor.wordCount}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        wordCount: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.advancedEditor.readingTime')}
                    checked={settings.advancedEditor.readingTime}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        readingTime: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.advancedEditor.writingStats')}
                    checked={settings.advancedEditor.writingStats}
                    onChange={(v) =>
                      handleSettingChange('advancedEditor', {
                        ...settings.advancedEditor,
                        writingStats: v,
                      })
                    }
                  />
                </div>
                <div className="border-t border-[var(--border-primary)] pt-4">
                  <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-4">
                    {t('settings.advancedEditor.focusModes')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToggleSwitch
                      label={t('settings.advancedEditor.distractionFree')}
                      checked={settings.advancedEditor.distractionFree}
                      onChange={(v) =>
                        handleSettingChange('advancedEditor', {
                          ...settings.advancedEditor,
                          distractionFree: v,
                        })
                      }
                    />
                    <ToggleSwitch
                      label={t('settings.advancedEditor.typewriterMode')}
                      checked={settings.advancedEditor.typewriterMode}
                      onChange={(v) =>
                        handleSettingChange('advancedEditor', {
                          ...settings.advancedEditor,
                          typewriterMode: v,
                        })
                      }
                    />
                    <ToggleSwitch
                      label={t('settings.advancedEditor.zenMode')}
                      checked={settings.advancedEditor.zenMode}
                      onChange={(v) =>
                        handleSettingChange('advancedEditor', {
                          ...settings.advancedEditor,
                          zenMode: v,
                        })
                      }
                    />
                    <ToggleSwitch
                      label={t('settings.advancedEditor.focusMode')}
                      checked={settings.advancedEditor.focusMode}
                      onChange={(v) =>
                        handleSettingChange('advancedEditor', {
                          ...settings.advancedEditor,
                          focusMode: v,
                        })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'advanced-ai':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.advancedAi.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <label htmlFor="settings-ai-model" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.advancedAi.model')}
                  </label>
                  <Select id="settings-ai-model"
                    value={settings.advancedAi.model}
                    onChange={(e) =>
                      handleSettingChange('advancedAi', {
                        ...settings.advancedAi,
                        model: e.target.value,
                      })
                    }
                  >
                    {settings.advancedAi.provider === 'ollama' ? (
                      <>
                        <option value="ollama/gemma3">Gemma 3 4B</option>
                        <option value="ollama/llama3">Llama 3</option>
                        <option value="ollama/qwen3-8b">Qwen3 8B</option>
                        <option value="ollama/deepseek-v3.2-7b">DeepSeek V3.2 7B</option>
                        <option value="ollama/llama4-scout-17b">Llama 4 Scout 17B</option>
                        <option value="ollama/mistral">Mistral</option>
                        <option value="ollama/mistral-small-3.2-24b">Mistral Small 3.2 24B</option>
                        <option value="ollama/phi-4-mini-3.8b">Phi-4 Mini 3.8B</option>
                        <option value="ollama/glm-4-9b">GLM-4 9B</option>
                        <option value="ollama/kimi-k2-instruct-32b">Kimi K2 Instruct 32B</option>
                        <option value="ollama/custom">{t('settings.ai.customModel')}</option>
                      </>
                    ) : settings.advancedAi.provider === 'openai' ? (
                      <>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4o">GPT-4o</option>
                      </>
                    ) : settings.advancedAi.provider === 'anthropic' ? (
                      <>
                        <option value="claude-3-haiku">Claude 3 Haiku</option>
                        <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                      </>
                    ) : (
                      <>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                      </>
                    )}
                  </Select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="settings-ai-temperature" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.advancedAi.temperature')} ({settings.advancedAi.temperature})
                    </label>
                    <input id="settings-ai-temperature"
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.advancedAi.temperature}
                      onChange={(e) =>
                        handleSettingChange('advancedAi', {
                          ...settings.advancedAi,
                          temperature: parseFloat(e.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-ai-max-tokens" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.advancedAi.maxTokens')} ({settings.advancedAi.maxTokens})
                    </label>
                    <input id="settings-ai-max-tokens"
                      type="range"
                      min="256"
                      max="8192"
                      step="256"
                      value={settings.advancedAi.maxTokens}
                      onChange={(e) =>
                        handleSettingChange('advancedAi', {
                          ...settings.advancedAi,
                          maxTokens: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-ai-top-p" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.advancedAi.topP')} ({settings.advancedAi.topP})
                    </label>
                    <input id="settings-ai-top-p"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={settings.advancedAi.topP}
                      onChange={(e) =>
                        handleSettingChange('advancedAi', {
                          ...settings.advancedAi,
                          topP: parseFloat(e.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-ai-rate-limit" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                      {t('settings.advancedAi.rateLimit')} ({settings.advancedAi.rateLimit}/min)
                    </label>
                    <input id="settings-ai-rate-limit"
                      type="range"
                      min="10"
                      max="120"
                      step="10"
                      value={settings.advancedAi.rateLimit}
                      onChange={(e) =>
                        handleSettingChange('advancedAi', {
                          ...settings.advancedAi,
                          rateLimit: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="border-t border-[var(--border-primary)] pt-4">
                  <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-3">
                    {t('settings.featureFlags.title')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToggleSwitch
                      label={t('settings.featureFlags.enableOllama')}
                      checked={featureFlags.enableOllama}
                      onChange={(v) => handleSettingChange('enableOllama', v)}
                    />
                    <ToggleSwitch
                      label={t('settings.featureFlags.enablePerformanceBudgets')}
                      checked={featureFlags.enablePerformanceBudgets}
                      onChange={(v) => handleSettingChange('enablePerformanceBudgets', v)}
                    />
                    <ToggleSwitch
                      label={t('settings.featureFlags.enableVisualRegression')}
                      checked={featureFlags.enableVisualRegression}
                      onChange={(v) => handleSettingChange('enableVisualRegression', v)}
                    />
                  </div>
                  <p className="text-sm text-[var(--foreground-muted)] mt-3">
                    {t('settings.featureFlags.description')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'accessibility':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.accessibility.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.accessibility.highContrast')}
                    checked={settings.accessibility.highContrast}
                    onChange={(v) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        highContrast: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.accessibility.reducedMotion')}
                    checked={settings.accessibility.reducedMotion}
                    onChange={(v) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        reducedMotion: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.accessibility.largeText')}
                    checked={settings.accessibility.largeText}
                    onChange={(v) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        largeText: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.accessibility.screenReader')}
                    checked={settings.accessibility.screenReader}
                    onChange={(v) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        screenReader: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.accessibility.focusIndicators')}
                    checked={settings.accessibility.focusIndicators}
                    onChange={(v) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        focusIndicators: v,
                      })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="settings-colorblind-mode" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.accessibility.colorBlindMode')}
                  </label>
                  <Select id="settings-colorblind-mode"
                    value={settings.accessibility.colorBlindMode}
                    onChange={(e) =>
                      handleSettingChange('accessibility', {
                        ...settings.accessibility,
                        colorBlindMode: e.target.value,
                      })
                    }
                  >
                    <option value="none">{t('settings.accessibility.colorBlind.none')}</option>
                    <option value="protanopia">
                      {t('settings.accessibility.colorBlind.protanopia')}
                    </option>
                    <option value="deuteranopia">
                      {t('settings.accessibility.colorBlind.deuteranopia')}
                    </option>
                    <option value="tritanopia">
                      {t('settings.accessibility.colorBlind.tritanopia')}
                    </option>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'privacy':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.privacy.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.privacy.analyticsEnabled')}
                    checked={settings.privacy.analyticsEnabled}
                    onChange={(v) =>
                      handleSettingChange('privacy', {
                        ...settings.privacy,
                        analyticsEnabled: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.privacy.crashReporting')}
                    checked={settings.privacy.crashReporting}
                    onChange={(v) =>
                      handleSettingChange('privacy', {
                        ...settings.privacy,
                        crashReporting: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.privacy.dataEncryption')}
                    checked={settings.privacy.dataEncryption}
                    onChange={(v) =>
                      handleSettingChange('privacy', {
                        ...settings.privacy,
                        dataEncryption: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.privacy.localStorageOnly')}
                    checked={settings.privacy.localStorageOnly}
                    onChange={(v) =>
                      handleSettingChange('privacy', {
                        ...settings.privacy,
                        localStorageOnly: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.privacy.shareUsageData')}
                    checked={settings.privacy.shareUsageData}
                    onChange={(v) =>
                      handleSettingChange('privacy', {
                        ...settings.privacy,
                        shareUsageData: v,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'performance':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.performance.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <label htmlFor="settings-autosave-interval" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.performance.autoSaveInterval')} (
                    {settings.performance.autoSaveInterval}s)
                  </label>
                  <input id="settings-autosave-interval"
                    type="range"
                    min="10"
                    max="300"
                    step="10"
                    value={settings.performance.autoSaveInterval}
                    onChange={(e) =>
                      handleSettingChange('performance', {
                        ...settings.performance,
                        autoSaveInterval: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label htmlFor="settings-cache-size" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.performance.cacheSize')} ({settings.performance.cacheSize} MB)
                  </label>
                  <input id="settings-cache-size"
                    type="range"
                    min="50"
                    max="500"
                    step="50"
                    value={settings.performance.cacheSize}
                    onChange={(e) =>
                      handleSettingChange('performance', {
                        ...settings.performance,
                        cacheSize: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.performance.preloadContent')}
                    checked={settings.performance.preloadContent}
                    onChange={(v) =>
                      handleSettingChange('performance', {
                        ...settings.performance,
                        preloadContent: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.performance.lazyLoadImages')}
                    checked={settings.performance.lazyLoadImages}
                    onChange={(v) =>
                      handleSettingChange('performance', {
                        ...settings.performance,
                        lazyLoadImages: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.performance.offlineMode')}
                    checked={settings.performance.offlineMode}
                    onChange={(v) =>
                      handleSettingChange('performance', {
                        ...settings.performance,
                        offlineMode: v,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'notifications':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.notifications.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.notifications.desktopNotifications')}
                    checked={settings.notifications.desktopNotifications}
                    onChange={(v) =>
                      handleSettingChange('notifications', {
                        ...settings.notifications,
                        desktopNotifications: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.notifications.emailNotifications')}
                    checked={settings.notifications.emailNotifications}
                    onChange={(v) =>
                      handleSettingChange('notifications', {
                        ...settings.notifications,
                        emailNotifications: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.notifications.goalAchievements')}
                    checked={settings.notifications.goalAchievements}
                    onChange={(v) =>
                      handleSettingChange('notifications', {
                        ...settings.notifications,
                        goalAchievements: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.notifications.collaborationUpdates')}
                    checked={settings.notifications.collaborationUpdates}
                    onChange={(v) =>
                      handleSettingChange('notifications', {
                        ...settings.notifications,
                        collaborationUpdates: v,
                      })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="settings-writing-reminders" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.notifications.writingReminders')}
                  </label>
                  <Select id="settings-writing-reminders"
                    value={settings.notifications.writingReminders}
                    onChange={(e) =>
                      handleSettingChange('notifications', {
                        ...settings.notifications,
                        writingReminders: e.target.value,
                      })
                    }
                  >
                    <option value="never">{t('settings.notifications.frequency.never')}</option>
                    <option value="daily">{t('settings.notifications.frequency.daily')}</option>
                    <option value="weekly">{t('settings.notifications.frequency.weekly')}</option>
                    <option value="monthly">{t('settings.notifications.frequency.monthly')}</option>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'collaboration':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.collaboration.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.collaboration.realTimeCollaboration')}
                    checked={settings.collaboration.realTimeCollaboration}
                    onChange={(v) =>
                      handleSettingChange('collaboration', {
                        ...settings.collaboration,
                        realTimeCollaboration: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.collaboration.publicSharing')}
                    checked={settings.collaboration.publicSharing}
                    onChange={(v) =>
                      handleSettingChange('collaboration', {
                        ...settings.collaboration,
                        publicSharing: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.collaboration.commentSystem')}
                    checked={settings.collaboration.commentSystem}
                    onChange={(v) =>
                      handleSettingChange('collaboration', {
                        ...settings.collaboration,
                        commentSystem: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.collaboration.versionHistory')}
                    checked={settings.collaboration.versionHistory}
                    onChange={(v) =>
                      handleSettingChange('collaboration', {
                        ...settings.collaboration,
                        versionHistory: v,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'integrations':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.integrations.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label htmlFor="settings-sync-provider" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.integrations.syncProvider')}
                  </label>
                  <Select id="settings-sync-provider"
                    value={settings.integrations.syncProvider}
                    onChange={(e) =>
                      handleSettingChange('integrations', {
                        ...settings.integrations,
                        syncProvider: e.target.value,
                      })
                    }
                  >
                    <option value="none">{t('settings.integrations.providers.none')}</option>
                    <option value="google-drive">
                      {t('settings.integrations.providers.googleDrive')}
                    </option>
                    <option value="dropbox">{t('settings.integrations.providers.dropbox')}</option>
                    <option value="onedrive">
                      {t('settings.integrations.providers.onedrive')}
                    </option>
                    <option value="icloud">{t('settings.integrations.providers.icloud')}</option>
                  </Select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.integrations.evernoteSync')}
                    checked={settings.integrations.evernoteSync}
                    onChange={(v) =>
                      handleSettingChange('integrations', {
                        ...settings.integrations,
                        evernoteSync: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.integrations.notionSync')}
                    checked={settings.integrations.notionSync}
                    onChange={(v) =>
                      handleSettingChange('integrations', {
                        ...settings.integrations,
                        notionSync: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.integrations.scrivenerExport')}
                    checked={settings.integrations.scrivenerExport}
                    onChange={(v) =>
                      handleSettingChange('integrations', {
                        ...settings.integrations,
                        scrivenerExport: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.integrations.googleDocsImport')}
                    checked={settings.integrations.googleDocsImport}
                    onChange={(v) =>
                      handleSettingChange('integrations', {
                        ...settings.integrations,
                        googleDocsImport: v,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'backup':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                  {t('settings.backup.title')}
                </h2>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleSwitch
                    label={t('settings.backup.autoBackup')}
                    checked={settings.backup.autoBackup}
                    onChange={(v) =>
                      handleSettingChange('backup', {
                        ...settings.backup,
                        autoBackup: v,
                      })
                    }
                  />
                  <ToggleSwitch
                    label={t('settings.backup.encryptBackups')}
                    checked={settings.backup.encryptBackups}
                    onChange={(v) =>
                      handleSettingChange('backup', {
                        ...settings.backup,
                        encryptBackups: v,
                      })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="settings-backup-frequency" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.backup.backupFrequency')}
                  </label>
                  <Select id="settings-backup-frequency"
                    value={settings.backup.backupFrequency}
                    onChange={(e) =>
                      handleSettingChange('backup', {
                        ...settings.backup,
                        backupFrequency: e.target.value,
                      })
                    }
                  >
                    <option value="manual">{t('settings.backup.frequency.manual')}</option>
                    <option value="daily">{t('settings.backup.frequency.daily')}</option>
                    <option value="weekly">{t('settings.backup.frequency.weekly')}</option>
                    <option value="monthly">{t('settings.backup.frequency.monthly')}</option>
                  </Select>
                </div>
                <div>
                  <label htmlFor="settings-backup-max" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.backup.maxBackups')} ({settings.backup.maxBackups})
                  </label>
                  <input id="settings-backup-max"
                    type="range"
                    min="5"
                    max="50"
                    step="5"
                    value={settings.backup.maxBackups}
                    onChange={(e) =>
                      handleSettingChange('backup', {
                        ...settings.backup,
                        maxBackups: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label htmlFor="settings-backup-location" className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                    {t('settings.backup.backupLocation')}
                  </label>
                  <Input id="settings-backup-location"
                    value={settings.backup.backupLocation}
                    onChange={(e) =>
                      handleSettingChange('backup', {
                        ...settings.backup,
                        backupLocation: e.target.value,
                      })
                    }
                    placeholder="./backups"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      case 'about':
        return (
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
                {t('settings.about.title')}
              </h2>
            </CardHeader>
            <CardContent className="text-center text-[var(--foreground-muted)] space-y-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-16 h-16 text-indigo-400 mx-auto"
              >
                {ICONS.WRITER}
              </svg>
              <h3 className="text-2xl font-bold text-[var(--foreground-primary)]">
                StoryCraft Studio
              </h3>
              <p>Version 2.0.0</p>
              <p>{t('settings.about.description')}</p>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Mobile Navigation */}
      <div className="md:hidden mb-6">
        <label
          htmlFor="settings-category"
          className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
        >
          Category
        </label>
        <Select
          id="settings-category"
          value={activeCategory}
          onChange={(e) => setActiveCategory(e.target.value)}
          className="w-full"
        >
          {navCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Desktop Navigation */}
        <div className="hidden md:block md:col-span-1">
          <div className="space-y-2 sticky top-20">
            {navCategories.map((cat) => (
              <NavButton
                key={cat.id}
                icon={cat.icon}
                label={cat.label}
                isActive={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              />
            ))}
          </div>
        </div>
        <div className="md:col-span-3">{renderContent()}</div>
      </div>
      <SettingsModals />
    </div>
  );
};

const SettingsModals: FC = () => {
  const {
    t,
    modal,
    setModal,
    handleResetProject,
    snapshotName,
    setSnapshotName,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    currentWordCount,
  } = useSettingsViewContext();

  if (modal.state === 'closed') return null;

  if (modal.state === 'reset')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.resetModal.title')}
      >
        <div className="space-y-4">
          {' '}
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.resetModal.description')}
          </p>{' '}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleResetProject}>
              {t('settings.resetModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'create')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.data.createSnapshot')}
      >
        <div className="space-y-4">
          <label htmlFor="snapshot-name">{t('settings.data.snapshotName')}</label>
          <Input
            id="snapshot-name"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            placeholder={t('settings.data.snapshotNamePlaceholder')}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateSnapshot}>{t('common.generate')}</Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'restore')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.restoreModal.title')}
      >
        <div className="space-y-4">
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.restoreModal.description', {
              date: modal.payload.date || 'the past',
            })}
          </p>
          <p className="text-sm bg-[var(--background-tertiary)] p-3 rounded-md border border-[var(--border-primary)]">
            {t('settings.restoreModal.wordCountInfo', {
              snapshotWordCount: String(modal.payload.wordCount || 0),
              currentWordCount: String(currentWordCount),
            })}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleRestoreSnapshot}>
              {t('settings.restoreModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'delete')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.deleteModal.title')}
      >
        <div className="space-y-4">
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.deleteModal.description')}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteSnapshot}>
              {t('settings.deleteModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  return null;
};

export const SettingsView: FC = () => {
  const contextValue = useSettingsView();
  return (
    <SettingsViewContext.Provider value={contextValue}>
      <SettingsViewUI />
    </SettingsViewContext.Provider>
  );
};
