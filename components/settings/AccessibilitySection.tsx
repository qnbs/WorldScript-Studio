import type { FC } from 'react';
import { useContext } from 'react';
import { AppContext } from '../../contexts/AppContext';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { accessibilityPresetDefaults } from '../../features/settings/accessibilitySchema';
import type { AccessibilityPresetId, AccessibilitySettings } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

const PRESET_IDS: Exclude<AccessibilityPresetId, 'custom'>[] = [
  'motor',
  'lowVision',
  'cognitive',
  'screenReader',
];

export const AccessibilitySection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const appCtx = useContext(AppContext);

  const patchA11y = (partial: Partial<AccessibilitySettings>) => {
    handleSettingChange('accessibility', {
      ...settings.accessibility,
      ...partial,
      presetId: 'custom',
    });
  };

  const applyPreset = (id: Exclude<AccessibilityPresetId, 'custom'>) => {
    handleSettingChange('accessibility', accessibilityPresetDefaults(id));
  };

  const openHelp = () => appCtx?.handleNavigate('help');

  const presetTitleKey = (id: Exclude<AccessibilityPresetId, 'custom'>) =>
    `settings.accessibility.hub.preset.${id}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.accessibility.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-2">
            {t('settings.accessibility.hub.intro')}
          </p>
          <p className="text-xs text-[var(--sc-text-muted)] mt-2">
            {t('settings.accessibility.activePreset')}:{' '}
            <span className="font-medium text-[var(--sc-text-secondary)]">
              {t(`settings.accessibility.preset.${settings.accessibility.presetId ?? 'custom'}`)}
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* QNBS-v3: Accessibility-Hub — Presets + Vorschau + Hilfe, ohne bestehende Feineinstellungen zu entfernen. */}
          <section aria-labelledby="a11y-presets-heading">
            <h3
              id="a11y-presets-heading"
              className="text-sm font-semibold text-[var(--sc-text-secondary)] mb-3"
            >
              {t('settings.accessibility.hub.presetsTitle')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESET_IDS.map((id) => (
                <div
                  key={id}
                  className="rounded-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)]/40 p-4 flex flex-col gap-2"
                >
                  <Button
                    type="button"
                    variant={settings.accessibility.presetId === id ? 'primary' : 'secondary'}
                    size="sm"
                    className="w-full justify-center"
                    aria-pressed={settings.accessibility.presetId === id}
                    aria-label={t(presetTitleKey(id))}
                    onClick={() => applyPreset(id)}
                  >
                    {t(presetTitleKey(id))}
                  </Button>
                  <p className="text-xs text-[var(--sc-text-muted)] leading-snug">
                    {t(`${presetTitleKey(id)}Hint`)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="a11y-preview-heading">
            <h3
              id="a11y-preview-heading"
              className="text-sm font-semibold text-[var(--sc-text-secondary)] mb-3"
            >
              {t('settings.accessibility.hub.previewTitle')}
            </h3>
            <div className="rounded-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] p-4 flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" size="sm">
                {t('settings.accessibility.hub.preview.sampleButton')}
              </Button>
              <button
                type="button"
                className="text-sm text-[var(--sc-accent)] underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] rounded"
              >
                {t('settings.accessibility.hub.preview.sampleLink')}
              </button>
              <span className="text-xs px-2 py-1 rounded-md bg-[var(--sc-surface-overlay)] border border-[var(--sc-border-subtle)]">
                {t('settings.accessibility.hub.preview.badge')}
              </span>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!appCtx}
              onClick={() => openHelp()}
            >
              {t('settings.accessibility.hub.helpButton')}
            </Button>
            <span className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.accessibility.hub.helpHint')}
            </span>
          </div>

          <div>
            <label
              htmlFor="settings-live-region-verbosity"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.accessibility.liveRegionVerbosity')}
            </label>
            <Select
              id="settings-live-region-verbosity"
              value={settings.accessibility.liveRegionVerbosity}
              onChange={(e) =>
                patchA11y({
                  liveRegionVerbosity: e.target
                    .value as AccessibilitySettings['liveRegionVerbosity'],
                })
              }
            >
              <option value="minimal">{t('settings.accessibility.liveRegion.minimal')}</option>
              <option value="normal">{t('settings.accessibility.liveRegion.normal')}</option>
              <option value="verbose">{t('settings.accessibility.liveRegion.verbose')}</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.accessibility.highContrast')}
              checked={settings.accessibility.highContrast}
              onChange={(v) => patchA11y({ highContrast: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.reducedMotion')}
              checked={settings.accessibility.reducedMotion}
              onChange={(v) => patchA11y({ reducedMotion: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.largeText')}
              checked={settings.accessibility.largeText}
              onChange={(v) => patchA11y({ largeText: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.screenReader')}
              checked={settings.accessibility.screenReader}
              onChange={(v) => patchA11y({ screenReader: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.focusIndicators')}
              checked={settings.accessibility.focusIndicators}
              onChange={(v) => patchA11y({ focusIndicators: v })}
            />
          </div>
          <div>
            <label
              htmlFor="settings-colorblind-mode"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.accessibility.colorBlindMode')}
            </label>
            <Select
              id="settings-colorblind-mode"
              value={settings.accessibility.colorBlindMode}
              onChange={(e) =>
                patchA11y({
                  colorBlindMode: e.target.value as AccessibilitySettings['colorBlindMode'],
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
};
