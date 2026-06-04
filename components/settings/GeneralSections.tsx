import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { ICONS } from '../../constants';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { defaultThemeCustomization } from '../../features/settings/settingsSlice';
import { usePWA } from '../../hooks/usePWA';
import packageJson from '../../package.json';
import { storageService } from '../../services/storageService';
import { getTauriAppVersion, isTauriRuntime } from '../../services/tauriRuntime';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';

// QNBS-v3: PWA install card — always accessible from Settings even after banner dismissed.
const PWAInstallCard: FC = () => {
  const { t } = useSettingsViewContext();
  const { isInstallable, isInstalled, installApp, clearCache } = usePWA();
  const [cacheCleared, setCacheCleared] = useState(false);

  const handleClearCache = useCallback(async () => {
    await clearCache();
    setCacheCleared(true);
    setTimeout(() => window.location.reload(), 1200);
  }, [clearCache]);

  // Don't render in Tauri desktop — install has no meaning there
  if (isTauriRuntime()) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-5 w-5 text-[var(--sc-text-accent)]"
            aria-hidden="true"
          >
            {/* device-phone-mobile — represents PWA / home screen install */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3"
            />
          </svg>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.pwa.title')}
          </h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isInstalled ? (
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--sc-success-fg)]"
              aria-hidden="true"
            >
              ✓
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                {t('settings.pwa.installedTitle')}
              </p>
              <p className="text-sm text-[var(--sc-text-secondary)] mt-0.5">
                {t('settings.pwa.installedDescription')}
              </p>
            </div>
          </div>
        ) : isInstallable ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--sc-text-secondary)]">
              {t('settings.pwa.description')}
            </p>
            <p className="text-xs text-[var(--sc-text-tertiary)]">{t('settings.pwa.benefits')}</p>
            <Button
              variant="primary"
              onClick={() => void installApp()}
              className="w-full sm:w-auto"
            >
              {t('settings.pwa.installBtn')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--sc-text-primary)]">
              {t('settings.pwa.notAvailableTitle')}
            </p>
            <p className="text-sm text-[var(--sc-text-secondary)]">
              {t('settings.pwa.notAvailableDescription')}
            </p>
          </div>
        )}

        {/* Cache clear — always visible as a secondary action */}
        <div className="border-t border-[var(--sc-border-default)] pt-4">
          <p className="text-xs text-[var(--sc-text-tertiary)] mb-2">
            {t('settings.pwa.clearCacheDescription')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleClearCache()}
            disabled={cacheCleared}
          >
            {cacheCleared ? t('settings.pwa.clearCacheSuccess') : t('settings.pwa.clearCache')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export const GeneralSection: FC = () => {
  const { t, language, handleLanguageChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.language.title')}
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--sc-text-secondary)] mb-2">
            {t('settings.language.description')}
          </p>
          <Select id="language-select" value={language} onChange={handleLanguageChange}>
            <option value="en">{t('settings.language.english')}</option>
            <option value="de">{t('settings.language.german')}</option>
            <option value="fr">{t('settings.language.french')}</option>
            <option value="es">{t('settings.language.spanish')}</option>
            <option value="it">{t('settings.language.italian')}</option>
            {/* QNBS-v3: Phase 2 B-5 — RTL beta stubs; English placeholder text until human review */}
            <option value="ar">{t('settings.language.arabic')}</option>
            <option value="he">{t('settings.language.hebrew')}</option>
          </Select>
        </CardContent>
      </Card>
      <PWAInstallCard />
    </div>
  );
};

