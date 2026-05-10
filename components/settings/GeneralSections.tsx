import type { FC } from 'react';
import React, { useEffect, useState } from 'react';
import { ICONS } from '../../constants';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import packageJson from '../../package.json';
import { storageService } from '../../services/storageService';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';

export const GeneralSection: FC = () => {
  const { t, language, handleLanguageChange } = useSettingsViewContext();
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
};

export const AppearanceSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
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
          {/* QNBS-v3: Creative palettes layer on dark/light — semantic tokens in index.css */}
          <div className="pt-2 border-t border-[var(--border-primary)] space-y-2">
            <span className="text-sm font-medium text-[var(--foreground-secondary)]">
              {t('settings.appearance.preset')}
            </span>
            <p className="text-xs text-[var(--foreground-muted)]">
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
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.appearance.customization')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="settings-primary-color"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.appearance.primaryColor')}
              </label>
              <input
                id="settings-primary-color"
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
              <label
                htmlFor="settings-secondary-color"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.appearance.secondaryColor')}
              </label>
              <input
                id="settings-secondary-color"
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
              <label
                htmlFor="settings-accent-color"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.appearance.accentColor')}
              </label>
              <input
                id="settings-accent-color"
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
              <label
                htmlFor="settings-bg-color"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.appearance.backgroundColor')}
              </label>
              <input
                id="settings-bg-color"
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
            <label
              htmlFor="settings-custom-css"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.appearance.customCss')}
            </label>
            <textarea
              id="settings-custom-css"
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
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('settings.health.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-[var(--foreground-secondary)]">
        <p>{t('settings.health.description')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium text-[var(--foreground-primary)]">
              {t('settings.health.locale')}:
            </span>{' '}
            <span className="uppercase">{language}</span>
          </li>
          <li>{storageLine}</li>
          <li>
            <span className="font-medium text-[var(--foreground-primary)]">
              {t('settings.health.wordCount')}:
            </span>{' '}
            {currentWordCount}
          </li>
          <li>
            <span className="font-medium text-[var(--foreground-primary)]">
              {t('settings.health.projectSize')}:
            </span>{' '}
            {projectSize}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};

export const AboutSection: FC = React.memo(() => {
  const { t } = useSettingsViewContext();
  const { enableAppHealthPanel } = useFeatureFlags();

  return (
    <div className="space-y-6">
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
            aria-hidden="true"
          >
            {ICONS.WRITER}
          </svg>
          <h3 className="text-2xl font-bold text-[var(--foreground-primary)]">StoryCraft Studio</h3>
          <p>
            {t('settings.about.versionLabel')} {packageJson.version}
          </p>
          <p>{t('settings.about.description')}</p>
        </CardContent>
      </Card>
      {enableAppHealthPanel ? (
        <AppHealthPanel />
      ) : (
        <p className="text-xs text-center text-[var(--foreground-muted)] px-2">
          {t('settings.health.buildNote')}
        </p>
      )}
    </div>
  );
});
AboutSection.displayName = 'AboutSection';
