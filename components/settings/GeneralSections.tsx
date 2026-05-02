import type { FC } from 'react';
import React from 'react';
import { ICONS } from '../../constants';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
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

export const AboutSection: FC = React.memo(() => {
  const { t } = useSettingsViewContext();
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
        <h3 className="text-2xl font-bold text-[var(--foreground-primary)]">StoryCraft Studio</h3>
        <p>Version 2.0.0</p>
        <p>{t('settings.about.description')}</p>
      </CardContent>
    </Card>
  );
});
AboutSection.displayName = 'AboutSection';