export const AppearanceSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  // QNBS-v3: Defensive merge — old persisted states may lack themeCustomization entirely.
  const themeCustomization = settings.themeCustomization ?? defaultThemeCustomization;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.appearance.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <span className="text-sm font-medium text-[var(--sc-text-secondary)]">
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
          {/* QNBS-v3: Creative palettes layer on dark/light — semantic tokens in index.css */}
          <div className="pt-2 border-t border-[var(--sc-border-subtle)] space-y-2">
            <span className="text-sm font-medium text-[var(--sc-text-secondary)]">
              {t('settings.appearance.preset')}
            </span>
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.appearance.presetHint')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Button
                variant={settings.appearancePreset === 'default' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => handleSettingChange('appearancePreset', 'default')}
                className="justify-center"
              >
                {t('settings.appearance.presetDefault')}
              </Button>
              <Button
                variant={settings.appearancePreset === 'sepia' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => handleSettingChange('appearancePreset', 'sepia')}
                className="justify-center"
              >
                {t('settings.appearance.presetSepia')}
              </Button>
              <Button
                variant={settings.appearancePreset === 'fantasy' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => handleSettingChange('appearancePreset', 'fantasy')}
                className="justify-center"
              >
                {t('settings.appearance.presetFantasy')}
              </Button>
              <Button
                variant={settings.appearancePreset === 'romance' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => handleSettingChange('appearancePreset', 'romance')}
                className="justify-center"
              >
                {t('settings.appearance.presetRomance')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.appearance.customization')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="settings-primary-color"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
              >
                {t('settings.appearance.primaryColor')}
              </label>
              <input
                id="settings-primary-color"
                type="color"
                value={themeCustomization.primaryColor}
                onChange={(e) =>
                  handleSettingChange('themeCustomization', {
                    ...themeCustomization,
                    primaryColor: e.target.value,
                  })
                }
                className="w-full h-10 rounded border border-[var(--sc-border-subtle)]"
              />
            </div>
            <div>
              <label
                htmlFor="settings-secondary-color"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
              >
                {t('settings.appearance.secondaryColor')}
              </label>
              <input
                id="settings-secondary-color"
                type="color"
                value={themeCustomization.secondaryColor}
                onChange={(e) =>
                  handleSettingChange('themeCustomization', {
                    ...themeCustomization,
                    secondaryColor: e.target.value,
                  })
                }
                className="w-full h-10 rounded border border-[var(--sc-border-subtle)]"
              />
            </div>
            <div>
              <label
                htmlFor="settings-accent-color"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
              >
                {t('settings.appearance.accentColor')}
              </label>
              <input
                id="settings-accent-color"
                type="color"
                value={themeCustomization.accentColor}
                onChange={(e) =>
                  handleSettingChange('themeCustomization', {
                    ...themeCustomization,
                    accentColor: e.target.value,
                  })
                }
                className="w-full h-10 rounded border border-[var(--sc-border-subtle)]"
              />
            </div>
            <div>
              <label
                htmlFor="settings-bg-color"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
              >
                {t('settings.appearance.backgroundColor')}
              </label>
              <input
                id="settings-bg-color"
                type="color"
                value={themeCustomization.backgroundColor}
                onChange={(e) =>
                  handleSettingChange('themeCustomization', {
                    ...themeCustomization,
                    backgroundColor: e.target.value,
                  })
                }
                className="w-full h-10 rounded border border-[var(--sc-border-subtle)]"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="settings-custom-css"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.appearance.customCss')}
            </label>
            <textarea
              id="settings-custom-css"
              value={themeCustomization.customCss}
              onChange={(e) =>
                handleSettingChange('themeCustomization', {
                  ...themeCustomization,
                  customCss: e.target.value,
                })
              }
              placeholder="/* Custom CSS */"
              className="w-full h-32 p-3 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// QNBS-v3: Laufzeit-Snapshot unter Feature-Flag — ehrliche UX ohne Lighthouse-Versprechen.
const AppHealthPanel: FC = () => {
  const { t, language, projectSize, currentWordCount } = useSettingsViewContext();
  const [backend, setBackend] = useState<'indexeddb' | 'filesystem' | 'pending'>('pending');

  useEffect(() => {
    let cancelled = false;
    void storageService.getStorageBackendKind().then((kind) => {
      if (!cancelled) setBackend(kind);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const storageLine =
    backend === 'pending'
      ? '…'
      : backend === 'filesystem'
        ? t('settings.health.storageFilesystem')
        : t('settings.health.storageIndexeddb');

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
          {t('settings.health.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-[var(--sc-text-secondary)]">
        <p>{t('settings.health.description')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium text-[var(--sc-text-primary)]">
              {t('settings.health.locale')}:
            </span>{' '}
            <span className="uppercase">{language}</span>
          </li>
          <li>{storageLine}</li>
          <li>
            <span className="font-medium text-[var(--sc-text-primary)]">
              {t('settings.health.wordCount')}:
            </span>{' '}
            {currentWordCount}
          </li>
          <li>
            <span className="font-medium text-[var(--sc-text-primary)]">
              {t('settings.health.projectSize')}:
            </span>{' '}
            {projectSize}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};

const TauriVersionLine: FC = () => {
  const { t } = useSettingsViewContext();
  const [tauriVersion, setTauriVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getTauriAppVersion().then(setTauriVersion);
  }, []);

  if (!tauriVersion) return null;
  return (
    <p className="text-sm text-[var(--sc-text-muted)]">
      {t('settings.about.tauriVersion')}: {tauriVersion}
    </p>
  );
};

export const AboutSection: FC = React.memo(() => {
  const { t } = useSettingsViewContext();
  const { enableAppHealthPanel } = useFeatureFlags();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.about.title')}
          </h2>
        </CardHeader>
        <CardContent className="text-center text-[var(--sc-text-muted)] space-y-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-16 h-16 text-[var(--sc-accent)] mx-auto"
            aria-hidden="true"
          >
            {ICONS.WRITER}
          </svg>
          <h3 className="text-2xl font-bold text-[var(--sc-text-primary)]">StoryCraft Studio</h3>
          <p>
            {t('settings.about.versionLabel')} {packageJson.version}
          </p>
          <TauriVersionLine />
          <p>{t('settings.about.description')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <a
              href="https://www.github.com/qnbs/StoryCraft-Studio/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sc-lg border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] hover:border-[var(--sc-border-strong)] transition-colors duration-sc-fast text-sm font-medium"
              aria-label={t('settings.about.githubLabel')}
            >
              {/* QNBS-v3: GitHub mark SVG inline — avoids external icon dep; 20px matches text-sm line height */}
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              {t('settings.about.githubLabel')}
            </a>
            <a
              href="https://storycraft-studio-indol.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sc-lg bg-[var(--sc-accent)]/10 border border-[var(--sc-accent)]/30 text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/20 transition-colors duration-sc-fast text-sm font-medium"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
              </svg>
              {t('settings.about.liveDemo')}
            </a>
          </div>
          <p className="text-xs text-[var(--sc-text-muted)] pt-1">
            {t('settings.about.githubDescription')}
          </p>
        </CardContent>
      </Card>
      {enableAppHealthPanel ? (
        <AppHealthPanel />
      ) : (
        <p className="text-xs text-center text-[var(--sc-text-muted)] px-2">
          {t('settings.health.buildNote')}
        </p>
      )}
    </div>
  );
});
AboutSection.displayName = 'AboutSection';
